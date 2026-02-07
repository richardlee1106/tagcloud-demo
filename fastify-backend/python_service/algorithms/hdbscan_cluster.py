"""HDBSCAN clustering wrapper with DBSCAN fallback."""

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
    """Normalized cluster output used by the Python spatial pipeline."""

    labels: List[int]
    cluster_count: int
    noise_count: int
    engine: str


def cluster_points(
    coordinates: Iterable[tuple[float, float]],
    *,
    min_cluster_size: int = 12,
    min_samples: int = 6,
) -> ClusterResult:
    """Cluster point coordinates with HDBSCAN and DBSCAN fallback."""
    points = np.asarray(list(coordinates), dtype=np.float64)
    if points.size == 0:
        return ClusterResult(labels=[], cluster_count=0, noise_count=0, engine="none")

    if len(points) < max(4, min_samples):
        return ClusterResult(
            labels=[-1 for _ in range(len(points))],
            cluster_count=0,
            noise_count=len(points),
            engine="none",
        )

    if hdbscan is not None:
        engine = "hdbscan"
        model = hdbscan.HDBSCAN(
            min_cluster_size=max(2, min_cluster_size),
            min_samples=max(1, min_samples),
            cluster_selection_method="eom",
        )
        labels = model.fit_predict(points)
    else:
        engine = "dbscan_fallback"
        # Roughly ~200m in lat/lon degrees.
        model = DBSCAN(eps=0.002, min_samples=max(2, min_samples))
        labels = model.fit_predict(points)

    labels_list = labels.tolist()
    unique_clusters = {label for label in labels_list if label >= 0}
    noise_count = len([label for label in labels_list if label < 0])

    return ClusterResult(
        labels=labels_list,
        cluster_count=len(unique_clusters),
        noise_count=noise_count,
        engine=engine,
    )
