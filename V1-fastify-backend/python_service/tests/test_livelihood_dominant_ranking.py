import sys
from pathlib import Path


PYTHON_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_SERVICE_ROOT))

from pipeline import spatial_pipeline as spatial_module


def test_resolve_livelihood_primary_maps_charging_service_to_mobility():
    poi = {
        "category_big": "生活服务",
        "category_mid": "共享服务",
        "category_small": "共享充电宝",
        "type": "共享充电宝",
    }

    assert spatial_module._resolve_livelihood_primary_category(poi) == "行"


def test_build_livelihood_profile_prefers_learning_over_low_signal_labels():
    cluster_pois = []
    for _ in range(8):
        cluster_pois.append(
            {
                "category_big": "教育科研",
                "category_mid": "高等院校",
                "category_small": "大学",
                "type": "大学",
            }
        )
    for _ in range(5):
        cluster_pois.append(
            {
                "category_big": "生活服务",
                "category_mid": "便民服务",
                "category_small": "共享充电宝",
                "type": "共享充电宝",
            }
        )
    for _ in range(4):
        cluster_pois.append(
            {
                "category_big": "设施",
                "category_mid": "交通设施",
                "category_small": "出入口",
                "type": "出入口",
            }
        )

    profile = spatial_module._build_livelihood_profile(cluster_pois)

    assert profile["dominant_primary"] == "学习"
    assert profile["primary_categories"][0]["category"] == "学习"
    assert profile["secondary_top"][0]["category"] == "大学"
    assert float(profile["low_signal_ratio"]) > 0.2

