# -*- coding: utf-8 -*-
"""视觉形态审查器（VLM ready）。

设计目标：
1. 默认采用低开销启发式评分，保证稳定与低延迟；
2. 当提供视口截图（data URL）时，可调用本地 qwen3-vl-4b 做视觉复核；
3. 输出统一结构，供 composite_v5 置信度融合。
"""

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.request
from typing import Any, Dict

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
    # 归一化紧凑度：圆形接近 1，锯齿/狭长接近 0。
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


def _call_remote_vlm(
    *,
    endpoint: str,
    model_name: str,
    prompt_text: str,
    image_data_url: str,
    timeout_ms: int,
) -> Dict[str, Any] | None:
    payload = {
        "model": model_name,
        "temperature": 0.1,
        "max_tokens": 300,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是空间形态学审查员。"
                    "请只输出 JSON："
                    '{"morphology_confidence":0-1,"road_fit":0-1,"landuse_fit":0-1,"summary":"..."}'
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
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
    except urllib.error.URLError:
        return None
    except Exception:
        return None

    try:
        parsed = json.loads(raw)
    except Exception:
        return None

    content = (
        (((parsed.get("choices") or [{}])[0]).get("message") or {}).get("content")
        if isinstance(parsed, dict)
        else None
    )
    if not isinstance(content, str):
        return None

    return _parse_json_object(content)


def review_cluster_morphology(
    *,
    spatial_context: Dict[str, Any],
    boundary_geojson: Dict[str, Any] | None,
    boundary_quality: Dict[str, Any] | None,
    poi_count: int,
    model_name: str = "qwen3-vl-4b",
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
        "summary": "基于边界形态与路网/用地对齐的启发式审查。",
    }

    if not enable_remote or not image_data_url:
        return review

    prompt_text = (
        "请基于给定空间范围与截图评估边界形态。\n"
        f"bbox={json.dumps(bbox, ensure_ascii=False)}\n"
        f"poi_count={int(max(0, poi_count))}\n"
        f"boundary_quality={json.dumps(boundary_quality or {}, ensure_ascii=False)}\n"
        "输出 JSON 字段：morphology_confidence, road_fit, landuse_fit, summary。"
    )
    remote = _call_remote_vlm(
        endpoint=endpoint,
        model_name=model_name,
        prompt_text=prompt_text,
        image_data_url=image_data_url,
        timeout_ms=timeout_ms,
    )
    if not isinstance(remote, dict):
        return review

    remote_score = _to_float(remote.get("morphology_confidence"))
    if remote_score is None:
        return review

    fused = _clamp01(0.7 * _clamp01(remote_score) + 0.3 * heuristic_score)
    return {
        "score": fused,
        "mode": "qwen3_vl_review_v1",
        "model": model_name,
        "bbox": bbox,
        "compactness": compactness,
        "summary": str(remote.get("summary") or "视觉审查完成。"),
        "remote": remote,
    }

