import json
import math
import unittest

from pipeline.spatial_pipeline import SpatialPipeline


class _StubRepository:
    def __init__(self, pois=None):
        self._pois = list(pois or [])

    def fetch_pois(self, **_kwargs):
        return list(self._pois)


def _build_clustered_pois():
    centers = [
        (114.020, 30.520, "餐饮"),
        (114.320, 30.520, "零售"),
        (114.170, 30.730, "文娱"),
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


def _build_area_request():
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
                "options": {
                    "limit": 1000,
                    "maxFetchLimit": 1000,
                },
            }
        ),
        "candidates_json": "[]",
    }


class SpatialPipelineTest(unittest.TestCase):
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
        self.assertEqual(stats.get("boundary_confidence_model"), "composite_v1")
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


if __name__ == "__main__":
    unittest.main()
