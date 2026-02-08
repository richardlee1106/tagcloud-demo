"""Python 空间计算主流水线。"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from dataclasses import asdict
from typing import Any, Dict, Iterable, Iterator, List, Tuple

from shapely.geometry import MultiPoint, Point, Polygon, mapping
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
    """安全 JSON 解析，解析失败返回默认值。"""
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
    """提取 POI 主类别字段。"""
    return (
        poi.get("category_small")
        or poi.get("category_mid")
        or poi.get("category_big")
        or poi.get("type")
        or "unknown"
    )


def _calc_bbox_area(points: Iterable[Tuple[float, float]]) -> float:
    """按包围盒估算面积（m²）。"""
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    if not xs or not ys:
        return 0.0

    width = (max(xs) - min(xs)) * 111_320.0
    height = (max(ys) - min(ys)) * 111_320.0
    return max(0.0, width * height)


def _dynamic_h3_resolution(area_km2: float) -> int:
    """按面积映射动态 H3 分辨率。"""
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
    """从请求上下文估算查询范围面积（km²）。"""
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


class SpatialPipeline:
    """核心流水线：查询候选 -> 聚类 -> 边界 -> membership -> 输出事件流。"""

    def __init__(self, repository: POIRepository | None = None) -> None:
        self.repository = repository or POIRepository()

    def run(self, request: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        """执行一次空间任务并持续产出阶段事件。"""
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

        # 图结构推理以空间关系为核心，避免语义分词把候选集误过滤为空。
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
                comparison_error = "对比分析需要至少2个有效选区"
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

        candidate_source = "db"
        if payload_candidates and py_data_source in {"hybrid", "node"}:
            pois = _filter_payload_candidates(
                payload_candidates,
                spatial_context=spatial_context,
                categories=categories,
                terms=terms,
                limit=fetch_limit,
            )
            candidate_source = "payload"
        else:
            pois = self.repository.fetch_pois(
                spatial_context=spatial_context,
                categories=categories,
                terms=terms,
                limit=fetch_limit,
                order_by_distance=db_order_by_distance,
            )

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

        # 无结果时仍返回 FINAL，保持协议稳定。
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

        # 先给前端一个“草图边界”做渐进体验。
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

        cluster_result = cluster_points(coords)
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
            },
        }

        vernacular_regions = []
        fuzzy_regions = []
        hotspots = []
        boundary_methods: List[str] = []

        # 对每个簇进行命名、边界与 membership 计算。
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

            alpha = max(0.8, min(4.0, 2.0 - density + (bbox_area_m2 / 1_000_000.0)))

            # ???????????????? alpha-shape ?????????????
            if len(cluster_points_list) < 8:
                boundary_geojson = mapping(MultiPoint(cluster_points_list).convex_hull)
                boundary_method = "convex_hull_small_cluster"
            else:
                alpha_polygon = build_alpha_shape(
                    cluster_points_list,
                    alpha=alpha,
                    min_polygon_area_m2=800.0,
                    max_input_points=alpha_max_input_points,
                )

                if alpha_polygon:
                    boundary_geojson = alpha_polygon["geojson"]
                    boundary_method = alpha_polygon.get("method", "alpha_shape")
                else:
                    boundary_geojson = mapping(MultiPoint(cluster_points_list).convex_hull)
                    boundary_method = "convex_hull_fallback"

            boundary_methods.append(boundary_method)

            vernacular_regions.append(
                {
                    "id": int(cluster_id),
                    "name": f"{top_category}区域",
                    "poi_count": len(cluster_points_list),
                    "center": {"lon": center_lon, "lat": center_lat},
                    "boundary": boundary_geojson,
                    "dominant_category": top_category,
                    "membership": asdict(membership),
                    "boundary_method": boundary_method,
                }
            )

            fuzzy_regions.append(
                {
                    "id": int(cluster_id),
                    "theme": top_category,
                    "score": membership.score,
                    "level": membership.level,
                    "boundary": boundary_geojson,
                    "center": {"lon": center_lon, "lat": center_lat},
                    "boundary_method": boundary_method,
                    "score_breakdown": {
                        "density": membership.density,
                        "purity": membership.purity,
                        "centrality": membership.centrality,
                        "compactness": membership.compactness,
                        "scale": membership.scale,
                    },
                    "drivers": _top_membership_drivers(membership),
                }
            )

            hotspots.append(
                {
                    "id": int(cluster_id),
                    "center": {"lon": center_lon, "lat": center_lat},
                    "poiCount": len(cluster_points_list),
                    "density": round(density, 4),
                    "dominantCategories": [
                        {
                            "category": top_category,
                            "count": top_count,
                        }
                    ],
                }
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

        final_results = {
            "mode": "python-spatial",
            "pois": pois[:500],
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
                "h3_resolution": h3_resolution,
                "h3_engine": h3_summary.get("engine", "none"),
                "h3_cell_count": len(h3_summary.get("cells", [])),
                "query_type": query_type,
                "candidate_source": candidate_source,
                "direction": direction_hint,
                "direction_applied": direction_applied,
                "boundary_method": boundary_methods[0] if len(set(boundary_methods)) == 1 and boundary_methods else "mixed",
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
