"""H3 aggregation helper with graceful fallback when h3 package is unavailable."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Tuple

try:
    import h3  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    h3 = None


def _fallback_cell_id(lon: float, lat: float, resolution: int) -> str:
    """Fallback spatial key when h3 library is unavailable."""
    # Map H3-like resolution to decimal precision for deterministic grid buckets.
    decimals = max(2, min(7, resolution - 3))
    return f"grid:{round(lon, decimals)}:{round(lat, decimals)}"


def aggregate_pois_h3(
    pois: List[Dict[str, Any]],
    *,
    resolution: int,
    max_cells: int = 80,
) -> Dict[str, Any]:
    """Aggregate POIs into H3 cells (or deterministic fallback grid)."""
    cell_counts: Counter[str] = Counter()
    cell_categories: Dict[str, Counter[str]] = defaultdict(Counter)

    for poi in pois:
        lon = poi.get("lon")
        lat = poi.get("lat")
        if lon is None or lat is None:
            continue

        try:
            lon_f = float(lon)
            lat_f = float(lat)
        except (TypeError, ValueError):
            continue

        if h3 is not None:
            try:
                cell_id = h3.latlng_to_cell(lat_f, lon_f, int(resolution))
            except Exception:
                cell_id = _fallback_cell_id(lon_f, lat_f, int(resolution))
        else:
            cell_id = _fallback_cell_id(lon_f, lat_f, int(resolution))

        cell_counts[cell_id] += 1

        category = (
            poi.get("category_small")
            or poi.get("category_mid")
            or poi.get("category_big")
            or poi.get("type")
            or "unknown"
        )
        cell_categories[cell_id][str(category)] += 1

    cells = []
    for cell_id, count in cell_counts.most_common(max_cells):
        dominant_category, dominant_count = cell_categories[cell_id].most_common(1)[0]
        cells.append(
            {
                "cell": cell_id,
                "count": int(count),
                "dominant_category": dominant_category,
                "dominant_count": int(dominant_count),
            }
        )

    return {
        "engine": "h3" if h3 is not None else "grid_fallback",
        "resolution": int(resolution),
        "cells": cells,
    }


def preaggregate_coordinates_h3(
    coordinates: Iterable[Tuple[float, float]],
    *,
    resolution: int,
) -> Dict[str, Any]:
    """Pre-aggregate coordinates by H3/grid cell for faster clustering."""
    cell_buckets: Dict[str, Dict[str, Any]] = {}
    engine = "h3" if h3 is not None else "grid_fallback"

    for idx, coordinate in enumerate(coordinates):
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            continue
        try:
            lon = float(coordinate[0])
            lat = float(coordinate[1])
        except (TypeError, ValueError):
            continue

        if h3 is not None:
            try:
                cell_id = h3.latlng_to_cell(lat, lon, int(resolution))
            except Exception:
                cell_id = _fallback_cell_id(lon, lat, int(resolution))
                engine = "grid_fallback"
        else:
            cell_id = _fallback_cell_id(lon, lat, int(resolution))

        bucket = cell_buckets.setdefault(
            cell_id,
            {
                "sum_lon": 0.0,
                "sum_lat": 0.0,
                "indices": [],
            },
        )
        bucket["sum_lon"] += lon
        bucket["sum_lat"] += lat
        bucket["indices"].append(int(idx))

    if not cell_buckets:
        return {
            "engine": engine,
            "resolution": int(resolution),
            "cell_count": 0,
            "points": [],
            "weights": [],
            "members": [],
        }

    ordered_cells = sorted(
        cell_buckets.items(),
        key=lambda item: (-len(item[1]["indices"]), str(item[0])),
    )

    points: List[Tuple[float, float]] = []
    weights: List[int] = []
    members: List[List[int]] = []
    for _cell_id, bucket in ordered_cells:
        indices = list(bucket.get("indices") or [])
        if not indices:
            continue
        count = len(indices)
        points.append((float(bucket["sum_lon"]) / count, float(bucket["sum_lat"]) / count))
        weights.append(int(count))
        members.append(indices)

    return {
        "engine": engine,
        "resolution": int(resolution),
        "cell_count": len(points),
        "points": points,
        "weights": weights,
        "members": members,
    }
