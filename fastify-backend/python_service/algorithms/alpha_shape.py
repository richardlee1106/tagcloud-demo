"""Alpha-shape boundary generation with deterministic fallbacks."""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

from shapely.geometry import MultiPoint, Polygon, mapping
from shapely.ops import unary_union

from algorithms.geo_metrics import polygon_area_m2

try:
    import alphashape  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    alphashape = None


def _as_polygon(geometry) -> Optional[Polygon]:
    """Convert complex geometry payloads into a single Polygon."""
    if geometry is None:
        return None

    if isinstance(geometry, Polygon):
        return geometry

    if geometry.geom_type == "MultiPolygon":
        return max(geometry.geoms, key=lambda geom: geom.area)

    if geometry.geom_type == "GeometryCollection":
        polygons = [geom for geom in geometry.geoms if geom.geom_type == "Polygon"]
        if polygons:
            return max(polygons, key=lambda geom: geom.area)

    return None


def _downsample_points(points: Sequence[tuple[float, float]], max_points: int) -> tuple[list[tuple[float, float]], int]:
    """Deterministically downsample points for boundary generation."""
    if max_points <= 0 or len(points) <= max_points:
        return list(points), 1

    # 按固定步长抽样，保证下采样结果可复现
    step = max(1, len(points) // max_points)
    sampled = list(points[::step])

    # 兜底补上末尾点，避免边界尾段缺失
    if sampled and sampled[-1] != points[-1]:
        sampled.append(points[-1])

    if len(sampled) > max_points:
        sampled = sampled[: max_points - 1] + [sampled[-1]]

    return sampled, step


def _simplify_tolerance(polygon: Polygon) -> float:
    """Compute adaptive simplify tolerance by geometry span."""
    min_x, min_y, max_x, max_y = polygon.bounds
    span = max(max_x - min_x, max_y - min_y)

    # 简化容差做上下限约束，约等于 2m~35m 的尺度区间
    return max(0.00002, min(0.00035, span * 0.015))


def build_alpha_shape(
    coordinates: Iterable[tuple[float, float]],
    *,
    alpha: float,
    min_polygon_area_m2: float = 800.0,
    max_input_points: int = 1200,
):
    """Build boundary geometry and return GeoJSON + boundary metadata."""
    points = list(coordinates)
    if len(points) < 3:
        return None

    sampled_points, sample_step = _downsample_points(points, max_input_points)

    polygon = None
    method = "alpha_shape"

    if alphashape is not None:
        try:
            polygon = _as_polygon(alphashape.alphashape(sampled_points, alpha))
        except Exception:
            polygon = None

    if polygon is None:
        method = "convex_hull_fallback"
        polygon = MultiPoint(sampled_points).convex_hull

    polygon = unary_union([polygon]).buffer(0)
    polygon = _as_polygon(polygon)
    if polygon is None:
        return None

    # 对边界做一次拓扑保持简化，减少毛刺与噪声折线
    tolerance = _simplify_tolerance(polygon)
    simplified = polygon.simplify(tolerance, preserve_topology=True)
    simplified_polygon = _as_polygon(simplified)
    if simplified_polygon is not None:
        polygon = simplified_polygon
        method = f"{method}_simplified"

    approx_area_m2 = polygon_area_m2(polygon)
    if approx_area_m2 < min_polygon_area_m2:
        return None

    return {
        "geojson": mapping(polygon),
        "area_m2": approx_area_m2,
        "method": method,
        "alpha": float(alpha),
        "input_point_count": len(points),
        "used_point_count": len(sampled_points),
        "sample_step": int(sample_step),
        "simplify_tolerance_deg": tolerance,
    }
