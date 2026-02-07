"""Alpha-shape 边界生成。

说明：
- 优先 alpha-shape 生成“贴合点集”的不规则边界。
- 若失败/缺依赖，回退 convex hull，保证结果稳定可返回。
"""

from __future__ import annotations

from typing import Iterable, Optional

from shapely.geometry import MultiPoint, Polygon, mapping
from shapely.ops import unary_union

try:
    import alphashape  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    alphashape = None


def _as_polygon(geometry) -> Optional[Polygon]:
    """把复杂几何规整为单个 Polygon。"""
    if geometry is None:
        return None

    if isinstance(geometry, Polygon):
        return geometry

    if geometry.geom_type == "MultiPolygon":
        return max(geometry.geoms, key=lambda geom: geom.area)

    if geometry.geom_type == "GeometryCollection":
        polys = [geom for geom in geometry.geoms if geom.geom_type == "Polygon"]
        if polys:
            return max(polys, key=lambda geom: geom.area)

    return None


def build_alpha_shape(
    coordinates: Iterable[tuple[float, float]],
    *,
    alpha: float,
    min_polygon_area_m2: float = 800.0,
):
    """根据点集构建边界并返回 GeoJSON。"""
    pts = list(coordinates)
    if len(pts) < 3:
        return None

    polygon = None
    if alphashape is not None:
        try:
            polygon = _as_polygon(alphashape.alphashape(pts, alpha))
        except Exception:
            polygon = None

    # 兜底：至少返回凸包，保证下游可视化不断链。
    if polygon is None:
        polygon = MultiPoint(pts).convex_hull

    # buffer(0) 常用于修复轻微拓扑错误。
    polygon = unary_union([polygon]).buffer(0)
    polygon = _as_polygon(polygon)
    if polygon is None:
        return None

    # 粗略换算面积（用于过滤过小噪声区域）。
    approx_area_m2 = float(polygon.area) * (111_320.0**2)
    if approx_area_m2 < min_polygon_area_m2:
        return None

    return {
        "geojson": mapping(polygon),
        "area_m2": approx_area_m2,
    }
