"""??????????

?????
1) ? Python ????? graph_reasoning ???????
2) ??? POI ???????????????????????
3) ???????????????? Node ??????
"""

from __future__ import annotations

import math
from collections import defaultdict, deque
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
    """???????????????????"""
    return {
        "node_count": 0,
        "edge_count": 0,
        "component_count": 0,
        "components": [],
        "top_hubs": [],
        "avg_degree": 0.0,
        "distance_threshold_m": distance_threshold_m,
    }


def analyze_spatial_graph(
    pois: List[Dict[str, Any]],
    *,
    distance_threshold_m: float = 280.0,
    max_nodes: int = 450,
) -> Dict[str, Any]:
    """??????? POI ????????/?????"""
    nodes: List[Tuple[int, Dict[str, Any], float, float]] = []

    for index, poi in enumerate(pois[:max_nodes]):
        lon = poi.get("lon")
        lat = poi.get("lat")
        if lon is None or lat is None:
            continue

        try:
            nodes.append((index, poi, float(lon), float(lat)))
        except (TypeError, ValueError):
            continue

    if not nodes:
        return _empty_result(distance_threshold_m)

    adjacency: Dict[int, Set[int]] = defaultdict(set)

    # ?? O(n^2) ??????? max_nodes ?????????
    for i in range(len(nodes)):
        idx_i, _poi_i, lon_i, lat_i = nodes[i]
        for j in range(i + 1, len(nodes)):
            idx_j, _poi_j, lon_j, lat_j = nodes[j]
            if _haversine_m(lat_i, lon_i, lat_j, lon_j) <= distance_threshold_m:
                adjacency[idx_i].add(idx_j)
                adjacency[idx_j].add(idx_i)

    visited: Set[int] = set()
    component_sizes: List[int] = []

    for idx, _poi, _lon, _lat in nodes:
        if idx in visited:
            continue

        queue: deque[int] = deque([idx])
        visited.add(idx)
        component_size = 0

        while queue:
            current = queue.popleft()
            component_size += 1
            for neighbor in adjacency.get(current, set()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        component_sizes.append(component_size)

    edge_count = sum(len(neighbors) for neighbors in adjacency.values()) // 2

    degree_pairs: List[Tuple[int, Dict[str, Any], int]] = []
    for idx, poi, _lon, _lat in nodes:
        degree_pairs.append((idx, poi, len(adjacency.get(idx, set()))))

    degree_pairs.sort(key=lambda item: item[2], reverse=True)
    top_hubs = [
        {
            "id": item[1].get("id"),
            "name": item[1].get("name"),
            "degree": item[2],
        }
        for item in degree_pairs[:8]
        if item[2] > 0
    ]

    node_count = len(nodes)
    avg_degree = round((2 * edge_count / node_count) if node_count else 0.0, 3)

    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "component_count": len(component_sizes),
        "components": sorted(component_sizes, reverse=True)[:12],
        "top_hubs": top_hubs,
        "avg_degree": avg_degree,
        "distance_threshold_m": distance_threshold_m,
    }
