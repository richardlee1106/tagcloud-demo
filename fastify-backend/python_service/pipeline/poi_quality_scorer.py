"""POI quality scoring helpers."""

from __future__ import annotations

from typing import Any, Dict, List


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def is_valid_lon_lat(lon: float | None, lat: float | None) -> bool:
    """Validate longitude/latitude ranges."""
    if lon is None or lat is None:
        return False
    return -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0


def poi_point_quality_score(poi: Dict[str, Any]) -> float:
    """Compute point-level POI quality score in [0, 1]."""
    name = str(poi.get("name") or "").strip()
    address = str(poi.get("address") or "").strip()
    category = (
        str(poi.get("category_small") or "").strip()
        or str(poi.get("category_mid") or "").strip()
        or str(poi.get("category_big") or "").strip()
        or str(poi.get("type") or "").strip()
    )

    lon = _to_float(poi.get("lon"))
    lat = _to_float(poi.get("lat"))

    has_name = 1.0 if name else 0.0
    has_address = 1.0 if address else 0.0
    has_category = 1.0 if category else 0.0
    has_valid_coord = 1.0 if is_valid_lon_lat(lon, lat) else 0.0

    name_len = len(name)
    if name_len == 0:
        name_shape = 0.0
    elif 2 <= name_len <= 40:
        name_shape = 1.0
    else:
        name_shape = 0.72

    return _clamp01(
        0.30 * has_name
        + 0.20 * has_address
        + 0.20 * has_category
        + 0.20 * has_valid_coord
        + 0.10 * name_shape
    )


def cluster_poi_quality(cluster_pois: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate POI quality to cluster-level confidence features."""
    if not cluster_pois:
        return {
            "score": 0.0,
            "name_present_ratio": 0.0,
            "address_present_ratio": 0.0,
            "category_present_ratio": 0.0,
            "valid_coord_ratio": 0.0,
            "name_uniqueness_ratio": 0.0,
        }

    size = len(cluster_pois)
    point_scores = [poi_point_quality_score(poi) for poi in cluster_pois]
    avg_point_score = sum(point_scores) / max(1, size)

    name_present = sum(1 for poi in cluster_pois if str(poi.get("name") or "").strip())
    address_present = sum(1 for poi in cluster_pois if str(poi.get("address") or "").strip())
    category_present = sum(
        1
        for poi in cluster_pois
        if (
            str(poi.get("category_small") or "").strip()
            or str(poi.get("category_mid") or "").strip()
            or str(poi.get("category_big") or "").strip()
            or str(poi.get("type") or "").strip()
        )
    )
    valid_coord = sum(
        1
        for poi in cluster_pois
        if is_valid_lon_lat(_to_float(poi.get("lon")), _to_float(poi.get("lat")))
    )

    normalized_names = [
        str(poi.get("name") or "").strip().lower()
        for poi in cluster_pois
        if str(poi.get("name") or "").strip()
    ]
    if normalized_names:
        name_uniqueness_ratio = len(set(normalized_names)) / len(normalized_names)
    else:
        name_uniqueness_ratio = 0.5

    final_score = _clamp01(
        0.85 * avg_point_score
        + 0.15 * _clamp01(name_uniqueness_ratio)
    )

    return {
        "score": round(final_score, 4),
        "name_present_ratio": round(name_present / size, 4),
        "address_present_ratio": round(address_present / size, 4),
        "category_present_ratio": round(category_present / size, 4),
        "valid_coord_ratio": round(valid_coord / size, 4),
        "name_uniqueness_ratio": round(float(name_uniqueness_ratio), 4),
    }

