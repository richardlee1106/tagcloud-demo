# -*- coding: utf-8 -*-
"""空间片区结果自校验模块。"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

_DEFAULT_CRITIC_THRESHOLD = 0.45
_ISSUE_FIX_SUGGESTIONS = {
    "boundary_quality_low": "提升边界质量评分，检查边界抽样与形态学平滑参数。",
    "coverage_low": "提高覆盖率，补充边缘 POI 或放宽候选检索范围。",
    "anchor_confidence_low": "增强语义锚点可信度，补充高置信地标或别名。",
    "confidence_quality_mismatch": "校准置信度权重，避免高置信低质量不一致。"
}


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


def _build_critic_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    avg_score = _clamp01(_to_float(summary.get("avg_score")) or 0.0)
    low_score_count = int(summary.get("low_score_count") or 0)
    issue_counts = summary.get("issue_counts") if isinstance(summary.get("issue_counts"), dict) else {}
    ranked_issues = sorted(issue_counts.items(), key=lambda item: (-int(item[1]), str(item[0])))
    reasons = [str(issue) for issue, count in ranked_issues if int(count) > 0][:5]
    fix_suggestions = [_ISSUE_FIX_SUGGESTIONS.get(reason, f"检查问题：{reason}") for reason in reasons][:5]

    critic_pass = bool(avg_score >= _DEFAULT_CRITIC_THRESHOLD and low_score_count == 0)
    return {
        "critic_pass": critic_pass,
        "reasons": reasons,
        "fix_suggestions": fix_suggestions,
        "confidence": round(avg_score, 4),
    }


def validate_cluster_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """对单个聚类结果执行一致性自检并输出可解释分数。"""
    boundary_quality = entry.get("boundary_quality") or {}
    semantic_anchor = entry.get("semantic_anchor") or {}
    niche_profile = entry.get("niche_profile") or {}
    semantic_reasoning = entry.get("semantic_reasoning") or {}

    quality_score = _clamp01(_to_float(boundary_quality.get("quality_score")) or 0.0)
    coverage_score = _clamp01(_to_float(boundary_quality.get("coverage_ratio")) or 0.0)
    boundary_confidence = _clamp01(_to_float(entry.get("boundary_confidence")) or 0.0)
    confidence_consistency = _clamp01(1.0 - abs(boundary_confidence - quality_score))

    anchor_name = str(semantic_anchor.get("name") or "").strip()
    anchor_confidence = _clamp01(_to_float(semantic_anchor.get("confidence")) or 0.0)
    niche_consistency = _clamp01(_to_float(niche_profile.get("consistency")) or 0.0)
    semantic_score = (
        _clamp01(0.55 * anchor_confidence + 0.45 * niche_consistency)
        if anchor_name
        else _clamp01(0.35 * niche_consistency)
    )

    evidence = semantic_reasoning.get("evidence") if isinstance(semantic_reasoning.get("evidence"), list) else []
    evidence_score = _clamp01(len(evidence) / 3.0)

    score = _clamp01(
        0.30 * quality_score
        + 0.20 * coverage_score
        + 0.22 * semantic_score
        + 0.16 * evidence_score
        + 0.12 * confidence_consistency
    )

    issues: List[str] = []
    if quality_score < 0.40:
        issues.append("boundary_quality_low")
    if coverage_score < 0.35:
        issues.append("coverage_low")
    if anchor_name and anchor_confidence < 0.45:
        issues.append("anchor_confidence_low")
    if boundary_confidence > 0.75 and quality_score < 0.45:
        issues.append("confidence_quality_mismatch")

    return {
        "score": round(score, 4),
        "breakdown": {
            "quality": round(quality_score, 4),
            "coverage": round(coverage_score, 4),
            "semantic": round(semantic_score, 4),
            "evidence": round(evidence_score, 4),
            "consistency": round(confidence_consistency, 4),
        },
        "issues": issues,
    }


def validate_cluster_entries(cluster_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """批量执行自校验并输出汇总指标。"""
    if not cluster_entries:
        empty_summary = {
            "model": "self_validation_v1",
            "avg_score": 0.0,
            "min_score": 0.0,
            "max_score": 0.0,
            "low_score_count": 0,
            "issue_counts": {},
        }
        return {
            "cluster_scores": {},
            "cluster_reports": [],
            "summary": empty_summary,
            "critic": _build_critic_summary(empty_summary),
        }

    cluster_scores: Dict[int, float] = {}
    cluster_reports: List[Dict[str, Any]] = []
    scores: List[float] = []
    issue_counter: Counter[str] = Counter()

    for entry in cluster_entries:
        cluster_id = int(entry.get("id", 0))
        report = validate_cluster_entry(entry)
        score = float(report["score"])

        cluster_scores[cluster_id] = score
        scores.append(score)
        issue_counter.update(report.get("issues") or [])
        cluster_reports.append(
            {
                "id": cluster_id,
                "name": entry.get("name"),
                "score": score,
                "issues": report.get("issues") or [],
                "breakdown": report.get("breakdown") or {},
            }
        )

    avg_score = round(sum(scores) / len(scores), 4) if scores else 0.0
    min_score = round(min(scores), 4) if scores else 0.0
    max_score = round(max(scores), 4) if scores else 0.0

    summary = {
        "model": "self_validation_v1",
        "avg_score": avg_score,
        "min_score": min_score,
        "max_score": max_score,
        "low_score_count": sum(1 for score in scores if score < 0.45),
        "issue_counts": dict(issue_counter),
    }

    return {
        "cluster_scores": cluster_scores,
        "cluster_reports": cluster_reports,
        "summary": summary,
        "critic": _build_critic_summary(summary),
    }
