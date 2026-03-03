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

    adaptive_cluster = int(max(min_cluster_size, min(80, min_cluster_size + math.log1p(point_count) * 1.5)))

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
    sample_weights: Iterable[float] | None = None,
    min_cluster_size: int = 12,
    min_samples: int = 6,
    adaptive: bool = True,
    max_hdbscan_points: int = 14000,
    core_dist_n_jobs: int = -1,
) -> ClusterResult:
    """Cluster point coordinates with adaptive HDBSCAN and DBSCAN fallback."""
    points = np.asarray(list(coordinates), dtype=np.float64)
    point_count = len(points)

    weights_array: np.ndarray | None = None
    if sample_weights is not None:
        try:
            candidate_weights = np.asarray(list(sample_weights), dtype=np.float64)
            if len(candidate_weights) == point_count:
                weights_array = candidate_weights
        except Exception:
            weights_array = None

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

    use_hdbscan = hdbscan is not None and point_count <= max_hdbscan_points

    if use_hdbscan:
        engine = "hdbscan_weighted" if weights_array is not None else "hdbscan"
        model = hdbscan.HDBSCAN(
            min_cluster_size=effective_cluster_size,
            min_samples=effective_samples,
            cluster_selection_method="eom",
            approx_min_span_tree=True,
            core_dist_n_jobs=int(core_dist_n_jobs),
        )
        if weights_array is not None:
            try:
                model.fit(points, sample_weight=weights_array)
                labels = model.labels_
            except TypeError:
                labels = model.fit_predict(points)
        else:
            labels = model.fit_predict(points)
    else:
        eps = 0.0018 if point_count <= 20000 else 0.0022
        if point_count > max_hdbscan_points:
            engine = "dbscan_large_weighted" if weights_array is not None else "dbscan_large"
        else:
            engine = "dbscan_fallback_weighted" if weights_array is not None else "dbscan_fallback"
        model = DBSCAN(eps=eps, min_samples=max(2, effective_samples))
        if weights_array is not None:
            try:
                labels = model.fit_predict(points, sample_weight=weights_array)
            except TypeError:
                labels = model.fit_predict(points)
        else:
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
