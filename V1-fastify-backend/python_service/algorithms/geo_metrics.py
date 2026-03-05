"""Geodesic helpers for lon/lat geometries stored in EPSG:4326."""

from __future__ import annotations

import math
from typing import Iterable, Sequence, Tuple

from shapely.geometry import Point, Polygon
from shapely.ops import nearest_points

EARTH_RADIUS_M = 6_371_000.0


def clamp_lat(lat: float) -> float:
    """Clamp latitude to valid range for numeric stability."""
    return max(-89.9999, min(89.9999, float(lat)))


def meters_per_degree_lat(lat: float) -> float:
    """Approximate meters represented by one latitude degree at given latitude."""
    phi = math.radians(clamp_lat(lat))
    return (
        111_132.92
        - 559.82 * math.cos(2.0 * phi)
        + 1.175 * math.cos(4.0 * phi)
        - 0.0023 * math.cos(6.0 * phi)
    )


def meters_per_degree_lon(lat: float) -> float:
    """Approximate meters represented by one longitude degree at given latitude."""
    phi = math.radians(clamp_lat(lat))
    return (
        111_412.84 * math.cos(phi)
        - 93.5 * math.cos(3.0 * phi)
        + 0.118 * math.cos(5.0 * phi)
    )


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance in meters."""
    dlat = math.radians(float(lat2) - float(lat1))
    dlon = math.radians(float(lon2) - float(lon1))
    lat1_rad = math.radians(float(lat1))
    lat2_rad = math.radians(float(lat2))
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EARTH_RADIUS_M * c


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance in kilometers."""
    return haversine_m(lat1, lon1, lat2, lon2) / 1_000.0


def bbox_area_m2(points: Iterable[Tuple[float, float]]) -> float:
    """Approximate bbox area for lon/lat points in square meters."""
    xs = [float(lon) for lon, _ in points]
    ys = [float(lat) for _, lat in points]
    if not xs or not ys:
        return 0.0

    lon_span = max(xs) - min(xs)
    lat_span = max(ys) - min(ys)
    if lon_span <= 0.0 or lat_span <= 0.0:
        return 0.0

    mean_lat = (max(ys) + min(ys)) * 0.5
    width_m = lon_span * meters_per_degree_lon(mean_lat)
    height_m = lat_span * meters_per_degree_lat(mean_lat)
    return max(0.0, width_m * height_m)


def polygon_area_m2(polygon: Polygon | None) -> float:
    """Approximate lon/lat polygon area in square meters using centroid latitude."""
    if polygon is None or polygon.is_empty:
        return 0.0
    centroid_lat = float(polygon.centroid.y)
    return float(polygon.area) * meters_per_degree_lon(centroid_lat) * meters_per_degree_lat(centroid_lat)


def polygon_area_km2(polygon: Polygon | None) -> float:
    """Approximate lon/lat polygon area in square kilometers."""
    return polygon_area_m2(polygon) / 1_000_000.0


def ring_length_m(coords: Sequence[Tuple[float, float]]) -> float:
    """Compute geodesic ring length in meters."""
    if len(coords) < 2:
        return 0.0

    length = 0.0
    for idx in range(1, len(coords)):
        lon1, lat1 = coords[idx - 1]
        lon2, lat2 = coords[idx]
        length += haversine_m(lat1, lon1, lat2, lon2)
    return length


def polygon_perimeter_km(polygon: Polygon | None) -> float:
    """Compute polygon perimeter in kilometers."""
    if polygon is None or polygon.is_empty:
        return 0.0

    perimeter_m = ring_length_m([(float(x), float(y)) for x, y in polygon.exterior.coords])
    for interior in polygon.interiors:
        perimeter_m += ring_length_m([(float(x), float(y)) for x, y in interior.coords])
    return perimeter_m / 1_000.0


def nearest_point_and_distance_m(point: Point, geometry) -> tuple[tuple[float, float] | None, float | None]:
    """Return nearest coordinate on geometry and geodesic distance in meters."""
    if point is None or geometry is None or geometry.is_empty:
        return None, None

    try:
        nearest_geom = nearest_points(point, geometry)[1]
    except Exception:
        return None, None

    nearest_coord = (float(nearest_geom.x), float(nearest_geom.y))
    distance_m = haversine_m(float(point.y), float(point.x), nearest_coord[1], nearest_coord[0])
    return nearest_coord, distance_m
