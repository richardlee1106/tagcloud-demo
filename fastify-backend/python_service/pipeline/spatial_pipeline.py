# -*- coding: utf-8 -*-
"""Python 空间计算管线。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait, Future
from collections import Counter, defaultdict
from dataclasses import asdict
from numbers import Integral
from typing import Any, Dict, Iterable, Iterator, List, Tuple

import numpy as np

from shapely.geometry import MultiPoint, Point, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree

from algorithms.alpha_shape import build_alpha_shape
from algorithms.geo_metrics import (
    bbox_area_m2,
    haversine_km,
    meters_per_degree_lat,
    meters_per_degree_lon,
    nearest_point_and_distance_m,
    polygon_area_km2,
    polygon_perimeter_km,
)
from algorithms.direction_filter import filter_pois_by_direction, resolve_direction_from_query_plan
from algorithms.h3_aggregate import aggregate_pois_h3, preaggregate_coordinates_h3
from algorithms.graph_reasoning import analyze_spatial_graph
from algorithms.hdbscan_cluster import ClusterResult, cluster_points
from algorithms.membership import compute_membership
from algorithms.region_comparison import analyze_region_set, compute_region_comparison
from db.repository import POIRepository
from pipeline import (
    block_assembler,
    boundary_builder,
    confidence_scorer,
    context_loader,
    poi_quality_scorer,
    result_assembler,
    reasoning_reviewer,
    semantic_reasoner,
    self_validator,
    spatial_knowledge_graph,
    vlm_reviewer,
)


def _safe_json_loads(raw: Any, fallback: Any) -> Any:
    """注释说明。"""
    if raw is None:
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str):
        return fallback

    try:
        return json.loads(raw)
    except Exception:
        return fallback


_VISUAL_MODEL_ALIAS_MAP: Dict[str, str] = {
    "qwen3.5-4b": "qwen3.5-4b",
}

_SOFT_VLM_FAILURE_CODES: set[str] = {
    "visual_snapshot_missing",
    "vlm_anchor_response_invalid",
    "budget_exceeded",
}

_SOFT_VLM_FAILURE_PREFIXES: Tuple[str, ...] = (
    "vlm_remote_error:",
)

_SOFT_LLM_FAILURE_CODES: set[str] = {
    "reasoning_response_invalid",
}

_SOFT_LLM_FAILURE_PREFIXES: Tuple[str, ...] = (
    "reasoning_remote_error:",
)


def _normalize_visual_model_name(raw_model_name: Any) -> str:
    model_name = str(raw_model_name or "").strip()
    if model_name:
        return _VISUAL_MODEL_ALIAS_MAP.get(model_name.lower(), model_name)

    env_model_name = str(
        os.getenv("LOCAL_VISUAL_MODEL")
        or os.getenv("LOCAL_VLM_MODEL")
        or os.getenv("LOCAL_LLM_MODEL")
        or os.getenv("LLM_MODEL")
        or "qwen3.5-4b"
    ).strip()
    if not env_model_name:
        env_model_name = "qwen3.5-4b"
    return _VISUAL_MODEL_ALIAS_MAP.get(env_model_name.lower(), env_model_name)


def _is_soft_vlm_failure(error_reason: Any) -> bool:
    reason = str(error_reason or "").strip().lower()
    if not reason:
        return False
    if reason in _SOFT_VLM_FAILURE_CODES:
        return True
    return any(reason.startswith(prefix) for prefix in _SOFT_VLM_FAILURE_PREFIXES)


def _is_soft_llm_failure(error_reason: Any) -> bool:
    reason = str(error_reason or "").strip().lower()
    if not reason:
        return False
    if reason in _SOFT_LLM_FAILURE_CODES:
        return True
    return any(reason.startswith(prefix) for prefix in _SOFT_LLM_FAILURE_PREFIXES)


def _category_of(poi: Dict[str, Any]) -> str:
    """注释说明。"""
    return (
        poi.get("category_small")
        or poi.get("category_mid")
        or poi.get("category_big")
        or poi.get("type")
        or "unknown"
    )


_LOW_SIGNAL_CATEGORY_KEYWORDS: Tuple[str, ...] = (
    "\u697c\u680b",
    "\u697c\u680b\u53f7",
    "\u95e8\u724c",
    "\u95e8\u724c\u53f7",
    "\u505c\u8f66\u573a\u51fa\u5165\u53e3",
    "\u51fa\u5165\u53e3",
    "\u901a\u9053",
    "\u95e8\u536b",
    "\u7269\u4e1a",
)

_REGION_NAME_FALLBACK_SUFFIX: Dict[str, str] = {
    "education": "\u79d1\u6559\u6587\u5316\u751f\u6001\u7247\u533a",
    "ecology": "\u751f\u6001\u7247\u533a",
    "commerce": "\u5546\u4e1a\u751f\u6001\u7247\u533a",
}

_LANDUSE_SUFFIX_MAP: Dict[str, str] = {
    "\u6559\u80b2\u7528\u5730": "\u79d1\u6559\u7247\u533a",
    "\u5546\u4e1a\u670d\u52a1\u7528\u5730": "\u5546\u4e1a\u7247\u533a",
    "\u5546\u52a1\u529e\u516c\u7528\u5730": "\u5546\u52a1\u7247\u533a",
    "\u5de5\u4e1a\u7528\u5730": "\u4ea7\u4e1a\u7247\u533a",
    "\u533b\u7597\u536b\u751f\u7528\u5730": "\u533b\u7597\u7247\u533a",
    "\u4f53\u80b2\u4e0e\u6587\u5316\u7528\u5730": "\u6587\u4f53\u7247\u533a",
    "\u516c\u56ed\u4e0e\u7eff\u5730\u7528\u5730": "\u751f\u6001\u7247\u533a",
}

_REGION_NAME_STRIP_SUFFIXES: Tuple[str, ...] = (
    "\u79d1\u6559\u6587\u5316\u751f\u6001\u7247\u533a",
    "\u5546\u4e1a\u751f\u6001\u7247\u533a",
    "\u751f\u6001\u7247\u533a",
    "\u79d1\u6559\u7247\u533a",
    "\u5546\u4e1a\u7247\u533a",
    "\u5546\u52a1\u7247\u533a",
    "\u4ea7\u4e1a\u7247\u533a",
    "\u6587\u4f53\u7247\u533a",
    "\u533b\u7597\u7247\u533a",
    "\u7247\u533a",
    "\u6d3b\u529b\u5e26",
)

_GENERIC_REGION_NAME_TOKENS: Tuple[str, ...] = (
    "\u4e3b\u57ce",
    "\u4e2d\u5fc3\u57ce",
    "\u4e2d\u5fc3\u57ce\u533a",
    "\u57ce\u533a",
    "\u4e1c\u57ce",
    "\u897f\u57ce",
    "\u5357\u57ce",
    "\u5317\u57ce",
)


def _is_low_signal_category_name(category: Any) -> bool:
    normalized = str(category or "").strip().lower()
    if not normalized:
        return True
    return any(keyword in normalized for keyword in _LOW_SIGNAL_CATEGORY_KEYWORDS)


def _build_category_counter(cluster_pois: List[Dict[str, Any]]) -> Counter:
    preferred_counter: Counter = Counter()
    fallback_counter: Counter = Counter()
    for poi in cluster_pois:
        category = str(_category_of(poi) or "").strip()
        if not category:
            continue
        fallback_counter[category] += 1
        if not _is_low_signal_category_name(category):
            preferred_counter[category] += 1
    return preferred_counter if preferred_counter else fallback_counter


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


def _normalize_python_context_preview(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        preview_text = raw.get("preview_text")
        preview_chars = raw.get("preview_chars")
        preview_sha1 = raw.get("preview_sha1")
        if isinstance(preview_text, str) and preview_sha1 is not None and preview_chars is not None:
            try:
                chars_value = int(preview_chars) if isinstance(preview_chars, Integral) else int(float(preview_chars))
            except Exception:
                chars_value = len(preview_text)
            payload = {
                "preview_text": preview_text[:260],
                "preview_chars": chars_value,
                "preview_sha1": str(preview_sha1),
            }
            parse_stage = raw.get("parse_stage")
            if parse_stage is not None:
                payload["parse_stage"] = str(parse_stage)[:80]
            return payload
        try:
            return {**_redacted_preview(json.dumps(raw, ensure_ascii=False)), "parse_stage": "structured_debug"}
        except Exception:
            return {**_redacted_preview(raw), "parse_stage": "structured_debug"}
    return _redacted_preview(raw)


def _is_invalid_region_name(name: Any) -> bool:
    candidate = str(name or "").strip()
    if not candidate:
        return True
    return bool(getattr(block_assembler, "_is_low_confidence_name", lambda *_: False)(candidate))


def _strip_region_suffix(name: Any) -> str:
    text = str(name or "").strip()
    if not text:
        return ""
    for suffix in _REGION_NAME_STRIP_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            return text[: -len(suffix)].strip()
    return text


def _is_generic_macro_name(name: Any) -> bool:
    candidate = _strip_region_suffix(name)
    if not candidate:
        return True
    if any(token in candidate for token in _GENERIC_REGION_NAME_TOKENS):
        return True
    return _is_invalid_region_name(candidate)


def _resolve_landuse_suffix(entry: Dict[str, Any]) -> str:
    landuse_semantic = entry.get("landuse_semantic") if isinstance(entry.get("landuse_semantic"), dict) else {}
    dominant_land_type = str((landuse_semantic or {}).get("dominant_land_type") or "").strip()
    if dominant_land_type and dominant_land_type in _LANDUSE_SUFFIX_MAP:
        return _LANDUSE_SUFFIX_MAP[dominant_land_type]

    niche_type = str((entry.get("niche_profile") or {}).get("niche_type") or "").strip().lower()
    return _REGION_NAME_FALLBACK_SUFFIX.get(niche_type, "\u751f\u6001\u7247\u533a")


def _resolve_category_qualifier(entry: Dict[str, Any]) -> str:
    dominant_categories = entry.get("dominant_categories") or []
    if isinstance(dominant_categories, list):
        for item in dominant_categories:
            category = str((item or {}).get("category") or "").strip()
            if category and not _is_low_signal_category_name(category):
                return category

    dominant_category = str(entry.get("dominant_category") or "").strip()
    if dominant_category and not _is_low_signal_category_name(dominant_category):
        return dominant_category
    return ""


def _update_name_audit_reasoning(
    entry: Dict[str, Any],
    *,
    source: str,
    from_name: str,
    to_name: str,
    extra: Dict[str, Any] | None = None,
) -> None:
    reasoning = entry.get("semantic_reasoning") if isinstance(entry.get("semantic_reasoning"), dict) else {}
    payload = {
        "source": source,
        "rewritten": True,
        "from": from_name,
        "to": to_name,
    }
    if isinstance(extra, dict):
        payload.update(extra)
    reasoning["name_audit"] = payload
    entry["semantic_reasoning"] = reasoning


def _ensure_unique_region_names(cluster_entries: List[Dict[str, Any]]) -> int:
    name_buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for entry in cluster_entries:
        key = _strip_region_suffix(entry.get("name")).lower()
        if key:
            name_buckets[key].append(entry)

    rewritten_count = 0
    for _, entries in name_buckets.items():
        if len(entries) <= 1:
            continue
        ranked_entries = sorted(
            entries,
            key=lambda item: (
                int(item.get("poi_count") or 0),
                float(item.get("vitality_score") or 0.0),
            ),
            reverse=True,
        )
        for idx, entry in enumerate(ranked_entries):
            if idx == 0:
                continue
            original_name = str(entry.get("name") or "").strip()
            base_name = _strip_region_suffix(original_name) or "\u7279\u8272\u6d3b\u529b"
            qualifier = _resolve_category_qualifier(entry)
            if qualifier:
                candidate = f"{base_name}{qualifier}\u7ec4\u56e2"
            else:
                candidate = f"{base_name}\u7ec4\u56e2{idx + 1}"
            if len(candidate) > 16:
                candidate = f"{base_name[:8]}\u7ec4\u56e2{idx + 1}"
            if _is_invalid_region_name(candidate):
                candidate = f"{base_name[:8]}\u7247\u533a{idx + 1}"
            if candidate == original_name:
                continue
            entry["name"] = candidate
            _update_name_audit_reasoning(
                entry,
                source="duplicate_guard_v1",
                from_name=original_name,
                to_name=candidate,
                extra={"duplicate_rank": idx + 1},
            )
            rewritten_count += 1
    return rewritten_count


def _fallback_region_name(entry: Dict[str, Any]) -> str:
    semantic_anchor = entry.get("semantic_anchor") if isinstance(entry.get("semantic_anchor"), dict) else {}
    anchor_name = _strip_region_suffix((semantic_anchor or {}).get("name"))
    suffix = _resolve_landuse_suffix(entry)
    if anchor_name and not _is_generic_macro_name(anchor_name):
        return f"{anchor_name}{suffix}"

    category_qualifier = _resolve_category_qualifier(entry)
    if category_qualifier:
        return f"{category_qualifier}{suffix}"

    return "\u7279\u8272\u6d3b\u529b\u7247\u533a"


def _remote_audit_region_names(
    *,
    entries: List[Dict[str, Any]],
    model_name: str,
    endpoint: str,
    timeout_ms: int,
) -> Dict[int, str]:
    payload_entries = []
    for entry in entries:
        entry_id = int(entry.get("id", 0))
        if entry_id <= 0:
            continue
        semantic_anchor = entry.get("semantic_anchor") if isinstance(entry.get("semantic_anchor"), dict) else {}
        payload_entries.append(
            {
                "id": entry_id,
                "name": str(entry.get("name") or "").strip(),
                "anchor": str((semantic_anchor or {}).get("name") or "").strip(),
                "dominant_category": str(entry.get("dominant_category") or "").strip(),
                "dominant_land_type": str(
                    ((entry.get("landuse_semantic") or {}).get("dominant_land_type") or "")
                ).strip(),
                "poi_count": int(entry.get("poi_count", 0)),
            }
        )
    if not payload_entries:
        return {}

    # 动态预算：条目越多，允许的输出 token 与请求超时越大，但保持上限防止失控。
    payload_count = len(payload_entries)
    dynamic_max_tokens = min(2200, max(500, 120 + payload_count * 70))
    base_timeout_ms = max(400, int(timeout_ms))
    dynamic_timeout_ms = min(12000, max(base_timeout_ms, base_timeout_ms + payload_count * 120))

    prompt = (
        "You are a city region naming auditor. Review names for suitability as region labels. "
        "Reject macro-level place names, duplicates, building numbers, and parking entrances. "
        "Return strict JSON: {\"items\":[{\"id\":1,\"approved\":true,\"name\":\"...\"}]}. "
        "If rejected, provide replacement name no longer than 16 chars. "
        f"\nItems: {json.dumps(payload_entries, ensure_ascii=False)}"
    )
    request_payload = {
        "model": model_name,
        "temperature": 0.1,
        "max_tokens": int(dynamic_max_tokens),
        "messages": [
            {"role": "system", "content": "Return JSON only."},
            {"role": "user", "content": prompt},
        ],
    }

    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    timeout_s = max(0.4, float(dynamic_timeout_ms) / 1000.0)
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            raw = response.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError, OSError):
        return {}
    except Exception:
        return {}

    try:
        parsed = json.loads(raw)
    except Exception:
        return {}

    content = (
        (((parsed.get("choices") or [{}])[0]).get("message") or {}).get("content")
        if isinstance(parsed, dict)
        else None
    )
    if not isinstance(content, str):
        return {}
    result = _parse_json_object(content) or {}
    items = result.get("items") if isinstance(result.get("items"), list) else []
    name_map: Dict[int, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            entry_id = int(item.get("id"))
        except Exception:
            continue
        candidate_name = str(item.get("name") or "").strip()
        if candidate_name and not _is_invalid_region_name(candidate_name):
            name_map[entry_id] = candidate_name
    return name_map


def _load_boundary_context_bundles_parallel(
    *,
    repository: Any,
    spatial_context: Dict[str, Any],
    query_type: str,
    road_boundary_enhancement: bool,
    road_fetch_limit: int,
    landuse_boundary_enhancement: bool,
    landuse_fetch_limit: int,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    def _load_road_bundle() -> Dict[str, Any]:
        return context_loader.load_road_context(
            repository=repository,
            spatial_context=spatial_context,
            query_type=query_type,
            enabled=road_boundary_enhancement,
            fetch_limit=road_fetch_limit,
            normalize_road_geometries_func=_normalize_road_geometries,
        )

    def _load_landuse_bundle() -> Dict[str, Any]:
        return context_loader.load_landuse_context(
            repository=repository,
            spatial_context=spatial_context,
            query_type=query_type,
            enabled=landuse_boundary_enhancement,
            fetch_limit=landuse_fetch_limit,
            normalize_landuse_geometries_func=_normalize_landuse_geometries,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        road_future = pool.submit(_load_road_bundle)
        landuse_future = pool.submit(_load_landuse_bundle)
        road_bundle = road_future.result() or {}
        landuse_bundle = landuse_future.result() or {}

    return dict(road_bundle), dict(landuse_bundle)


def _fetch_v5_surface_layers_parallel(
    *,
    repository: Any,
    bbox_wkt: str,
    road_limit: int = 5000,
    aoi_limit: int = 3000,
    euluc_limit: int = 3000,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    with ThreadPoolExecutor(max_workers=3) as pool:
        road_future = pool.submit(repository.fetch_road_blocks, bbox_wkt=bbox_wkt, limit=road_limit)
        aoi_future = pool.submit(repository.fetch_osm_aoi, bbox_wkt=bbox_wkt, limit=aoi_limit)
        euluc_future = pool.submit(repository.fetch_euluc, bbox_wkt=bbox_wkt, limit=euluc_limit)
        road_blocks = road_future.result() or []
        osm_aoi = aoi_future.result() or []
        euluc = euluc_future.result() or []

    return list(road_blocks), list(osm_aoi), list(euluc)


def _govern_region_names(
    *,
    cluster_entries: List[Dict[str, Any]],
    remote_enabled: bool,
    model_name: str,
    endpoint: str,
    timeout_ms: int,
    remote_max_items: int = 24,
) -> Dict[str, Any]:
    summary = {
        "rule_rewritten": 0,
        "llm_rewritten": 0,
        "duplicate_rewritten": 0,
        "llm_attempted": False,
        "remote_input_count": 0,
        "remote_sent_count": 0,
    }
    if not cluster_entries:
        return summary

    for entry in cluster_entries:
        original_name = str(entry.get("name") or "").strip()
        if _is_invalid_region_name(original_name):
            fallback_name = _fallback_region_name(entry)
            entry["name"] = fallback_name
            _update_name_audit_reasoning(
                entry,
                source="rule_guard_v2",
                from_name=original_name,
                to_name=fallback_name,
            )
            summary["rule_rewritten"] += 1

    if not remote_enabled:
        summary["duplicate_rewritten"] = _ensure_unique_region_names(cluster_entries)
        return summary

    remote_candidates = [entry for entry in cluster_entries if int(entry.get("id", 0)) > 0]
    summary["remote_input_count"] = int(len(remote_candidates))
    capped_max_items = max(1, int(remote_max_items))
    remote_entries = remote_candidates[:capped_max_items]
    summary["remote_sent_count"] = int(len(remote_entries))

    if not remote_entries:
        summary["duplicate_rewritten"] = _ensure_unique_region_names(cluster_entries)
        return summary

    summary["llm_attempted"] = True
    llm_name_map = _remote_audit_region_names(
        entries=remote_entries,
        model_name=model_name,
        endpoint=endpoint,
        timeout_ms=timeout_ms,
    )
    if not llm_name_map:
        return summary

    for entry in cluster_entries:
        entry_id = int(entry.get("id", 0))
        if entry_id <= 0 or entry_id not in llm_name_map:
            continue
        rewritten = str(llm_name_map.get(entry_id) or "").strip()
        if not rewritten or _is_invalid_region_name(rewritten):
            continue
        if rewritten == str(entry.get("name") or "").strip():
            continue
        from_name = str(entry.get("name") or "").strip()
        entry["name"] = rewritten
        _update_name_audit_reasoning(
            entry,
            source="llm_audit_v1",
            from_name=from_name,
            to_name=rewritten,
        )
        summary["llm_rewritten"] += 1

    summary["duplicate_rewritten"] = _ensure_unique_region_names(cluster_entries)
    return summary


def _calc_bbox_area(points: Iterable[Tuple[float, float]]) -> float:
    """注释说明。"""
    return bbox_area_m2(points)


def _dynamic_h3_resolution(area_km2: float) -> int:
    """注释说明。"""
    if area_km2 < 1:
        return 10
    if area_km2 < 5:
        return 9
    if area_km2 < 20:
        return 8
    if area_km2 < 80:
        return 7
    return 6


def _extract_area_km2(spatial_context: Dict[str, Any]) -> float:
    """注释说明。"""
    mode = str(spatial_context.get("mode", "")).lower()

    if mode == "circle" and spatial_context.get("radius"):
        radius_km = float(spatial_context.get("radius", 0)) / 1000.0
        return math.pi * radius_km * radius_km

    viewport = spatial_context.get("viewport")
    if isinstance(viewport, list) and len(viewport) >= 4:
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
        except Exception:
            return 0.0
        mean_lat = (max_lat + min_lat) * 0.5
        width_km = abs(max_lon - min_lon) * meters_per_degree_lon(mean_lat) / 1000.0
        height_km = abs(max_lat - min_lat) * meters_per_degree_lat(mean_lat) / 1000.0
        return max(0.0, width_km * height_km)

    return 0.0


def _to_float(value: Any) -> float | None:
    """注释说明。"""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_payload_poi(raw: Any) -> Dict[str, Any] | None:
    """注释说明。"""
    if not isinstance(raw, dict):
        return None

    props = raw.get("properties") if isinstance(raw.get("properties"), dict) else raw
    geom = raw.get("geometry") if isinstance(raw.get("geometry"), dict) else {}

    lon = (
        _to_float(raw.get("lon"))
        or _to_float(raw.get("lng"))
        or _to_float(raw.get("longitude"))
        or _to_float(props.get("lon"))
        or _to_float(props.get("lng"))
        or _to_float(props.get("longitude"))
    )
    lat = (
        _to_float(raw.get("lat"))
        or _to_float(raw.get("latitude"))
        or _to_float(props.get("lat"))
        or _to_float(props.get("latitude"))
    )

    if (lon is None or lat is None) and isinstance(geom.get("coordinates"), list) and len(geom["coordinates"]) >= 2:
        lon = lon if lon is not None else _to_float(geom["coordinates"][0])
        lat = lat if lat is not None else _to_float(geom["coordinates"][1])

    if lon is None or lat is None:
        return None

    return {
        "id": props.get("id", raw.get("id")),
        "name": props.get("name") or "",
        "address": props.get("address") or "",
        "type": props.get("type") or "",
        "category_big": props.get("category_big") or props.get("categoryBig") or "",
        "category_mid": props.get("category_mid") or props.get("categoryMid") or "",
        "category_small": props.get("category_small") or props.get("categorySmall") or "",
        "rating": props.get("rating"),
        "lon": lon,
        "lat": lat,
    }


def _normalize_payload_candidates(raw_candidates: Any) -> List[Dict[str, Any]]:
    """注释说明。"""
    if not isinstance(raw_candidates, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for item in raw_candidates:
        poi = _normalize_payload_poi(item)
        if poi is not None:
            normalized.append(poi)
    return normalized


def _contains_text(value: Any, keyword: str) -> bool:
    return keyword in str(value or "").lower()


def _matches_categories(poi: Dict[str, Any], categories: List[str]) -> bool:
    if not categories:
        return True

    fields = [
        poi.get("category_big"),
        poi.get("category_mid"),
        poi.get("category_small"),
        poi.get("type"),
    ]

    for category in categories:
        key = str(category).strip().lower()
        if not key:
            continue
        if any(_contains_text(field, key) for field in fields):
            return True
    return False


def _matches_terms(poi: Dict[str, Any], terms: List[str]) -> bool:
    if not terms:
        return True

    fields = [
        poi.get("name"),
        poi.get("address"),
        poi.get("category_big"),
        poi.get("category_mid"),
        poi.get("category_small"),
        poi.get("type"),
    ]

    for term in terms:
        key = str(term).strip().lower()
        if not key:
            continue
        if any(_contains_text(field, key) for field in fields):
            return True
    return False


def _build_spatial_checker(spatial_context: Dict[str, Any]):
    """注释说明。"""
    boundary = spatial_context.get("boundary")
    if isinstance(boundary, list) and len(boundary) >= 3:
        ring: List[Tuple[float, float]] = []
        for raw in boundary:
            if isinstance(raw, dict):
                lon = _to_float(raw.get("lon", raw.get("lng", raw.get("longitude"))))
                lat = _to_float(raw.get("lat", raw.get("latitude")))
            elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
                lon = _to_float(raw[0])
                lat = _to_float(raw[1])
            else:
                lon = None
                lat = None
            if lon is not None and lat is not None:
                ring.append((lon, lat))

        if len(ring) >= 3:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            polygon = Polygon(ring)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)

            if polygon.is_valid:
                min_lon, min_lat, max_lon, max_lat = polygon.bounds
                prepared_polygon = prep(polygon)

                # 注释说明
                def _within_polygon(lon: float, lat: float) -> bool:
                    if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
                        return False
                    return bool(prepared_polygon.covers(Point(lon, lat)))

                return _within_polygon

    viewport = spatial_context.get("viewport")
    if isinstance(viewport, list) and len(viewport) >= 4:
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
        except (TypeError, ValueError):
            return lambda *_: True

        return lambda lon, lat: min_lon <= lon <= max_lon and min_lat <= lat <= max_lat

    center = spatial_context.get("center")
    radius_m = _to_float(spatial_context.get("radius"))
    if isinstance(center, dict) and radius_m and radius_m > 0:
        center_lon = _to_float(center.get("lon", center.get("lng", center.get("longitude"))))
        center_lat = _to_float(center.get("lat", center.get("latitude")))
        if center_lon is not None and center_lat is not None:
            radius_km = radius_m / 1000.0

            def _within_circle(lon: float, lat: float) -> bool:
                distance = _haversine_km(center_lat, center_lon, lat, lon)
                return distance <= radius_km

            return _within_circle

    return lambda *_: True


def _build_spatial_constraint_polygon(spatial_context: Dict[str, Any]) -> Polygon | None:
    """注释说明。"""
    boundary = spatial_context.get("boundary")
    if isinstance(boundary, list) and len(boundary) >= 3:
        ring: List[Tuple[float, float]] = []
        for raw in boundary:
            if isinstance(raw, dict):
                lon = _to_float(raw.get("lon", raw.get("lng", raw.get("longitude"))))
                lat = _to_float(raw.get("lat", raw.get("latitude")))
            elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
                lon = _to_float(raw[0])
                lat = _to_float(raw[1])
            else:
                lon = None
                lat = None
            if lon is not None and lat is not None:
                ring.append((lon, lat))

        if len(ring) >= 3:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            polygon = Polygon(ring)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            if isinstance(polygon, Polygon) and not polygon.is_empty:
                return polygon

    viewport = spatial_context.get("viewport")
    if isinstance(viewport, list) and len(viewport) >= 4:
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
        except (TypeError, ValueError):
            min_lon = min_lat = max_lon = max_lat = 0.0
        if max_lon > min_lon and max_lat > min_lat:
            return Polygon(
                [
                    (min_lon, min_lat),
                    (max_lon, min_lat),
                    (max_lon, max_lat),
                    (min_lon, max_lat),
                    (min_lon, min_lat),
                ]
            )

    center = spatial_context.get("center")
    radius_m = _to_float(spatial_context.get("radius"))
    if isinstance(center, dict) and radius_m and radius_m > 0:
        center_lon = _to_float(center.get("lon", center.get("lng", center.get("longitude"))))
        center_lat = _to_float(center.get("lat", center.get("latitude")))
        if center_lon is not None and center_lat is not None:
            lat_scale = meters_per_degree_lat(center_lat)
            lon_scale = meters_per_degree_lon(center_lat)
            if lat_scale > 0 and lon_scale > 0:
                ring: List[Tuple[float, float]] = []
                for step in range(0, 48):
                    theta = 2.0 * math.pi * (step / 48.0)
                    dlon = (math.cos(theta) * radius_m) / lon_scale
                    dlat = (math.sin(theta) * radius_m) / lat_scale
                    ring.append((center_lon + dlon, center_lat + dlat))
                ring.append(ring[0])
                return Polygon(ring)

    return None


def _clip_polygon_to_constraint(polygon: Polygon | None, constraint_polygon: Polygon | None) -> Polygon | None:
    """注释说明。"""
    if polygon is None or polygon.is_empty or constraint_polygon is None or constraint_polygon.is_empty:
        return polygon

    try:
        clipped = polygon.intersection(constraint_polygon)
    except Exception:
        return polygon

    clipped_polygon = _to_surface_polygon(clipped)
    if clipped_polygon is None or clipped_polygon.is_empty:
        return None
    return clipped_polygon


def _clip_boundary_geojson_to_constraint(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    constraint_polygon: Polygon | None,
) -> Dict[str, Any]:
    """注释说明。"""
    if constraint_polygon is None or constraint_polygon.is_empty:
        return {
            "boundary_geojson": boundary_geojson,
            "clip": {"applied": False},
        }

    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return {
            "boundary_geojson": boundary_geojson,
            "clip": {"applied": False},
        }

    clipped_polygon = _clip_polygon_to_constraint(polygon, constraint_polygon)
    if clipped_polygon is None or clipped_polygon.is_empty:
        return {
            "boundary_geojson": boundary_geojson,
            "clip": {"applied": False},
        }

    area_before = _polygon_area_km2(polygon)
    area_after = _polygon_area_km2(clipped_polygon)
    changed = not polygon.equals_exact(clipped_polygon, tolerance=1e-10)
    return {
        "boundary_geojson": mapping(clipped_polygon),
        "clip": {
            "applied": bool(changed),
            "area_ratio": round(_clamp01(area_after / area_before) if area_before > 0 else 0.0, 4),
            "area_km2_before": round(area_before, 6),
            "area_km2_after": round(area_after, 6),
        },
    }


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """注释说明。"""
    return haversine_km(lat1, lon1, lat2, lon2)


def _sample_coordinates(coords: List[Tuple[float, float]], max_points: int) -> List[Tuple[float, float]]:
    """注释说明。"""
    if max_points <= 0 or len(coords) <= max_points:
        return coords

    # 注释说明
    step = max(1, len(coords) // max_points)
    sampled = coords[::step]

    if sampled and sampled[-1] != coords[-1]:
        sampled = sampled + [coords[-1]]

    if len(sampled) > max_points:
        sampled = sampled[:max_points]

    return sampled


def _top_membership_drivers(membership, top_n: int = 2) -> List[Dict[str, Any]]:
    """注释说明。"""
    factors = [
        ("density", float(getattr(membership, "density", 0.0))),
        ("purity", float(getattr(membership, "purity", 0.0))),
        ("centrality", float(getattr(membership, "centrality", 0.0))),
        ("compactness", float(getattr(membership, "compactness", 0.0))),
        ("scale", float(getattr(membership, "scale", 0.0))),
    ]

    factors.sort(key=lambda item: item[1], reverse=True)
    return [
        {"factor": name, "value": round(value, 4)}
        for name, value in factors[: max(1, top_n)]
    ]


def _infer_semantic_anchor(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_category: str,
    llm_anchor_candidates: List[str] | None = None,
) -> Dict[str, Any]:
    return semantic_reasoner.infer_semantic_anchor(
        cluster_pois=cluster_pois,
        dominant_category=dominant_category,
        llm_anchor_candidates=llm_anchor_candidates,
    )


def _recover_waterbody_anchor(
    *,
    cluster_pois: List[Dict[str, Any]],
    semantic_anchor: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.recover_waterbody_anchor(
        cluster_pois=cluster_pois,
        semantic_anchor=semantic_anchor,
        landuse_context=landuse_context,
    )


def _landuse_label_text(properties: Any) -> str:
    return semantic_reasoner.landuse_label_text(properties)


def _niche_type_from_landuse_label(label_text: str) -> str:
    return semantic_reasoner.niche_type_from_landuse_label(label_text)


def _cluster_landuse_semantic_context(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    semantic_features: List[Dict[str, Any]],
) -> Dict[str, Any]:
    return semantic_reasoner.cluster_landuse_semantic_context(
        boundary_geojson=boundary_geojson,
        cluster_points=cluster_points,
        semantic_features=semantic_features,
        polygon_from_geojson=_polygon_from_geojson,
    )


def _build_niche_profile(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_category: str,
    semantic_anchor: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.build_niche_profile(
        cluster_pois=cluster_pois,
        dominant_category=dominant_category,
        semantic_anchor=semantic_anchor,
        landuse_context=landuse_context,
        category_of=_category_of,
    )


def _apply_water_overlap_penalty(
    *,
    boundary_quality: Dict[str, Any],
    niche_profile: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.apply_water_overlap_penalty(
        boundary_quality=boundary_quality,
        niche_profile=niche_profile,
        landuse_context=landuse_context,
    )


def _build_semantic_reasoning_payload(
    *,
    semantic_anchor: Dict[str, Any],
    niche_profile: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    return semantic_reasoner.build_semantic_reasoning_payload(
        semantic_anchor=semantic_anchor,
        niche_profile=niche_profile,
        landuse_context=landuse_context,
    )


def _is_valid_lon_lat(lon: float | None, lat: float | None) -> bool:
    return poi_quality_scorer.is_valid_lon_lat(lon, lat)


def _poi_point_quality_score(poi: Dict[str, Any]) -> float:
    return poi_quality_scorer.poi_point_quality_score(poi)


def _cluster_poi_quality(cluster_pois: List[Dict[str, Any]]) -> Dict[str, Any]:
    return poi_quality_scorer.cluster_poi_quality(cluster_pois)


def _normalize_road_geometries(rows: List[Dict[str, Any]]) -> List[Any]:
    return context_loader.normalize_road_geometries(
        rows=rows,
        safe_json_loads=_safe_json_loads,
    )


def _sample_polygon_boundary_coords(
    polygon: Polygon,
    *,
    min_samples: int = 10,
    max_samples: int = 48,
) -> List[Tuple[float, float]]:
    """注释说明。"""
    ring = list(polygon.exterior.coords)
    if len(ring) < 4:
        return []

    usable = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    sample_count = max(min_samples, min(max_samples, len(usable)))
    if len(usable) <= sample_count:
        return [(float(x), float(y)) for x, y in usable]

    step = len(usable) / float(sample_count)
    sampled = [usable[min(int(i * step), len(usable) - 1)] for i in range(sample_count)]
    return [(float(x), float(y)) for x, y in sampled]


def _landuse_boundary_weight(properties: Any) -> float:
    return context_loader.landuse_boundary_weight(
        properties=properties,
        safe_json_loads=_safe_json_loads,
    )


def _normalize_landuse_geometries(rows: List[Dict[str, Any]]) -> Dict[str, List[Any]]:
    return context_loader.normalize_landuse_geometries(
        rows=rows,
        safe_json_loads=_safe_json_loads,
        clamp01=_clamp01,
        landuse_label_text=_landuse_label_text,
        niche_type_from_landuse_label=_niche_type_from_landuse_label,
    )


def _compute_road_alignment_score(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    road_index: STRtree | None,
    road_geometries: List[Any] | None,
) -> float | None:
    """
    注释说明。
    注释说明。
    """
    if road_index is None or not road_geometries:
        return None

    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return None

    sampled = _sample_polygon_boundary_coords(polygon, min_samples=10, max_samples=48)
    if not sampled:
        return None

    distances_m: List[float] = []
    for x, y in sampled:
        point = Point(x, y)
        try:
            nearest_ref = road_index.nearest(point)
        except Exception:
            continue

        if nearest_ref is None:
            continue

        try:
            if isinstance(nearest_ref, Integral):
                nearest_geom = road_geometries[int(nearest_ref)]
            else:
                nearest_geom = nearest_ref
        except Exception:
            continue

        _, distance_m = nearest_point_and_distance_m(point, nearest_geom)
        if distance_m is None:
            continue
        distances_m.append(float(distance_m))

    if not distances_m:
        return None

    sorted_distances = sorted(distances_m)
    mid = len(sorted_distances) // 2
    if len(sorted_distances) % 2 == 1:
        median_distance = sorted_distances[mid]
    else:
        median_distance = (sorted_distances[mid - 1] + sorted_distances[mid]) / 2.0

    near_ratio = len([dist for dist in distances_m if dist <= 35.0]) / len(distances_m)
    median_component = _clamp01(1.0 - min(median_distance, 220.0) / 220.0)

    return round(_clamp01(0.68 * median_component + 0.32 * near_ratio), 4)


def _compute_landuse_alignment_score(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    landuse_index: STRtree | None,
    landuse_geometries: List[Any] | None,
    landuse_weights: List[float] | None,
) -> float | None:
    """
    注释说明。
    注释说明。
    """
    if landuse_index is None or not landuse_geometries:
        return None

    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return None

    sampled = _sample_polygon_boundary_coords(polygon, min_samples=12, max_samples=60)
    if not sampled:
        return None

    distances_m: List[float] = []
    sampled_weights: List[float] = []

    for x, y in sampled:
        point = Point(x, y)
        try:
            nearest_ref = landuse_index.nearest(point)
        except Exception:
            continue

        if nearest_ref is None:
            continue

        nearest_geom: Any | None = None
        nearest_weight = 0.72

        try:
            if isinstance(nearest_ref, Integral):
                nearest_idx = int(nearest_ref)
                nearest_geom = landuse_geometries[nearest_idx]
                if landuse_weights and 0 <= nearest_idx < len(landuse_weights):
                    nearest_weight = _clamp01(float(landuse_weights[nearest_idx]))
            else:
                nearest_geom = nearest_ref
        except Exception:
            continue

        if nearest_geom is None:
            continue

        _, distance_m = nearest_point_and_distance_m(point, nearest_geom)
        if distance_m is None:
            continue
        distances_m.append(float(distance_m))
        sampled_weights.append(nearest_weight)

    if not distances_m:
        return None

    sorted_distances = sorted(distances_m)
    mid = len(sorted_distances) // 2
    if len(sorted_distances) % 2 == 1:
        median_distance = sorted_distances[mid]
    else:
        median_distance = (sorted_distances[mid - 1] + sorted_distances[mid]) / 2.0

    near_ratio = len([dist for dist in distances_m if dist <= 45.0]) / len(distances_m)
    median_component = _clamp01(1.0 - min(median_distance, 260.0) / 260.0)
    weight_component = sum(sampled_weights) / len(sampled_weights) if sampled_weights else 0.72

    return round(_clamp01(0.58 * median_component + 0.27 * near_ratio + 0.15 * _clamp01(weight_component)), 4)


def _resolve_nearest_geometry(
    *,
    point: Point,
    geometry_index: STRtree | None,
    geometries: List[Any] | None,
) -> Any | None:
    """注释说明。"""
    if geometry_index is None or not geometries:
        return None

    try:
        nearest_ref = geometry_index.nearest(point)
    except Exception:
        return None

    if nearest_ref is None:
        return None

    try:
        if isinstance(nearest_ref, Integral):
            nearest_idx = int(nearest_ref)
            if 0 <= nearest_idx < len(geometries):
                return geometries[nearest_idx]
            return None
    except Exception:
        return None

    return nearest_ref


def _snap_polygon_to_linear_context(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    road_index: STRtree | None,
    road_geometries: List[Any] | None,
    landuse_index: STRtree | None,
    landuse_geometries: List[Any] | None,
) -> Dict[str, Any] | None:
    """
    注释说明。
    注释说明。
    """
    polygon = _polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return None

    has_road_context = road_index is not None and bool(road_geometries)
    has_landuse_context = landuse_index is not None and bool(landuse_geometries)
    if not has_road_context and not has_landuse_context:
        return None

    sampled = _sample_polygon_boundary_coords(polygon, min_samples=20, max_samples=120)
    if len(sampled) < 8:
        return None

    span = max(_cluster_span_deg(cluster_points), max(polygon.bounds[2] - polygon.bounds[0], polygon.bounds[3] - polygon.bounds[1]))
    mean_lat = float(polygon.centroid.y)
    degree_scale_m = max(meters_per_degree_lon(mean_lat), meters_per_degree_lat(mean_lat), 1.0)
    span_m = span * degree_scale_m
    snap_distance_m = max(8.0, min(120.0, span_m * 0.30))
    snap_distance_deg = snap_distance_m / degree_scale_m
    min_snap_count = max(3, int(len(sampled) * 0.10))

    snapped_coords: List[Tuple[float, float]] = []
    snap_count = 0
    road_snap_count = 0
    landuse_snap_count = 0

    for x, y in sampled:
        point = Point(float(x), float(y))
        best_distance = None
        best_coord = None
        best_source = ""

        if has_road_context:
            nearest_road = _resolve_nearest_geometry(
                point=point,
                geometry_index=road_index,
                geometries=road_geometries,
            )
            if nearest_road is not None and not nearest_road.is_empty:
                try:
                    projected_coord, distance = nearest_point_and_distance_m(point, nearest_road)
                    if projected_coord is not None and distance is not None and distance <= snap_distance_m:
                        best_distance = float(distance)
                        best_coord = projected_coord
                        best_source = "road"
                except Exception:
                    pass

        if has_landuse_context:
            nearest_landuse = _resolve_nearest_geometry(
                point=point,
                geometry_index=landuse_index,
                geometries=landuse_geometries,
            )
            if nearest_landuse is not None and not nearest_landuse.is_empty:
                try:
                    projected_coord, distance = nearest_point_and_distance_m(point, nearest_landuse)
                    if (
                        projected_coord is not None
                        and distance is not None
                        and distance <= snap_distance_m
                        and (best_distance is None or distance < best_distance)
                    ):
                        best_distance = float(distance)
                        best_coord = projected_coord
                        best_source = "landuse"
                except Exception:
                    pass

        if best_coord is not None:
            snapped_coords.append(best_coord)
            snap_count += 1
            if best_source == "road":
                road_snap_count += 1
            elif best_source == "landuse":
                landuse_snap_count += 1
        else:
            snapped_coords.append((float(x), float(y)))

    if snap_count < min_snap_count:
        return None

    if snapped_coords[0] != snapped_coords[-1]:
        snapped_coords.append(snapped_coords[0])

    try:
        snapped_polygon = Polygon(snapped_coords).buffer(0)
    except Exception:
        return None

    snapped_polygon = _as_polygon(snapped_polygon)
    if snapped_polygon is None or snapped_polygon.is_empty:
        return None

    original_area = max(float(polygon.area), 1e-12)
    area_ratio = float(snapped_polygon.area) / original_area
    if area_ratio < 0.22 or area_ratio > 2.20:
        return None

    smooth_distance = snap_distance_deg * 0.30
    if smooth_distance > 0:
        try:
            smoothed = snapped_polygon.buffer(smooth_distance).buffer(-smooth_distance)
            smoothed = _as_polygon(smoothed.buffer(0))
            if smoothed is not None and not smoothed.is_empty:
                snapped_polygon = smoothed
        except Exception:
            pass

    prepared_polygon = prep(snapped_polygon)
    inside_count = sum(
        1
        for lon, lat in cluster_points
        if prepared_polygon.covers(Point(float(lon), float(lat)))
    )
    coverage_ratio = inside_count / max(1, len(cluster_points))
    if coverage_ratio < 0.54:
        return None

    return {
        "geojson": mapping(snapped_polygon),
        "model": "road_landuse_snap_v1",
        "snap_distance_m": round(float(snap_distance_m), 1),
        "sampled_vertices": int(len(sampled)),
        "snapped_vertices": int(snap_count),
        "road_snap_vertices": int(road_snap_count),
        "landuse_snap_vertices": int(landuse_snap_count),
        "coverage_ratio": round(float(coverage_ratio), 4),
        "area_ratio_to_original": round(float(area_ratio), 4),
    }


def _empty_graph_summary() -> Dict[str, Any]:
    """注释说明。"""
    return {
        "node_count": 0,
        "edge_count": 0,
        "component_count": 0,
        "components": [],
        "top_hubs": [],
        "avg_degree": 0.0,
        "distance_threshold_m": 280.0,
    }


def _filter_payload_candidates(
    candidates: List[Dict[str, Any]],
    *,
    spatial_context: Dict[str, Any],
    categories: List[str],
    terms: List[str],
    limit: int = 8000,
) -> List[Dict[str, Any]]:
    """注释说明。"""
    checker = _build_spatial_checker(spatial_context)
    filtered: List[Dict[str, Any]] = []

    for poi in candidates:
        lon = _to_float(poi.get("lon"))
        lat = _to_float(poi.get("lat"))
        if lon is None or lat is None:
            continue

        if not checker(lon, lat):
            continue

        if not _matches_categories(poi, categories):
            continue

        if not _matches_terms(poi, terms):
            continue

        filtered.append(poi)
        if len(filtered) >= limit:
            break

    return filtered


def _resolve_limit(raw_value: Any, *, default_value: int, max_value: int) -> int:
    """注释说明。"""
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = default_value

    if parsed <= 0:
        parsed = default_value

    return max(1, min(parsed, max_value))


def _option_enabled(raw_value: Any, *, default_value: bool = False) -> bool:
    """解析布尔开关（兼容 true/false、1/0、on/off）。"""
    if raw_value is None:
        return default_value
    normalized = str(raw_value).strip().lower()
    if not normalized:
        return default_value
    if normalized in {"1", "true", "yes", "on", "y"}:
        return True
    if normalized in {"0", "false", "no", "off", "n"}:
        return False
    return default_value


def _normalize_anchor_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    return re.sub(r"\s+", "", text)


def _normalize_anchor_list(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    normalized: List[str] = []
    seen: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        token = raw.strip()
        if not token:
            continue
        key = _normalize_anchor_text(token)
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(token)
    return normalized


def _anchor_match_score(text: str, anchors: List[str]) -> int:
    target = _normalize_anchor_text(text)
    if not target:
        return 0
    score = 0
    for anchor in anchors:
        key = _normalize_anchor_text(anchor)
        if key and key in target:
            score += 1
    return score


def _safe_shape_geojson(geometry_geojson: Any) -> Any | None:
    if geometry_geojson is None:
        return None
    try:
        raw = _safe_json_loads(geometry_geojson, None)
        if not isinstance(raw, dict):
            return None
        geom = shape(raw)
        if geom.is_empty:
            return None
        if not geom.is_valid:
            geom = geom.buffer(0)
        if geom.is_empty:
            return None
        return geom
    except Exception:
        return None


def _pick_v5_dominant_face(
    *,
    road_blocks: List[Dict[str, Any]],
    osm_aoi_features: List[Dict[str, Any]],
    euluc_features: List[Dict[str, Any]],
    pois: List[Dict[str, Any]],
    semantic_anchor_hints: List[str] | None = None,
) -> Dict[str, Any] | None:
    """Pick dominant surface by POI support, with optional semantic-anchor bias."""
    anchors = _normalize_anchor_list(list(semantic_anchor_hints or []))
    points = [
        Point(float(p.get("lon")), float(p.get("lat")))
        for p in (pois or [])
        if p.get("lon") is not None and p.get("lat") is not None
    ]
    if not points:
        return None

    candidates: List[Dict[str, Any]] = []

    def _collect(source: str, rows: List[Dict[str, Any]], *, name_fields: List[str]) -> None:
        for row in rows or []:
            geom = _safe_shape_geojson(row.get("geometry_geojson"))
            if geom is None:
                continue
            support_count = 0
            for pt in points:
                try:
                    if geom.covers(pt):
                        support_count += 1
                except Exception:
                    continue
            if support_count <= 0:
                continue
            support_ratio = support_count / max(1, len(points))
            label = " ".join(str(row.get(field) or "") for field in name_fields).strip()
            anchor_match = _anchor_match_score(label, anchors)
            area_m2 = float(row.get("area_m2") or row.get("shape_area") or geom.area or 0.0)
            candidates.append(
                {
                    "source": source,
                    "feature": row,
                    "geometry_geojson": mapping(geom),
                    "support_count": int(support_count),
                    "support_ratio": float(support_ratio),
                    "anchor_match": int(anchor_match),
                    "area_m2": float(area_m2),
                }
            )

    _collect("road_blocks", road_blocks, name_fields=["block_id"])
    _collect("osm_aoi", osm_aoi_features, name_fields=["name", "type"])
    _collect("euluc", euluc_features, name_fields=["land_type"])

    if not candidates:
        return None

    def _candidate_rank(item: Dict[str, Any]) -> Tuple[int, float, int, float]:
        return (
            1 if int(item.get("anchor_match") or 0) > 0 else 0,
            float(item.get("support_ratio") or 0.0),
            int(item.get("support_count") or 0),
            float(item.get("area_m2") or 0.0),
        )

    return max(candidates, key=_candidate_rank)


def _build_anchor_block_mask_geometry(
    *,
    road_blocks: List[Dict[str, Any]],
    dominant_geom: Any,
    support_block_ids: set[int] | None = None,
    overlap_ratio_threshold: float = 0.20,
    support_edge_ratio_threshold: float = 0.08,
    use_centroid: bool = True,
    outlier_area_factor: float = 6.0,
    outlier_overlap_ratio_threshold: float = 0.40,
) -> Dict[str, Any]:
    """Build a block-level mask guided by dominant face + support blocks."""
    dominant = dominant_geom
    if isinstance(dominant, dict):
        dominant = _safe_shape_geojson(dominant)
    if dominant is None or getattr(dominant, "is_empty", True):
        return {
            "geometry_geojson": None,
            "selected_blocks": 0,
            "selected_block_ids": [],
            "centroid_hits": 0,
            "support_hits": 0,
            "outlier_rejected": 0,
        }

    support_ids = {int(bid) for bid in (support_block_ids or set())}
    overlap_threshold = _clamp01(float(overlap_ratio_threshold))
    support_threshold = _clamp01(float(support_edge_ratio_threshold))
    outlier_overlap_threshold = _clamp01(float(outlier_overlap_ratio_threshold))
    safe_outlier_factor = max(1.5, float(outlier_area_factor))

    selected_rows: List[Dict[str, Any]] = []
    centroid_hits = 0
    support_hits = 0

    for row in road_blocks or []:
        raw_id = row.get("block_id")
        if raw_id is None:
            continue
        try:
            block_id = int(raw_id)
        except Exception:
            continue

        geom = _safe_shape_geojson(row.get("geometry_geojson"))
        if geom is None:
            continue

        block_area = float(geom.area or 0.0)
        if block_area <= 0.0:
            continue

        try:
            inter_area = float(geom.intersection(dominant).area or 0.0)
        except Exception:
            inter_area = 0.0
        overlap_ratio = inter_area / block_area if block_area > 0 else 0.0

        centroid_hit = bool(use_centroid and dominant.covers(geom.centroid))
        support_hit = bool(block_id in support_ids and overlap_ratio >= support_threshold)
        threshold_hit = overlap_ratio >= overlap_threshold

        if not (centroid_hit or threshold_hit or support_hit):
            continue

        if centroid_hit:
            centroid_hits += 1
        if support_hit:
            support_hits += 1

        selected_rows.append(
            {
                "block_id": block_id,
                "geom": geom,
                "area": block_area,
                "overlap_ratio": overlap_ratio,
                "centroid_hit": centroid_hit,
            }
        )

    if not selected_rows:
        return {
            "geometry_geojson": None,
            "selected_blocks": 0,
            "selected_block_ids": [],
            "centroid_hits": 0,
            "support_hits": 0,
            "outlier_rejected": 0,
        }

    sorted_areas = sorted(float(item["area"]) for item in selected_rows)
    mid = len(sorted_areas) // 2
    if len(sorted_areas) % 2 == 1:
        median_area = sorted_areas[mid]
    else:
        median_area = (sorted_areas[mid - 1] + sorted_areas[mid]) / 2.0
    median_area = max(median_area, 1e-9)

    kept_rows: List[Dict[str, Any]] = []
    outlier_rejected = 0
    for item in selected_rows:
        huge_non_centroid = (
            not bool(item["centroid_hit"])
            and float(item["area"]) > median_area * safe_outlier_factor
            and float(item["overlap_ratio"]) < outlier_overlap_threshold
        )
        if huge_non_centroid:
            outlier_rejected += 1
            continue
        kept_rows.append(item)

    if not kept_rows:
        kept_rows = selected_rows

    merged = unary_union([row["geom"] for row in kept_rows])
    if merged.is_empty:
        return {
            "geometry_geojson": None,
            "selected_blocks": 0,
            "selected_block_ids": [],
            "centroid_hits": centroid_hits,
            "support_hits": support_hits,
            "outlier_rejected": outlier_rejected,
        }
    if not merged.is_valid:
        merged = merged.buffer(0)
    if merged.is_empty:
        return {
            "geometry_geojson": None,
            "selected_blocks": 0,
            "selected_block_ids": [],
            "centroid_hits": centroid_hits,
            "support_hits": support_hits,
            "outlier_rejected": outlier_rejected,
        }

    selected_block_ids = sorted({int(row["block_id"]) for row in kept_rows})
    return {
        "geometry_geojson": mapping(merged),
        "selected_blocks": len(selected_block_ids),
        "selected_block_ids": selected_block_ids,
        "centroid_hits": int(centroid_hits),
        "support_hits": int(support_hits),
        "outlier_rejected": int(outlier_rejected),
    }


def _build_water_semantic_mask_geometry(
    *,
    osm_aoi_features: List[Dict[str, Any]],
    euluc_features: List[Dict[str, Any]],
    anchor_tokens: List[str],
) -> Dict[str, Any] | None:
    """Build water/ecology mask from anchor AOI ∩ water-like EULUC."""
    anchors = _normalize_anchor_list(anchor_tokens or [])
    if not anchors:
        return None

    anchor_geoms: List[Any] = []
    for row in osm_aoi_features or []:
        label = f"{row.get('name', '')} {row.get('type', '')}"
        if _anchor_match_score(label, anchors) <= 0:
            continue
        geom = _safe_shape_geojson(row.get("geometry_geojson"))
        if geom is not None:
            anchor_geoms.append(geom)

    if not anchor_geoms:
        return None

    water_keywords = ("水", "湖", "河", "湿地", "公园", "绿地")
    water_geoms: List[Any] = []
    for row in euluc_features or []:
        land_type = str(row.get("land_type") or "")
        if not any(keyword in land_type for keyword in water_keywords):
            continue
        geom = _safe_shape_geojson(row.get("geometry_geojson"))
        if geom is not None:
            water_geoms.append(geom)

    if not water_geoms:
        return None

    anchor_union = unary_union(anchor_geoms)
    water_union = unary_union(water_geoms)
    if anchor_union.is_empty or water_union.is_empty:
        return None

    mask = anchor_union.intersection(water_union)
    if mask.is_empty:
        return None
    if not mask.is_valid:
        mask = mask.buffer(0)
    if mask.is_empty:
        return None

    return {
        "geometry_geojson": mapping(mask),
        "anchor_aoi_count": len(anchor_geoms),
        "water_euluc_count": len(water_geoms),
    }


_ECOLOGY_CONTEXT_KEYWORDS: Tuple[str, ...] = (
    "生态",
    "名称",
    "绿地",
    "湖泊",
    "水域",
    "河流",
    "湿地",
    "滨水",
)


def _is_ecology_context(
    *,
    dominant_land_type: str,
    dominant_aoi_type: str,
    region_name: str,
) -> bool:
    text = " ".join(
        [
            str(dominant_land_type or ""),
            str(dominant_aoi_type or ""),
            str(region_name or ""),
        ]
    )
    return any(keyword in text for keyword in _ECOLOGY_CONTEXT_KEYWORDS)


def _collect_anchor_seed_block_ids(
    *,
    cluster_pois: List[Dict[str, Any]],
    anchor_tokens: List[str],
    min_hits: int = 2,
    min_ratio: float = 0.5,
) -> set[int]:
    anchors = _normalize_anchor_list(anchor_tokens or [])
    if not anchors:
        return set()

    safe_min_hits = max(1, int(min_hits))
    safe_min_ratio = _clamp01(float(min_ratio))
    block_total: Counter = Counter()
    block_anchor_hits: Counter = Counter()

    for poi in cluster_pois or []:
        raw_block_id = poi.get("block_id")
        if raw_block_id is None:
            continue
        try:
            block_id = int(raw_block_id)
        except Exception:
            continue

        block_total[block_id] += 1
        text = " ".join(
            [
                str(poi.get("name") or ""),
                str(poi.get("aoi_name") or ""),
                str(poi.get("address") or ""),
                str(poi.get("type") or ""),
            ]
        )
        if _anchor_match_score(text, anchors) > 0:
            block_anchor_hits[block_id] += 1

    selected: set[int] = set()
    for block_id, total in block_total.items():
        hits = int(block_anchor_hits.get(block_id) or 0)
        ratio = hits / max(1, int(total))
        if hits >= safe_min_hits and ratio >= safe_min_ratio:
            selected.add(int(block_id))
    return selected


def _build_override_anchor_block_geometry(
    *,
    block_geom_map: Dict[int, Any],
    override_geom: Any,
    seed_block_ids: set[int],
) -> Dict[str, Any] | None:
    if override_geom is None or getattr(override_geom, "is_empty", True):
        return None
    if not block_geom_map:
        return None

    selected_ids: set[int] = {int(bid) for bid in (seed_block_ids or set())}
    centroid_hits = 0

    for block_id, geom in block_geom_map.items():
        if geom is None or getattr(geom, "is_empty", True):
            continue
        try:
            if override_geom.covers(geom.centroid):
                selected_ids.add(int(block_id))
                centroid_hits += 1
        except Exception:
            continue

    if not selected_ids:
        return None

    merged = unary_union([block_geom_map[bid] for bid in selected_ids if bid in block_geom_map])
    if merged.is_empty:
        return None
    if not merged.is_valid:
        merged = merged.buffer(0)
    if merged.is_empty:
        return None

    return {
        "geometry_geojson": mapping(merged),
        "selected_block_ids": sorted(selected_ids),
        "selected_blocks": len(selected_ids),
        "centroid_hits": int(centroid_hits),
    }


def _cluster_point_coverage_ratio(geometry: Any, cluster_points: List[Tuple[float, float]]) -> float:
    if geometry is None or getattr(geometry, "is_empty", True):
        return 0.0
    if not cluster_points:
        return 0.0

    inside = 0
    for lon, lat in cluster_points:
        try:
            if geometry.covers(Point(float(lon), float(lat))):
                inside += 1
        except Exception:
            continue
    return inside / max(1, len(cluster_points))


def _resolve_region_output_limit(*, hints_options: Dict[str, Any], query_type: str) -> int:
    default_limit = 60 if str(query_type or "").lower() == "area_analysis" else 20
    return _resolve_limit(
        hints_options.get("maxRegionOutputs"),
        default_value=default_limit,
        max_value=200,
    )


def _spatial_context_to_clip_wkt(spatial_context: Dict[str, Any]) -> str | None:
    viewport = spatial_context.get("viewport")
    if isinstance(viewport, (list, tuple)) and len(viewport) >= 4:
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
            return (
                f"POLYGON(({min_lon} {min_lat}, {max_lon} {min_lat}, "
                f"{max_lon} {max_lat}, {min_lon} {max_lat}, {min_lon} {min_lat}))"
            )
        except Exception:
            return None

    boundary = spatial_context.get("boundary")
    if boundary:
        try:
            return POIRepository._boundary_wkt(boundary)
        except Exception:
            return None
    return None


def _poi_identity_key(poi: Dict[str, Any]) -> Tuple[Any, Any, Any]:
    pid = poi.get("id")
    if pid is not None:
        return ("id", pid, None)
    lon = _to_float(poi.get("lon"))
    lat = _to_float(poi.get("lat"))
    name = str(poi.get("name") or "")
    return (round(lon or 0.0, 7), round(lat or 0.0, 7), name)


def _is_missing_surface_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    return False


def _candidate_indexes_from_query(
    *,
    query_result: Any,
    geometries: List[Any],
    geometry_id_to_index: Dict[int, int],
) -> List[int]:
    if query_result is None:
        return []
    try:
        raw_items = list(query_result)
    except Exception:
        raw_items = [query_result]

    indexes: List[int] = []
    seen: set[int] = set()
    for item in raw_items:
        index: int | None = None
        if isinstance(item, Integral):
            index = int(item)
        else:
            index = geometry_id_to_index.get(id(item))
        if index is None or index < 0 or index >= len(geometries):
            continue
        if index in seen:
            continue
        seen.add(index)
        indexes.append(index)
    return indexes


def _build_surface_match_index(
    *,
    rows: List[Dict[str, Any]],
    field_mapping: Dict[str, str],
    area_fields: Tuple[str, ...],
) -> Dict[str, Any]:
    geometries: List[Any] = []
    payloads: List[Dict[str, Any]] = []
    areas: List[float] = []

    for row in rows or []:
        geom = _safe_shape_geojson(row.get("geometry_geojson"))
        if geom is None:
            continue

        payload: Dict[str, Any] = {}
        for output_field, source_field in field_mapping.items():
            payload[output_field] = row.get(source_field)
        if not payload:
            continue

        area_value = 0.0
        for area_field in area_fields:
            try:
                area_value = float(row.get(area_field) or 0.0)
            except (TypeError, ValueError):
                area_value = 0.0
            if area_value > 0.0:
                break
        if area_value <= 0.0:
            try:
                area_value = float(getattr(geom, "area", 0.0) or 0.0)
            except Exception:
                area_value = 0.0

        geometries.append(geom)
        payloads.append(payload)
        areas.append(max(0.0, area_value))

    if not geometries:
        return {
            "index": None,
            "geometries": [],
            "geometry_id_to_index": {},
            "payloads": [],
            "areas": [],
        }

    index = STRtree(geometries)
    geometry_id_to_index = {id(geom): idx for idx, geom in enumerate(geometries)}
    return {
        "index": index,
        "geometries": geometries,
        "geometry_id_to_index": geometry_id_to_index,
        "payloads": payloads,
        "areas": areas,
    }


def _vectorized_surface_match(
    coords: np.ndarray,
    surface_index: Dict[str, Any],
) -> Dict[int, Dict[str, Any]]:
    """Vectorized batch surface matching via Shapely 2.x STRtree.query.

    Returns dict mapping point-index -> best (smallest area) payload.
    20000 POI x 1 layer: ~0.1-0.3s (vs ~3-8s per-point loop).
    """
    tree = surface_index.get("index")
    geometries = surface_index.get("geometries") or []
    payloads = surface_index.get("payloads") or []
    areas = surface_index.get("areas") or []

    if tree is None or not geometries or coords.shape[0] == 0:
        return {}

    def _fallback_per_point_match() -> Dict[int, Dict[str, Any]]:
        fallback_map: Dict[int, Dict[str, Any]] = {}
        for idx, coord in enumerate(coords):
            try:
                point = Point(float(coord[0]), float(coord[1]))
            except Exception:
                continue
            payload = _match_surface_payload(point=point, surface_index=surface_index)
            if payload:
                fallback_map[int(idx)] = payload
        return fallback_map

    # Shapely 2.x: create Point array from numpy coords
    try:
        import shapely
        point_geoms = shapely.points(coords)
    except Exception:
        return _fallback_per_point_match()

    # Single vectorized call: returns (point_idx[], geom_idx[])
    try:
        left_idx, right_idx = tree.query(point_geoms, predicate="covers")
    except Exception:
        return _fallback_per_point_match()

    if len(left_idx) == 0:
        return _fallback_per_point_match()

    # Group by point index, pick smallest area match
    result: Dict[int, Dict[str, Any]] = {}
    for pt_i, geom_i in zip(left_idx, right_idx):
        pt_i_int = int(pt_i)
        geom_i_int = int(geom_i)
        if geom_i_int >= len(payloads):
            continue
        area = float(areas[geom_i_int]) if geom_i_int < len(areas) else 0.0
        existing = result.get(pt_i_int)
        if existing is None or area < existing.get("_area", float("inf")):
            payload = dict(payloads[geom_i_int])
            payload["_area"] = area
            result[pt_i_int] = payload

    # Remove internal area field
    for payload in result.values():
        payload.pop("_area", None)

    return result


def _match_surface_payload(
    *,
    point: Point,
    surface_index: Dict[str, Any],
) -> Dict[str, Any] | None:
    index = surface_index.get("index")
    geometries = list(surface_index.get("geometries") or [])
    if index is None or not geometries:
        return None

    try:
        query_result = index.query(point)
    except Exception:
        return None

    candidate_indexes = _candidate_indexes_from_query(
        query_result=query_result,
        geometries=geometries,
        geometry_id_to_index=surface_index.get("geometry_id_to_index") or {},
    )
    if not candidate_indexes:
        return None

    payloads = list(surface_index.get("payloads") or [])
    areas = list(surface_index.get("areas") or [])
    best_index: int | None = None
    best_area: float | None = None

    for candidate_index in candidate_indexes:
        if candidate_index >= len(payloads):
            continue
        geom = geometries[candidate_index]
        try:
            covered = bool(geom.covers(point))
        except Exception:
            covered = False
        if not covered:
            continue

        area_value = float(areas[candidate_index]) if candidate_index < len(areas) else 0.0
        if best_index is None or area_value < (best_area if best_area is not None else float("inf")):
            best_index = candidate_index
            best_area = area_value

    if best_index is None or best_index >= len(payloads):
        return None
    return dict(payloads[best_index])


def _enrich_pois_with_surface_layers(
    *,
    pois: List[Dict[str, Any]],
    road_blocks: List[Dict[str, Any]],
    osm_aoi_features: List[Dict[str, Any]],
    euluc_features: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not pois:
        return [], {
            "enriched_rows": 0,
            "block_matches": 0,
            "aoi_matches": 0,
            "landuse_matches": 0,
            "road_surface_count": 0,
            "aoi_surface_count": 0,
            "landuse_surface_count": 0,
        }

    road_surface_index = _build_surface_match_index(
        rows=road_blocks,
        field_mapping={"block_id": "block_id"},
        area_fields=("shape_area", "area_m2"),
    )
    aoi_surface_index = _build_surface_match_index(
        rows=osm_aoi_features,
        field_mapping={"aoi_name": "name", "aoi_type": "type"},
        area_fields=("area_m2",),
    )
    euluc_surface_index = _build_surface_match_index(
        rows=euluc_features,
        field_mapping={"land_type": "land_type"},
        area_fields=("area_m2",),
    )

    enriched_rows = 0
    block_matches = 0
    aoi_matches = 0
    landuse_matches = 0
    enriched_pois: List[Dict[str, Any]] = [dict(poi) for poi in pois]

    # Identify POIs that need enrichment
    enrich_indices: List[int] = []
    enrich_coords: List[Tuple[float, float]] = []
    enrich_flags: List[Tuple[bool, bool, bool]] = []  # (block, aoi, landuse)

    for i, poi in enumerate(enriched_pois):
        lon = _to_float(poi.get("lon"))
        lat = _to_float(poi.get("lat"))
        if lon is None or lat is None:
            continue
        nb = _is_missing_surface_value(poi.get("block_id"))
        na = _is_missing_surface_value(poi.get("aoi_name")) or _is_missing_surface_value(poi.get("aoi_type"))
        nl = _is_missing_surface_value(poi.get("land_type"))
        if nb or na or nl:
            enrich_indices.append(i)
            enrich_coords.append((float(lon), float(lat)))
            enrich_flags.append((nb, na, nl))

    if enrich_indices:
        coords_array = np.array(enrich_coords, dtype=np.float64)
        # Vectorized batch query for each layer (single C++ call per layer)
        block_map = _vectorized_surface_match(coords_array, road_surface_index)
        aoi_map = _vectorized_surface_match(coords_array, aoi_surface_index)
        landuse_map = _vectorized_surface_match(coords_array, euluc_surface_index)

        for local_idx, (global_idx, (nb, na, nl)) in enumerate(zip(enrich_indices, enrich_flags)):
            row = enriched_pois[global_idx]
            touched = False

            if nb and local_idx in block_map:
                payload = block_map[local_idx]
                if not _is_missing_surface_value(payload.get("block_id")):
                    row["block_id"] = payload["block_id"]
                    block_matches += 1
                    touched = True

            if na and local_idx in aoi_map:
                payload = aoi_map[local_idx]
                if not _is_missing_surface_value(payload.get("aoi_name")):
                    row["aoi_name"] = payload["aoi_name"]
                    touched = True
                if not _is_missing_surface_value(payload.get("aoi_type")):
                    row["aoi_type"] = payload["aoi_type"]
                    touched = True
                if not _is_missing_surface_value(payload.get("aoi_name")):
                    aoi_matches += 1

            if nl and local_idx in landuse_map:
                payload = landuse_map[local_idx]
                if not _is_missing_surface_value(payload.get("land_type")):
                    row["land_type"] = payload["land_type"]
                    landuse_matches += 1
                    touched = True

            if touched:
                enriched_rows += 1

    summary = {
        "enriched_rows": int(enriched_rows),
        "block_matches": int(block_matches),
        "aoi_matches": int(aoi_matches),
        "landuse_matches": int(landuse_matches),
        "road_surface_count": len(road_surface_index.get("geometries") or []),
        "aoi_surface_count": len(aoi_surface_index.get("geometries") or []),
        "landuse_surface_count": len(euluc_surface_index.get("geometries") or []),
    }
    return enriched_pois, summary


def _as_polygon(geometry: Any) -> Polygon | None:
    """注释说明。"""
    if geometry is None:
        return None

    if isinstance(geometry, Polygon):
        return geometry

    geom_type = getattr(geometry, "geom_type", "")
    if geom_type == "MultiPolygon":
        polygons = [geom for geom in geometry.geoms if isinstance(geom, Polygon)]
        if polygons:
            return max(polygons, key=lambda geom: geom.area)

    if geom_type == "GeometryCollection":
        polygons = [geom for geom in geometry.geoms if isinstance(geom, Polygon)]
        if polygons:
            return max(polygons, key=lambda geom: geom.area)

    return None


def _cluster_span_deg(cluster_points: List[Tuple[float, float]] | None) -> float:
    """注释说明。"""
    if not cluster_points:
        return 0.0
    xs = [float(pt[0]) for pt in cluster_points]
    ys = [float(pt[1]) for pt in cluster_points]
    if not xs or not ys:
        return 0.0
    return max(max(xs) - min(xs), max(ys) - min(ys))


def _adaptive_surface_buffer_deg(
    geometry: Any,
    *,
    cluster_points: List[Tuple[float, float]] | None = None,
) -> float:
    """
    注释说明。
    注释说明。
    """
    span = _cluster_span_deg(cluster_points)

    if span <= 0.0 and geometry is not None and getattr(geometry, "is_empty", False) is False:
        try:
            min_x, min_y, max_x, max_y = geometry.bounds
            span = max(float(max_x) - float(min_x), float(max_y) - float(min_y))
        except Exception:
            span = 0.0

    if span <= 0.0:
        return 0.00012

    return max(0.00005, min(0.0022, span * 0.085))


def _to_surface_polygon(
    geometry: Any,
    *,
    cluster_points: List[Tuple[float, float]] | None = None,
) -> Polygon | None:
    """
    注释说明。
    """
    if geometry is None or getattr(geometry, "is_empty", False):
        return None

    polygon = _as_polygon(geometry)
    if polygon is not None and not polygon.is_empty:
        return polygon

    geom_type = str(getattr(geometry, "geom_type", ""))
    if geom_type in {"LineString", "LinearRing", "MultiLineString", "Point", "MultiPoint", "GeometryCollection"}:
        buffer_deg = _adaptive_surface_buffer_deg(geometry, cluster_points=cluster_points)
        try:
            buffered = geometry.buffer(buffer_deg)
            buffered = buffered.buffer(0)
        except Exception:
            return None
        polygon = _as_polygon(buffered)
        if polygon is not None and not polygon.is_empty:
            return polygon

    return None


def _polygon_from_geojson(
    boundary_geojson: Any,
    *,
    cluster_points: List[Tuple[float, float]] | None = None,
) -> Polygon | None:
    """注释说明。"""
    if not isinstance(boundary_geojson, dict):
        return None

    try:
        geometry = shape(boundary_geojson)
    except Exception:
        return None

    geometry = geometry.buffer(0)
    return _to_surface_polygon(geometry, cluster_points=cluster_points)


def _polygon_ring(polygon: Polygon | None) -> List[List[float]]:
    """注释说明。"""
    if polygon is None or polygon.is_empty:
        return []

    return [[float(x), float(y)] for x, y in polygon.exterior.coords]


def _polygon_area_km2(polygon: Polygon | None) -> float:
    """注释说明。"""
    return polygon_area_km2(polygon)


def _region_identity_key(entry: Dict[str, Any]) -> str:
    semantic_anchor = entry.get("semantic_anchor") if isinstance(entry.get("semantic_anchor"), dict) else {}
    anchor_name = str((semantic_anchor or {}).get("name") or "").strip()
    if anchor_name:
        return _normalize_anchor_text(anchor_name)

    region_name = str(entry.get("name") or "").strip()
    if region_name.endswith("片区"):
        region_name = region_name[:-2]
    return _normalize_anchor_text(region_name)


def _cluster_entry_priority(entry: Dict[str, Any]) -> float:
    confidence = _clamp01(float(entry.get("boundary_confidence") or 0.0))
    vitality = _clamp01(float(entry.get("vitality_score") or 0.0))
    poi_count = int(entry.get("poi_count") or len(entry.get("cluster_pois") or []))
    poi_scale = _clamp01(math.log1p(max(0, poi_count)) / math.log1p(200.0))
    return 0.55 * confidence + 0.35 * vitality + 0.10 * poi_scale


def _deduplicate_cluster_entries(
    cluster_entries: List[Dict[str, Any]],
    *,
    iou_threshold: float = 0.82,
    containment_threshold: float = 0.92,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    safe_iou_threshold = max(0.5, _clamp01(float(iou_threshold)))
    safe_containment_threshold = max(0.6, _clamp01(float(containment_threshold)))

    if not cluster_entries:
        return [], {
            "enabled": True,
            "iou_threshold": round(float(safe_iou_threshold), 4),
            "containment_threshold": round(float(safe_containment_threshold), 4),
            "before_count": 0,
            "after_count": 0,
            "removed_count": 0,
            "removed_examples": [],
        }

    ranked_entries = sorted(
        list(cluster_entries),
        key=_cluster_entry_priority,
        reverse=True,
    )
    kept_entries: List[Dict[str, Any]] = []
    kept_geometries: List[Any | None] = []
    kept_identity_keys: List[str] = []
    removed_examples: List[Dict[str, Any]] = []

    for entry in ranked_entries:
        identity_key = _region_identity_key(entry)
        boundary_geojson = entry.get("boundary_geojson")
        if not isinstance(boundary_geojson, dict):
            boundary_geojson = entry.get("boundary")
        current_geom = _safe_shape_geojson(boundary_geojson)

        should_skip = False
        if identity_key and current_geom is not None:
            for idx, existing_entry in enumerate(kept_entries):
                if identity_key != kept_identity_keys[idx]:
                    continue

                existing_geom = kept_geometries[idx]
                if existing_geom is None:
                    continue

                try:
                    inter_area = float(current_geom.intersection(existing_geom).area or 0.0)
                    if inter_area <= 0.0:
                        continue
                    union_area = float(current_geom.union(existing_geom).area or 0.0)
                    iou = inter_area / union_area if union_area > 0.0 else 0.0
                    smaller_area = max(
                        min(float(current_geom.area or 0.0), float(existing_geom.area or 0.0)),
                        1e-12,
                    )
                    containment = inter_area / smaller_area
                except Exception:
                    continue

                if iou >= safe_iou_threshold or containment >= safe_containment_threshold:
                    should_skip = True
                    if len(removed_examples) < 8:
                        removed_examples.append(
                            {
                                "removed_id": entry.get("id"),
                                "removed_name": entry.get("name"),
                                "kept_id": existing_entry.get("id"),
                                "kept_name": existing_entry.get("name"),
                                "identity_key": identity_key,
                                "iou": round(float(iou), 4),
                                "containment": round(float(containment), 4),
                            }
                        )
                    break

        if should_skip:
            continue

        kept_entries.append(entry)
        kept_geometries.append(current_geom)
        kept_identity_keys.append(identity_key)

    return kept_entries, {
        "enabled": True,
        "iou_threshold": round(float(safe_iou_threshold), 4),
        "containment_threshold": round(float(safe_containment_threshold), 4),
        "before_count": len(cluster_entries),
        "after_count": len(kept_entries),
        "removed_count": len(cluster_entries) - len(kept_entries),
        "removed_examples": removed_examples,
    }


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def _build_region_layers(
    *,
    cluster_points: List[Tuple[float, float]],
    base_boundary_geojson: Dict[str, Any],
    density: float,
    membership_score: float,
    constraint_polygon: Polygon | None = None,
) -> Dict[str, Any]:
    return boundary_builder.build_region_layers(
        cluster_points=cluster_points,
        base_boundary_geojson=base_boundary_geojson,
        density=density,
        membership_score=membership_score,
        constraint_polygon=constraint_polygon,
        polygon_from_geojson=_polygon_from_geojson,
        to_surface_polygon=_to_surface_polygon,
        as_polygon=_as_polygon,
        clip_polygon_to_constraint=_clip_polygon_to_constraint,
        polygon_area_km2=_polygon_area_km2,
        clamp01=_clamp01,
    )


def _calc_vitality_score(
    *,
    density: float,
    membership_score: float,
    purity: float,
    cluster_size: int,
    total_size: int,
    ) -> float:
    """注释说明。"""
    cluster_ratio = 0.0 if total_size <= 0 else cluster_size / total_size
    return round(
        _clamp01(
            0.42 * _clamp01(density)
            + 0.28 * _clamp01(membership_score)
            + 0.20 * _clamp01(purity)
            + 0.10 * _clamp01(cluster_ratio)
        ),
        5,
    )


def _boundary_method_confidence(boundary_method: str) -> float:
    return confidence_scorer.boundary_method_confidence(boundary_method)


def _score_boundary_quality(
    *,
    cluster_points: List[Tuple[float, float]],
    boundary_geojson: Dict[str, Any],
    road_alignment_score: float | None = None,
    landuse_alignment_score: float | None = None,
) -> Dict[str, Any]:
    return boundary_builder.score_boundary_quality(
        cluster_points=cluster_points,
        boundary_geojson=boundary_geojson,
        road_alignment_score=road_alignment_score,
        landuse_alignment_score=landuse_alignment_score,
        polygon_from_geojson=_polygon_from_geojson,
        to_surface_polygon=_to_surface_polygon,
        polygon_area_km2=_polygon_area_km2,
        polygon_perimeter_km=polygon_perimeter_km,
        clamp01=_clamp01,
    )


def _build_cluster_boundary(
    *,
    cluster_points: List[Tuple[float, float]],
    bbox_area_m2: float,
    density: float,
    alpha_max_input_points: int,
    road_index: STRtree | None = None,
    road_geometries: List[Any] | None = None,
    landuse_index: STRtree | None = None,
    landuse_geometries: List[Any] | None = None,
    landuse_weights: List[float] | None = None,
) -> Dict[str, Any]:
    return boundary_builder.build_cluster_boundary(
        cluster_points=cluster_points,
        bbox_area_m2=bbox_area_m2,
        density=density,
        alpha_max_input_points=alpha_max_input_points,
        road_index=road_index,
        road_geometries=road_geometries,
        landuse_index=landuse_index,
        landuse_geometries=landuse_geometries,
        landuse_weights=landuse_weights,
        build_alpha_shape_func=build_alpha_shape,
        compute_road_alignment_score_func=_compute_road_alignment_score,
        compute_landuse_alignment_score_func=_compute_landuse_alignment_score,
        score_boundary_quality_func=_score_boundary_quality,
        snap_polygon_to_linear_context_func=_snap_polygon_to_linear_context,
        to_surface_polygon_func=_to_surface_polygon,
    )


def _build_boundary_confidence(
    *,
    layer_bundle: Dict[str, Any],
    membership_score: float,
    boundary_method: str,
    boundary_quality_score: float | None = None,
    poi_quality_score: float | None = None,
    semantic_anchor_confidence: float | None = None,
    niche_consistency_score: float | None = None,
    visual_morphology_confidence: float | None = None,
    self_validation_confidence: float | None = None,
    skg_consistency_score: float | None = None,
    ) -> Dict[str, Any]:
    return confidence_scorer.build_boundary_confidence(
        layer_bundle=layer_bundle,
        membership_score=membership_score,
        boundary_method=boundary_method,
        boundary_quality_score=boundary_quality_score,
        poi_quality_score=poi_quality_score,
        semantic_anchor_confidence=semantic_anchor_confidence,
        niche_consistency_score=niche_consistency_score,
        visual_morphology_confidence=visual_morphology_confidence,
        self_validation_confidence=self_validation_confidence,
        skg_consistency_score=skg_consistency_score,
    )


def _review_cluster_morphology(
    *,
    spatial_context: Dict[str, Any],
    boundary_geojson: Dict[str, Any] | None,
    boundary_quality: Dict[str, Any] | None,
    poi_count: int,
    model_name: str,
    endpoint: str,
    image_data_url: str | None,
    enable_remote: bool,
    timeout_ms: int,
) -> Dict[str, Any]:
    return vlm_reviewer.review_cluster_morphology(
        spatial_context=spatial_context,
        boundary_geojson=boundary_geojson,
        boundary_quality=boundary_quality,
        poi_count=poi_count,
        model_name=model_name,
        endpoint=endpoint,
        image_data_url=image_data_url,
        enable_remote=enable_remote,
        timeout_ms=timeout_ms,
    )


def _poi_text_blob(poi: Dict[str, Any]) -> str:
    return " ".join(
        [
            str(poi.get("name") or ""),
            str(poi.get("address") or ""),
            str(poi.get("type") or ""),
            str(poi.get("category_big") or ""),
            str(poi.get("category_mid") or ""),
            str(poi.get("category_small") or ""),
            str(poi.get("aoi_name") or ""),
        ]
    ).strip()


def _rerank_pois_with_priors(
    *,
    pois: List[Dict[str, Any]],
    anchor_terms: List[str],
    priority_categories: List[str],
) -> Tuple[List[Dict[str, Any]], int]:
    if not pois:
        return [], 0
    normalized_prior_categories = {
        str(item).strip().lower()
        for item in (priority_categories or [])
        if str(item).strip()
    }
    if not anchor_terms and not normalized_prior_categories:
        return list(pois), 0

    boosted_count = 0
    scored: List[Tuple[int, int, Dict[str, Any]]] = []
    for idx, poi in enumerate(pois):
        text_score = _anchor_match_score(_poi_text_blob(poi), anchor_terms)
        poi_categories = {
            str(poi.get("category_big") or "").strip().lower(),
            str(poi.get("category_mid") or "").strip().lower(),
            str(poi.get("category_small") or "").strip().lower(),
            str(poi.get("type") or "").strip().lower(),
        }
        category_match = int(bool(normalized_prior_categories.intersection(poi_categories)))
        if text_score > 0 or category_match > 0:
            boosted_count += 1
        # medium-strength prior: soft boost only, never hard filter
        score = text_score * 5 + category_match * 2
        scored.append((score, -idx, poi))

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    reranked = [item[2] for item in scored]
    return reranked, boosted_count


def _run_parallel_model_inference(
    *,
    semantic_query: str,
    spatial_context: Dict[str, Any],
    categories: List[str],
    image_data_url: str | None,
    visual_model_name: str,
    ocr_model_name: str,
    visual_endpoint: str,
    visual_timeout_ms: int,
    reasoning_enabled: bool,
    reasoning_model_name: str,
    reasoning_endpoint: str,
    reasoning_timeout_ms: int,
    model_budget_ms: int,
    allow_vlm_remote_failure: bool = False,
    overview_enabled: bool = False,
    overview_model_name: str = "qwen3.5-0.8b",
    overview_medium_enabled: bool = False,
    overview_timeout_ms: int = 1400,
) -> Dict[str, Any]:
    started = time.perf_counter()
    budget_s = max(0.5, float(model_budget_ms) / 1000.0)
    timing = {
        "ocr_ms": 0.0,
        "overview_light_ms": 0.0,
        "overview_medium_ms": 0.0,
        "vlm_ms": 0.0,
        "llm_ms": 0.0,
        "parallel_wall_ms": 0.0,
        "budget_ms": int(model_budget_ms),
        "timed_out": False,
    }
    model_context = {
        "visualModel": visual_model_name,
        "ocrModel": ocr_model_name,
        "overviewEnabled": bool(overview_enabled),
        "overviewModel": overview_model_name if overview_enabled else None,
        "overviewMediumEnabled": bool(overview_enabled and overview_medium_enabled),
        "reasoningModel": reasoning_model_name if reasoning_enabled else None,
        "reasoningEnabled": bool(reasoning_enabled),
        "modelBudgetMs": int(model_budget_ms),
        "visualTimeoutMs": int(visual_timeout_ms),
        "overviewTimeoutMs": int(overview_timeout_ms),
        "reasoningTimeoutMs": int(reasoning_timeout_ms),
    }

    def _build_parallel_error_context(error_code: str, python_context: Any = None) -> Dict[str, Any]:
        return {
            "error_code": str(error_code),
            "model_context": dict(model_context),
            "model_timing_ms": dict(timing),
            "python_context": _normalize_python_context_preview(
                python_context
                if python_context is not None
                else {**_redacted_preview("model_parallel_error"), "parse_stage": "parallel"}
            ),
        }

    if not image_data_url and not allow_vlm_remote_failure:
        error_code = "model_parallel_failed:visual_snapshot_missing"
        err = RuntimeError(error_code)
        err.parallel_error_context = _build_parallel_error_context(
            error_code,
            {**_redacted_preview("visual_snapshot_missing"), "parse_stage": "input_validation"},
        )
        raise err

    def _timed_ocr() -> Tuple[Dict[str, Any], float]:
        started_local = time.perf_counter()
        value = vlm_reviewer.extract_map_anchors(
            image_data_url=image_data_url,
            model_name=ocr_model_name,
            endpoint=visual_endpoint,
            timeout_ms=visual_timeout_ms,
        )
        elapsed = (time.perf_counter() - started_local) * 1000.0
        return value, elapsed

    def _timed_overview_light() -> Tuple[Dict[str, Any], float]:
        started_local = time.perf_counter()
        value = vlm_reviewer.summarize_map_overview(
            image_data_url=image_data_url,
            model_name=overview_model_name,
            endpoint=visual_endpoint,
            timeout_ms=overview_timeout_ms,
        )
        elapsed = (time.perf_counter() - started_local) * 1000.0
        return value, elapsed

    def _timed_overview_medium() -> Tuple[Dict[str, Any], float]:
        started_local = time.perf_counter()
        value = vlm_reviewer.summarize_map_overview(
            image_data_url=image_data_url,
            model_name=visual_model_name,
            endpoint=visual_endpoint,
            timeout_ms=overview_timeout_ms,
        )
        elapsed = (time.perf_counter() - started_local) * 1000.0
        return value, elapsed

    def _timed_reasoning(vlm_result: Dict[str, Any] | None = None) -> Tuple[Dict[str, Any], float]:
        started_local = time.perf_counter()
        value = reasoning_reviewer.infer_spatial_priors(
            semantic_query=semantic_query,
            spatial_context=spatial_context,
            categories=categories,
            vlm_landmarks=list((vlm_result or {}).get("landmarks") or []),
            vlm_aliases=list((vlm_result or {}).get("aliases") or []),
            model_name=reasoning_model_name,
            endpoint=reasoning_endpoint,
            timeout_ms=reasoning_timeout_ms,
        )
        elapsed = (time.perf_counter() - started_local) * 1000.0
        return value, elapsed

    ocr_payload: Dict[str, Any] = {}
    overview_light_payload: Dict[str, Any] = {}
    overview_medium_payload: Dict[str, Any] = {}
    llm_payload: Dict[str, Any] = {"success": not reasoning_enabled}

    worker_count = 1
    if overview_enabled:
        worker_count += 1
        if overview_medium_enabled:
            worker_count += 1
    if reasoning_enabled:
        worker_count += 1

    with ThreadPoolExecutor(max_workers=max(1, worker_count)) as pool:
        future_map = {"ocr": pool.submit(_timed_ocr)}
        if overview_enabled:
            future_map["overview_light"] = pool.submit(_timed_overview_light)
            if overview_medium_enabled:
                future_map["overview_medium"] = pool.submit(_timed_overview_medium)
        if reasoning_enabled:
            future_map["llm"] = pool.submit(_timed_reasoning)

        done, not_done = wait(
            list(future_map.values()),
            timeout=budget_s,
        )

        if not_done:
            timing["timed_out"] = True
            for future in not_done:
                future.cancel()
            timing["parallel_wall_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
            error_code = "model_parallel_failed:budget_exceeded"
            if allow_vlm_remote_failure:
                timeout_debug = {**_redacted_preview("model_parallel_budget_exceeded"), "parse_stage": "budget_guard"}
                degraded_ocr_payload = {
                    "success": False,
                    "mode": "map_anchor_v2",
                    "model": ocr_model_name,
                    "anchors": [],
                    "aliases": [],
                    "extracted_texts": [],
                    "error": "budget_exceeded",
                    "debug": timeout_debug,
                }
                degraded_llm_payload = {
                    "success": False,
                    "mode": "reasoning_prior_v1",
                    "model": reasoning_model_name,
                    "priors": [],
                    "error": "budget_exceeded",
                    "debug": timeout_debug,
                } if reasoning_enabled else {}
                return {
                    "ocr": degraded_ocr_payload,
                    "vlm": degraded_ocr_payload,
                    "overview_light": {
                        "success": False,
                        "mode": "map_overview_v1",
                        "model": overview_model_name,
                        "summary": "",
                        "error": "budget_exceeded",
                        "debug": timeout_debug,
                    },
                    "overview_medium": {
                        "success": False,
                        "mode": "map_overview_v1",
                        "model": visual_model_name,
                        "summary": "",
                        "error": "budget_exceeded",
                        "debug": timeout_debug,
                    },
                    "llm": degraded_llm_payload,
                    "timing": timing,
                    "degraded": True,
                    "degrade_reason": "budget_exceeded",
                }
            err = RuntimeError(error_code)
            err.parallel_error_context = _build_parallel_error_context(
                error_code,
                {**_redacted_preview("model_parallel_budget_exceeded"), "parse_stage": "budget_guard"},
            )
            raise err

        for key, future in future_map.items():
            try:
                payload, elapsed_ms = future.result()
            except Exception as exc:  # pragma: no cover - runtime guard
                if key in {"overview_light", "overview_medium"}:
                    model_name = overview_model_name if key == "overview_light" else visual_model_name
                    payload = {
                        "success": False,
                        "mode": "map_overview_v1",
                        "model": model_name,
                        "summary": "",
                        "error": "overview_runtime_exception",
                        "debug": {**_redacted_preview(str(exc)), "parse_stage": "future_result"},
                    }
                    elapsed_ms = 0.0
                    if key == "overview_light":
                        overview_light_payload = payload
                        timing["overview_light_ms"] = round(float(elapsed_ms), 3)
                    else:
                        overview_medium_payload = payload
                        timing["overview_medium_ms"] = round(float(elapsed_ms), 3)
                    continue
                timing["parallel_wall_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
                error_code = f"model_parallel_failed:{key}:runtime_exception"
                err = RuntimeError(f"model_parallel_failed:{key}:{exc}")
                err.parallel_error_context = _build_parallel_error_context(
                    error_code,
                    {**_redacted_preview(str(exc)), "parse_stage": "future_result"},
                )
                raise err from exc
            if key == "ocr":
                ocr_payload = payload if isinstance(payload, dict) else {}
                timing["ocr_ms"] = round(float(elapsed_ms), 3)
            elif key == "overview_light":
                overview_light_payload = payload if isinstance(payload, dict) else {}
                timing["overview_light_ms"] = round(float(elapsed_ms), 3)
            elif key == "overview_medium":
                overview_medium_payload = payload if isinstance(payload, dict) else {}
                timing["overview_medium_ms"] = round(float(elapsed_ms), 3)
            else:
                llm_payload = payload if isinstance(payload, dict) else {}
                timing["llm_ms"] = round(float(elapsed_ms), 3)

    timing["vlm_ms"] = round(float(timing.get("ocr_ms", 0.0)), 3)
    timing["parallel_wall_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
    llm_soft_degrade_reason = ""
    if reasoning_enabled and not bool(llm_payload.get("success")):
        error_reason = str(llm_payload.get("error") or "llm_inference_failed").strip()
        if _is_soft_llm_failure(error_reason):
            llm_soft_degrade_reason = f"llm:{error_reason}"
        else:
            error_code = f"model_parallel_failed:llm:{error_reason}"
            debug_payload = llm_payload.get("debug") if isinstance(llm_payload.get("debug"), dict) else None
            err = RuntimeError(error_code)
            err.parallel_error_context = _build_parallel_error_context(
                error_code,
                debug_payload or {**_redacted_preview(error_reason), "parse_stage": "llm_result"},
            )
            raise err

    if not bool(ocr_payload.get("success")):
        error_reason = str(ocr_payload.get("error") or "ocr_inference_failed").strip()
        if allow_vlm_remote_failure and _is_soft_vlm_failure(error_reason):
            return {
                "ocr": ocr_payload,
                "vlm": ocr_payload,
                "overview_light": overview_light_payload,
                "overview_medium": overview_medium_payload,
                "llm": llm_payload if reasoning_enabled else {},
                "timing": timing,
                "degraded": True,
                "degrade_reason": llm_soft_degrade_reason or error_reason,
            }

        error_code = f"model_parallel_failed:ocr:{error_reason}"
        debug_payload = ocr_payload.get("debug") if isinstance(ocr_payload.get("debug"), dict) else None
        err = RuntimeError(error_code)
        err.parallel_error_context = _build_parallel_error_context(
            error_code,
            debug_payload or {**_redacted_preview(error_reason), "parse_stage": "ocr_result"},
        )
        raise err

    if llm_soft_degrade_reason:
        return {
            "ocr": ocr_payload,
            "vlm": ocr_payload,
            "overview_light": overview_light_payload,
            "overview_medium": overview_medium_payload,
            "llm": llm_payload if reasoning_enabled else {},
            "timing": timing,
            "degraded": True,
            "degrade_reason": llm_soft_degrade_reason,
        }

    return {
        "ocr": ocr_payload,
        "vlm": ocr_payload,
        "overview_light": overview_light_payload,
        "overview_medium": overview_medium_payload,
        "llm": llm_payload if reasoning_enabled else {},
        "timing": timing,
    }


def _validate_cluster_entries(cluster_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    return self_validator.validate_cluster_entries(cluster_entries)


def _build_spatial_knowledge_graph(cluster_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    return spatial_knowledge_graph.build_spatial_knowledge_graph(cluster_entries)


def _poi_priority(
    poi: Dict[str, Any],
    *,
    center_lon: float,
    center_lat: float,
    vitality_score: float,
) -> float:
    """注释说明。"""
    rating_raw = _to_float(poi.get("rating"))
    rating_norm = 0.0
    if rating_raw is not None and rating_raw > 0:
        rating_norm = min(1.0, max(0.0, rating_raw / 5.0))

    lon = _to_float(poi.get("lon"))
    lat = _to_float(poi.get("lat"))
    if lon is None or lat is None:
        proximity = 0.0
    else:
        distance_km = _haversine_km(center_lat, center_lon, lat, lon)
        proximity = 1.0 / (1.0 + distance_km / 0.6)

    return (
        0.62 * _clamp01(vitality_score)
        + 0.28 * _clamp01(proximity)
        + 0.10 * _clamp01(rating_norm)
    )


def _build_representative_pois(
    *,
    cluster_entries: List[Dict[str, Any]],
    fallback_pois: List[Dict[str, Any]],
    max_count: int,
) -> List[Dict[str, Any]]:
    """
    注释说明。
    注释说明。
    """
    if max_count <= 0:
        return []

    if not cluster_entries:
        return fallback_pois[:max_count]

    ranked_entries = sorted(
        cluster_entries,
        key=lambda item: float(item.get("vitality_score", 0.0)),
        reverse=True,
    )

    total_cluster_points = max(
        1,
        sum(int(item.get("poi_count", len(item.get("cluster_pois", [])))) for item in ranked_entries),
    )

    queues: List[List[Dict[str, Any]]] = []
    used_ids = set()

    for entry in ranked_entries:
        cluster_pois = list(entry.get("cluster_pois") or [])
        if not cluster_pois:
            continue

        center = entry.get("center") or {}
        center_lon = _to_float(center.get("lon")) or 0.0
        center_lat = _to_float(center.get("lat")) or 0.0
        vitality = float(entry.get("vitality_score", 0.0))
        cluster_size = len(cluster_pois)

        quota = max(
            6,
            int(round(max_count * (cluster_size / total_cluster_points))),
        )
        quota = min(quota, cluster_size)

        scored = sorted(
            cluster_pois,
            key=lambda poi: _poi_priority(
                poi,
                center_lon=center_lon,
                center_lat=center_lat,
                vitality_score=vitality,
            ),
            reverse=True,
        )[:quota]

        queue: List[Dict[str, Any]] = []
        for poi in scored:
            poi_id = poi.get("id")
            stable_key = (poi_id, poi.get("lon"), poi.get("lat"), poi.get("name"))
            if stable_key in used_ids:
                continue
            used_ids.add(stable_key)

            queue.append(
                {
                    **poi,
                    "cluster_id": entry.get("id"),
                    "analysis_score": round(
                        _poi_priority(
                            poi,
                            center_lon=center_lon,
                            center_lat=center_lat,
                            vitality_score=vitality,
                        ),
                        5,
                    ),
                }
            )
        if queue:
            queues.append(queue)

    selected: List[Dict[str, Any]] = []
    while len(selected) < max_count:
        progressed = False
        for queue in queues:
            if not queue:
                continue
            selected.append(queue.pop(0))
            progressed = True
            if len(selected) >= max_count:
                break
        if not progressed:
            break

    if len(selected) < max_count:
        for poi in fallback_pois:
            poi_id = poi.get("id")
            stable_key = (poi_id, poi.get("lon"), poi.get("lat"), poi.get("name"))
            if stable_key in used_ids:
                continue
            used_ids.add(stable_key)
            selected.append(poi)
            if len(selected) >= max_count:
                break

    return selected[:max_count]


def _build_region_views(*, cluster_entries: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    return result_assembler.build_region_views(cluster_entries=cluster_entries)


def _summarize_cluster_entries(
    *,
    cluster_entries: List[Dict[str, Any]],
    fuzzy_regions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    return result_assembler.summarize_cluster_entries(
        cluster_entries=cluster_entries,
        fuzzy_regions=fuzzy_regions,
    )


class SpatialPipeline:
    """注释说明。"""

    def __init__(self, repository: POIRepository | None = None) -> None:
        self.repository = repository or POIRepository()

    def run(self, request: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        """注释说明。"""
        query_type = str(request.get("query_type") or "poi_search")
        spatial_context = _safe_json_loads(request.get("spatial_context"), {})
        categories = [str(cat).strip() for cat in (request.get("categories") or []) if str(cat).strip()]
        operator_timings_ms: Dict[str, float] = defaultdict(float)

        def run_with_timing(operator_name: str, fn, *args, **kwargs):
            started = time.perf_counter()
            result = fn(*args, **kwargs)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            operator_timings_ms[operator_name] += elapsed_ms
            return result

        def snapshot_operator_timings() -> Dict[str, float]:
            return {
                name: round(float(total_ms), 3)
                for name, total_ms in operator_timings_ms.items()
                if float(total_ms) > 0.0
            }

        hints = _safe_json_loads(request.get("hints"), {})
        semantic_query = hints.get("semantic_query") or ""
        terms = [term.strip() for term in semantic_query.split() if term.strip()]

        hints_options = hints.get("options") if isinstance(hints.get("options"), dict) else {}
        source_policy = (
            hints_options.get("sourcePolicy")
            or hints_options.get("source_policy")
            or {}
        )
        dsl_context_binding = (
            hints_options.get("context_binding")
            if isinstance(hints_options.get("context_binding"), dict)
            else {}
        )
        dsl_revision = (
            hints_options.get("revision")
            if isinstance(hints_options.get("revision"), dict)
            else {}
        )
        dsl_streaming_hints = (
            hints_options.get("streaming_hints")
            if isinstance(hints_options.get("streaming_hints"), dict)
            else {}
        )
        revision_mode = str(dsl_revision.get("mode") or "rebuild").strip().lower()
        if revision_mode not in {"rebuild", "patch"}:
            revision_mode = "rebuild"
        dsl_patch_ops = dsl_revision.get("patch_ops") if isinstance(dsl_revision.get("patch_ops"), list) else []
        dsl_context_binding_present = bool(dsl_context_binding)
        context_binding_degraded = not (
            isinstance(dsl_context_binding.get("client_view_id"), str)
            and str(dsl_context_binding.get("client_view_id")).strip()
            and dsl_context_binding.get("event_seq") is not None
        )
        streaming_allow_prefetch = bool(dsl_streaming_hints.get("allow_prefetch", False))
        streaming_prefetch_on_fields = (
            [str(field).strip() for field in dsl_streaming_hints.get("prefetch_on_fields", []) if str(field).strip()]
            if isinstance(dsl_streaming_hints.get("prefetch_on_fields"), list)
            else []
        )
        vlm_anchor_texts = _normalize_anchor_list(request.get("vlm_extracted_texts") or [])
        vlm_anchor_texts = _normalize_anchor_list(
            vlm_anchor_texts + _normalize_anchor_list(hints.get("vlm_extracted_texts") or [])
        )
        vlm_anchor_texts = _normalize_anchor_list(
            vlm_anchor_texts + _normalize_anchor_list(hints_options.get("vlmExtractedTexts") or [])
        )
        requested_confidence_model = str(
            hints_options.get("confidenceModel") or hints_options.get("confidence_model") or ""
        ).strip().lower()
        force_composite_v5 = requested_confidence_model == "composite_v5" or _option_enabled(
            hints_options.get("forceCompositeV5"),
            default_value=False,
        )

        # [Phase4] 融合感知：利用 VLM 抽取的 visual_perception 属性
        # VLM 解析 model_parallel 同步执行
        visual_review_enabled = False
        visual_remote_enabled = False
        self_validation_enabled = force_composite_v5 or _option_enabled(
            hints_options.get("selfValidationEnabled"), default_value=False
        )
        skg_enabled = force_composite_v5 or _option_enabled(
            hints_options.get("skgEnabled"), default_value=False
        )
        v5_region_dedup_enabled = _option_enabled(
            hints_options.get("v5RegionDedupEnabled"),
            default_value=force_composite_v5,
        )
        try:
            v5_region_dedup_iou_threshold = max(
                0.5,
                _clamp01(float(hints_options.get("v5RegionDedupIouThreshold", 0.82))),
            )
        except (TypeError, ValueError):
            v5_region_dedup_iou_threshold = 0.82
        try:
            v5_region_dedup_containment_threshold = max(
                0.6,
                _clamp01(float(hints_options.get("v5RegionDedupContainmentThreshold", 0.92))),
            )
        except (TypeError, ValueError):
            v5_region_dedup_containment_threshold = 0.92
        visual_model_name = _normalize_visual_model_name(hints_options.get("visualModel"))
        ocr_model_name = str(hints_options.get("ocrModel") or "glm-ocr").strip() or "glm-ocr"
        overview_model_name = str(hints_options.get("overviewModel") or "qwen3.5-0.8b").strip() or "qwen3.5-0.8b"
        visual_endpoint = str(
            hints_options.get("visualEndpoint") or "http://localhost:1234/v1/chat/completions"
        )
        # canonical visual snapshot key for Phase 4
        visual_image_data_url = (
            hints_options.get("visualSnapshotDataUrl")
            or hints_options.get("mapSnapshotDataUrl")
            or hints_options.get("screenshot_base64")
            or hints_options.get("screenshotBase64")
        )
        visual_timeout_ms = _resolve_limit(
            hints_options.get("visualTimeoutMs"),
            default_value=3500,
            max_value=15000,
        )
        overview_enabled = _option_enabled(
            hints_options.get("overviewEnabled"),
            default_value=bool(visual_image_data_url),
        )
        overview_medium_enabled = _option_enabled(
            hints_options.get("overviewMediumEnabled"),
            default_value=True,
        )
        overview_timeout_ms = _resolve_limit(
            hints_options.get("overviewTimeoutMs"),
            default_value=min(visual_timeout_ms, 2200),
            max_value=15000,
        )
        model_budget_ms = _resolve_limit(
            hints_options.get("modelBudgetMs"),
            default_value=5000,
            max_value=30000,
        )
        vlm_failure_mode = str(
            hints_options.get("vlmFailureMode")
            or os.getenv("VLM_FAILURE_MODE")
            or "soft"
        ).strip().lower()
        allow_vlm_remote_failure = vlm_failure_mode not in {"strict", "hard", "fail"}
        reasoning_enabled = _option_enabled(
            hints_options.get("reasoningEnabled"),
            default_value=False,
        )
        reasoning_model_name = str(hints_options.get("reasoningModel") or "qwen3.5-4b")
        reasoning_endpoint = str(
            hints_options.get("reasoningEndpoint")
            or hints_options.get("llmEndpoint")
            or visual_endpoint
        )
        reasoning_timeout_ms = _resolve_limit(
            hints_options.get("reasoningTimeoutMs"),
            default_value=1800,
            max_value=15000,
        )
        name_audit_enabled = _option_enabled(
            hints_options.get("nameAuditEnabled"),
            default_value=True,
        )
        name_audit_remote_enabled = name_audit_enabled and _option_enabled(
            hints_options.get("nameAuditRemoteEnabled"),
            default_value=True,
        )
        name_audit_model_name = str(
            hints_options.get("nameAuditModel")
            or hints_options.get("nameAuditLLM")
            or visual_model_name
        )
        name_audit_timeout_ms = _resolve_limit(
            hints_options.get("nameAuditTimeoutMs"),
            default_value=900,
            max_value=4000,
        )
        name_audit_max_items = _resolve_limit(
            hints_options.get("nameAuditMaxItems"),
            default_value=24,
            max_value=80,
        )

        if not categories and isinstance(source_policy, dict) and source_policy.get("has_category_filter"):
            selected = source_policy.get("selected_categories") or hints_options.get("selectedCategories") or []
            categories = [str(cat).strip() for cat in selected if str(cat).strip()]

        migration_hints = hints.get("migration") if isinstance(hints.get("migration"), dict) else {}
        py_data_source = str(migration_hints.get("py_data_source") or "python").lower()

        query_plan = hints.get("query_plan") if isinstance(hints.get("query_plan"), dict) else {}
        direction_hint = resolve_direction_from_query_plan(query_plan, semantic_query=semantic_query)
        anchor_hint = query_plan.get("anchor") if isinstance(query_plan, dict) else None
        query_plan_type = str(query_plan.get("query_type") or query_type).strip().lower()
        intent_mode = str(query_plan.get("intent_mode") or "").strip().lower()
        need_graph_reasoning = bool(query_plan.get("need_graph_reasoning")) or query_type == "graph_reasoning"
        need_region_comparison = query_type == "region_comparison"
        region_context = hints_options.get("regions") if isinstance(hints_options.get("regions"), list) else []
        target_region_ids = query_plan.get("target_regions") if isinstance(query_plan.get("target_regions"), list) else []
        semantic_anchor_hints: List[str] = []
        requested_categories = list(categories)
        has_ui_category_filter = bool(isinstance(source_policy, dict) and source_policy.get("has_category_filter"))
        fetch_categories = list(categories)
        fetch_categories_relaxed_macro = False
        if query_plan_type == "area_analysis" and intent_mode == "macro_overview" and not has_ui_category_filter:
            fetch_categories = []
            fetch_categories_relaxed_macro = bool(requested_categories)

        anchor_hint_name = (
            str((anchor_hint or {}).get("name") or "").strip()
            if isinstance(anchor_hint, dict)
            else ""
        )
        if anchor_hint_name:
            semantic_anchor_hints.append(anchor_hint_name)

        for raw_hint in (query_plan.get("semantic_anchor_candidates") or []):
            if isinstance(raw_hint, str) and raw_hint.strip():
                semantic_anchor_hints.append(raw_hint.strip())
        for raw_hint in (hints_options.get("semanticAnchorHints") or []):
            if isinstance(raw_hint, str) and raw_hint.strip():
                semantic_anchor_hints.append(raw_hint.strip())
        semantic_anchor_hints.extend(vlm_anchor_texts)
        semantic_anchor_hints = _normalize_anchor_list(semantic_anchor_hints)

        spatial_constraint_polygon = _build_spatial_constraint_polygon(spatial_context)
        # 如果没有任何检索结果且强制回退关闭，则提前终止
        if need_graph_reasoning and query_type == "graph_reasoning":
            terms = []

        if need_region_comparison:
            yield {
                "type": "STAGE",
                "payload": {
                    "stage": "region_comparison_prepare",
                    "query_type": query_type,
                },
            }

            region_analyses = run_with_timing(
                "region_comparison.py",
                analyze_region_set,
                regions=region_context,
                target_region_ids=target_region_ids,
                categories=categories,
                repository=self.repository,
            )
            comparison = run_with_timing(
                "region_comparison.py",
                compute_region_comparison,
                region_analyses,
                dimensions=query_plan.get("comparison_dimensions") if isinstance(query_plan.get("comparison_dimensions"), list) else [],
            )

            valid_regions = len(region_analyses)
            total_pois = sum(int(item.get("poi_count", 0)) for item in region_analyses)
            comparison_error = None
            if valid_regions < 2:
                comparison_error = "Not enough valid regions for comparison (minimum: 2)."
                comparison = None

            yield {
                "type": "PROGRESS",
                "payload": {
                    "stage": "region_comparison_prepare",
                    "progress": 0.6,
                    "requested_regions": len(target_region_ids),
                    "valid_regions": valid_regions,
                    "total_pois": total_pois,
                },
            }

            final_results = {
                "mode": "region_comparison",
                "target_regions": target_region_ids,
                "region_analyses": region_analyses,
                "comparison": comparison,
                "pois": [],
                "boundary": None,
                "spatial_clusters": {"hotspots": []},
                "regions": [],
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": _empty_graph_summary(),
                "stats": {
                    "query_type": query_type,
                    "requested_confidence_model": requested_confidence_model or None,
                    "requested_regions": len(target_region_ids),
                    "valid_regions": valid_regions,
                    "regions_analyzed": valid_regions,
                    "total_pois": total_pois,
                    "cluster_count": 0,
                    "cluster_engine": "none",
                    "noise_count": 0,
                    "h3_resolution": _dynamic_h3_resolution(_extract_area_km2(spatial_context)),
                    "h3_engine": "none",
                    "h3_cell_count": 0,
                    "candidate_source": "region_context",
                    "direction": None,
                    "direction_applied": False,
                    "boundary_method": "none",
                    "graph_component_count": 0,
                    "graph_edge_count": 0,
                    "fuzzy_core_count": 0,
                    "fuzzy_transition_count": 0,
                    "fuzzy_periphery_count": 0,
                    "operator_timings_ms": snapshot_operator_timings(),
                },
            }

            if comparison_error:
                final_results["error"] = comparison_error

            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": final_results,
                    "diagnostics": {
                        "engine": "python-spatial-pipeline",
                        "query_type": query_type,
                        "requested_regions": len(target_region_ids),
                        "valid_regions": valid_regions,
                        "comparison_ready": comparison is not None,
                        "operator_timings_ms": snapshot_operator_timings(),
                    },
                },
            }
            return

        graph_max_nodes = _resolve_limit(
            hints_options.get("graphMaxNodes"),
            default_value=280,
            max_value=1200,
        )
        graph_distance_threshold_m = float(hints_options.get("graphDistanceThresholdM") or 280.0)

        max_fetch_limit = _resolve_limit(hints_options.get("maxFetchLimit"), default_value=50000, max_value=500000)
        # [Phase1] 基于 area/graph 获取基础空间锚点
        _default_limit = 20000 if query_type == "area_analysis" else 8000
        fetch_limit = _resolve_limit(hints_options.get("limit"), default_value=_default_limit, max_value=max_fetch_limit)
        print(
            f"[PIPELINE_DEBUG] hints_options limit={hints_options.get('limit')} maxFetchLimit={hints_options.get('maxFetchLimit')} resolved_fetch_limit={fetch_limit}",
            flush=True,
            file=sys.stderr,
        )

        # 注释说明
        explicit_limit = hints_options.get("limit")
        if query_type == "graph_reasoning" and explicit_limit is None:
            fetch_limit = min(fetch_limit, max(600, graph_max_nodes * 3))

        # 注释说明
        # [Phase1] area/graph 锚点获取：将 POI 特征投影到空间平面
        db_order_by_distance = query_type not in {"area_analysis", "graph_reasoning"}

        yield {
            "type": "STAGE",
            "payload": {
                "stage": "fetch_candidates",
                "query_type": query_type,
                "fetch_limit": fetch_limit,
            },
        }

        raw_candidates = _safe_json_loads(request.get("candidates_json"), [])
        payload_candidates = _normalize_payload_candidates(raw_candidates)
        
        # 调试日志
        print(f"[PIPELINE_DEBUG] candidates_json present: {len(raw_candidates) > 0}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] payload_candidates count: {len(payload_candidates)}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] py_data_source: {py_data_source}", flush=True, file=sys.stderr)
        print(f"[PIPELINE_DEBUG] spatial_context: {spatial_context}", flush=True, file=sys.stderr)

        candidate_source = "db"
        original_terms = list(terms)
        effective_terms = list(terms)
        term_filter_relaxed = False
        model_timing_ms = {
            "ocr_ms": 0.0,
            "overview_light_ms": 0.0,
            "overview_medium_ms": 0.0,
            "vlm_ms": 0.0,
            "llm_ms": 0.0,
            "parallel_wall_ms": 0.0,
            "budget_ms": int(model_budget_ms),
            "timed_out": False,
        }
        model_context = {
            "visualModel": visual_model_name if visual_review_enabled else None,
            "ocrModel": ocr_model_name,
            "overviewEnabled": bool(overview_enabled),
            "overviewModel": overview_model_name if overview_enabled else None,
            "overviewMediumEnabled": bool(overview_enabled and overview_medium_enabled),
            "reasoningModel": reasoning_model_name if reasoning_enabled else None,
            "reasoningEnabled": bool(reasoning_enabled),
            "modelBudgetMs": int(model_budget_ms),
            "visualTimeoutMs": int(visual_timeout_ms),
            "overviewTimeoutMs": int(overview_timeout_ms),
            "reasoningTimeoutMs": int(reasoning_timeout_ms),
        }
        vlm_anchor_landmarks: List[str] = []
        vlm_anchor_aliases: List[str] = []
        vlm_overview_light: Dict[str, Any] = {}
        vlm_overview_medium: Dict[str, Any] = {}
        vlm_overview_fused_summary = ""
        llm_spatial_priors: Dict[str, Any] = {}
        model_parallel_degraded = False
        model_parallel_degrade_reason = ""
        anchor_boosted_poi_count = 0
        anchor_bypass_requested_count = 0
        anchor_bypass_injected_count = 0
        anchor_bypass_query_count = 0
        # Stage B: model_parallel and fetch_pois run concurrently.
        # model_parallel depends only on visual_image_data_url + spatial_context,
        # fetch_pois depends only on spatial_context + categories — no data dependency.
        model_parallel_enabled = bool(visual_image_data_url)
        _mp_future: Future | None = None
        _mp_executor: ThreadPoolExecutor | None = None
        if model_parallel_enabled:
            yield {
                "type": "STAGE",
                "payload": {
                    "stage": "model_parallel_start",
                    "model_budget_ms": int(model_budget_ms),
                    "visual_model": visual_model_name,
                    "ocr_model": ocr_model_name,
                    "overview_model": overview_model_name if overview_enabled else None,
                    "overview_medium_enabled": bool(overview_enabled and overview_medium_enabled),
                    "reasoning_model": reasoning_model_name,
                },
            }
            _mp_executor = ThreadPoolExecutor(max_workers=1)
            _mp_future = _mp_executor.submit(
                run_with_timing,
                "phase4_model_parallel.py",
                _run_parallel_model_inference,
                semantic_query=semantic_query,
                spatial_context=spatial_context,
                categories=fetch_categories,
                image_data_url=visual_image_data_url,
                visual_model_name=visual_model_name,
                ocr_model_name=ocr_model_name,
                visual_endpoint=visual_endpoint,
                visual_timeout_ms=visual_timeout_ms,
                reasoning_enabled=reasoning_enabled,
                reasoning_model_name=reasoning_model_name,
                reasoning_endpoint=reasoning_endpoint,
                reasoning_timeout_ms=reasoning_timeout_ms,
                model_budget_ms=model_budget_ms,
                allow_vlm_remote_failure=allow_vlm_remote_failure,
                overview_enabled=overview_enabled,
                overview_model_name=overview_model_name,
                overview_medium_enabled=overview_enabled and overview_medium_enabled,
                overview_timeout_ms=overview_timeout_ms,
            )

        # fetch_pois runs in main thread (concurrent with model_parallel)
        if payload_candidates and py_data_source in {"hybrid", "node"}:
            print(f"[PIPELINE_DEBUG] Using payload candidates (frontend POIs)", flush=True, file=sys.stderr)
            pois = _filter_payload_candidates(
                payload_candidates,
                spatial_context=spatial_context,
                categories=fetch_categories,
                terms=effective_terms,
                limit=fetch_limit,
            )
            candidate_source = "payload"
            if not pois and effective_terms:
                print(
                    "[PIPELINE_DEBUG] Payload candidates strict terms returned 0, retry without semantic terms",
                    flush=True,
                    file=sys.stderr,
                )
                pois = _filter_payload_candidates(
                    payload_candidates,
                    spatial_context=spatial_context,
                    categories=fetch_categories,
                    terms=[],
                    limit=fetch_limit,
                )
                term_filter_relaxed = True
                effective_terms = []
        else:
            print(f"[PIPELINE_DEBUG] Using repository.fetch_pois (PostGIS)", flush=True, file=sys.stderr)
            pois = self.repository.fetch_pois(
                spatial_context=spatial_context,
                categories=fetch_categories,
                terms=effective_terms,
                limit=fetch_limit,
                order_by_distance=db_order_by_distance,
            )
            print(f"[PIPELINE_DEBUG] fetch_pois returned {len(pois)} POIs", flush=True, file=sys.stderr)
            if not pois and effective_terms:
                print(
                    "[PIPELINE_DEBUG] PostGIS strict terms returned 0, retry without semantic terms",
                    flush=True,
                    file=sys.stderr,
                )
                pois = self.repository.fetch_pois(
                    spatial_context=spatial_context,
                    categories=fetch_categories,
                    terms=[],
                    limit=fetch_limit,
                    order_by_distance=db_order_by_distance,
                )
                print(
                    f"[PIPELINE_DEBUG] fetch_pois (relaxed terms) returned {len(pois)} POIs",
                    flush=True,
                    file=sys.stderr,
                )
                term_filter_relaxed = True
                effective_terms = []

        # Wait for model_parallel result (it has been running concurrently)
        if _mp_future is not None:
            try:
                model_parallel_bundle = _mp_future.result(
                    timeout=max(10, model_budget_ms / 1000 + 10),
                )
                model_timing_ms = dict(model_parallel_bundle.get("timing") or model_timing_ms)
                model_parallel_degraded = bool(model_parallel_bundle.get("degraded"))
                model_parallel_degrade_reason = str(model_parallel_bundle.get("degrade_reason") or "").strip()
                ocr_result = (
                    model_parallel_bundle.get("ocr")
                    if isinstance(model_parallel_bundle.get("ocr"), dict)
                    else (
                        model_parallel_bundle.get("vlm")
                        if isinstance(model_parallel_bundle.get("vlm"), dict)
                        else {}
                    )
                )
                overview_light_result = (
                    model_parallel_bundle.get("overview_light")
                    if isinstance(model_parallel_bundle.get("overview_light"), dict)
                    else {}
                )
                overview_medium_result = (
                    model_parallel_bundle.get("overview_medium")
                    if isinstance(model_parallel_bundle.get("overview_medium"), dict)
                    else {}
                )
                llm_result = model_parallel_bundle.get("llm") if isinstance(model_parallel_bundle.get("llm"), dict) else {}

                vlm_anchor_landmarks = _normalize_anchor_list(ocr_result.get("landmarks") or [])
                vlm_anchor_aliases = _normalize_anchor_list(ocr_result.get("aliases") or [])
                vlm_overview_light = {
                    "summary": str(overview_light_result.get("summary") or "").strip(),
                    "road_pattern": str(overview_light_result.get("road_pattern") or "").strip(),
                    "functional_distribution": str(overview_light_result.get("functional_distribution") or "").strip(),
                    "key_observations": _normalize_anchor_list(overview_light_result.get("key_observations") or []),
                    "confidence": float(overview_light_result.get("confidence") or 0.0),
                    "success": bool(overview_light_result.get("success")),
                    "model": overview_light_result.get("model") or overview_model_name,
                }
                vlm_overview_medium = {
                    "summary": str(overview_medium_result.get("summary") or "").strip(),
                    "road_pattern": str(overview_medium_result.get("road_pattern") or "").strip(),
                    "functional_distribution": str(overview_medium_result.get("functional_distribution") or "").strip(),
                    "key_observations": _normalize_anchor_list(overview_medium_result.get("key_observations") or []),
                    "confidence": float(overview_medium_result.get("confidence") or 0.0),
                    "success": bool(overview_medium_result.get("success")),
                    "model": overview_medium_result.get("model") or visual_model_name,
                }
                overview_summary_candidates = _normalize_anchor_list(
                    [
                        vlm_overview_medium.get("summary"),
                        vlm_overview_light.get("summary"),
                    ]
                )
                vlm_overview_fused_summary = " | ".join(
                    str(item).strip() for item in overview_summary_candidates if str(item).strip()
                )[:480]
                llm_spatial_priors = {
                    "summary": str(llm_result.get("summary") or "").strip(),
                    "focus_terms": _normalize_anchor_list(llm_result.get("focus_terms") or []),
                    "alias_candidates": _normalize_anchor_list(llm_result.get("alias_candidates") or []),
                    "priority_categories": [
                        str(item).strip()
                        for item in (llm_result.get("priority_categories") or [])
                        if str(item).strip()
                    ],
                    "confidence": float(llm_result.get("confidence") or 0.0),
                    "mode": llm_result.get("mode"),
                    "model": llm_result.get("model"),
                }

                merged_anchor_terms = _normalize_anchor_list(
                    list(vlm_anchor_texts)
                    + list(vlm_anchor_landmarks)
                    + list(vlm_anchor_aliases)
                    + list(llm_spatial_priors.get("focus_terms") or [])
                    + list(llm_spatial_priors.get("alias_candidates") or [])
                )
                vlm_anchor_texts = merged_anchor_terms
                semantic_anchor_hints = _normalize_anchor_list(list(semantic_anchor_hints) + merged_anchor_terms)

                pois, anchor_boosted_poi_count = _rerank_pois_with_priors(
                    pois=list(pois),
                    anchor_terms=merged_anchor_terms,
                    priority_categories=list(llm_spatial_priors.get("priority_categories") or []),
                )

                yield {
                    "type": "STAGE",
                    "payload": {
                        "stage": "model_parallel_done",
                        "vlm_anchor_count": len(vlm_anchor_landmarks),
                        "vlm_alias_count": len(vlm_anchor_aliases),
                        "ocr_anchor_count": len(vlm_anchor_landmarks),
                        "ocr_alias_count": len(vlm_anchor_aliases),
                        "overview_light_summary_ready": bool(vlm_overview_light.get("summary")),
                        "overview_medium_summary_ready": bool(vlm_overview_medium.get("summary")),
                        "overview_fused_summary_ready": bool(vlm_overview_fused_summary),
                        "reasoning_focus_count": len(llm_spatial_priors.get("focus_terms") or []),
                        "anchor_boosted_poi_count": int(anchor_boosted_poi_count),
                        "degraded": bool(model_parallel_degraded),
                        "degrade_reason": model_parallel_degrade_reason if model_parallel_degraded else None,
                        "model_timing_ms": model_timing_ms,
                    },
                }
            except Exception as exc:
                parallel_ctx = getattr(exc, "parallel_error_context", None)
                if not isinstance(parallel_ctx, dict):
                    parallel_ctx = {}

                timing_from_ctx = parallel_ctx.get("model_timing_ms")
                if isinstance(timing_from_ctx, dict):
                    vlm_ms = _to_float(timing_from_ctx.get("vlm_ms"))
                    llm_ms = _to_float(timing_from_ctx.get("llm_ms"))
                    wall_ms = _to_float(timing_from_ctx.get("parallel_wall_ms"))
                    model_timing_ms = {
                        "vlm_ms": vlm_ms if vlm_ms is not None else float(model_timing_ms.get("vlm_ms", 0.0)),
                        "llm_ms": llm_ms if llm_ms is not None else float(model_timing_ms.get("llm_ms", 0.0)),
                        "parallel_wall_ms": wall_ms if wall_ms is not None else float(model_timing_ms.get("parallel_wall_ms", 0.0)),
                        "budget_ms": int(timing_from_ctx.get("budget_ms", model_timing_ms.get("budget_ms", model_budget_ms)) or model_budget_ms),
                        "timed_out": bool(timing_from_ctx.get("timed_out", model_timing_ms.get("timed_out", False))),
                    }

                error_code = str(parallel_ctx.get("error_code") or str(exc) or "model_parallel_failed:unknown")
                python_context = parallel_ctx.get("python_context")
                normalized_python_context = _normalize_python_context_preview(
                    python_context
                    if python_context is not None
                    else {**_redacted_preview(str(exc)), "parse_stage": "model_parallel_failed"}
                )

                failure_stage_payload = {
                    "stage": "model_parallel_failed",
                    "error_code": error_code,
                    "model_timing_ms": model_timing_ms,
                    "model_context": parallel_ctx.get("model_context") if isinstance(parallel_ctx.get("model_context"), dict) else model_context,
                    "python_context": normalized_python_context,
                }
                yield {
                    "type": "STAGE",
                    "payload": failure_stage_payload,
                }

                if not isinstance(parallel_ctx.get("model_context"), dict):
                    parallel_ctx["model_context"] = dict(model_context)
                parallel_ctx["error_code"] = error_code
                parallel_ctx["model_timing_ms"] = dict(model_timing_ms)
                parallel_ctx["python_context"] = normalized_python_context
                exc.parallel_error_context = parallel_ctx
                raise
            finally:
                if _mp_executor is not None:
                    _mp_executor.shutdown(wait=False)
                    _mp_executor = None

        base_layer_anchor_bypass = _option_enabled(
            hints_options.get("baseLayerAnchorBypass"),
            default_value=False,
        )
        if (
            base_layer_anchor_bypass
            and hasattr(self.repository, "spatial_join_pois")
            and vlm_anchor_texts
        ):
            clip_wkt = _spatial_context_to_clip_wkt(spatial_context)
            if clip_wkt:
                per_hint_limit = _resolve_limit(
                    hints_options.get("baseLayerAnchorBypassPerHintLimit"),
                    default_value=80,
                    max_value=500,
                )
                scan_limit = _resolve_limit(
                    hints_options.get("baseLayerAnchorBypassScanLimit"),
                    default_value=300,
                    max_value=2000,
                )
                min_inject = _resolve_limit(
                    hints_options.get("baseLayerAnchorBypassMinInject"),
                    default_value=1,
                    max_value=200,
                )

                bypass_terms = vlm_anchor_texts[: max(1, min(len(vlm_anchor_texts), scan_limit))]
                anchor_bypass_requested_count = len(bypass_terms)
                bypass_candidates = self.repository.spatial_join_pois(
                    clip_wkt=clip_wkt,
                    categories=[],
                    terms=bypass_terms,
                    limit=per_hint_limit,
                )
                anchor_bypass_query_count = 1
                bypass_candidates = list(bypass_candidates or [])
                if bypass_candidates:
                    existing_keys = {_poi_identity_key(poi) for poi in pois}
                    injected: List[Dict[str, Any]] = []
                    for poi in bypass_candidates:
                        key = _poi_identity_key(poi)
                        if key in existing_keys:
                            continue
                        existing_keys.add(key)
                        injected.append(poi)
                    if len(injected) >= min_inject:
                        pois = list(pois) + injected
                        anchor_bypass_injected_count = len(injected)

        direction_applied = direction_hint is not None
        if direction_applied:
            pois = filter_pois_by_direction(
                pois,
                direction=direction_hint,
                anchor=anchor_hint,
                limit=fetch_limit,
            )
        query_filter_stats = {
            "semantic_terms_count": len(original_terms),
            "semantic_terms_applied_count": len(effective_terms),
            "term_filter_relaxed": term_filter_relaxed,
            "requested_confidence_model": requested_confidence_model or None,
            "requested_categories_count": len(requested_categories),
            "effective_fetch_categories_count": len(fetch_categories),
            "fetch_categories_relaxed_macro": fetch_categories_relaxed_macro,
            "anchor_boosted_poi_count": int(anchor_boosted_poi_count),
            "anchor_bypass_requested_count": int(anchor_bypass_requested_count),
            "anchor_bypass_query_count": int(anchor_bypass_query_count),
            "anchor_bypass_injected_count": int(anchor_bypass_injected_count),
            "allow_vlm_remote_failure": bool(allow_vlm_remote_failure),
            "vlm_failure_mode": vlm_failure_mode,
            "model_parallel_degraded": bool(model_parallel_degraded),
            "model_parallel_degrade_reason": model_parallel_degrade_reason or None,
        }

        road_boundary_enhancement = str(hints_options.get("roadBoundaryEnhancement", "true")).lower() not in {
            "false",
            "0",
            "off",
            "no",
        }
        road_fetch_limit = _resolve_limit(
            hints_options.get("roadMaxFetch"),
            default_value=12000,
            max_value=120000,
        )
        landuse_boundary_enhancement = str(hints_options.get("landuseBoundaryEnhancement", "true")).lower() not in {
            "false",
            "0",
            "off",
            "no",
        }
        landuse_fetch_limit = _resolve_limit(
            hints_options.get("landuseMaxFetch"),
            default_value=15000,
            max_value=150000,
        )

        road_bundle, landuse_bundle = _load_boundary_context_bundles_parallel(
            repository=self.repository,
            spatial_context=spatial_context,
            query_type=query_type,
            road_boundary_enhancement=road_boundary_enhancement,
            road_fetch_limit=road_fetch_limit,
            landuse_boundary_enhancement=landuse_boundary_enhancement,
            landuse_fetch_limit=landuse_fetch_limit,
        )
        road_rows: List[Dict[str, Any]] = list(road_bundle.get("rows") or [])
        road_geometries: List[Any] = list(road_bundle.get("geometries") or [])
        road_index: STRtree | None = road_bundle.get("index")
        road_source = str(road_bundle.get("source") or "disabled")

        landuse_rows: List[Dict[str, Any]] = list(landuse_bundle.get("rows") or [])
        landuse_geometries: List[Any] = list(landuse_bundle.get("geometries") or [])
        landuse_weights: List[float] = [
            _clamp01(float(value))
            for value in (landuse_bundle.get("weights") or [])
        ]
        landuse_semantic_features: List[Dict[str, Any]] = list(landuse_bundle.get("semantic_features") or [])
        landuse_index: STRtree | None = landuse_bundle.get("index")
        landuse_source = str(landuse_bundle.get("source") or "disabled")

        graph_summary = (
            run_with_timing(
                "graph_reasoning.py",
                analyze_spatial_graph,
                pois,
                max_nodes=graph_max_nodes,
                distance_threshold_m=graph_distance_threshold_m,
            )
            if need_graph_reasoning
            else None
        )

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "fetch_candidates",
                "progress": 0.25,
                "poi_count": len(pois),
                "candidate_source": candidate_source,
                "direction": direction_hint,
                "direction_applied": direction_applied,
                "graph_enabled": need_graph_reasoning,
                "graph_nodes": graph_summary.get("node_count", 0) if graph_summary else 0,
                "road_boundary_enhancement": road_boundary_enhancement,
                "road_feature_count": len(road_geometries),
                "road_source": road_source,
                "landuse_boundary_enhancement": landuse_boundary_enhancement,
                "landuse_feature_count": len(landuse_geometries),
                "landuse_source": landuse_source,
                "semantic_anchor_hint_count": len(semantic_anchor_hints),
            },
        }

        # 提前返回图推理
        # 提前返回以保证大规模候选下图分析响应速度。
        if query_type == "graph_reasoning":
            final_results = {
                "mode": "graph_reasoning",
                "pois": pois[:500],
                "boundary": None,
                "spatial_clusters": {"hotspots": []},
                "regions": [],
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": graph_summary or _empty_graph_summary(),
                "stats": {
                    **query_filter_stats,
                    "total_candidates": len(pois),
                    "cluster_count": 0,
                    "cluster_engine": "skipped_graph_only",
                    "noise_count": 0,
                    "h3_resolution": _dynamic_h3_resolution(_extract_area_km2(spatial_context)),
                    "h3_engine": "skipped_graph_only",
                    "h3_cell_count": 0,
                    "query_type": query_type,
                    "candidate_source": candidate_source,
                    "direction": direction_hint,
                    "direction_applied": direction_applied,
                    "boundary_method": "none",
                    "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                    "graph_edge_count": graph_summary.get("edge_count", 0) if graph_summary else 0,
                    "graph_max_nodes": graph_max_nodes,
                    "graph_distance_threshold_m": graph_distance_threshold_m,
                    "graph_fetch_limit": fetch_limit,
                    "road_boundary_enhancement": road_boundary_enhancement,
                    "road_feature_count": len(road_geometries),
                    "road_source": road_source,
                    "landuse_boundary_enhancement": landuse_boundary_enhancement,
                    "landuse_feature_count": len(landuse_geometries),
                    "landuse_source": landuse_source,
                    "operator_timings_ms": snapshot_operator_timings(),
                },
            }

            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": final_results,
                    "diagnostics": {
                        "engine": "python-spatial-pipeline",
                        "query_type": query_type,
                        "candidate_source": candidate_source,
                        "source_policy": source_policy if isinstance(source_policy, dict) else {},
                        "direction": direction_hint,
                        "direction_applied": direction_applied,
                        "graph_enabled": need_graph_reasoning,
                        "graph_fast_path": True,
                        "road_source": road_source,
                        "road_feature_count": len(road_geometries),
                        "landuse_source": landuse_source,
                        "landuse_feature_count": len(landuse_geometries),
                        "operator_timings_ms": snapshot_operator_timings(),
                    },
                },
            }
            return

        if query_type == "poi_fetch":
            final_results = {
                "mode": "poi_fetch",
                "pois": pois[:fetch_limit],
                "boundary": None,
                "spatial_clusters": {"hotspots": []},
                "regions": [],
                "vernacular_regions": [],
                "fuzzy_regions": [],
                "fuzzy_summary": {"core": 0, "transition": 0, "periphery": 0},
                "graph_reasoning": _empty_graph_summary(),
                "stats": {
                    **query_filter_stats,
                    "total_candidates": len(pois),
                    "query_type": query_type,
                    "candidate_source": candidate_source,
                    "direction": direction_hint,
                    "direction_applied": direction_applied,
                    "fetch_limit": fetch_limit,
                    "operator_timings_ms": snapshot_operator_timings(),
                },
            }

            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": final_results,
                    "diagnostics": {
                        "engine": "python-spatial-pipeline",
                        "query_type": query_type,
                        "fetch_limit": fetch_limit,
                        "candidate_source": candidate_source,
                        "source_policy": source_policy if isinstance(source_policy, dict) else {},
                        "operator_timings_ms": snapshot_operator_timings(),
                    },
                },
            }
            return
        # 过滤后无候选点，返回合法的空结果负载。
        if not pois:
            yield {
                "type": "FINAL",
                "payload": {
                    "success": True,
                    "results": {
                        "mode": "python-spatial",
                        "pois": [],
                        "boundary": None,
                        "spatial_clusters": {"hotspots": []},
                        "regions": [],
                        "vernacular_regions": [],
                        "fuzzy_regions": [],
                        "graph_reasoning": graph_summary or _empty_graph_summary(),
                        "stats": {
                            **query_filter_stats,
                            "total_candidates": 0,
                            "cluster_count": 0,
                            "cluster_engine": "none",
                            "noise_count": 0,
                            "h3_resolution": _dynamic_h3_resolution(_extract_area_km2(spatial_context)),
                            "h3_engine": "none",
                            "h3_cell_count": 0,
                            "candidate_source": candidate_source,
                            "direction": direction_hint,
                            "direction_applied": direction_applied,
                            "boundary_method": "none",
                            "boundary_methods": [],
                            "operator_timings_ms": snapshot_operator_timings(),
                        },
                    },
                },
            }
            return

        coords: List[Tuple[float, float]] = [
            (float(poi["lon"]), float(poi["lat"])) for poi in pois if poi.get("lon") is not None and poi.get("lat") is not None
        ]
        # 更新流式输出进度，防止长时间挂起导致前端超时
        if len(coords) >= 3:
            # 采样预览边界
            preview_coords = _sample_coordinates(coords, 3000)
            sketch_polygon = mapping(MultiPoint(preview_coords).convex_hull)
            yield {
                "type": "PARTIAL",
                "payload": {
                    "boundary": sketch_polygon,
                    "source": "convex_hull_preview",
                },
            }

        yield {
            "type": "STAGE",
            "payload": {"stage": "cluster"},
        }

        cluster_min_cluster_size = _resolve_limit(
            hints_options.get("clusterMinClusterSize"),
            default_value=12,
            max_value=300,
        )
        cluster_min_samples = _resolve_limit(
            hints_options.get("clusterMinSamples"),
            default_value=6,
            max_value=80,
        )
        cluster_max_hdbscan_points = _resolve_limit(
            hints_options.get("clusterMaxHdbscanPoints"),
            default_value=14000,
            max_value=120000,
        )
        cluster_adaptive = str(hints_options.get("clusterAdaptive", "true")).lower() not in {"false", "0", "off", "no"}
        cluster_preagg_enabled = _option_enabled(
            hints_options.get("clusterH3PreAggregate"),
            default_value=(query_type == "area_analysis"),
        )
        cluster_preagg_threshold = _resolve_limit(
            hints_options.get("clusterH3PreAggregateThreshold"),
            default_value=2500,
            max_value=200000,
        )
        cluster_preagg_resolution = _resolve_limit(
            hints_options.get("clusterH3Resolution"),
            default_value=_dynamic_h3_resolution(_extract_area_km2(spatial_context)),
            max_value=12,
        )
        cluster_preagg_summary: Dict[str, Any] = {
            "enabled": False,
            "requested": bool(cluster_preagg_enabled),
            "threshold": int(cluster_preagg_threshold),
            "resolution": int(cluster_preagg_resolution),
            "engine": "none",
            "cell_count": 0,
            "point_count": len(coords),
        }

        cluster_input_coords = list(coords)
        cluster_input_weights: List[float] | None = None
        cluster_input_members: List[List[int]] | None = None

        if cluster_preagg_enabled and len(coords) >= cluster_preagg_threshold:
            preagg_bundle = run_with_timing(
                "h3_preaggregate_cluster.py",
                preaggregate_coordinates_h3,
                coords,
                resolution=cluster_preagg_resolution,
            )
            preagg_points = list(preagg_bundle.get("points") or [])
            preagg_weights = [float(value) for value in (preagg_bundle.get("weights") or [])]
            preagg_members = [list(item or []) for item in (preagg_bundle.get("members") or [])]
            if len(preagg_points) >= 2 and len(preagg_points) < len(coords) and len(preagg_weights) == len(preagg_points):
                cluster_input_coords = preagg_points
                cluster_input_weights = preagg_weights
                cluster_input_members = preagg_members
                cluster_preagg_summary = {
                    "enabled": True,
                    "requested": True,
                    "threshold": int(cluster_preagg_threshold),
                    "resolution": int(preagg_bundle.get("resolution", cluster_preagg_resolution) or cluster_preagg_resolution),
                    "engine": str(preagg_bundle.get("engine") or "none"),
                    "cell_count": int(preagg_bundle.get("cell_count", len(preagg_points)) or len(preagg_points)),
                    "point_count": len(preagg_points),
                }

        cluster_result = run_with_timing(
            "hdbscan_cluster.py",
            cluster_points,
            cluster_input_coords,
            sample_weights=cluster_input_weights,
            min_cluster_size=cluster_min_cluster_size,
            min_samples=cluster_min_samples,
            adaptive=cluster_adaptive,
            max_hdbscan_points=cluster_max_hdbscan_points,
            core_dist_n_jobs=-1,
        )
        labels = cluster_result.labels
        if cluster_input_members is not None:
            mapped_labels = [-1 for _ in coords]
            for agg_idx, member_indexes in enumerate(cluster_input_members):
                label_value = -1
                if 0 <= agg_idx < len(labels):
                    try:
                        label_value = int(labels[agg_idx])
                    except Exception:
                        label_value = -1
                for original_idx in member_indexes:
                    if 0 <= int(original_idx) < len(mapped_labels):
                        mapped_labels[int(original_idx)] = label_value
            labels = mapped_labels
            unique_clusters = {label for label in labels if label >= 0}
            noise_count = len([label for label in labels if label < 0])
            cluster_result = ClusterResult(
                labels=labels,
                cluster_count=len(unique_clusters),
                noise_count=noise_count,
                engine=f"{cluster_result.engine}+h3_preagg",
                effective_min_cluster_size=cluster_result.effective_min_cluster_size,
                effective_min_samples=cluster_result.effective_min_samples,
                input_point_count=len(coords),
            )

        alpha_max_input_points = _resolve_limit(
            hints_options.get("alphaMaxInputPoints"),
            default_value=1200,
            max_value=5000,
        )

        grouped_indices: Dict[int, List[int]] = defaultdict(list)
        for idx, label in enumerate(labels):
            if label >= 0:
                grouped_indices[label].append(idx)
        single_cluster_fallback_applied = False
        allow_single_cluster_fallback = _option_enabled(
            hints_options.get("allowSingleClusterFallback"),
            default_value=(query_type == "area_analysis"),
        )
        if allow_single_cluster_fallback and not grouped_indices and len(coords) >= 8:
            labels = [0 for _ in coords]
            grouped_indices = defaultdict(list)
            grouped_indices[0] = list(range(len(coords)))
            cluster_result = ClusterResult(
                labels=labels,
                cluster_count=1,
                noise_count=0,
                engine=f"{cluster_result.engine}+single_fallback",
                effective_min_cluster_size=cluster_result.effective_min_cluster_size,
                effective_min_samples=cluster_result.effective_min_samples,
                input_point_count=cluster_result.input_point_count,
            )
            single_cluster_fallback_applied = True

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "cluster",
                "progress": 0.55,
                "cluster_count": cluster_result.cluster_count,
                "cluster_engine": cluster_result.engine,
                "noise_count": cluster_result.noise_count,
                "cluster_effective_min_cluster_size": cluster_result.effective_min_cluster_size,
                "cluster_effective_min_samples": cluster_result.effective_min_samples,
                "v5_enabled": force_composite_v5,
                "single_cluster_fallback_applied": single_cluster_fallback_applied,
            },
        }

        boundary_methods: List[str] = []
        cluster_entries: List[Dict[str, Any]] = []
        v5_in_memory_join_summary: Dict[str, Any] = {
            "used": False,
            "enriched_rows": 0,
            "block_matches": 0,
            "aoi_matches": 0,
            "landuse_matches": 0,
            "road_surface_count": 0,
            "aoi_surface_count": 0,
            "landuse_surface_count": 0,
        }

        # ──────────────────────────────────────────────────────────────────
        # Composite V5: 路网块级边界合并策略
        # 当启用 composite_v5 时，走全新的地块 union 边界生成链路，
        # 替代传统的 alpha-shape / 凸包边界。
        # ──────────────────────────────────────────────────────────────────
        if force_composite_v5 and hasattr(self.repository, "spatial_join_pois"):
            print("[PIPELINE_V5] composite_v5 pipeline enabled", flush=True, file=sys.stderr)

            # 构建 BBOX WKT 用于三层面查询
            v5_bbox_wkt = None
            if spatial_context.get("viewport"):
                vp = spatial_context["viewport"]
                if isinstance(vp, (list, tuple)) and len(vp) >= 4:
                    v5_bbox_wkt = (
                        f"POLYGON(({vp[0]} {vp[1]}, {vp[2]} {vp[1]}, "
                        f"{vp[2]} {vp[3]}, {vp[0]} {vp[3]}, {vp[0]} {vp[1]}))"
                    )
            if v5_bbox_wkt is None and spatial_context.get("boundary"):
                v5_bbox_wkt = POIRepository._boundary_wkt(spatial_context["boundary"])

            if v5_bbox_wkt:
                # 获取三层面数据
                v5_road_blocks, v5_osm_aoi, v5_euluc = _fetch_v5_surface_layers_parallel(
                    repository=self.repository,
                    bbox_wkt=v5_bbox_wkt,
                    road_limit=5000,
                    aoi_limit=3000,
                    euluc_limit=3000,
                )
                print(
                    f"[PIPELINE_V5] 三层面: blocks={len(v5_road_blocks)} aoi={len(v5_osm_aoi)} euluc={len(v5_euluc)}",
                    flush=True, file=sys.stderr,
                )

                v5_anchor_block_expand_enabled = _option_enabled(
                    hints_options.get("v5AnchorBlockExpand"),
                    default_value=True,
                )
                v5_water_semantic_mask_enabled = _option_enabled(
                    hints_options.get("waterSemanticMaskEnabled"),
                    default_value=True,
                )
                v5_anchor_seed_min_hits = _resolve_limit(
                    hints_options.get("v5AnchorSeedMinHits"),
                    default_value=2,
                    max_value=20,
                )
                try:
                    v5_anchor_seed_min_ratio = _clamp01(
                        float(hints_options.get("v5AnchorSeedMinRatio", 0.5))
                    )
                except (TypeError, ValueError):
                    v5_anchor_seed_min_ratio = 0.5
                try:
                    v5_anchor_expand_max_area_ratio = max(
                        1.0,
                        float(hints_options.get("v5AnchorExpandMaxAreaRatio", 1.8)),
                    )
                except (TypeError, ValueError):
                    v5_anchor_expand_max_area_ratio = 1.8
                try:
                    v5_anchor_expand_coverage_floor = _clamp01(
                        float(hints_options.get("v5AnchorExpandCoverageFloor", 0.92))
                    )
                except (TypeError, ValueError):
                    v5_anchor_expand_coverage_floor = 0.92

                v5_block_geom_map: Dict[int, Any] = {}
                for row in v5_road_blocks:
                    raw_block_id = row.get("block_id")
                    if raw_block_id is None:
                        continue
                    try:
                        block_id = int(raw_block_id)
                    except Exception:
                        continue
                    geom = _safe_shape_geojson(row.get("geometry_geojson"))
                    if geom is None:
                        continue
                    v5_block_geom_map[block_id] = geom
                water_mask_cache: Dict[str, Dict[str, Any] | None] = {}

                # V5 数据层走内存 STRtree 空间关联，避免二次 POI + LATERAL JOIN
                needs_v5_enrichment = any(
                    _is_missing_surface_value(poi.get("block_id"))
                    or _is_missing_surface_value(poi.get("aoi_name"))
                    or _is_missing_surface_value(poi.get("land_type"))
                    for poi in (pois or [])
                )
                if pois and needs_v5_enrichment:
                    pois, v5_in_memory_join_summary = _enrich_pois_with_surface_layers(
                        pois=pois,
                        road_blocks=v5_road_blocks,
                        osm_aoi_features=v5_osm_aoi,
                        euluc_features=v5_euluc,
                    )
                    v5_in_memory_join_summary["used"] = True

                # V5 主链阶段：执行空间交集
                v5_districts = block_assembler.assemble_block_boundaries(
                    cluster_labels=labels,
                    pois=pois,
                    road_blocks=v5_road_blocks,
                    osm_aoi_features=v5_osm_aoi,
                    euluc_features=v5_euluc,
                    vlm_anchor_texts=vlm_anchor_texts,
                )
                print(f"[PIPELINE_V5] generated {len(v5_districts)} districts", flush=True, file=sys.stderr)

                # 对 V5 链中的 cluster_entries 进行空间关系过滤
                for district in v5_districts:
                    d_pois = district.pois
                    d_coords = [(float(p["lon"]), float(p["lat"])) for p in d_pois if p.get("lon") and p.get("lat")]

                    categories_counter = _build_category_counter(d_pois)
                    top_category = categories_counter.most_common(1)[0][0] if categories_counter else "unclassified"
                    top_count = categories_counter.most_common(1)[0][1] if categories_counter else 0
                    poi_quality = _cluster_poi_quality(d_pois)

                    d_bbox_area_m2 = _calc_bbox_area(d_coords) if len(d_coords) >= 2 else 0.0
                    density = 0.0 if d_bbox_area_m2 <= 0 else min(1.0, (len(d_coords) / (d_bbox_area_m2 / 10_000.0 + 1e-6)) / 20.0)
                    purity = top_count / max(1, len(d_pois))
                    compactness = min(1.0, 1.0 / (1.0 + d_bbox_area_m2 / 200_000.0))
                    centrality = min(1.0, len(d_pois) / max(1.0, len(pois)))
                    scale = min(1.0, math.log1p(len(d_pois)) / math.log1p(max(2, len(pois))))

                    membership = compute_membership(
                        density=density, purity=purity, centrality=centrality,
                        compactness=compactness, scale=scale, niche_type="mixed",
                    )

                    boundary_geojson = district.boundary_geojson
                    boundary_method = district.boundary_method
                    effective_block_ids = list(district.block_ids)
                    boundary_geom = _safe_shape_geojson(boundary_geojson)

                    district_anchor_tokens = _normalize_anchor_list(
                        list(vlm_anchor_texts)
                        + [district.dominant_aoi_name or ""]
                        + [district.name.replace("片区", "") if district.name else ""]
                    )

                    if (
                        v5_water_semantic_mask_enabled
                        and district_anchor_tokens
                        and _is_ecology_context(
                            dominant_land_type=district.dominant_land_type,
                            dominant_aoi_type=district.dominant_aoi_type,
                            region_name=district.name,
                        )
                    ):
                        water_cache_key = "|".join(
                            sorted(
                                _normalize_anchor_text(token)
                                for token in district_anchor_tokens
                                if _normalize_anchor_text(token)
                            )
                        )
                        water_mask = water_mask_cache.get(water_cache_key)
                        if water_mask is None:
                            water_mask = _build_water_semantic_mask_geometry(
                                osm_aoi_features=v5_osm_aoi,
                                euluc_features=v5_euluc,
                                anchor_tokens=district_anchor_tokens,
                            )
                            water_mask_cache[water_cache_key] = water_mask
                        water_geojson = (water_mask or {}).get("geometry_geojson")
                        if isinstance(water_geojson, dict):
                            water_geom = _safe_shape_geojson(water_geojson)
                            if water_geom is not None:
                                boundary_geojson = water_geojson
                                boundary_geom = water_geom
                                boundary_method = "water_semantic_mask_v5"

                    if (
                        v5_anchor_block_expand_enabled
                        and boundary_method == "aoi_override_v5"
                        and boundary_geom is not None
                        and district_anchor_tokens
                        and v5_block_geom_map
                    ):
                        seed_block_ids = _collect_anchor_seed_block_ids(
                            cluster_pois=d_pois,
                            anchor_tokens=district_anchor_tokens,
                            min_hits=v5_anchor_seed_min_hits,
                            min_ratio=v5_anchor_seed_min_ratio,
                        )
                        expanded = _build_override_anchor_block_geometry(
                            block_geom_map=v5_block_geom_map,
                            override_geom=boundary_geom,
                            seed_block_ids=seed_block_ids,
                        )
                        expanded_geojson = (expanded or {}).get("geometry_geojson")
                        if isinstance(expanded_geojson, dict):
                            expanded_geom = _safe_shape_geojson(expanded_geojson)
                            if expanded_geom is not None:
                                base_area = max(float(boundary_geom.area or 0.0), 1e-12)
                                expanded_area = float(expanded_geom.area or 0.0)
                                area_ratio = expanded_area / base_area
                                base_coverage = _cluster_point_coverage_ratio(boundary_geom, d_coords)
                                expanded_coverage = _cluster_point_coverage_ratio(expanded_geom, d_coords)
                                if (
                                    area_ratio <= v5_anchor_expand_max_area_ratio
                                    and expanded_coverage + 1e-9 >= base_coverage * v5_anchor_expand_coverage_floor
                                ):
                                    boundary_geojson = expanded_geojson
                                    boundary_geom = expanded_geom
                                    effective_block_ids = list(
                                        expanded.get("selected_block_ids") or effective_block_ids
                                    )

                    region_name = district.name
                    if boundary_method == "water_semantic_mask_v5" and district_anchor_tokens:
                        preferred_anchor = ""
                        for token in district_anchor_tokens:
                            candidate = str(token or "").strip()
                            if not candidate:
                                continue
                            if any(keyword in candidate for keyword in ("公园", "湖", "湿地", "绿地", "滨水")):
                                preferred_anchor = candidate
                                break
                        if not preferred_anchor:
                            preferred_anchor = str(district_anchor_tokens[0]).strip()
                        if preferred_anchor:
                            region_name = f"{preferred_anchor}生态片区"

                    boundary_methods.append(boundary_method)
                    boundary_quality = {"quality_score": 0.85 if "road_block" in boundary_method else 0.65, "method": "v5_block"}

                    # V5 片区的置信度构建
                    # 计算 V5 置信度：调用 method_confidence 权重矩阵
                    layer_bundle = {"outer": {}, "transition": {"confidence": district.name_confidence}, "core": {}}
                    boundary_conf = _build_boundary_confidence(
                        layer_bundle=layer_bundle,
                        membership_score=float(membership.score),
                        boundary_method=boundary_method,
                        boundary_quality_score=boundary_quality.get("quality_score"),
                        poi_quality_score=poi_quality.get("score"),
                        semantic_anchor_confidence=district.name_confidence if district.name_source != "fallback" else None,
                        niche_consistency_score=None,
                    )
                    # 生成 V5 多级可视化边界层级
                    boundary_conf["explain"]["model"] = "composite_v5"

                    vitality_score = _calc_vitality_score(
                        density=density, membership_score=float(membership.score),
                        purity=purity, cluster_size=len(d_pois), total_size=len(pois),
                    )

                    dominant_categories = [
                        {"category": cat, "count": int(cnt)}
                        for cat, cnt in categories_counter.most_common(3)
                    ]
                    boundary_surface = _to_surface_polygon(boundary_geom, cluster_points=d_coords)
                    boundary_ring = _polygon_ring(boundary_surface)

                    cluster_entries.append({
                        "id": int(district.cluster_id),
                        "name": region_name,
                        "theme": top_category,
                        "poi_count": district.poi_count,
                        "center": {"lon": district.center[0], "lat": district.center[1]},
                        "boundary_geojson": boundary_geojson,
                        "boundary": boundary_ring,
                        "layers": {"outer": {}, "transition": {"confidence": district.name_confidence}, "core": {}},
                        "dominant_category": top_category,
                        "dominant_categories": dominant_categories,
                        "membership": asdict(membership),
                        "density": round(density, 4),
                        "purity": round(purity, 4),
                        "poi_quality": poi_quality,
                        "vitality_score": vitality_score,
                        "boundary_method": boundary_method,
                        "boundary_quality": boundary_quality,
                        "boundary_generation": {"method": boundary_method, "v5_block_ids": effective_block_ids[:20]},
                        "boundary_confidence": boundary_conf["score"],
                        "confidence_explain": boundary_conf["explain"],
                        "semantic_anchor": {
                            "name": district.dominant_aoi_name or region_name,
                            "confidence": district.name_confidence,
                            "source": district.name_source,
                        },
                        "niche_profile": {
                            "niche_type": district.dominant_land_type or "mixed",
                            "consistency": district.name_confidence,
                            "dominant_aoi_type": district.dominant_aoi_type,
                        },
                        "landuse_semantic": {"dominant_land_type": district.dominant_land_type},
                        "semantic_reasoning": {
                            "name_source": district.name_source,
                            "name_confidence": district.name_confidence,
                        },
                        "visual_morphology": None,
                        "score_breakdown": {
                            "density": membership.density,
                            "purity": membership.purity,
                            "centrality": membership.centrality,
                            "compactness": membership.compactness,
                            "scale": membership.scale,
                        },
                        "drivers": _top_membership_drivers(membership),
                        "cluster_pois": d_pois,
                    })
                    
                    # Store district for later use where cluster_id is accessed
                    grouped_indices[district.cluster_id] = [pois.index(p) for p in d_pois if p in pois]

        # ──────────────────────────────────────────────────────────────────
        # 传统 (V1-V4) 边界构建链路
        # ──────────────────────────────────────────────────────────────────
        if not cluster_entries:
            # 兼容旧版本 V1-V4 算子产生的冗余数据提取
            for cluster_id, indices in grouped_indices.items():
                cluster_points_list = [coords[idx] for idx in indices]
                cluster_pois = [pois[idx] for idx in indices]

                center_lon = sum(lon for lon, _ in cluster_points_list) / len(cluster_points_list)
                center_lat = sum(lat for _, lat in cluster_points_list) / len(cluster_points_list)

                categories_counter = _build_category_counter(cluster_pois)
                top_category, top_count = categories_counter.most_common(1)[0]
                poi_quality = _cluster_poi_quality(cluster_pois)
                semantic_anchor = _infer_semantic_anchor(
                    cluster_pois=cluster_pois,
                    dominant_category=top_category,
                    llm_anchor_candidates=semantic_anchor_hints,
                )

                bbox_area_m2 = _calc_bbox_area(cluster_points_list)
                density = 0.0 if bbox_area_m2 <= 0 else min(1.0, (len(cluster_points_list) / (bbox_area_m2 / 10_000.0 + 1e-6)) / 20.0)
                purity = top_count / max(1, len(cluster_points_list))
                compactness = min(1.0, 1.0 / (1.0 + bbox_area_m2 / 200_000.0))
                centrality = min(1.0, len(cluster_points_list) / max(1.0, len(pois)))
                scale = min(1.0, math.log1p(len(cluster_points_list)) / math.log1p(max(2, len(pois))))

                prelim_niche_name = f"{top_category} {semantic_anchor.get('name', '')}"
                prelim_niche, _, _ = semantic_reasoner.infer_niche_type_from_text(prelim_niche_name)

                membership = compute_membership(
                    density=density,
                    purity=purity,
                    centrality=centrality,
                    compactness=compactness,
                    scale=scale,
                    niche_type=prelim_niche or "mixed",
                )

                boundary_selection = run_with_timing(
                    "alpha_shape.py",
                    _build_cluster_boundary,
                    cluster_points=cluster_points_list,
                    bbox_area_m2=bbox_area_m2,
                    density=density,
                    alpha_max_input_points=alpha_max_input_points,
                    road_index=road_index,
                    road_geometries=road_geometries,
                    landuse_index=landuse_index,
                    landuse_geometries=landuse_geometries,
                    landuse_weights=landuse_weights,
                )
                boundary_geojson = boundary_selection["boundary_geojson"]
                boundary_method = boundary_selection["boundary_method"]
                boundary_quality = boundary_selection["boundary_quality"]
                boundary_generation = boundary_selection["boundary_generation"]

                clip_result = _clip_boundary_geojson_to_constraint(
                    boundary_geojson=boundary_geojson,
                    cluster_points=cluster_points_list,
                    constraint_polygon=spatial_constraint_polygon,
                )
                boundary_geojson = clip_result["boundary_geojson"]
                clip_meta = clip_result.get("clip") or {"applied": False}
                boundary_generation = dict(boundary_generation or {})
                boundary_generation["constraint_clip"] = clip_meta
                if clip_meta.get("applied"):
                    clipped_road_alignment = _compute_road_alignment_score(
                        boundary_geojson=boundary_geojson,
                        cluster_points=cluster_points_list,
                        road_index=road_index,
                        road_geometries=road_geometries,
                    )
                    clipped_landuse_alignment = _compute_landuse_alignment_score(
                        boundary_geojson=boundary_geojson,
                        cluster_points=cluster_points_list,
                        landuse_index=landuse_index,
                        landuse_geometries=landuse_geometries,
                        landuse_weights=landuse_weights,
                    )
                    boundary_quality = _score_boundary_quality(
                        cluster_points=cluster_points_list,
                        boundary_geojson=boundary_geojson,
                        road_alignment_score=clipped_road_alignment,
                        landuse_alignment_score=clipped_landuse_alignment,
                    )
                    boundary_method = f"{boundary_method}_clip_v1"

                boundary_methods.append(boundary_method)
                landuse_semantic_context = _cluster_landuse_semantic_context(
                    boundary_geojson=boundary_geojson,
                    cluster_points=cluster_points_list,
                    semantic_features=landuse_semantic_features,
                )
                semantic_anchor = _recover_waterbody_anchor(
                    cluster_pois=cluster_pois,
                    semantic_anchor=semantic_anchor,
                    landuse_context=landuse_semantic_context,
                )
                niche_profile = _build_niche_profile(
                    cluster_pois=cluster_pois,
                    dominant_category=top_category,
                    semantic_anchor=semantic_anchor,
                    landuse_context=landuse_semantic_context,
                )
                boundary_quality = _apply_water_overlap_penalty(
                    boundary_quality=boundary_quality,
                    niche_profile=niche_profile,
                    landuse_context=landuse_semantic_context,
                )
                semantic_reasoning = _build_semantic_reasoning_payload(
                    semantic_anchor=semantic_anchor,
                    niche_profile=niche_profile,
                    landuse_context=landuse_semantic_context,
                )
                cluster_display_name = (
                    f"{semantic_anchor.get('name')}\u7247\u533a"
                    if str(semantic_anchor.get("name") or "").strip()
                    else f"{top_category}\u7247\u533a"
                )
                semantic_anchor_conf_for_conf = (
                    semantic_anchor.get("confidence")
                    if str(semantic_anchor.get("name") or "").strip()
                    else None
                )
                niche_consistency_for_conf = (
                    niche_profile.get("consistency")
                    if semantic_anchor_conf_for_conf is not None
                    and str(niche_profile.get("niche_type") or "") != "mixed"
                    else None
                )

                layer_bundle = _build_region_layers(
                    cluster_points=cluster_points_list,
                    base_boundary_geojson=boundary_geojson,
                    density=density,
                    membership_score=float(membership.score),
                    constraint_polygon=spatial_constraint_polygon,
                )
                visual_review = None
                if visual_review_enabled:
                    visual_review = _review_cluster_morphology(
                        spatial_context=spatial_context,
                        boundary_geojson=layer_bundle["representative_geojson"] or boundary_geojson,
                        boundary_quality=boundary_quality,
                        poi_count=len(cluster_points_list),
                        model_name=visual_model_name,
                        endpoint=visual_endpoint,
                        image_data_url=visual_image_data_url,
                        enable_remote=visual_remote_enabled,
                        timeout_ms=visual_timeout_ms,
                    )
                visual_morphology_conf_for_conf = (
                    visual_review.get("score") if isinstance(visual_review, dict) else None
                )
                boundary_conf = _build_boundary_confidence(
                    layer_bundle=layer_bundle,
                    membership_score=float(membership.score),
                    boundary_method=boundary_method,
                    boundary_quality_score=boundary_quality.get("quality_score"),
                    poi_quality_score=poi_quality.get("score"),
                    semantic_anchor_confidence=semantic_anchor_conf_for_conf,
                    niche_consistency_score=niche_consistency_for_conf,
                    visual_morphology_confidence=visual_morphology_conf_for_conf,
                )

                vitality_score = _calc_vitality_score(
                    density=density,
                    membership_score=float(membership.score),
                    purity=purity,
                    cluster_size=len(cluster_points_list),
                    total_size=len(pois),
                )

                dominant_categories = [
                    {"category": category, "count": int(count)}
                    for category, count in categories_counter.most_common(3)
                ]

                cluster_entries.append(
                    {
                        "id": int(cluster_id),
                        "name": cluster_display_name,
                        "theme": top_category,
                        "poi_count": len(cluster_points_list),
                        "center": {"lon": center_lon, "lat": center_lat},
                        "boundary_geojson": layer_bundle["representative_geojson"] or boundary_geojson,
                        "boundary": layer_bundle["representative_boundary"],
                        "layers": {
                            "outer": layer_bundle["outer"],
                            "transition": layer_bundle["transition"],
                            "core": layer_bundle["core"],
                        },
                        "dominant_category": top_category,
                        "dominant_categories": dominant_categories,
                        "membership": asdict(membership),
                        "density": round(density, 4),
                        "purity": round(purity, 4),
                        "poi_quality": poi_quality,
                        "vitality_score": vitality_score,
                        "boundary_method": boundary_method,
                        "boundary_quality": boundary_quality,
                        "boundary_generation": boundary_generation,
                        "boundary_confidence": boundary_conf["score"],
                        "confidence_explain": boundary_conf["explain"],
                        "semantic_anchor": semantic_anchor,
                        "niche_profile": niche_profile,
                        "landuse_semantic": landuse_semantic_context,
                        "semantic_reasoning": semantic_reasoning,
                        "visual_morphology": visual_review,
                        "score_breakdown": {
                            "density": membership.density,
                            "purity": membership.purity,
                            "centrality": membership.centrality,
                            "compactness": membership.compactness,
                            "scale": membership.scale,
                        },
                        "drivers": _top_membership_drivers(membership),
                        "cluster_pois": cluster_pois,
                    }
                )

        v5_region_dedup_summary: Dict[str, Any] = {
            "enabled": bool(v5_region_dedup_enabled),
            "iou_threshold": round(float(v5_region_dedup_iou_threshold), 4),
            "containment_threshold": round(float(v5_region_dedup_containment_threshold), 4),
            "before_count": len(cluster_entries),
            "after_count": len(cluster_entries),
            "removed_count": 0,
            "removed_examples": [],
        }
        if v5_region_dedup_enabled and cluster_entries:
            cluster_entries, v5_region_dedup_summary = _deduplicate_cluster_entries(
                cluster_entries,
                iou_threshold=v5_region_dedup_iou_threshold,
                containment_threshold=v5_region_dedup_containment_threshold,
            )
            boundary_methods = [str(item.get("boundary_method") or "") for item in cluster_entries]
            if int(v5_region_dedup_summary.get("removed_count", 0)) > 0:
                print(
                    "[PIPELINE_V5] boundary dedup removed "
                    f"{v5_region_dedup_summary.get('removed_count')} / "
                    f"{v5_region_dedup_summary.get('before_count')} regions",
                    flush=True,
                    file=sys.stderr,
                )

        name_audit_summary = {
            "rule_rewritten": 0,
            "llm_rewritten": 0,
            "duplicate_rewritten": 0,
            "llm_attempted": False,
        }
        if name_audit_enabled and cluster_entries:
            name_audit_summary = _govern_region_names(
                cluster_entries=cluster_entries,
                remote_enabled=name_audit_remote_enabled,
                model_name=name_audit_model_name,
                endpoint=visual_endpoint,
                timeout_ms=name_audit_timeout_ms,
                remote_max_items=name_audit_max_items,
            )
            print(
                "[PIPELINE_V5] 命名审核完成: "
                f"规则重写={name_audit_summary.get('rule_rewritten', 0)} "
                f"LLM重写={name_audit_summary.get('llm_rewritten', 0)} "
                f"重名修正={name_audit_summary.get('duplicate_rewritten', 0)} "
                f"LLM尝试={name_audit_summary.get('llm_attempted', False)}",
                flush=True,
                file=sys.stderr,
            )

        if visual_review_enabled and cluster_entries:
            yield {
                "type": "STAGE",
                "payload": {
                    "stage": "visual_perception",
                },
            }
            # 筛选需要 VLM 审阅的 entry（跳过已有结果或空 POI 的）
            _vp_pending: list[tuple[int, dict]] = []
            for _vp_idx, entry in enumerate(cluster_entries):
                existing_visual = entry.get("visual_morphology")
                if isinstance(existing_visual, dict) and existing_visual.get("score") is not None:
                    continue
                poi_count = int(entry.get("poi_count", 0))
                if poi_count <= 0:
                    continue
                _vp_pending.append((_vp_idx, entry))

            if _vp_pending:
                # 并行调用 VLM：每个 cluster 的审阅是独立 HTTP I/O，无共享状态
                def _vp_task(vp_entry: dict) -> dict:
                    return _review_cluster_morphology(
                        spatial_context=spatial_context,
                        boundary_geojson=vp_entry.get("boundary_geojson"),
                        boundary_quality=vp_entry.get("boundary_quality"),
                        poi_count=int(vp_entry.get("poi_count", 0)),
                        model_name=visual_model_name,
                        endpoint=visual_endpoint,
                        image_data_url=visual_image_data_url,
                        enable_remote=visual_remote_enabled,
                        timeout_ms=visual_timeout_ms,
                    )

                _vp_max_workers = min(len(_vp_pending), 4)
                with ThreadPoolExecutor(max_workers=_vp_max_workers) as _vp_pool:
                    _vp_futures = [
                        (_vp_idx, _vp_pool.submit(_vp_task, entry))
                        for _vp_idx, entry in _vp_pending
                    ]
                    for _vp_idx, fut in _vp_futures:
                        try:
                            visual_review = fut.result(timeout=max(15, visual_timeout_ms / 1000 + 5))
                        except Exception:
                            visual_review = {"score": None, "error": "visual_review_timeout"}
                        cluster_entries[_vp_idx]["visual_morphology"] = visual_review

        self_validation_result = {
            "cluster_scores": {},
            "cluster_reports": [],
            "summary": {
                "model": "self_validation_v1",
                "avg_score": 0.0,
                "min_score": 0.0,
                "max_score": 0.0,
                "low_score_count": 0,
                "issue_counts": {},
            },
        }
        if self_validation_enabled:
            self_validation_result = _validate_cluster_entries(cluster_entries)

        skg_result = {
            "cluster_scores": {},
            "cluster_reports": [],
            "graph": {
                "model": "skg_consistency_v1",
                "node_count": 0,
                "edge_count": 0,
                "cluster_count": 0,
                "token_profile": "low_token_summary_v1",
            },
            "summary": {
                "avg_score": 0.0,
                "min_score": 0.0,
                "max_score": 0.0,
            },
        }
        if skg_enabled:
            skg_result = _build_spatial_knowledge_graph(cluster_entries)

        self_report_by_id = {
            int(report.get("id", 0)): report
            for report in (self_validation_result.get("cluster_reports") or [])
        }
        skg_report_by_id = {
            int(report.get("id", 0)): report
            for report in (skg_result.get("cluster_reports") or [])
        }

        # Composite V5: fuse visual / self-validation / SKG signals into one confidence model.
        if visual_review_enabled or self_validation_enabled or skg_enabled:
            yield {
                "type": "STAGE",
                "payload": {
                    "stage": "fusion_validation",
                },
            }
            for entry in cluster_entries:
                cluster_id = int(entry.get("id", 0))
                semantic_anchor = entry.get("semantic_anchor") or {}
                niche_profile = entry.get("niche_profile") or {}
                semantic_anchor_name = str(semantic_anchor.get("name") or "").strip()
                semantic_anchor_conf = semantic_anchor.get("confidence") if semantic_anchor_name else None
                niche_consistency = (
                    niche_profile.get("consistency")
                    if semantic_anchor_conf is not None
                    and str(niche_profile.get("niche_type") or "") != "mixed"
                    else None
                )

                layers = entry.get("layers") or {}
                layer_bundle = {
                    "outer": layers.get("outer") or {},
                    "transition": layers.get("transition") or {},
                    "core": layers.get("core") or {},
                }

                visual_conf = (
                    (entry.get("visual_morphology") or {}).get("score")
                    if visual_review_enabled
                    else None
                )
                self_conf = (
                    (self_validation_result.get("cluster_scores") or {}).get(cluster_id)
                    if self_validation_enabled
                    else None
                )
                skg_conf = (
                    (skg_result.get("cluster_scores") or {}).get(cluster_id)
                    if skg_enabled
                    else None
                )

                rescored = _build_boundary_confidence(
                    layer_bundle=layer_bundle,
                    membership_score=float((entry.get("membership") or {}).get("score", 0.0)),
                    boundary_method=str(entry.get("boundary_method") or ""),
                    boundary_quality_score=(entry.get("boundary_quality") or {}).get("quality_score"),
                    poi_quality_score=(entry.get("poi_quality") or {}).get("score"),
                    semantic_anchor_confidence=semantic_anchor_conf,
                    niche_consistency_score=niche_consistency,
                    visual_morphology_confidence=visual_conf,
                    self_validation_confidence=self_conf,
                    skg_consistency_score=skg_conf,
                )
                entry["boundary_confidence"] = rescored["score"]
                entry["confidence_explain"] = rescored["explain"]
                if self_conf is not None:
                    entry["self_validation"] = self_report_by_id.get(cluster_id)
                if skg_conf is not None:
                    entry["skg_consistency"] = skg_report_by_id.get(cluster_id)

        cluster_entries.sort(key=lambda item: float(item.get("vitality_score", 0.0)), reverse=True)
        region_views = _build_region_views(cluster_entries=cluster_entries)
        regions = region_views["regions"]
        vernacular_regions = region_views["vernacular_regions"]
        fuzzy_regions = region_views["fuzzy_regions"]
        hotspots = region_views["hotspots"]
        region_output_limit = _resolve_region_output_limit(
            hints_options=hints_options,
            query_type=query_type,
        )
        hotspot_output_limit = max(5, min(50, region_output_limit))

        noise_pois = [
            pois[idx]
            for idx, label in enumerate(labels)
            if label < 0 and idx < len(pois)
        ]

        representative_pois = _build_representative_pois(
            cluster_entries=cluster_entries,
            fallback_pois=noise_pois or pois,
            max_count=min(500, len(pois)),
        )
        area_km2 = _extract_area_km2(spatial_context)
        h3_resolution = _dynamic_h3_resolution(area_km2)
        h3_summary = run_with_timing(
            "h3_aggregate.py",
            aggregate_pois_h3,
            pois,
            resolution=h3_resolution,
            max_cells=120 if query_type == "area_analysis" else 60,
        )

        yield {
            "type": "PROGRESS",
            "payload": {
                "stage": "region_modeling",
                "progress": 0.85,
                "vernacular_count": len(vernacular_regions),
            },
        }

        cluster_summary = _summarize_cluster_entries(
            cluster_entries=cluster_entries,
            fuzzy_regions=fuzzy_regions,
        )
        fuzzy_summary = cluster_summary["fuzzy_summary"]
        visual_scores = [
            float((entry.get("visual_morphology") or {}).get("score"))
            for entry in cluster_entries
            if (entry.get("visual_morphology") or {}).get("score") is not None
        ]
        avg_visual_morphology_confidence = (
            round(sum(visual_scores) / len(visual_scores), 4) if visual_scores else 0.0
        )
        visual_modes = sorted(
            {
                str((entry.get("visual_morphology") or {}).get("mode"))
                for entry in cluster_entries
                if (entry.get("visual_morphology") or {}).get("mode")
            }
        )

        self_validation_summary = (self_validation_result.get("summary") or {}).copy()
        skg_summary = (skg_result.get("summary") or {}).copy()
        skg_graph = (skg_result.get("graph") or {}).copy()

        vlm_extracted_texts = _normalize_anchor_list(
            list(vlm_anchor_texts) + list(vlm_anchor_landmarks) + list(vlm_anchor_aliases)
        )
        if visual_image_data_url:
            screenshot_texts = vlm_reviewer.extract_map_text(
                image_data_url=visual_image_data_url,
                model_name=ocr_model_name,
                endpoint=visual_endpoint,
                timeout_ms=visual_timeout_ms,
            )
            vlm_extracted_texts = _normalize_anchor_list(vlm_extracted_texts + (screenshot_texts or []))

        final_results = {
            "mode": "python-spatial",
            "pois": representative_pois,
            "boundary": vernacular_regions[0]["boundary"] if vernacular_regions else None,
            "spatial_clusters": {
                "hotspots": hotspots[:hotspot_output_limit],
                "h3_summary": h3_summary.get("cells", [])[:20],
            },
            "regions": regions[:region_output_limit],
            "vernacular_regions": vernacular_regions[:region_output_limit],
            "fuzzy_regions": fuzzy_regions[:region_output_limit],
            "fuzzy_summary": fuzzy_summary,
            "graph_reasoning": graph_summary or _empty_graph_summary(),
            "self_validation": self_validation_summary,
            "spatial_knowledge_graph": {
                **skg_graph,
                "summary": skg_summary,
            },
            "stats": {
                **query_filter_stats,
                "total_candidates": len(pois),
                "cluster_count": len(vernacular_regions),
                "cluster_engine": cluster_result.engine,
                "noise_count": cluster_result.noise_count,
                "cluster_effective_min_cluster_size": cluster_result.effective_min_cluster_size,
                "cluster_effective_min_samples": cluster_result.effective_min_samples,
                "cluster_input_point_count": cluster_result.input_point_count,
                "single_cluster_fallback_applied": single_cluster_fallback_applied,
                "cluster_preagg_enabled": bool(cluster_preagg_summary.get("enabled")),
                "cluster_preagg_requested": bool(cluster_preagg_summary.get("requested")),
                "cluster_preagg_threshold": int(cluster_preagg_summary.get("threshold", 0)),
                "cluster_preagg_resolution": int(cluster_preagg_summary.get("resolution", 0)),
                "cluster_preagg_engine": cluster_preagg_summary.get("engine"),
                "cluster_preagg_cell_count": int(cluster_preagg_summary.get("cell_count", 0)),
                "cluster_preagg_point_count": int(cluster_preagg_summary.get("point_count", len(coords))),
                "h3_resolution": h3_resolution,
                "h3_engine": h3_summary.get("engine", "none"),
                "h3_cell_count": len(h3_summary.get("cells", [])),
                "query_type": query_type,
                "candidate_source": candidate_source,
                "direction": direction_hint,
                "direction_applied": direction_applied,
                "boundary_method": boundary_methods[0] if len(set(boundary_methods)) == 1 and boundary_methods else "mixed",
                "boundary_confidence_model": cluster_summary["boundary_conf_model"],
                "avg_boundary_confidence": cluster_summary["avg_boundary_confidence"],
                "min_boundary_confidence": cluster_summary["min_boundary_confidence"],
                "max_boundary_confidence": cluster_summary["max_boundary_confidence"],
                "avg_poi_quality_score": cluster_summary["avg_poi_quality_score"],
                "boundary_quality_model": cluster_summary["boundary_quality_model"],
                "avg_boundary_quality_score": cluster_summary["avg_boundary_quality_score"],
                "avg_boundary_coverage": cluster_summary["avg_boundary_coverage"],
                "avg_landuse_alignment_score": cluster_summary["avg_landuse_alignment_score"],
                "avg_water_overlap_ratio": cluster_summary["avg_water_overlap_ratio"],
                "avg_water_penalty": cluster_summary["avg_water_penalty"],
                "semantic_anchor_model": "rule_hint_v1",
                "avg_semantic_anchor_confidence": cluster_summary["avg_semantic_anchor_confidence"],
                "semantic_anchor_coverage": cluster_summary["semantic_anchor_coverage"],
                "niche_type_counts": cluster_summary["niche_type_counts"],
                "dominant_niche_type": cluster_summary["dominant_niche_type"],
                "avg_visual_morphology_confidence": avg_visual_morphology_confidence,
                "visual_review_mode": visual_modes[0] if len(visual_modes) == 1 else ("mixed" if visual_modes else "disabled"),
                "visual_review_modes": visual_modes,
                "visual_review_model": visual_model_name if visual_review_enabled else None,
                "ocr_enabled": bool(visual_image_data_url),
                "ocr_model": ocr_model_name if visual_image_data_url else None,
                "overview_enabled": bool(overview_enabled and visual_image_data_url),
                "overview_model": overview_model_name if (overview_enabled and visual_image_data_url) else None,
                "overview_medium_enabled": bool(overview_enabled and overview_medium_enabled and visual_image_data_url),
                "overview_medium_model": (
                    visual_model_name if (overview_enabled and overview_medium_enabled and visual_image_data_url) else None
                ),
                "overview_light_summary": vlm_overview_light.get("summary") or None,
                "overview_medium_summary": vlm_overview_medium.get("summary") or None,
                "overview_fused_summary": vlm_overview_fused_summary or None,
                "overview_light_confidence": float(vlm_overview_light.get("confidence") or 0.0),
                "overview_medium_confidence": float(vlm_overview_medium.get("confidence") or 0.0),
                "avg_self_validation_confidence": float(self_validation_summary.get("avg_score", 0.0)),
                "self_validation_model": self_validation_summary.get("model"),
                "avg_skg_consistency_score": float(skg_summary.get("avg_score", 0.0)),
                "skg_model": skg_graph.get("model"),
                "skg_node_count": int(skg_graph.get("node_count", 0)),
                "skg_edge_count": int(skg_graph.get("edge_count", 0)),
                "boundary_quality_pass_rate": cluster_summary["boundary_quality_pass_rate"],
                "avg_boundary_iterations": cluster_summary["avg_boundary_iterations"],
                "alpha_max_input_points": alpha_max_input_points,
                "road_boundary_enhancement": road_boundary_enhancement,
                "road_feature_count": len(road_geometries),
                "road_source": road_source,
                "landuse_boundary_enhancement": landuse_boundary_enhancement,
                "landuse_feature_count": len(landuse_geometries),
                "landuse_source": landuse_source,
                "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                "graph_edge_count": graph_summary.get("edge_count", 0) if graph_summary else 0,
                "fuzzy_core_count": fuzzy_summary["core"],
                "fuzzy_transition_count": fuzzy_summary["transition"],
                "fuzzy_periphery_count": fuzzy_summary["periphery"],
                "region_output_limit": int(region_output_limit),
                "v5_region_dedup_enabled": bool(v5_region_dedup_summary.get("enabled")),
                "v5_region_dedup_iou_threshold": float(v5_region_dedup_summary.get("iou_threshold", 0.0)),
                "v5_region_dedup_containment_threshold": float(
                    v5_region_dedup_summary.get("containment_threshold", 0.0)
                ),
                "v5_region_dedup_before_count": int(v5_region_dedup_summary.get("before_count", len(cluster_entries))),
                "v5_region_dedup_after_count": int(v5_region_dedup_summary.get("after_count", len(cluster_entries))),
                "v5_region_dedup_removed_count": int(v5_region_dedup_summary.get("removed_count", 0)),
                "v5_in_memory_join_used": bool(v5_in_memory_join_summary.get("used")),
                "v5_in_memory_join_enriched_rows": int(v5_in_memory_join_summary.get("enriched_rows", 0)),
                "v5_in_memory_join_block_matches": int(v5_in_memory_join_summary.get("block_matches", 0)),
                "v5_in_memory_join_aoi_matches": int(v5_in_memory_join_summary.get("aoi_matches", 0)),
                "v5_in_memory_join_landuse_matches": int(v5_in_memory_join_summary.get("landuse_matches", 0)),
                "v5_in_memory_join_road_surface_count": int(v5_in_memory_join_summary.get("road_surface_count", 0)),
                "v5_in_memory_join_aoi_surface_count": int(v5_in_memory_join_summary.get("aoi_surface_count", 0)),
                "v5_in_memory_join_landuse_surface_count": int(v5_in_memory_join_summary.get("landuse_surface_count", 0)),
                "name_audit_enabled": bool(name_audit_enabled),
                "name_audit_remote_enabled": bool(name_audit_remote_enabled),
                "name_audit_model": name_audit_model_name if name_audit_remote_enabled else "rule_guard_v2",
                "name_audit_max_items": int(name_audit_max_items),
                "name_audit_rule_rewritten": int(name_audit_summary.get("rule_rewritten", 0)),
                "name_audit_llm_rewritten": int(name_audit_summary.get("llm_rewritten", 0)),
                "name_audit_duplicate_rewritten": int(name_audit_summary.get("duplicate_rewritten", 0)),
                "name_audit_llm_attempted": bool(name_audit_summary.get("llm_attempted", False)),
                "name_audit_remote_input_count": int(name_audit_summary.get("remote_input_count", 0)),
                "name_audit_remote_sent_count": int(name_audit_summary.get("remote_sent_count", 0)),
                "vlm_extracted_texts": vlm_extracted_texts,
                "vlm_anchor_landmarks": vlm_anchor_landmarks,
                "vlm_anchor_aliases": vlm_anchor_aliases,
                "vlm_overview_light": vlm_overview_light,
                "vlm_overview_medium": vlm_overview_medium,
                "llm_spatial_priors": llm_spatial_priors,
                "anchor_boosted_poi_count": int(anchor_boosted_poi_count),
                "anchor_injected_poi_count": int(anchor_bypass_injected_count),
                "model_parallel_degraded": bool(model_parallel_degraded),
                "model_parallel_degrade_reason": model_parallel_degrade_reason or None,
                "vlm_failure_mode": vlm_failure_mode,
                "allow_vlm_remote_failure": bool(allow_vlm_remote_failure),
                "model_timing_ms": model_timing_ms,
                "reasoning_enabled": bool(reasoning_enabled),
                "reasoning_model": reasoning_model_name if reasoning_enabled else None,
                "dsl_context_binding_present": bool(dsl_context_binding_present),
                "context_binding_degraded": bool(context_binding_degraded),
                "revision_mode": revision_mode,
                "dsl_revision_base_trace_id": dsl_revision.get("base_trace_id"),
                "dsl_patch_ops_count": int(len(dsl_patch_ops)),
                "dsl_streaming_allow_prefetch": bool(streaming_allow_prefetch),
                "dsl_streaming_prefetch_on_fields": streaming_prefetch_on_fields,
                "operator_timings_ms": snapshot_operator_timings(),
            },
        }

        yield {
            "type": "FINAL",
            "payload": {
                "success": True,
                "results": final_results,
                "diagnostics": {
                    "engine": "python-spatial-pipeline",
                    "query_type": query_type,
                    "h3_engine": h3_summary.get("engine", "none"),
                    "input_area_km2": round(area_km2, 3),
                    "candidate_source": candidate_source,
                    "source_policy": source_policy if isinstance(source_policy, dict) else {},
                    "direction": direction_hint,
                    "direction_applied": direction_applied,
                    "boundary_methods": boundary_methods,
                    "road_source": road_source,
                    "road_feature_count": len(road_geometries),
                    "landuse_source": landuse_source,
                    "landuse_feature_count": len(landuse_geometries),
                    "semantic_anchor_model": "rule_hint_v1",
                    "semantic_anchor_hint_count": len(semantic_anchor_hints),
                    "confidence_model": cluster_summary["boundary_conf_model"],
                    "requested_confidence_model": requested_confidence_model or None,
                    "name_audit": {
                        "enabled": bool(name_audit_enabled),
                        "remote_enabled": bool(name_audit_remote_enabled),
                        "model": name_audit_model_name if name_audit_remote_enabled else "rule_guard_v2",
                        "max_items": int(name_audit_max_items),
                        "rule_rewritten": int(name_audit_summary.get("rule_rewritten", 0)),
                        "llm_rewritten": int(name_audit_summary.get("llm_rewritten", 0)),
                        "duplicate_rewritten": int(name_audit_summary.get("duplicate_rewritten", 0)),
                        "llm_attempted": bool(name_audit_summary.get("llm_attempted", False)),
                        "remote_input_count": int(name_audit_summary.get("remote_input_count", 0)),
                        "remote_sent_count": int(name_audit_summary.get("remote_sent_count", 0)),
                    },
                    "v5_region_dedup": {
                        "enabled": bool(v5_region_dedup_summary.get("enabled")),
                        "iou_threshold": float(v5_region_dedup_summary.get("iou_threshold", 0.0)),
                        "containment_threshold": float(v5_region_dedup_summary.get("containment_threshold", 0.0)),
                        "before_count": int(v5_region_dedup_summary.get("before_count", len(cluster_entries))),
                        "after_count": int(v5_region_dedup_summary.get("after_count", len(cluster_entries))),
                        "removed_count": int(v5_region_dedup_summary.get("removed_count", 0)),
                        "removed_examples": list(v5_region_dedup_summary.get("removed_examples") or []),
                    },
                    "visual_review_enabled": visual_review_enabled,
                    "visual_remote_enabled": visual_remote_enabled,
                    "visual_review_model": visual_model_name if visual_review_enabled else None,
                    "ocr_enabled": bool(visual_image_data_url),
                    "ocr_model": ocr_model_name if visual_image_data_url else None,
                    "overview_enabled": bool(overview_enabled and visual_image_data_url),
                    "overview_model": overview_model_name if (overview_enabled and visual_image_data_url) else None,
                    "overview_medium_enabled": bool(overview_enabled and overview_medium_enabled and visual_image_data_url),
                    "overview_medium_model": (
                        visual_model_name if (overview_enabled and overview_medium_enabled and visual_image_data_url) else None
                    ),
                    "overview_light_summary": vlm_overview_light.get("summary") or None,
                    "overview_medium_summary": vlm_overview_medium.get("summary") or None,
                    "overview_fused_summary": vlm_overview_fused_summary or None,
                    "reasoning_enabled": bool(reasoning_enabled),
                    "reasoning_model": reasoning_model_name if reasoning_enabled else None,
                    "model_budget_ms": int(model_budget_ms),
                    "model_timing_ms": model_timing_ms,
                    "revision_mode": revision_mode,
                    "context_binding_degraded": bool(context_binding_degraded),
                    "streaming_allow_prefetch": bool(streaming_allow_prefetch),
                    "streaming_prefetch_on_fields": streaming_prefetch_on_fields,
                    "dsl_meta": {
                        "context_binding": dsl_context_binding,
                        "revision": {
                            **dsl_revision,
                            "mode": revision_mode,
                        },
                        "streaming_hints": {
                            **dsl_streaming_hints,
                            "allow_prefetch": bool(streaming_allow_prefetch),
                            "prefetch_on_fields": streaming_prefetch_on_fields,
                        },
                        "context_binding_degraded": bool(context_binding_degraded),
                    },
                    "self_validation_enabled": self_validation_enabled,
                    "skg_enabled": skg_enabled,
                    "self_validation_model": self_validation_summary.get("model"),
                    "skg_model": skg_graph.get("model"),
                    "skg_node_count": int(skg_graph.get("node_count", 0)),
                    "skg_edge_count": int(skg_graph.get("edge_count", 0)),
                    "graph_enabled": need_graph_reasoning,
                    "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                    "operator_timings_ms": snapshot_operator_timings(),
                },
            },
        }
