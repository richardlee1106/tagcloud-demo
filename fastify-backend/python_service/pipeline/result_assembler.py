# -*- coding: utf-8 -*-
"""区域结果组装与聚类级指标汇总。"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List


def build_region_views(*, cluster_entries: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """基于 cluster_entries 构建标准 regions 及兼容视图结构。"""
    regions: List[Dict[str, Any]] = []
    vernacular_regions: List[Dict[str, Any]] = []
    fuzzy_regions: List[Dict[str, Any]] = []
    hotspots: List[Dict[str, Any]] = []

    for entry in cluster_entries:
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
        else ("mixed" if boundary_conf_models else "composite_v1")
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
