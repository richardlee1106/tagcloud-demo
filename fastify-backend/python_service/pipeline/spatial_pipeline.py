# -*- coding: utf-8 -*-
"""Python 空间计算管线。"""

from __future__ import annotations

import json
import math
import re
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from dataclasses import asdict
from numbers import Integral
from typing import Any, Dict, Iterable, Iterator, List, Tuple

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
from algorithms.h3_aggregate import aggregate_pois_h3
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
    for entry in entries[:12]:
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

    prompt = (
        "你是城市空间命名审核器。请审核片区名称是否适合作为“片区ID”。"
        "拒绝宏观地名、重复地名、楼栋号、停车场出入口、小区住宅导向命名。"
        "允许大学/医院/公园/商圈等代表性名称。"
        "输出严格 JSON：{\"items\":[{\"id\":1,\"approved\":true,\"name\":\"...\"}]}。"
        "若不通过请给出替代名称 name，长度不超过16字。"
        f"\n待审核: {json.dumps(payload_entries, ensure_ascii=False)}"
    )
    request_payload = {
        "model": model_name,
        "temperature": 0.1,
        "max_tokens": 500,
        "messages": [
            {"role": "system", "content": "只输出 JSON，不要解释。"},
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
    timeout_s = max(0.4, float(timeout_ms) / 1000.0)
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


def _govern_region_names(
    *,
    cluster_entries: List[Dict[str, Any]],
    remote_enabled: bool,
    model_name: str,
    endpoint: str,
    timeout_ms: int,
) -> Dict[str, Any]:
    summary = {
        "rule_rewritten": 0,
        "llm_rewritten": 0,
        "duplicate_rewritten": 0,
        "llm_attempted": False,
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

    summary["llm_attempted"] = True
    llm_name_map = _remote_audit_region_names(
        entries=cluster_entries,
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
    "公园",
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

        hints = _safe_json_loads(request.get("hints"), {})
        semantic_query = hints.get("semantic_query") or ""
        terms = [term.strip() for term in semantic_query.split() if term.strip()]

        hints_options = hints.get("options") if isinstance(hints.get("options"), dict) else {}
        source_policy = (
            hints_options.get("sourcePolicy")
            or hints_options.get("source_policy")
            or {}
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

        visual_review_enabled = force_composite_v5 or _option_enabled(
            hints_options.get("visualReviewEnabled"), default_value=False
        )
        visual_remote_enabled = visual_review_enabled and _option_enabled(
            hints_options.get("visualRemoteEnabled"), default_value=False
        )
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
        visual_model_name = str(hints_options.get("visualModel") or "qwen3-vl-4b")
        visual_endpoint = str(
            hints_options.get("visualEndpoint") or "http://localhost:1234/v1/chat/completions"
        )
        visual_image_data_url = hints_options.get("visualSnapshotDataUrl") or hints_options.get("mapSnapshotDataUrl")
        visual_timeout_ms = _resolve_limit(
            hints_options.get("visualTimeoutMs"),
            default_value=1200,
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
        # 纯图推理模式下不做语义关键词过滤，保持候选点覆盖范围更广。
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

            region_analyses = analyze_region_set(
                regions=region_context,
                target_region_ids=target_region_ids,
                categories=categories,
                repository=self.repository,
            )
            comparison = compute_region_comparison(
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

        max_fetch_limit = _resolve_limit(hints_options.get("maxFetchLimit"), default_value=20000, max_value=500000)
        fetch_limit = _resolve_limit(hints_options.get("limit"), default_value=8000, max_value=max_fetch_limit)

        # 注释说明
        explicit_limit = hints_options.get("limit")
        if query_type == "graph_reasoning" and explicit_limit is None:
            fetch_limit = min(fetch_limit, max(600, graph_max_nodes * 3))

        # 注释说明
        db_order_by_distance = True

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
        anchor_bypass_requested_count = 0
        anchor_bypass_injected_count = 0
        anchor_bypass_query_count = 0
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
            "anchor_bypass_requested_count": int(anchor_bypass_requested_count),
            "anchor_bypass_query_count": int(anchor_bypass_query_count),
            "anchor_bypass_injected_count": int(anchor_bypass_injected_count),
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
        road_bundle = context_loader.load_road_context(
            repository=self.repository,
            spatial_context=spatial_context,
            query_type=query_type,
            enabled=road_boundary_enhancement,
            fetch_limit=road_fetch_limit,
            normalize_road_geometries_func=_normalize_road_geometries,
        )
        road_rows: List[Dict[str, Any]] = list(road_bundle.get("rows") or [])
        road_geometries: List[Any] = list(road_bundle.get("geometries") or [])
        road_index: STRtree | None = road_bundle.get("index")
        road_source = str(road_bundle.get("source") or "disabled")

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
        landuse_bundle = context_loader.load_landuse_context(
            repository=self.repository,
            spatial_context=spatial_context,
            query_type=query_type,
            enabled=landuse_boundary_enhancement,
            fetch_limit=landuse_fetch_limit,
            normalize_landuse_geometries_func=_normalize_landuse_geometries,
        )
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
            analyze_spatial_graph(
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

        # ͼҪ߿Ƭģ·
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
                        },
                    },
                },
            }
            return

        coords: List[Tuple[float, float]] = [
            (float(poi["lon"]), float(poi["lat"])) for poi in pois if poi.get("lon") is not None and poi.get("lat") is not None
        ]
        # 在昂贵的下游建模前先输出一个快速预览边界。
        if len(coords) >= 3:
            # ²ԱԤ߽ȶҿ١
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

        cluster_result = cluster_points(
            coords,
            min_cluster_size=cluster_min_cluster_size,
            min_samples=cluster_min_samples,
            adaptive=cluster_adaptive,
            max_hdbscan_points=cluster_max_hdbscan_points,
        )
        labels = cluster_result.labels

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

        # ──────────────────────────────────────────────────────────────────
        # Composite V5: 路网地块边界组装链路
        # 当启用 composite_v5 时，走全新的地块 union 边界生成链路，
        # 替代传统的 alpha-shape / 凸包边界。
        # ──────────────────────────────────────────────────────────────────
        if force_composite_v5 and hasattr(self.repository, "spatial_join_pois"):
            print("[PIPELINE_V5] composite_v5 链路激活", flush=True, file=sys.stderr)

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
                v5_road_blocks = self.repository.fetch_road_blocks(bbox_wkt=v5_bbox_wkt, limit=5000)
                v5_osm_aoi = self.repository.fetch_osm_aoi(bbox_wkt=v5_bbox_wkt, limit=3000)
                v5_euluc = self.repository.fetch_euluc(bbox_wkt=v5_bbox_wkt, limit=3000)
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

                # 空间连接 POI（如果 POI 还没有 block_id，则重新获取）
                if pois and pois[0].get("block_id") is None:
                    v5_pois = self.repository.spatial_join_pois(
                        clip_wkt=v5_bbox_wkt,
                        categories=fetch_categories,
                        terms=effective_terms if not term_filter_relaxed else [],
                        limit=fetch_limit,
                    )
                    if v5_pois:
                        pois = v5_pois
                        coords = [
                            (float(poi["lon"]), float(poi["lat"]))
                            for poi in pois
                            if poi.get("lon") is not None and poi.get("lat") is not None
                        ]
                        # 用新 POI 重新聚类
                        cluster_result = cluster_points(
                            coords,
                            min_cluster_size=cluster_min_cluster_size,
                            min_samples=cluster_min_samples,
                            adaptive=cluster_adaptive,
                            max_hdbscan_points=cluster_max_hdbscan_points,
                        )
                        labels = cluster_result.labels
                        grouped_indices = defaultdict(list)
                        for idx, label in enumerate(labels):
                            if label >= 0:
                                grouped_indices[label].append(idx)

                # V5 地块边界组装
                v5_districts = block_assembler.assemble_block_boundaries(
                    cluster_labels=labels,
                    pois=pois,
                    road_blocks=v5_road_blocks,
                    osm_aoi_features=v5_osm_aoi,
                    euluc_features=v5_euluc,
                    vlm_anchor_texts=vlm_anchor_texts,
                )
                print(f"[PIPELINE_V5] 生成 {len(v5_districts)} 个片区", flush=True, file=sys.stderr)

                # 将 V5 片区转换为 cluster_entries 格式（兼容下游结果组装）
                for district in v5_districts:
                    d_pois = district.pois
                    d_coords = [(float(p["lon"]), float(p["lat"])) for p in d_pois if p.get("lon") and p.get("lat")]

                    categories_counter = _build_category_counter(d_pois)
                    top_category = categories_counter.most_common(1)[0][0] if categories_counter else "未分类"
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
                    # 由于地块边界本身就贴合路网，method_confidence 先验值更高
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
                    # 强制标记 V5 模型名称，确保前端显示正确
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
            # 走传统链路（V5 未启用或未产出结果）
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

                boundary_selection = _build_cluster_boundary(
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
            for entry in cluster_entries:
                existing_visual = entry.get("visual_morphology")
                if isinstance(existing_visual, dict) and existing_visual.get("score") is not None:
                    continue
                poi_count = int(entry.get("poi_count", 0))
                if poi_count <= 0:
                    continue
                visual_review = _review_cluster_morphology(
                    spatial_context=spatial_context,
                    boundary_geojson=entry.get("boundary_geojson"),
                    boundary_quality=entry.get("boundary_quality"),
                    poi_count=poi_count,
                    model_name=visual_model_name,
                    endpoint=visual_endpoint,
                    image_data_url=visual_image_data_url,
                    enable_remote=visual_remote_enabled,
                    timeout_ms=visual_timeout_ms,
                )
                entry["visual_morphology"] = visual_review

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
        h3_summary = aggregate_pois_h3(
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

        vlm_extracted_texts = list(vlm_anchor_texts)
        screenshot_base64 = hints_options.get("screenshot_base64")
        if screenshot_base64:
            screenshot_texts = vlm_reviewer.extract_map_text(
                image_data_url=screenshot_base64,
                model_name=visual_model_name,
                endpoint=visual_endpoint,
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
                "name_audit_enabled": bool(name_audit_enabled),
                "name_audit_remote_enabled": bool(name_audit_remote_enabled),
                "name_audit_model": name_audit_model_name if name_audit_remote_enabled else "rule_guard_v2",
                "name_audit_rule_rewritten": int(name_audit_summary.get("rule_rewritten", 0)),
                "name_audit_llm_rewritten": int(name_audit_summary.get("llm_rewritten", 0)),
                "name_audit_duplicate_rewritten": int(name_audit_summary.get("duplicate_rewritten", 0)),
                "name_audit_llm_attempted": bool(name_audit_summary.get("llm_attempted", False)),
                "vlm_extracted_texts": vlm_extracted_texts,
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
                        "rule_rewritten": int(name_audit_summary.get("rule_rewritten", 0)),
                        "llm_rewritten": int(name_audit_summary.get("llm_rewritten", 0)),
                        "duplicate_rewritten": int(name_audit_summary.get("duplicate_rewritten", 0)),
                        "llm_attempted": bool(name_audit_summary.get("llm_attempted", False)),
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
                    "self_validation_enabled": self_validation_enabled,
                    "skg_enabled": skg_enabled,
                    "self_validation_model": self_validation_summary.get("model"),
                    "skg_model": skg_graph.get("model"),
                    "skg_node_count": int(skg_graph.get("node_count", 0)),
                    "skg_edge_count": int(skg_graph.get("edge_count", 0)),
                    "graph_enabled": need_graph_reasoning,
                    "graph_component_count": graph_summary.get("component_count", 0) if graph_summary else 0,
                },
            },
        }



