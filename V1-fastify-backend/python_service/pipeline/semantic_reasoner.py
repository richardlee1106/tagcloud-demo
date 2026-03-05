# -*- coding: utf-8 -*-
"""Semantic anchor and niche reasoning helpers."""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Callable, Dict, List, Tuple

from shapely.geometry import Polygon


_SEMANTIC_SUFFIX_PATTERNS = (
    r"[-_0-9]+$",
    r"(?:\u505c\u8f66\u573a[a-z0-9\-]*\u53e3?(?:-\d+)?)$",
    r"(?:[a-z0-9]+\u53e3(?:-\d+)?)$",
    r"(?:[a-z0-9]+\u5355\u5143)$",
    r"(?:\u505c\u8f66\u573a)$",
    r"(?:\u5c0f\u5356\u90e8|\u4fbf\u5229\u5e97|\u95e8\u5e97|\u5206\u5e97|\u5e97)$",
    r"(?:\u5357\u95e8|\u5317\u95e8|\u4e1c\u95e8|\u897f\u95e8|\u6b63\u95e8)$",
    r"(?:\u56fe\u4e66\u9986|\u6559\u5b66\u697c|\u5b9e\u9a8c\u697c|\u4f53\u80b2\u9986|\u98df\u5802|\u5bbf\u820d)$",
)

_GENERIC_ANCHOR_TOKENS = {
    "\u9910\u996e",
    "\u96f6\u552e",
    "\u6587\u5a31",
    "\u5546\u4e1a",
    "\u6559\u80b2",
    "\u79d1\u6559",
    "\u9ad8\u6821",
    "\u7528\u5730",
    "\u516c\u56ed",
    "\u505c\u8f66\u573a",
}

_CITY_LEVEL_ANCHOR_TOKENS = {
    "\u4e2d\u56fd",
    "\u6e56\u5317",
    "\u6b66\u6c49",
    "\u6b66\u6c49\u5e02",
    "\u4e0a\u6d77",
    "\u5317\u4eac",
    "\u5e7f\u5dde",
    "\u6df1\u5733",
}

_ADMIN_ANCHOR_SUFFIXES = (
    "\u7701",
    "\u5e02",
    "\u81ea\u6cbb\u533a",
    "\u81ea\u6cbb\u5dde",
    "\u533a",
    "\u53bf",
    "\u9547",
    "\u8857\u9053",
)

_REPEATED_ANCHOR_PATTERN = re.compile(r"^(.{2,6})\1+$")
_BUILDING_ANCHOR_PATTERN = re.compile(
    r"(?:\d+|[a-z]\d*)(?:\u53f7\u697c|\u680b|\u5355\u5143|\u5c42|\u5ba4|\u53f7)$",
    flags=re.IGNORECASE,
)
_RESIDENTIAL_ANCHOR_TOKENS = {
    "\u5c0f\u533a",
    "\u82b1\u56ed",
    "\u661f\u57ce",
    "\u56fd\u9645\u57ce",
    "\u4f4f\u5b85",
    "\u516c\u5bd3",
    "\u5ead\u9662",
    "\u82d1",
}
_AUTHORITY_ENTITY_TOKENS = (
    "\u5927\u5b66",
    "\u6821\u533a",
    "\u533b\u9662",
    "\u516c\u56ed",
    "\u666f\u533a",
    "\u4ea7\u4e1a\u56ed",
)

_NICHE_KEYWORDS: Dict[str, Tuple[Tuple[str, float], ...]] = {
    "ecology": (
        ("\u6c34\u57df", 1.0),
        ("\u6e56", 0.7),
        ("\u6cb3", 0.6),
        ("\u6e7f\u5730", 0.9),
        ("\u751f\u6001", 0.8),
        ("\u516c\u56ed", 0.6),
        ("\u7eff\u5730", 0.6),
        ("water", 0.9),
        ("wetland", 0.9),
        ("park", 0.5),
    ),
    "commerce": (
        ("\u5546\u4e1a", 1.0),
        ("\u5546\u573a", 0.9),
        ("\u8d2d\u7269", 0.8),
        ("\u7efc\u5408\u4f53", 0.9),
        ("\u5e7f\u573a", 0.6),
        ("\u95e8\u5e97", 0.6),
        ("\u9500\u54c1\u8302", 1.0),
        ("mall", 0.9),
        ("retail", 0.8),
        ("plaza", 0.6),
    ),
    "education": (
        ("\u5927\u5b66", 1.0),
        ("\u5b66\u9662", 0.9),
        ("\u6821\u533a", 0.9),
        ("\u6559\u80b2", 0.9),
        ("\u79d1\u7814", 0.9),
        ("\u9ad8\u6821", 0.9),
        ("\u56fe\u4e66\u9986", 0.7),
        ("university", 1.0),
        ("college", 0.9),
        ("campus", 0.9),
    ),
}

_WATER_SEMANTIC_KEYWORDS: Tuple[str, ...] = (
    "\u6c34\u57df",
    "\u6e56",
    "\u6cb3",
    "\u6e7f\u5730",
    "\u6c34\u5e93",
    "water",
    "lake",
    "river",
    "wetland",
    "reservoir",
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


def _safe_json_loads(raw: Any, fallback: Any) -> Any:
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


def normalize_semantic_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    return re.sub(r"[\u3000\s]+", "", text)


def is_water_semantic_label(label: Any) -> bool:
    normalized = normalize_semantic_text(label)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in _WATER_SEMANTIC_KEYWORDS)


def strip_semantic_suffix(name: Any) -> str:
    cleaned = normalize_semantic_text(name)
    if not cleaned:
        return ""

    cleaned = re.sub(r"[\(\uff08][^\)\uff09]*[\)\uff09]$", "", cleaned)
    for pattern in _SEMANTIC_SUFFIX_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)

    return cleaned.strip("-_")


def _extract_cjk_fragments(text: str, *, min_len: int = 2, max_len: int = 8) -> set[str]:
    pure = "".join(ch for ch in text if "\u4e00" <= ch <= "\u9fff")
    if len(pure) < min_len:
        return set()

    fragments: set[str] = set()
    upper = min(max_len, len(pure))
    for size in range(min_len, upper + 1):
        for start in range(0, len(pure) - size + 1):
            fragments.add(pure[start : start + size])
    return fragments


def _is_generic_anchor_token(token: str, *, dominant_category: str = "") -> bool:
    normalized = normalize_semantic_text(token)
    if len(normalized) < 2:
        return True

    compact = normalized
    for suffix in ("\u7247\u533a", "\u751f\u6001\u7247\u533a", "\u5546\u4e1a\u7247\u533a", "\u6d3b\u529b\u5e26"):
        if compact.endswith(suffix):
            compact = compact[: -len(suffix)] or compact

    repeated_match = _REPEATED_ANCHOR_PATTERN.match(compact)
    if repeated_match:
        repeated_unit = repeated_match.group(1)
        if repeated_unit in _CITY_LEVEL_ANCHOR_TOKENS or len(repeated_unit) <= 3:
            return True

    if _BUILDING_ANCHOR_PATTERN.search(compact):
        return True

    if (
        any(keyword in compact for keyword in _RESIDENTIAL_ANCHOR_TOKENS)
        and not any(keyword in compact for keyword in _AUTHORITY_ENTITY_TOKENS)
    ):
        return True

    category_norm = normalize_semantic_text(dominant_category)
    if category_norm and normalized == category_norm:
        return True

    if normalized in _CITY_LEVEL_ANCHOR_TOKENS:
        return True

    if len(normalized) <= 4 and any(normalized.endswith(suffix) for suffix in _ADMIN_ANCHOR_SUFFIXES):
        return True

    for city_token in _CITY_LEVEL_ANCHOR_TOKENS:
        if normalized in {city_token, f"{city_token}\u7247\u533a", f"{city_token}\u6d3b\u529b\u5e26"}:
            return True

    return normalized in _GENERIC_ANCHOR_TOKENS


def score_niche_keywords(text: str) -> Dict[str, float]:
    normalized = normalize_semantic_text(text)
    if not normalized:
        return {"ecology": 0.0, "commerce": 0.0, "education": 0.0}

    scores: Dict[str, float] = {"ecology": 0.0, "commerce": 0.0, "education": 0.0}
    for niche, keywords in _NICHE_KEYWORDS.items():
        value = 0.0
        for keyword, weight in keywords:
            if keyword in normalized:
                value += weight
        scores[niche] = _clamp01(value / 2.4)

    return scores


def infer_niche_type_from_text(text: str) -> Tuple[str | None, float, Dict[str, float]]:
    scores = score_niche_keywords(text)
    top_niche = max(scores, key=scores.get)
    top_score = float(scores[top_niche])
    sorted_scores = sorted(scores.values(), reverse=True)
    second_score = float(sorted_scores[1]) if len(sorted_scores) > 1 else 0.0

    if top_score < 0.20:
        return None, top_score, scores
    if (top_score - second_score) < 0.05 and top_score < 0.45:
        return None, top_score, scores

    return top_niche, top_score, scores


def infer_semantic_anchor(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_category: str,
    llm_anchor_candidates: List[str] | None = None,
) -> Dict[str, Any]:
    names = [str(poi.get("name") or "").strip() for poi in cluster_pois if str(poi.get("name") or "").strip()]
    if len(names) < 3:
        return {}

    normalized_names = [normalize_semantic_text(name) for name in names]
    stripped_names = [strip_semantic_suffix(name) or normalize_semantic_text(name) for name in names]

    fragment_counts: Counter[str] = Counter()
    for stripped in stripped_names:
        fragment_counts.update(_extract_cjk_fragments(stripped))

    candidate_name = ""
    candidate_source = "none"
    candidate_support_count = 0
    candidate_support_ratio = 0.0
    candidate_variant_count = 0
    candidate_score = 0.0

    for fragment, count in fragment_counts.most_common():
        if count < 2:
            break
        if _is_generic_anchor_token(fragment, dominant_category=dominant_category):
            continue

        fragment_norm = normalize_semantic_text(fragment)
        support_count = sum(1 for text in normalized_names if fragment_norm and fragment_norm in text)
        if support_count < 2:
            continue

        stripped_variants = {
            stripped_names[idx]
            for idx, text in enumerate(normalized_names)
            if fragment_norm and fragment_norm in text
        }
        variant_count = len({item for item in stripped_variants if item})
        if variant_count < 2:
            continue

        support_ratio = support_count / max(1, len(normalized_names))
        score = support_ratio + min(len(fragment_norm), 8) / 25.0
        if score > candidate_score:
            candidate_name = fragment
            candidate_source = "rule_fragment_v1"
            candidate_support_count = support_count
            candidate_support_ratio = support_ratio
            candidate_variant_count = variant_count
            candidate_score = score

    if not candidate_name:
        base_counts: Counter[str] = Counter(
            base
            for base in stripped_names
            if len(base) >= 2 and not _is_generic_anchor_token(base, dominant_category=dominant_category)
        )
        for base, count in base_counts.most_common():
            if count < 2:
                break
            support_ratio = count / max(1, len(stripped_names))
            score = support_ratio + min(len(base), 10) / 30.0
            if score > candidate_score:
                candidate_name = base
                candidate_source = "rule_base_v1"
                candidate_support_count = count
                candidate_support_ratio = support_ratio
                candidate_variant_count = len({item for item in stripped_names if item == base})
                candidate_score = score

    llm_boost = 0.0
    best_hint = ""
    best_hint_score = 0.0
    best_hint_support_ratio = 0.0

    for hint in llm_anchor_candidates or []:
        hint_norm = normalize_semantic_text(hint)
        if len(hint_norm) < 2 or _is_generic_anchor_token(hint_norm, dominant_category=dominant_category):
            continue
        support_count = sum(1 for text in normalized_names if hint_norm in text)
        if support_count < 2:
            continue

        support_ratio = support_count / max(1, len(normalized_names))
        score = support_ratio + min(len(hint_norm), 10) / 30.0
        if score > best_hint_score:
            best_hint = hint_norm
            best_hint_score = score
            best_hint_support_ratio = support_ratio

    if best_hint:
        if not candidate_name or best_hint_score > candidate_score + 0.08:
            candidate_name = best_hint
            candidate_source = "llm_hint_v1"
            candidate_support_count = sum(1 for text in normalized_names if best_hint in text)
            candidate_support_ratio = best_hint_support_ratio
            candidate_variant_count = len(
                {
                    stripped_names[idx]
                    for idx, text in enumerate(normalized_names)
                    if best_hint in text and stripped_names[idx]
                }
            )
            candidate_score = best_hint_score
        elif best_hint_support_ratio >= candidate_support_ratio * 0.7:
            candidate_source = "hybrid_rule_llm_v1"
            llm_boost = 0.06

    if not candidate_name or candidate_support_count < 2:
        return {}

    length_score = min(len(candidate_name), 8) / 8.0
    confidence = _clamp01(
        0.34
        + 0.40 * candidate_support_ratio
        + 0.12 * length_score
        + 0.08 * min(candidate_variant_count, 4) / 4.0
        + llm_boost
    )

    niche_hint, niche_hint_score, _ = infer_niche_type_from_text(candidate_name)

    return {
        "name": candidate_name,
        "confidence": round(confidence, 4),
        "support_ratio": round(candidate_support_ratio, 4),
        "support_count": int(candidate_support_count),
        "variant_count": int(candidate_variant_count),
        "source": candidate_source,
        "niche_hint": niche_hint,
        "niche_hint_score": round(float(niche_hint_score), 4),
    }


def recover_waterbody_anchor(
    *,
    cluster_pois: List[Dict[str, Any]],
    semantic_anchor: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    current_name = str((semantic_anchor or {}).get("name") or "").strip()
    if current_name and "\u6e56" in current_name:
        return semantic_anchor

    water_overlap_ratio = _to_float((landuse_context or {}).get("water_overlap_ratio")) or 0.0
    if water_overlap_ratio < 0.06:
        return semantic_anchor

    names = [str(poi.get("name") or "").strip() for poi in cluster_pois if str(poi.get("name") or "").strip()]
    if len(names) < 2:
        return semantic_anchor

    lake_counter: Counter[str] = Counter()
    for raw_name in names:
        stripped = strip_semantic_suffix(raw_name) or normalize_semantic_text(raw_name)
        if not stripped:
            continue
        for match in re.findall(r"[\u4e00-\u9fff]{1,8}\u6e56", stripped):
            candidate = str(match)
            for city_token in sorted(_CITY_LEVEL_ANCHOR_TOKENS, key=len, reverse=True):
                if candidate.startswith(city_token) and len(candidate) > len(city_token):
                    candidate = candidate[len(city_token) :]
                    break
            if len(candidate) < 2 or _is_generic_anchor_token(candidate):
                continue
            lake_counter[candidate] += 1

    if not lake_counter:
        return semantic_anchor

    candidate_name, support_count = lake_counter.most_common(1)[0]
    support_ratio = support_count / max(1, len(names))
    if support_count < 2 or support_ratio < 0.10:
        return semantic_anchor

    confidence = _clamp01(
        0.54
        + 0.24 * support_ratio
        + 0.12 * _clamp01(water_overlap_ratio)
        + 0.08 * min(float(support_count), 6.0) / 6.0
    )
    fallback_anchor = dict(semantic_anchor or {})
    fallback_anchor.update(
        {
            "name": candidate_name,
            "confidence": round(max(confidence, _to_float((semantic_anchor or {}).get("confidence")) or 0.0), 4),
            "support_ratio": round(support_ratio, 4),
            "support_count": int(support_count),
            "source": "water_context_recover_v1",
            "niche_hint": "ecology",
            "niche_hint_score": round(max(0.62, _to_float((semantic_anchor or {}).get("niche_hint_score")) or 0.0), 4),
        }
    )
    return fallback_anchor


def landuse_label_text(properties: Any) -> str:
    parsed = _safe_json_loads(properties, {})
    if isinstance(parsed, str):
        return parsed.strip()
    if not isinstance(parsed, dict):
        return ""

    preferred_keys = (
        "\u7c7b\u522b",
        "class",
        "category",
        "type",
        "name",
        "landuse",
    )
    for key in preferred_keys:
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    values = [str(value).strip() for value in parsed.values() if isinstance(value, str) and value.strip()]
    return values[0] if values else ""


def niche_type_from_landuse_label(label_text: str) -> str:
    niche, _, _ = infer_niche_type_from_text(label_text)
    return niche or "mixed"


def _bbox_intersects(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def cluster_landuse_semantic_context(
    *,
    boundary_geojson: Dict[str, Any],
    cluster_points: List[Tuple[float, float]],
    semantic_features: List[Dict[str, Any]],
    polygon_from_geojson: Callable[..., Polygon | None],
) -> Dict[str, Any]:
    if not semantic_features:
        return {
            "dominant_niche_type": "mixed",
            "type_scores": {"ecology": 0.0, "commerce": 0.0, "education": 0.0},
            "top_labels": [],
            "overlap_ratio": 0.0,
            "water_overlap_ratio": 0.0,
            "feature_hits": 0,
        }

    polygon = polygon_from_geojson(boundary_geojson, cluster_points=cluster_points)
    if polygon is None or polygon.is_empty:
        return {
            "dominant_niche_type": "mixed",
            "type_scores": {"ecology": 0.0, "commerce": 0.0, "education": 0.0},
            "top_labels": [],
            "overlap_ratio": 0.0,
            "water_overlap_ratio": 0.0,
            "feature_hits": 0,
        }

    polygon_area = max(float(polygon.area), 1e-12)
    polygon_bounds = polygon.bounds
    type_scores: Dict[str, float] = {"ecology": 0.0, "commerce": 0.0, "education": 0.0}
    label_scores: Counter[str] = Counter()
    total_overlap = 0.0
    water_overlap = 0.0
    feature_hits = 0

    for feature in semantic_features:
        feature_bounds = feature.get("bounds")
        if not isinstance(feature_bounds, tuple) or len(feature_bounds) != 4:
            continue
        if not _bbox_intersects(polygon_bounds, feature_bounds):
            continue

        geometry = feature.get("geometry")
        if geometry is None or geometry.is_empty:
            continue
        if not geometry.intersects(polygon):
            continue

        try:
            intersection = geometry.intersection(polygon)
        except Exception:
            continue

        if intersection is None or intersection.is_empty:
            continue

        overlap_ratio = float(intersection.area) / polygon_area
        if overlap_ratio <= 0:
            continue

        weight = _clamp01(float(feature.get("semantic_weight", 0.72)))
        weighted_overlap = overlap_ratio * weight
        total_overlap += overlap_ratio
        feature_hits += 1

        feature_type = str(feature.get("niche_type") or "mixed")
        if feature_type in type_scores:
            type_scores[feature_type] += weighted_overlap

        label = str(feature.get("label") or "").strip()
        if label:
            label_scores[label] += weighted_overlap
            if is_water_semantic_label(label):
                water_overlap += overlap_ratio

    if max(type_scores.values()) > 0:
        dominant_niche_type = max(type_scores, key=type_scores.get)
    else:
        dominant_niche_type = "mixed"

    normalized_type_scores = {
        key: round(_clamp01(value), 4)
        for key, value in type_scores.items()
    }
    top_labels = [
        {"label": label, "score": round(float(score), 4)}
        for label, score in label_scores.most_common(3)
    ]

    return {
        "dominant_niche_type": dominant_niche_type,
        "type_scores": normalized_type_scores,
        "top_labels": top_labels,
        "overlap_ratio": round(_clamp01(total_overlap), 4),
        "water_overlap_ratio": round(_clamp01(water_overlap), 4),
        "feature_hits": int(feature_hits),
    }


def build_niche_profile(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_category: str,
    semantic_anchor: Dict[str, Any],
    landuse_context: Dict[str, Any],
    category_of: Callable[[Dict[str, Any]], str],
) -> Dict[str, Any]:
    names_text = " ".join(str(poi.get("name") or "") for poi in cluster_pois[:180])
    categories_text = " ".join(
        category_of(poi)
        for poi in cluster_pois[:180]
    )
    text_scores = score_niche_keywords(names_text)
    category_scores = score_niche_keywords(categories_text + " " + str(dominant_category or ""))

    scores: Dict[str, float] = {
        "ecology": 0.0,
        "commerce": 0.0,
        "education": 0.0,
    }

    for niche in scores:
        scores[niche] += 0.18 * text_scores.get(niche, 0.0)
        scores[niche] += 0.12 * category_scores.get(niche, 0.0)

    anchor_hint = str((semantic_anchor or {}).get("niche_hint") or "")
    anchor_conf = _to_float((semantic_anchor or {}).get("confidence")) or 0.0
    if anchor_hint in scores:
        scores[anchor_hint] += 0.46 * _clamp01(anchor_conf)

    landuse_scores = (landuse_context or {}).get("type_scores") or {}
    for niche in scores:
        scores[niche] += 0.24 * _clamp01(float(landuse_scores.get(niche, 0.0)))

    landuse_dominant = str((landuse_context or {}).get("dominant_niche_type") or "")
    landuse_overlap = _to_float((landuse_context or {}).get("overlap_ratio")) or 0.0
    if landuse_dominant in scores:
        scores[landuse_dominant] += 0.08 * _clamp01(landuse_overlap)

    top_niche = max(scores, key=scores.get)
    top_score = _clamp01(float(scores[top_niche]))
    score_sum = sum(float(value) for value in scores.values())
    consistency = _clamp01(top_score / score_sum) if score_sum > 0 else 0.0

    if top_score < 0.24:
        niche_type = "mixed"
        confidence = _clamp01(top_score * 0.8)
    else:
        niche_type = top_niche
        confidence = _clamp01(0.62 * top_score + 0.38 * consistency)

    return {
        "niche_type": niche_type,
        "confidence": round(confidence, 4),
        "consistency": round(consistency, 4),
        "scores": {key: round(_clamp01(float(value)), 4) for key, value in scores.items()},
        "anchor_hint": anchor_hint or None,
        "landuse_dominant_type": landuse_dominant or "mixed",
        "landuse_overlap_ratio": round(_clamp01(landuse_overlap), 4),
    }


def apply_water_overlap_penalty(
    *,
    boundary_quality: Dict[str, Any],
    niche_profile: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    if not isinstance(boundary_quality, dict):
        return {}

    updated = dict(boundary_quality)
    base_score = _clamp01(_to_float(updated.get("quality_score")) or 0.0)
    water_overlap_ratio = _clamp01(_to_float((landuse_context or {}).get("water_overlap_ratio")) or 0.0)
    niche_type = str((niche_profile or {}).get("niche_type") or "mixed")

    penalty = 0.0
    if water_overlap_ratio >= 0.12 and niche_type != "ecology":
        penalty_factor = {
            "commerce": 0.24,
            "education": 0.20,
            "mixed": 0.22,
        }.get(niche_type, 0.18)
        penalty = min(0.28, water_overlap_ratio * penalty_factor)

    updated["quality_score_before_water_penalty"] = round(base_score, 4)
    updated["water_overlap_ratio"] = round(water_overlap_ratio, 4)
    updated["water_penalty"] = round(float(penalty), 4)
    updated["quality_score"] = round(_clamp01(base_score - penalty), 4)
    if penalty > 0:
        updated["water_penalty_model"] = "niche_water_overlap_v1"

    return updated


def build_semantic_reasoning_payload(
    *,
    semantic_anchor: Dict[str, Any],
    niche_profile: Dict[str, Any],
    landuse_context: Dict[str, Any],
) -> Dict[str, Any]:
    evidence: List[Dict[str, Any]] = []
    anchor_name = str((semantic_anchor or {}).get("name") or "").strip()
    if anchor_name:
        evidence.append(
            {
                "type": "anchor",
                "name": anchor_name,
                "confidence": round(float((semantic_anchor or {}).get("confidence", 0.0)), 4),
                "source": str((semantic_anchor or {}).get("source") or "rule_fragment_v1"),
            }
        )

    overlap_ratio = _to_float((landuse_context or {}).get("overlap_ratio")) or 0.0
    water_overlap_ratio = _to_float((landuse_context or {}).get("water_overlap_ratio")) or 0.0
    top_labels = (landuse_context or {}).get("top_labels") or []
    if overlap_ratio > 0:
        evidence.append(
            {
                "type": "landuse",
                "overlap_ratio": round(_clamp01(overlap_ratio), 4),
                "top_labels": top_labels[:2],
            }
        )
    if water_overlap_ratio > 0:
        evidence.append(
            {
                "type": "water_context",
                "overlap_ratio": round(_clamp01(water_overlap_ratio), 4),
            }
        )

    evidence.append(
        {
            "type": "niche_decision",
            "niche_type": str((niche_profile or {}).get("niche_type") or "mixed"),
            "confidence": round(float((niche_profile or {}).get("confidence", 0.0)), 4),
            "consistency": round(float((niche_profile or {}).get("consistency", 0.0)), 4),
        }
    )

    return {
        "engine": "rule_reasoner_v1",
        "niche_type": str((niche_profile or {}).get("niche_type") or "mixed"),
        "evidence": evidence,
    }
