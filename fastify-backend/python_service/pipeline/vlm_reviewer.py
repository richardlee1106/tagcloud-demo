# -*- coding: utf-8 -*-
"""VLM helpers for morphology review and map-anchor extraction."""

from __future__ import annotations

import hashlib
import json
import math
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List

from shapely.geometry import shape


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _sha1_text(value: Any) -> str:
    text = str(value or "")
    return hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()


def _redacted_preview(value: Any, max_length: int = 240) -> Dict[str, Any]:
    text = str(value or "")
    compact = re.sub(r"\s+", " ", text).strip()
    preview = compact[:max_length]
    if len(compact) > max_length:
        preview = f"{preview}..."
    return {
        "preview_text": preview,
        "preview_chars": len(text),
        "preview_sha1": _sha1_text(text),
    }


def _normalize_token(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    return re.sub(r"\s+", "", text)


def _dedupe_strings(values: List[Any], *, max_items: int) -> List[str]:
    deduped: List[str] = []
    seen: set[str] = set()
    for raw in values:
        item = str(raw or "").strip()
        if not item:
            continue
        key = _normalize_token(item)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
        if len(deduped) >= max_items:
            break
    return deduped


def _bbox_from_spatial_context(spatial_context: Dict[str, Any]) -> Dict[str, float] | None:
    viewport = spatial_context.get("viewport")
    if not isinstance(viewport, (list, tuple)) or len(viewport) < 4:
        return None
    try:
        min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
    except (TypeError, ValueError):
        return None
    return {
        "min_lon": min_lon,
        "min_lat": min_lat,
        "max_lon": max_lon,
        "max_lat": max_lat,
    }


def _boundary_compactness(boundary_geojson: Dict[str, Any] | None) -> float | None:
    if not isinstance(boundary_geojson, dict):
        return None
    try:
        polygon = shape(boundary_geojson)
    except Exception:
        return None
    if polygon is None or polygon.is_empty:
        return None
    perimeter = float(getattr(polygon, "length", 0.0) or 0.0)
    area = float(getattr(polygon, "area", 0.0) or 0.0)
    if perimeter <= 0 or area <= 0:
        return None
    compactness = 4.0 * math.pi * area / (perimeter * perimeter)
    return _clamp01(compactness)


def _heuristic_visual_score(
    *,
    boundary_quality: Dict[str, Any] | None,
    compactness: float | None,
    poi_count: int,
) -> float:
    quality = boundary_quality or {}
    quality_score = _clamp01(_to_float(quality.get("quality_score")) or 0.55)
    coverage_score = _clamp01(_to_float(quality.get("coverage_ratio")) or 0.55)
    road_score = _clamp01(_to_float(quality.get("road_alignment_score")) or 0.50)
    landuse_score = _clamp01(_to_float(quality.get("landuse_alignment_score")) or 0.50)
    compactness_score = compactness if compactness is not None else 0.52

    poi_bonus = min(0.06, math.log1p(max(0, int(poi_count))) / 70.0)
    score = (
        0.30 * quality_score
        + 0.24 * coverage_score
        + 0.18 * road_score
        + 0.16 * landuse_score
        + 0.12 * compactness_score
        + poi_bonus
    )
    return _clamp01(score)


def _parse_json_object(raw_text: str) -> Dict[str, Any] | None:
    text = str(raw_text or "").strip()
    if not text:
        return None
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except Exception:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        value = json.loads(match.group(0))
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if isinstance(content.get("text"), str):
            return str(content.get("text"))
        if isinstance(content.get("value"), str):
            return str(content.get("value"))
        nested = content.get("content")
        if nested is not None:
            return _content_to_text(nested)
        return ""
    if isinstance(content, list):
        parts = [_content_to_text(item) for item in content]
        parts = [part for part in parts if part]
        return "\n".join(parts)
    return ""


def _extract_response_text(parsed: Dict[str, Any]) -> str:
    choices = parsed.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message") if isinstance(first.get("message"), dict) else {}
        text = _content_to_text(message.get("content"))
        if text:
            return text
        text = _content_to_text(first.get("text"))
        if text:
            return text

    output = parsed.get("output")
    if isinstance(output, list) and output:
        first_output = output[0] if isinstance(output[0], dict) else {}
        text = _content_to_text(first_output.get("content"))
        if text:
            return text

    text = _content_to_text(parsed.get("content"))
    if text:
        return text
    return _content_to_text(parsed.get("text"))


def _extract_chat_content(raw: str) -> Dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    remote_error = parsed.get("error")
    if isinstance(remote_error, dict):
        message = str(
            remote_error.get("message")
            or remote_error.get("code")
            or "remote_error"
        ).strip()
        return {"_remote_error": message}
    if isinstance(remote_error, str) and remote_error.strip():
        return {"_remote_error": remote_error.strip()}
    if any(key in parsed for key in ("landmarks", "aliases", "layout_summary", "confidence")):
        return parsed
    # Some OpenAI-compatible endpoints return message.content as list blocks.
    content_text = _extract_response_text(parsed)
    if not content_text:
        return None
    return _parse_json_object(content_text)


def _call_remote_json(
    *,
    endpoint: str,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    image_data_url: str | None = None,
    timeout_ms: int = 1200,
    max_tokens: int = 400,
) -> Dict[str, Any]:
    def _build_user_content(image_variant: str | None) -> Any:
        if not image_data_url:
            return user_prompt
        image_block: Dict[str, Any]
        if image_variant == "image_url_string":
            image_block = {"type": "image_url", "image_url": image_data_url}
        else:
            image_block = {"type": "image_url", "image_url": {"url": image_data_url}}
        return [
            {"type": "text", "text": user_prompt},
            image_block,
        ]

    attempt_variants: List[str | None] = [None]
    if image_data_url:
        attempt_variants = ["image_url_object", "image_url_string"]

    timeout_s = max(0.5, float(timeout_ms) / 1000.0)
    raw = ""
    used_variant = attempt_variants[0]
    for attempt_idx, image_variant in enumerate(attempt_variants):
        payload = {
            "model": model_name,
            "temperature": 0.1,
            "max_tokens": int(max_tokens),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": _build_user_content(image_variant)},
            ],
        }

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=timeout_s) as response:
                raw = response.read().decode("utf-8", errors="ignore")
                used_variant = image_variant
                break
        except urllib.error.HTTPError as exc:
            status_code = int(getattr(exc, "code", 0) or 0)
            response_raw = ""
            try:
                if getattr(exc, "fp", None) is not None:
                    response_raw = exc.read().decode("utf-8", errors="ignore")
            except Exception:
                response_raw = ""

            debug_payload = {
                **_redacted_preview(response_raw or str(exc)),
                "parse_stage": "network_http",
                "http_status": status_code,
                "request_variant": image_variant or "text_only",
                "attempt": attempt_idx + 1,
            }

            # LM Studio / OpenAI-compatible endpoints may require image_url as string.
            should_retry_variant = (
                bool(image_data_url)
                and status_code == 400
                and image_variant == "image_url_object"
                and attempt_idx + 1 < len(attempt_variants)
            )
            if should_retry_variant:
                continue

            call_error = f"http_{status_code}" if status_code > 0 else "http_error"
            return {
                "_call_error": call_error,
                "_debug": debug_payload,
            }
        except urllib.error.URLError as exc:
            return {
                "_call_error": "url_error",
                "_debug": {
                    **_redacted_preview(str(exc)),
                    "parse_stage": "network",
                },
            }
        except Exception as exc:
            return {
                "_call_error": "request_failed",
                "_debug": {
                    **_redacted_preview(str(exc)),
                    "parse_stage": "network",
                },
            }
    else:
        return {
            "_call_error": "request_failed",
            "_debug": {
                **_redacted_preview("no_response_after_retries"),
                "parse_stage": "network",
            },
        }

    parsed = _extract_chat_content(raw)
    if not isinstance(parsed, dict):
        return {
            "_call_error": "response_parse_invalid",
            "_debug": {
                **_redacted_preview(raw),
                "parse_stage": "response_parse",
            },
        }

    debug = parsed.get("_debug") if isinstance(parsed.get("_debug"), dict) else {}
    parsed["_debug"] = {
        **_redacted_preview(raw),
        **debug,
        "request_variant": used_variant or "text_only",
        "parse_stage": str(debug.get("parse_stage") or "response_parse"),
    }
    return parsed


def extract_map_anchors(
    *,
    image_data_url: str | None,
    model_name: str = "glm-ocr",
    endpoint: str = "http://localhost:1234/v1/chat/completions",
    timeout_ms: int = 1200,
    max_landmarks: int = 8,
    max_aliases: int = 12,
) -> Dict[str, Any]:
    result = {
        "success": False,
        "mode": "glm_ocr_anchor_v1",
        "model": model_name,
        "landmarks": [],
        "aliases": [],
        "layout_summary": "",
        "confidence": 0.0,
        "error": None,
        "debug": {},
    }
    if not image_data_url:
        result["error"] = "visual_snapshot_missing"
        result["debug"] = {
            **_redacted_preview("visual_snapshot_missing"),
            "parse_stage": "input_validation",
        }
        return result

    system_prompt = (
        "You are a map OCR and geo-anchor extractor. "
        "Return JSON only with keys: landmarks, aliases, layout_summary, confidence."
    )
    user_prompt = (
        "Extract prominent place names inside and near the selected boundary from the map snapshot. "
        "Include short aliases (for example, 武汉大学 -> 武大) when very likely. "
        "Return JSON: "
        '{"landmarks":["..."],"aliases":["..."],"layout_summary":"...","confidence":0.0}'
    )
    payload = _call_remote_json(
        endpoint=endpoint,
        model_name=model_name,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        image_data_url=image_data_url,
        timeout_ms=timeout_ms,
        max_tokens=420,
    )
    if not isinstance(payload, dict):
        result["error"] = "vlm_anchor_response_invalid"
        result["debug"] = {
            **_redacted_preview("payload_not_dict"),
            "parse_stage": "response_parse",
        }
        return result

    debug_payload = payload.get("_debug") if isinstance(payload.get("_debug"), dict) else {}
    call_error = str(payload.get("_call_error") or "").strip()
    if call_error:
        if call_error == "response_parse_invalid":
            result["error"] = "vlm_anchor_response_invalid"
        else:
            result["error"] = f"vlm_remote_error:{call_error}"
        result["debug"] = {
            **debug_payload,
            "parse_stage": str(debug_payload.get("parse_stage") or "response_parse"),
        }
        return result

    remote_error = str(payload.get("_remote_error") or "").strip()
    if remote_error:
        result["error"] = f"vlm_remote_error:{remote_error[:160]}"
        result["debug"] = {
            **debug_payload,
            **_redacted_preview(remote_error),
            "parse_stage": str(debug_payload.get("parse_stage") or "remote_error"),
        }
        return result

    result["landmarks"] = _dedupe_strings(
        payload.get("landmarks") if isinstance(payload.get("landmarks"), list) else [],
        max_items=max(1, int(max_landmarks)),
    )
    result["aliases"] = _dedupe_strings(
        payload.get("aliases") if isinstance(payload.get("aliases"), list) else [],
        max_items=max(1, int(max_aliases)),
    )
    result["layout_summary"] = str(payload.get("layout_summary") or "").strip()[:240]
    result["confidence"] = _clamp01(_to_float(payload.get("confidence")) or 0.0)
    result["debug"] = {
        **debug_payload,
        "parse_stage": str(debug_payload.get("parse_stage") or "parsed"),
    }
    result["success"] = True
    return result


def extract_map_text(
    *,
    image_data_url: str | None,
    model_name: str = "glm-ocr",
    endpoint: str = "http://localhost:1234/v1/chat/completions",
    timeout_ms: int = 1200,
) -> List[str]:
    anchors = extract_map_anchors(
        image_data_url=image_data_url,
        model_name=model_name,
        endpoint=endpoint,
        timeout_ms=timeout_ms,
    )
    if not anchors.get("success"):
        return []
    return _dedupe_strings(
        list(anchors.get("landmarks") or []) + list(anchors.get("aliases") or []),
        max_items=30,
    )


def summarize_map_overview(
    *,
    image_data_url: str | None,
    model_name: str = "qwen3.5-0.8b",
    endpoint: str = "http://localhost:1234/v1/chat/completions",
    timeout_ms: int = 1400,
) -> Dict[str, Any]:
    result = {
        "success": False,
        "mode": "map_overview_v1",
        "model": model_name,
        "summary": "",
        "road_pattern": "",
        "functional_distribution": "",
        "key_observations": [],
        "confidence": 0.0,
        "error": None,
        "debug": {},
    }
    if not image_data_url:
        result["error"] = "visual_snapshot_missing"
        result["debug"] = {
            **_redacted_preview("visual_snapshot_missing"),
            "parse_stage": "input_validation",
        }
        return result

    system_prompt = (
        "You are a map scene analyst for spatial planning. "
        "Observe global map semantics and return strict JSON only."
    )
    user_prompt = (
        "From this map screenshot, provide global semantic observation with three focuses: "
        "1) area morphology and texture, 2) main road relation and accessibility pattern, "
        "3) functional distribution hints. "
        "Return JSON: "
        '{"summary":"...",'
        '"road_pattern":"...",'
        '"functional_distribution":"...",'
        '"key_observations":["..."],'
        '"confidence":0.0}'
    )
    payload = _call_remote_json(
        endpoint=endpoint,
        model_name=model_name,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        image_data_url=image_data_url,
        timeout_ms=timeout_ms,
        max_tokens=420,
    )
    if not isinstance(payload, dict):
        result["error"] = "vlm_overview_response_invalid"
        result["debug"] = {
            **_redacted_preview("payload_not_dict"),
            "parse_stage": "response_parse",
        }
        return result

    debug_payload = payload.get("_debug") if isinstance(payload.get("_debug"), dict) else {}
    call_error = str(payload.get("_call_error") or "").strip()
    if call_error:
        if call_error == "response_parse_invalid":
            result["error"] = "vlm_overview_response_invalid"
        else:
            result["error"] = f"vlm_remote_error:{call_error}"
        result["debug"] = {
            **debug_payload,
            "parse_stage": str(debug_payload.get("parse_stage") or "response_parse"),
        }
        return result

    remote_error = str(payload.get("_remote_error") or "").strip()
    if remote_error:
        result["error"] = f"vlm_remote_error:{remote_error[:160]}"
        result["debug"] = {
            **debug_payload,
            **_redacted_preview(remote_error),
            "parse_stage": str(debug_payload.get("parse_stage") or "remote_error"),
        }
        return result

    summary = str(payload.get("summary") or "").strip()
    road_pattern = str(payload.get("road_pattern") or "").strip()
    functional_distribution = str(payload.get("functional_distribution") or "").strip()
    key_observations = _dedupe_strings(
        payload.get("key_observations") if isinstance(payload.get("key_observations"), list) else [],
        max_items=8,
    )
    if not summary:
        summary = " ".join(
            part for part in [road_pattern, functional_distribution] if part
        ).strip()[:360]

    result["summary"] = summary[:360]
    result["road_pattern"] = road_pattern[:220]
    result["functional_distribution"] = functional_distribution[:220]
    result["key_observations"] = key_observations
    result["confidence"] = _clamp01(_to_float(payload.get("confidence")) or 0.0)
    result["debug"] = {
        **debug_payload,
        "parse_stage": str(debug_payload.get("parse_stage") or "parsed"),
    }
    result["success"] = True
    return result


def review_cluster_morphology(
    *,
    spatial_context: Dict[str, Any],
    boundary_geojson: Dict[str, Any] | None,
    boundary_quality: Dict[str, Any] | None,
    poi_count: int,
    model_name: str = "qwen3.5-2b",
    endpoint: str = "http://localhost:1234/v1/chat/completions",
    image_data_url: str | None = None,
    enable_remote: bool = False,
    timeout_ms: int = 1200,
) -> Dict[str, Any]:
    bbox = _bbox_from_spatial_context(spatial_context) or {}
    compactness = _boundary_compactness(boundary_geojson)
    heuristic_score = _heuristic_visual_score(
        boundary_quality=boundary_quality,
        compactness=compactness,
        poi_count=poi_count,
    )

    review = {
        "score": heuristic_score,
        "mode": "heuristic_bbox_v1",
        "model": "heuristic",
        "bbox": bbox,
        "compactness": compactness,
        "summary": "Heuristic morphology review based on boundary and landuse alignment.",
    }

    if not enable_remote or not image_data_url:
        return review

    user_prompt = (
        "Evaluate boundary morphology from the screenshot and metadata. "
        f"bbox={json.dumps(bbox, ensure_ascii=False)}; "
        f"poi_count={int(max(0, poi_count))}; "
        f"boundary_quality={json.dumps(boundary_quality or {}, ensure_ascii=False)}. "
        "Return JSON: "
        '{"morphology_confidence":0-1,"road_fit":0-1,"landuse_fit":0-1,"summary":"..."}'
    )
    remote = _call_remote_json(
        endpoint=endpoint,
        model_name=model_name,
        system_prompt="You are a spatial morphology reviewer. Return JSON only.",
        user_prompt=user_prompt,
        image_data_url=image_data_url,
        timeout_ms=timeout_ms,
        max_tokens=320,
    )
    if not isinstance(remote, dict):
        return review

    remote_score = _to_float(remote.get("morphology_confidence"))
    if remote_score is None:
        return review

    fused = _clamp01(0.7 * _clamp01(remote_score) + 0.3 * heuristic_score)
    return {
        "score": fused,
        "mode": "remote_visual_review_v1",
        "model": model_name,
        "bbox": bbox,
        "compactness": compactness,
        "summary": str(remote.get("summary") or "Remote visual review completed."),
        "remote": remote,
    }


