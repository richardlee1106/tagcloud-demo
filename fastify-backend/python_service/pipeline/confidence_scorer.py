# -*- coding: utf-8 -*-
"""Confidence scoring models for spatial boundary quality."""

from __future__ import annotations

from typing import Any, Dict


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


def boundary_method_confidence(boundary_method: str) -> float:
    """Method reliability prior for boundary geometry quality."""
    method = str(boundary_method or "").lower()
    # Composite V5: 路网地块边界置信度最高
    if method == "road_block_union_v5":
        return 0.93
    if method == "aoi_fallback_v5":
        return 0.85
    if method == "euluc_fallback_v5":
        return 0.80
    if method == "convex_hull_last_resort_v5":
        return 0.52
    if method in {"alpha_shape", "alpha_shape_simplified"}:
        return 0.86
    if method in {"buffered_hull_degenerate", "buffered_hull_small_cluster"}:
        return 0.72
    if method == "convex_hull_small_cluster":
        return 0.64
    if method == "convex_hull_fallback":
        return 0.58
    if method.startswith("alpha_shape"):
        return 0.82
    if "convex_hull" in method:
        return 0.60
    return 0.62


def build_boundary_confidence(
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
    """Build explainable boundary confidence score in [0, 1]."""
    transition_conf = _to_float((layer_bundle.get("transition") or {}).get("confidence"))
    outer_conf = _to_float((layer_bundle.get("outer") or {}).get("confidence"))
    layer_conf = transition_conf if transition_conf is not None else (outer_conf if outer_conf is not None else 0.0)
    membership_conf = _clamp01(membership_score)
    method_conf = _clamp01(boundary_method_confidence(boundary_method))
    quality_conf = _clamp01(float(boundary_quality_score)) if boundary_quality_score is not None else None
    poi_quality_conf = _clamp01(float(poi_quality_score)) if poi_quality_score is not None else None
    semantic_anchor_conf = (
        _clamp01(float(semantic_anchor_confidence))
        if semantic_anchor_confidence is not None
        else None
    )
    niche_consistency_conf = (
        _clamp01(float(niche_consistency_score))
        if niche_consistency_score is not None
        else None
    )
    visual_morphology_conf = (
        _clamp01(float(visual_morphology_confidence))
        if visual_morphology_confidence is not None
        else None
    )
    self_validation_conf = (
        _clamp01(float(self_validation_confidence))
        if self_validation_confidence is not None
        else None
    )
    skg_consistency_conf = (
        _clamp01(float(skg_consistency_score))
        if skg_consistency_score is not None
        else None
    )

    if quality_conf is None and poi_quality_conf is None:
        base_weights = {
            "layer": 0.55,
            "membership": 0.25,
            "method": 0.20,
        }
    elif quality_conf is not None and poi_quality_conf is None:
        base_weights = {
            "layer": 0.45,
            "membership": 0.20,
            "method": 0.15,
            "quality": 0.20,
        }
    elif quality_conf is None and poi_quality_conf is not None:
        base_weights = {
            "layer": 0.42,
            "membership": 0.20,
            "method": 0.16,
            "poi_quality": 0.22,
        }
    else:
        base_weights = {
            "layer": 0.36,
            "membership": 0.18,
            "method": 0.14,
            "quality": 0.18,
            "poi_quality": 0.14,
        }

    # Composite V5: one model with dynamic signal mass rebalancing.
    base_mass = 0.62
    semantic_signal_mass = 0.18
    advanced_signal_mass = 0.20
    weights: Dict[str, float] = {key: value * base_mass for key, value in base_weights.items()}

    semantic_template = {
        "semantic_anchor": 0.62,
        "niche_consistency": 0.38,
    }
    semantic_allocated = 0.0
    if semantic_anchor_conf is not None:
        semantic_weight = semantic_signal_mass * semantic_template["semantic_anchor"]
        weights["semantic_anchor"] = semantic_weight
        semantic_allocated += semantic_weight
    if niche_consistency_conf is not None:
        semantic_weight = semantic_signal_mass * semantic_template["niche_consistency"]
        weights["niche_consistency"] = semantic_weight
        semantic_allocated += semantic_weight

    advanced_template = {
        "visual_morphology": 0.46,
        "self_validation": 0.34,
        "skg_consistency": 0.20,
    }
    advanced_available = [
        key
        for key, value in (
            ("visual_morphology", visual_morphology_conf),
            ("self_validation", self_validation_conf),
            ("skg_consistency", skg_consistency_conf),
        )
        if value is not None
    ]
    advanced_allocated = 0.0
    if advanced_available:
        advanced_total = (
            sum(float(advanced_template.get(key, 0.0)) for key in advanced_available) or 1.0
        )
        for key in advanced_available:
            share = float(advanced_template.get(key, 0.0)) / advanced_total
            advanced_weight = advanced_signal_mass * share
            weights[key] = advanced_weight
            advanced_allocated += advanced_weight

    rebalance_mass = max(
        0.0,
        (semantic_signal_mass - semantic_allocated) + (advanced_signal_mass - advanced_allocated),
    )
    if rebalance_mass > 0:
        base_total = sum(base_weights.values()) or 1.0
        for key, value in base_weights.items():
            weights[key] += rebalance_mass * (value / base_total)

    total_weight = sum(weights.values())
    if total_weight > 0:
        weights = {key: (value / total_weight) for key, value in weights.items()}

    components = {
        "layer": layer_conf,
        "membership": membership_conf,
        "method": method_conf,
        "quality": quality_conf if quality_conf is not None else 0.0,
        "poi_quality": poi_quality_conf if poi_quality_conf is not None else 0.0,
        "semantic_anchor": semantic_anchor_conf if semantic_anchor_conf is not None else 0.0,
        "niche_consistency": niche_consistency_conf if niche_consistency_conf is not None else 0.0,
        "visual_morphology": visual_morphology_conf if visual_morphology_conf is not None else 0.0,
        "self_validation": self_validation_conf if self_validation_conf is not None else 0.0,
        "skg_consistency": skg_consistency_conf if skg_consistency_conf is not None else 0.0,
    }
    score = _clamp01(
        sum(float(weights.get(key, 0.0)) * float(components.get(key, 0.0)) for key in weights)
    )

    explain = {
        "model": "composite_v5",
        "layer_confidence": round(layer_conf, 4),
        "membership_confidence": round(membership_conf, 4),
        "method_confidence": round(method_conf, 4),
        "weights": {key: round(float(value), 6) for key, value in weights.items()},
        "weight_policy": "composite_v5_dynamic_mass_v1",
        "base_mass": round(base_mass, 4),
        "semantic_signal_mass": round(semantic_signal_mass, 4),
        "advanced_signal_mass": round(advanced_signal_mass, 4),
        "semantic_signal_enabled": bool(
            semantic_anchor_conf is not None or niche_consistency_conf is not None
        ),
        "advanced_signal_enabled": bool(advanced_available),
    }
    if quality_conf is not None:
        explain["quality_confidence"] = round(quality_conf, 4)
    if poi_quality_conf is not None:
        explain["poi_quality_confidence"] = round(poi_quality_conf, 4)
    if semantic_anchor_conf is not None:
        explain["semantic_anchor_confidence"] = round(semantic_anchor_conf, 4)
    if niche_consistency_conf is not None:
        explain["niche_consistency_confidence"] = round(niche_consistency_conf, 4)
    if visual_morphology_conf is not None:
        explain["visual_morphology_confidence"] = round(visual_morphology_conf, 4)
    if self_validation_conf is not None:
        explain["self_validation_confidence"] = round(self_validation_conf, 4)
    if skg_consistency_conf is not None:
        explain["skg_consistency_confidence"] = round(skg_consistency_conf, 4)

    return {
        "score": round(score, 4),
        "explain": explain,
    }
