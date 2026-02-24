import unittest

from shapely.geometry import shape

from pipeline import block_assembler
from pipeline import spatial_pipeline as spatial_module


def _polygon(coords):
    return {
        "type": "Polygon",
        "coordinates": [coords],
    }


class BlockAssemblerV5Test(unittest.TestCase):
    def test_block_support_threshold_excludes_single_outlier_block(self):
        road_blocks = [
            {
                "block_id": 1,
                "geometry_geojson": _polygon(
                    [
                        [114.3000, 30.5000],
                        [114.3040, 30.5000],
                        [114.3040, 30.5040],
                        [114.3000, 30.5040],
                        [114.3000, 30.5000],
                    ]
                ),
            },
            {
                "block_id": 2,
                "geometry_geojson": _polygon(
                    [
                        [114.2500, 30.4500],
                        [114.3600, 30.4500],
                        [114.3600, 30.5600],
                        [114.2500, 30.5600],
                        [114.2500, 30.4500],
                    ]
                ),
            },
        ]

        pois = []
        for idx in range(20):
            pois.append(
                {
                    "id": idx + 1,
                    "name": "样例高校教学楼",
                    "lon": 114.3006 + (idx % 5) * 0.0005,
                    "lat": 30.5007 + (idx // 5) * 0.0005,
                    "block_id": 1,
                    "aoi_name": "样例大学",
                    "aoi_type": "学校",
                    "land_type": "教育用地",
                }
            )

        pois.append(
            {
                "id": 99,
                "name": "异常停车出入口",
                "lon": 114.3550,
                "lat": 30.5550,
                "block_id": 2,
                "aoi_name": "停车设施",
                "aoi_type": "停车场",
                "land_type": "交通枢纽用地",
            }
        )

        labels = [0] * len(pois)
        districts = block_assembler.assemble_block_boundaries(
            cluster_labels=labels,
            pois=pois,
            road_blocks=road_blocks,
            osm_aoi_features=[],
            euluc_features=[],
        )

        self.assertEqual(len(districts), 1)
        self.assertNotIn(2, districts[0].block_ids)

    def test_multi_part_supported_blocks_are_not_forced_to_single_largest_polygon(self):
        road_blocks = [
            {
                "block_id": 11,
                "geometry_geojson": _polygon(
                    [
                        [114.3200, 30.5600],
                        [114.3230, 30.5600],
                        [114.3230, 30.5630],
                        [114.3200, 30.5630],
                        [114.3200, 30.5600],
                    ]
                ),
            },
            {
                "block_id": 12,
                "geometry_geojson": _polygon(
                    [
                        [114.3260, 30.5660],
                        [114.3290, 30.5660],
                        [114.3290, 30.5690],
                        [114.3260, 30.5690],
                        [114.3260, 30.5660],
                    ]
                ),
            },
        ]

        pois = []
        for idx in range(10):
            pois.append(
                {
                    "id": idx + 1,
                    "name": "湖北大学武昌校区",
                    "lon": 114.3204 + (idx % 5) * 0.0004,
                    "lat": 30.5604 + (idx // 5) * 0.0004,
                    "block_id": 11,
                    "aoi_name": "湖北大学武昌校区",
                    "aoi_type": "学校",
                    "land_type": "教育用地",
                }
            )
        for idx in range(10):
            pois.append(
                {
                    "id": idx + 101,
                    "name": "湖北大学武昌校区",
                    "lon": 114.3264 + (idx % 5) * 0.0004,
                    "lat": 30.5664 + (idx // 5) * 0.0004,
                    "block_id": 12,
                    "aoi_name": "湖北大学武昌校区",
                    "aoi_type": "学校",
                    "land_type": "教育用地",
                }
            )

        labels = [0] * len(pois)
        districts = block_assembler.assemble_block_boundaries(
            cluster_labels=labels,
            pois=pois,
            road_blocks=road_blocks,
            osm_aoi_features=[],
            euluc_features=[],
        )

        self.assertEqual(len(districts), 1)
        district = districts[0]
        self.assertIn(11, district.block_ids)
        self.assertIn(12, district.block_ids)
        self.assertEqual(district.boundary_geojson.get("type"), "MultiPolygon")

    def test_strong_aoi_entity_overrides_road_block_union_boundary(self):
        road_blocks = [
            {
                "block_id": 1,
                "geometry_geojson": _polygon(
                    [
                        [114.3200, 30.5600],
                        [114.3240, 30.5600],
                        [114.3240, 30.5640],
                        [114.3200, 30.5640],
                        [114.3200, 30.5600],
                    ]
                ),
            }
        ]
        osm_aoi = [
            {
                "name": "湖北大学",
                "type": "学校",
                "geometry_geojson": _polygon(
                    [
                        [114.3180, 30.5580],
                        [114.3320, 30.5580],
                        [114.3320, 30.5720],
                        [114.3180, 30.5720],
                        [114.3180, 30.5580],
                    ]
                ),
            }
        ]
        pois = []
        for idx in range(12):
            pois.append(
                {
                    "id": idx + 1,
                    "name": "湖北大学教学楼",
                    "lon": 114.3203 + (idx % 4) * 0.0005,
                    "lat": 30.5603 + (idx // 4) * 0.0005,
                    "block_id": 1,
                    "aoi_name": "湖北大学",
                    "aoi_type": "学校",
                    "land_type": "教育用地",
                }
            )
        labels = [0] * len(pois)

        districts = block_assembler.assemble_block_boundaries(
            cluster_labels=labels,
            pois=pois,
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=[],
        )

        self.assertEqual(len(districts), 1)
        district = districts[0]
        self.assertEqual(district.boundary_method, "aoi_override_v5")
        boundary_area = shape(district.boundary_geojson).area
        block_area = shape(road_blocks[0]["geometry_geojson"]).area
        self.assertGreater(boundary_area, block_area * 5.0)

    def test_vlm_anchor_override_promotes_high_authority_aoi(self):
        road_blocks = [
            {
                "block_id": 3,
                "geometry_geojson": _polygon(
                    [
                        [114.3200, 30.5600],
                        [114.3240, 30.5600],
                        [114.3240, 30.5640],
                        [114.3200, 30.5640],
                        [114.3200, 30.5600],
                    ]
                ),
            }
        ]
        osm_aoi = [
            {
                "name": "婀栧寳澶у",
                "type": "瀛︽牎",
                "geometry_geojson": _polygon(
                    [
                        [114.3180, 30.5580],
                        [114.3320, 30.5580],
                        [114.3320, 30.5720],
                        [114.3180, 30.5720],
                        [114.3180, 30.5580],
                    ]
                ),
            }
        ]
        pois = []
        for idx in range(8):
            pois.append(
                {
                    "id": idx + 1,
                    "name": f"store-{idx + 1}",
                    "lon": 114.3203 + (idx % 4) * 0.0005,
                    "lat": 30.5603 + (idx // 4) * 0.0005,
                    "block_id": 3,
                    "aoi_name": "婕椂鍖哄晢鍔″尯",
                    "aoi_type": "鍟嗗姟鍖?",
                    "land_type": "鍟嗕笟鏈嶅姟鐢ㄥ湴",
                }
            )
        for idx in range(2):
            pois.append(
                {
                    "id": idx + 101,
                    "name": f"婀栧寳澶у{idx + 1}鍙锋ゼ",
                    "lon": 114.3216 + idx * 0.0002,
                    "lat": 30.5616 + idx * 0.0002,
                    "block_id": 3,
                    "aoi_name": "",
                    "aoi_type": "",
                    "land_type": "鏁欒偛鐢ㄥ湴",
                }
            )
        labels = [0] * len(pois)

        without_vlm = block_assembler.assemble_block_boundaries(
            cluster_labels=labels,
            pois=pois,
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=[],
        )
        with_vlm = block_assembler.assemble_block_boundaries(
            cluster_labels=labels,
            pois=pois,
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=[],
            vlm_anchor_texts=["婀栧寳澶у"],
        )

        self.assertEqual(len(without_vlm), 1)
        self.assertEqual(len(with_vlm), 1)
        self.assertEqual(without_vlm[0].boundary_method, "road_block_union_v5")
        self.assertEqual(with_vlm[0].boundary_method, "aoi_override_v5")

    def test_land_conflict_filter_removes_residential_blocks_for_medical_cluster(self):
        road_blocks = [
            {
                "block_id": 21,
                "geometry_geojson": _polygon(
                    [
                        [114.3000, 30.5000],
                        [114.3040, 30.5000],
                        [114.3040, 30.5040],
                        [114.3000, 30.5040],
                        [114.3000, 30.5000],
                    ]
                ),
            },
            {
                "block_id": 22,
                "geometry_geojson": _polygon(
                    [
                        [114.3040, 30.5000],
                        [114.3080, 30.5000],
                        [114.3080, 30.5040],
                        [114.3040, 30.5040],
                        [114.3040, 30.5000],
                    ]
                ),
            },
        ]
        pois = []
        for idx in range(12):
            pois.append(
                {
                    "id": idx + 1,
                    "name": "中心医院门诊",
                    "lon": 114.3004 + (idx % 4) * 0.0006,
                    "lat": 30.5004 + (idx // 4) * 0.0006,
                    "block_id": 21,
                    "aoi_name": "",
                    "aoi_type": "",
                    "land_type": "医疗卫生用地",
                }
            )
        for idx in range(8):
            pois.append(
                {
                    "id": idx + 101,
                    "name": "某某花园小区",
                    "lon": 114.3044 + (idx % 4) * 0.0006,
                    "lat": 30.5004 + (idx // 4) * 0.0006,
                    "block_id": 22,
                    "aoi_name": "",
                    "aoi_type": "",
                    "land_type": "居住用地",
                }
            )

        labels = [0] * len(pois)
        districts = block_assembler.assemble_block_boundaries(
            cluster_labels=labels,
            pois=pois,
            road_blocks=road_blocks,
            osm_aoi_features=[],
            euluc_features=[],
        )

        self.assertEqual(len(districts), 1)
        district = districts[0]
        self.assertIn(21, district.block_ids)
        self.assertNotIn(22, district.block_ids)

    def test_v5_dominant_face_prefers_poi_supported_candidate(self):
        road_blocks = [
            {
                "block_id": 88,
                "area_m2": 9000000.0,
                "geometry_geojson": _polygon(
                    [
                        [114.1000, 30.3000],
                        [114.2000, 30.3000],
                        [114.2000, 30.3800],
                        [114.1000, 30.3800],
                        [114.1000, 30.3000],
                    ]
                ),
            }
        ]
        osm_aoi = [
            {
                "aoi_id": 1,
                "area_m2": 2500000.0,
                "geometry_geojson": _polygon(
                    [
                        [114.3200, 30.5600],
                        [114.3400, 30.5600],
                        [114.3400, 30.5800],
                        [114.3200, 30.5800],
                        [114.3200, 30.5600],
                    ]
                ),
            }
        ]
        euluc = []
        pois = [
            {"lon": 114.325, "lat": 30.565},
            {"lon": 114.331, "lat": 30.571},
            {"lon": 114.336, "lat": 30.576},
        ]

        selected = spatial_module._pick_v5_dominant_face(
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=euluc,
            pois=pois,
        )

        self.assertIsNotNone(selected)
        self.assertEqual(selected.get("source"), "osm_aoi")

    def test_v5_dominant_face_tie_prefers_larger_area(self):
        road_blocks = [
            {
                "block_id": 1,
                "area_m2": 1200000.0,
                "geometry_geojson": _polygon(
                    [
                        [114.3000, 30.5000],
                        [114.3120, 30.5000],
                        [114.3120, 30.5120],
                        [114.3000, 30.5120],
                        [114.3000, 30.5000],
                    ]
                ),
            }
        ]
        osm_aoi = [
            {
                "aoi_id": 2,
                "area_m2": 400000.0,
                "geometry_geojson": _polygon(
                    [
                        [114.3000, 30.5000],
                        [114.3080, 30.5000],
                        [114.3080, 30.5080],
                        [114.3000, 30.5080],
                        [114.3000, 30.5000],
                    ]
                ),
            }
        ]
        euluc = []
        pois = [
            {"lon": 114.304, "lat": 30.504},
            {"lon": 114.306, "lat": 30.506},
        ]

        selected = spatial_module._pick_v5_dominant_face(
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=euluc,
            pois=pois,
        )

        self.assertIsNotNone(selected)
        self.assertEqual(selected.get("source"), "road_blocks")
        self.assertGreater(float(selected.get("area_m2", 0.0)), 1000000.0)

    def test_v5_dominant_face_prefers_anchor_matched_face_when_hints_provided(self):
        road_blocks = [
            {
                "block_id": 7,
                "area_m2": 1500000.0,
                "geometry_geojson": _polygon(
                    [
                        [114.3000, 30.5600],
                        [114.3400, 30.5600],
                        [114.3400, 30.6000],
                        [114.3000, 30.6000],
                        [114.3000, 30.5600],
                    ]
                ),
            }
        ]
        osm_aoi = [
            {
                "aoi_id": 21,
                "name": "沙湖公园",
                "type": "公园",
                "area_m2": 450000.0,
                "geometry_geojson": _polygon(
                    [
                        [114.3100, 30.5700],
                        [114.3240, 30.5700],
                        [114.3240, 30.5840],
                        [114.3100, 30.5840],
                        [114.3100, 30.5700],
                    ]
                ),
            }
        ]
        pois = [
            {"lon": 114.305, "lat": 30.565},
            {"lon": 114.306, "lat": 30.566},
            {"lon": 114.307, "lat": 30.567},
            {"lon": 114.311, "lat": 30.571},
            {"lon": 114.312, "lat": 30.572},
        ]

        without_hints = spatial_module._pick_v5_dominant_face(
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=[],
            pois=pois,
            semantic_anchor_hints=[],
        )
        with_hints = spatial_module._pick_v5_dominant_face(
            road_blocks=road_blocks,
            osm_aoi_features=osm_aoi,
            euluc_features=[],
            pois=pois,
            semantic_anchor_hints=["沙湖"],
        )

        self.assertIsNotNone(without_hints)
        self.assertIsNotNone(with_hints)
        self.assertEqual(without_hints.get("source"), "road_blocks")
        self.assertEqual(with_hints.get("source"), "osm_aoi")
        self.assertGreaterEqual(int(with_hints.get("anchor_match") or 0), 1)

    def test_anchor_block_mask_includes_centroid_and_supported_edge_blocks(self):
        dominant_geom = shape(
            _polygon(
                [
                    [0.0, 0.0],
                    [10.0, 0.0],
                    [10.0, 10.0],
                    [0.0, 10.0],
                    [0.0, 0.0],
                ]
            )
        )
        road_blocks = [
            {
                "block_id": 1,
                "geometry_geojson": _polygon(
                    [
                        [1.0, 1.0],
                        [2.0, 1.0],
                        [2.0, 2.0],
                        [1.0, 2.0],
                        [1.0, 1.0],
                    ]
                ),
            },
            {
                "block_id": 2,
                "geometry_geojson": _polygon(
                    [
                        [8.0, -4.0],
                        [14.0, -4.0],
                        [14.0, 4.0],
                        [8.0, 4.0],
                        [8.0, -4.0],
                    ]
                ),
            },
            {
                "block_id": 3,
                "geometry_geojson": _polygon(
                    [
                        [0.0, -10.0],
                        [6.0, -10.0],
                        [6.0, 2.0],
                        [0.0, 2.0],
                        [0.0, -10.0],
                    ]
                ),
            },
        ]

        result = spatial_module._build_anchor_block_mask_geometry(
            road_blocks=road_blocks,
            dominant_geom=dominant_geom,
            support_block_ids={2},
            overlap_ratio_threshold=0.2,
            support_edge_ratio_threshold=0.08,
            use_centroid=True,
        )

        self.assertIsNotNone(result.get("geometry_geojson"))
        self.assertEqual(int(result.get("selected_blocks") or 0), 2)
        self.assertIn(1, result.get("selected_block_ids") or [])
        self.assertIn(2, result.get("selected_block_ids") or [])
        self.assertNotIn(3, result.get("selected_block_ids") or [])
        self.assertGreaterEqual(int(result.get("centroid_hits") or 0), 1)
        self.assertGreaterEqual(int(result.get("support_hits") or 0), 1)

    def test_water_semantic_mask_uses_anchor_aoi_and_water_euluc_intersection(self):
        osm_aoi = [
            {
                "name": "沙湖",
                "type": "公园",
                "geometry_geojson": _polygon(
                    [
                        [0.0, 0.0],
                        [10.0, 0.0],
                        [10.0, 10.0],
                        [0.0, 10.0],
                        [0.0, 0.0],
                    ]
                ),
            },
            {
                "name": "其他公园",
                "type": "公园",
                "geometry_geojson": _polygon(
                    [
                        [20.0, 20.0],
                        [24.0, 20.0],
                        [24.0, 24.0],
                        [20.0, 24.0],
                        [20.0, 20.0],
                    ]
                ),
            },
        ]
        euluc = [
            {
                "land_type": "河流湖泊",
                "geometry_geojson": _polygon(
                    [
                        [2.0, 2.0],
                        [8.0, 2.0],
                        [8.0, 8.0],
                        [2.0, 8.0],
                        [2.0, 2.0],
                    ]
                ),
            },
            {
                "land_type": "公园与绿地用地",
                "geometry_geojson": _polygon(
                    [
                        [5.0, 5.0],
                        [12.0, 5.0],
                        [12.0, 12.0],
                        [5.0, 12.0],
                        [5.0, 5.0],
                    ]
                ),
            },
            {
                "land_type": "商业服务用地",
                "geometry_geojson": _polygon(
                    [
                        [1.0, 1.0],
                        [2.0, 1.0],
                        [2.0, 2.0],
                        [1.0, 2.0],
                        [1.0, 1.0],
                    ]
                ),
            },
        ]

        result = spatial_module._build_water_semantic_mask_geometry(
            osm_aoi_features=osm_aoi,
            euluc_features=euluc,
            anchor_tokens=["沙湖"],
        )

        self.assertIsNotNone(result)
        self.assertEqual(int(result.get("anchor_aoi_count") or 0), 1)
        self.assertEqual(int(result.get("water_euluc_count") or 0), 2)
        mask_geom = shape(result.get("geometry_geojson"))
        self.assertFalse(mask_geom.is_empty)
        minx, miny, maxx, maxy = mask_geom.bounds
        self.assertGreaterEqual(minx, 0.0)
        self.assertGreaterEqual(miny, 0.0)
        self.assertLessEqual(maxx, 10.0)
        self.assertLessEqual(maxy, 10.0)

    def test_anchor_block_mask_rejects_non_centroid_outlier_block(self):
        dominant_geom = shape(
            _polygon(
                [
                    [0.0, 0.0],
                    [10.0, 0.0],
                    [10.0, 10.0],
                    [0.0, 10.0],
                    [0.0, 0.0],
                ]
            )
        )
        road_blocks = [
            {
                "block_id": 10,
                "geometry_geojson": _polygon(
                    [
                        [1.0, 1.0],
                        [2.0, 1.0],
                        [2.0, 2.0],
                        [1.0, 2.0],
                        [1.0, 1.0],
                    ]
                ),
            },
            {
                "block_id": 11,
                "geometry_geojson": _polygon(
                    [
                        [3.0, 3.0],
                        [4.0, 3.0],
                        [4.0, 4.0],
                        [3.0, 4.0],
                        [3.0, 3.0],
                    ]
                ),
            },
            {
                "block_id": 99,
                "geometry_geojson": _polygon(
                    [
                        [6.0, -5.0],
                        [16.0, -5.0],
                        [16.0, 15.0],
                        [6.0, 15.0],
                        [6.0, -5.0],
                    ]
                ),
            },
        ]

        result = spatial_module._build_anchor_block_mask_geometry(
            road_blocks=road_blocks,
            dominant_geom=dominant_geom,
            support_block_ids={99},
            overlap_ratio_threshold=0.2,
            support_edge_ratio_threshold=0.08,
            use_centroid=True,
            outlier_area_factor=5.0,
            outlier_overlap_ratio_threshold=0.45,
        )

        self.assertIsNotNone(result.get("geometry_geojson"))
        self.assertIn(10, result.get("selected_block_ids") or [])
        self.assertIn(11, result.get("selected_block_ids") or [])
        self.assertNotIn(99, result.get("selected_block_ids") or [])
        self.assertGreaterEqual(int(result.get("outlier_rejected") or 0), 1)

    def test_collect_anchor_seed_block_ids_requires_min_hits_and_ratio(self):
        cluster_pois = [
            {"block_id": 1, "name": "湖北大学一号楼", "aoi_name": "湖北大学", "address": ""},
            {"block_id": 1, "name": "湖北大学图书馆", "aoi_name": "湖北大学", "address": ""},
            {"block_id": 1, "name": "校园便利店", "aoi_name": "湖北大学", "address": ""},
            {"block_id": 2, "name": "沙湖公园北门", "aoi_name": "沙湖公园", "address": ""},
            {"block_id": 2, "name": "公交站", "aoi_name": "沙湖公园", "address": ""},
            {"block_id": 2, "name": "公厕", "aoi_name": "沙湖公园", "address": ""},
            {"block_id": 2, "name": "售票处", "aoi_name": "沙湖公园", "address": ""},
        ]

        seeds = spatial_module._collect_anchor_seed_block_ids(
            cluster_pois=cluster_pois,
            anchor_tokens=["湖北大学"],
            min_hits=2,
            min_ratio=0.5,
        )

        self.assertIn(1, seeds)
        self.assertNotIn(2, seeds)

    def test_build_override_anchor_block_geometry_merges_seed_and_centroid_blocks(self):
        block_geom_map = {
            1: shape(
                _polygon(
                    [
                        [0.0, 0.0],
                        [2.0, 0.0],
                        [2.0, 2.0],
                        [0.0, 2.0],
                        [0.0, 0.0],
                    ]
                )
            ),
            2: shape(
                _polygon(
                    [
                        [3.0, 0.0],
                        [5.0, 0.0],
                        [5.0, 2.0],
                        [3.0, 2.0],
                        [3.0, 0.0],
                    ]
                )
            ),
            3: shape(
                _polygon(
                    [
                        [8.0, 0.0],
                        [10.0, 0.0],
                        [10.0, 2.0],
                        [8.0, 2.0],
                        [8.0, 0.0],
                    ]
                )
            ),
        }
        override_geom = shape(
            _polygon(
                [
                    [-1.0, -1.0],
                    [2.5, -1.0],
                    [2.5, 2.5],
                    [-1.0, 2.5],
                    [-1.0, -1.0],
                ]
            )
        )

        result = spatial_module._build_override_anchor_block_geometry(
            block_geom_map=block_geom_map,
            override_geom=override_geom,
            seed_block_ids={2},
        )

        self.assertIsNotNone(result)
        self.assertIn(1, result.get("selected_block_ids") or [])
        self.assertIn(2, result.get("selected_block_ids") or [])
        self.assertNotIn(3, result.get("selected_block_ids") or [])
        merged = shape(result.get("geometry_geojson"))
        self.assertFalse(merged.is_empty)

    def test_is_ecology_context_requires_explicit_ecology_signal(self):
        self.assertFalse(
            spatial_module._is_ecology_context(
                dominant_land_type="教育用地",
                dominant_aoi_type="大学",
                region_name="湖北大学科教片区",
            )
        )
        self.assertTrue(
            spatial_module._is_ecology_context(
                dominant_land_type="公园与绿地用地",
                dominant_aoi_type="公园",
                region_name="沙湖生态片区",
            )
        )

    def test_deduplicate_cluster_entries_keeps_best_overlapping_same_anchor(self):
        cluster_entries = [
            {
                "id": 1,
                "name": "湖北大学科教片区",
                "boundary_geojson": _polygon(
                    [
                        [0.0, 0.0],
                        [4.0, 0.0],
                        [4.0, 4.0],
                        [0.0, 4.0],
                        [0.0, 0.0],
                    ]
                ),
                "boundary_confidence": 0.88,
                "vitality_score": 0.76,
                "poi_count": 32,
                "semantic_anchor": {"name": "湖北大学"},
            },
            {
                "id": 2,
                "name": "湖北大学科教片区",
                "boundary_geojson": _polygon(
                    [
                        [0.2, 0.2],
                        [4.2, 0.2],
                        [4.2, 4.2],
                        [0.2, 4.2],
                        [0.2, 0.2],
                    ]
                ),
                "boundary_confidence": 0.61,
                "vitality_score": 0.52,
                "poi_count": 15,
                "semantic_anchor": {"name": "湖北大学"},
            },
            {
                "id": 3,
                "name": "沙湖生态片区",
                "boundary_geojson": _polygon(
                    [
                        [6.0, 6.0],
                        [9.0, 6.0],
                        [9.0, 9.0],
                        [6.0, 9.0],
                        [6.0, 6.0],
                    ]
                ),
                "boundary_confidence": 0.83,
                "vitality_score": 0.68,
                "poi_count": 20,
                "semantic_anchor": {"name": "沙湖"},
            },
        ]

        deduped, summary = spatial_module._deduplicate_cluster_entries(
            cluster_entries,
            iou_threshold=0.8,
            containment_threshold=0.9,
        )

        kept_ids = {int(item.get("id") or 0) for item in deduped}
        self.assertEqual(len(deduped), 2)
        self.assertIn(1, kept_ids)
        self.assertIn(3, kept_ids)
        self.assertNotIn(2, kept_ids)
        self.assertEqual(int(summary.get("removed_count") or 0), 1)


if __name__ == "__main__":
    unittest.main()
