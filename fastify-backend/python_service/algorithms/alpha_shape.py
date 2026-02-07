"""Alpha-shape boundary generation with deterministic fallbacks."""

from __future__ import annotations

from typing import Iterable, Optional

from shapely.geometry import MultiPoint, Polygon, mapping
from shapely.ops import unary_union

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


def build_alpha_shape(
    coordinates: Iterable[tuple[float, float]],
    *,
    alpha: float,
    min_polygon_area_m2: float = 800.0,
):
    """Build boundary geometry and return GeoJSON + boundary metadata."""
    points = list(coordinates)
    if len(points) < 3:
        return None

    polygon = None
    method = "alpha_shape"

    if alphashape is not None:
        try:
            polygon = _as_polygon(alphashape.alphashape(points, alpha))
        except Exception:
            polygon = None

    if polygon is None:
        method = "convex_hull_fallback"
        polygon = MultiPoint(points).convex_hull

    polygon = unary_union([polygon]).buffer(0)
    polygon = _as_polygon(polygon)
    if polygon is None:
        return None

    approx_area_m2 = float(polygon.area) * (111_320.0 ** 2)
    if approx_area_m2 < min_polygon_area_m2:
        return None

    return {
        "geojson": mapping(polygon),
        "area_m2": approx_area_m2,
        "method": method,
        "alpha": float(alpha),
    }
