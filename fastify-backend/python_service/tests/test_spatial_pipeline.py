import json
import math
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

PYTHON_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_SERVICE_ROOT))

from algorithms.alpha_shape import build_alpha_shape
from algorithms.membership import compute_membership
from pipeline import (
    boundary_builder,
    confidence_scorer,
    context_loader,
    poi_quality_scorer,
    result_assembler,
    semantic_reasoner,
)
from pipeline import spatial_pipeline as spatial_module
from pipeline.spatial_pipeline import SpatialPipeline
from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree


class _StubRepository:
    def __init__(self, pois=None, roads=None, landuse=None):
        self._pois = list(pois or [])
        self._roads = list(roads or [])
        self._landuse = list(landuse or [])

    def fetch_pois(self, **_kwargs):
        return list(self._pois)

    def fetch_roads(self, **_kwargs):
        return list(self._roads)

    def fetch_landuse(self, **_kwargs):
        return list(self._landuse)


class _TermFallbackRepository(_StubRepository):
    def __init__(self, pois=None):
        super().__init__(pois=pois)
        self.fetch_calls = []

    def fetch_pois(self, **kwargs):
        terms = list(kwargs.get("terms") or [])
        self.fetch_calls.append({"terms": terms})
        if terms:
            return []
        return list(self._pois)


class _CategoryCaptureRepository(_StubRepository):
    def __init__(self, pois=None):
        super().__init__(pois=pois)
        self.fetch_calls = []

    def fetch_pois(self, **kwargs):
        self.fetch_calls.append(
            {
                "categories": list(kwargs.get("categories") or []),
                "terms": list(kwargs.get("terms") or []),
            }
        )
        return list(self._pois)


def _rect(min_lon, min_lat, max_lon, max_lat):
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [min_lon, min_lat],
                [max_lon, min_lat],
                [max_lon, max_lat],
                [min_lon, max_lat],
                [min_lon, min_lat],
            ]
        ],
    }


class _V5AnchorBypassRepository(_StubRepository):
    def __init__(self):
        super().__init__(pois=[])
        self.fetch_calls = []
        self.spatial_join_calls = []
        self.base_pois = self._build_base_pois()
        self.anchor_pois = self._build_anchor_pois()

    @staticmethod
    def _build_base_pois():
        rows = []
        for idx in range(24):
            rows.append(
                {
                    "id": idx + 1,
                    "name": f"store-{idx + 1}",
                    "address": f"base-{idx + 1}",
                    "type": "餐饮服务",
                    "category_big": "category",
                    "category_mid": "sub_category",
                    "category_small": "餐厅",
                    "rating": 4.0,
                    "lon": 114.335 + (idx % 6) * 0.00035,
                    "lat": 30.582 + (idx // 6) * 0.00035,
                    "block_id": 11,
                    "aoi_name": "漫时区商务区",
                    "aoi_type": "商务办公",
                    "land_type": "商业服务用地",
                }
            )
        return rows

    @staticmethod
    def _build_anchor_pois():
        rows = []
        for idx in range(12):
            rows.append(
                {
                    "id": 1000 + idx + 1,
                    "name": f"hbu-teaching-{idx + 1}",
                    "address": f"hbu-{idx + 1}",
                    "type": "大学",
                    "category_big": "教育科研",
                    "category_mid": "education",
                    "category_small": "大学",
                    "rating": 4.2,
                    "lon": 114.318 + (idx % 4) * 0.00035,
                    "lat": 30.589 + (idx // 4) * 0.00035,
                    "block_id": 22,
                    "aoi_name": "湖北大学校区",
                    "aoi_type": "campus",
                    "land_type": "教育科研用地",
                }
            )
        return rows

    def fetch_pois(self, **kwargs):
        self.fetch_calls.append(
            {
                "categories": list(kwargs.get("categories") or []),
                "terms": list(kwargs.get("terms") or []),
            }
        )
        categories = [str(item).strip() for item in (kwargs.get("categories") or []) if str(item).strip()]
        if categories:
            return list(self.base_pois)
        return list(self.base_pois + self.anchor_pois)

    def fetch_road_blocks(self, **_kwargs):
        return [
            {
                "block_id": 11,
                "shape_area": 120000.0,
                "area_m2": 120000.0,
                "geometry_geojson": _rect(114.3345, 30.5815, 114.3385, 30.5855),
            },
            {
                "block_id": 22,
                "shape_area": 240000.0,
                "area_m2": 240000.0,
                "geometry_geojson": _rect(114.3165, 30.5875, 114.3235, 30.5945),
            },
        ]

    def fetch_osm_aoi(self, **_kwargs):
        return [
            {
                "aoi_id": 1,
                "name": "湖北大学校区",
                "type": "campus",
                "area_m2": 300000.0,
                "geometry_geojson": _rect(114.3160, 30.5870, 114.3240, 30.5950),
            }
        ]

    def fetch_euluc(self, **_kwargs):
        return [
            {
                "euluc_id": 1,
                "land_type": "教育科研用地",
                "area_m2": 280000.0,
                "geometry_geojson": _rect(114.3160, 30.5870, 114.3240, 30.5950),
            }
        ]

    def spatial_join_pois(self, **kwargs):
        categories = [str(item).strip() for item in (kwargs.get("categories") or []) if str(item).strip()]
        terms = [str(item).strip() for item in (kwargs.get("terms") or []) if str(item).strip()]
        self.spatial_join_calls.append({"categories": categories, "terms": terms})

        if categories:
            return list(self.base_pois)

        joined_terms = " ".join(terms)
        if "湖北大学" in joined_terms:
            return list(self.anchor_pois)

        return list(self.base_pois + self.anchor_pois)


class _V5ForwardingRepository(_StubRepository):
    def __init__(self):
        pois = []
        for idx in range(18):
            pois.append(
                {
                    "id": idx + 1,
                    "name": f"forward-{idx + 1}",
                    "address": f"forward-{idx + 1}",
                    "type": "test",
                    "category_big": "test",
                    "category_mid": "test",
                    "category_small": "test",
                    "rating": 4.0,
                    "lon": 114.3200 + (idx % 6) * 0.0003,
                    "lat": 30.5800 + (idx // 6) * 0.0003,
                    "block_id": 10,
                    "aoi_name": "湖北大学",
                    "aoi_type": "campus",
                    "land_type": "教育科研用地",
                }
            )
        super().__init__(pois=pois, roads=[], landuse=[])

    def fetch_road_blocks(self, **_kwargs):
        return [
            {
                "block_id": 10,
                "shape_area": 120000.0,
                "area_m2": 120000.0,
                "geometry_geojson": _rect(114.3190, 30.5790, 114.3230, 30.5830),
            }
        ]

    def fetch_osm_aoi(self, **_kwargs):
        return [
            {
                "aoi_id": 1,
                "name": "湖北大学",
                "type": "campus",
                "area_m2": 200000.0,
                "geometry_geojson": _rect(114.3180, 30.5780, 114.3240, 30.5840),
            }
        ]

    def fetch_euluc(self, **_kwargs):
        return [
            {
                "euluc_id": 1,
                "land_type": "教育科研用地",
                "area_m2": 180000.0,
                "geometry_geojson": _rect(114.3180, 30.5780, 114.3240, 30.5840),
            }
        ]

    def spatial_join_pois(self, **_kwargs):
        return list(self._pois)


class _V5NoSecondQueryRepository(_StubRepository):
    def __init__(self):
        pois = []
        for idx in range(36):
            pois.append(
                {
                    "id": idx + 1,
                    "name": f"v5-{idx + 1}",
                    "address": f"v5-{idx + 1}",
                    "type": "test",
                    "category_big": "test",
                    "category_mid": "test",
                    "category_small": "test",
                    "rating": 4.0,
                    "lon": 114.3200 + (idx % 6) * 0.00025,
                    "lat": 30.5800 + (idx // 6) * 0.00025,
                    "block_id": None,
                    "aoi_name": None,
                    "aoi_type": None,
                    "land_type": None,
                }
            )
        super().__init__(pois=pois, roads=[], landuse=[])
        self.spatial_join_called = False

    def fetch_road_blocks(self, **_kwargs):
        return [
            {
                "block_id": 66,
                "shape_area": 150000.0,
                "area_m2": 150000.0,
                "geometry_geojson": _rect(114.3190, 30.5790, 114.3225, 30.5825),
            }
        ]

    def fetch_osm_aoi(self, **_kwargs):
        return [
            {
                "aoi_id": 1,
                "name": "test-aoi",
                "type": "商业",
                "area_m2": 220000.0,
                "geometry_geojson": _rect(114.3185, 30.5785, 114.3230, 30.5830),
            }
        ]

    def fetch_euluc(self, **_kwargs):
        return [
            {
                "euluc_id": 1,
                "land_type": "商业服务用地",
                "area_m2": 220000.0,
                "geometry_geojson": _rect(114.3185, 30.5785, 114.3230, 30.5830),
            }
        ]

    def spatial_join_pois(self, **_kwargs):
        self.spatial_join_called = True
        raise AssertionError("spatial_join_pois should not be called in V5 in-memory join path")

def _build_clustered_pois():
    centers = [
        (114.020, 30.520, "椁愰ギ"),
        (114.320, 30.520, "闆跺敭"),
        (114.170, 30.730, "鏂囧ū"),
    ]
    rows = []
    next_id = 1

    for lon0, lat0, category in centers:
        for i in range(60):
            dx = (i % 10) * 0.0011 + (i // 10) * 0.00007
            dy = (i // 10) * 0.0010 + (i % 10) * 0.00005
            rows.append(
                {
                    "id": next_id,
                    "name": f"{category}-{next_id}",
                    "address": f"addr-{next_id}",
                    "type": category,
                    "category_big": category,
                    "category_mid": category,
                    "category_small": category,
                    "rating": 4.0 + ((i % 5) * 0.1),
                    "lon": lon0 + dx,
                    "lat": lat0 + dy,
                }
            )
            next_id += 1

    # Mimic DB's deterministic id ordering (which previously led to "corner stacking" in top-N).
    return rows


def _build_collinear_pois():
    rows = []
    for idx in range(90):
        rows.append(
            {
                "id": idx + 1,
                "name": f"line-{idx + 1}",
                "address": f"line-addr-{idx + 1}",
                "type": "line-cluster",
                "category_big": "line-cluster",
                "category_mid": "line-cluster",
                "category_small": "line-cluster",
                "rating": 4.2,
                "lon": 114.12 + idx * 0.00085,
                "lat": 30.56 + idx * 0.00085,
            }
        )
    return rows


def _build_area_request(options=None):
    merged_options = {
        "limit": 1000,
        "maxFetchLimit": 1000,
    }
    if isinstance(options, dict):
        merged_options.update(options)

    return {
        "query_type": "area_analysis",
        "spatial_context": json.dumps(
            {
                "mode": "Viewport",
                "viewport": [113.95, 30.40, 114.45, 30.88],
            }
        ),
        "categories": [],
        "hints": json.dumps(
            {
                "semantic_query": "",
                "options": merged_options,
            }
        ),
        "candidates_json": "[]",
    }


def _build_edge_viewport_pois():
    rows = []
    next_id = 1
    lon0, lat0 = 114.4478, 30.5235
    for i in range(70):
        dx = (i % 10) * 0.00014 + (i // 10) * 0.00002
        dy = (i // 10) * 0.00038 + (i % 10) * 0.00003
        rows.append(
            {
                "id": next_id,
                "name": f"\u89c6\u91ce\u8fb9\u754cPOI-{next_id}",
                "address": f"edge-addr-{next_id}",
                "type": "\u5546\u4e1a",
                "category_big": "\u5546\u4e1a",
                "category_mid": "\u5546\u573a",
                "category_small": "\u96f6\u552e",
                "rating": 4.2,
                "lon": lon0 + dx,
                "lat": lat0 + dy,
            }
        )
        next_id += 1
    return rows


def _build_edge_viewport_request(options=None):
    merged_options = {
        "limit": 1000,
        "maxFetchLimit": 1000,
        "clusterMinClusterSize": 4,
        "clusterMinSamples": 2,
        "clusterAdaptive": False,
    }
    if isinstance(options, dict):
        merged_options.update(options)

    return {
        "query_type": "area_analysis",
        "spatial_context": json.dumps(
            {
                "mode": "Viewport",
                "viewport": [114.40, 30.50, 114.45, 30.55],
            }
        ),
        "categories": [],
        "hints": json.dumps(
            {
                "semantic_query": "",
                "options": merged_options,
            }
        ),
        "candidates_json": "[]",
    }


def _build_cluster_roads():
    return [
        {
            "id": 1,
            "geometry_geojson": {
                "type": "LineString",
                "coordinates": [[114.015, 30.515], [114.040, 30.540]],
            },
        },
        {
            "id": 2,
            "geometry_geojson": {
                "type": "LineString",
                "coordinates": [[114.315, 30.515], [114.340, 30.540]],
            },
        },
        {
            "id": 3,
            "geometry_geojson": {
                "type": "LineString",
                "coordinates": [[114.165, 30.725], [114.195, 30.755]],
            },
        },
    ]


def _build_cluster_landuse():
    return [
        {
            "id": 1,
            "properties": {"类别": "商业用地"},
            "geometry_geojson": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [114.012, 30.512],
                        [114.044, 30.512],
                        [114.044, 30.544],
                        [114.012, 30.544],
                        [114.012, 30.512],
                    ]
                ],
            },
        },
        {
            "id": 2,
            "properties": {"类别": "居住用地"},
            "geometry_geojson": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [114.312, 30.512],
                        [114.344, 30.512],
                        [114.344, 30.544],
                        [114.312, 30.544],
                        [114.312, 30.512],
                    ]
                ],
            },
        },
        {
            "id": 3,
            "properties": {"类别": "公园绿地"},
            "geometry_geojson": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [114.158, 30.718],
                        [114.202, 30.718],
                        [114.202, 30.762],
                        [114.158, 30.762],
                        [114.158, 30.718],
                    ]
                ],
            },
        },
    ]


def _build_semantic_niche_pois():
    clusters = [
        {
            "center": (114.260, 30.610),
            "category": "\u751f\u6001",
            "names": [
                "\u6c99\u6e56\u516c\u56ed\u505c\u8f66\u573aA\u53e3",
                "\u6c99\u6e56\u516c\u56ed\u505c\u8f66\u573aB\u53e3-1",
                "\u6c99\u6e56\u5c0f\u5356\u90e8",
                "\u6c99\u6e56\u516c\u56ed\u4e1c\u95e8",
            ],
        },
        {
            "center": (114.320, 30.560),
            "category": "\u5546\u4e1a",
            "names": [
                "\u9500\u54c1\u8302\u505c\u8f66\u573a",
                "\u9500\u54c1\u8302A\u5355\u5143",
                "\u4e09\u798f\u670d\u9970\u9500\u54c1\u8302\u5e97",
                "\u9500\u54c1\u8302\u5357\u95e8",
            ],
        },
        {
            "center": (114.360, 30.540),
            "category": "\u79d1\u6559",
            "names": [
                "\u6b66\u6c49\u5927\u5b66\u5357\u95e8",
                "\u6b66\u6c49\u5927\u5b66\u56fe\u4e66\u9986",
                "\u6b66\u6c49\u5927\u5b66\u4fe1\u606f\u5b66\u90e8",
                "\u6b66\u6c49\u5927\u5b66\u6821\u53cb\u4f1a",
            ],
        },
    ]

    rows = []
    next_id = 1
    for cluster in clusters:
        lon0, lat0 = cluster["center"]
        for i in range(40):
            dx = (i % 8) * 0.0011 + (i // 8) * 0.00012
            dy = (i // 8) * 0.0010 + (i % 8) * 0.00008
            rows.append(
                {
                    "id": next_id,
                    "name": cluster["names"][i % len(cluster["names"])],
                    "address": f"addr-{next_id}",
                    "type": cluster["category"],
                    "category_big": cluster["category"],
                    "category_mid": cluster["category"],
                    "category_small": cluster["category"],
                    "rating": 4.1 + ((i % 5) * 0.1),
                    "lon": lon0 + dx,
                    "lat": lat0 + dy,
                }
            )
            next_id += 1

    return rows


def _build_semantic_landuse():
    return [
        {
            "id": 101,
            "properties": {"\u7c7b\u522b": "\u6c34\u57df"},
            "geometry_geojson": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [114.250, 30.600],
                        [114.286, 30.600],
                        [114.286, 30.636],
                        [114.250, 30.636],
                        [114.250, 30.600],
                    ]
                ],
            },
        },
        {
            "id": 102,
            "properties": {"\u7c7b\u522b": "\u5546\u4e1a\u7528\u5730"},
            "geometry_geojson": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [114.310, 30.548],
                        [114.344, 30.548],
                        [114.344, 30.582],
                        [114.310, 30.582],
                        [114.310, 30.548],
                    ]
                ],
            },
        },
        {
            "id": 103,
            "properties": {"\u7c7b\u522b": "\u6559\u80b2\u79d1\u7814\u7528\u5730"},
            "geometry_geojson": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [114.350, 30.528],
                        [114.384, 30.528],
                        [114.384, 30.562],
                        [114.350, 30.562],
                        [114.350, 30.528],
                    ]
                ],
            },
        },
    ]


def _build_semantic_landuse_with_commerce_water():
    rows = list(_build_semantic_landuse())
    rows.append(
        {
            "id": 104,
            "properties": {"\u7c7b\u522b": "\u6c34\u57df"},
            "geometry_geojson": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [114.312, 30.548],
                        [114.344, 30.548],
                        [114.344, 30.582],
                        [114.312, 30.582],
                        [114.312, 30.548],
                    ]
                ],
            },
        }
    )
    return rows


def _build_city_prefix_pois():
    names = [
        "\u6b66\u6c49\u5927\u5b66\u5357\u95e8",
        "\u6b66\u6c49\u7406\u5de5\u5927\u5b66\u4e1c\u95e8",
        "\u6b66\u6c49\u79d1\u6280\u5927\u5b66\u56fe\u4e66\u9986",
        "\u6b66\u6c49\u5de5\u7a0b\u5927\u5b66\u4f53\u80b2\u9986",
    ]

    rows = []
    next_id = 1
    lon0, lat0 = 114.350, 30.545
    for i in range(80):
        dx = (i % 8) * 0.0010 + (i // 8) * 0.00011
        dy = (i // 8) * 0.00095 + (i % 8) * 0.00007
        rows.append(
            {
                "id": next_id,
                "name": names[i % len(names)],
                "address": f"edu-addr-{next_id}",
                "type": "\u79d1\u6559",
                "category_big": "\u79d1\u6559",
                "category_mid": "\u9ad8\u6821",
                "category_small": "\u5927\u5b66",
                "rating": 4.3,
                "lon": lon0 + dx,
                "lat": lat0 + dy,
            }
        )
        next_id += 1
    return rows


def _build_shahu_water_pois():
    rows = []
    for row in _build_semantic_niche_pois():
        item = dict(row)
        name = str(item.get("name") or "")
        if "\u6c99\u6e56" in name and not name.startswith("\u6b66\u6c49"):
            item["name"] = f"\u6b66\u6c49{name}"
        rows.append(item)
    return rows


def _build_hubei_university_pois():
    names = [
        "\u6e56\u5317\u5927\u5b66\u6b66\u660c\u6821\u533a\u6821\u56ed\u5361\u7ba1\u7406\u4e2d\u5fc3",
        "\u6e56\u5317\u5927\u5b66\u5317\u95e8",
        "\u6e56\u5317\u5927\u5b66\u56fe\u4e66\u9986",
        "\u6e56\u5317\u5927\u5b66\u6559\u4e00\u697c",
        "\u6e56\u5317\u5927\u5b66\u6559\u4e8c\u697c",
        "\u5f6d\u53a8(\u6e56\u5317\u5927\u5b66\u5e97)",
        "\u6e56\u5317\u5927\u5b66\u5468\u8fb9\u4fbf\u5229\u5e97",
    ]

    rows = []
    next_id = 1
    lon0, lat0 = 114.313, 30.590
    for i in range(120):
        dx = (i % 10) * 0.00085 + (i // 10) * 0.00006
        dy = (i // 10) * 0.00078 + (i % 10) * 0.00005
        rows.append(
            {
                "id": next_id,
                "name": names[i % len(names)],
                "address": f"hbu-addr-{next_id}",
                "type": "\u79d1\u6559",
                "category_big": "\u79d1\u6559",
                "category_mid": "\u9ad8\u6821",
                "category_small": "\u5927\u5b66",
                "rating": 4.2,
                "lon": lon0 + dx,
                "lat": lat0 + dy,
            }
        )
        next_id += 1
    return rows


class SpatialPipelineTest(unittest.TestCase):
    def test_visual_model_alias_keeps_2b(self):
        self.assertEqual(
            spatial_module._normalize_visual_model_name("qwen3.5-2b"),
            "qwen3.5-2b",
        )

    def test_poi_fetch_emits_final_event(self):
        pipeline = SpatialPipeline(repository=_StubRepository())

        request = {
            "query_type": "poi_fetch",
            "spatial_context": json.dumps(
                {
                    "mode": "Polygon",
                    "regions": [
                        {
                            "id": 1,
                            "kind": "polygon",
                            "wkt": "POLYGON((121.47 31.23,121.48 31.23,121.48 31.24,121.47 31.24,121.47 31.23))",
                        }
                    ],
                }
            ),
            "categories": ["food"],
            "hints": json.dumps(
                {
                    "semantic_query": "",
                    "options": {
                        "limit": 100,
                        "maxFetchLimit": 1000,
                    },
                }
            ),
            "candidates_json": "[]",
        }

        events = list(pipeline.run(request))

        self.assertTrue(any(event.get("type") == "FINAL" for event in events))

    def test_hotspots_and_regions_include_surface_polygons(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]

        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreater(len(hotspots), 0)
        self.assertTrue(all(isinstance(h.get("boundary"), list) and len(h.get("boundary")) >= 4 for h in hotspots))
        self.assertTrue(all(h.get("layers", {}).get("core", {}).get("boundary") for h in hotspots))
        for hotspot in hotspots:
            self.assertIsInstance(hotspot.get("boundary_confidence"), (int, float))
            self.assertGreaterEqual(float(hotspot.get("boundary_confidence", -1)), 0.0)
            self.assertLessEqual(float(hotspot.get("boundary_confidence", 2)), 1.0)
            self.assertTrue(str(hotspot.get("boundary_method") or ""))
            explain = hotspot.get("confidence_explain") or {}
            self.assertIn("layer_confidence", explain)
            self.assertIn("membership_confidence", explain)
            self.assertIn("method_confidence", explain)
            quality = hotspot.get("boundary_quality") or {}
            self.assertIn("coverage_ratio", quality)
            self.assertIn("area_ratio_to_hull", quality)
            self.assertIn("compactness", quality)
            self.assertIn("quality_score", quality)
            self.assertGreaterEqual(float(quality.get("coverage_ratio", -1)), 0.0)
            self.assertLessEqual(float(quality.get("coverage_ratio", 2)), 1.0)
            self.assertGreaterEqual(float(quality.get("quality_score", -1)), 0.0)
            self.assertLessEqual(float(quality.get("quality_score", 2)), 1.0)
            generation = hotspot.get("boundary_generation") or {}
            self.assertGreaterEqual(int(generation.get("attempts", 0)), 1)
            self.assertGreaterEqual(int(generation.get("alpha_attempts", 0)), 0)

        vernacular = results.get("vernacular_regions", [])
        self.assertGreater(len(vernacular), 0)
        self.assertTrue(all(vr.get("boundary") and isinstance(vr.get("boundary"), dict) for vr in vernacular))
        self.assertTrue(all(isinstance(vr.get("boundary_ring"), list) and len(vr.get("boundary_ring")) >= 4 for vr in vernacular))
        for region in vernacular:
            self.assertIsInstance(region.get("boundary_confidence"), (int, float))
            self.assertGreaterEqual(float(region.get("boundary_confidence", -1)), 0.0)
            self.assertLessEqual(float(region.get("boundary_confidence", 2)), 1.0)
            quality = region.get("boundary_quality") or {}
            self.assertIn("coverage_ratio", quality)
            self.assertIn("quality_score", quality)

        fuzzy = results.get("fuzzy_regions", [])
        self.assertGreater(len(fuzzy), 0)
        for region in fuzzy:
            layers = region.get("layers", {})
            self.assertTrue(isinstance(layers.get("outer", {}).get("boundary"), list) and len(layers["outer"]["boundary"]) >= 4)
            self.assertTrue(isinstance(layers.get("transition", {}).get("boundary"), list) and len(layers["transition"]["boundary"]) >= 4)
            self.assertTrue(isinstance(layers.get("core", {}).get("boundary"), list) and len(layers["core"]["boundary"]) >= 4)
            self.assertIsInstance(region.get("boundary_confidence"), (int, float))
            self.assertGreaterEqual(float(region.get("boundary_confidence", -1)), 0.0)
            self.assertLessEqual(float(region.get("boundary_confidence", 2)), 1.0)
            quality = region.get("boundary_quality") or {}
            self.assertIn("coverage_ratio", quality)
            self.assertIn("quality_score", quality)

        stats = results.get("stats", {})
        self.assertEqual(stats.get("boundary_confidence_model"), "composite_v5")
        self.assertEqual(stats.get("boundary_quality_model"), "coverage_area_compactness_v1")
        self.assertGreaterEqual(float(stats.get("avg_boundary_quality_score", -1)), 0.0)
        self.assertLessEqual(float(stats.get("avg_boundary_quality_score", 2)), 1.0)
        self.assertGreaterEqual(float(stats.get("avg_boundary_coverage", -1)), 0.0)
        self.assertLessEqual(float(stats.get("avg_boundary_coverage", 2)), 1.0)
        self.assertGreaterEqual(float(stats.get("boundary_quality_pass_rate", -1)), 0.0)
        self.assertLessEqual(float(stats.get("boundary_quality_pass_rate", 2)), 1.0)
        self.assertGreaterEqual(float(stats.get("avg_boundary_iterations", 0)), 1.0)

    def test_representative_pois_are_not_stacked_in_single_corner(self):
        centers = [
            (114.025, 30.525),
            (114.325, 30.525),
            (114.175, 30.735),
        ]
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        pois = final_payload["results"].get("pois", [])

        self.assertGreaterEqual(len(pois), 20)
        top20 = pois[:20]

        def nearest_center_index(lon, lat):
            best_idx = 0
            best_dist = float("inf")
            for idx, (c_lon, c_lat) in enumerate(centers):
                dist = math.hypot(lon - c_lon, lat - c_lat)
                if dist < best_dist:
                    best_dist = dist
                    best_idx = idx
            return best_idx

        covered_centers = {
            nearest_center_index(float(poi["lon"]), float(poi["lat"]))
            for poi in top20
            if poi.get("lon") is not None and poi.get("lat") is not None
        }

        # First-screen points should cover multiple high-value zones instead of one "corner".
        self.assertGreaterEqual(len(covered_centers), 2)

    def test_degenerate_line_clusters_still_emit_surface_boundaries(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_collinear_pois()))
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        hotspots = final_payload["results"].get("spatial_clusters", {}).get("hotspots", [])

        self.assertGreater(len(hotspots), 0)
        for hotspot in hotspots:
            boundary_ring = hotspot.get("boundary") or []
            self.assertIsInstance(boundary_ring, list)
            self.assertGreaterEqual(len(boundary_ring), 4)

            boundary = hotspot.get("boundary_geojson") or hotspot.get("boundary")
            if isinstance(boundary, dict):
                self.assertEqual(boundary.get("type"), "Polygon")

            method = str(hotspot.get("boundary_method") or "")
            self.assertNotEqual(method, "alpha_shape_invalid")

    def test_boundary_confidence_uses_poi_quality_model_v2(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertEqual(stats.get("boundary_confidence_model"), "composite_v5")
        self.assertIn("avg_poi_quality_score", stats)
        self.assertGreaterEqual(float(stats.get("avg_poi_quality_score", -1)), 0.0)
        self.assertLessEqual(float(stats.get("avg_poi_quality_score", 2)), 1.0)

        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreater(len(hotspots), 0)
        for hotspot in hotspots:
            explain = hotspot.get("confidence_explain") or {}
            self.assertEqual(explain.get("model"), "composite_v5")
            self.assertIn("poi_quality_confidence", explain)

    def test_boundary_quality_uses_road_v2_when_roads_available(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_clustered_pois(),
                roads=_build_cluster_roads(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertEqual(stats.get("boundary_quality_model"), "coverage_area_compactness_road_v2")

        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreater(len(hotspots), 0)
        for hotspot in hotspots:
            quality = hotspot.get("boundary_quality") or {}
            self.assertEqual(quality.get("model"), "coverage_area_compactness_road_v2")
            self.assertIn("road_alignment_score", quality)
            self.assertGreaterEqual(float(quality.get("road_alignment_score", -1)), 0.0)
            self.assertLessEqual(float(quality.get("road_alignment_score", 2)), 1.0)

    def test_boundary_quality_uses_landuse_v2_when_landuse_available(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_clustered_pois(),
                landuse=_build_cluster_landuse(),
            )
        )
        request = _build_area_request(options={"roadBoundaryEnhancement": False})
        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertEqual(stats.get("boundary_quality_model"), "coverage_area_compactness_landuse_v2")

        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreater(len(hotspots), 0)
        for hotspot in hotspots:
            quality = hotspot.get("boundary_quality") or {}
            self.assertEqual(quality.get("model"), "coverage_area_compactness_landuse_v2")
            self.assertIn("landuse_alignment_score", quality)
            self.assertGreaterEqual(float(quality.get("landuse_alignment_score", -1)), 0.0)
            self.assertLessEqual(float(quality.get("landuse_alignment_score", 2)), 1.0)

    def test_boundary_quality_uses_road_landuse_v3_when_both_available(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_clustered_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_cluster_landuse(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertEqual(stats.get("boundary_quality_model"), "coverage_area_compactness_road_landuse_v3")

        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreater(len(hotspots), 0)
        for hotspot in hotspots:
            quality = hotspot.get("boundary_quality") or {}
            self.assertEqual(quality.get("model"), "coverage_area_compactness_road_landuse_v3")
            self.assertIn("road_alignment_score", quality)
            self.assertIn("landuse_alignment_score", quality)

    def test_semantic_anchor_recognizes_ecology_commerce_education_niches(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_semantic_niche_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_semantic_landuse(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]

        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreaterEqual(len(hotspots), 3)

        niche_types = {
            str((item.get("niche_profile") or {}).get("niche_type"))
            for item in hotspots
            if item.get("niche_profile")
        }
        self.assertIn("ecology", niche_types)
        self.assertIn("commerce", niche_types)
        self.assertIn("education", niche_types)

        anchors = [item.get("semantic_anchor") or {} for item in hotspots]
        anchor_names = [str(anchor.get("name") or "") for anchor in anchors]
        self.assertTrue(any("\u6c99\u6e56" in name for name in anchor_names))
        self.assertTrue(any("\u9500\u54c1\u8302" in name for name in anchor_names))
        self.assertTrue(any("\u6b66\u6c49\u5927\u5b66" in name for name in anchor_names))

        stats = results.get("stats", {})
        self.assertEqual(stats.get("semantic_anchor_model"), "rule_hint_v1")
        self.assertGreaterEqual(float(stats.get("semantic_anchor_coverage", 0.0)), 0.8)
        niche_counts = stats.get("niche_type_counts") or {}
        self.assertGreaterEqual(int(niche_counts.get("ecology", 0)), 1)
        self.assertGreaterEqual(int(niche_counts.get("commerce", 0)), 1)
        self.assertGreaterEqual(int(niche_counts.get("education", 0)), 1)

    def test_boundary_confidence_uses_composite_v5_when_semantic_anchor_available(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_semantic_niche_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_semantic_landuse(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertEqual(stats.get("boundary_confidence_model"), "composite_v5")
        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreater(len(hotspots), 0)
        for hotspot in hotspots:
            explain = hotspot.get("confidence_explain") or {}
            self.assertEqual(explain.get("model"), "composite_v5")
            self.assertIn("semantic_anchor_confidence", explain)
            self.assertIn("niche_consistency_confidence", explain)

    def test_boundary_quality_applies_water_penalty_for_non_ecology_niche(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_semantic_niche_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_semantic_landuse_with_commerce_water(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]

        hotspots = results.get("spatial_clusters", {}).get("hotspots", [])
        self.assertGreater(len(hotspots), 0)

        penalized = [
            hotspot
            for hotspot in hotspots
            if float((hotspot.get("boundary_quality") or {}).get("water_penalty", 0.0)) > 0.0
        ]
        self.assertGreaterEqual(len(penalized), 1)

        for hotspot in penalized:
            niche_type = str((hotspot.get("niche_profile") or {}).get("niche_type") or "mixed")
            self.assertNotEqual(niche_type, "ecology")

            quality = hotspot.get("boundary_quality") or {}
            self.assertIn("water_overlap_ratio", quality)
            self.assertIn("water_penalty", quality)
            self.assertIn("quality_score_before_water_penalty", quality)
            self.assertGreater(float(quality.get("water_overlap_ratio", 0.0)), 0.0)
            self.assertGreater(float(quality.get("water_penalty", 0.0)), 0.0)
            self.assertLessEqual(
                float(quality.get("quality_score", 1.0)),
                float(quality.get("quality_score_before_water_penalty", 0.0)),
            )

        stats = results.get("stats", {})
        self.assertGreater(float(stats.get("avg_water_overlap_ratio", 0.0)), 0.0)
        self.assertGreater(float(stats.get("avg_water_penalty", 0.0)), 0.0)

    def test_semantic_anchor_does_not_use_city_level_name(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_city_prefix_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_semantic_landuse(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        hotspots = final_payload["results"].get("spatial_clusters", {}).get("hotspots", [])

        self.assertGreater(len(hotspots), 0)
        anchor_names = [str((item.get("semantic_anchor") or {}).get("name") or "") for item in hotspots]
        self.assertTrue(all(name != "\u6b66\u6c49" for name in anchor_names if name))

    def test_water_context_recovers_shahu_ecology_anchor(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_shahu_water_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_semantic_landuse(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        hotspots = final_payload["results"].get("spatial_clusters", {}).get("hotspots", [])

        self.assertGreater(len(hotspots), 0)
        shahu_region = next(
            (
                item
                for item in hotspots
                if "\u6c99\u6e56" in str((item.get("semantic_anchor") or {}).get("name") or "")
                or float((item.get("boundary_quality") or {}).get("water_overlap_ratio", 0.0)) > 0.08
            ),
            None,
        )
        self.assertIsNotNone(shahu_region)
        anchor_name = str((shahu_region.get("semantic_anchor") or {}).get("name") or "")
        niche_type = str((shahu_region.get("niche_profile") or {}).get("niche_type") or "")
        self.assertIn("\u6c99\u6e56", anchor_name)
        self.assertNotEqual(anchor_name, "\u6b66\u6c49")
        self.assertEqual(niche_type, "ecology")

    def test_semantic_anchor_recovers_hubei_university_campus_region(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_hubei_university_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_semantic_landuse(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        hotspots = final_payload["results"].get("spatial_clusters", {}).get("hotspots", [])

        self.assertGreater(len(hotspots), 0)
        target = next(
            (
                item
                for item in hotspots
                if "婀栧寳澶у" in str((item.get("semantic_anchor") or {}).get("name") or "")
                or "education" == str((item.get("niche_profile") or {}).get("niche_type") or "")
            ),
            None,
        )
        self.assertIsNotNone(target)
        anchor_name = str((target.get("semantic_anchor") or {}).get("name") or "")
        self.assertTrue(("婀栧寳澶у" in anchor_name) or ("湖北大学" in anchor_name))

    def test_boundary_generation_marks_roadfit_refinement_when_roads_available(self):
        pipeline = SpatialPipeline(
            repository=_StubRepository(
                _build_clustered_pois(),
                roads=_build_cluster_roads(),
                landuse=_build_cluster_landuse(),
            )
        )
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        hotspots = final_payload["results"].get("spatial_clusters", {}).get("hotspots", [])

        self.assertGreater(len(hotspots), 0)
        refinements = [
            (item.get("boundary_generation") or {}).get("refinement")
            for item in hotspots
        ]
        self.assertTrue(any(isinstance(refine, dict) and refine.get("model") for refine in refinements))
        methods = [str(item.get("boundary_method") or "") for item in hotspots]
        self.assertTrue(any("roadfit" in method for method in methods))

    def test_calc_bbox_area_uses_latitude_adjusted_lon_scale(self):
        points = [(114.2000, 30.4000), (114.2100, 30.4100)]
        area_m2 = spatial_module._calc_bbox_area(points)

        center_lat = 30.4050
        expected_width_m = 0.01 * 111_320.0 * math.cos(math.radians(center_lat))
        expected_height_m = 0.01 * 111_132.0
        expected_area_m2 = expected_width_m * expected_height_m

        self.assertAlmostEqual(area_m2, expected_area_m2, delta=expected_area_m2 * 0.04)

    def test_polygon_area_km2_uses_latitude_adjusted_scale(self):
        polygon = Polygon(
            [
                (114.2000, 30.4000),
                (114.2100, 30.4000),
                (114.2100, 30.4100),
                (114.2000, 30.4100),
                (114.2000, 30.4000),
            ]
        )
        area_km2 = spatial_module._polygon_area_km2(polygon)

        center_lat = 30.4050
        expected_area_m2 = (
            0.01 * 111_320.0 * math.cos(math.radians(center_lat))
            * 0.01
            * 111_132.0
        )
        expected_area_km2 = expected_area_m2 / 1_000_000.0

        self.assertAlmostEqual(area_km2, expected_area_km2, delta=expected_area_km2 * 0.05)

    def test_alpha_shape_area_uses_latitude_adjusted_scale(self):
        coords = [
            (114.2000, 30.4000),
            (114.2100, 30.4000),
            (114.2100, 30.4100),
            (114.2000, 30.4100),
        ]
        result = build_alpha_shape(coords, alpha=1.2, min_polygon_area_m2=1.0, max_input_points=200)

        self.assertIsNotNone(result)
        area_m2 = float(result["area_m2"])

        center_lat = 30.4050
        expected_area_m2 = (
            0.01 * 111_320.0 * math.cos(math.radians(center_lat))
            * 0.01
            * 111_132.0
        )
        self.assertAlmostEqual(area_m2, expected_area_m2, delta=expected_area_m2 * 0.08)

    def test_road_alignment_distance_uses_geodesic_scale(self):
        lat_center = 30.010
        lon_offset = 33.0 / (111_320.0 * math.cos(math.radians(lat_center)))
        lon_min = 114.0000 + lon_offset
        lon_max = lon_min + 0.00001

        boundary_geojson = {
            "type": "Polygon",
            "coordinates": [
                [
                    [lon_min, 30.0020],
                    [lon_max, 30.0020],
                    [lon_max, 30.0180],
                    [lon_min, 30.0180],
                    [lon_min, 30.0020],
                ]
            ],
        }
        cluster_points = [(lon_min + 0.000004, 30.0025 + i * 0.0007) for i in range(20)]
        road = LineString([(114.0000, 29.9980), (114.0000, 30.0200)])
        road_index = STRtree([road])

        score = spatial_module._compute_road_alignment_score(
            boundary_geojson=boundary_geojson,
            cluster_points=cluster_points,
            road_index=road_index,
            road_geometries=[road],
        )

        self.assertIsNotNone(score)
        self.assertGreater(float(score), 0.80)

    def test_landuse_alignment_distance_uses_geodesic_scale(self):
        lat_center = 30.010
        lon_offset = 42.0 / (111_320.0 * math.cos(math.radians(lat_center)))
        lon_min = 114.0000 + lon_offset
        lon_max = lon_min + 0.000012

        boundary_geojson = {
            "type": "Polygon",
            "coordinates": [
                [
                    [lon_min, 30.0020],
                    [lon_max, 30.0020],
                    [lon_max, 30.0180],
                    [lon_min, 30.0180],
                    [lon_min, 30.0020],
                ]
            ],
        }
        cluster_points = [(lon_min + 0.000005, 30.0030 + i * 0.00065) for i in range(20)]
        landuse = Polygon(
            [
                (113.9800, 29.9900),
                (114.0000, 29.9900),
                (114.0000, 30.0220),
                (113.9800, 30.0220),
                (113.9800, 29.9900),
            ]
        )
        landuse_index = STRtree([landuse])

        score = spatial_module._compute_landuse_alignment_score(
            boundary_geojson=boundary_geojson,
            cluster_points=cluster_points,
            landuse_index=landuse_index,
            landuse_geometries=[landuse],
            landuse_weights=[0.90],
        )

        self.assertIsNotNone(score)
        self.assertGreater(float(score), 0.82)

    def test_boundary_confidence_semantic_anchor_weight_stable_when_niche_missing(self):
        layer_bundle = {
            "outer": {"confidence": 0.64},
            "transition": {"confidence": 0.71},
            "core": {"confidence": 0.76},
        }

        anchor_only = spatial_module._build_boundary_confidence(
            layer_bundle=layer_bundle,
            membership_score=0.66,
            boundary_method="alpha_shape",
            boundary_quality_score=0.73,
            poi_quality_score=0.78,
            semantic_anchor_confidence=0.85,
            niche_consistency_score=None,
        )
        anchor_with_niche = spatial_module._build_boundary_confidence(
            layer_bundle=layer_bundle,
            membership_score=0.66,
            boundary_method="alpha_shape",
            boundary_quality_score=0.73,
            poi_quality_score=0.78,
            semantic_anchor_confidence=0.85,
            niche_consistency_score=0.58,
        )

        w_only = anchor_only["explain"]["weights"]
        w_both = anchor_with_niche["explain"]["weights"]

        self.assertAlmostEqual(sum(float(v) for v in w_only.values()), 1.0, places=4)
        self.assertAlmostEqual(sum(float(v) for v in w_both.values()), 1.0, places=4)
        self.assertAlmostEqual(
            float(w_only.get("semantic_anchor", 0.0)),
            float(w_both.get("semantic_anchor", 0.0)),
            delta=0.0005,
        )

    def test_boundary_confidence_switches_to_composite_v5_with_visual_and_validation_signals(self):
        layer_bundle = {
            "outer": {"confidence": 0.62},
            "transition": {"confidence": 0.70},
            "core": {"confidence": 0.75},
        }
        scored = spatial_module._build_boundary_confidence(
            layer_bundle=layer_bundle,
            membership_score=0.68,
            boundary_method="alpha_shape",
            boundary_quality_score=0.74,
            poi_quality_score=0.77,
            semantic_anchor_confidence=0.84,
            niche_consistency_score=0.61,
            visual_morphology_confidence=0.79,
            self_validation_confidence=0.93,
            skg_consistency_score=0.72,
        )

        explain = scored.get("explain") or {}
        self.assertEqual(explain.get("model"), "composite_v5")
        self.assertIn("visual_morphology_confidence", explain)
        self.assertIn("self_validation_confidence", explain)
        self.assertIn("skg_consistency_confidence", explain)

    def test_pipeline_composite_v5_includes_visual_self_validation_and_skg_outputs(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        request = _build_area_request(
            options={
                "limit": 1000,
                "maxFetchLimit": 1000,
                "confidenceModel": "composite_v5",
                "visualReviewEnabled": True,
                "visualRemoteEnabled": False,
                "selfValidationEnabled": True,
                "skgEnabled": True,
                "visualModel": "qwen3.5-2b",
            }
        )

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertEqual(stats.get("boundary_confidence_model"), "composite_v5")
        self.assertIn("self_validation", results)
        self.assertIn("spatial_knowledge_graph", results)
        self.assertGreaterEqual(float(stats.get("avg_visual_morphology_confidence", 0.0)), 0.0)
        self.assertGreaterEqual(float(stats.get("avg_self_validation_confidence", 0.0)), 0.0)
        self.assertGreaterEqual(float(stats.get("avg_skg_consistency_score", 0.0)), 0.0)

        first_region = (results.get("vernacular_regions") or [{}])[0]
        explain = first_region.get("confidence_explain") or {}
        self.assertEqual(explain.get("model"), "composite_v5")
        self.assertTrue("visual_morphology_confidence" in explain or str(stats.get("visual_review_mode") or "") == "disabled")
        self.assertIn("self_validation_confidence", explain)
        self.assertIn("skg_consistency_confidence", explain)

    def test_viewport_constraints_clip_output_boundaries(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_edge_viewport_pois()))
        events = list(pipeline.run(_build_edge_viewport_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]

        min_lon, min_lat, max_lon, max_lat = 114.40, 30.50, 114.45, 30.55
        coords = []

        def _iter_coords(payload):
            if payload is None:
                return
            if isinstance(payload, dict):
                if "coordinates" in payload:
                    _iter_coords(payload.get("coordinates"))
                else:
                    for value in payload.values():
                        _iter_coords(value)
                return
            if isinstance(payload, (list, tuple)):
                if len(payload) >= 2 and all(isinstance(item, (int, float)) for item in payload[:2]):
                    coords.append((float(payload[0]), float(payload[1])))
                    return
                for item in payload:
                    _iter_coords(item)

        for hotspot in results.get("spatial_clusters", {}).get("hotspots", []):
            _iter_coords(hotspot.get("boundary_geojson"))
            _iter_coords(hotspot.get("layers"))
        for region in results.get("vernacular_regions", []):
            _iter_coords(region.get("boundary"))
            _iter_coords(region.get("layers"))
        for region in results.get("fuzzy_regions", []):
            _iter_coords(region.get("boundary"))
            _iter_coords(region.get("layers"))

        self.assertGreater(len(coords), 0)
        for lon, lat in coords:
            self.assertGreaterEqual(lon, min_lon - 1e-9)
            self.assertLessEqual(lon, max_lon + 1e-9)
            self.assertGreaterEqual(lat, min_lat - 1e-9)
            self.assertLessEqual(lat, max_lat + 1e-9)

    def test_fetch_candidates_relaxes_semantic_terms_when_zero_hit(self):
        repo = _TermFallbackRepository(_build_clustered_pois())
        pipeline = SpatialPipeline(repository=repo)
        request = _build_area_request()

        hints = json.loads(request["hints"])
        hints["semantic_query"] = "杩欎竴甯︽湁浠€涔堝ソ鐜╃殑鍦版柟"
        request["hints"] = json.dumps(hints, ensure_ascii=False)

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertGreater(len(results.get("pois", [])), 0)
        self.assertTrue(bool(stats.get("term_filter_relaxed")))
        self.assertGreaterEqual(len(repo.fetch_calls), 2)
        self.assertGreater(len(repo.fetch_calls[0].get("terms") or []), 0)
        self.assertEqual(repo.fetch_calls[1].get("terms"), [])

    def test_macro_area_analysis_without_ui_filter_uses_all_categories_for_fetch(self):
        repo = _CategoryCaptureRepository(_build_clustered_pois())
        pipeline = SpatialPipeline(repository=repo)
        request = _build_area_request(
            options={
                "sourcePolicy": {
                    "has_category_filter": False,
                    "selected_categories": [],
                }
            }
        )
        request["categories"] = ["鍟嗗満", "渚垮埄?", "鍜栧暋?"]

        hints = json.loads(request["hints"])
        hints["query_plan"] = {
            "query_type": "area_analysis",
            "intent_mode": "macro_overview",
            "anchor": {"type": "unknown", "name": None},
        }
        request["hints"] = json.dumps(hints, ensure_ascii=False)

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        stats = final_payload["results"].get("stats", {})

        self.assertGreaterEqual(len(repo.fetch_calls), 1)
        self.assertEqual(repo.fetch_calls[0].get("categories"), [])
        self.assertTrue(bool(stats.get("fetch_categories_relaxed_macro")))
        self.assertEqual(int(stats.get("requested_categories_count", 0)), 3)
        self.assertEqual(int(stats.get("effective_fetch_categories_count", -1)), 0)

    def test_macro_area_analysis_keeps_categories_when_ui_filter_is_on(self):
        repo = _CategoryCaptureRepository(_build_clustered_pois())
        pipeline = SpatialPipeline(repository=repo)
        request = _build_area_request(
            options={
                "sourcePolicy": {
                    "has_category_filter": True,
                    "selected_categories": ["鍟嗗満", "渚垮埄?"],
                }
            }
        )
        request["categories"] = ["鍟嗗満", "渚垮埄?"]

        hints = json.loads(request["hints"])
        hints["query_plan"] = {
            "query_type": "area_analysis",
            "intent_mode": "macro_overview",
            "anchor": {"type": "unknown", "name": None},
        }
        request["hints"] = json.dumps(hints, ensure_ascii=False)

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        stats = final_payload["results"].get("stats", {})

        self.assertGreaterEqual(len(repo.fetch_calls), 1)
        self.assertEqual(repo.fetch_calls[0].get("categories"), ["鍟嗗満", "渚垮埄?"])
        self.assertFalse(bool(stats.get("fetch_categories_relaxed_macro")))
        self.assertEqual(int(stats.get("effective_fetch_categories_count", -1)), 2)

    def test_v5_anchor_bypass_injects_anchor_pois_under_ui_category_filter(self):
        repo = _V5AnchorBypassRepository()
        pipeline = SpatialPipeline(repository=repo)
        request = _build_area_request(
            options={
                "sourcePolicy": {
                    "has_category_filter": True,
                    "selected_categories": ["武汉大学"],
                },
                "baseLayerAnchorBypass": True,
                "baseLayerAnchorBypassPerHintLimit": 60,
                "baseLayerAnchorBypassScanLimit": 400,
                "baseLayerAnchorBypassMinInject": 1,
            }
        )
        request["categories"] = ["武汉大学"]

        hints = json.loads(request["hints"])
        hints["query_plan"] = {
            "query_type": "area_analysis",
            "intent_mode": "macro_overview",
            "anchor": {"type": "unknown", "name": None},
        }
        hints["vlm_extracted_texts"] = ["婀栧寳澶у", "婀栧寳澶у鍥句功?"]
        request["hints"] = json.dumps(hints, ensure_ascii=False)

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]
        stats = results.get("stats", {})

        self.assertGreater(int(stats.get("anchor_bypass_injected_count", 0)), 0)
        self.assertGreater(int(stats.get("total_candidates", 0)), len(repo.base_pois))
        self.assertTrue(
            any(
                call.get("categories") == [] and len(call.get("terms") or []) > 0
                for call in repo.spatial_join_calls
            )
        )

    def test_vlm_anchor_texts_forwarded_to_block_assembler(self):
        repo = _V5ForwardingRepository()
        pipeline = SpatialPipeline(repository=repo)
        request = _build_area_request(options={"confidenceModel": "composite_v5"})

        hints = json.loads(request["hints"])
        hints["query_plan"] = {
            "query_type": "area_analysis",
            "intent_mode": "macro_overview",
            "anchor": {"type": "unknown", "name": None},
        }
        hints["vlm_extracted_texts"] = ["婀栧寳澶у", "婀栧寳澶у姝︽槍鏍″尯"]
        request["hints"] = json.dumps(hints, ensure_ascii=False)

        original_assemble = spatial_module.block_assembler.assemble_block_boundaries
        captured = {}

        def _capture_assemble(**kwargs):
            captured.update(kwargs)
            return []

        spatial_module.block_assembler.assemble_block_boundaries = _capture_assemble
        try:
            events = list(pipeline.run(request))
            final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
            self.assertTrue(final_payload.get("success"))
        finally:
            spatial_module.block_assembler.assemble_block_boundaries = original_assemble

        self.assertIn("vlm_anchor_texts", captured)
        self.assertTrue(any(str(item).strip() for item in (captured.get("vlm_anchor_texts") or [])))

    def test_enrich_pois_with_surface_layers_assigns_attributes(self):
        pois = [
            {
                "id": 1,
                "name": "inside",
                "lon": 114.3202,
                "lat": 30.5802,
                "block_id": None,
                "aoi_name": None,
                "aoi_type": None,
                "land_type": None,
            },
            {
                "id": 2,
                "name": "outside",
                "lon": 114.3600,
                "lat": 30.6200,
                "block_id": None,
                "aoi_name": None,
                "aoi_type": None,
                "land_type": None,
            },
        ]
        road_blocks = [
            {
                "block_id": 99,
                "shape_area": 10000.0,
                "geometry_geojson": _rect(114.3195, 30.5795, 114.3210, 30.5810),
            }
        ]
        osm_aoi = [
            {
                "name": "娴嬭瘯AOI",
                "type": "鍟嗕笟",
                "area_m2": 12000.0,
                "geometry_geojson": _rect(114.3190, 30.5790, 114.3215, 30.5815),
            }
        ]
        euluc = [
            {
                "land_type": "鍟嗕笟鏈嶅姟鐢ㄥ湴",
                "area_m2": 13000.0,
                "geometry_geojson": _rect(114.3190, 30.5790, 114.3215, 30.5815),
            }
        ]

        enriched, summary = spatial_module._enrich_pois_with_surface_layers(
            pois=pois,
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=euluc,
        )

        self.assertEqual(enriched[0].get("block_id"), 99)
        self.assertEqual(enriched[0].get("aoi_name"), "娴嬭瘯AOI")
        self.assertEqual(enriched[0].get("land_type"), "鍟嗕笟鏈嶅姟鐢ㄥ湴")
        self.assertIsNone(enriched[1].get("block_id"))
        self.assertEqual(int(summary.get("enriched_rows", 0)), 1)

    def test_v5_pipeline_uses_in_memory_join_without_second_query(self):
        repo = _V5NoSecondQueryRepository()
        pipeline = SpatialPipeline(repository=repo)
        request = _build_area_request(
            options={
                "confidenceModel": "composite_v5",
                "clusterMinClusterSize": 4,
                "clusterMinSamples": 2,
                "clusterAdaptive": False,
            }
        )

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        stats = (final_payload.get("results") or {}).get("stats") or {}

        self.assertFalse(repo.spatial_join_called)
        self.assertTrue(bool(stats.get("v5_in_memory_join_used")))
        self.assertGreater(int(stats.get("v5_in_memory_join_enriched_rows", 0)), 0)

    def test_pipeline_cluster_uses_h3_preaggregate_for_large_inputs(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        request = _build_area_request(
            options={
                "clusterH3PreAggregate": True,
                "clusterH3PreAggregateThreshold": 40,
                "clusterMinClusterSize": 6,
                "clusterMinSamples": 3,
                "clusterAdaptive": False,
            }
        )

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        stats = (final_payload.get("results") or {}).get("stats") or {}

        self.assertTrue(bool(stats.get("cluster_preagg_enabled")))
        self.assertGreater(int(stats.get("cluster_preagg_cell_count", 0)), 0)
        self.assertLess(
            int(stats.get("cluster_preagg_point_count", 10**9)),
            int(stats.get("total_candidates", 0)),
        )
        self.assertIn("h3_preagg", str(stats.get("cluster_engine") or ""))

    def test_results_include_canonical_regions(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        events = list(pipeline.run(_build_area_request()))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        results = final_payload["results"]

        regions = results.get("regions")
        self.assertIsInstance(regions, list)
        self.assertGreater(len(regions), 0)
        self.assertTrue(all(region.get("id") is not None for region in regions))

    def test_membership_recovers_small_pure_cluster_as_transition(self):
        breakdown = compute_membership(
            density=0.05,
            purity=1.0,
            centrality=0.10,
            compactness=0.86,
            scale=0.08,
        )

        self.assertGreaterEqual(float(breakdown.score), 0.45)
        self.assertIn(str(breakdown.level), {"transition", "core"})

    def test_confidence_scorer_module_matches_pipeline_wrapper(self):
        layer_bundle = {
            "outer": {"confidence": 0.64},
            "transition": {"confidence": 0.71},
            "core": {"confidence": 0.76},
        }
        params = {
            "layer_bundle": layer_bundle,
            "membership_score": 0.66,
            "boundary_method": "alpha_shape",
            "boundary_quality_score": 0.73,
            "poi_quality_score": 0.78,
            "semantic_anchor_confidence": 0.85,
            "niche_consistency_score": 0.58,
        }

        from_pipeline = spatial_module._build_boundary_confidence(**params)
        from_module = confidence_scorer.build_boundary_confidence(**params)
        self.assertEqual(from_pipeline, from_module)

    def test_boundary_builder_module_build_region_layers(self):
        cluster_points = [
            (114.20, 30.40),
            (114.21, 30.40),
            (114.21, 30.41),
            (114.20, 30.41),
        ]
        boundary_geojson = {
            "type": "Polygon",
            "coordinates": [
                [
                    [114.20, 30.40],
                    [114.21, 30.40],
                    [114.21, 30.41],
                    [114.20, 30.41],
                    [114.20, 30.40],
                ]
            ],
        }
        layers = boundary_builder.build_region_layers(
            cluster_points=cluster_points,
            base_boundary_geojson=boundary_geojson,
            density=0.62,
            membership_score=0.68,
            constraint_polygon=None,
            polygon_from_geojson=spatial_module._polygon_from_geojson,
            to_surface_polygon=spatial_module._to_surface_polygon,
            as_polygon=spatial_module._as_polygon,
            clip_polygon_to_constraint=spatial_module._clip_polygon_to_constraint,
            polygon_area_km2=spatial_module._polygon_area_km2,
            clamp01=spatial_module._clamp01,
        )
        self.assertTrue(layers.get("outer", {}).get("boundary"))
        self.assertTrue(layers.get("transition", {}).get("boundary"))
        self.assertTrue(layers.get("core", {}).get("boundary"))

    def test_semantic_reasoner_module_matches_anchor_wrapper(self):
        cluster_pois = [
            poi
            for poi in _build_semantic_niche_pois()
            if "\u6c99\u6e56" in str(poi.get("name") or "")
        ]
        params = {
            "cluster_pois": cluster_pois,
            "dominant_category": "\u751f\u6001",
            "llm_anchor_candidates": ["\u6c99\u6e56", "\u6b66\u6c49"],
        }

        from_pipeline = spatial_module._infer_semantic_anchor(**params)
        from_module = semantic_reasoner.infer_semantic_anchor(**params)
        self.assertEqual(from_pipeline, from_module)

    def test_semantic_reasoner_module_matches_landuse_context_wrapper(self):
        cluster_points = [
            (114.258, 30.608),
            (114.276, 30.608),
            (114.276, 30.626),
            (114.258, 30.626),
        ]
        boundary_geojson = {
            "type": "Polygon",
            "coordinates": [
                [
                    [114.256, 30.606],
                    [114.278, 30.606],
                    [114.278, 30.628],
                    [114.256, 30.628],
                    [114.256, 30.606],
                ]
            ],
        }
        semantic_features = (
            spatial_module._normalize_landuse_geometries(_build_semantic_landuse()).get("semantic_features") or []
        )
        params = {
            "boundary_geojson": boundary_geojson,
            "cluster_points": cluster_points,
            "semantic_features": semantic_features,
        }

        from_pipeline = spatial_module._cluster_landuse_semantic_context(**params)
        from_module = semantic_reasoner.cluster_landuse_semantic_context(
            **params,
            polygon_from_geojson=spatial_module._polygon_from_geojson,
        )
        self.assertEqual(from_pipeline, from_module)

    def test_poi_quality_scorer_module_matches_point_wrapper(self):
        poi = dict(_build_clustered_pois()[0])
        poi["name"] = "\u9500\u54c1\u8302A\u5355\u5143"
        poi["address"] = "\u6b66\u6c49\u5e02\u6b66\u660c\u533axx\u8def"
        poi["category_small"] = "\u96f6\u552e"
        poi["lon"] = 114.3201
        poi["lat"] = 30.5202

        from_pipeline = spatial_module._poi_point_quality_score(poi)
        from_module = poi_quality_scorer.poi_point_quality_score(poi)
        self.assertEqual(from_pipeline, from_module)

    def test_poi_quality_scorer_module_matches_cluster_wrapper(self):
        cluster_pois = _build_clustered_pois()[:80]

        from_pipeline = spatial_module._cluster_poi_quality(cluster_pois)
        from_module = poi_quality_scorer.cluster_poi_quality(cluster_pois)
        self.assertEqual(from_pipeline, from_module)

    def test_context_loader_module_matches_road_normalize_wrapper(self):
        road_rows = _build_cluster_roads()

        from_pipeline = spatial_module._normalize_road_geometries(road_rows)
        from_module = context_loader.normalize_road_geometries(
            rows=road_rows,
            safe_json_loads=spatial_module._safe_json_loads,
        )

        self.assertEqual([geom.wkt for geom in from_pipeline], [geom.wkt for geom in from_module])

    def test_context_loader_module_matches_landuse_normalize_wrapper(self):
        landuse_rows = _build_semantic_landuse()

        from_pipeline = spatial_module._normalize_landuse_geometries(landuse_rows)
        from_module = context_loader.normalize_landuse_geometries(
            rows=landuse_rows,
            safe_json_loads=spatial_module._safe_json_loads,
            clamp01=spatial_module._clamp01,
            landuse_label_text=spatial_module._landuse_label_text,
            niche_type_from_landuse_label=spatial_module._niche_type_from_landuse_label,
        )

        self.assertEqual(
            [geom.wkt for geom in (from_pipeline.get("boundary_geometries") or [])],
            [geom.wkt for geom in (from_module.get("boundary_geometries") or [])],
        )
        self.assertEqual(
            list(from_pipeline.get("boundary_weights") or []),
            list(from_module.get("boundary_weights") or []),
        )

        def _normalize_features(features):
            normalized = []
            for feature in (features or []):
                bounds = tuple(round(float(value), 6) for value in (feature.get("bounds") or ()))
                normalized.append(
                    (
                        str(feature.get("label") or ""),
                        str(feature.get("niche_type") or ""),
                        round(float(feature.get("semantic_weight") or 0.0), 6),
                        bounds,
                    )
                )
            return normalized

        self.assertEqual(
            _normalize_features(from_pipeline.get("semantic_features")),
            _normalize_features(from_module.get("semantic_features")),
        )

    def test_result_assembler_module_matches_region_view_wrapper(self):
        cluster_entries = [
            {
                "id": 7,
                "name": "\u6c99\u6e56\u751f\u6001\u7247\u533a",
                "theme": "\u751f\u6001",
                "poi_count": 12,
                "center": {"lon": 114.31, "lat": 30.58},
                "boundary_geojson": {
                    "type": "Polygon",
                    "coordinates": [[[114.30, 30.57], [114.32, 30.57], [114.32, 30.59], [114.30, 30.59], [114.30, 30.57]]],
                },
                "boundary": [[114.30, 30.57], [114.32, 30.57], [114.32, 30.59], [114.30, 30.59], [114.30, 30.57]],
                "layers": {"outer": {"confidence": 0.7}, "transition": {"confidence": 0.76}, "core": {"confidence": 0.8}},
                "dominant_category": "\u751f\u6001",
                "dominant_categories": [{"category": "\u751f\u6001", "count": 8}],
                "membership": {"score": 0.72, "level": "core"},
                "density": 0.65,
                "purity": 0.82,
                "vitality_score": 0.74,
                "poi_quality": {"score": 0.81},
                "boundary_method": "alpha_shape_snap_road_v2",
                "boundary_quality": {
                    "model": "coverage_area_compactness_v1",
                    "quality_score": 0.78,
                    "coverage_ratio": 0.76,
                    "landuse_alignment_score": 0.74,
                    "water_overlap_ratio": 0.08,
                    "water_penalty": 0.0,
                    "pass": True,
                },
                "boundary_generation": {"attempts": 2},
                "boundary_confidence": 0.79,
                "confidence_explain": {"model": "composite_v5"},
                "semantic_anchor": {"name": "\u6c99\u6e56", "confidence": 0.86},
                "niche_profile": {"niche_type": "eco_park"},
                "landuse_semantic": {"hit_count": 1},
                "semantic_reasoning": {"anchor_verified": True},
                "score_breakdown": {"density": 0.65, "purity": 0.82, "centrality": 0.52, "compactness": 0.74, "scale": 0.48},
                "drivers": [{"metric": "purity", "value": 0.82}],
            }
        ]

        from_pipeline = spatial_module._build_region_views(cluster_entries=cluster_entries)
        from_module = result_assembler.build_region_views(cluster_entries=cluster_entries)
        self.assertEqual(from_pipeline, from_module)

    def test_result_assembler_includes_fuzzy_hierarchy_and_ambiguity(self):
        base_entry = {
            "id": 7,
            "name": "shahu_ecology_region",
            "theme": "ecology",
            "poi_count": 12,
            "center": {"lon": 114.31, "lat": 30.58},
            "boundary_geojson": {
                "type": "Polygon",
                "coordinates": [[[114.30, 30.57], [114.32, 30.57], [114.32, 30.59], [114.30, 30.59], [114.30, 30.57]]],
            },
            "boundary": [[114.30, 30.57], [114.32, 30.57], [114.32, 30.59], [114.30, 30.59], [114.30, 30.57]],
            "layers": {"outer": {"confidence": 0.7}, "transition": {"confidence": 0.76}, "core": {"confidence": 0.8}},
            "dominant_category": "ecology",
            "dominant_categories": [{"category": "ecology", "count": 8}, {"category": "commerce", "count": 7}],
            "membership": {"score": 0.72, "level": "core"},
            "density": 0.65,
            "purity": 0.82,
            "vitality_score": 0.74,
            "poi_quality": {"score": 0.81},
            "boundary_method": "alpha_shape_snap_road_v2",
            "boundary_quality": {
                "model": "coverage_area_compactness_v1",
                "quality_score": 0.78,
                "coverage_ratio": 0.76,
                "landuse_alignment_score": 0.34,
                "water_overlap_ratio": 0.08,
                "water_penalty": 0.0,
                "pass": True,
            },
            "boundary_generation": {"attempts": 2},
            "boundary_confidence": 0.41,
            "confidence_explain": {"model": "composite_v5"},
            "semantic_anchor": {"name": "娌欐箹", "confidence": 0.86},
            "niche_profile": {"niche_type": "mixed"},
            "landuse_semantic": {"hit_count": 1},
            "semantic_reasoning": {"anchor_verified": True},
            "score_breakdown": {"density": 0.65, "purity": 0.82, "centrality": 0.52, "compactness": 0.74, "scale": 0.48},
            "drivers": [{"metric": "purity", "value": 0.82}],
        }
        peer_entry = dict(base_entry)
        peer_entry["id"] = 9
        peer_entry["name"] = "娌欐箹鍟嗕笟鐗囧尯"
        peer_entry["theme"] = "鍟嗕笟"
        peer_entry["vitality_score"] = 0.55
        peer_entry["boundary_confidence"] = 0.62
        peer_entry["membership"] = {"score": 0.63, "level": "transition"}
        peer_entry["dominant_category"] = "鍟嗕笟"
        peer_entry["dominant_categories"] = [{"category": "commerce", "count": 10}, {"category": "ecology", "count": 4}]
        peer_entry["semantic_anchor"] = {"name": "娌欐箹", "confidence": 0.78}
        peer_entry["niche_profile"] = {"niche_type": "commerce"}

        views = result_assembler.build_region_views(cluster_entries=[base_entry, peer_entry])
        fuzzy_by_id = {int(item["id"]): item for item in views["fuzzy_regions"]}

        self.assertIn(7, fuzzy_by_id)
        self.assertIn("hierarchy", fuzzy_by_id[7])
        self.assertEqual(fuzzy_by_id[7]["hierarchy"]["macro_name"], "娌欐箹")
        self.assertEqual(fuzzy_by_id[7]["hierarchy"]["rank_in_macro"], 1)
        self.assertIn("ambiguity", fuzzy_by_id[7])
        self.assertGreater(fuzzy_by_id[7]["ambiguity"]["score"], 0.5)
        self.assertIn("weak_landuse_alignment", fuzzy_by_id[7]["ambiguity"]["flags"])
        self.assertEqual(fuzzy_by_id[9]["hierarchy"]["rank_in_macro"], 2)

    def test_govern_region_names_rewrites_duplicate_macro_names(self):
        cluster_entries = [
            {
                "id": 1,
                "name": "shahu_ecology_region",
                "poi_count": 40,
                "vitality_score": 0.83,
                "dominant_category": "ecology",
                "dominant_categories": [{"category": "ecology", "count": 26}],
                "semantic_anchor": {"name": "娌欐箹", "confidence": 0.9},
                "semantic_reasoning": {},
            },
            {
                "id": 2,
                "name": "shahu_ecology_region",
                "poi_count": 18,
                "vitality_score": 0.59,
                "dominant_category": "鍟嗕笟",
                "dominant_categories": [{"category": "鍟嗕笟", "count": 12}],
                "semantic_anchor": {"name": "娌欐箹", "confidence": 0.72},
                "semantic_reasoning": {},
            },
        ]

        summary = spatial_module._govern_region_names(
            cluster_entries=cluster_entries,
            remote_enabled=False,
            model_name="test",
            endpoint="http://127.0.0.1",
            timeout_ms=300,
        )

        self.assertEqual(summary["duplicate_rewritten"], 1)
        self.assertNotEqual(cluster_entries[0]["name"], cluster_entries[1]["name"])
        self.assertTrue(("缁勫洟" in cluster_entries[1]["name"]) or ("组团" in cluster_entries[1]["name"]))

    def test_remote_audit_region_names_processes_all_entries(self):
        entries = [
            {
                "id": idx + 1,
                "name": f"region-{idx + 1}",
                "poi_count": 10 + idx,
                "dominant_category": "test",
                "landuse_semantic": {"dominant_land_type": "test"},
                "semantic_anchor": {"name": "anchor"},
            }
            for idx in range(18)
        ]

        class _FakeResponse:
            def __init__(self, body: str):
                self._body = body.encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self._body

        def _fake_urlopen(request, timeout=0.0):
            _ = timeout
            request_payload = json.loads(request.data.decode("utf-8"))
            prompt = str((request_payload.get("messages") or [{}, {}])[1].get("content") or "")
            items_blob = prompt.split("\nItems: ", 1)[1] if "\nItems: " in prompt else "[]"
            payload_items = json.loads(items_blob)
            audit_items = [
                {"id": int(item.get("id", 0)), "approved": True, "name": f"audited-{int(item.get('id', 0))}"}
                for item in payload_items
                if int(item.get("id", 0)) > 0
            ]
            response_payload = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"items": audit_items}, ensure_ascii=False),
                        }
                    }
                ]
            }
            return _FakeResponse(json.dumps(response_payload, ensure_ascii=False))

        with patch.object(spatial_module.urllib.request, "urlopen", side_effect=_fake_urlopen):
            result = spatial_module._remote_audit_region_names(
                entries=entries,
                model_name="test-model",
                endpoint="http://127.0.0.1:1234/v1/chat/completions",
                timeout_ms=500,
            )

        self.assertEqual(len(result), len(entries))
        self.assertEqual(result.get(18), "audited-18")

    def test_remote_audit_region_names_scales_tokens_and_timeout(self):
        entries = [
            {
                "id": idx + 1,
                "name": f"region-{idx + 1}",
                "poi_count": 20 + idx,
                "dominant_category": "test",
                "landuse_semantic": {"dominant_land_type": "test"},
                "semantic_anchor": {"name": "anchor"},
            }
            for idx in range(20)
        ]
        captured = {"max_tokens": 0, "timeout": 0.0}

        class _FakeResponse:
            def __init__(self, body: str):
                self._body = body.encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self._body

        def _fake_urlopen(request, timeout=0.0):
            request_payload = json.loads(request.data.decode("utf-8"))
            captured["max_tokens"] = int(request_payload.get("max_tokens", 0))
            captured["timeout"] = float(timeout)
            response_payload = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"items": []}, ensure_ascii=False),
                        }
                    }
                ]
            }
            return _FakeResponse(json.dumps(response_payload, ensure_ascii=False))

        with patch.object(spatial_module.urllib.request, "urlopen", side_effect=_fake_urlopen):
            _ = spatial_module._remote_audit_region_names(
                entries=entries,
                model_name="test-model",
                endpoint="http://127.0.0.1:1234/v1/chat/completions",
                timeout_ms=500,
            )

        self.assertGreater(int(captured["max_tokens"]), 500)
        self.assertLessEqual(int(captured["max_tokens"]), 2200)
        self.assertGreater(float(captured["timeout"]), 0.5)
        self.assertLessEqual(float(captured["timeout"]), 12.0)

    def test_govern_region_names_applies_remote_max_items_cap(self):
        cluster_entries = [
            {
                "id": idx + 1,
                "name": f"region-{idx + 1}",
                "poi_count": 10 + idx,
                "dominant_category": "test",
                "dominant_categories": [{"category": "test", "count": 8}],
                "semantic_anchor": {"name": "anchor", "confidence": 0.8},
                "semantic_reasoning": {},
            }
            for idx in range(10)
        ]
        captured = {"entry_count": 0}

        def _fake_remote(*, entries, model_name, endpoint, timeout_ms):
            _ = (model_name, endpoint, timeout_ms)
            captured["entry_count"] = len(entries)
            return {}

        with patch.object(spatial_module, "_remote_audit_region_names", side_effect=_fake_remote):
            summary = spatial_module._govern_region_names(
                cluster_entries=cluster_entries,
                remote_enabled=True,
                model_name="test-model",
                endpoint="http://127.0.0.1:1234/v1/chat/completions",
                timeout_ms=900,
                remote_max_items=4,
            )

        self.assertTrue(bool(summary.get("llm_attempted")))
        self.assertEqual(int(summary.get("remote_input_count", 0)), 10)
        self.assertEqual(int(summary.get("remote_sent_count", 0)), 4)
        self.assertEqual(int(captured["entry_count"]), 4)

    def test_load_boundary_context_bundles_parallel_runs_both_loaders(self):
        road_started = threading.Event()
        landuse_started = threading.Event()
        observed = {"road_saw_landuse": False, "landuse_saw_road": False}

        def _road_loader(**_kwargs):
            road_started.set()
            observed["road_saw_landuse"] = landuse_started.wait(timeout=0.4)
            return {"rows": [{"id": 1}], "geometries": [], "index": None, "source": "road_stub"}

        def _landuse_loader(**_kwargs):
            landuse_started.set()
            observed["landuse_saw_road"] = road_started.wait(timeout=0.4)
            return {
                "rows": [{"id": 2}],
                "geometries": [],
                "weights": [],
                "semantic_features": [],
                "index": None,
                "source": "landuse_stub",
            }

        with patch.object(spatial_module.context_loader, "load_road_context", side_effect=_road_loader), patch.object(
            spatial_module.context_loader,
            "load_landuse_context",
            side_effect=_landuse_loader,
        ):
            road_bundle, landuse_bundle = spatial_module._load_boundary_context_bundles_parallel(
                repository=_StubRepository(),
                spatial_context={"mode": "viewport", "viewport": [114.2, 30.5, 114.4, 30.7]},
                query_type="area_analysis",
                road_boundary_enhancement=True,
                road_fetch_limit=1000,
                landuse_boundary_enhancement=True,
                landuse_fetch_limit=1000,
            )

        self.assertTrue(observed["road_saw_landuse"])
        self.assertTrue(observed["landuse_saw_road"])
        self.assertEqual(str(road_bundle.get("source")), "road_stub")
        self.assertEqual(str(landuse_bundle.get("source")), "landuse_stub")

    def test_fetch_v5_surface_layers_parallel_runs_three_fetches(self):
        barrier = threading.Barrier(3, timeout=0.5)
        passed = {"road": False, "aoi": False, "euluc": False}

        class _Repo:
            def fetch_road_blocks(self, **_kwargs):
                try:
                    barrier.wait()
                    passed["road"] = True
                except threading.BrokenBarrierError:
                    passed["road"] = False
                return [{"block_id": 1}]

            def fetch_osm_aoi(self, **_kwargs):
                try:
                    barrier.wait()
                    passed["aoi"] = True
                except threading.BrokenBarrierError:
                    passed["aoi"] = False
                return [{"aoi_id": 1}]

            def fetch_euluc(self, **_kwargs):
                try:
                    barrier.wait()
                    passed["euluc"] = True
                except threading.BrokenBarrierError:
                    passed["euluc"] = False
                return [{"euluc_id": 1}]

        road_blocks, osm_aoi, euluc = spatial_module._fetch_v5_surface_layers_parallel(
            repository=_Repo(),
            bbox_wkt="POLYGON((114.1 30.5,114.2 30.5,114.2 30.6,114.1 30.6,114.1 30.5))",
        )

        self.assertTrue(passed["road"])
        self.assertTrue(passed["aoi"])
        self.assertTrue(passed["euluc"])
        self.assertEqual(len(road_blocks), 1)
        self.assertEqual(len(osm_aoi), 1)
        self.assertEqual(len(euluc), 1)
    def test_result_assembler_module_matches_cluster_summary_wrapper(self):
        cluster_entries = [
            {
                "boundary_confidence": 0.79,
                "poi_quality": {"score": 0.81},
                "boundary_quality": {
                    "model": "coverage_area_compactness_v1",
                    "quality_score": 0.78,
                    "coverage_ratio": 0.76,
                    "landuse_alignment_score": 0.74,
                    "water_overlap_ratio": 0.08,
                    "water_penalty": 0.0,
                    "pass": True,
                },
                "semantic_anchor": {"name": "\u6c99\u6e56", "confidence": 0.86},
                "niche_profile": {"niche_type": "eco_park"},
                "boundary_generation": {"attempts": 2},
                "confidence_explain": {"model": "composite_v5"},
            },
            {
                "boundary_confidence": 0.63,
                "poi_quality": {"score": 0.67},
                "boundary_quality": {
                    "model": "coverage_area_compactness_v1",
                    "quality_score": 0.69,
                    "coverage_ratio": 0.7,
                    "landuse_alignment_score": 0.68,
                    "water_overlap_ratio": 0.12,
                    "water_penalty": 0.06,
                    "pass": False,
                },
                "semantic_anchor": {"name": "", "confidence": 0.0},
                "niche_profile": {"niche_type": "mixed"},
                "boundary_generation": {"attempts": 1},
                "confidence_explain": {"model": "composite_v5"},
            },
        ]
        fuzzy_regions = [{"level": "core"}, {"level": "transition"}, {"level": "periphery"}]

        from_pipeline = spatial_module._summarize_cluster_entries(
            cluster_entries=cluster_entries,
            fuzzy_regions=fuzzy_regions,
        )
        from_module = result_assembler.summarize_cluster_entries(
            cluster_entries=cluster_entries,
            fuzzy_regions=fuzzy_regions,
        )
        self.assertEqual(from_pipeline, from_module)

    def test_region_output_limit_defaults_for_area_analysis(self):
        limit = spatial_module._resolve_region_output_limit(
            hints_options={},
            query_type="area_analysis",
        )
        self.assertEqual(limit, 60)

    def test_region_output_limit_honors_options_and_cap(self):
        explicit = spatial_module._resolve_region_output_limit(
            hints_options={"maxRegionOutputs": 120},
            query_type="area_analysis",
        )
        capped = spatial_module._resolve_region_output_limit(
            hints_options={"maxRegionOutputs": 999},
            query_type="area_analysis",
        )
        self.assertEqual(explicit, 120)
        self.assertEqual(capped, 200)

    def test_pipeline_echoes_dsl_meta_observability_fields(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        request = _build_area_request(
            options={
                "context_binding": {
                    "viewport_hash": "sha1:test_viewport",
                    "client_view_id": "view_001",
                    "event_seq": 7,
                    "source": "frontend_injected",
                },
                "revision": {
                    "mode": "rebuild",
                    "base_trace_id": "trace_base_001",
                    "patch_ops": [],
                },
                "streaming_hints": {
                    "allow_prefetch": True,
                    "prefetch_on_fields": ["scope", "entities.categories"],
                },
                "prefetch_degraded": True,
                "prefetch_wasted": False,
                "prefetch_overlap_delta_ms": -128,
                "context_refreshed": True,
                "context_stale": False,
                "context_view_changed": True,
            }
        )

        events = list(pipeline.run(request))
        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        stats = (final_payload.get("results") or {}).get("stats") or {}
        diagnostics = final_payload.get("diagnostics") or {}

        self.assertEqual(stats.get("revision_mode"), "rebuild")
        self.assertEqual(int(stats.get("dsl_patch_ops_count", -1)), 0)
        self.assertTrue(bool(stats.get("dsl_context_binding_present")))
        self.assertFalse(bool(stats.get("context_binding_degraded")))
        self.assertTrue(bool(stats.get("context_refreshed")))
        self.assertFalse(bool(stats.get("context_stale")))
        self.assertTrue(bool(stats.get("context_view_changed")))
        self.assertTrue(bool(stats.get("dsl_streaming_allow_prefetch")))
        self.assertEqual(
            stats.get("dsl_streaming_prefetch_on_fields"),
            ["scope", "entities.categories"],
        )
        self.assertTrue(bool(stats.get("prefetch_degraded")))
        self.assertFalse(bool(stats.get("prefetch_wasted")))
        self.assertEqual(float(stats.get("prefetch_overlap_delta_ms", 0)), -128.0)

        self.assertEqual(diagnostics.get("revision_mode"), "rebuild")
        self.assertFalse(bool(diagnostics.get("context_binding_degraded")))
        self.assertTrue(bool(diagnostics.get("context_refreshed")))
        self.assertFalse(bool(diagnostics.get("context_stale")))
        self.assertTrue(bool(diagnostics.get("context_view_changed")))
        self.assertTrue(bool(diagnostics.get("streaming_allow_prefetch")))
        self.assertTrue(bool(diagnostics.get("prefetch_degraded")))
        self.assertFalse(bool(diagnostics.get("prefetch_wasted")))
        self.assertEqual(float(diagnostics.get("prefetch_overlap_delta_ms", 0)), -128.0)
        self.assertIn("dsl_meta", diagnostics)
        self.assertEqual(
            ((diagnostics.get("dsl_meta") or {}).get("revision") or {}).get("mode"),
            "rebuild",
        )

    def test_parallel_model_inference_collects_timing_and_payload(self):
        original_vlm = spatial_module.vlm_reviewer.extract_map_anchors
        original_llm = spatial_module.reasoning_reviewer.infer_spatial_priors

        spatial_module.vlm_reviewer.extract_map_anchors = lambda **_kwargs: {
            "success": True,
            "landmarks": ["姝︽眽澶у"],
            "aliases": ["姝﹀ぇ"],
            "layout_summary": "campus-centered",
            "confidence": 0.91,
        }
        spatial_module.reasoning_reviewer.infer_spatial_priors = lambda **_kwargs: {
            "success": True,
            "summary": "浼樺厛鍏虫敞楂樻牎鐩稿叧POI",
            "focus_terms": ["姝︽眽澶у"],
            "alias_candidates": ["姝﹀ぇ"],
            "priority_categories": ["绉戞暀鏂囧寲鏈嶅姟"],
            "confidence": 0.88,
        }

        try:
            bundle = spatial_module._run_parallel_model_inference(
                semantic_query="nearby coffee around campus",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=["椁愰ギ鏈嶅姟"],
                image_data_url="data:image/png;base64,stub",
                visual_model_name="qwen3.5-2b",
                ocr_model_name="glm-ocr",
                visual_endpoint="http://localhost:1234/v1/chat/completions",
                visual_timeout_ms=1200,
                reasoning_enabled=True,
                reasoning_model_name="qwen3.5-2b",
                reasoning_endpoint="http://localhost:1234/v1/chat/completions",
                reasoning_timeout_ms=1500,
                model_budget_ms=5000,
            )
        finally:
            spatial_module.vlm_reviewer.extract_map_anchors = original_vlm
            spatial_module.reasoning_reviewer.infer_spatial_priors = original_llm

        timing = bundle.get("timing") or {}
        self.assertTrue(bundle.get("vlm", {}).get("success"))
        self.assertTrue(bundle.get("llm", {}).get("success"))
        self.assertIn("姝︽眽澶у", bundle.get("vlm", {}).get("landmarks", []))
        self.assertEqual(int(timing.get("budget_ms", 0)), 5000)
        self.assertGreaterEqual(float(timing.get("parallel_wall_ms", -1.0)), 0.0)
        self.assertFalse(bool(timing.get("timed_out")))

    def test_parallel_model_inference_soft_degrades_when_vlm_remote_fails(self):
        original_vlm = spatial_module.vlm_reviewer.extract_map_anchors
        original_llm = spatial_module.reasoning_reviewer.infer_spatial_priors

        spatial_module.vlm_reviewer.extract_map_anchors = lambda **_kwargs: {
            "success": False,
            "error": "vlm_remote_error:request_failed",
            "debug": {
                "preview_text": "timed out",
                "preview_chars": 9,
                "preview_sha1": "d6f1732cfb943ae6cc1b669eafde3292646023e3",
                "parse_stage": "network",
            },
        }
        spatial_module.reasoning_reviewer.infer_spatial_priors = lambda **_kwargs: {
            "success": True,
            "summary": "reasoning fallback available",
            "focus_terms": ["anchor-a"],
            "alias_candidates": ["alias-a"],
            "priority_categories": ["life_service"],
            "confidence": 0.73,
        }

        try:
            bundle = spatial_module._run_parallel_model_inference(
                semantic_query="demo query",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=["life_service"],
                image_data_url="data:image/png;base64,stub",
                visual_model_name="qwen3.5-2b",
                ocr_model_name="glm-ocr",
                visual_endpoint="http://localhost:1234/v1/chat/completions",
                visual_timeout_ms=1200,
                reasoning_enabled=True,
                reasoning_model_name="qwen3.5-2b",
                reasoning_endpoint="http://localhost:1234/v1/chat/completions",
                reasoning_timeout_ms=1500,
                model_budget_ms=5000,
                allow_vlm_remote_failure=True,
            )
        finally:
            spatial_module.vlm_reviewer.extract_map_anchors = original_vlm
            spatial_module.reasoning_reviewer.infer_spatial_priors = original_llm

        self.assertTrue(bool(bundle.get("degraded")))
        self.assertEqual(bundle.get("degrade_reason"), "vlm_remote_error:request_failed")
        self.assertFalse(bool(bundle.get("vlm", {}).get("success")))
        self.assertTrue(bool(bundle.get("llm", {}).get("success")))

    def test_parallel_model_inference_soft_degrades_when_reasoning_remote_fails(self):
        original_vlm = spatial_module.vlm_reviewer.extract_map_anchors
        original_llm = spatial_module.reasoning_reviewer.infer_spatial_priors

        spatial_module.vlm_reviewer.extract_map_anchors = lambda **_kwargs: {
            "success": True,
            "landmarks": ["姝︽眽澶у"],
            "aliases": ["姝﹀ぇ"],
            "layout_summary": "campus-centered",
            "confidence": 0.92,
        }
        spatial_module.reasoning_reviewer.infer_spatial_priors = lambda **_kwargs: {
            "success": False,
            "error": "reasoning_remote_error:request_failed",
            "debug": {
                "preview_text": "timed out",
                "preview_chars": 9,
                "preview_sha1": "d6f1732cfb943ae6cc1b669eafde3292646023e3",
                "parse_stage": "network",
            },
        }

        try:
            bundle = spatial_module._run_parallel_model_inference(
                semantic_query="demo query",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=["life_service"],
                image_data_url="data:image/png;base64,stub",
                visual_model_name="qwen3.5-2b",
                ocr_model_name="glm-ocr",
                visual_endpoint="http://localhost:1234/v1/chat/completions",
                visual_timeout_ms=1200,
                reasoning_enabled=True,
                reasoning_model_name="qwen3.5-2b",
                reasoning_endpoint="http://localhost:1234/v1/chat/completions",
                reasoning_timeout_ms=1500,
                model_budget_ms=5000,
                allow_vlm_remote_failure=False,
            )
        finally:
            spatial_module.vlm_reviewer.extract_map_anchors = original_vlm
            spatial_module.reasoning_reviewer.infer_spatial_priors = original_llm

        self.assertTrue(bool(bundle.get("degraded")))
        self.assertEqual(bundle.get("degrade_reason"), "llm:reasoning_remote_error:request_failed")
        self.assertTrue(bool(bundle.get("vlm", {}).get("success")))
        self.assertFalse(bool(bundle.get("llm", {}).get("success")))

    def test_parallel_model_inference_soft_degrades_when_both_models_soft_fail(self):
        original_vlm = spatial_module.vlm_reviewer.extract_map_anchors
        original_llm = spatial_module.reasoning_reviewer.infer_spatial_priors

        spatial_module.vlm_reviewer.extract_map_anchors = lambda **_kwargs: {
            "success": False,
            "error": "vlm_remote_error:request_failed",
            "debug": {
                "preview_text": "timed out",
                "preview_chars": 9,
                "preview_sha1": "d6f1732cfb943ae6cc1b669eafde3292646023e3",
                "parse_stage": "network",
            },
        }
        spatial_module.reasoning_reviewer.infer_spatial_priors = lambda **_kwargs: {
            "success": False,
            "error": "reasoning_remote_error:request_failed",
            "debug": {
                "preview_text": "timed out",
                "preview_chars": 9,
                "preview_sha1": "d6f1732cfb943ae6cc1b669eafde3292646023e3",
                "parse_stage": "network",
            },
        }

        try:
            bundle = spatial_module._run_parallel_model_inference(
                semantic_query="demo query",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=["life_service"],
                image_data_url="data:image/png;base64,stub",
                visual_model_name="qwen3.5-2b",
                ocr_model_name="glm-ocr",
                visual_endpoint="http://localhost:1234/v1/chat/completions",
                visual_timeout_ms=1200,
                reasoning_enabled=True,
                reasoning_model_name="qwen3.5-2b",
                reasoning_endpoint="http://localhost:1234/v1/chat/completions",
                reasoning_timeout_ms=1500,
                model_budget_ms=5000,
                allow_vlm_remote_failure=True,
            )
        finally:
            spatial_module.vlm_reviewer.extract_map_anchors = original_vlm
            spatial_module.reasoning_reviewer.infer_spatial_priors = original_llm

        self.assertTrue(bool(bundle.get("degraded")))
        self.assertEqual(bundle.get("degrade_reason"), "llm:reasoning_remote_error:request_failed")
        self.assertFalse(bool(bundle.get("vlm", {}).get("success")))
        self.assertFalse(bool(bundle.get("llm", {}).get("success")))

    def test_pipeline_parallel_model_success_writes_stats(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        request = _build_area_request(
            options={
                "visualReviewEnabled": True,
                "reasoningEnabled": True,
                "visualSnapshotDataUrl": "data:image/png;base64,stub",
                "modelBudgetMs": 5000,
            }
        )

        original_vlm = spatial_module.vlm_reviewer.extract_map_anchors
        original_llm = spatial_module.reasoning_reviewer.infer_spatial_priors
        spatial_module.vlm_reviewer.extract_map_anchors = lambda **_kwargs: {
            "success": True,
            "landmarks": ["姝︽眽澶у"],
            "aliases": ["姝﹀ぇ"],
            "layout_summary": "campus-centered",
            "confidence": 0.9,
        }
        spatial_module.reasoning_reviewer.infer_spatial_priors = lambda **_kwargs: {
            "success": True,
            "summary": "campus-centered mixed service area",
            "focus_terms": ["姝︽眽澶у", "姝﹀ぇ"],
            "alias_candidates": ["姝﹀ぇ"],
            "priority_categories": ["绉戞暀鏂囧寲鏈嶅姟"],
            "confidence": 0.85,
        }

        try:
            events = list(pipeline.run(request))
        finally:
            spatial_module.vlm_reviewer.extract_map_anchors = original_vlm
            spatial_module.reasoning_reviewer.infer_spatial_priors = original_llm

        stage_names = [
            (event.get("payload") or {}).get("stage")
            for event in events
            if event.get("type") == "STAGE"
        ]
        self.assertIn("model_parallel_start", stage_names)
        self.assertIn("model_parallel_done", stage_names)

        final_payload = next(event["payload"] for event in events if event.get("type") == "FINAL")
        stats = (final_payload.get("results") or {}).get("stats") or {}
        timing = stats.get("model_timing_ms") or {}

        self.assertIn("vlm_anchor_landmarks", stats)
        self.assertIn("vlm_anchor_aliases", stats)
        self.assertIn("llm_spatial_priors", stats)
        self.assertIn("anchor_boosted_poi_count", stats)
        self.assertIn("anchor_injected_poi_count", stats)
        self.assertEqual(int(timing.get("budget_ms", 0)), 5000)
        self.assertGreaterEqual(float(timing.get("parallel_wall_ms", -1.0)), 0.0)

    def test_pipeline_parallel_model_failure_raises_model_parallel_failed(self):
        pipeline = SpatialPipeline(repository=_StubRepository(_build_clustered_pois()))
        request = _build_area_request(
            options={
                "visualReviewEnabled": True,
                "reasoningEnabled": True,
                "visualSnapshotDataUrl": "data:image/png;base64,stub",
                "modelBudgetMs": 20000,
                "vlmFailureMode": "strict",
            }
        )

        original_vlm = spatial_module.vlm_reviewer.extract_map_anchors
        original_llm = spatial_module.reasoning_reviewer.infer_spatial_priors
        spatial_module.vlm_reviewer.extract_map_anchors = lambda **_kwargs: {
            "success": True,
            "landmarks": ["姝︽眽澶у"],
            "aliases": ["姝﹀ぇ"],
            "layout_summary": "campus-centered",
            "confidence": 0.9,
        }
        spatial_module.reasoning_reviewer.infer_spatial_priors = lambda **_kwargs: {
            "success": False,
            "error": "timeout",
            "debug": {
                "preview_text": "timeout",
                "preview_chars": 7,
                "preview_sha1": "deadbeef",
                "parse_stage": "network",
            },
        }

        events = []
        captured_error = None
        try:
            stream = pipeline.run(request)
            while True:
                events.append(next(stream))
        except StopIteration:
            pass
        except RuntimeError as exc:
            captured_error = exc
        finally:
            spatial_module.vlm_reviewer.extract_map_anchors = original_vlm
            spatial_module.reasoning_reviewer.infer_spatial_priors = original_llm

        self.assertIsNotNone(captured_error)
        self.assertIn("model_parallel_failed:llm:timeout", str(captured_error))

        stage_names = [
            (event.get("payload") or {}).get("stage")
            for event in events
            if event.get("type") == "STAGE"
        ]
        self.assertIn("model_parallel_start", stage_names)
        self.assertIn("model_parallel_failed", stage_names)

        failed_stage_payload = next(
            (event.get("payload") or {})
            for event in events
            if event.get("type") == "STAGE" and (event.get("payload") or {}).get("stage") == "model_parallel_failed"
        )
        self.assertEqual(failed_stage_payload.get("error_code"), "model_parallel_failed:llm:timeout")
        self.assertIn("model_timing_ms", failed_stage_payload)
        self.assertIn("model_context", failed_stage_payload)
        self.assertIn("python_context", failed_stage_payload)

        error_context = getattr(captured_error, "parallel_error_context", None)
        self.assertIsInstance(error_context, dict)
        self.assertEqual(error_context.get("error_code"), "model_parallel_failed:llm:timeout")
        self.assertIsInstance(error_context.get("python_context"), dict)


if __name__ == "__main__":
    unittest.main()



