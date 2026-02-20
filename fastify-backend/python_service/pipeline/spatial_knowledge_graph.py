# -*- coding: utf-8 -*-
"""轻量级空间知识图谱（SKG）一致性评估。"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Tuple


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


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


_NICHE_CATEGORY_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "ecology": ("生态", "公园", "绿地", "湿地", "景区", "water", "lake", "river"),
    "commerce": ("商业", "餐饮", "零售", "购物", "商场", "综合体", "mall", "retail"),
    "education": ("教育", "高校", "大学", "学院", "校园", "school", "university", "campus"),
}

_NICHE_LANDUSE_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "ecology": ("水域", "绿地", "公园", "生态", "湿地", "河湖"),
    "commerce": ("商业", "商服", "混合", "商务", "综合"),
    "education": ("教育", "科研", "高校", "学校", "科教"),
}


def _infer_landuse_labels(entry: Dict[str, Any]) -> List[str]:
    landuse_semantic = entry.get("landuse_semantic") or {}
    labels = []
    for item in landuse_semantic.get("top_labels") or []:
        label = item.get("label") if isinstance(item, dict) else item
        if label:
            labels.append(str(label))
    for item in landuse_semantic.get("topLabels") or []:
        label = item.get("label") if isinstance(item, dict) else item
        if label:
            labels.append(str(label))
    return labels


def _infer_dominant_categories(entry: Dict[str, Any]) -> List[str]:
    categories: List[str] = []
    for item in entry.get("dominant_categories") or []:
        if isinstance(item, dict):
            category = item.get("category")
        else:
            category = item
        if category:
            categories.append(str(category))
    if not categories and entry.get("dominant_category"):
        categories.append(str(entry.get("dominant_category")))
    return categories


def _niche_match_score(niche_type: str, tokens: Iterable[str], keyword_map: Dict[str, Tuple[str, ...]]) -> float:
    normalized_niche = _normalize_text(niche_type)
    keywords = keyword_map.get(normalized_niche, ())
    if not keywords:
        return 0.5

    normalized_tokens = [_normalize_text(token) for token in tokens if _normalize_text(token)]
    if not normalized_tokens:
        return 0.35

    hit_count = 0
    for token in normalized_tokens:
        if any(keyword in token for keyword in keywords):
            hit_count += 1
    return _clamp01(hit_count / max(1, len(normalized_tokens)))


def _anchor_poi_match_score(anchor_name: str, poi_names: Iterable[str]) -> float:
    anchor = _normalize_text(anchor_name)
    if not anchor:
        return 0.35
    normalized_names = [_normalize_text(name) for name in poi_names if _normalize_text(name)]
    if not normalized_names:
        return 0.3

    if any(anchor in name for name in normalized_names):
        return 1.0

    # 次级匹配：至少命中 2 个字符片段
    fragments = {anchor[i : i + 2] for i in range(0, max(0, len(anchor) - 1))}
    if not fragments:
        return 0.3
    best_overlap = 0
    for name in normalized_names:
        overlap = sum(1 for fragment in fragments if fragment and fragment in name)
        best_overlap = max(best_overlap, overlap)
    return _clamp01(best_overlap / max(1, len(fragments)))


def evaluate_cluster_skg_consistency(entry: Dict[str, Any]) -> Dict[str, Any]:
    """对单个 cluster 计算 SKG 一致性分数。"""
    cluster_id = int(entry.get("id", 0))
    anchor_name = str((entry.get("semantic_anchor") or {}).get("name") or "")
    niche_type = str((entry.get("niche_profile") or {}).get("niche_type") or "mixed")
    niche_consistency = _clamp01(
        _to_float((entry.get("niche_profile") or {}).get("consistency")) or 0.0
    )

    poi_names = [str((poi or {}).get("name") or "") for poi in (entry.get("cluster_pois") or [])]
    dominant_categories = _infer_dominant_categories(entry)
    landuse_labels = _infer_landuse_labels(entry)
    evidence_count = len(((entry.get("semantic_reasoning") or {}).get("evidence") or []))

    anchor_score = _anchor_poi_match_score(anchor_name, poi_names)
    niche_category_score = _niche_match_score(niche_type, dominant_categories, _NICHE_CATEGORY_KEYWORDS)
    niche_landuse_score = _niche_match_score(niche_type, landuse_labels, _NICHE_LANDUSE_KEYWORDS)
    reasoning_score = _clamp01(evidence_count / 3.0)

    score = _clamp01(
        0.26 * anchor_score
        + 0.34 * niche_category_score
        + 0.24 * niche_landuse_score
        + 0.10 * niche_consistency
        + 0.06 * reasoning_score
    )

    # 仅统计逻辑关系边，不承载重图结构，保证低 Token 成本。
    edge_count = 0
    if anchor_name:
        edge_count += 1  # anchor -> cluster
    if niche_type and niche_type != "mixed":
        edge_count += 1  # cluster -> niche
    edge_count += max(0, len(dominant_categories[:3]))  # niche -> category
    edge_count += max(0, len(landuse_labels[:3]))  # niche -> landuse

    node_count = 2 + len(dominant_categories[:3]) + len(landuse_labels[:3])

    return {
        "id": cluster_id,
        "score": round(score, 4),
        "node_count": node_count,
        "edge_count": edge_count,
        "breakdown": {
            "anchor_match": round(anchor_score, 4),
            "niche_category_match": round(niche_category_score, 4),
            "niche_landuse_match": round(niche_landuse_score, 4),
            "niche_consistency": round(niche_consistency, 4),
            "reasoning_support": round(reasoning_score, 4),
        },
    }


def build_spatial_knowledge_graph(cluster_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """构建轻量 SKG 汇总，并返回每个 cluster 的一致性得分。"""
    if not cluster_entries:
        return {
            "cluster_scores": {},
            "cluster_reports": [],
            "graph": {
                "model": "skg_consistency_v1",
                "node_count": 0,
                "edge_count": 0,
                "cluster_count": 0,
            },
            "summary": {
                "avg_score": 0.0,
                "min_score": 0.0,
                "max_score": 0.0,
            },
        }

    reports = [evaluate_cluster_skg_consistency(entry) for entry in cluster_entries]
    scores = [float(report["score"]) for report in reports]
    cluster_scores = {int(report["id"]): float(report["score"]) for report in reports}

    return {
        "cluster_scores": cluster_scores,
        "cluster_reports": reports,
        "graph": {
            "model": "skg_consistency_v1",
            "node_count": int(sum(int(report["node_count"]) for report in reports)),
            "edge_count": int(sum(int(report["edge_count"]) for report in reports)),
            "cluster_count": len(reports),
            "token_profile": "low_token_summary_v1",
        },
        "summary": {
            "avg_score": round(sum(scores) / len(scores), 4) if scores else 0.0,
            "min_score": round(min(scores), 4) if scores else 0.0,
            "max_score": round(max(scores), 4) if scores else 0.0,
        },
    }

