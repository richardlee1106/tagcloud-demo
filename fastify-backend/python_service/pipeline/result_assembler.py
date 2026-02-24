# -*- coding: utf-8 -*-
"""区域结果组装与聚类级指标汇总。"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List


_REGION_SUFFIXES = (
    "生态片区",
    "商业片区",
    "科教片区",
    "文旅片区",
    "产业片区",
    "片区",
    "活力带",
    "组团",
)


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def _strip_region_suffix(name: Any) -> str:
    text = str(name or "").strip()
    if not text:
        return ""
    for suffix in _REGION_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            return text[: -len(suffix)].strip()
    return text


def _resolve_macro_name(entry: Dict[str, Any]) -> str:
    semantic_anchor = entry.get("semantic_anchor") if isinstance(entry.get("semantic_anchor"), dict) else {}
    anchor_name = _strip_region_suffix((semantic_anchor or {}).get("name"))
    if anchor_name:
        return anchor_name
    fallback_name = _strip_region_suffix(entry.get("name"))
    if fallback_name:
        return fallback_name
    dominant_category = str(entry.get("dominant_category") or "").strip()
    return dominant_category or "未命名片区"


def _resolve_micro_name(entry: Dict[str, Any]) -> str:
    name = str(entry.get("name") or "").strip()
    if name:
        return name
    dominant_category = str(entry.get("dominant_category") or "").strip()
    if dominant_category:
        return f"{dominant_category}片区"
    return "未命名片区"


def _resolve_layer_mode(entry: Dict[str, Any]) -> str:
    layers = entry.get("layers") if isinstance(entry.get("layers"), dict) else {}
    outer = (layers.get("outer") or {}).get("boundary")
    transition = (layers.get("transition") or {}).get("boundary")
    core = (layers.get("core") or {}).get("boundary")
    if outer and transition and core and (outer != transition or transition != core):
        return "multi_layer"
    return "single_layer"


def _build_hierarchy_index(cluster_entries: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for entry in cluster_entries:
        macro = _resolve_macro_name(entry)
        groups.setdefault(macro, []).append(entry)

    hierarchy_by_id: Dict[int, Dict[str, Any]] = {}
    for macro_name, entries in groups.items():
        ranked_entries = sorted(
            entries,
            key=lambda item: (
                _to_float(item.get("vitality_score")) or 0.0,
                int(item.get("poi_count") or 0),
            ),
            reverse=True,
        )
        total = len(ranked_entries)
        for rank, entry in enumerate(ranked_entries, start=1):
            entry_id = int(entry.get("id") or 0)
            if entry_id <= 0:
                continue
            membership = entry.get("membership") if isinstance(entry.get("membership"), dict) else {}
            hierarchy_by_id[entry_id] = {
                "macro_name": macro_name,
                "micro_name": _resolve_micro_name(entry),
                "level": str(membership.get("level") or "transition"),
                "rank_in_macro": rank,
                "macro_size": total,
                "layer_mode": _resolve_layer_mode(entry),
            }
    return hierarchy_by_id


def _has_competing_categories(entry: Dict[str, Any]) -> bool:
    dominant_categories = entry.get("dominant_categories")
    if not isinstance(dominant_categories, list) or len(dominant_categories) < 2:
        return False
    first = dominant_categories[0] if isinstance(dominant_categories[0], dict) else {}
    second = dominant_categories[1] if isinstance(dominant_categories[1], dict) else {}
    first_count = max(0.0, _to_float(first.get("count")) or 0.0)
    second_count = max(0.0, _to_float(second.get("count")) or 0.0)
    if first_count <= 0 or second_count <= 0:
        return False
    ratio = first_count / max(1.0, second_count)
    return ratio < 1.35


def _build_fuzzy_ambiguity(entry: Dict[str, Any]) -> Dict[str, Any]:
    flags: List[str] = []
    semantic_anchor = entry.get("semantic_anchor") if isinstance(entry.get("semantic_anchor"), dict) else {}
    anchor_name = str((semantic_anchor or {}).get("name") or "").strip()
    if not anchor_name:
        flags.append("missing_anchor")

    niche_profile = entry.get("niche_profile") if isinstance(entry.get("niche_profile"), dict) else {}
    niche_type = str((niche_profile or {}).get("niche_type") or "").strip().lower()
    if not niche_type or niche_type == "mixed":
        flags.append("mixed_niche")

    boundary_confidence = _to_float(entry.get("boundary_confidence"))
    if boundary_confidence is None:
        flags.append("missing_boundary_confidence")
    elif boundary_confidence < 0.45:
        flags.append("low_boundary_confidence")

    boundary_quality = entry.get("boundary_quality") if isinstance(entry.get("boundary_quality"), dict) else {}
    landuse_alignment = _to_float((boundary_quality or {}).get("landuse_alignment_score"))
    if landuse_alignment is not None and landuse_alignment < 0.35:
        flags.append("weak_landuse_alignment")

    if _has_competing_categories(entry):
        flags.append("category_competition")

    score = 0.10 + 0.18 * len(flags)
    if boundary_confidence is None:
        score += 0.12
    else:
        score += max(0.0, 0.62 - boundary_confidence) * 0.38
    return {
        "score": round(_clamp01(score), 4),
        "flags": flags,
    }


def _build_source_alignment(entry: Dict[str, Any]) -> Dict[str, float | None]:
    semantic_anchor = entry.get("semantic_anchor") if isinstance(entry.get("semantic_anchor"), dict) else {}
    boundary_quality = entry.get("boundary_quality") if isinstance(entry.get("boundary_quality"), dict) else {}
    return {
        "anchor_confidence": _to_float((semantic_anchor or {}).get("confidence")),
        "boundary_confidence": _to_float(entry.get("boundary_confidence")),
        "landuse_alignment_score": _to_float((boundary_quality or {}).get("landuse_alignment_score")),
        "water_penalty": _to_float((boundary_quality or {}).get("water_penalty")),
    }


def build_region_views(*, cluster_entries: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """基于 cluster_entries 构建标准 regions 及兼容视图结构。"""
    regions: List[Dict[str, Any]] = []
    vernacular_regions: List[Dict[str, Any]] = []
    fuzzy_regions: List[Dict[str, Any]] = []
    hotspots: List[Dict[str, Any]] = []
    hierarchy_by_id = _build_hierarchy_index(cluster_entries)

    for entry in cluster_entries:
        entry_id = int(entry.get("id") or 0)
        hierarchy = hierarchy_by_id.get(
            entry_id,
            {
                "macro_name": _resolve_macro_name(entry),
                "micro_name": _resolve_micro_name(entry),
                "level": str((entry.get("membership") or {}).get("level") or "transition"),
                "rank_in_macro": 1,
                "macro_size": 1,
                "layer_mode": _resolve_layer_mode(entry),
            },
        )
        fuzzy_ambiguity = _build_fuzzy_ambiguity(entry)
        source_alignment = _build_source_alignment(entry)

        canonical_region = {
            "id": entry["id"],
            "name": entry["name"],
            "theme": entry["theme"],
            "poi_count": entry["poi_count"],
            "center": entry["center"],
            "boundary": entry["boundary_geojson"],
            "boundary_ring": entry["boundary"],
            "layers": entry["layers"],
            "dominant_category": entry["dominant_category"],
            "dominant_categories": entry["dominant_categories"],
            "membership": entry["membership"],
            "density": entry["density"],
            "purity": entry["purity"],
            "vitality_score": entry["vitality_score"],
            "poi_quality": entry["poi_quality"],
            "boundary_method": entry["boundary_method"],
            "boundary_quality": entry["boundary_quality"],
            "boundary_generation": entry["boundary_generation"],
            "boundary_confidence": entry["boundary_confidence"],
            "confidence_explain": entry["confidence_explain"],
            "semantic_anchor": entry["semantic_anchor"],
            "niche_profile": entry["niche_profile"],
            "landuse_semantic": entry["landuse_semantic"],
            "semantic_reasoning": entry["semantic_reasoning"],
            "visual_morphology": entry.get("visual_morphology"),
            "self_validation": entry.get("self_validation"),
            "skg_consistency": entry.get("skg_consistency"),
            "score_breakdown": entry["score_breakdown"],
            "drivers": entry["drivers"],
            "hierarchy": hierarchy,
            "source_alignment": source_alignment,
        }
        regions.append(canonical_region)

        vernacular_regions.append(
            {
                "region_id": entry["id"],
                "id": entry["id"],
                "name": entry["name"],
                "theme": entry["theme"],
                "poi_count": entry["poi_count"],
                "center": entry["center"],
                "boundary": entry["boundary_geojson"],
                "boundary_ring": entry["boundary"],
                "layers": entry["layers"],
                "dominant_category": entry["dominant_category"],
                "dominant_categories": entry["dominant_categories"],
                "membership": entry["membership"],
                "vitality_score": entry["vitality_score"],
                "poi_quality": entry["poi_quality"],
                "boundary_method": entry["boundary_method"],
                "boundary_quality": entry["boundary_quality"],
                "boundary_generation": entry["boundary_generation"],
                "boundary_confidence": entry["boundary_confidence"],
                "confidence_explain": entry["confidence_explain"],
                "semantic_anchor": entry["semantic_anchor"],
                "niche_profile": entry["niche_profile"],
                "landuse_semantic": entry["landuse_semantic"],
                "semantic_reasoning": entry["semantic_reasoning"],
                "visual_morphology": entry.get("visual_morphology"),
                "self_validation": entry.get("self_validation"),
                "skg_consistency": entry.get("skg_consistency"),
                "hierarchy": hierarchy,
                "source_alignment": source_alignment,
            }
        )

        fuzzy_regions.append(
            {
                "region_id": entry["id"],
                "id": entry["id"],
                "name": entry["name"],
                "theme": entry["theme"],
                "score": entry["membership"].get("score", 0.0),
                "level": entry["membership"].get("level", "transition"),
                "boundary": entry["boundary_geojson"],
                "boundary_ring": entry["boundary"],
                "center": entry["center"],
                "layers": entry["layers"],
                "pointCount": entry["poi_count"],
                "dominantCategories": entry["dominant_categories"],
                "vitalityScore": entry["vitality_score"],
                "poi_quality": entry["poi_quality"],
                "boundary_method": entry["boundary_method"],
                "boundary_quality": entry["boundary_quality"],
                "boundary_generation": entry["boundary_generation"],
                "boundary_confidence": entry["boundary_confidence"],
                "confidence_explain": entry["confidence_explain"],
                "semantic_anchor": entry["semantic_anchor"],
                "niche_profile": entry["niche_profile"],
                "landuse_semantic": entry["landuse_semantic"],
                "semantic_reasoning": entry["semantic_reasoning"],
                "visual_morphology": entry.get("visual_morphology"),
                "self_validation": entry.get("self_validation"),
                "skg_consistency": entry.get("skg_consistency"),
                "score_breakdown": entry["score_breakdown"],
                "drivers": entry["drivers"],
                "hierarchy": hierarchy,
                "ambiguity": fuzzy_ambiguity,
                "source_alignment": source_alignment,
            }
        )

        hotspots.append(
            {
                "region_id": entry["id"],
                "id": entry["id"],
                "name": entry["name"],
                "center": entry["center"],
                "poiCount": entry["poi_count"],
                "density": entry["density"],
                "vitalityScore": entry["vitality_score"],
                "poi_quality": entry["poi_quality"],
                "boundary": entry["boundary"],
                "boundary_geojson": entry["boundary_geojson"],
                "layers": entry["layers"],
                "dominantCategories": entry["dominant_categories"],
                "boundary_method": entry["boundary_method"],
                "boundary_quality": entry["boundary_quality"],
                "boundary_generation": entry["boundary_generation"],
                "boundary_confidence": entry["boundary_confidence"],
                "confidence_explain": entry["confidence_explain"],
                "semantic_anchor": entry["semantic_anchor"],
                "niche_profile": entry["niche_profile"],
                "landuse_semantic": entry["landuse_semantic"],
                "semantic_reasoning": entry["semantic_reasoning"],
                "visual_morphology": entry.get("visual_morphology"),
                "self_validation": entry.get("self_validation"),
                "skg_consistency": entry.get("skg_consistency"),
                "hierarchy": hierarchy,
                "source_alignment": source_alignment,
            }
        )

    return {
        "regions": regions,
        "vernacular_regions": vernacular_regions,
        "fuzzy_regions": fuzzy_regions,
        "hotspots": hotspots,
    }


def summarize_cluster_entries(
    *,
    cluster_entries: List[Dict[str, Any]],
    fuzzy_regions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """计算 stats 与 diagnostics 所需的聚类汇总指标。"""
    fuzzy_summary = {
        "core": len([region for region in fuzzy_regions if region.get("level") == "core"]),
        "transition": len([region for region in fuzzy_regions if region.get("level") == "transition"]),
        "periphery": len([region for region in fuzzy_regions if region.get("level") == "periphery"]),
    }
    fuzzy_ambiguity_values = [
        float((region.get("ambiguity") or {}).get("score", 0.0))
        for region in fuzzy_regions
        if (region.get("ambiguity") or {}).get("score") is not None
    ]
    high_ambiguity_count = len([value for value in fuzzy_ambiguity_values if value >= 0.6])

    boundary_conf_values = [
        float(entry.get("boundary_confidence", 0.0))
        for entry in cluster_entries
        if entry.get("boundary_confidence") is not None
    ]
    poi_quality_values = [
        float((entry.get("poi_quality") or {}).get("score", 0.0))
        for entry in cluster_entries
        if (entry.get("poi_quality") or {}).get("score") is not None
    ]
    boundary_quality_values = [
        float((entry.get("boundary_quality") or {}).get("quality_score", 0.0))
        for entry in cluster_entries
        if (entry.get("boundary_quality") or {}).get("quality_score") is not None
    ]
    boundary_coverage_values = [
        float((entry.get("boundary_quality") or {}).get("coverage_ratio", 0.0))
        for entry in cluster_entries
        if (entry.get("boundary_quality") or {}).get("coverage_ratio") is not None
    ]
    landuse_alignment_values = [
        float((entry.get("boundary_quality") or {}).get("landuse_alignment_score", 0.0))
        for entry in cluster_entries
        if (entry.get("boundary_quality") or {}).get("landuse_alignment_score") is not None
    ]
    water_overlap_values = [
        float((entry.get("boundary_quality") or {}).get("water_overlap_ratio", 0.0))
        for entry in cluster_entries
        if (entry.get("boundary_quality") or {}).get("water_overlap_ratio") is not None
    ]
    water_penalty_values = [
        float((entry.get("boundary_quality") or {}).get("water_penalty", 0.0))
        for entry in cluster_entries
        if (entry.get("boundary_quality") or {}).get("water_penalty") is not None
    ]
    semantic_anchor_values = [
        float((entry.get("semantic_anchor") or {}).get("confidence", 0.0))
        for entry in cluster_entries
        if (entry.get("semantic_anchor") or {}).get("confidence") is not None
    ]

    semantic_anchor_hit_count = sum(
        1
        for entry in cluster_entries
        if str((entry.get("semantic_anchor") or {}).get("name") or "").strip()
    )
    niche_type_counts = Counter(
        str((entry.get("niche_profile") or {}).get("niche_type") or "mixed")
        for entry in cluster_entries
    )
    boundary_quality_pass_count = sum(
        1
        for entry in cluster_entries
        if bool((entry.get("boundary_quality") or {}).get("pass"))
    )
    boundary_iteration_values = [
        int((entry.get("boundary_generation") or {}).get("attempts", 1))
        for entry in cluster_entries
    ]

    avg_boundary_conf = round(sum(boundary_conf_values) / len(boundary_conf_values), 4) if boundary_conf_values else 0.0
    avg_poi_quality_score = (
        round(sum(poi_quality_values) / len(poi_quality_values), 4)
        if poi_quality_values
        else 0.0
    )
    avg_boundary_quality_score = (
        round(sum(boundary_quality_values) / len(boundary_quality_values), 4)
        if boundary_quality_values
        else 0.0
    )
    avg_boundary_coverage = (
        round(sum(boundary_coverage_values) / len(boundary_coverage_values), 4)
        if boundary_coverage_values
        else 0.0
    )
    avg_landuse_alignment_score = (
        round(sum(landuse_alignment_values) / len(landuse_alignment_values), 4)
        if landuse_alignment_values
        else 0.0
    )
    avg_water_overlap_ratio = (
        round(sum(water_overlap_values) / len(water_overlap_values), 4)
        if water_overlap_values
        else 0.0
    )
    avg_water_penalty = (
        round(sum(water_penalty_values) / len(water_penalty_values), 4)
        if water_penalty_values
        else 0.0
    )
    avg_semantic_anchor_confidence = (
        round(sum(semantic_anchor_values) / len(semantic_anchor_values), 4)
        if semantic_anchor_values
        else 0.0
    )
    semantic_anchor_coverage = (
        round(semantic_anchor_hit_count / len(cluster_entries), 4)
        if cluster_entries
        else 0.0
    )
    boundary_quality_pass_rate = (
        round(boundary_quality_pass_count / len(cluster_entries), 4)
        if cluster_entries
        else 0.0
    )
    avg_boundary_iterations = (
        round(sum(boundary_iteration_values) / len(boundary_iteration_values), 3)
        if boundary_iteration_values
        else 0.0
    )

    boundary_conf_models = {
        str((entry.get("confidence_explain") or {}).get("model"))
        for entry in cluster_entries
        if (entry.get("confidence_explain") or {}).get("model")
    }
    boundary_quality_models = {
        str((entry.get("boundary_quality") or {}).get("model"))
        for entry in cluster_entries
        if (entry.get("boundary_quality") or {}).get("model")
    }
    boundary_conf_model = (
        next(iter(boundary_conf_models))
        if len(boundary_conf_models) == 1
        else ("mixed" if boundary_conf_models else "composite_v5")
    )
    boundary_quality_model = (
        next(iter(boundary_quality_models))
        if len(boundary_quality_models) == 1
        else ("mixed" if boundary_quality_models else "coverage_area_compactness_v1")
    )
    dominant_niche_type = (
        max(niche_type_counts.items(), key=lambda item: item[1])[0]
        if niche_type_counts
        else "mixed"
    )

    return {
        "fuzzy_summary": fuzzy_summary,
        "avg_fuzzy_ambiguity": (
            round(sum(fuzzy_ambiguity_values) / len(fuzzy_ambiguity_values), 4)
            if fuzzy_ambiguity_values
            else 0.0
        ),
        "high_ambiguity_count": int(high_ambiguity_count),
        "boundary_conf_values": boundary_conf_values,
        "niche_type_counts": dict(niche_type_counts),
        "avg_boundary_confidence": avg_boundary_conf,
        "min_boundary_confidence": round(min(boundary_conf_values), 4) if boundary_conf_values else 0.0,
        "max_boundary_confidence": round(max(boundary_conf_values), 4) if boundary_conf_values else 0.0,
        "avg_poi_quality_score": avg_poi_quality_score,
        "avg_boundary_quality_score": avg_boundary_quality_score,
        "avg_boundary_coverage": avg_boundary_coverage,
        "avg_landuse_alignment_score": avg_landuse_alignment_score,
        "avg_water_overlap_ratio": avg_water_overlap_ratio,
        "avg_water_penalty": avg_water_penalty,
        "avg_semantic_anchor_confidence": avg_semantic_anchor_confidence,
        "semantic_anchor_coverage": semantic_anchor_coverage,
        "dominant_niche_type": dominant_niche_type,
        "boundary_quality_pass_rate": boundary_quality_pass_rate,
        "avg_boundary_iterations": avg_boundary_iterations,
        "boundary_conf_model": boundary_conf_model,
        "boundary_quality_model": boundary_quality_model,
    }
