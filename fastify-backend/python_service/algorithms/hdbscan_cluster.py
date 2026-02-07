"""HDBSCAN 聚类封装。

策略：
- 优先使用 HDBSCAN（更适合密度不均匀数据）。
- 环境缺依赖时降级到 DBSCAN，保证功能可用。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

import numpy as np
from sklearn.cluster import DBSCAN

try:
    import hdbscan  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    hdbscan = None


@dataclass
class ClusterResult:
    """聚类输出结构。"""

    labels: List[int]
    cluster_count: int


def cluster_points(
    coordinates: Iterable[tuple[float, float]],
    *,
    min_cluster_size: int = 12,
    min_samples: int = 6,
) -> ClusterResult:
    """对坐标点执行聚类。"""
    points = np.asarray(list(coordinates), dtype=np.float64)
    if points.size == 0:
        return ClusterResult(labels=[], cluster_count=0)

    if len(points) < max(4, min_samples):
        return ClusterResult(labels=[-1 for _ in range(len(points))], cluster_count=0)

    if hdbscan is not None:
        model = hdbscan.HDBSCAN(
            min_cluster_size=max(2, min_cluster_size),
            min_samples=max(1, min_samples),
            cluster_selection_method="eom",
        )
        labels = model.fit_predict(points)
    else:
        # 兜底参数：经纬度近似下约 200m 的 eps。
        eps = 0.002
        model = DBSCAN(eps=eps, min_samples=max(2, min_samples))
        labels = model.fit_predict(points)

    unique_clusters = {label for label in labels.tolist() if label >= 0}
    return ClusterResult(labels=labels.tolist(), cluster_count=len(unique_clusters))
