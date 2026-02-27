# -*- coding: utf-8 -*-
"""Lightweight LLM spatial reasoning helper."""

from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List


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
    items: List[str] = []
    seen: set[str] = set()
    for raw in values:
        token = str(raw or "").strip()
        if not token:
            continue
        key = _normalize_token(token)
        if not key or key in seen:
            continue
        seen.add(key)
        items.append(token)
        if len(items) >= max_items:
            break
    return items


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
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def _call_remote_reasoner(
    *,
    endpoint: str,
    model_name: str,
    prompt_text: str,
    timeout_ms: int,
) -> Dict[str, Any]:
    payload = {
        "model": model_name,
        "temperature": 0.1,
        "max_tokens": 420,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a spatial reasoning planner. "
                    "Return JSON only with keys: summary, focus_terms, alias_candidates, "
                    "priority_categories, confidence."
                ),
            },
            {"role": "user", "content": prompt_text},
        ],
    }

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    timeout_s = max(0.5, float(timeout_ms) / 1000.0)
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            raw = response.read().decode("utf-8", errors="ignore")
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

    try:
        parsed = json.loads(raw)
    except Exception:
        return {
            "_call_error": "response_json_invalid",
            "_debug": {
                **_redacted_preview(raw),
                "parse_stage": "response_json",
            },
        }

    remote_error = parsed.get("error") if isinstance(parsed, dict) else None
    if isinstance(remote_error, dict) and remote_error:
        message = str(remote_error.get("message") or remote_error.get("code") or "remote_error")
        return {
            "_call_error": "remote_error",
            "_remote_error": message,
            "_debug": {
                **_redacted_preview(message),
                "parse_stage": "remote_error",
            },
        }
    if isinstance(remote_error, str) and remote_error.strip():
        return {
            "_call_error": "remote_error",
            "_remote_error": remote_error.strip(),
            "_debug": {
                **_redacted_preview(remote_error),
                "parse_stage": "remote_error",
            },
        }

    content = (((parsed.get("choices") or [{}])[0]).get("message") or {}).get("content")
    if not isinstance(content, str):
        return {
            "_call_error": "content_missing",
            "_debug": {
                **_redacted_preview(raw),
                "parse_stage": "content_extract",
            },
        }

    payload = _parse_json_object(content)
    if not isinstance(payload, dict):
        return {
            "_call_error": "reasoning_payload_invalid",
            "_debug": {
                **_redacted_preview(content),
                "parse_stage": "payload_parse",
            },
        }

    payload["_debug"] = {
        **_redacted_preview(content),
        "parse_stage": "payload_parse",
    }
    return payload


def infer_spatial_priors(
    *,
    semantic_query: str,
    spatial_context: Dict[str, Any] | None,
    categories: List[str] | None,
    vlm_landmarks: List[str] | None,
    vlm_aliases: List[str] | None,
    model_name: str = "qwen/qwen3-1.7b",
    endpoint: str = "http://localhost:1234/v1/chat/completions",
    timeout_ms: int = 1200,
) -> Dict[str, Any]:
    result = {
        "success": False,
        "mode": "qwen3_reasoning_v1",
        "model": model_name,
        "summary": "",
        "focus_terms": [],
        "alias_candidates": [],
        "priority_categories": [],
        "confidence": 0.0,
        "error": None,
        "debug": {},
    }

    payload = {
        "semantic_query": str(semantic_query or ""),
        "viewport": (spatial_context or {}).get("viewport"),
        "mode": (spatial_context or {}).get("mode"),
        "categories": list(categories or []),
        "vlm_landmarks": list(vlm_landmarks or []),
        "vlm_aliases": list(vlm_aliases or []),
    }
    prompt = (
        "Given user query and spatial context, infer coarse priors to help POI ranking and anchor matching. "
        "Do not make up exact boundaries. Return JSON: "
        '{"summary":"...","focus_terms":["..."],"alias_candidates":["..."],'
        '"priority_categories":["..."],"confidence":0.0}\n'
        f"context={json.dumps(payload, ensure_ascii=False)}"
    )
    data = _call_remote_reasoner(
        endpoint=endpoint,
        model_name=model_name,
        prompt_text=prompt,
        timeout_ms=timeout_ms,
    )
    if not isinstance(data, dict):
        result["error"] = "reasoning_response_invalid"
        result["debug"] = {
            **_redacted_preview("payload_not_dict"),
            "parse_stage": "response_parse",
        }
        return result

    debug_payload = data.get("_debug") if isinstance(data.get("_debug"), dict) else {}
    call_error = str(data.get("_call_error") or "").strip()
    if call_error:
        if call_error in {"response_json_invalid", "content_missing", "reasoning_payload_invalid"}:
            result["error"] = "reasoning_response_invalid"
        elif call_error == "remote_error":
            remote_error = str(data.get("_remote_error") or "remote_error")
            result["error"] = f"reasoning_remote_error:{remote_error[:160]}"
            result["debug"] = {
                **debug_payload,
                **_redacted_preview(remote_error),
                "parse_stage": str(debug_payload.get("parse_stage") or "remote_error"),
            }
            return result
        else:
            result["error"] = f"reasoning_remote_error:{call_error}"
        result["debug"] = {
            **debug_payload,
            "parse_stage": str(debug_payload.get("parse_stage") or "response_parse"),
        }
        return result

    result["summary"] = str(data.get("summary") or "").strip()[:260]
    result["focus_terms"] = _dedupe_strings(
        data.get("focus_terms") if isinstance(data.get("focus_terms"), list) else [],
        max_items=12,
    )
    result["alias_candidates"] = _dedupe_strings(
        data.get("alias_candidates") if isinstance(data.get("alias_candidates"), list) else [],
        max_items=16,
    )
    result["priority_categories"] = _dedupe_strings(
        data.get("priority_categories") if isinstance(data.get("priority_categories"), list) else [],
        max_items=8,
    )
    result["confidence"] = _clamp01(_to_float(data.get("confidence")) or 0.0)
    result["debug"] = {
        **debug_payload,
        "parse_stage": str(debug_payload.get("parse_stage") or "parsed"),
    }
    result["success"] = True
    return result
