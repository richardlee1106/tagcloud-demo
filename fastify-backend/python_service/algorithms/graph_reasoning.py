"""????????

?????
1) ????? Node ???????????
2) ??????? O(n^2) ??????
3) ??????????????????
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any, Dict, List, Set, Tuple


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """????????????"""
    radius_m = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_m * c


def _empty_result(distance_threshold_m: float) -> Dict[str, Any]:
    """?????????? API ???"""
    return {
        "node_count": 0,
        "edge_count": 0,
        "component_count": 0,
        "components": [],
        "top_hubs": [],
        "avg_degree": 0.0,
        "distance_threshold_m": float(distance_threshold_m),
    }


def _grid_steps(distance_threshold_m: float, lat_ref: float) -> Tuple[float, float]:
    """?????????????????"""
    meters_per_degree_lat = 111_320.0
    cos_lat = abs(math.cos(math.radians(lat_ref)))
    # ????????????????????????????????
    meters_per_degree_lon = meters_per_degree_lat * max(0.2, cos_lat)

    lat_step = max(distance_threshold_m / meters_per_degree_lat, 1e-6)
    lon_step = max(distance_threshold_m / meters_per_degree_lon, 1e-6)
    return lon_step, lat_step


def _cell_key(lon: float, lat: float, lon_step: float, lat_step: float) -> Tuple[int, int]:
    """?????????????"""
    return (int(math.floor(lon / lon_step)), int(math.floor(lat / lat_step)))


def analyze_spatial_graph(
    pois: List[Dict[str, Any]],
    *,
    distance_threshold_m: float = 280.0,
    max_nodes: int = 450,
) -> Dict[str, Any]:
    """????????????????

    ?????
    - ??????????
    - ???????????
    - ??? haversine ?????????
    """
    if distance_threshold_m <= 0:
        return _empty_result(distance_threshold_m)

    normalized_nodes: List[Tuple[Dict[str, Any], float, float]] = []
    capped = pois[: max(1, int(max_nodes))]

    for poi in capped:
        lon = poi.get("lon")
        lat = poi.get("lat")
        if lon is None or lat is None:
            continue

        try:
            node_lon = float(lon)
            node_lat = float(lat)
        except (TypeError, ValueError):
            continue

        normalized_nodes.append((poi, node_lon, node_lat))

    if not normalized_nodes:
        return _empty_result(distance_threshold_m)

    node_count = len(normalized_nodes)
    if node_count == 1:
        return {
            "node_count": 1,
            "edge_count": 0,
            "component_count": 1,
            "components": [1],
            "top_hubs": [],
            "avg_degree": 0.0,
            "distance_threshold_m": float(distance_threshold_m),
        }

    poi_refs = [node[0] for node in normalized_nodes]
    lons = [node[1] for node in normalized_nodes]
    lats = [node[2] for node in normalized_nodes]

    lat_ref = sum(lats) / node_count
    lon_step, lat_step = _grid_steps(float(distance_threshold_m), lat_ref)

    # ????????? cell key????????? floor ???
    cell_keys: List[Tuple[int, int]] = [_cell_key(lons[idx], lats[idx], lon_step, lat_step) for idx in range(node_count)]

    # ?????????????????
    grid: Dict[Tuple[int, int], List[int]] = {}
    for idx, key in enumerate(cell_keys):
        bucket = grid.get(key)
        if bucket is None:
            grid[key] = [idx]
        else:
            bucket.append(idx)

    adjacency: List[Set[int]] = [set() for _ in range(node_count)]
    neighbor_offsets = (
        (-1, -1),
        (-1, 0),
        (-1, 1),
        (0, -1),
        (0, 0),
        (0, 1),
        (1, -1),
        (1, 0),
        (1, 1),
    )

    # ????????????????????? O(n * k)?k ??????
    for i in range(node_count):
        lon_i = lons[i]
        lat_i = lats[i]
        cell_x, cell_y = cell_keys[i]

        for dx, dy in neighbor_offsets:
            bucket = grid.get((cell_x + dx, cell_y + dy))
            if not bucket:
                continue

            for j in bucket:
                if j <= i:
                    continue

                # ?????????????????? haversine ???
                if abs(lats[j] - lat_i) > lat_step:
                    continue
                if abs(lons[j] - lon_i) > lon_step:
                    continue

                if _haversine_m(lat_i, lon_i, lats[j], lons[j]) <= distance_threshold_m:
                    adjacency[i].add(j)
                    adjacency[j].add(i)

    visited = [False] * node_count
    component_sizes: List[int] = []

    for start in range(node_count):
        if visited[start]:
            continue

        queue: deque[int] = deque([start])
        visited[start] = True
        component_size = 0

        while queue:
            current = queue.popleft()
            component_size += 1
            for neighbor in adjacency[current]:
                if not visited[neighbor]:
                    visited[neighbor] = True
                    queue.append(neighbor)

        component_sizes.append(component_size)

    edge_count = sum(len(neighbors) for neighbors in adjacency) // 2

    degree_pairs: List[Tuple[int, Dict[str, Any], int]] = [
        (idx, poi_refs[idx], len(adjacency[idx]))
        for idx in range(node_count)
    ]
    degree_pairs.sort(key=lambda item: item[2], reverse=True)

    top_hubs = [
        {
            "id": item[1].get("id"),
            "name": item[1].get("name"),
            "category": (
                item[1].get("category_small")
                or item[1].get("category_mid")
                or item[1].get("category_big")
                or item[1].get("type")
                or "mixed"
            ),
            "degree": item[2],
        }
        for item in degree_pairs[:8]
        if item[2] > 0
    ]

    avg_degree = round((2 * edge_count / node_count) if node_count else 0.0, 3)

    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "component_count": len(component_sizes),
        "components": sorted(component_sizes, reverse=True)[:12],
        "top_hubs": top_hubs,
        "avg_degree": avg_degree,
        "distance_threshold_m": float(distance_threshold_m),
    }
