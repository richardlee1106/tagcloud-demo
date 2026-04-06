import importlib.util
import unittest
from pathlib import Path

import numpy as np


def load_service_module():
    repo_root = Path(__file__).resolve().parents[2]
    module_path = repo_root / 'python' / 'services' / 'spatialEncoderService.py'
    spec = importlib.util.spec_from_file_location('spatial_encoder_service_test_module', module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SpatialEncoderServiceTests(unittest.TestCase):
    def setUp(self):
        self.module = load_service_module()

    def test_infers_ultimate_checkpoint_architecture_from_attention_and_proto_keys(self):
        architecture = self.module.infer_checkpoint_architecture({
            'input_proj.0.weight': None,
            'coord_head.weight': None,
            'spatial_attention.attention.in_proj_weight': None,
            'prototype_learning.prototypes': None,
        })
        self.assertEqual(architecture, 'ultimate')

    def test_infers_mlp_checkpoint_architecture_from_coord_reconstruct_head(self):
        architecture = self.module.infer_checkpoint_architecture({
            'input_proj.0.weight': None,
            'coord_reconstruct_head.weight': None,
        })
        self.assertEqual(architecture, 'mlp')

    def test_project_root_resolves_to_repo_root_with_spatial_encoder_directory(self):
        self.assertTrue((self.module.PROJECT_ROOT / 'spatial_encoder').exists())
        self.assertTrue((self.module.PROJECT_ROOT / 'V3-GeoEncoder-RAG').exists())

    def test_health_payload_exposes_dual_model_status_map(self):
        self.module.state.models = {
            'poi': type('ModelStatus', (), {
                'loaded': True,
                'architecture': 'ultimate',
                'checkpoint_path': 'saved_models/poi_encoder/best_model.pt',
                'embedding_dim': 352,
                'startup_error': None,
                'item_count': None
            })(),
            'town': type('ModelStatus', (), {
                'loaded': True,
                'architecture': 'mlp',
                'checkpoint_path': 'saved_models/town_encoder/best_model.pt',
                'embedding_dim': 352,
                'startup_error': None,
                'item_count': 1828
            })()
        }
        self.module.state.loaded = True

        payload = self.module.build_health_payload()

        self.assertEqual(payload['status'], 'ok')
        self.assertTrue(payload['encoder_loaded'])
        self.assertIn('models', payload)
        self.assertTrue(payload['models']['poi']['loaded'])
        self.assertTrue(payload['models']['town']['loaded'])
        self.assertEqual(payload['models']['town']['item_count'], 1828)

    def test_health_payload_marks_partial_when_town_index_is_unavailable(self):
        self.module.state.models = {
            'poi': type('ModelStatus', (), {
                'loaded': True,
                'architecture': 'ultimate',
                'checkpoint_path': 'saved_models/poi_encoder/best_model.pt',
                'embedding_dim': 352,
                'startup_error': None,
                'item_count': None
            })(),
            'town': type('ModelStatus', (), {
                'loaded': True,
                'architecture': 'mlp',
                'checkpoint_path': 'saved_models/town_encoder/best_model.pt',
                'embedding_dim': 352,
                'startup_error': 'town_cell_index_not_ready',
                'item_count': None
            })()
        }
        self.module.state.loaded = False
        self.module.state.startup_error = 'town:cell_index_unavailable'

        payload = self.module.build_health_payload()

        self.assertEqual(payload['status'], 'partial')
        self.assertFalse(payload['encoder_loaded'])
        self.assertFalse(payload['models']['town']['loaded'])

    def test_search_similar_cells_prefers_anchor_cell_and_exposes_search_score(self):
        self.module.state.town_coords = np.asarray([
            [114.3340, 30.5790],
            [114.3380, 30.5815],
            [114.3520, 30.5940],
        ], dtype=np.float32)
        self.module.state.town_embeddings = np.asarray([
            [1.0, 0.0, 0.0],
            [0.92, 0.08, 0.0],
            [0.25, 0.75, 0.0],
        ], dtype=np.float32)
        self.module.state.town_cells = [
            {
                'cell_id': 'cell-a',
                'lon': 114.3340,
                'lat': 30.5790,
                'region_idx': 1,
                'region_name': '商业类',
                'region_confidence': 0.91,
                'dominant_category': '购物服务',
                'aoi_type': '商业',
                'poi_count': 42,
            },
            {
                'cell_id': 'cell-b',
                'lon': 114.3380,
                'lat': 30.5815,
                'region_idx': 1,
                'region_name': '商业类',
                'region_confidence': 0.88,
                'dominant_category': '餐饮美食',
                'aoi_type': '商业',
                'poi_count': 37,
            },
            {
                'cell_id': 'cell-c',
                'lon': 114.3520,
                'lat': 30.5940,
                'region_idx': 3,
                'region_name': '教育类',
                'region_confidence': 0.79,
                'dominant_category': '科教文化服务',
                'aoi_type': '教育',
                'poi_count': 28,
            },
        ]

        anchor_context, cells, radius_m, macro_summary = self.module.search_similar_cells(
            114.3340,
            30.5790,
            task_type='support_gap_analysis',
            top_k=2,
        )

        self.assertEqual(anchor_context['cell_id'], 'cell-a')
        self.assertEqual(len(cells), 2)
        self.assertEqual(cells[0]['cell_id'], 'cell-a')
        self.assertIn('search_score', cells[0])
        self.assertGreaterEqual(cells[0]['search_score'], cells[1]['search_score'])
        self.assertGreater(radius_m, 0)
        self.assertIn('support_bucket_distribution', macro_summary)

    def test_build_online_poi_features_uses_neighbor_road_and_landuse_context(self):
        point_feat, line_feat, polygon_feat, direction_feat, feature_meta = self.module.build_online_poi_features(
            114.3340,
            30.5790,
            nearby_pois=[
                {'category_main': '购物服务', 'distance_m': 18.0},
                {'category_main': '购物服务', 'distance_m': 52.0},
                {'category_main': '生活服务', 'distance_m': 96.0},
            ],
            road_rows=[
                {'fclass': 'primary', 'count': 2},
                {'fclass': 'secondary', 'count': 1},
                {'fclass': 'service', 'count': 3},
            ],
            landuse_row={'land_type': '商业服务用地', 'area_sqm': 420000.0},
        )

        shopping_idx = self.module.CATEGORY_TO_IDX['购物服务']
        living_idx = self.module.CATEGORY_TO_IDX['生活服务']
        primary_idx = self.module.ROAD_CLASS_TO_IDX['primary']
        secondary_idx = self.module.ROAD_CLASS_TO_IDX['secondary']
        landuse_idx = self.module.LANDUSE_TO_IDX['商业服务用地']

        self.assertAlmostEqual(point_feat[2], np.log1p(3) / 10.0, places=6)
        self.assertAlmostEqual(point_feat[3 + shopping_idx], 2 / 3, places=6)
        self.assertAlmostEqual(point_feat[3 + living_idx], 1 / 3, places=6)
        self.assertGreater(point_feat[19], 0.0)
        self.assertEqual(point_feat[20 + shopping_idx], 1.0)

        self.assertAlmostEqual(line_feat[2], np.log1p(6) / 5.0, places=6)
        self.assertAlmostEqual(line_feat[3 + primary_idx], 2 / 6, places=6)
        self.assertAlmostEqual(line_feat[3 + secondary_idx], 1 / 6, places=6)

        self.assertAlmostEqual(polygon_feat[2], 0.42, places=6)
        self.assertEqual(polygon_feat[3 + landuse_idx], 1.0)
        self.assertAlmostEqual(float(direction_feat.sum()), 1.0, places=6)

        self.assertEqual(feature_meta['feature_source'], 'poi_online_context_v2')
        self.assertEqual(feature_meta['feature_stats']['neighbor_poi_count'], 3)
        self.assertEqual(feature_meta['feature_stats']['road_count'], 6)
        self.assertEqual(feature_meta['feature_stats']['landuse_type'], '商业服务用地')
        self.assertEqual(feature_meta['feature_stats']['anchor_category_main'], '购物服务')

    def test_build_poi_features_for_anchor_uses_exact_poi_category_when_poi_id_is_available(self):
        self.module.fetch_poi_anchor_row = lambda poi_id: {
            'id': 9527,
            'name': '湖北大学',
            'lon': 114.334121,
            'lat': 30.576870,
            'category_main': '科教文化服务',
        }
        self.module.fetch_online_poi_feature_context = lambda lon, lat, exclude_poi_id=None: {
            'nearby_pois': [
                {'id': 9527, 'category_main': '科教文化服务', 'distance_m': 0.0},
                {'id': 1001, 'category_main': '购物服务', 'distance_m': 16.0},
                {'id': 1002, 'category_main': '购物服务', 'distance_m': 28.0},
            ],
            'road_rows': [],
            'landuse_row': None,
            'query_error': None,
        }

        point_feat, _line_feat, _polygon_feat, _direction_feat, feature_meta = self.module.build_poi_features_for_anchor(
            114.334121,
            30.576870,
            poi_id=9527,
        )

        education_idx = self.module.CATEGORY_TO_IDX['科教文化服务']

        self.assertEqual(point_feat[20 + education_idx], 1.0)
        self.assertEqual(feature_meta['feature_source'], 'poi_exact_anchor_v1')
        self.assertEqual(feature_meta['feature_stats']['anchor_poi_id'], 9527)
        self.assertEqual(feature_meta['feature_stats']['anchor_category_main'], '科教文化服务')
        self.assertEqual(feature_meta['feature_stats']['neighbor_poi_count'], 2)

    def test_build_poi_features_for_anchor_prefers_offline_cache_when_available(self):
        cached_point = np.zeros(32, dtype=np.float32)
        cached_line = np.zeros(16, dtype=np.float32)
        cached_polygon = np.zeros(16, dtype=np.float32)
        cached_direction = np.zeros(8, dtype=np.float32)
        cached_point[0] = 0.25
        cached_point[20 + self.module.CATEGORY_TO_IDX['科教文化服务']] = 1.0
        cached_direction[3] = 1.0

        self.module.state.poi_feature_cache = {
            'poi_ids': np.array([9527], dtype=np.int64),
            'point_features': np.array([cached_point], dtype=np.float32),
            'line_features': np.array([cached_line], dtype=np.float32),
            'polygon_features': np.array([cached_polygon], dtype=np.float32),
            'direction_features': np.array([cached_direction], dtype=np.float32),
        }
        self.module.state.poi_feature_index = {9527: 0}
        self.module.state.poi_feature_cache_loaded = True
        self.module.state.poi_feature_cache_count = 1
        self.module.state.poi_feature_cache_path = 'cache/test_poi_feature_cache_v1.npz'

        self.module.fetch_poi_anchor_row = lambda poi_id: {
            'id': 9527,
            'name': '湖北大学',
            'lon': 114.334121,
            'lat': 30.576870,
            'category_main': '科教文化服务',
        }
        self.module.fetch_online_poi_feature_context = lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError('offline cache hit should not query online context')
        )

        point_feat, line_feat, polygon_feat, direction_feat, feature_meta = self.module.build_poi_features_for_anchor(
            114.334121,
            30.576870,
            poi_id=9527,
        )

        self.assertEqual(point_feat[0], cached_point[0])
        self.assertEqual(line_feat[0], cached_line[0])
        self.assertEqual(polygon_feat[0], cached_polygon[0])
        self.assertEqual(direction_feat[3], 1.0)
        self.assertEqual(feature_meta['feature_source'], 'poi_offline_exact_v1')
        self.assertEqual(feature_meta['feature_stats']['anchor_poi_id'], 9527)
        self.assertEqual(feature_meta['feature_stats']['anchor_category_main'], '科教文化服务')
        self.assertTrue(feature_meta['feature_stats']['offline_cache_hit'])

    def test_build_poi_features_for_anchor_falls_back_when_offline_cache_missing(self):
        self.module.state.poi_feature_cache = None
        self.module.state.poi_feature_index = {}
        self.module.state.poi_feature_cache_loaded = False
        self.module.state.poi_feature_cache_count = 0
        self.module.fetch_poi_anchor_row = lambda poi_id: {
            'id': 9527,
            'name': '湖北大学',
            'lon': 114.334121,
            'lat': 30.576870,
            'category_main': '科教文化服务',
        }
        self.module.fetch_online_poi_feature_context = lambda lon, lat, exclude_poi_id=None: {
            'nearby_pois': [],
            'road_rows': [],
            'landuse_row': None,
            'query_error': None,
        }

        _point_feat, _line_feat, _polygon_feat, _direction_feat, feature_meta = self.module.build_poi_features_for_anchor(
            114.334121,
            30.576870,
            poi_id=9527,
        )

        self.assertEqual(feature_meta['feature_source'], 'poi_exact_anchor_v1')
        self.assertEqual(feature_meta['feature_stats']['anchor_poi_id'], 9527)
        self.assertFalse(feature_meta['feature_stats'].get('offline_cache_hit', False))

    def test_build_text_embedding_detects_semantic_concepts_and_normalizes_output(self):
        vector, tokens = self.module.build_text_embedding('武汉大学附近咖啡店和最近的地铁站')

        self.assertEqual(vector.shape[0], self.module.TEXT_EMBEDDING_DIM)
        self.assertGreaterEqual(len(tokens), 2)
        self.assertTrue(any(token in tokens for token in ['高校', '咖啡', '地铁']))
        self.assertAlmostEqual(float(np.linalg.norm(vector)), 1.0, places=4)


if __name__ == '__main__':
    unittest.main()
