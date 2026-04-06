# -*- coding: utf-8 -*-
"""
跨模态融合层

将POI编码、路网编码、AOI编码融合为统一的表示
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class ConcatFusion(nn.Module):
    """
    简单拼接融合

    直接将各模态embedding拼接，然后投影
    """

    def __init__(self, config, num_modalities: int = 3):
        super().__init__()
        self.embed_dim = config.embed_dim

        # 输入维度 = embed_dim * num_modalities
        self.proj = nn.Sequential(
            nn.Linear(config.embed_dim * num_modalities, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.ReLU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.embed_dim, config.embed_dim),
        )

    def forward(self, embeddings):
        """
        Args:
            embeddings: list of [B, D] tensors

        Returns:
            fused: [B, D]
        """
        combined = torch.cat(embeddings, dim=-1)
        out = self.proj(combined)
        out = F.normalize(out, p=2, dim=-1)
        return out


class GatingFusion(nn.Module):
    """
    门控融合

    使用门控机制学习各模态的权重
    """

    def __init__(self, config, num_modalities: int = 3):
        super().__init__()
        self.num_modalities = num_modalities

        # 门控网络
        self.gate = nn.Sequential(
            nn.Linear(config.embed_dim * num_modalities, config.embed_dim * num_modalities),
            nn.Sigmoid(),
        )

        # 投影
        self.proj = nn.Linear(config.embed_dim * num_modalities, config.embed_dim)

    def forward(self, embeddings):
        """
        Args:
            embeddings: list of [B, D]

        Returns:
            fused: [B, D]
        """
        combined = torch.cat(embeddings, dim=-1)

        # 门控权重
        gate = self.gate(combined)

        # 加权
        weighted = combined * gate

        # 投影
        out = self.proj(weighted)
        out = F.normalize(out, p=2, dim=-1)
        return out


class AttentionFusion(nn.Module):
    """
    注意力融合

    使用多头注意力机制融合多模态信息
    """

    def __init__(self, config, num_modalities: int = 3):
        super().__init__()
        self.num_modalities = num_modalities

        # 为每个模态创建Query
        self.query_proj = nn.ModuleList([
            nn.Linear(config.embed_dim, config.embed_dim)
            for _ in range(num_modalities)
        ])

        # Key和Value共享
        self.key_proj = nn.Linear(config.embed_dim, config.embed_dim)
        self.value_proj = nn.Linear(config.embed_dim, config.embed_dim)

        # 输出投影
        self.out_proj = nn.Linear(config.embed_dim, config.embed_dim)

        # 层归一化
        self.norm = nn.LayerNorm(config.embed_dim)

    def forward(self, embeddings):
        """
        Args:
            embeddings: list of [B, D] tensors

        Returns:
            fused: [B, D]
        """
        B = embeddings[0].size(0)

        # Stack: [num_modalities, B, D]
        stacked = torch.stack(embeddings, dim=0)

        # Transpose: [B, num_modalities, D]
        stacked = stacked.transpose(0, 1)

        # 生成Query
        queries = torch.stack([
            self.query_proj[i](embeddings[i])
            for i in range(self.num_modalities)
        ], dim=1)  # [B, num_modalities, D]

        # 生成Key和Value
        keys = self.key_proj(stacked)  # [B, num_modalities, D]
        values = self.value_proj(stacked)  # [B, num_modalities, D]

        # 注意力
        attn_weights = torch.matmul(queries, keys.transpose(-2, -1)) / (queries.size(-1) ** 0.5)
        attn_weights = F.softmax(attn_weights, dim=-1)

        # 加权聚合
        context = torch.matmul(attn_weights, values)  # [B, num_modalities, D]

        # 聚合所有模态（平均）
        context = context.mean(dim=1)  # [B, D]

        # 输出投影
        out = self.out_proj(context)
        out = self.norm(out)
        out = F.normalize(out, p=2, dim=-1)

        return out


class CrossModalAttention(nn.Module):
    """
    跨模态交叉注意力

    允许不同模态之间相互注意
    """

    def __init__(self, config):
        super().__init__()
        self.config = config

        # 多头注意力
        self.self_attention = nn.MultiheadAttention(
            embed_dim=config.embed_dim,
            num_heads=config.transformer_heads,
            dropout=config.dropout,
            batch_first=True,
        )

        # FFN
        self.ffn = nn.Sequential(
            nn.Linear(config.embed_dim, config.transformer_ffn_dim),
            nn.ReLU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.transformer_ffn_dim, config.embed_dim),
        )

        self.norm1 = nn.LayerNorm(config.embed_dim)
        self.norm2 = nn.LayerNorm(config.embed_dim)

    def forward(self, embeddings):
        """
        Args:
            embeddings: list of [B, D] tensors

        Returns:
            fused: [B, D]
        """
        B = embeddings[0].size(0)

        # Stack: [num_modalities, B, D]
        x = torch.stack(embeddings, dim=0)

        # Self-attention
        attn_out, _ = self.self_attention(x, x, x)
        x = self.norm1(x + attn_out)

        # FFN
        ffn_out = self.ffn(x)
        x = self.norm2(x + ffn_out)

        # 平均池化
        out = x.mean(dim=0)
        out = F.normalize(out, p=2, dim=-1)

        return out


def get_fusion_module(config, num_modalities: int = 3):
    """
    工厂函数：获取融合模块
    """
    fusion_type = config.fusion_type.lower()

    if fusion_type == "concat":
        return ConcatFusion(config, num_modalities)
    elif fusion_type == "gating":
        return GatingFusion(config, num_modalities)
    elif fusion_type == "attention":
        return AttentionFusion(config, num_modalities)
    else:
        raise ValueError(f"Unknown fusion type: {fusion_type}")
