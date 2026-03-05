import sys
from pathlib import Path


PYTHON_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_SERVICE_ROOT))

from pipeline import spatial_pipeline as spatial_module


def test_undersegmentation_guard_flags_large_view_and_requests_dedup_restore():
    verdict = spatial_module._evaluate_undersegmentation_guard(
        enabled=True,
        area_km2=45.7,
        total_candidates=420,
        cluster_count=2,
        min_regions=5,
        dedup_before_count=8,
        dedup_after_count=2,
        dedup_removed_count=6,
        dedup_removed_ratio=0.75,
    )

    assert verdict["risk"] is True
    assert verdict["reason"] == "cluster_count_below_min_regions"
    assert verdict["should_restore_pre_dedup"] is True
    assert "dedup_excessive" in verdict["signals"]


def test_undersegmentation_guard_stays_clean_for_small_or_dense_view():
    verdict = spatial_module._evaluate_undersegmentation_guard(
        enabled=True,
        area_km2=4.2,
        total_candidates=96,
        cluster_count=6,
        min_regions=5,
        dedup_before_count=6,
        dedup_after_count=6,
        dedup_removed_count=0,
        dedup_removed_ratio=0.0,
    )

    assert verdict["risk"] is False
    assert verdict["should_restore_pre_dedup"] is False
    assert verdict["signals"] == []

