import json
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import Polygon

from pipeline.overlap_evaluator import (
    geometry_bounds_as_viewport,
    load_geometry_from_geojson_file,
    overlap_metrics,
    rank_candidates_by_iou,
)


def _write_tmp_geojson(payload):
    handle = tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False, encoding="utf-8")
    json.dump(payload, handle, ensure_ascii=False)
    handle.flush()
    handle.close()
    return Path(handle.name)


class OverlapEvaluatorTest(unittest.TestCase):
    def test_load_geometry_from_feature_collection(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]],
                    },
                    "properties": {},
                }
            ],
        }
        path = _write_tmp_geojson(payload)
        try:
            geom = load_geometry_from_geojson_file(path)
            viewport = geometry_bounds_as_viewport(geom)
            self.assertEqual(viewport, [0.0, 0.0, 2.0, 1.0])
        finally:
            path.unlink(missing_ok=True)

    def test_load_geometry_union_all_features_with_negative_index(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                    },
                    "properties": {},
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]],
                    },
                    "properties": {},
                },
            ],
        }
        path = _write_tmp_geojson(payload)
        try:
            geom = load_geometry_from_geojson_file(path, feature_index=-1)
            viewport = geometry_bounds_as_viewport(geom)
            self.assertEqual(viewport, [0.0, 0.0, 3.0, 1.0])
        finally:
            path.unlink(missing_ok=True)

    def test_overlap_metrics_for_simple_polygons(self):
        pred = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])
        truth = Polygon([(1, 0), (3, 0), (3, 2), (1, 2), (1, 0)])
        metrics = overlap_metrics(pred, truth)

        # inter=2, union=6 in planar units.
        self.assertAlmostEqual(metrics["intersection_area"], 2.0, places=6)
        self.assertAlmostEqual(metrics["union_area"], 6.0, places=6)
        self.assertAlmostEqual(metrics["iou"], 1.0 / 3.0, places=6)
        self.assertAlmostEqual(metrics["precision"], 0.5, places=6)
        self.assertAlmostEqual(metrics["recall"], 0.5, places=6)

    def test_rank_candidates_by_iou_prefers_best_match(self):
        truth = Polygon([(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)])
        candidates = [
            {
                "id": 1,
                "name": "weak",
                "geometry": Polygon([(5, 5), (6, 5), (6, 6), (5, 6), (5, 5)]),
            },
            {
                "id": 2,
                "name": "good",
                "geometry": Polygon([(1, 1), (4, 1), (4, 4), (1, 4), (1, 1)]),
            },
        ]

        ranked = rank_candidates_by_iou(candidates, truth)
        self.assertEqual(len(ranked), 2)
        self.assertEqual(ranked[0]["name"], "good")
        self.assertGreater(ranked[0]["metrics"]["iou"], ranked[1]["metrics"]["iou"])


if __name__ == "__main__":
    unittest.main()
