"""Direction-aware filtering utilities for spatial POI ranking."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Tuple

_DIRECTION_ALIASES = {
    "east": ["east", "e", "dong", "东", "东侧", "东边", "东面"],
    "west": ["west", "w", "xi", "西", "西侧", "西边", "西面"],
    "north": ["north", "n", "bei", "北", "北侧", "北边", "北面"],
    "south": ["south", "s", "nan", "南", "南侧", "南边", "南面"],
}


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_lon_lat(raw: Any) -> Tuple[float, float] | None:
    """Extract (lon, lat) from dict/list payloads."""
    if isinstance(raw, dict):
        lon = _to_float(raw.get("lon", raw.get("lng", raw.get("longitude"))))
        lat = _to_float(raw.get("lat", raw.get("latitude")))
        if lon is not None and lat is not None:
            return lon, lat

    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        lon = _to_float(raw[0])
        lat = _to_float(raw[1])
        if lon is not None and lat is not None:
            return lon, lat

    return None


def normalize_direction(raw_direction: Any) -> str | None:
    """Normalize direction aliases to east/west/north/south."""
    if raw_direction is None:
        return None

    text = str(raw_direction).strip().lower()
    if not text:
        return None

    for canonical, aliases in _DIRECTION_ALIASES.items():
        if text == canonical:
            return canonical
        if any(alias in text for alias in aliases):
            return canonical

    return None


def resolve_direction_from_query_plan(query_plan: Dict[str, Any], semantic_query: str = "") -> str | None:
    """Extract direction hint from structured query_plan first, then semantic text."""
    candidates: List[Any] = [
        query_plan.get("direction"),
        query_plan.get("spatial_direction"),
        query_plan.get("position"),
    ]

    relation = query_plan.get("spatial_relation")
    if isinstance(relation, dict):
        candidates.extend([
            relation.get("direction"),
            relation.get("position"),
        ])
    else:
        candidates.append(relation)

    for candidate in candidates:
        normalized = normalize_direction(candidate)
        if normalized is not None:
            return normalized

    return normalize_direction(semantic_query)


def _resolve_anchor(anchor: Any, pois: Iterable[Dict[str, Any]]) -> Tuple[float, float] | None:
    """Use explicit anchor first; otherwise use centroid as fallback anchor."""
    explicit = _extract_lon_lat(anchor)
    if explicit is not None:
        return explicit

    coords: List[Tuple[float, float]] = []
    for poi in pois:
        lon = _to_float(poi.get("lon"))
        lat = _to_float(poi.get("lat"))
        if lon is not None and lat is not None:
            coords.append((lon, lat))

    if not coords:
        return None

    lon = sum(item[0] for item in coords) / len(coords)
    lat = sum(item[1] for item in coords) / len(coords)
    return lon, lat


def _direction_score(direction: str, anchor_lon: float, anchor_lat: float, poi_lon: float, poi_lat: float) -> float:
    dx = poi_lon - anchor_lon
    dy = poi_lat - anchor_lat

    if direction == "east":
        return dx
    if direction == "west":
        return -dx
    if direction == "north":
        return dy
    if direction == "south":
        return -dy
    return 0.0


def filter_pois_by_direction(
    pois: List[Dict[str, Any]],
    *,
    direction: str | None,
    anchor: Any = None,
    limit: int | None = None,
) -> List[Dict[str, Any]]:
    """Filter/sort POIs by requested direction relative to anchor."""
    if not pois:
        return pois

    normalized_direction = normalize_direction(direction)
    if normalized_direction is None:
        return pois

    anchor_point = _resolve_anchor(anchor, pois)
    if anchor_point is None:
        return pois

    anchor_lon, anchor_lat = anchor_point
    scored: List[Tuple[float, Dict[str, Any]]] = []

    for poi in pois:
        lon = _to_float(poi.get("lon"))
        lat = _to_float(poi.get("lat"))
        if lon is None or lat is None:
            continue

        score = _direction_score(normalized_direction, anchor_lon, anchor_lat, lon, lat)
        scored.append((score, poi))

    if not scored:
        return pois

    positives = [(score, poi) for score, poi in scored if score > 0]
    if positives:
        positives.sort(key=lambda item: item[0], reverse=True)
        result = [poi for _, poi in positives]
    else:
        # If no strict directional positives exist, keep closest directional ordering as fallback.
        scored.sort(key=lambda item: item[0], reverse=True)
        keep = max(1, len(scored) // 2)
        result = [poi for _, poi in scored[:keep]]

    if limit is not None and limit > 0:
        return result[:limit]

    return result
