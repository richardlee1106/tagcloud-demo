"""多因素隶属度评分模型。"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class MembershipBreakdown:
    """隶属度拆解结果。"""

    score: float
    level: str
    density: float
    purity: float
    centrality: float
    compactness: float
    scale: float


def clamp(value: float) -> float:
    """将输入限制到 [0, 1]。"""
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def compute_membership(
    *,
    density: float,
    purity: float,
    centrality: float,
    compactness: float,
    scale: float,
    niche_type: str = "mixed",
) -> MembershipBreakdown:
    """按生态位动态调整权重计算 membership 分数与层级。"""
    density = clamp(density)
    purity = clamp(purity)
    centrality = clamp(centrality)
    compactness = clamp(compactness)
    scale = clamp(scale)

    if niche_type in ("ecology", "education", "industrial"):
        # 大型稀疏功能区 (生态公园/大学城/工业园):
        # 宽容点密度降低（0.30 -> 0.15），对规模、纯度更为看重
        base_score = (
            0.15 * density
            + 0.35 * purity
            + 0.15 * centrality
            + 0.15 * compactness
            + 0.20 * scale
        )
    else:
        # 常规聚落 (商圈/住宅):
        # 对点密度（0.30）和中心性敏感
        base_score = (
            0.30 * density
            + 0.25 * purity
            + 0.20 * centrality
            + 0.15 * compactness
            + 0.10 * scale
        )

    purity_compactness_synergy = 0.08 * math.sqrt(max(0.0, purity * compactness))
    small_cluster_compensation = 0.06 * purity * (1.0 - density) * (1.0 - scale)
    instability_penalty = 0.05 * max(0.0, 0.35 - compactness)
    score = clamp(base_score + purity_compactness_synergy + small_cluster_compensation - instability_penalty)

    if score >= 0.72:
        level = "core"
    elif score >= 0.45:
        level = "transition"
    else:
        level = "periphery"

    return MembershipBreakdown(
        score=round(score, 5),
        level=level,
        density=density,
        purity=purity,
        centrality=centrality,
        compactness=compactness,
        scale=scale,
    )
