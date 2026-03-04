# -*- coding: utf-8 -*-
"""从空间管线编排器中拆分出的边界构建辅助函数。"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Tuple

from shapely.geometry import MultiPoint, Point, Polygon, mapping
from shapely.prepared import prep


def _polygon_ring(polygon: Polygon | None) -> List[List[float]]:
    if polygon is None or polygon.is_empty:
        return []
    return [[float(x), float(y)] for x, y in polygon.exterior.coords]


def build_region_layers(
    *,
    cluster_points: List[Tuple[float, float]],
    base_boundary_geojson: Dict[str, Any],
    density: float,
    membership_score: float,
    constraint_polygon: Polygon | None = None,
    polygon_from_geojson: Callable[..., Polygon | None],
    to_surface_polygon: Callable[..., Polygon | None],
    as_polygon: Callable[[Any], Polygon | None],
    clip_polygon_to_constraint: Callable[[Polygon | None, Polygon | None], Polygon | None],
    polygon_area_km2: Callable[[Polygon | None], float],
    clamp01: Callable[[float], float],
) -> Dict[str, Any]:
    """基于聚类几何构建三层面（外层/过渡层/核心层）。"""
    polygon = polygon_from_geojson(base_boundary_geojson, cluster_points=cluster_points)
    if polygon is None:
        polygon = to_surface_polygon(MultiPoint(cluster_points).convex_hull, cluster_points=cluster_points)
    if polygon is None and cluster_points:
        xs = [pt[0] for pt in cluster_points]
        ys = [pt[1] for pt in cluster_points]
        center = Point(sum(xs) / len(xs), sum(ys) / len(ys))
        lon_span = max(xs) - min(xs) if len(xs) > 1 else 0.0
        lat_span = max(ys) - min(ys) if len(ys) > 1 else 0.0
        radius = max(0.00012, max(lon_span, lat_span) * 0.25)
        polygon = as_polygon(center.buffer(radius))
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

    adaptive = max(0.00008, min(0.0045, span * (0.20 + (1.0 - clamp01(density)) * 0.10)))
    outer_expand = adaptive * 0.60
    transition_expand = adaptive * 0.22
    core_shrink = adaptive * (0.30 + 0.25 * (1.0 - clamp01(membership_score)))

    outer = as_polygon(polygon.buffer(outer_expand))
    transition = as_polygon(polygon.buffer(transition_expand))
    core = as_polygon(polygon.buffer(-core_shrink))

    if outer is None:
        outer = polygon
    if transition is None:
        transition = polygon
    if core is None or core.is_empty:
        core = as_polygon(polygon.centroid.buffer(max(adaptive * 0.35, 0.00006)))
        if core is None:
            core = polygon

    if constraint_polygon is not None and not constraint_polygon.is_empty:
        clipped_outer = clip_polygon_to_constraint(outer, constraint_polygon)
        clipped_transition = clip_polygon_to_constraint(transition, constraint_polygon)
        clipped_core = clip_polygon_to_constraint(core, constraint_polygon)

        if clipped_outer is not None:
            outer = clipped_outer
        if clipped_transition is not None:
            transition = clipped_transition
        if clipped_core is not None:
            core = clipped_core

    outer_conf = clamp01(0.40 + clamp01(density) * 0.25)
    transition_conf = clamp01(0.52 + clamp01(membership_score) * 0.30)
    core_conf = clamp01(0.60 + clamp01(membership_score) * 0.32)

    layers = {
        "outer": {
            "boundary": _polygon_ring(outer),
            "geojson": mapping(outer),
            "area_km2": round(polygon_area_km2(outer), 6),
            "confidence": round(outer_conf, 4),
        },
        "transition": {
            "boundary": _polygon_ring(transition),
            "geojson": mapping(transition),
            "area_km2": round(polygon_area_km2(transition), 6),
            "confidence": round(transition_conf, 4),
        },
        "core": {
            "boundary": _polygon_ring(core),
            "geojson": mapping(core),
            "area_km2": round(polygon_area_km2(core), 6),
            "confidence": round(core_conf, 4),
        },
    }

    return {
        **layers,
        "representative_boundary": layers["transition"]["boundary"] or layers["outer"]["boundary"],
        "representative_geojson": layers["transition"]["geojson"] or layers["outer"]["geojson"],
    }


def score_boundary_quality(
    *,
    cluster_points: List[Tuple[float, float]],
    boundary_geojson: Dict[str, Any],
    polygon_from_geojson: Callable[..., Polygon | None],
    to_surface_polygon: Callable[..., Polygon | None],
    polygon_area_km2: Callable[[Polygon | None], float],
    polygon_perimeter_km: Callable[[Polygon | None], float],
    clamp01: Callable[[float], float],
    road_alignment_score: float | None = None,
    landuse_alignment_score: float | None = None,
) -> Dict[str, Any]:
    """基于源点分布评估边界质量。"""
    polygon = polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty or not cluster_points:
        return {
            "coverage_ratio": 0.0,
            "inside_point_count": 0,
            "point_count": len(cluster_points),
            "area_ratio_to_hull": 0.0,
            "compactness": 0.0,
            "quality_score": 0.0,
            "model": "coverage_area_compactness_v1",
            "pass": False,
        }

    prepared_polygon = prep(polygon)
    inside_count = 0
    for lon, lat in cluster_points:
        if prepared_polygon.covers(Point(lon, lat)):
            inside_count += 1

    coverage_ratio = inside_count / max(1, len(cluster_points))

    hull_polygon = to_surface_polygon(MultiPoint(cluster_points).convex_hull, cluster_points=cluster_points)
    hull_area_km2 = polygon_area_km2(hull_polygon)
    boundary_area_km2 = polygon_area_km2(polygon)
    area_ratio_to_hull = boundary_area_km2 / hull_area_km2 if hull_area_km2 > 0 else 1.0

    perimeter_km = polygon_perimeter_km(polygon)
    compactness = 0.0
    if perimeter_km > 0 and boundary_area_km2 > 0:
        compactness = clamp01((4.0 * math.pi * boundary_area_km2) / (perimeter_km * perimeter_km))

    hull_similarity = clamp01(1.0 - min(abs(area_ratio_to_hull - 0.72) / 0.72, 1.0))
    normalized_road_alignment = clamp01(float(road_alignment_score)) if road_alignment_score is not None else None
    normalized_landuse_alignment = (
        clamp01(float(landuse_alignment_score))
        if landuse_alignment_score is not None
        else None
    )

    if normalized_road_alignment is None and normalized_landuse_alignment is None:
        quality_model = "coverage_area_compactness_v1"
        quality_score = clamp01(
            0.62 * clamp01(coverage_ratio)
            + 0.23 * hull_similarity
            + 0.15 * clamp01(compactness)
        )
    elif normalized_road_alignment is not None and normalized_landuse_alignment is None:
        quality_model = "coverage_area_compactness_road_v2"
        quality_score = clamp01(
            0.52 * clamp01(coverage_ratio)
            + 0.18 * hull_similarity
            + 0.12 * clamp01(compactness)
            + 0.18 * normalized_road_alignment
        )
    elif normalized_road_alignment is None and normalized_landuse_alignment is not None:
        quality_model = "coverage_area_compactness_landuse_v2"
        quality_score = clamp01(
            0.50 * clamp01(coverage_ratio)
            + 0.18 * hull_similarity
            + 0.12 * clamp01(compactness)
            + 0.20 * normalized_landuse_alignment
        )
    else:
        quality_model = "coverage_area_compactness_road_landuse_v3"
        quality_score = clamp01(
            0.46 * clamp01(coverage_ratio)
            + 0.16 * hull_similarity
            + 0.10 * clamp01(compactness)
            + 0.16 * normalized_road_alignment
            + 0.12 * normalized_landuse_alignment
        )

    pass_quality = coverage_ratio >= 0.78 and 0.14 <= area_ratio_to_hull <= 1.35

    result = {
        "coverage_ratio": round(coverage_ratio, 4),
        "inside_point_count": int(inside_count),
        "point_count": int(len(cluster_points)),
        "area_ratio_to_hull": round(float(area_ratio_to_hull), 4),
        "compactness": round(float(compactness), 4),
        "quality_score": round(float(quality_score), 4),
        "model": quality_model,
        "pass": bool(pass_quality),
    }

    if normalized_road_alignment is not None:
        result["road_alignment_score"] = round(float(normalized_road_alignment), 4)
    if normalized_landuse_alignment is not None:
        result["landuse_alignment_score"] = round(float(normalized_landuse_alignment), 4)

    return result


def build_cluster_boundary(
    *,
    cluster_points: List[Tuple[float, float]],
    bbox_area_m2: float,
    density: float,
    alpha_max_input_points: int,
    road_index: Any = None,
    road_geometries: List[Any] | None = None,
    landuse_index: Any = None,
    landuse_geometries: List[Any] | None = None,
    landuse_weights: List[float] | None = None,
    build_alpha_shape_func: Callable[..., Dict[str, Any] | None],
    compute_road_alignment_score_func: Callable[..., float | None],
    compute_landuse_alignment_score_func: Callable[..., float | None],
    score_boundary_quality_func: Callable[..., Dict[str, Any]],
    snap_polygon_to_linear_context_func: Callable[..., Dict[str, Any] | None],
    to_surface_polygon_func: Callable[..., Polygon | None],
) -> Dict[str, Any]:
    """
    通过 alpha-shape 寻找最优边界。
    如果 alpha 寻找失效，则使用凸包。
    """
    raw_hull = MultiPoint(cluster_points).convex_hull
    raw_hull_type = str(getattr(raw_hull, "geom_type", ""))
    hull_polygon = to_surface_polygon_func(raw_hull, cluster_points=cluster_points)
    hull_geojson = mapping(hull_polygon) if hull_polygon is not None else mapping(raw_hull)

    is_degenerate_hull = raw_hull_type in {"Point", "MultiPoint", "LineString", "LinearRing", "MultiLineString"}
    small_cluster_method = "buffered_hull_small_cluster" if is_degenerate_hull else "convex_hull_small_cluster"

    if len(cluster_points) < 8:
        road_alignment = compute_road_alignment_score_func(
            boundary_geojson=hull_geojson,
            cluster_points=cluster_points,
            road_index=road_index,
            road_geometries=road_geometries,
        )
        landuse_alignment = compute_landuse_alignment_score_func(
            boundary_geojson=hull_geojson,
            cluster_points=cluster_points,
            landuse_index=landuse_index,
            landuse_geometries=landuse_geometries,
            landuse_weights=landuse_weights,
        )
        quality = score_boundary_quality_func(
            cluster_points=cluster_points,
            boundary_geojson=hull_geojson,
            road_alignment_score=road_alignment,
            landuse_alignment_score=landuse_alignment,
        )
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
        road_alignment = compute_road_alignment_score_func(
            boundary_geojson=hull_geojson,
            cluster_points=cluster_points,
            road_index=road_index,
            road_geometries=road_geometries,
        )
        landuse_alignment = compute_landuse_alignment_score_func(
            boundary_geojson=hull_geojson,
            cluster_points=cluster_points,
            landuse_index=landuse_index,
            landuse_geometries=landuse_geometries,
            landuse_weights=landuse_weights,
        )
        quality = score_boundary_quality_func(
            cluster_points=cluster_points,
            boundary_geojson=hull_geojson,
            road_alignment_score=road_alignment,
            landuse_alignment_score=landuse_alignment,
        )
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
        alpha_polygon = build_alpha_shape_func(
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
        road_alignment = compute_road_alignment_score_func(
            boundary_geojson=boundary_geojson,
            cluster_points=cluster_points,
            road_index=road_index,
            road_geometries=road_geometries,
        )
        landuse_alignment = compute_landuse_alignment_score_func(
            boundary_geojson=boundary_geojson,
            cluster_points=cluster_points,
            landuse_index=landuse_index,
            landuse_geometries=landuse_geometries,
            landuse_weights=landuse_weights,
        )
        quality = score_boundary_quality_func(
            cluster_points=cluster_points,
            boundary_geojson=boundary_geojson,
            road_alignment_score=road_alignment,
            landuse_alignment_score=landuse_alignment,
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

    hull_road_alignment = compute_road_alignment_score_func(
        boundary_geojson=hull_geojson,
        cluster_points=cluster_points,
        road_index=road_index,
        road_geometries=road_geometries,
    )
    hull_landuse_alignment = compute_landuse_alignment_score_func(
        boundary_geojson=hull_geojson,
        cluster_points=cluster_points,
        landuse_index=landuse_index,
        landuse_geometries=landuse_geometries,
        landuse_weights=landuse_weights,
    )
    hull_quality = score_boundary_quality_func(
        cluster_points=cluster_points,
        boundary_geojson=hull_geojson,
        road_alignment_score=hull_road_alignment,
        landuse_alignment_score=hull_landuse_alignment,
    )
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

    has_linear_context = (
        (road_index is not None and bool(road_geometries))
        or (landuse_index is not None and bool(landuse_geometries))
    )
    refinement_payload: Dict[str, Any] | None = None
    if has_linear_context:
        refinement_payload = {
            "model": "road_landuse_snap_v1",
            "applied": False,
        }
        refined = snap_polygon_to_linear_context_func(
            boundary_geojson=best_candidate["boundary_geojson"],
            cluster_points=cluster_points,
            road_index=road_index,
            road_geometries=road_geometries,
            landuse_index=landuse_index,
            landuse_geometries=landuse_geometries,
        )
        if refined:
            refined_geojson = refined["geojson"]
            refined_road_alignment = compute_road_alignment_score_func(
                boundary_geojson=refined_geojson,
                cluster_points=cluster_points,
                road_index=road_index,
                road_geometries=road_geometries,
            )
            refined_landuse_alignment = compute_landuse_alignment_score_func(
                boundary_geojson=refined_geojson,
                cluster_points=cluster_points,
                landuse_index=landuse_index,
                landuse_geometries=landuse_geometries,
                landuse_weights=landuse_weights,
            )
            refined_quality = score_boundary_quality_func(
                cluster_points=cluster_points,
                boundary_geojson=refined_geojson,
                road_alignment_score=refined_road_alignment,
                landuse_alignment_score=refined_landuse_alignment,
            )

            base_quality = best_candidate["boundary_quality"]
            base_score = float(base_quality.get("quality_score", 0.0))
            base_road_alignment = float(base_quality.get("road_alignment_score", 0.0))
            refined_score = float(refined_quality.get("quality_score", 0.0))
            refined_road = float(refined_quality.get("road_alignment_score", 0.0))
            refined_coverage = float(refined_quality.get("coverage_ratio", 0.0))
            base_coverage = float(base_quality.get("coverage_ratio", 0.0))

            should_apply = (
                refined_score >= base_score + 0.012
                or (
                    refined_score >= base_score - 0.04
                    and refined_road >= base_road_alignment + 0.02
                    and refined_coverage >= base_coverage - 0.08
                )
                or (
                    refined_score >= base_score - 0.03
                    and int(refined.get("road_snap_vertices") or 0) >= 4
                    and refined_coverage >= base_coverage - 0.08
                )
                or (
                    refined_road >= base_road_alignment + 0.10
                    and refined_score >= base_score - 0.12
                    and refined_coverage >= base_coverage - 0.34
                )
            )

            refinement_payload.update(
                {
                    "snap_distance_m": refined.get("snap_distance_m"),
                    "sampled_vertices": refined.get("sampled_vertices"),
                    "snapped_vertices": refined.get("snapped_vertices"),
                    "road_snap_vertices": refined.get("road_snap_vertices"),
                    "landuse_snap_vertices": refined.get("landuse_snap_vertices"),
                    "coverage_ratio": refined.get("coverage_ratio"),
                    "area_ratio_to_original": refined.get("area_ratio_to_original"),
                    "base_quality_score": round(base_score, 4),
                    "refined_quality_score": round(refined_score, 4),
                    "base_road_alignment": round(base_road_alignment, 4),
                    "refined_road_alignment": round(refined_road, 4),
                    "applied": bool(should_apply),
                }
            )

            if should_apply:
                best_candidate = {
                    "attempt": best_candidate["attempt"],
                    "alpha": best_candidate.get("alpha"),
                    "boundary_geojson": refined_geojson,
                    "boundary_method": f"{best_candidate['boundary_method']}_roadfit_v1",
                    "boundary_quality": refined_quality,
                }

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
            "refinement": refinement_payload,
        },
    }
