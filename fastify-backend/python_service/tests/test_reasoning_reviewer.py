import unittest

from pipeline import reasoning_reviewer


class ReasoningReviewerTest(unittest.TestCase):
    def test_infer_spatial_priors_parses_success_payload(self):
        original_call = reasoning_reviewer._call_remote_reasoner
        reasoning_reviewer._call_remote_reasoner = lambda **_kwargs: {
            "summary": "优先关注高校与生活服务混合带",
            "focus_terms": ["武汉大学", "武汉大学"],
            "alias_candidates": ["武大", "武大"],
            "priority_categories": ["科教文化服务", "科教文化服务"],
            "confidence": 1.3,
            "_debug": {
                "preview_text": '{"summary":"优先关注高校与生活服务混合带"}',
                "preview_chars": 42,
                "preview_sha1": "abc123",
                "parse_stage": "payload_parse",
            },
        }
        try:
            result = reasoning_reviewer.infer_spatial_priors(
                semantic_query="武汉大学附近便利店",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=["购物服务"],
                vlm_landmarks=["武汉大学"],
                vlm_aliases=["武大"],
                model_name="qwen3.5-4b",
                endpoint="http://localhost:1234/v1/chat/completions",
                timeout_ms=1500,
            )
        finally:
            reasoning_reviewer._call_remote_reasoner = original_call

        self.assertTrue(result["success"])
        self.assertEqual(result["summary"], "优先关注高校与生活服务混合带")
        self.assertEqual(result["focus_terms"], ["武汉大学"])
        self.assertEqual(result["alias_candidates"], ["武大"])
        self.assertEqual(result["priority_categories"], ["科教文化服务"])
        self.assertEqual(float(result["confidence"]), 1.0)
        self.assertEqual(result["debug"].get("parse_stage"), "payload_parse")

    def test_infer_spatial_priors_returns_error_when_response_invalid(self):
        original_call = reasoning_reviewer._call_remote_reasoner
        reasoning_reviewer._call_remote_reasoner = lambda **_kwargs: None
        try:
            result = reasoning_reviewer.infer_spatial_priors(
                semantic_query="武汉大学附近便利店",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=["购物服务"],
                vlm_landmarks=["武汉大学"],
                vlm_aliases=["武大"],
            )
        finally:
            reasoning_reviewer._call_remote_reasoner = original_call

        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "reasoning_response_invalid")
        self.assertEqual(result["debug"].get("parse_stage"), "response_parse")

    def test_infer_spatial_priors_maps_remote_error(self):
        original_call = reasoning_reviewer._call_remote_reasoner
        reasoning_reviewer._call_remote_reasoner = lambda **_kwargs: {
            "_call_error": "remote_error",
            "_remote_error": "model overload",
            "_debug": {
                "preview_text": "model overload",
                "preview_chars": 14,
                "preview_sha1": "debughash",
                "parse_stage": "remote_error",
            },
        }
        try:
            result = reasoning_reviewer.infer_spatial_priors(
                semantic_query="test",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=[],
                vlm_landmarks=[],
                vlm_aliases=[],
            )
        finally:
            reasoning_reviewer._call_remote_reasoner = original_call

        self.assertFalse(result["success"])
        self.assertTrue(str(result["error"]).startswith("reasoning_remote_error:"))
        self.assertEqual(result["debug"].get("parse_stage"), "remote_error")
        self.assertEqual(result["debug"].get("preview_chars"), 14)

    def test_infer_spatial_priors_maps_parse_error_to_invalid(self):
        original_call = reasoning_reviewer._call_remote_reasoner
        reasoning_reviewer._call_remote_reasoner = lambda **_kwargs: {
            "_call_error": "reasoning_payload_invalid",
            "_debug": {
                "preview_text": "not-json",
                "preview_chars": 8,
                "preview_sha1": "hash",
                "parse_stage": "payload_parse",
            },
        }
        try:
            result = reasoning_reviewer.infer_spatial_priors(
                semantic_query="test",
                spatial_context={"mode": "Viewport", "viewport": [114.30, 30.55, 114.36, 30.61]},
                categories=[],
                vlm_landmarks=[],
                vlm_aliases=[],
            )
        finally:
            reasoning_reviewer._call_remote_reasoner = original_call

        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "reasoning_response_invalid")
        self.assertEqual(result["debug"].get("parse_stage"), "payload_parse")


if __name__ == "__main__":
    unittest.main()
