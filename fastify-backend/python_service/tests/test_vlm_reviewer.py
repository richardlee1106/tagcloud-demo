import io
import json
import unittest
import urllib.error

from pipeline import vlm_reviewer


class VlmReviewerTest(unittest.TestCase):
    def test_extract_map_anchors_parses_and_dedupes(self):
        original_call = vlm_reviewer._call_remote_json
        vlm_reviewer._call_remote_json = lambda **_kwargs: {
            "landmarks": ["武汉大学", "武汉大学"],
            "aliases": ["武大", "武大"],
            "layout_summary": "校园位于画面中心",
            "confidence": 0.87,
            "_debug": {
                "preview_text": '{"landmarks":["武汉大学"]}',
                "preview_chars": 28,
                "preview_sha1": "abc123",
                "parse_stage": "payload_parse",
            },
        }
        try:
            result = vlm_reviewer.extract_map_anchors(
                image_data_url="data:image/png;base64,stub",
                model_name="qwen3-vl-4b",
                endpoint="http://localhost:1234/v1/chat/completions",
                timeout_ms=1200,
            )
        finally:
            vlm_reviewer._call_remote_json = original_call

        self.assertTrue(result["success"])
        self.assertEqual(result["landmarks"], ["武汉大学"])
        self.assertEqual(result["aliases"], ["武大"])
        self.assertEqual(result["layout_summary"], "校园位于画面中心")
        self.assertAlmostEqual(float(result["confidence"]), 0.87, places=2)
        self.assertEqual(result["debug"].get("parse_stage"), "payload_parse")

    def test_extract_map_anchors_requires_snapshot(self):
        result = vlm_reviewer.extract_map_anchors(image_data_url=None)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "visual_snapshot_missing")
        self.assertEqual(result["debug"].get("parse_stage"), "input_validation")

    def test_extract_map_text_uses_anchors_wrapper(self):
        original_extract = vlm_reviewer.extract_map_anchors
        vlm_reviewer.extract_map_anchors = lambda **_kwargs: {
            "success": True,
            "landmarks": ["武汉大学"],
            "aliases": ["武大"],
        }
        try:
            texts = vlm_reviewer.extract_map_text(image_data_url="data:image/png;base64,stub")
        finally:
            vlm_reviewer.extract_map_anchors = original_extract

        self.assertEqual(texts, ["武汉大学", "武大"])

    def test_extract_chat_content_handles_array_content(self):
        raw = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": '{"landmarks":["Wuhan University"],"aliases":["WHU"],"layout_summary":"center","confidence":0.8}',
                                }
                            ]
                        }
                    }
                ]
            },
            ensure_ascii=False,
        )
        payload = vlm_reviewer._extract_chat_content(raw)
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload.get("landmarks"), ["Wuhan University"])

    def test_extract_chat_content_handles_direct_json_object(self):
        raw = json.dumps(
            {
                "landmarks": ["Wuhan University"],
                "aliases": ["WHU"],
                "layout_summary": "center",
                "confidence": 0.8,
            }
        )
        payload = vlm_reviewer._extract_chat_content(raw)
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload.get("aliases"), ["WHU"])

    def test_extract_chat_content_handles_error_payload(self):
        raw = json.dumps({"error": {"message": "model not found"}})
        payload = vlm_reviewer._extract_chat_content(raw)
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload.get("_remote_error"), "model not found")

    def test_extract_map_anchors_surfaces_remote_error(self):
        original_call = vlm_reviewer._call_remote_json
        vlm_reviewer._call_remote_json = lambda **_kwargs: {
            "_remote_error": "model not found",
            "_debug": {
                "preview_text": "model not found",
                "preview_chars": 15,
                "preview_sha1": "hash",
                "parse_stage": "remote_error",
            },
        }
        try:
            result = vlm_reviewer.extract_map_anchors(image_data_url="data:image/png;base64,stub")
        finally:
            vlm_reviewer._call_remote_json = original_call

        self.assertFalse(result.get("success"))
        self.assertIn("vlm_remote_error:model not found", str(result.get("error")))
        self.assertEqual(result["debug"].get("parse_stage"), "remote_error")

    def test_extract_map_anchors_maps_parse_error_to_invalid(self):
        original_call = vlm_reviewer._call_remote_json
        vlm_reviewer._call_remote_json = lambda **_kwargs: {
            "_call_error": "response_parse_invalid",
            "_debug": {
                "preview_text": "not-json",
                "preview_chars": 8,
                "preview_sha1": "hash",
                "parse_stage": "response_parse",
            },
        }
        try:
            result = vlm_reviewer.extract_map_anchors(image_data_url="data:image/png;base64,stub")
        finally:
            vlm_reviewer._call_remote_json = original_call

        self.assertFalse(result.get("success"))
        self.assertEqual(result.get("error"), "vlm_anchor_response_invalid")
        self.assertEqual(result["debug"].get("parse_stage"), "response_parse")
        self.assertEqual(result["debug"].get("preview_chars"), 8)

    def test_call_remote_json_http_400_is_not_url_error(self):
        original_urlopen = vlm_reviewer.urllib.request.urlopen

        def _raise_http_error(_request, timeout=None):
            del timeout
            body = io.BytesIO(b'{"error":{"message":"invalid image content"}}')
            raise urllib.error.HTTPError(
                url="http://localhost:1234/v1/chat/completions",
                code=400,
                msg="Bad Request",
                hdrs=None,
                fp=body,
            )

        vlm_reviewer.urllib.request.urlopen = _raise_http_error
        try:
            payload = vlm_reviewer._call_remote_json(
                endpoint="http://localhost:1234/v1/chat/completions",
                model_name="qwen3-vl-4b",
                system_prompt="system",
                user_prompt="user",
                image_data_url=None,
                timeout_ms=1200,
            )
        finally:
            vlm_reviewer.urllib.request.urlopen = original_urlopen

        self.assertIsInstance(payload, dict)
        self.assertNotEqual(payload.get("_call_error"), "url_error")
        self.assertEqual(payload.get("_call_error"), "http_400")
        self.assertEqual(payload.get("_debug", {}).get("http_status"), 400)
        self.assertEqual(payload.get("_debug", {}).get("parse_stage"), "network_http")

    def test_call_remote_json_retries_image_url_variant_on_http_400(self):
        original_urlopen = vlm_reviewer.urllib.request.urlopen
        request_payloads = []

        class _FakeResponse:
            def __init__(self, body_text):
                self._body = body_text.encode("utf-8")

            def read(self):
                return self._body

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def _mock_urlopen(request, timeout=None):
            del timeout
            decoded = json.loads((request.data or b"{}").decode("utf-8"))
            request_payloads.append(decoded)
            if len(request_payloads) == 1:
                body = io.BytesIO(b'{"error":{"message":"invalid image_url payload"}}')
                raise urllib.error.HTTPError(
                    url="http://localhost:1234/v1/chat/completions",
                    code=400,
                    msg="Bad Request",
                    hdrs=None,
                    fp=body,
                )
            response_json = json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": '{"landmarks":["Wuhan University"],"aliases":["WHU"],"layout_summary":"center","confidence":0.9}'
                            }
                        }
                    ]
                }
            )
            return _FakeResponse(response_json)

        vlm_reviewer.urllib.request.urlopen = _mock_urlopen
        try:
            payload = vlm_reviewer._call_remote_json(
                endpoint="http://localhost:1234/v1/chat/completions",
                model_name="qwen3-vl-4b",
                system_prompt="system",
                user_prompt="user",
                image_data_url="data:image/png;base64,stub",
                timeout_ms=1200,
            )
        finally:
            vlm_reviewer.urllib.request.urlopen = original_urlopen

        self.assertEqual(len(request_payloads), 2)
        first_image = request_payloads[0]["messages"][1]["content"][1]["image_url"]
        second_image = request_payloads[1]["messages"][1]["content"][1]["image_url"]
        self.assertIsInstance(first_image, dict)
        self.assertIsInstance(second_image, str)
        self.assertEqual(payload.get("landmarks"), ["Wuhan University"])


if __name__ == "__main__":
    unittest.main()
