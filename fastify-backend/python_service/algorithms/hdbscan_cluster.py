"""HDBSCAN clustering wrapper with adaptive strategy and DBSCAN fallback."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Tuple

import numpy as np
from sklearn.cluster import DBSCAN

try:
    import hdbscan  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    hdbscan = None


@dataclass
class ClusterResult:
    """Normalized cluster output used by the Python spatial pipeline."""

    labels: List[int]
    cluster_count: int
    noise_count: int
    engine: str
    effective_min_cluster_size: int
    effective_min_samples: int
    input_point_count: int


def _bbox_span(points: np.ndarray) -> Tuple[float, float]:
    """Return lon/lat span for adaptive parameter estimation."""
    if points.size == 0:
        return 0.0, 0.0
    lon_span = float(np.max(points[:, 0]) - np.min(points[:, 0]))
    lat_span = float(np.max(points[:, 1]) - np.min(points[:, 1]))
    return lon_span, lat_span


def _resolve_cluster_params(
    points: np.ndarray,
    *,
    min_cluster_size: int,
    min_samples: int,
    adaptive: bool,
) -> Tuple[int, int]:
    """Resolve effective cluster parameters by point scale."""
    if points.size == 0:
        return max(2, int(min_cluster_size)), max(1, int(min_samples))

    if not adaptive:
        return max(2, int(min_cluster_size)), max(1, int(min_samples))

    point_count = len(points)
    lon_span, lat_span = _bbox_span(points)
    area = max(lon_span * lat_span, 1e-8)
    density = point_count / area

    # 基于样本规模自适应放大 min_cluster_size，但要非常克制，避免滤掉大型低密度实体
    # 改为使用 math.log1p 而非 sqrt，这样 1000 点也就加 7 个，10000 点加 9 个。
    adaptive_cluster = int(max(min_cluster_size, min(80, min_cluster_size + math.log1p(point_count) * 1.5)))

    # 基于点密度自适应 min_samples，并保证不低于传入下限
    if density > 800_000:
        adaptive_samples = max(min_samples, 8)
    elif density > 250_000:
        adaptive_samples = max(min_samples, 6)
    else:
        adaptive_samples = max(min_samples, 3)

    return max(2, adaptive_cluster), max(1, adaptive_samples)


def cluster_points(
    coordinates: Iterable[tuple[float, float]],
    *,
    min_cluster_size: int = 12,
    min_samples: int = 6,
    adaptive: bool = True,
    max_hdbscan_points: int = 14000,
) -> ClusterResult:
    """Cluster point coordinates with adaptive HDBSCAN and DBSCAN fallback."""
    points = np.asarray(list(coordinates), dtype=np.float64)
    point_count = len(points)
    if points.size == 0:
        return ClusterResult(
            labels=[],
            cluster_count=0,
            noise_count=0,
            engine="none",
            effective_min_cluster_size=max(2, int(min_cluster_size)),
            effective_min_samples=max(1, int(min_samples)),
            input_point_count=0,
        )

    effective_cluster_size, effective_samples = _resolve_cluster_params(
        points,
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        adaptive=adaptive,
    )

    if point_count < max(4, effective_samples):
        return ClusterResult(
            labels=[-1 for _ in range(point_count)],
            cluster_count=0,
            noise_count=point_count,
            engine="none",
            effective_min_cluster_size=effective_cluster_size,
            effective_min_samples=effective_samples,
            input_point_count=point_count,
        )

    # 点数过大或缺少依赖时，使用 DBSCAN 作为 HDBSCAN 的回退方案
    use_hdbscan = hdbscan is not None and point_count <= max_hdbscan_points

    if use_hdbscan:
        engine = "hdbscan"
        model = hdbscan.HDBSCAN(
            min_cluster_size=effective_cluster_size,
            min_samples=effective_samples,
            cluster_selection_method="eom",
            approx_min_span_tree=True,
            core_dist_n_jobs=1,
        )
        labels = model.fit_predict(points)
    else:
        # 大样本场景适度放宽 eps，降低过度噪声标记
        eps = 0.0018 if point_count <= 20000 else 0.0022
        engine = "dbscan_large" if point_count > max_hdbscan_points else "dbscan_fallback"
        model = DBSCAN(eps=eps, min_samples=max(2, effective_samples))
        labels = model.fit_predict(points)

    labels_list = labels.tolist()
    unique_clusters = {label for label in labels_list if label >= 0}
    noise_count = len([label for label in labels_list if label < 0])

    return ClusterResult(
        labels=labels_list,
        cluster_count=len(unique_clusters),
        noise_count=noise_count,
        engine=engine,
        effective_min_cluster_size=effective_cluster_size,
        effective_min_samples=effective_samples,
        input_point_count=point_count,
    )
