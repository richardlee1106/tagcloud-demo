"""Python 空间计算主流水线。"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from dataclasses import asdict
from typing import Any, Dict, Iterable, Iterator, List, Tuple

from shapely.geometry import MultiPoint, mapping

from algorithms.alpha_shape import build_alpha_shape
from algorithms.hdbscan_cluster import cluster_points
from algorithms.membership import compute_membership
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


class SpatialPipeline:
    """核心流水线：查询候选 -> 聚类 -> 边界 -> membership -> 输出事件流。"""

    def __init__(self, repository: POIRepository | None = None) -> None:
        self.repository = repository or POIRepository()

    def run(self, request: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        """执行一次空间任务并持续产出阶段事件。"""
        query_type = request.get("query_type") or "poi_search"
        spatial_context = _safe_json_loads(request.get("spatial_context"), {})
        categories = request.get("categories") or []

        hints = _safe_json_loads(request.get("hints"), {})
        semantic_query = hints.get("semantic_query") or ""
        terms = [term for term in semantic_query.split() if term.strip()]

        yield {
            "type": "STAGE",
            "payload": {
                "stage": "fetch_candidates",
                "query_type": query_type,
            },
        }

        pois = self.repository.fetch_pois(
            spatial_context=spatial_context,
            categories=categories,
            terms=terms,
            limit=8000,
        )

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "fetch_candidates",
                "progress": 0.25,
                "poi_count": len(pois),
            },
        }

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
                        "stats": {
                            "total_candidates": 0,
                            "cluster_count": 0,
                            "h3_resolution": _dynamic_h3_resolution(_extract_area_km2(spatial_context)),
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
            sketch_polygon = mapping(MultiPoint(coords).convex_hull)
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
            },
        }

        vernacular_regions = []
        fuzzy_regions = []
        hotspots = []

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
            alpha_polygon = build_alpha_shape(
                cluster_points_list,
                alpha=alpha,
                min_polygon_area_m2=800.0,
            )

            boundary_geojson = alpha_polygon["geojson"] if alpha_polygon else mapping(MultiPoint(cluster_points_list).convex_hull)

            vernacular_regions.append(
                {
                    "id": int(cluster_id),
                    "name": f"{top_category}区域",
                    "poi_count": len(cluster_points_list),
                    "center": {"lon": center_lon, "lat": center_lat},
                    "boundary": boundary_geojson,
                    "dominant_category": top_category,
                    "membership": asdict(membership),
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

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "region_modeling",
                "progress": 0.85,
                "vernacular_count": len(vernacular_regions),
            },
        }

        final_results = {
            "mode": "python-spatial",
            "pois": pois[:500],
            "boundary": vernacular_regions[0]["boundary"] if vernacular_regions else None,
            "spatial_clusters": {"hotspots": hotspots[:5]},
            "vernacular_regions": vernacular_regions[:10],
            "fuzzy_regions": fuzzy_regions[:10],
            "stats": {
                "total_candidates": len(pois),
                "cluster_count": len(vernacular_regions),
                "h3_resolution": h3_resolution,
                "query_type": query_type,
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
                    "input_area_km2": round(area_km2, 3),
                },
            },
        }
