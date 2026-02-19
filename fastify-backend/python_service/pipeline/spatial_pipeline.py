"""Python spatial compute pipeline."""

from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import asdict
from typing import Any, Dict, Iterable, Iterator, List, Tuple

from shapely.geometry import MultiPoint, Point, Polygon, mapping, shape
from shapely.prepared import prep

from algorithms.alpha_shape import build_alpha_shape
from algorithms.direction_filter import filter_pois_by_direction, resolve_direction_from_query_plan
from algorithms.h3_aggregate import aggregate_pois_h3
from algorithms.graph_reasoning import analyze_spatial_graph
from algorithms.hdbscan_cluster import cluster_points
from algorithms.membership import compute_membership
from algorithms.region_comparison import analyze_region_set, compute_region_comparison
from db.repository import POIRepository


def _safe_json_loads(raw: Any, fallback: Any) -> Any:
    """瀹夊叏 JSON 瑙ｆ瀽锛岃В鏋愬け璐ヨ繑鍥為粯璁ゅ€笺€?"""
    if raw is None:
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str):
        return fallback

    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _category_of(poi: Dict[str, Any]) -> str:
    """鎻愬彇 POI 涓荤被鍒瓧娈点€?"""
    return (
        poi.get("category_small")
        or poi.get("category_mid")
        or poi.get("category_big")
        or poi.get("type")
        or "unknown"
    )


def _calc_bbox_area(points: Iterable[Tuple[float, float]]) -> float:
    """鎸夊寘鍥寸洅浼扮畻闈㈢Н锛坢虏锛夈€?"""
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    if not xs or not ys:
        return 0.0

    width = (max(xs) - min(xs)) * 111_320.0
    height = (max(ys) - min(ys)) * 111_320.0
    return max(0.0, width * height)


def _dynamic_h3_resolution(area_km2: float) -> int:
    """鎸夐潰绉槧灏勫姩鎬?H3 鍒嗚鲸鐜囥€?"""
    if area_km2 < 1:
        return 10
    if area_km2 < 5:
        return 9
    if area_km2 < 20:
        return 8
    if area_km2 < 80:
        return 7
    return 6


def _extract_area_km2(spatial_context: Dict[str, Any]) -> float:
    """浠庤姹備笂涓嬫枃浼扮畻鏌ヨ鑼冨洿闈㈢Н锛坘m虏锛夈€?"""
    mode = str(spatial_context.get("mode", "")).lower()

    if mode == "circle" and spatial_context.get("radius"):
        radius_km = float(spatial_context.get("radius", 0)) / 1000.0
        return math.pi * radius_km * radius_km

    viewport = spatial_context.get("viewport")
    if isinstance(viewport, list) and len(viewport) >= 4:
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
        except Exception:
            return 0.0
        width = abs(max_lon - min_lon) * 111.32
        height = abs(max_lat - min_lat) * 111.32
        return max(0.0, width * height)

    return 0.0


def _to_float(value: Any) -> float | None:
    """Safe float conversion helper."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_payload_poi(raw: Any) -> Dict[str, Any] | None:
    """Normalize payload POI into repository-compatible shape."""
    if not isinstance(raw, dict):
        return None

    props = raw.get("properties") if isinstance(raw.get("properties"), dict) else raw
    geom = raw.get("geometry") if isinstance(raw.get("geometry"), dict) else {}

    lon = (
        _to_float(raw.get("lon"))
        or _to_float(raw.get("lng"))
        or _to_float(raw.get("longitude"))
        or _to_float(props.get("lon"))
        or _to_float(props.get("lng"))
        or _to_float(props.get("longitude"))
    )
    lat = (
        _to_float(raw.get("lat"))
        or _to_float(raw.get("latitude"))
        or _to_float(props.get("lat"))
        or _to_float(props.get("latitude"))
    )

    if (lon is None or lat is None) and isinstance(geom.get("coordinates"), list) and len(geom["coordinates"]) >= 2:
        lon = lon if lon is not None else _to_float(geom["coordinates"][0])
        lat = lat if lat is not None else _to_float(geom["coordinates"][1])

    if lon is None or lat is None:
        return None

    return {
        "id": props.get("id", raw.get("id")),
        "name": props.get("name") or "",
        "address": props.get("address") or "",
        "type": props.get("type") or "",
        "category_big": props.get("category_big") or props.get("categoryBig") or "",
        "category_mid": props.get("category_mid") or props.get("categoryMid") or "",
        "category_small": props.get("category_small") or props.get("categorySmall") or "",
        "rating": props.get("rating"),
        "lon": lon,
        "lat": lat,
    }


def _normalize_payload_candidates(raw_candidates: Any) -> List[Dict[str, Any]]:
    """Parse gRPC candidates_json and discard invalid points."""
    if not isinstance(raw_candidates, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for item in raw_candidates:
        poi = _normalize_payload_poi(item)
        if poi is not None:
            normalized.append(poi)
    return normalized


def _contains_text(value: Any, keyword: str) -> bool:
    return keyword in str(value or "").lower()


def _matches_categories(poi: Dict[str, Any], categories: List[str]) -> bool:
    if not categories:
        return True

    fields = [
        poi.get("category_big"),
        poi.get("category_mid"),
        poi.get("category_small"),
        poi.get("type"),
    ]

    for category in categories:
        key = str(category).strip().lower()
        if not key:
            continue
        if any(_contains_text(field, key) for field in fields):
            return True
    return False


def _matches_terms(poi: Dict[str, Any], terms: List[str]) -> bool:
    if not terms:
        return True

    fields = [
        poi.get("name"),
        poi.get("address"),
        poi.get("category_big"),
        poi.get("category_mid"),
        poi.get("category_small"),
        poi.get("type"),
    ]

    for term in terms:
        key = str(term).strip().lower()
        if not key:
            continue
        if any(_contains_text(field, key) for field in fields):
            return True
    return False


def _build_spatial_checker(spatial_context: Dict[str, Any]):
    """Build a callable spatial filter from spatial_context."""
    boundary = spatial_context.get("boundary")
    if isinstance(boundary, list) and len(boundary) >= 3:
        ring: List[Tuple[float, float]] = []
        for raw in boundary:
            if isinstance(raw, dict):
                lon = _to_float(raw.get("lon", raw.get("lng", raw.get("longitude"))))
                lat = _to_float(raw.get("lat", raw.get("latitude")))
            elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
                lon = _to_float(raw[0])
                lat = _to_float(raw[1])
            else:
                lon = None
                lat = None
            if lon is not None and lat is not None:
                ring.append((lon, lat))

        if len(ring) >= 3:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            polygon = Polygon(ring)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)

            if polygon.is_valid:
                min_lon, min_lat, max_lon, max_lat = polygon.bounds
                prepared_polygon = prep(polygon)

                # ??????? bbox ?????? prepared geometry ????????? Shapely ???????
                def _within_polygon(lon: float, lat: float) -> bool:
                    if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
                        return False
                    return bool(prepared_polygon.covers(Point(lon, lat)))

                return _within_polygon

    viewport = spatial_context.get("viewport")
    if isinstance(viewport, list) and len(viewport) >= 4:
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
        except (TypeError, ValueError):
            return lambda *_: True

        return lambda lon, lat: min_lon <= lon <= max_lon and min_lat <= lat <= max_lat

    center = spatial_context.get("center")
    radius_m = _to_float(spatial_context.get("radius"))
    if isinstance(center, dict) and radius_m and radius_m > 0:
        center_lon = _to_float(center.get("lon", center.get("lng", center.get("longitude"))))
        center_lat = _to_float(center.get("lat", center.get("latitude")))
        if center_lon is not None and center_lat is not None:
            radius_km = radius_m / 1000.0

            def _within_circle(lon: float, lat: float) -> bool:
                distance = _haversine_km(center_lat, center_lon, lat, lon)
                return distance <= radius_km

            return _within_circle

    return lambda *_: True


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute haversine distance in kilometers."""
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _sample_coordinates(coords: List[Tuple[float, float]], max_points: int) -> List[Tuple[float, float]]:
    """Deterministically sample coordinates to cap heavy geometry operations."""
    if max_points <= 0 or len(coords) <= max_points:
        return coords

    # ???????????????????????????????
    step = max(1, len(coords) // max_points)
    sampled = coords[::step]

    if sampled and sampled[-1] != coords[-1]:
        sampled = sampled + [coords[-1]]

    if len(sampled) > max_points:
        sampled = sampled[:max_points]

    return sampled


def _top_membership_drivers(membership, top_n: int = 2) -> List[Dict[str, Any]]:
    """Return top contributing factors for fuzzy-region explainability."""
    factors = [
        ("density", float(getattr(membership, "density", 0.0))),
        ("purity", float(getattr(membership, "purity", 0.0))),
        ("centrality", float(getattr(membership, "centrality", 0.0))),
        ("compactness", float(getattr(membership, "compactness", 0.0))),
        ("scale", float(getattr(membership, "scale", 0.0))),
    ]

    factors.sort(key=lambda item: item[1], reverse=True)
    return [
        {"factor": name, "value": round(value, 4)}
        for name, value in factors[: max(1, top_n)]
    ]


def _empty_graph_summary() -> Dict[str, Any]:
    """Return stable empty graph payload for API compatibility."""
    return {
        "node_count": 0,
        "edge_count": 0,
        "component_count": 0,
        "components": [],
        "top_hubs": [],
        "avg_degree": 0.0,
        "distance_threshold_m": 280.0,
    }


def _filter_payload_candidates(
    candidates: List[Dict[str, Any]],
    *,
    spatial_context: Dict[str, Any],
    categories: List[str],
    terms: List[str],
    limit: int = 8000,
) -> List[Dict[str, Any]]:
    """Apply secondary filtering on payload candidates in Python."""
    checker = _build_spatial_checker(spatial_context)
    filtered: List[Dict[str, Any]] = []

    for poi in candidates:
        lon = _to_float(poi.get("lon"))
        lat = _to_float(poi.get("lat"))
        if lon is None or lat is None:
            continue

        if not checker(lon, lat):
            continue

        if not _matches_categories(poi, categories):
            continue

        if not _matches_terms(poi, terms):
            continue

        filtered.append(poi)
        if len(filtered) >= limit:
            break

    return filtered


def _resolve_limit(raw_value: Any, *, default_value: int, max_value: int) -> int:
    """Resolve runtime limit with strict numeric clamp."""
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = default_value

    if parsed <= 0:
        parsed = default_value

    return max(1, min(parsed, max_value))


def _as_polygon(geometry: Any) -> Polygon | None:
    """Normalize arbitrary shapely geometry to a single Polygon."""
    if geometry is None:
        return None

    if isinstance(geometry, Polygon):
        return geometry

    geom_type = getattr(geometry, "geom_type", "")
    if geom_type == "MultiPolygon":
        polygons = [geom for geom in geometry.geoms if isinstance(geom, Polygon)]
        if polygons:
            return max(polygons, key=lambda geom: geom.area)

    if geom_type == "GeometryCollection":
        polygons = [geom for geom in geometry.geoms if isinstance(geom, Polygon)]
        if polygons:
            return max(polygons, key=lambda geom: geom.area)

    return None


def _cluster_span_deg(cluster_points: List[Tuple[float, float]] | None) -> float:
    """Return max longitude/latitude span of point set in degree space."""
    if not cluster_points:
        return 0.0
    xs = [float(pt[0]) for pt in cluster_points]
    ys = [float(pt[1]) for pt in cluster_points]
    if not xs or not ys:
        return 0.0
    return max(max(xs) - min(xs), max(ys) - min(ys))


def _adaptive_surface_buffer_deg(
    geometry: Any,
    *,
    cluster_points: List[Tuple[float, float]] | None = None,
) -> float:
    """
    Adaptive buffer for converting line/point hulls into surface polygons.
    Keeps degenerate geometries as area features for map rendering and scoring.
    """
    span = _cluster_span_deg(cluster_points)

    if span <= 0.0 and geometry is not None and getattr(geometry, "is_empty", False) is False:
        try:
            min_x, min_y, max_x, max_y = geometry.bounds
            span = max(float(max_x) - float(min_x), float(max_y) - float(min_y))
        except Exception:
            span = 0.0

    if span <= 0.0:
        return 0.00012

    return max(0.00005, min(0.0022, span * 0.085))


def _to_surface_polygon(
    geometry: Any,
    *,
    cluster_points: List[Tuple[float, float]] | None = None,
) -> Polygon | None:
    """
    Convert polygon/line/point geometries into a renderable Polygon surface.
    """
    if geometry is None or getattr(geometry, "is_empty", False):
        return None

    polygon = _as_polygon(geometry)
    if polygon is not None and not polygon.is_empty:
        return polygon

    geom_type = str(getattr(geometry, "geom_type", ""))
    if geom_type in {"LineString", "LinearRing", "MultiLineString", "Point", "MultiPoint", "GeometryCollection"}:
        buffer_deg = _adaptive_surface_buffer_deg(geometry, cluster_points=cluster_points)
        try:
            buffered = geometry.buffer(buffer_deg)
            buffered = buffered.buffer(0)
        except Exception:
            return None
        polygon = _as_polygon(buffered)
        if polygon is not None and not polygon.is_empty:
            return polygon

    return None


def _polygon_from_geojson(
    boundary_geojson: Any,
    *,
    cluster_points: List[Tuple[float, float]] | None = None,
) -> Polygon | None:
    """Parse GeoJSON boundary into Polygon surface."""
    if not isinstance(boundary_geojson, dict):
        return None

    try:
        geometry = shape(boundary_geojson)
    except Exception:
        return None

    geometry = geometry.buffer(0)
    return _to_surface_polygon(geometry, cluster_points=cluster_points)


def _polygon_ring(polygon: Polygon | None) -> List[List[float]]:
    """Convert polygon exterior into [lon, lat] ring list."""
    if polygon is None or polygon.is_empty:
        return []

    return [[float(x), float(y)] for x, y in polygon.exterior.coords]


def _polygon_area_km2(polygon: Polygon | None) -> float:
    """Approximate area from degree-space geometry to km虏."""
    if polygon is None or polygon.is_empty:
        return 0.0
    return float(polygon.area) * (111.32 ** 2)


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def _build_region_layers(
    *,
    cluster_points: List[Tuple[float, float]],
    base_boundary_geojson: Dict[str, Any],
    density: float,
    membership_score: float,
) -> Dict[str, Any]:
    """
    Build nested surface layers (outer / transition / core) from cluster geometry.
    This is used by hotspots, vernacular regions and fuzzy regions.
    """
    polygon = _polygon_from_geojson(base_boundary_geojson, cluster_points=cluster_points)
    if polygon is None:
        polygon = _to_surface_polygon(MultiPoint(cluster_points).convex_hull, cluster_points=cluster_points)
    if polygon is None and cluster_points:
        xs = [pt[0] for pt in cluster_points]
        ys = [pt[1] for pt in cluster_points]
        center = Point(sum(xs) / len(xs), sum(ys) / len(ys))
        lon_span = max(xs) - min(xs) if len(xs) > 1 else 0.0
        lat_span = max(ys) - min(ys) if len(ys) > 1 else 0.0
        radius = max(0.00012, max(lon_span, lat_span) * 0.25)
        polygon = _as_polygon(center.buffer(radius))
    if polygon is None:
        return {
            "outer": {"boundary": [], "geojson": None, "area_km2": 0.0, "confidence": 0.0},
            "transition": {"boundary": [], "geojson": None, "area_km2": 0.0, "confidence": 0.0},
            "core": {"boundary": [], "geojson": None, "area_km2": 0.0, "confidence": 0.0},
            "representative_boundary": [],
            "representative_geojson": None,
        }

    min_x, min_y, max_x, max_y = polygon.bounds
    span = max(max_x - min_x, max_y - min_y)

    # Adaptive offset by geometry scale + density confidence.
    adaptive = max(0.00008, min(0.0045, span * (0.20 + (1.0 - _clamp01(density)) * 0.10)))
    outer_expand = adaptive * 0.60
    transition_expand = adaptive * 0.22
    core_shrink = adaptive * (0.30 + 0.25 * (1.0 - _clamp01(membership_score)))

    outer = _as_polygon(polygon.buffer(outer_expand))
    transition = _as_polygon(polygon.buffer(transition_expand))
    core = _as_polygon(polygon.buffer(-core_shrink))

    if outer is None:
        outer = polygon
    if transition is None:
        transition = polygon
    if core is None or core.is_empty:
        core = _as_polygon(polygon.centroid.buffer(max(adaptive * 0.35, 0.00006)))
        if core is None:
            core = polygon

    outer_conf = _clamp01(0.40 + _clamp01(density) * 0.25)
    transition_conf = _clamp01(0.52 + _clamp01(membership_score) * 0.30)
    core_conf = _clamp01(0.60 + _clamp01(membership_score) * 0.32)

    layers = {
        "outer": {
            "boundary": _polygon_ring(outer),
            "geojson": mapping(outer),
            "area_km2": round(_polygon_area_km2(outer), 6),
            "confidence": round(outer_conf, 4),
        },
        "transition": {
            "boundary": _polygon_ring(transition),
            "geojson": mapping(transition),
            "area_km2": round(_polygon_area_km2(transition), 6),
            "confidence": round(transition_conf, 4),
        },
        "core": {
            "boundary": _polygon_ring(core),
            "geojson": mapping(core),
            "area_km2": round(_polygon_area_km2(core), 6),
            "confidence": round(core_conf, 4),
        },
    }

    return {
        **layers,
        "representative_boundary": layers["transition"]["boundary"] or layers["outer"]["boundary"],
        "representative_geojson": layers["transition"]["geojson"] or layers["outer"]["geojson"],
    }


def _calc_vitality_score(
    *,
    density: float,
    membership_score: float,
    purity: float,
    cluster_size: int,
    total_size: int,
    ) -> float:
    """Composite score for hotspot/region ranking."""
    cluster_ratio = 0.0 if total_size <= 0 else cluster_size / total_size
    return round(
        _clamp01(
            0.42 * _clamp01(density)
            + 0.28 * _clamp01(membership_score)
            + 0.20 * _clamp01(purity)
            + 0.10 * _clamp01(cluster_ratio)
        ),
        5,
    )


def _boundary_method_confidence(boundary_method: str) -> float:
    """Method reliability prior for boundary geometry quality."""
    method = str(boundary_method or "").lower()
    if method in {"alpha_shape", "alpha_shape_simplified"}:
        return 0.86
    if method in {"buffered_hull_degenerate", "buffered_hull_small_cluster"}:
        return 0.72
    if method == "convex_hull_small_cluster":
        return 0.64
    if method == "convex_hull_fallback":
        return 0.58
    if method.startswith("alpha_shape"):
        return 0.82
    if "convex_hull" in method:
        return 0.60
    return 0.62


def _score_boundary_quality(
    *,
    cluster_points: List[Tuple[float, float]],
    boundary_geojson: Dict[str, Any],
) -> Dict[str, Any]:
    """Evaluate boundary quality against source points."""
    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty or not cluster_points:
        return {
            "coverage_ratio": 0.0,
            "inside_point_count": 0,
            "point_count": len(cluster_points),
            "area_ratio_to_hull": 0.0,
            "compactness": 0.0,
            "quality_score": 0.0,
            "pass": False,
        }

    prepared_polygon = prep(polygon)
    inside_count = 0
    for lon, lat in cluster_points:
        if prepared_polygon.covers(Point(lon, lat)):
            inside_count += 1

    coverage_ratio = inside_count / max(1, len(cluster_points))

    hull_polygon = _to_surface_polygon(MultiPoint(cluster_points).convex_hull, cluster_points=cluster_points)
    hull_area_km2 = _polygon_area_km2(hull_polygon)
    polygon_area_km2 = _polygon_area_km2(polygon)
    area_ratio_to_hull = polygon_area_km2 / hull_area_km2 if hull_area_km2 > 0 else 1.0

    perimeter_km = float(polygon.length) * 111.32
    compactness = 0.0
    if perimeter_km > 0 and polygon_area_km2 > 0:
        compactness = _clamp01((4.0 * math.pi * polygon_area_km2) / (perimeter_km * perimeter_km))

    # Prefer boundaries that keep high point coverage while avoiding extreme area shrink/expansion.
    hull_similarity = _clamp01(1.0 - min(abs(area_ratio_to_hull - 0.72) / 0.72, 1.0))
    quality_score = _clamp01(
        0.62 * _clamp01(coverage_ratio)
        + 0.23 * hull_similarity
        + 0.15 * _clamp01(compactness)
    )

    pass_quality = coverage_ratio >= 0.78 and 0.14 <= area_ratio_to_hull <= 1.35

    return {
        "coverage_ratio": round(coverage_ratio, 4),
        "inside_point_count": int(inside_count),
        "point_count": int(len(cluster_points)),
        "area_ratio_to_hull": round(float(area_ratio_to_hull), 4),
        "compactness": round(float(compactness), 4),
        "quality_score": round(float(quality_score), 4),
        "pass": bool(pass_quality),
    }


def _build_cluster_boundary(
    *,
    cluster_points: List[Tuple[float, float]],
    bbox_area_m2: float,
    density: float,
    alpha_max_input_points: int,
) -> Dict[str, Any]:
    """
    Build cluster boundary via iterative alpha-shape candidates with quality scoring.
    Falls back to convex hull when alpha candidates are weak or invalid.
    """
    raw_hull = MultiPoint(cluster_points).convex_hull
    raw_hull_type = str(getattr(raw_hull, "geom_type", ""))
    hull_polygon = _to_surface_polygon(raw_hull, cluster_points=cluster_points)
    hull_geojson = mapping(hull_polygon) if hull_polygon is not None else mapping(raw_hull)

    is_degenerate_hull = raw_hull_type in {"Point", "MultiPoint", "LineString", "LinearRing", "MultiLineString"}
    small_cluster_method = "buffered_hull_small_cluster" if is_degenerate_hull else "convex_hull_small_cluster"

    if len(cluster_points) < 8:
        quality = _score_boundary_quality(cluster_points=cluster_points, boundary_geojson=hull_geojson)
        return {
            "boundary_geojson": hull_geojson,
            "boundary_method": small_cluster_method,
            "boundary_quality": quality,
            "boundary_generation": {
                "attempts": 1,
                "alpha_attempts": 0,
                "selected_attempt": 1,
                "selected_alpha": None,
                "base_alpha": None,
                "attempt_log": [
                    {
                        "attempt": 1,
                        "method": small_cluster_method,
                        "quality_score": quality["quality_score"],
                        "coverage_ratio": quality["coverage_ratio"],
                        "area_ratio_to_hull": quality["area_ratio_to_hull"],
                        "pass": quality["pass"],
                    }
                ],
            },
        }

    base_alpha = max(0.8, min(4.0, 2.0 - density + (bbox_area_m2 / 1_000_000.0)))
    alpha_factors = (1.0, 0.82, 1.28, 0.68, 1.55)
    attempt_log: List[Dict[str, Any]] = []
    best_candidate: Dict[str, Any] | None = None

    if is_degenerate_hull:
        quality = _score_boundary_quality(cluster_points=cluster_points, boundary_geojson=hull_geojson)
        return {
            "boundary_geojson": hull_geojson,
            "boundary_method": "buffered_hull_degenerate",
            "boundary_quality": quality,
            "boundary_generation": {
                "attempts": 1,
                "alpha_attempts": 0,
                "selected_attempt": 1,
                "selected_alpha": None,
                "base_alpha": round(float(base_alpha), 4),
                "attempt_log": [
                    {
                        "attempt": 1,
                        "method": "buffered_hull_degenerate",
                        "quality_score": quality["quality_score"],
                        "coverage_ratio": quality["coverage_ratio"],
                        "area_ratio_to_hull": quality["area_ratio_to_hull"],
                        "pass": quality["pass"],
                    }
                ],
            },
        }

    for attempt_index, factor in enumerate(alpha_factors, start=1):
        alpha = max(0.55, min(5.5, base_alpha * factor))
        alpha_polygon = build_alpha_shape(
            cluster_points,
            alpha=alpha,
            min_polygon_area_m2=800.0,
            max_input_points=alpha_max_input_points,
        )

        if not alpha_polygon:
            attempt_log.append(
                {
                    "attempt": attempt_index,
                    "alpha": round(alpha, 4),
                    "method": "alpha_shape_invalid",
                    "quality_score": 0.0,
                    "coverage_ratio": 0.0,
                    "area_ratio_to_hull": 0.0,
                    "pass": False,
                }
            )
            continue

        boundary_geojson = alpha_polygon["geojson"]
        boundary_method = alpha_polygon.get("method", "alpha_shape")
        quality = _score_boundary_quality(
            cluster_points=cluster_points,
            boundary_geojson=boundary_geojson,
        )
        attempt_log.append(
            {
                "attempt": attempt_index,
                "alpha": round(alpha, 4),
                "method": boundary_method,
                "quality_score": quality["quality_score"],
                "coverage_ratio": quality["coverage_ratio"],
                "area_ratio_to_hull": quality["area_ratio_to_hull"],
                "pass": quality["pass"],
            }
        )

        candidate = {
            "attempt": attempt_index,
            "alpha": alpha,
            "boundary_geojson": boundary_geojson,
            "boundary_method": boundary_method,
            "boundary_quality": quality,
        }

        if best_candidate is None or quality["quality_score"] > best_candidate["boundary_quality"]["quality_score"]:
            best_candidate = candidate

        if quality["pass"] and quality["quality_score"] >= 0.70:
            best_candidate = candidate
            break

    hull_quality = _score_boundary_quality(cluster_points=cluster_points, boundary_geojson=hull_geojson)
    attempt_log.append(
        {
            "attempt": len(attempt_log) + 1,
            "alpha": None,
            "method": "convex_hull_quality_fallback",
            "quality_score": hull_quality["quality_score"],
            "coverage_ratio": hull_quality["coverage_ratio"],
            "area_ratio_to_hull": hull_quality["area_ratio_to_hull"],
            "pass": hull_quality["pass"],
        }
    )

    hull_candidate = {
        "attempt": len(attempt_log),
        "alpha": None,
        "boundary_geojson": hull_geojson,
        "boundary_method": "convex_hull_quality_fallback",
        "boundary_quality": hull_quality,
    }

    if best_candidate is None:
        best_candidate = hull_candidate
    else:
        best_quality = best_candidate["boundary_quality"]
        if (
            best_quality["coverage_ratio"] < 0.72
            and hull_quality["coverage_ratio"] > best_quality["coverage_ratio"] + 0.12
        ):
            best_candidate = hull_candidate
        elif hull_quality["quality_score"] > best_quality["quality_score"] + 0.08:
            best_candidate = hull_candidate

    return {
        "boundary_geojson": best_candidate["boundary_geojson"],
        "boundary_method": best_candidate["boundary_method"],
        "boundary_quality": best_candidate["boundary_quality"],
        "boundary_generation": {
            "attempts": len(attempt_log),
            "alpha_attempts": sum(1 for attempt in attempt_log if str(attempt.get("method", "")).startswith("alpha_shape")),
            "selected_attempt": int(best_candidate["attempt"]),
            "selected_alpha": round(float(best_candidate["alpha"]), 4) if best_candidate["alpha"] is not None else None,
            "base_alpha": round(float(base_alpha), 4),
            "attempt_log": attempt_log[:6],
        },
    }


def _build_boundary_confidence(
    *,
    layer_bundle: Dict[str, Any],
    membership_score: float,
    boundary_method: str,
    boundary_quality_score: float | None = None,
) -> Dict[str, Any]:
    """Build explainable boundary confidence score in [0, 1]."""
    transition_conf = _to_float((layer_bundle.get("transition") or {}).get("confidence"))
    outer_conf = _to_float((layer_bundle.get("outer") or {}).get("confidence"))
    layer_conf = transition_conf if transition_conf is not None else (outer_conf if outer_conf is not None else 0.0)
    membership_conf = _clamp01(membership_score)
    method_conf = _clamp01(_boundary_method_confidence(boundary_method))
    quality_conf = _clamp01(float(boundary_quality_score)) if boundary_quality_score is not None else None

    if quality_conf is None:
        weights = {
            "layer": 0.55,
            "membership": 0.25,
            "method": 0.20,
        }
        score = _clamp01(
            weights["layer"] * layer_conf
            + weights["membership"] * membership_conf
            + weights["method"] * method_conf
        )
    else:
        weights = {
            "layer": 0.45,
            "membership": 0.20,
            "method": 0.15,
            "quality": 0.20,
        }
        score = _clamp01(
            weights["layer"] * layer_conf
            + weights["membership"] * membership_conf
            + weights["method"] * method_conf
            + weights["quality"] * quality_conf
        )

    explain = {
        "model": "composite_v1",
        "layer_confidence": round(layer_conf, 4),
        "membership_confidence": round(membership_conf, 4),
        "method_confidence": round(method_conf, 4),
        "weights": weights,
    }
    if quality_conf is not None:
        explain["quality_confidence"] = round(quality_conf, 4)

    return {
        "score": round(score, 4),
        "explain": explain,
    }


def _poi_priority(
    poi: Dict[str, Any],
    *,
    center_lon: float,
    center_lat: float,
    vitality_score: float,
) -> float:
    """Score a POI for display ordering (high-value + center proximity)."""
    rating_raw = _to_float(poi.get("rating"))
    rating_norm = 0.0
    if rating_raw is not None and rating_raw > 0:
        rating_norm = min(1.0, max(0.0, rating_raw / 5.0))

    lon = _to_float(poi.get("lon"))
    lat = _to_float(poi.get("lat"))
    if lon is None or lat is None:
        proximity = 0.0
    else:
        distance_km = _haversine_km(center_lat, center_lon, lat, lon)
        proximity = 1.0 / (1.0 + distance_km / 0.6)

    return (
        0.62 * _clamp01(vitality_score)
        + 0.28 * _clamp01(proximity)
        + 0.10 * _clamp01(rating_norm)
    )


def _build_representative_pois(
    *,
    cluster_entries: List[Dict[str, Any]],
    fallback_pois: List[Dict[str, Any]],
    max_count: int,
) -> List[Dict[str, Any]]:
    """
    Build a display list that is both high-value and spatially distributed.
    The first N points should not collapse into a single corner/cluster.
    """
    if max_count <= 0:
        return []

    if not cluster_entries:
        return fallback_pois[:max_count]

    ranked_entries = sorted(
        cluster_entries,
        key=lambda item: float(item.get("vitality_score", 0.0)),
        reverse=True,
    )

    total_cluster_points = max(
        1,
        sum(int(item.get("poi_count", len(item.get("cluster_pois", [])))) for item in ranked_entries),
    )

    queues: List[List[Dict[str, Any]]] = []
    used_ids = set()

    for entry in ranked_entries:
        cluster_pois = list(entry.get("cluster_pois") or [])
        if not cluster_pois:
            continue

        center = entry.get("center") or {}
        center_lon = _to_float(center.get("lon")) or 0.0
        center_lat = _to_float(center.get("lat")) or 0.0
        vitality = float(entry.get("vitality_score", 0.0))
        cluster_size = len(cluster_pois)

        quota = max(
            6,
            int(round(max_count * (cluster_size / total_cluster_points))),
        )
        quota = min(quota, cluster_size)

        scored = sorted(
            cluster_pois,
            key=lambda poi: _poi_priority(
                poi,
                center_lon=center_lon,
                center_lat=center_lat,
                vitality_score=vitality,
            ),
            reverse=True,
        )[:quota]

        queue: List[Dict[str, Any]] = []
        for poi in scored:
            poi_id = poi.get("id")
            stable_key = (poi_id, poi.get("lon"), poi.get("lat"), poi.get("name"))
            if stable_key in used_ids:
                continue
            used_ids.add(stable_key)

            queue.append(
                {
                    **poi,
                    "cluster_id": entry.get("id"),
                    "analysis_score": round(
                        _poi_priority(
                            poi,
                            center_lon=center_lon,
                            center_lat=center_lat,
                            vitality_score=vitality,
                        ),
                        5,
                    ),
                }
            )
        if queue:
            queues.append(queue)

    selected: List[Dict[str, Any]] = []
    while len(selected) < max_count:
        progressed = False
        for queue in queues:
            if not queue:
                continue
            selected.append(queue.pop(0))
            progressed = True
            if len(selected) >= max_count:
                break
        if not progressed:
            break

    if len(selected) < max_count:
        for poi in fallback_pois:
            poi_id = poi.get("id")
            stable_key = (poi_id, poi.get("lon"), poi.get("lat"), poi.get("name"))
            if stable_key in used_ids:
                continue
            used_ids.add(stable_key)
            selected.append(poi)
            if len(selected) >= max_count:
                break

    return selected[:max_count]


class SpatialPipeline:
    """鏍稿績娴佹按绾匡細鏌ヨ鍊欓€?-> 鑱氱被 -> 杈圭晫 -> membership -> 杈撳嚭浜嬩欢娴併€?"""

    def __init__(self, repository: POIRepository | None = None) -> None:
        self.repository = repository or POIRepository()

    def run(self, request: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        """鎵ц涓€娆＄┖闂翠换鍔″苟鎸佺画浜у嚭闃舵浜嬩欢銆?"""
        query_type = str(request.get("query_type") or "poi_search")
        spatial_context = _safe_json_loads(request.get("spatial_context"), {})
        categories = [str(cat).strip() for cat in (request.get("categories") or []) if str(cat).strip()]

        hints = _safe_json_loads(request.get("hints"), {})
        semantic_query = hints.get("semantic_query") or ""
        terms = [term.strip() for term in semantic_query.split() if term.strip()]

        hints_options = hints.get("options") if isinstance(hints.get("options"), dict) else {}
        source_policy = (
            hints_options.get("sourcePolicy")
            or hints_options.get("source_policy")
            or {}
        )

        if not categories and isinstance(source_policy, dict) and source_policy.get("has_category_filter"):
            selected = source_policy.get("selected_categories") or hints_options.get("selectedCategories") or []
            categories = [str(cat).strip() for cat in selected if str(cat).strip()]

        migration_hints = hints.get("migration") if isinstance(hints.get("migration"), dict) else {}
        py_data_source = str(migration_hints.get("py_data_source") or "python").lower()

        query_plan = hints.get("query_plan") if isinstance(hints.get("query_plan"), dict) else {}
        direction_hint = resolve_direction_from_query_plan(query_plan, semantic_query=semantic_query)
        anchor_hint = query_plan.get("anchor") if isinstance(query_plan, dict) else None
        need_graph_reasoning = bool(query_plan.get("need_graph_reasoning")) or query_type == "graph_reasoning"
        need_region_comparison = query_type == "region_comparison"
        region_context = hints_options.get("regions") if isinstance(hints_options.get("regions"), list) else []
        target_region_ids = query_plan.get("target_regions") if isinstance(query_plan.get("target_regions"), list) else []

        # 鍥剧粨鏋勬帹鐞嗕互绌洪棿鍏崇郴涓烘牳蹇冿紝閬垮厤璇箟鍒嗚瘝鎶婂€欓€夐泦璇繃婊や负绌恒€?
        if need_graph_reasoning and query_type == "graph_reasoning":
            terms = []

        if need_region_comparison:
            yield {
                "type": "STAGE",
                "payload": {
                    "stage": "region_comparison_prepare",
                    "query_type": query_type,
                },
            }

            region_analyses = analyze_region_set(
                regions=region_context,
                target_region_ids=target_region_ids,
                categories=categories,
                repository=self.repository,
            )
            comparison = compute_region_comparison(
                region_analyses,
                dimensions=query_plan.get("comparison_dimensions") if isinstance(query_plan.get("comparison_dimensions"), list) else [],
            )

            valid_regions = len(region_analyses)
            total_pois = sum(int(item.get("poi_count", 0)) for item in region_analyses)
            comparison_error = None
            if valid_regions < 2:
                comparison_error = "瀵规瘮鍒嗘瀽闇€瑕佽嚦灏?涓湁鏁堥€夊尯"
                comparison = None

            yield {
                "type": "PROGRESS",
                "payload": {
                    "stage": "region_comparison_prepare",
                    "progress": 0.6,
                    "requested_regions": len(target_region_ids),
                    "valid_regions": valid_regions,
                    "total_pois": total_pois,
                },
            }

            final_results = {
                "mode": "region_comparison",
                "target_regions": target_region_ids,
                "region_analyses": region_analyses,
                "comparison": comparison,
                "pois": [],
                "boundary": None,
                "spatial_clusters": {"hotspots": []},
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": _empty_graph_summary(),
                "stats": {
                    "query_type": query_type,
                    "requested_regions": len(target_region_ids),
                    "valid_regions": valid_regions,
                    "regions_analyzed": valid_regions,
                    "total_pois": total_pois,
                    "cluster_count": 0,
                    "cluster_engine": "none",
                    "noise_count": 0,
                    "h3_resolution": _dynamic_h3_resolution(_extract_area_km2(spatial_context)),
                    "h3_engine": "none",
                    "h3_cell_count": 0,
                    "candidate_source": "region_context",
                    "direction": None,
                    "direction_applied": False,
                    "boundary_method": "none",
                    "graph_component_count": 0,
                    "graph_edge_count": 0,
                    "fuzzy_core_count": 0,
                    "fuzzy_transition_count": 0,
                    "fuzzy_periphery_count": 0,
                },
            }

            if comparison_error:
                final_results["error"] = comparison_error

            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": final_results,
                    "diagnostics": {
                        "engine": "python-spatial-pipeline",
                        "query_type": query_type,
                        "requested_regions": len(target_region_ids),
                        "valid_regions": valid_regions,
                        "comparison_ready": comparison is not None,
                    },
                },
            }
            return

        graph_max_nodes = _resolve_limit(
            hints_options.get("graphMaxNodes"),
            default_value=280,
            max_value=1200,
        )
        graph_distance_threshold_m = float(hints_options.get("graphDistanceThresholdM") or 280.0)

        max_fetch_limit = _resolve_limit(hints_options.get("maxFetchLimit"), default_value=20000, max_value=500000)
        fetch_limit = _resolve_limit(hints_options.get("limit"), default_value=8000, max_value=max_fetch_limit)

        # ?????graph ???????? limit????????????????????????
        explicit_limit = hints_options.get("limit")
        if query_type == "graph_reasoning" and explicit_limit is None:
            fetch_limit = min(fetch_limit, max(600, graph_max_nodes * 3))

        # ???????? Node ????????????????????????
        db_order_by_distance = True

        yield {
            "type": "STAGE",
            "payload": {
                "stage": "fetch_candidates",
                "query_type": query_type,
                "fetch_limit": fetch_limit,
            },
        }

        raw_candidates = _safe_json_loads(request.get("candidates_json"), [])
        payload_candidates = _normalize_payload_candidates(raw_candidates)
        
        # Debug logging
        print(f"[PIPELINE_DEBUG] candidates_json present: {len(raw_candidates) > 0}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] payload_candidates count: {len(payload_candidates)}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] py_data_source: {py_data_source}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] spatial_context: {spatial_context}", flush=True, file=sys.stderr)

        candidate_source = "db"
        if payload_candidates and py_data_source in {"hybrid", "node"}:
            print(f"[PIPELINE_DEBUG] Using payload candidates (frontend POIs)", flush=True, file=sys.stderr)
            pois = _filter_payload_candidates(
                payload_candidates,
                spatial_context=spatial_context,
                categories=categories,
                terms=terms,
                limit=fetch_limit,
            )
            candidate_source = "payload"
        else:
            print(f"[PIPELINE_DEBUG] Using repository.fetch_pois (PostGIS)", flush=True, file=sys.stderr)
            pois = self.repository.fetch_pois(
                spatial_context=spatial_context,
                categories=categories,
                terms=terms,
                limit=fetch_limit,
                order_by_distance=db_order_by_distance,
            )
            print(f"[PIPELINE_DEBUG] fetch_pois returned {len(pois)} POIs", flush=True, file=sys.stderr)

        direction_applied = direction_hint is not None
        if direction_applied:
            pois = filter_pois_by_direction(
                pois,
                direction=direction_hint,
                anchor=anchor_hint,
                limit=fetch_limit,
            )

        graph_summary = (
            analyze_spatial_graph(
                pois,
                max_nodes=graph_max_nodes,
                distance_threshold_m=graph_distance_threshold_m,
            )
            if need_graph_reasoning
            else None
        )

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "fetch_candidates",
                "progress": 0.25,
                "poi_count": len(pois),
                "candidate_source": candidate_source,
                "direction": direction_hint,
                "direction_applied": direction_applied,
                "graph_enabled": need_graph_reasoning,
                "graph_nodes": graph_summary.get("node_count", 0) if graph_summary else 0,
            },
        }

        # Graph reasoning does not need expensive region modeling chain.
        # Return early to keep Python graph analysis responsive under large candidate sets.
        if query_type == "graph_reasoning":
            final_results = {
                "mode": "graph_reasoning",
                "pois": pois[:500],
                "boundary": None,
                "spatial_clusters": {"hotspots": []},
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": graph_summary or _empty_graph_summary(),
                "stats": {
                    "total_candidates": len(pois),
                    "cluster_count": 0,
                    "cluster_engine": "skipped_graph_only",
                    "noise_count": 0,
                    "h3_resolution": _dynamic_h3_resolution(_extract_area_km2(spatial_context)),
                    "h3_engine": "skipped_graph_only",
                    "h3_cell_count": 0,
                    "query_type": query_type,
                    "candidate_source": candidate_source,
                    "direction": direction_hint,
                    "direction_applied": direction_applied,
                    "boundary_method": "none",
                    "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                    "graph_edge_count": graph_summary.get("edge_count", 0) if graph_summary else 0,
                    "graph_max_nodes": graph_max_nodes,
                    "graph_distance_threshold_m": graph_distance_threshold_m,
                    "graph_fetch_limit": fetch_limit,
                },
            }

            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": final_results,
                    "diagnostics": {
                        "engine": "python-spatial-pipeline",
                        "query_type": query_type,
                        "candidate_source": candidate_source,
                        "source_policy": source_policy if isinstance(source_policy, dict) else {},
                        "direction": direction_hint,
                        "direction_applied": direction_applied,
                        "graph_enabled": need_graph_reasoning,
                        "graph_fast_path": True,
                    },
                },
            }
            return

        if query_type == "poi_fetch":
            final_results = {
                "mode": "poi_fetch",
                "pois": pois[:fetch_limit],
                "boundary": None,
                "spatial_clusters": {"hotspots": []},
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": _empty_graph_summary(),
                "stats": {
                    "total_candidates": len(pois),
                    "query_type": query_type,
                    "candidate_source": candidate_source,
                    "direction": direction_hint,
                    "direction_applied": direction_applied,
                    "fetch_limit": fetch_limit,
                },
            }

            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": final_results,
                    "diagnostics": {
                        "engine": "python-spatial-pipeline",
                        "query_type": query_type,
                        "fetch_limit": fetch_limit,
                        "candidate_source": candidate_source,
                        "source_policy": source_policy if isinstance(source_policy, dict) else {},
                    },
                },
            }
            return

        # 鏃犵粨鏋滄椂浠嶈繑鍥?FINAL锛屼繚鎸佸崗璁ǔ瀹氥€?
        if not pois:
            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": {
                        "mode": "python-spatial",
                        "pois": [],
                        "boundary": None,
                        "spatial_clusters": {"hotspots": []},
                        "vernacular_regions": [],
                        "fuzzy_regions": [],
                        "graph_reasoning": graph_summary or _empty_graph_summary(),
                        "stats": {
                            "total_candidates": 0,
                            "cluster_count": 0,
                            "cluster_engine": "none",
                            "noise_count": 0,
                            "h3_resolution": _dynamic_h3_resolution(_extract_area_km2(spatial_context)),
                            "h3_engine": "none",
                            "h3_cell_count": 0,
                            "candidate_source": candidate_source,
                            "direction": direction_hint,
                            "direction_applied": direction_applied,
                            "boundary_method": "none",
                            "boundary_methods": [],
                        },
                    },
                },
            }
            return

        coords: List[Tuple[float, float]] = [
            (float(poi["lon"]), float(poi["lat"])) for poi in pois if poi.get("lon") is not None and poi.get("lat") is not None
        ]

        # 鍏堢粰鍓嶇涓€涓€滆崏鍥捐竟鐣屸€濆仛娓愯繘浣撻獙銆?
        if len(coords) >= 3:
            # ??????????????????????????????????
            preview_coords = _sample_coordinates(coords, 3000)
            sketch_polygon = mapping(MultiPoint(preview_coords).convex_hull)
            yield {
                "type": "PARTIAL",
                "payload": {
                    "boundary": sketch_polygon,
                    "source": "convex_hull_preview",
                },
            }

        yield {
            "type": "STAGE",
            "payload": {"stage": "cluster"},
        }

        cluster_min_cluster_size = _resolve_limit(
            hints_options.get("clusterMinClusterSize"),
            default_value=12,
            max_value=300,
        )
        cluster_min_samples = _resolve_limit(
            hints_options.get("clusterMinSamples"),
            default_value=6,
            max_value=80,
        )
        cluster_max_hdbscan_points = _resolve_limit(
            hints_options.get("clusterMaxHdbscanPoints"),
            default_value=14000,
            max_value=120000,
        )
        cluster_adaptive = str(hints_options.get("clusterAdaptive", "true")).lower() not in {"false", "0", "off", "no"}

        cluster_result = cluster_points(
            coords,
            min_cluster_size=cluster_min_cluster_size,
            min_samples=cluster_min_samples,
            adaptive=cluster_adaptive,
            max_hdbscan_points=cluster_max_hdbscan_points,
        )
        labels = cluster_result.labels

        alpha_max_input_points = _resolve_limit(
            hints_options.get("alphaMaxInputPoints"),
            default_value=1200,
            max_value=5000,
        )

        grouped_indices: Dict[int, List[int]] = defaultdict(list)
        for idx, label in enumerate(labels):
            if label >= 0:
                grouped_indices[label].append(idx)

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "cluster",
                "progress": 0.55,
                "cluster_count": cluster_result.cluster_count,
                "cluster_engine": cluster_result.engine,
                "noise_count": cluster_result.noise_count,
                "cluster_effective_min_cluster_size": cluster_result.effective_min_cluster_size,
                "cluster_effective_min_samples": cluster_result.effective_min_samples,
            },
        }

        vernacular_regions = []
        fuzzy_regions = []
        hotspots = []
        boundary_methods: List[str] = []
        cluster_entries: List[Dict[str, Any]] = []

        # Build cluster-level surfaces and scores.
        for cluster_id, indices in grouped_indices.items():
            cluster_points_list = [coords[idx] for idx in indices]
            cluster_pois = [pois[idx] for idx in indices]

            center_lon = sum(lon for lon, _ in cluster_points_list) / len(cluster_points_list)
            center_lat = sum(lat for _, lat in cluster_points_list) / len(cluster_points_list)

            categories_counter = Counter(_category_of(poi) for poi in cluster_pois)
            top_category, top_count = categories_counter.most_common(1)[0]

            bbox_area_m2 = _calc_bbox_area(cluster_points_list)
            density = 0.0 if bbox_area_m2 <= 0 else min(1.0, (len(cluster_points_list) / (bbox_area_m2 / 10_000.0 + 1e-6)) / 20.0)
            purity = top_count / max(1, len(cluster_points_list))
            compactness = min(1.0, 1.0 / (1.0 + bbox_area_m2 / 200_000.0))
            centrality = min(1.0, len(cluster_points_list) / max(1.0, len(pois)))
            scale = min(1.0, math.log1p(len(cluster_points_list)) / math.log1p(max(2, len(pois))))

            membership = compute_membership(
                density=density,
                purity=purity,
                centrality=centrality,
                compactness=compactness,
                scale=scale,
            )

            boundary_selection = _build_cluster_boundary(
                cluster_points=cluster_points_list,
                bbox_area_m2=bbox_area_m2,
                density=density,
                alpha_max_input_points=alpha_max_input_points,
            )
            boundary_geojson = boundary_selection["boundary_geojson"]
            boundary_method = boundary_selection["boundary_method"]
            boundary_quality = boundary_selection["boundary_quality"]
            boundary_generation = boundary_selection["boundary_generation"]

            boundary_methods.append(boundary_method)

            layer_bundle = _build_region_layers(
                cluster_points=cluster_points_list,
                base_boundary_geojson=boundary_geojson,
                density=density,
                membership_score=float(membership.score),
            )
            boundary_conf = _build_boundary_confidence(
                layer_bundle=layer_bundle,
                membership_score=float(membership.score),
                boundary_method=boundary_method,
                boundary_quality_score=boundary_quality.get("quality_score"),
            )

            vitality_score = _calc_vitality_score(
                density=density,
                membership_score=float(membership.score),
                purity=purity,
                cluster_size=len(cluster_points_list),
                total_size=len(pois),
            )

            dominant_categories = [
                {"category": category, "count": int(count)}
                for category, count in categories_counter.most_common(3)
            ]

            cluster_entries.append(
                {
                    "id": int(cluster_id),
                    "name": f"{top_category}片区",
                    "theme": top_category,
                    "poi_count": len(cluster_points_list),
                    "center": {"lon": center_lon, "lat": center_lat},
                    "boundary_geojson": layer_bundle["representative_geojson"] or boundary_geojson,
                    "boundary": layer_bundle["representative_boundary"],
                    "layers": {
                        "outer": layer_bundle["outer"],
                        "transition": layer_bundle["transition"],
                        "core": layer_bundle["core"],
                    },
                    "dominant_category": top_category,
                    "dominant_categories": dominant_categories,
                    "membership": asdict(membership),
                    "density": round(density, 4),
                    "purity": round(purity, 4),
                    "vitality_score": vitality_score,
                    "boundary_method": boundary_method,
                    "boundary_quality": boundary_quality,
                    "boundary_generation": boundary_generation,
                    "boundary_confidence": boundary_conf["score"],
                    "confidence_explain": boundary_conf["explain"],
                    "score_breakdown": {
                        "density": membership.density,
                        "purity": membership.purity,
                        "centrality": membership.centrality,
                        "compactness": membership.compactness,
                        "scale": membership.scale,
                    },
                    "drivers": _top_membership_drivers(membership),
                    "cluster_pois": cluster_pois,
                }
            )

        cluster_entries.sort(key=lambda item: float(item.get("vitality_score", 0.0)), reverse=True)

        for entry in cluster_entries:
            vernacular_regions.append(
                {
                    "id": entry["id"],
                    "name": entry["name"],
                    "theme": entry["theme"],
                    "poi_count": entry["poi_count"],
                    "center": entry["center"],
                    "boundary": entry["boundary_geojson"],
                    "boundary_ring": entry["boundary"],
                    "layers": entry["layers"],
                    "dominant_category": entry["dominant_category"],
                    "dominant_categories": entry["dominant_categories"],
                    "membership": entry["membership"],
                    "vitality_score": entry["vitality_score"],
                    "boundary_method": entry["boundary_method"],
                    "boundary_quality": entry["boundary_quality"],
                    "boundary_generation": entry["boundary_generation"],
                    "boundary_confidence": entry["boundary_confidence"],
                    "confidence_explain": entry["confidence_explain"],
                }
            )

            fuzzy_regions.append(
                {
                    "id": entry["id"],
                    "name": entry["name"],
                    "theme": entry["theme"],
                    "score": entry["membership"].get("score", 0.0),
                    "level": entry["membership"].get("level", "transition"),
                    "boundary": entry["boundary_geojson"],
                    "boundary_ring": entry["boundary"],
                    "center": entry["center"],
                    "layers": entry["layers"],
                    "pointCount": entry["poi_count"],
                    "dominantCategories": entry["dominant_categories"],
                    "vitalityScore": entry["vitality_score"],
                    "boundary_method": entry["boundary_method"],
                    "boundary_quality": entry["boundary_quality"],
                    "boundary_generation": entry["boundary_generation"],
                    "boundary_confidence": entry["boundary_confidence"],
                    "confidence_explain": entry["confidence_explain"],
                    "score_breakdown": entry["score_breakdown"],
                    "drivers": entry["drivers"],
                }
            )

            hotspots.append(
                {
                    "id": entry["id"],
                    "name": entry["name"],
                    "center": entry["center"],
                    "poiCount": entry["poi_count"],
                    "density": entry["density"],
                    "vitalityScore": entry["vitality_score"],
                    "boundary": entry["boundary"],
                    "boundary_geojson": entry["boundary_geojson"],
                    "layers": entry["layers"],
                    "dominantCategories": entry["dominant_categories"],
                    "boundary_method": entry["boundary_method"],
                    "boundary_quality": entry["boundary_quality"],
                    "boundary_generation": entry["boundary_generation"],
                    "boundary_confidence": entry["boundary_confidence"],
                    "confidence_explain": entry["confidence_explain"],
                }
            )

        noise_pois = [
            pois[idx]
            for idx, label in enumerate(labels)
            if label < 0 and idx < len(pois)
        ]

        representative_pois = _build_representative_pois(
            cluster_entries=cluster_entries,
            fallback_pois=noise_pois or pois,
            max_count=min(500, len(pois)),
        )
        area_km2 = _extract_area_km2(spatial_context)
        h3_resolution = _dynamic_h3_resolution(area_km2)
        h3_summary = aggregate_pois_h3(
            pois,
            resolution=h3_resolution,
            max_cells=120 if query_type == "area_analysis" else 60,
        )

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "region_modeling",
                "progress": 0.85,
                "vernacular_count": len(vernacular_regions),
            },
        }

        fuzzy_summary = {
            "core": len([region for region in fuzzy_regions if region.get("level") == "core"]),
            "transition": len([region for region in fuzzy_regions if region.get("level") == "transition"]),
            "periphery": len([region for region in fuzzy_regions if region.get("level") == "periphery"]),
        }
        boundary_conf_values = [
            float(entry.get("boundary_confidence", 0.0))
            for entry in cluster_entries
            if entry.get("boundary_confidence") is not None
        ]
        boundary_quality_values = [
            float((entry.get("boundary_quality") or {}).get("quality_score", 0.0))
            for entry in cluster_entries
            if (entry.get("boundary_quality") or {}).get("quality_score") is not None
        ]
        boundary_coverage_values = [
            float((entry.get("boundary_quality") or {}).get("coverage_ratio", 0.0))
            for entry in cluster_entries
            if (entry.get("boundary_quality") or {}).get("coverage_ratio") is not None
        ]
        boundary_quality_pass_count = sum(
            1
            for entry in cluster_entries
            if bool((entry.get("boundary_quality") or {}).get("pass"))
        )
        boundary_iteration_values = [
            int((entry.get("boundary_generation") or {}).get("attempts", 1))
            for entry in cluster_entries
        ]
        avg_boundary_conf = round(sum(boundary_conf_values) / len(boundary_conf_values), 4) if boundary_conf_values else 0.0
        avg_boundary_quality_score = (
            round(sum(boundary_quality_values) / len(boundary_quality_values), 4)
            if boundary_quality_values
            else 0.0
        )
        avg_boundary_coverage = (
            round(sum(boundary_coverage_values) / len(boundary_coverage_values), 4)
            if boundary_coverage_values
            else 0.0
        )
        boundary_quality_pass_rate = (
            round(boundary_quality_pass_count / len(cluster_entries), 4)
            if cluster_entries
            else 0.0
        )
        avg_boundary_iterations = (
            round(sum(boundary_iteration_values) / len(boundary_iteration_values), 3)
            if boundary_iteration_values
            else 0.0
        )

        final_results = {
            "mode": "python-spatial",
            "pois": representative_pois,
            "boundary": vernacular_regions[0]["boundary"] if vernacular_regions else None,
            "spatial_clusters": {
                "hotspots": hotspots[:5],
                "h3_summary": h3_summary.get("cells", [])[:20],
            },
            "vernacular_regions": vernacular_regions[:10],
            "fuzzy_regions": fuzzy_regions[:10],
            "fuzzy_summary": fuzzy_summary,
            "graph_reasoning": graph_summary or _empty_graph_summary(),
            "stats": {
                "total_candidates": len(pois),
                "cluster_count": len(vernacular_regions),
                "cluster_engine": cluster_result.engine,
                "noise_count": cluster_result.noise_count,
                "cluster_effective_min_cluster_size": cluster_result.effective_min_cluster_size,
                "cluster_effective_min_samples": cluster_result.effective_min_samples,
                "cluster_input_point_count": cluster_result.input_point_count,
                "h3_resolution": h3_resolution,
                "h3_engine": h3_summary.get("engine", "none"),
                "h3_cell_count": len(h3_summary.get("cells", [])),
                "query_type": query_type,
                "candidate_source": candidate_source,
                "direction": direction_hint,
                "direction_applied": direction_applied,
                "boundary_method": boundary_methods[0] if len(set(boundary_methods)) == 1 and boundary_methods else "mixed",
                "boundary_confidence_model": "composite_v1",
                "avg_boundary_confidence": avg_boundary_conf,
                "min_boundary_confidence": round(min(boundary_conf_values), 4) if boundary_conf_values else 0.0,
                "max_boundary_confidence": round(max(boundary_conf_values), 4) if boundary_conf_values else 0.0,
                "boundary_quality_model": "coverage_area_compactness_v1",
                "avg_boundary_quality_score": avg_boundary_quality_score,
                "avg_boundary_coverage": avg_boundary_coverage,
                "boundary_quality_pass_rate": boundary_quality_pass_rate,
                "avg_boundary_iterations": avg_boundary_iterations,
                "alpha_max_input_points": alpha_max_input_points,
                "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                "graph_edge_count": graph_summary.get("edge_count", 0) if graph_summary else 0,
                "fuzzy_core_count": fuzzy_summary["core"],
                "fuzzy_transition_count": fuzzy_summary["transition"],
                "fuzzy_periphery_count": fuzzy_summary["periphery"],
            },
        }

        yield {
            "type": "FINAL",
            "payload": {
                "success": True,
                "results": final_results,
                "diagnostics": {
                    "engine": "python-spatial-pipeline",
                    "query_type": query_type,
                    "h3_engine": h3_summary.get("engine", "none"),
                    "input_area_km2": round(area_km2, 3),
                    "candidate_source": candidate_source,
                    "source_policy": source_policy if isinstance(source_policy, dict) else {},
                    "direction": direction_hint,
                    "direction_applied": direction_applied,
                    "boundary_methods": boundary_methods,
                    "graph_enabled": need_graph_reasoning,
                    "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                },
            },
        }

