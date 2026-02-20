# -*- coding: utf-8 -*-
"""Python 空间计算管线。"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import asdict
from numbers import Integral
from typing import Any, Dict, Iterable, Iterator, List, Tuple

from shapely.geometry import MultiPoint, Point, Polygon, mapping, shape
from shapely.prepared import prep
from shapely.strtree import STRtree

from algorithms.alpha_shape import build_alpha_shape
from algorithms.geo_metrics import (
    bbox_area_m2,
    haversine_km,
    meters_per_degree_lat,
    meters_per_degree_lon,
    nearest_point_and_distance_m,
    polygon_area_km2,
    polygon_perimeter_km,
)
from algorithms.direction_filter import filter_pois_by_direction, resolve_direction_from_query_plan
from algorithms.h3_aggregate import aggregate_pois_h3
from algorithms.graph_reasoning import analyze_spatial_graph
from algorithms.hdbscan_cluster import cluster_points
from algorithms.membership import compute_membership
from algorithms.region_comparison import analyze_region_set, compute_region_comparison
from db.repository import POIRepository
from pipeline import (
    block_assembler,
    boundary_builder,
    confidence_scorer,
    context_loader,
    poi_quality_scorer,
    result_assembler,
    semantic_reasoner,
    self_validator,
    spatial_knowledge_graph,
    vlm_reviewer,
)


def _safe_json_loads(raw: Any, fallback: Any) -> Any:
    """注释说明。"""
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
    """注释说明。"""
    return (
        poi.get("category_small")
        or poi.get("category_mid")
        or poi.get("category_big")
        or poi.get("type")
        or "unknown"
    )


def _calc_bbox_area(points: Iterable[Tuple[float, float]]) -> float:
    """注释说明。"""
    return bbox_area_m2(points)


def _dynamic_h3_resolution(area_km2: float) -> int:
    """注释说明。"""
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
    """注释说明。"""
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
        mean_lat = (max_lat + min_lat) * 0.5
        width_km = abs(max_lon - min_lon) * meters_per_degree_lon(mean_lat) / 1000.0
        height_km = abs(max_lat - min_lat) * meters_per_degree_lat(mean_lat) / 1000.0
        return max(0.0, width_km * height_km)

    return 0.0


def _to_float(value: Any) -> float | None:
    """注释说明。"""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_payload_poi(raw: Any) -> Dict[str, Any] | None:
    """注释说明。"""
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
    """注释说明。"""
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
    """注释说明。"""
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

                # 注释说明
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


def _build_spatial_constraint_polygon(spatial_context: Dict[str, Any]) -> Polygon | None:
    """注释说明。"""
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
            if isinstance(polygon, Polygon) and not polygon.is_empty:
                return polygon

    viewport = spatial_context.get("viewport")
    if isinstance(viewport, list) and len(viewport) >= 4:
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
        except (TypeError, ValueError):
            min_lon = min_lat = max_lon = max_lat = 0.0
        if max_lon > min_lon and max_lat > min_lat:
            return Polygon(
                [
                    (min_lon, min_lat),
                    (max_lon, min_lat),
                    (max_lon, max_lat),
                    (min_lon, max_lat),
                    (min_lon, min_lat),
                ]
            )

    center = spatial_context.get("center")
    radius_m = _to_float(spatial_context.get("radius"))
    if isinstance(center, dict) and radius_m and radius_m > 0:
        center_lon = _to_float(center.get("lon", center.get("lng", center.get("longitude"))))
        center_lat = _to_float(center.get("lat", center.get("latitude")))
        if center_lon is not None and center_lat is not None:
            lat_scale = meters_per_degree_lat(center_lat)
            lon_scale = meters_per_degree_lon(center_lat)
            if lat_scale > 0 and lon_scale > 0:
                ring: List[Tuple[float, float]] = []
                for step in range(0, 48):
                    theta = 2.0 * math.pi * (step / 48.0)
                    dlon = (math.cos(theta) * radius_m) / lon_scale
                    dlat = (math.sin(theta) * radius_m) / lat_scale
                    ring.append((center_lon + dlon, center_lat + dlat))
                ring.append(ring[0])
                return Polygon(ring)

    return None


def _clip_polygon_to_constraint(polygon: Polygon | None, constraint_polygon: Polygon | None) -> Polygon | None:
    """注释说明。"""
    if polygon is None or polygon.is_empty or constraint_polygon is None or constraint_polygon.is_empty:
        return polygon

    try:
        clipped = polygon.intersection(constraint_polygon)
    except Exception:
        return polygon

    clipped_polygon = _to_surface_polygon(clipped)
    if clipped_polygon is None or clipped_polygon.is_empty:
        return None
    return clipped_polygon


def _clip_boundary_geojson_to_constraint(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    constraint_polygon: Polygon | None,
) -> Dict[str, Any]:
    """注释说明。"""
    if constraint_polygon is None or constraint_polygon.is_empty:
        return {
            "boundary_geojson": boundary_geojson,
            "clip": {"applied": False},
        }

    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return {
            "boundary_geojson": boundary_geojson,
            "clip": {"applied": False},
        }

    clipped_polygon = _clip_polygon_to_constraint(polygon, constraint_polygon)
    if clipped_polygon is None or clipped_polygon.is_empty:
        return {
            "boundary_geojson": boundary_geojson,
            "clip": {"applied": False},
        }

    area_before = _polygon_area_km2(polygon)
    area_after = _polygon_area_km2(clipped_polygon)
    changed = not polygon.equals_exact(clipped_polygon, tolerance=1e-10)
    return {
        "boundary_geojson": mapping(clipped_polygon),
        "clip": {
            "applied": bool(changed),
            "area_ratio": round(_clamp01(area_after / area_before) if area_before > 0 else 0.0, 4),
            "area_km2_before": round(area_before, 6),
            "area_km2_after": round(area_after, 6),
        },
    }


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """注释说明。"""
    return haversine_km(lat1, lon1, lat2, lon2)


def _sample_coordinates(coords: List[Tuple[float, float]], max_points: int) -> List[Tuple[float, float]]:
    """注释说明。"""
    if max_points <= 0 or len(coords) <= max_points:
        return coords

    # 注释说明
    step = max(1, len(coords) // max_points)
    sampled = coords[::step]

    if sampled and sampled[-1] != coords[-1]:
        sampled = sampled + [coords[-1]]

    if len(sampled) > max_points:
        sampled = sampled[:max_points]

    return sampled


def _top_membership_drivers(membership, top_n: int = 2) -> List[Dict[str, Any]]:
    """注释说明。"""
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


def _infer_semantic_anchor(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_category: str,
    llm_anchor_candidates: List[str] | None = None,
) -> Dict[str, Any]:
    return semantic_reasoner.infer_semantic_anchor(
        cluster_pois=cluster_pois,
        dominant_category=dominant_category,
        llm_anchor_candidates=llm_anchor_candidates,
    )


def _recover_waterbody_anchor(
    *,
    cluster_pois: List[Dict[str, Any]],
    semantic_anchor: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.recover_waterbody_anchor(
        cluster_pois=cluster_pois,
        semantic_anchor=semantic_anchor,
        landuse_context=landuse_context,
    )


def _landuse_label_text(properties: Any) -> str:
    return semantic_reasoner.landuse_label_text(properties)


def _niche_type_from_landuse_label(label_text: str) -> str:
    return semantic_reasoner.niche_type_from_landuse_label(label_text)


def _cluster_landuse_semantic_context(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    semantic_features: List[Dict[str, Any]],
) -> Dict[str, Any]:
    return semantic_reasoner.cluster_landuse_semantic_context(
        boundary_geojson=boundary_geojson,
        cluster_points=cluster_points,
        semantic_features=semantic_features,
        polygon_from_geojson=_polygon_from_geojson,
    )


def _build_niche_profile(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_category: str,
    semantic_anchor: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.build_niche_profile(
        cluster_pois=cluster_pois,
        dominant_category=dominant_category,
        semantic_anchor=semantic_anchor,
        landuse_context=landuse_context,
        category_of=_category_of,
    )


def _apply_water_overlap_penalty(
    *,
    boundary_quality: Dict[str, Any],
    niche_profile: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.apply_water_overlap_penalty(
        boundary_quality=boundary_quality,
        niche_profile=niche_profile,
        landuse_context=landuse_context,
    )


def _build_semantic_reasoning_payload(
    *,
    semantic_anchor: Dict[str, Any],
    niche_profile: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.build_semantic_reasoning_payload(
        semantic_anchor=semantic_anchor,
        niche_profile=niche_profile,
        landuse_context=landuse_context,
    )


def _is_valid_lon_lat(lon: float | None, lat: float | None) -> bool:
    return poi_quality_scorer.is_valid_lon_lat(lon, lat)


def _poi_point_quality_score(poi: Dict[str, Any]) -> float:
    return poi_quality_scorer.poi_point_quality_score(poi)


def _cluster_poi_quality(cluster_pois: List[Dict[str, Any]]) -> Dict[str, Any]:
    return poi_quality_scorer.cluster_poi_quality(cluster_pois)


def _normalize_road_geometries(rows: List[Dict[str, Any]]) -> List[Any]:
    return context_loader.normalize_road_geometries(
        rows=rows,
        safe_json_loads=_safe_json_loads,
    )


def _sample_polygon_boundary_coords(
    polygon: Polygon,
    *,
    min_samples: int = 10,
    max_samples: int = 48,
) -> List[Tuple[float, float]]:
    """注释说明。"""
    ring = list(polygon.exterior.coords)
    if len(ring) < 4:
        return []

    usable = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    sample_count = max(min_samples, min(max_samples, len(usable)))
    if len(usable) <= sample_count:
        return [(float(x), float(y)) for x, y in usable]

    step = len(usable) / float(sample_count)
    sampled = [usable[min(int(i * step), len(usable) - 1)] for i in range(sample_count)]
    return [(float(x), float(y)) for x, y in sampled]


def _landuse_boundary_weight(properties: Any) -> float:
    return context_loader.landuse_boundary_weight(
        properties=properties,
        safe_json_loads=_safe_json_loads,
    )


def _normalize_landuse_geometries(rows: List[Dict[str, Any]]) -> Dict[str, List[Any]]:
    return context_loader.normalize_landuse_geometries(
        rows=rows,
        safe_json_loads=_safe_json_loads,
        clamp01=_clamp01,
        landuse_label_text=_landuse_label_text,
        niche_type_from_landuse_label=_niche_type_from_landuse_label,
    )


def _compute_road_alignment_score(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    road_index: STRtree | None,
    road_geometries: List[Any] | None,
) -> float | None:
    """
    注释说明。
    注释说明。
    """
    if road_index is None or not road_geometries:
        return None

    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return None

    sampled = _sample_polygon_boundary_coords(polygon, min_samples=10, max_samples=48)
    if not sampled:
        return None

    distances_m: List[float] = []
    for x, y in sampled:
        point = Point(x, y)
        try:
            nearest_ref = road_index.nearest(point)
        except Exception:
            continue

        if nearest_ref is None:
            continue

        try:
            if isinstance(nearest_ref, Integral):
                nearest_geom = road_geometries[int(nearest_ref)]
            else:
                nearest_geom = nearest_ref
        except Exception:
            continue

        _, distance_m = nearest_point_and_distance_m(point, nearest_geom)
        if distance_m is None:
            continue
        distances_m.append(float(distance_m))

    if not distances_m:
        return None

    sorted_distances = sorted(distances_m)
    mid = len(sorted_distances) // 2
    if len(sorted_distances) % 2 == 1:
        median_distance = sorted_distances[mid]
    else:
        median_distance = (sorted_distances[mid - 1] + sorted_distances[mid]) / 2.0

    near_ratio = len([dist for dist in distances_m if dist <= 35.0]) / len(distances_m)
    median_component = _clamp01(1.0 - min(median_distance, 220.0) / 220.0)

    return round(_clamp01(0.68 * median_component + 0.32 * near_ratio), 4)


def _compute_landuse_alignment_score(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    landuse_index: STRtree | None,
    landuse_geometries: List[Any] | None,
    landuse_weights: List[float] | None,
) -> float | None:
    """
    注释说明。
    注释说明。
    """
    if landuse_index is None or not landuse_geometries:
        return None

    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return None

    sampled = _sample_polygon_boundary_coords(polygon, min_samples=12, max_samples=60)
    if not sampled:
        return None

    distances_m: List[float] = []
    sampled_weights: List[float] = []

    for x, y in sampled:
        point = Point(x, y)
        try:
            nearest_ref = landuse_index.nearest(point)
        except Exception:
            continue

        if nearest_ref is None:
            continue

        nearest_geom: Any | None = None
        nearest_weight = 0.72

        try:
            if isinstance(nearest_ref, Integral):
                nearest_idx = int(nearest_ref)
                nearest_geom = landuse_geometries[nearest_idx]
                if landuse_weights and 0 <= nearest_idx < len(landuse_weights):
                    nearest_weight = _clamp01(float(landuse_weights[nearest_idx]))
            else:
                nearest_geom = nearest_ref
        except Exception:
            continue

        if nearest_geom is None:
            continue

        _, distance_m = nearest_point_and_distance_m(point, nearest_geom)
        if distance_m is None:
            continue
        distances_m.append(float(distance_m))
        sampled_weights.append(nearest_weight)

    if not distances_m:
        return None

    sorted_distances = sorted(distances_m)
    mid = len(sorted_distances) // 2
    if len(sorted_distances) % 2 == 1:
        median_distance = sorted_distances[mid]
    else:
        median_distance = (sorted_distances[mid - 1] + sorted_distances[mid]) / 2.0

    near_ratio = len([dist for dist in distances_m if dist <= 45.0]) / len(distances_m)
    median_component = _clamp01(1.0 - min(median_distance, 260.0) / 260.0)
    weight_component = sum(sampled_weights) / len(sampled_weights) if sampled_weights else 0.72

    return round(_clamp01(0.58 * median_component + 0.27 * near_ratio + 0.15 * _clamp01(weight_component)), 4)


def _resolve_nearest_geometry(
    *,
    point: Point,
    geometry_index: STRtree | None,
    geometries: List[Any] | None,
) -> Any | None:
    """注释说明。"""
    if geometry_index is None or not geometries:
        return None

    try:
        nearest_ref = geometry_index.nearest(point)
    except Exception:
        return None

    if nearest_ref is None:
        return None

    try:
        if isinstance(nearest_ref, Integral):
            nearest_idx = int(nearest_ref)
            if 0 <= nearest_idx < len(geometries):
                return geometries[nearest_idx]
            return None
    except Exception:
        return None

    return nearest_ref


def _snap_polygon_to_linear_context(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    road_index: STRtree | None,
    road_geometries: List[Any] | None,
    landuse_index: STRtree | None,
    landuse_geometries: List[Any] | None,
) -> Dict[str, Any] | None:
    """
    注释说明。
    注释说明。
    """
    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return None

    has_road_context = road_index is not None and bool(road_geometries)
    has_landuse_context = landuse_index is not None and bool(landuse_geometries)
    if not has_road_context and not has_landuse_context:
        return None

    sampled = _sample_polygon_boundary_coords(polygon, min_samples=20, max_samples=120)
    if len(sampled) < 8:
        return None

    span = max(_cluster_span_deg(cluster_points), max(polygon.bounds[2] - polygon.bounds[0], polygon.bounds[3] - polygon.bounds[1]))
    mean_lat = float(polygon.centroid.y)
    degree_scale_m = max(meters_per_degree_lon(mean_lat), meters_per_degree_lat(mean_lat), 1.0)
    span_m = span * degree_scale_m
    snap_distance_m = max(8.0, min(120.0, span_m * 0.30))
    snap_distance_deg = snap_distance_m / degree_scale_m
    min_snap_count = max(3, int(len(sampled) * 0.10))

    snapped_coords: List[Tuple[float, float]] = []
    snap_count = 0
    road_snap_count = 0
    landuse_snap_count = 0

    for x, y in sampled:
        point = Point(float(x), float(y))
        best_distance = None
        best_coord = None
        best_source = ""

        if has_road_context:
            nearest_road = _resolve_nearest_geometry(
                point=point,
                geometry_index=road_index,
                geometries=road_geometries,
            )
            if nearest_road is not None and not nearest_road.is_empty:
                try:
                    projected_coord, distance = nearest_point_and_distance_m(point, nearest_road)
                    if projected_coord is not None and distance is not None and distance <= snap_distance_m:
                        best_distance = float(distance)
                        best_coord = projected_coord
                        best_source = "road"
                except Exception:
                    pass

        if has_landuse_context:
            nearest_landuse = _resolve_nearest_geometry(
                point=point,
                geometry_index=landuse_index,
                geometries=landuse_geometries,
            )
            if nearest_landuse is not None and not nearest_landuse.is_empty:
                try:
                    projected_coord, distance = nearest_point_and_distance_m(point, nearest_landuse)
                    if (
                        projected_coord is not None
                        and distance is not None
                        and distance <= snap_distance_m
                        and (best_distance is None or distance < best_distance)
                    ):
                        best_distance = float(distance)
                        best_coord = projected_coord
                        best_source = "landuse"
                except Exception:
                    pass

        if best_coord is not None:
            snapped_coords.append(best_coord)
            snap_count += 1
            if best_source == "road":
                road_snap_count += 1
            elif best_source == "landuse":
                landuse_snap_count += 1
        else:
            snapped_coords.append((float(x), float(y)))

    if snap_count < min_snap_count:
        return None

    if snapped_coords[0] != snapped_coords[-1]:
        snapped_coords.append(snapped_coords[0])

    try:
        snapped_polygon = Polygon(snapped_coords).buffer(0)
    except Exception:
        return None

    snapped_polygon = _as_polygon(snapped_polygon)
    if snapped_polygon is None or snapped_polygon.is_empty:
        return None

    original_area = max(float(polygon.area), 1e-12)
    area_ratio = float(snapped_polygon.area) / original_area
    if area_ratio < 0.22 or area_ratio > 2.20:
        return None

    smooth_distance = snap_distance_deg * 0.30
    if smooth_distance > 0:
        try:
            smoothed = snapped_polygon.buffer(smooth_distance).buffer(-smooth_distance)
            smoothed = _as_polygon(smoothed.buffer(0))
            if smoothed is not None and not smoothed.is_empty:
                snapped_polygon = smoothed
        except Exception:
            pass

    prepared_polygon = prep(snapped_polygon)
    inside_count = sum(
        1
        for lon, lat in cluster_points
        if prepared_polygon.covers(Point(float(lon), float(lat)))
    )
    coverage_ratio = inside_count / max(1, len(cluster_points))
    if coverage_ratio < 0.54:
        return None

    return {
        "geojson": mapping(snapped_polygon),
        "model": "road_landuse_snap_v1",
        "snap_distance_m": round(float(snap_distance_m), 1),
        "sampled_vertices": int(len(sampled)),
        "snapped_vertices": int(snap_count),
        "road_snap_vertices": int(road_snap_count),
        "landuse_snap_vertices": int(landuse_snap_count),
        "coverage_ratio": round(float(coverage_ratio), 4),
        "area_ratio_to_original": round(float(area_ratio), 4),
    }


def _empty_graph_summary() -> Dict[str, Any]:
    """注释说明。"""
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
    """注释说明。"""
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
    """注释说明。"""
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = default_value

    if parsed <= 0:
        parsed = default_value

    return max(1, min(parsed, max_value))


def _option_enabled(raw_value: Any, *, default_value: bool = False) -> bool:
    """解析布尔开关（兼容 true/false、1/0、on/off）。"""
    if raw_value is None:
        return default_value
    normalized = str(raw_value).strip().lower()
    if not normalized:
        return default_value
    if normalized in {"1", "true", "yes", "on", "y"}:
        return True
    if normalized in {"0", "false", "no", "off", "n"}:
        return False
    return default_value


def _as_polygon(geometry: Any) -> Polygon | None:
    """注释说明。"""
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
    """注释说明。"""
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
    注释说明。
    注释说明。
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
    注释说明。
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
    """注释说明。"""
    if not isinstance(boundary_geojson, dict):
        return None

    try:
        geometry = shape(boundary_geojson)
    except Exception:
        return None

    geometry = geometry.buffer(0)
    return _to_surface_polygon(geometry, cluster_points=cluster_points)


def _polygon_ring(polygon: Polygon | None) -> List[List[float]]:
    """注释说明。"""
    if polygon is None or polygon.is_empty:
        return []

    return [[float(x), float(y)] for x, y in polygon.exterior.coords]


def _polygon_area_km2(polygon: Polygon | None) -> float:
    """注释说明。"""
    return polygon_area_km2(polygon)


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
    constraint_polygon: Polygon | None = None,
) -> Dict[str, Any]:
    return boundary_builder.build_region_layers(
        cluster_points=cluster_points,
        base_boundary_geojson=base_boundary_geojson,
        density=density,
        membership_score=membership_score,
        constraint_polygon=constraint_polygon,
        polygon_from_geojson=_polygon_from_geojson,
        to_surface_polygon=_to_surface_polygon,
        as_polygon=_as_polygon,
        clip_polygon_to_constraint=_clip_polygon_to_constraint,
        polygon_area_km2=_polygon_area_km2,
        clamp01=_clamp01,
    )


def _calc_vitality_score(
    *,
    density: float,
    membership_score: float,
    purity: float,
    cluster_size: int,
    total_size: int,
    ) -> float:
    """注释说明。"""
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
    return confidence_scorer.boundary_method_confidence(boundary_method)


def _score_boundary_quality(
    *,
    cluster_points: List[Tuple[float, float]],
    boundary_geojson: Dict[str, Any],
    road_alignment_score: float | None = None,
    landuse_alignment_score: float | None = None,
) -> Dict[str, Any]:
    return boundary_builder.score_boundary_quality(
        cluster_points=cluster_points,
        boundary_geojson=boundary_geojson,
        road_alignment_score=road_alignment_score,
        landuse_alignment_score=landuse_alignment_score,
        polygon_from_geojson=_polygon_from_geojson,
        to_surface_polygon=_to_surface_polygon,
        polygon_area_km2=_polygon_area_km2,
        polygon_perimeter_km=polygon_perimeter_km,
        clamp01=_clamp01,
    )


def _build_cluster_boundary(
    *,
    cluster_points: List[Tuple[float, float]],
    bbox_area_m2: float,
    density: float,
    alpha_max_input_points: int,
    road_index: STRtree | None = None,
    road_geometries: List[Any] | None = None,
    landuse_index: STRtree | None = None,
    landuse_geometries: List[Any] | None = None,
    landuse_weights: List[float] | None = None,
) -> Dict[str, Any]:
    return boundary_builder.build_cluster_boundary(
        cluster_points=cluster_points,
        bbox_area_m2=bbox_area_m2,
        density=density,
        alpha_max_input_points=alpha_max_input_points,
        road_index=road_index,
        road_geometries=road_geometries,
        landuse_index=landuse_index,
        landuse_geometries=landuse_geometries,
        landuse_weights=landuse_weights,
        build_alpha_shape_func=build_alpha_shape,
        compute_road_alignment_score_func=_compute_road_alignment_score,
        compute_landuse_alignment_score_func=_compute_landuse_alignment_score,
        score_boundary_quality_func=_score_boundary_quality,
        snap_polygon_to_linear_context_func=_snap_polygon_to_linear_context,
        to_surface_polygon_func=_to_surface_polygon,
    )


def _build_boundary_confidence(
    *,
    layer_bundle: Dict[str, Any],
    membership_score: float,
    boundary_method: str,
    boundary_quality_score: float | None = None,
    poi_quality_score: float | None = None,
    semantic_anchor_confidence: float | None = None,
    niche_consistency_score: float | None = None,
    visual_morphology_confidence: float | None = None,
    self_validation_confidence: float | None = None,
    skg_consistency_score: float | None = None,
    ) -> Dict[str, Any]:
    return confidence_scorer.build_boundary_confidence(
        layer_bundle=layer_bundle,
        membership_score=membership_score,
        boundary_method=boundary_method,
        boundary_quality_score=boundary_quality_score,
        poi_quality_score=poi_quality_score,
        semantic_anchor_confidence=semantic_anchor_confidence,
        niche_consistency_score=niche_consistency_score,
        visual_morphology_confidence=visual_morphology_confidence,
        self_validation_confidence=self_validation_confidence,
        skg_consistency_score=skg_consistency_score,
    )


def _review_cluster_morphology(
    *,
    spatial_context: Dict[str, Any],
    boundary_geojson: Dict[str, Any] | None,
    boundary_quality: Dict[str, Any] | None,
    poi_count: int,
    model_name: str,
    endpoint: str,
    image_data_url: str | None,
    enable_remote: bool,
    timeout_ms: int,
) -> Dict[str, Any]:
    return vlm_reviewer.review_cluster_morphology(
        spatial_context=spatial_context,
        boundary_geojson=boundary_geojson,
        boundary_quality=boundary_quality,
        poi_count=poi_count,
        model_name=model_name,
        endpoint=endpoint,
        image_data_url=image_data_url,
        enable_remote=enable_remote,
        timeout_ms=timeout_ms,
    )


def _validate_cluster_entries(cluster_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    return self_validator.validate_cluster_entries(cluster_entries)


def _build_spatial_knowledge_graph(cluster_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    return spatial_knowledge_graph.build_spatial_knowledge_graph(cluster_entries)


def _poi_priority(
    poi: Dict[str, Any],
    *,
    center_lon: float,
    center_lat: float,
    vitality_score: float,
) -> float:
    """注释说明。"""
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
    注释说明。
    注释说明。
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


def _build_region_views(*, cluster_entries: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    return result_assembler.build_region_views(cluster_entries=cluster_entries)


def _summarize_cluster_entries(
    *,
    cluster_entries: List[Dict[str, Any]],
    fuzzy_regions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    return result_assembler.summarize_cluster_entries(
        cluster_entries=cluster_entries,
        fuzzy_regions=fuzzy_regions,
    )


class SpatialPipeline:
    """注释说明。"""

    def __init__(self, repository: POIRepository | None = None) -> None:
        self.repository = repository or POIRepository()

    def run(self, request: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        """注释说明。"""
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
        requested_confidence_model = str(
            hints_options.get("confidenceModel") or hints_options.get("confidence_model") or ""
        ).strip().lower()
        force_composite_v4 = requested_confidence_model == "composite_v4"
        force_composite_v5 = requested_confidence_model == "composite_v5"

        visual_review_enabled = force_composite_v4 or force_composite_v5 or _option_enabled(
            hints_options.get("visualReviewEnabled"), default_value=False
        )
        visual_remote_enabled = visual_review_enabled and _option_enabled(
            hints_options.get("visualRemoteEnabled"), default_value=False
        )
        self_validation_enabled = force_composite_v4 or force_composite_v5 or _option_enabled(
            hints_options.get("selfValidationEnabled"), default_value=False
        )
        skg_enabled = force_composite_v4 or force_composite_v5 or _option_enabled(
            hints_options.get("skgEnabled"), default_value=False
        )
        visual_model_name = str(hints_options.get("visualModel") or "qwen3-vl-4b")
        visual_endpoint = str(
            hints_options.get("visualEndpoint") or "http://localhost:1234/v1/chat/completions"
        )
        visual_image_data_url = hints_options.get("visualSnapshotDataUrl") or hints_options.get("mapSnapshotDataUrl")
        visual_timeout_ms = _resolve_limit(
            hints_options.get("visualTimeoutMs"),
            default_value=1200,
            max_value=15000,
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
        semantic_anchor_hints: List[str] = []

        anchor_hint_name = (
            str((anchor_hint or {}).get("name") or "").strip()
            if isinstance(anchor_hint, dict)
            else ""
        )
        if anchor_hint_name:
            semantic_anchor_hints.append(anchor_hint_name)

        for raw_hint in (query_plan.get("semantic_anchor_candidates") or []):
            if isinstance(raw_hint, str) and raw_hint.strip():
                semantic_anchor_hints.append(raw_hint.strip())
        for raw_hint in (hints_options.get("semanticAnchorHints") or []):
            if isinstance(raw_hint, str) and raw_hint.strip():
                semantic_anchor_hints.append(raw_hint.strip())

        spatial_constraint_polygon = _build_spatial_constraint_polygon(spatial_context)
        # 纯图推理模式下不做语义关键词过滤，保持候选点覆盖范围更广。
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
                comparison_error = "Not enough valid regions for comparison (minimum: 2)."
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
                "regions": [],
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": _empty_graph_summary(),
                "stats": {
                    "query_type": query_type,
                    "requested_confidence_model": requested_confidence_model or None,
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

        # 注释说明
        explicit_limit = hints_options.get("limit")
        if query_type == "graph_reasoning" and explicit_limit is None:
            fetch_limit = min(fetch_limit, max(600, graph_max_nodes * 3))

        # 注释说明
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
        
        # 调试日志
        print(f"[PIPELINE_DEBUG] candidates_json present: {len(raw_candidates) > 0}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] payload_candidates count: {len(payload_candidates)}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] py_data_source: {py_data_source}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] spatial_context: {spatial_context}", flush=True, file=sys.stderr)

        candidate_source = "db"
        original_terms = list(terms)
        effective_terms = list(terms)
        term_filter_relaxed = False
        if payload_candidates and py_data_source in {"hybrid", "node"}:
            print(f"[PIPELINE_DEBUG] Using payload candidates (frontend POIs)", flush=True, file=sys.stderr)
            pois = _filter_payload_candidates(
                payload_candidates,
                spatial_context=spatial_context,
                categories=categories,
                terms=effective_terms,
                limit=fetch_limit,
            )
            candidate_source = "payload"
            if not pois and effective_terms:
                print(
                    "[PIPELINE_DEBUG] Payload candidates strict terms returned 0, retry without semantic terms",
                    flush=True,
                    file=sys.stderr,
                )
                pois = _filter_payload_candidates(
                    payload_candidates,
                    spatial_context=spatial_context,
                    categories=categories,
                    terms=[],
                    limit=fetch_limit,
                )
                term_filter_relaxed = True
                effective_terms = []
        else:
            print(f"[PIPELINE_DEBUG] Using repository.fetch_pois (PostGIS)", flush=True, file=sys.stderr)
            pois = self.repository.fetch_pois(
                spatial_context=spatial_context,
                categories=categories,
                terms=effective_terms,
                limit=fetch_limit,
                order_by_distance=db_order_by_distance,
            )
            print(f"[PIPELINE_DEBUG] fetch_pois returned {len(pois)} POIs", flush=True, file=sys.stderr)
            if not pois and effective_terms:
                print(
                    "[PIPELINE_DEBUG] PostGIS strict terms returned 0, retry without semantic terms",
                    flush=True,
                    file=sys.stderr,
                )
                pois = self.repository.fetch_pois(
                    spatial_context=spatial_context,
                    categories=categories,
                    terms=[],
                    limit=fetch_limit,
                    order_by_distance=db_order_by_distance,
                )
                print(
                    f"[PIPELINE_DEBUG] fetch_pois (relaxed terms) returned {len(pois)} POIs",
                    flush=True,
                    file=sys.stderr,
                )
                term_filter_relaxed = True
                effective_terms = []

        direction_applied = direction_hint is not None
        if direction_applied:
            pois = filter_pois_by_direction(
                pois,
                direction=direction_hint,
                anchor=anchor_hint,
                limit=fetch_limit,
            )
        query_filter_stats = {
            "semantic_terms_count": len(original_terms),
            "semantic_terms_applied_count": len(effective_terms),
            "term_filter_relaxed": term_filter_relaxed,
            "requested_confidence_model": requested_confidence_model or None,
        }

        road_boundary_enhancement = str(hints_options.get("roadBoundaryEnhancement", "true")).lower() not in {
            "false",
            "0",
            "off",
            "no",
        }
        road_fetch_limit = _resolve_limit(
            hints_options.get("roadMaxFetch"),
            default_value=12000,
            max_value=120000,
        )
        road_bundle = context_loader.load_road_context(
            repository=self.repository,
            spatial_context=spatial_context,
            query_type=query_type,
            enabled=road_boundary_enhancement,
            fetch_limit=road_fetch_limit,
            normalize_road_geometries_func=_normalize_road_geometries,
        )
        road_rows: List[Dict[str, Any]] = list(road_bundle.get("rows") or [])
        road_geometries: List[Any] = list(road_bundle.get("geometries") or [])
        road_index: STRtree | None = road_bundle.get("index")
        road_source = str(road_bundle.get("source") or "disabled")

        landuse_boundary_enhancement = str(hints_options.get("landuseBoundaryEnhancement", "true")).lower() not in {
            "false",
            "0",
            "off",
            "no",
        }
        landuse_fetch_limit = _resolve_limit(
            hints_options.get("landuseMaxFetch"),
            default_value=15000,
            max_value=150000,
        )
        landuse_bundle = context_loader.load_landuse_context(
            repository=self.repository,
            spatial_context=spatial_context,
            query_type=query_type,
            enabled=landuse_boundary_enhancement,
            fetch_limit=landuse_fetch_limit,
            normalize_landuse_geometries_func=_normalize_landuse_geometries,
        )
        landuse_rows: List[Dict[str, Any]] = list(landuse_bundle.get("rows") or [])
        landuse_geometries: List[Any] = list(landuse_bundle.get("geometries") or [])
        landuse_weights: List[float] = [
            _clamp01(float(value))
            for value in (landuse_bundle.get("weights") or [])
        ]
        landuse_semantic_features: List[Dict[str, Any]] = list(landuse_bundle.get("semantic_features") or [])
        landuse_index: STRtree | None = landuse_bundle.get("index")
        landuse_source = str(landuse_bundle.get("source") or "disabled")

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
                "road_boundary_enhancement": road_boundary_enhancement,
                "road_feature_count": len(road_geometries),
                "road_source": road_source,
                "landuse_boundary_enhancement": landuse_boundary_enhancement,
                "landuse_feature_count": len(landuse_geometries),
                "landuse_source": landuse_source,
                "semantic_anchor_hint_count": len(semantic_anchor_hints),
            },
        }

        # 图推理不需要进入高开销的片区建模链路。
        # 提前返回以保证大规模候选下图分析响应速度。
        if query_type == "graph_reasoning":
            final_results = {
                "mode": "graph_reasoning",
                "pois": pois[:500],
                "boundary": None,
                "spatial_clusters": {"hotspots": []},
                "regions": [],
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": graph_summary or _empty_graph_summary(),
                "stats": {
                    **query_filter_stats,
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
                    "road_boundary_enhancement": road_boundary_enhancement,
                    "road_feature_count": len(road_geometries),
                    "road_source": road_source,
                    "landuse_boundary_enhancement": landuse_boundary_enhancement,
                    "landuse_feature_count": len(landuse_geometries),
                    "landuse_source": landuse_source,
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
                        "road_source": road_source,
                        "road_feature_count": len(road_geometries),
                        "landuse_source": landuse_source,
                        "landuse_feature_count": len(landuse_geometries),
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
                "regions": [],
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": _empty_graph_summary(),
                "stats": {
                    **query_filter_stats,
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
        # 过滤后无候选点，返回合法的空结果负载。
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
                        "regions": [],
                        "vernacular_regions": [],
                        "fuzzy_regions": [],
                        "graph_reasoning": graph_summary or _empty_graph_summary(),
                        "stats": {
                            **query_filter_stats,
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
        # 在昂贵的下游建模前先输出一个快速预览边界。
        if len(coords) >= 3:
            # 下采样以保持预览边界生成稳定且快速。
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
                "v5_enabled": force_composite_v5,
            },
        }

        boundary_methods: List[str] = []
        cluster_entries: List[Dict[str, Any]] = []

        # ──────────────────────────────────────────────────────────────────
        # Composite V5: 路网地块边界组装链路
        # 当启用 composite_v5 时，走全新的地块 union 边界生成链路，
        # 替代传统的 alpha-shape / 凸包边界。
        # ──────────────────────────────────────────────────────────────────
        if force_composite_v5 and hasattr(self.repository, "spatial_join_pois"):
            print("[PIPELINE_V5] composite_v5 链路激活", flush=True, file=sys.stderr)

            # 构建 BBOX WKT 用于三层面查询
            v5_bbox_wkt = None
            if spatial_context.get("viewport"):
                vp = spatial_context["viewport"]
                if isinstance(vp, (list, tuple)) and len(vp) >= 4:
                    v5_bbox_wkt = (
                        f"POLYGON(({vp[0]} {vp[1]}, {vp[2]} {vp[1]}, "
                        f"{vp[2]} {vp[3]}, {vp[0]} {vp[3]}, {vp[0]} {vp[1]}))"
                    )
            if v5_bbox_wkt is None and spatial_context.get("boundary"):
                v5_bbox_wkt = POIRepository._boundary_wkt(spatial_context["boundary"])

            if v5_bbox_wkt:
                # 获取三层面数据
                v5_road_blocks = self.repository.fetch_road_blocks(bbox_wkt=v5_bbox_wkt, limit=5000)
                v5_osm_aoi = self.repository.fetch_osm_aoi(bbox_wkt=v5_bbox_wkt, limit=3000)
                v5_euluc = self.repository.fetch_euluc(bbox_wkt=v5_bbox_wkt, limit=3000)
                print(
                    f"[PIPELINE_V5] 三层面: blocks={len(v5_road_blocks)} aoi={len(v5_osm_aoi)} euluc={len(v5_euluc)}",
                    flush=True, file=sys.stderr,
                )

                # 空间连接 POI（如果 POI 还没有 block_id，则重新获取）
                if pois and pois[0].get("block_id") is None:
                    v5_pois = self.repository.spatial_join_pois(
                        clip_wkt=v5_bbox_wkt,
                        categories=categories,
                        terms=effective_terms if not term_filter_relaxed else [],
                        limit=fetch_limit,
                    )
                    if v5_pois:
                        pois = v5_pois
                        coords = [
                            (float(poi["lon"]), float(poi["lat"]))
                            for poi in pois
                            if poi.get("lon") is not None and poi.get("lat") is not None
                        ]
                        # 用新 POI 重新聚类
                        cluster_result = cluster_points(
                            coords,
                            min_cluster_size=cluster_min_cluster_size,
                            min_samples=cluster_min_samples,
                            adaptive=cluster_adaptive,
                            max_hdbscan_points=cluster_max_hdbscan_points,
                        )
                        labels = cluster_result.labels
                        grouped_indices = defaultdict(list)
                        for idx, label in enumerate(labels):
                            if label >= 0:
                                grouped_indices[label].append(idx)

                # V5 地块边界组装
                v5_districts = block_assembler.assemble_block_boundaries(
                    cluster_labels=labels,
                    pois=pois,
                    road_blocks=v5_road_blocks,
                    osm_aoi_features=v5_osm_aoi,
                    euluc_features=v5_euluc,
                )
                print(f"[PIPELINE_V5] 生成 {len(v5_districts)} 个片区", flush=True, file=sys.stderr)

                # 将 V5 片区转换为 cluster_entries 格式（兼容下游结果组装）
                for district in v5_districts:
                    d_pois = district.pois
                    d_coords = [(float(p["lon"]), float(p["lat"])) for p in d_pois if p.get("lon") and p.get("lat")]

                    categories_counter = Counter(_category_of(poi) for poi in d_pois)
                    top_category = categories_counter.most_common(1)[0][0] if categories_counter else "未分类"
                    top_count = categories_counter.most_common(1)[0][1] if categories_counter else 0
                    poi_quality = _cluster_poi_quality(d_pois)

                    d_bbox_area_m2 = _calc_bbox_area(d_coords) if len(d_coords) >= 2 else 0.0
                    density = 0.0 if d_bbox_area_m2 <= 0 else min(1.0, (len(d_coords) / (d_bbox_area_m2 / 10_000.0 + 1e-6)) / 20.0)
                    purity = top_count / max(1, len(d_pois))
                    compactness = min(1.0, 1.0 / (1.0 + d_bbox_area_m2 / 200_000.0))
                    centrality = min(1.0, len(d_pois) / max(1.0, len(pois)))
                    scale = min(1.0, math.log1p(len(d_pois)) / math.log1p(max(2, len(pois))))

                    membership = compute_membership(
                        density=density, purity=purity, centrality=centrality,
                        compactness=compactness, scale=scale, niche_type="mixed",
                    )

                    boundary_method = district.boundary_method
                    boundary_methods.append(boundary_method)
                    boundary_quality = {"quality_score": 0.85 if "road_block" in boundary_method else 0.65, "method": "v5_block"}

                    # V5 片区的置信度构建
                    # 由于地块边界本身就贴合路网，method_confidence 先验值更高
                    layer_bundle = {"outer": {}, "transition": {"confidence": district.name_confidence}, "core": {}}
                    boundary_conf = _build_boundary_confidence(
                        layer_bundle=layer_bundle,
                        membership_score=float(membership.score),
                        boundary_method=boundary_method,
                        boundary_quality_score=boundary_quality.get("quality_score"),
                        poi_quality_score=poi_quality.get("score"),
                        semantic_anchor_confidence=district.name_confidence if district.name_source != "fallback" else None,
                        niche_consistency_score=None,
                    )

                    vitality_score = _calc_vitality_score(
                        density=density, membership_score=float(membership.score),
                        purity=purity, cluster_size=len(d_pois), total_size=len(pois),
                    )

                    dominant_categories = [
                        {"category": cat, "count": int(cnt)}
                        for cat, cnt in categories_counter.most_common(3)
                    ]

                    cluster_entries.append({
                        "id": int(district.cluster_id),
                        "name": district.name,
                        "theme": top_category,
                        "poi_count": district.poi_count,
                        "center": {"lon": district.center[0], "lat": district.center[1]},
                        "boundary_geojson": district.boundary_geojson,
                        "boundary": [list(c) for c in (district.boundary_geojson.get("coordinates") or [[]])[0]],
                        "layers": {"outer": {}, "transition": {"confidence": district.name_confidence}, "core": {}},
                        "dominant_category": top_category,
                        "dominant_categories": dominant_categories,
                        "membership": asdict(membership),
                        "density": round(density, 4),
                        "purity": round(purity, 4),
                        "poi_quality": poi_quality,
                        "vitality_score": vitality_score,
                        "boundary_method": boundary_method,
                        "boundary_quality": boundary_quality,
                        "boundary_generation": {"method": boundary_method, "v5_block_ids": district.block_ids[:20]},
                        "boundary_confidence": boundary_conf["score"],
                        "confidence_explain": boundary_conf["explain"],
                        "semantic_anchor": {
                            "name": district.dominant_aoi_name or district.name.replace("片区", ""),
                            "confidence": district.name_confidence,
                            "source": district.name_source,
                        },
                        "niche_profile": {
                            "niche_type": district.dominant_land_type or "mixed",
                            "consistency": district.name_confidence,
                            "dominant_aoi_type": district.dominant_aoi_type,
                        },
                        "landuse_semantic": {"dominant_land_type": district.dominant_land_type},
                        "semantic_reasoning": {
                            "name_source": district.name_source,
                            "name_confidence": district.name_confidence,
                        },
                        "visual_morphology": None,
                        "score_breakdown": {
                            "density": membership.density,
                            "purity": membership.purity,
                            "centrality": membership.centrality,
                            "compactness": membership.compactness,
                            "scale": membership.scale,
                        },
                        "drivers": _top_membership_drivers(membership),
                        "cluster_pois": d_pois,
                    })

        # ──────────────────────────────────────────────────────────────────
        # 传统 (V1-V4) 边界构建链路
        # ──────────────────────────────────────────────────────────────────
        if not cluster_entries:
            # 走传统链路（V5 未启用或未产出结果）
            for cluster_id, indices in grouped_indices.items():
                cluster_points_list = [coords[idx] for idx in indices]
                cluster_pois = [pois[idx] for idx in indices]

                center_lon = sum(lon for lon, _ in cluster_points_list) / len(cluster_points_list)
                center_lat = sum(lat for _, lat in cluster_points_list) / len(cluster_points_list)

                categories_counter = Counter(_category_of(poi) for poi in cluster_pois)
                top_category, top_count = categories_counter.most_common(1)[0]
                poi_quality = _cluster_poi_quality(cluster_pois)
                semantic_anchor = _infer_semantic_anchor(
                    cluster_pois=cluster_pois,
                    dominant_category=top_category,
                    llm_anchor_candidates=semantic_anchor_hints,
                )

                bbox_area_m2 = _calc_bbox_area(cluster_points_list)
                density = 0.0 if bbox_area_m2 <= 0 else min(1.0, (len(cluster_points_list) / (bbox_area_m2 / 10_000.0 + 1e-6)) / 20.0)
                purity = top_count / max(1, len(cluster_points_list))
                compactness = min(1.0, 1.0 / (1.0 + bbox_area_m2 / 200_000.0))
                centrality = min(1.0, len(cluster_points_list) / max(1.0, len(pois)))
                scale = min(1.0, math.log1p(len(cluster_points_list)) / math.log1p(max(2, len(pois))))

                prelim_niche_name = f"{top_category} {semantic_anchor.get('name', '')}"
                prelim_niche, _, _ = semantic_reasoner.infer_niche_type_from_text(prelim_niche_name)

                membership = compute_membership(
                    density=density,
                    purity=purity,
                    centrality=centrality,
                    compactness=compactness,
                    scale=scale,
                    niche_type=prelim_niche or "mixed",
                )

                boundary_selection = _build_cluster_boundary(
                    cluster_points=cluster_points_list,
                    bbox_area_m2=bbox_area_m2,
                    density=density,
                    alpha_max_input_points=alpha_max_input_points,
                    road_index=road_index,
                    road_geometries=road_geometries,
                    landuse_index=landuse_index,
                    landuse_geometries=landuse_geometries,
                    landuse_weights=landuse_weights,
                )
                boundary_geojson = boundary_selection["boundary_geojson"]
                boundary_method = boundary_selection["boundary_method"]
                boundary_quality = boundary_selection["boundary_quality"]
                boundary_generation = boundary_selection["boundary_generation"]

                clip_result = _clip_boundary_geojson_to_constraint(
                    boundary_geojson=boundary_geojson,
                    cluster_points=cluster_points_list,
                    constraint_polygon=spatial_constraint_polygon,
                )
                boundary_geojson = clip_result["boundary_geojson"]
                clip_meta = clip_result.get("clip") or {"applied": False}
                boundary_generation = dict(boundary_generation or {})
                boundary_generation["constraint_clip"] = clip_meta
                if clip_meta.get("applied"):
                    clipped_road_alignment = _compute_road_alignment_score(
                        boundary_geojson=boundary_geojson,
                        cluster_points=cluster_points_list,
                        road_index=road_index,
                        road_geometries=road_geometries,
                    )
                    clipped_landuse_alignment = _compute_landuse_alignment_score(
                        boundary_geojson=boundary_geojson,
                        cluster_points=cluster_points_list,
                        landuse_index=landuse_index,
                        landuse_geometries=landuse_geometries,
                        landuse_weights=landuse_weights,
                    )
                    boundary_quality = _score_boundary_quality(
                        cluster_points=cluster_points_list,
                        boundary_geojson=boundary_geojson,
                        road_alignment_score=clipped_road_alignment,
                        landuse_alignment_score=clipped_landuse_alignment,
                    )
                    boundary_method = f"{boundary_method}_clip_v1"

                boundary_methods.append(boundary_method)
                landuse_semantic_context = _cluster_landuse_semantic_context(
                    boundary_geojson=boundary_geojson,
                    cluster_points=cluster_points_list,
                    semantic_features=landuse_semantic_features,
                )
                semantic_anchor = _recover_waterbody_anchor(
                    cluster_pois=cluster_pois,
                    semantic_anchor=semantic_anchor,
                    landuse_context=landuse_semantic_context,
                )
                niche_profile = _build_niche_profile(
                    cluster_pois=cluster_pois,
                    dominant_category=top_category,
                    semantic_anchor=semantic_anchor,
                    landuse_context=landuse_semantic_context,
                )
                boundary_quality = _apply_water_overlap_penalty(
                    boundary_quality=boundary_quality,
                    niche_profile=niche_profile,
                    landuse_context=landuse_semantic_context,
                )
                semantic_reasoning = _build_semantic_reasoning_payload(
                    semantic_anchor=semantic_anchor,
                    niche_profile=niche_profile,
                    landuse_context=landuse_semantic_context,
                )
                cluster_display_name = (
                    f"{semantic_anchor.get('name')}\u7247\u533a"
                    if str(semantic_anchor.get("name") or "").strip()
                    else f"{top_category}\u7247\u533a"
                )
                semantic_anchor_conf_for_conf = (
                    semantic_anchor.get("confidence")
                    if str(semantic_anchor.get("name") or "").strip()
                    else None
                )
                niche_consistency_for_conf = (
                    niche_profile.get("consistency")
                    if semantic_anchor_conf_for_conf is not None
                    and str(niche_profile.get("niche_type") or "") != "mixed"
                    else None
                )

                layer_bundle = _build_region_layers(
                    cluster_points=cluster_points_list,
                    base_boundary_geojson=boundary_geojson,
                    density=density,
                    membership_score=float(membership.score),
                    constraint_polygon=spatial_constraint_polygon,
                )
                visual_review = None
                if visual_review_enabled:
                    visual_review = _review_cluster_morphology(
                        spatial_context=spatial_context,
                        boundary_geojson=layer_bundle["representative_geojson"] or boundary_geojson,
                        boundary_quality=boundary_quality,
                        poi_count=len(cluster_points_list),
                        model_name=visual_model_name,
                        endpoint=visual_endpoint,
                        image_data_url=visual_image_data_url,
                        enable_remote=visual_remote_enabled,
                        timeout_ms=visual_timeout_ms,
                    )
                visual_morphology_conf_for_conf = (
                    visual_review.get("score") if isinstance(visual_review, dict) else None
                )
                boundary_conf = _build_boundary_confidence(
                    layer_bundle=layer_bundle,
                    membership_score=float(membership.score),
                    boundary_method=boundary_method,
                    boundary_quality_score=boundary_quality.get("quality_score"),
                    poi_quality_score=poi_quality.get("score"),
                    semantic_anchor_confidence=semantic_anchor_conf_for_conf,
                    niche_consistency_score=niche_consistency_for_conf,
                    visual_morphology_confidence=visual_morphology_conf_for_conf,
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
                        "name": cluster_display_name,
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
                        "poi_quality": poi_quality,
                        "vitality_score": vitality_score,
                        "boundary_method": boundary_method,
                        "boundary_quality": boundary_quality,
                        "boundary_generation": boundary_generation,
                        "boundary_confidence": boundary_conf["score"],
                        "confidence_explain": boundary_conf["explain"],
                        "semantic_anchor": semantic_anchor,
                        "niche_profile": niche_profile,
                        "landuse_semantic": landuse_semantic_context,
                        "semantic_reasoning": semantic_reasoning,
                        "visual_morphology": visual_review,
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

        self_validation_result = {
            "cluster_scores": {},
            "cluster_reports": [],
            "summary": {
                "model": "self_validation_v1",
                "avg_score": 0.0,
                "min_score": 0.0,
                "max_score": 0.0,
                "low_score_count": 0,
                "issue_counts": {},
            },
        }
        if self_validation_enabled:
            self_validation_result = _validate_cluster_entries(cluster_entries)

        skg_result = {
            "cluster_scores": {},
            "cluster_reports": [],
            "graph": {
                "model": "skg_consistency_v1",
                "node_count": 0,
                "edge_count": 0,
                "cluster_count": 0,
                "token_profile": "low_token_summary_v1",
            },
            "summary": {
                "avg_score": 0.0,
                "min_score": 0.0,
                "max_score": 0.0,
            },
        }
        if skg_enabled:
            skg_result = _build_spatial_knowledge_graph(cluster_entries)

        self_report_by_id = {
            int(report.get("id", 0)): report
            for report in (self_validation_result.get("cluster_reports") or [])
        }
        skg_report_by_id = {
            int(report.get("id", 0)): report
            for report in (skg_result.get("cluster_reports") or [])
        }

        # 当启用 composite_v4 工作流时，叠加视觉/自校验/SKG 信号并回写最终置信度。
        if force_composite_v4 or visual_review_enabled or self_validation_enabled or skg_enabled:
            for entry in cluster_entries:
                cluster_id = int(entry.get("id", 0))
                semantic_anchor = entry.get("semantic_anchor") or {}
                niche_profile = entry.get("niche_profile") or {}
                semantic_anchor_name = str(semantic_anchor.get("name") or "").strip()
                semantic_anchor_conf = semantic_anchor.get("confidence") if semantic_anchor_name else None
                niche_consistency = (
                    niche_profile.get("consistency")
                    if semantic_anchor_conf is not None
                    and str(niche_profile.get("niche_type") or "") != "mixed"
                    else None
                )

                layers = entry.get("layers") or {}
                layer_bundle = {
                    "outer": layers.get("outer") or {},
                    "transition": layers.get("transition") or {},
                    "core": layers.get("core") or {},
                }

                visual_conf = (
                    (entry.get("visual_morphology") or {}).get("score")
                    if (force_composite_v4 or visual_review_enabled)
                    else None
                )
                self_conf = (
                    (self_validation_result.get("cluster_scores") or {}).get(cluster_id)
                    if self_validation_enabled
                    else None
                )
                skg_conf = (
                    (skg_result.get("cluster_scores") or {}).get(cluster_id)
                    if skg_enabled
                    else None
                )

                rescored = _build_boundary_confidence(
                    layer_bundle=layer_bundle,
                    membership_score=float((entry.get("membership") or {}).get("score", 0.0)),
                    boundary_method=str(entry.get("boundary_method") or ""),
                    boundary_quality_score=(entry.get("boundary_quality") or {}).get("quality_score"),
                    poi_quality_score=(entry.get("poi_quality") or {}).get("score"),
                    semantic_anchor_confidence=semantic_anchor_conf,
                    niche_consistency_score=niche_consistency,
                    visual_morphology_confidence=visual_conf,
                    self_validation_confidence=self_conf,
                    skg_consistency_score=skg_conf,
                )
                entry["boundary_confidence"] = rescored["score"]
                entry["confidence_explain"] = rescored["explain"]
                if self_conf is not None:
                    entry["self_validation"] = self_report_by_id.get(cluster_id)
                if skg_conf is not None:
                    entry["skg_consistency"] = skg_report_by_id.get(cluster_id)

        cluster_entries.sort(key=lambda item: float(item.get("vitality_score", 0.0)), reverse=True)
        region_views = _build_region_views(cluster_entries=cluster_entries)
        regions = region_views["regions"]
        vernacular_regions = region_views["vernacular_regions"]
        fuzzy_regions = region_views["fuzzy_regions"]
        hotspots = region_views["hotspots"]

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

        cluster_summary = _summarize_cluster_entries(
            cluster_entries=cluster_entries,
            fuzzy_regions=fuzzy_regions,
        )
        fuzzy_summary = cluster_summary["fuzzy_summary"]
        visual_scores = [
            float((entry.get("visual_morphology") or {}).get("score"))
            for entry in cluster_entries
            if (entry.get("visual_morphology") or {}).get("score") is not None
        ]
        avg_visual_morphology_confidence = (
            round(sum(visual_scores) / len(visual_scores), 4) if visual_scores else 0.0
        )
        visual_modes = sorted(
            {
                str((entry.get("visual_morphology") or {}).get("mode"))
                for entry in cluster_entries
                if (entry.get("visual_morphology") or {}).get("mode")
            }
        )

        self_validation_summary = (self_validation_result.get("summary") or {}).copy()
        skg_summary = (skg_result.get("summary") or {}).copy()
        skg_graph = (skg_result.get("graph") or {}).copy()

        final_results = {
            "mode": "python-spatial",
            "pois": representative_pois,
            "boundary": vernacular_regions[0]["boundary"] if vernacular_regions else None,
            "spatial_clusters": {
                "hotspots": hotspots[:5],
                "h3_summary": h3_summary.get("cells", [])[:20],
            },
            "regions": regions[:10],
            "vernacular_regions": vernacular_regions[:10],
            "fuzzy_regions": fuzzy_regions[:10],
            "fuzzy_summary": fuzzy_summary,
            "graph_reasoning": graph_summary or _empty_graph_summary(),
            "self_validation": self_validation_summary,
            "spatial_knowledge_graph": {
                **skg_graph,
                "summary": skg_summary,
            },
            "stats": {
                **query_filter_stats,
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
                "boundary_confidence_model": cluster_summary["boundary_conf_model"],
                "avg_boundary_confidence": cluster_summary["avg_boundary_confidence"],
                "min_boundary_confidence": cluster_summary["min_boundary_confidence"],
                "max_boundary_confidence": cluster_summary["max_boundary_confidence"],
                "avg_poi_quality_score": cluster_summary["avg_poi_quality_score"],
                "boundary_quality_model": cluster_summary["boundary_quality_model"],
                "avg_boundary_quality_score": cluster_summary["avg_boundary_quality_score"],
                "avg_boundary_coverage": cluster_summary["avg_boundary_coverage"],
                "avg_landuse_alignment_score": cluster_summary["avg_landuse_alignment_score"],
                "avg_water_overlap_ratio": cluster_summary["avg_water_overlap_ratio"],
                "avg_water_penalty": cluster_summary["avg_water_penalty"],
                "semantic_anchor_model": "rule_hint_v1",
                "avg_semantic_anchor_confidence": cluster_summary["avg_semantic_anchor_confidence"],
                "semantic_anchor_coverage": cluster_summary["semantic_anchor_coverage"],
                "niche_type_counts": cluster_summary["niche_type_counts"],
                "dominant_niche_type": cluster_summary["dominant_niche_type"],
                "avg_visual_morphology_confidence": avg_visual_morphology_confidence,
                "visual_review_mode": visual_modes[0] if len(visual_modes) == 1 else ("mixed" if visual_modes else "disabled"),
                "visual_review_modes": visual_modes,
                "visual_review_model": visual_model_name if visual_review_enabled else None,
                "avg_self_validation_confidence": float(self_validation_summary.get("avg_score", 0.0)),
                "self_validation_model": self_validation_summary.get("model"),
                "avg_skg_consistency_score": float(skg_summary.get("avg_score", 0.0)),
                "skg_model": skg_graph.get("model"),
                "skg_node_count": int(skg_graph.get("node_count", 0)),
                "skg_edge_count": int(skg_graph.get("edge_count", 0)),
                "boundary_quality_pass_rate": cluster_summary["boundary_quality_pass_rate"],
                "avg_boundary_iterations": cluster_summary["avg_boundary_iterations"],
                "alpha_max_input_points": alpha_max_input_points,
                "road_boundary_enhancement": road_boundary_enhancement,
                "road_feature_count": len(road_geometries),
                "road_source": road_source,
                "landuse_boundary_enhancement": landuse_boundary_enhancement,
                "landuse_feature_count": len(landuse_geometries),
                "landuse_source": landuse_source,
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
                    "road_source": road_source,
                    "road_feature_count": len(road_geometries),
                    "landuse_source": landuse_source,
                    "landuse_feature_count": len(landuse_geometries),
                    "semantic_anchor_model": "rule_hint_v1",
                    "semantic_anchor_hint_count": len(semantic_anchor_hints),
                    "confidence_model": requested_confidence_model or cluster_summary["boundary_conf_model"],
                    "visual_review_enabled": visual_review_enabled,
                    "visual_remote_enabled": visual_remote_enabled,
                    "visual_review_model": visual_model_name if visual_review_enabled else None,
                    "self_validation_enabled": self_validation_enabled,
                    "skg_enabled": skg_enabled,
                    "self_validation_model": self_validation_summary.get("model"),
                    "skg_model": skg_graph.get("model"),
                    "skg_node_count": int(skg_graph.get("node_count", 0)),
                    "skg_edge_count": int(skg_graph.get("edge_count", 0)),
                    "graph_enabled": need_graph_reasoning,
                    "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                },
            },
        }



