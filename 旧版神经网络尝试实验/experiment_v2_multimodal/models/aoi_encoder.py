# -*- coding: utf-8 -*-
"""
AOI (Area of Interest) 编码器模块

核心思路：
- AOI是多边形数据，表示功能区域
- 编码：1) 边界形状 2) 功能类型
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class AOIPolygonEncoder(nn.Module):
    """
    AOI 多边形编码器

    使用RNN编码多边形边界
    """

    def __init__(self, config):
        super().__init__()
        self.config = config

        # 边界的点编码
        self.point_encoder = nn.Sequential(
            nn.Linear(2, config.hidden_dim),
            nn.LayerNorm(config.hidden_dim),
            nn.GELU(),
        )

        # RNN编码边界形状
        self.boundary_rnn = nn.LSTM(
            input_size=config.hidden_dim,
            hidden_size=config.hidden_dim,
            num_layers=1,
            batch_first=True,
            bidirectional=True,
        )

        # 功能类型嵌入
        num_aoi_types = 20  # 商业、居住、工业、公园等
        self.type_embedding = nn.Embedding(num_aoi_types, config.hidden_dim // 2)

        # 输出投影
        self.output_proj = nn.Sequential(
            nn.Linear(config.hidden_dim + config.hidden_dim // 2, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, polygons: torch.Tensor, aoi_types: torch.Tensor) -> torch.Tensor:
        """
        Args:
            polygons: [B, T, 2] 多边形边界点序列 (T个点)
            aoi_types: [B] AOI功能类型

        Returns:
            aoi_embedding: [B, D]
        """
        B, T, _ = polygons.shape

        # 编码边界点
        point_emb = self.point_encoder(polygons)  # [B, T, hidden_dim]

        # RNN编码边界形状
        boundary_out, (h_n, _) = self.boundary_rnn(point_emb)

        # 取最后一个隐状态（双向）
        boundary_emb = torch.cat([h_n[0], h_n[1]], dim=-1)  # [B, hidden_dim]

        # 编码功能类型
        type_emb = self.type_embedding(aoi_types.long().clamp(0, 19))  # [B, hidden_dim//2]

        # 融合
        combined = torch.cat([boundary_emb, type_emb], dim=-1)

        # 输出
        out = self.output_proj(combined)
        out = F.normalize(out, p=2, dim=-1)

        return out


class AOIConvEncoder(nn.Module):
    """
    AOI 卷积编码器

    使用1D卷积编码多边形边界
    """

    def __init__(self, config):
        super().__init__()
        self.config = config

        # 边界的点编码
        self.point_encoder = nn.Sequential(
            nn.Linear(2, config.hidden_dim),
            nn.LayerNorm(config.hidden_dim),
            nn.GELU(),
        )

        # 1D卷积层
        self.conv_layers = nn.ModuleList([
            nn.Conv1d(config.hidden_dim, config.hidden_dim, kernel_size=3, padding=1),
            nn.Conv1d(config.hidden_dim, config.embed_dim, kernel_size=3, padding=1),
        ])

        self.norms = nn.ModuleList([
            nn.LayerNorm(config.hidden_dim),
            nn.LayerNorm(config.embed_dim),
        ])

        # 功能类型嵌入
        num_aoi_types = 20
        self.type_embedding = nn.Embedding(num_aoi_types, config.embed_dim // 2)

        # 输出
        self.output_proj = nn.Sequential(
            nn.Linear(config.embed_dim + config.embed_dim // 2, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, polygons: torch.Tensor, aoi_types: torch.Tensor) -> torch.Tensor:
        """
        Args:
            polygons: [B, T, 2] 多边形边界点序列
            aoi_types: [B] AOI功能类型

        Returns:
            aoi_embedding: [B, D]
        """
        # 编码边界点: [B, T, 2] -> [B, T, hidden_dim]
        point_emb = self.point_encoder(polygons)

        # 转置为 [B, hidden_dim, T] 用于卷积
        x = point_emb.transpose(1, 2)

        # 卷积
        for conv, norm in zip(self.conv_layers, self.norms):
            x = conv(x)
            x = norm(x)
            x = F.relu(x)

        # 全局池化
        boundary_emb = x.mean(dim=-1)  # [B, embed_dim]

        # 功能类型
        type_emb = self.type_embedding(aoi_types.long().clamp(0, 19))

        # 融合
        combined = torch.cat([boundary_emb, type_emb], dim=-1)

        # 输出
        out = self.output_proj(combined)
        out = F.normalize(out, p=2, dim=-1)

        return out


class AOIQueryEncoder(nn.Module):
    """
    查询POI属于哪个AOI的编码器

    用于将POI的AOI信息注入POI编码
    """

    def __init__(self, config):
        super().__init__()
        self.config = config

        # POI到AOI的映射编码
        self.aoi_lookup = nn.Embedding(10000, config.embed_dim)  # 最多10000个AOI

    def forward(self, poi_aoi_ids: torch.Tensor, aoi_embeddings: torch.Tensor) -> torch.Tensor:
        """
        Args:
            poi_aoi_ids: [N] 每个POI所属的AOI ID
            aoi_embeddings: [M, D] AOI表示

        Returns:
            poi_aoi_emb: [N, D]
        """
        # 方法1: 查表
        poi_aoi_emb = self.aoi_lookup(poi_aoi_ids.long().clamp(0, 9999))

        # 方法2: 使用预计算的AOI embeddings（如果有）
        # poi_aoi_emb = aoi_embeddings[poi_aoi_ids]

        return poi_aoi_emb
