# -*- coding: utf-8 -*-
"""
POI 编码器模块
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class POITransformerEncoder(nn.Module):
    """
    POI Transformer 编码器（基于V1设计）

    输入：
        - poi_features: [B, F] POI特征 (landuse, road_class, numerical)
        - poi_coords: [B, 2] POI坐标 (lng, lat)

    输出：
        - embedding: [B, D] POI表示向量
    """

    def __init__(self, config):
        super().__init__()
        self.embed_dim = config.embed_dim

        # Embedding层
        self.landuse_embedding = nn.Embedding(13, config.embed_dim)  # 13种土地利用
        self.road_class_embedding = nn.Embedding(27, config.embed_dim)  # 27种道路类型

        # 数值特征投影
        self.num_proj = nn.Sequential(
            nn.Linear(3, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.GELU(),
        )

        # 坐标投影
        self.coord_proj = nn.Sequential(
            nn.Linear(2, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.GELU(),
        )

        # Token类型嵌入
        self.token_type_embedding = nn.Embedding(4, config.embed_dim)

        # CLS token
        self.cls_token = nn.Parameter(torch.zeros(1, 1, config.embed_dim))

        # Transformer层
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=config.embed_dim,
            nhead=config.transformer_heads,
            dim_feedforward=config.transformer_ffn_dim,
            dropout=config.dropout,
            batch_first=True,
            norm_first=True,
            activation="gelu",
        )
        self.transformer = nn.TransformerEncoder(
            encoder_layer,
            num_layers=config.transformer_layers,
        )

        # 输出头
        self.output_head = nn.Sequential(
            nn.Linear(config.embed_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, poi_features: torch.Tensor, poi_coords: torch.Tensor) -> torch.Tensor:
        """
        Args:
            poi_features: [B, F] 其中F=5 (landuse, road_class, 3个数值)
            poi_coords: [B, 2]

        Returns:
            embedding: [B, D]
        """
        B = poi_features.size(0)

        # 提取特征
        lu_idx = poi_features[:, 0].long().clamp(0, 12)
        rc_idx = poi_features[:, 1].long().clamp(0, 26)
        num_x = poi_features[:, 2:5].float()
        coord_x = poi_coords.float()

        # Embedding
        tokens = [
            self.landuse_embedding(lu_idx),       # [B, D]
            self.road_class_embedding(rc_idx),    # [B, D]
            self.num_proj(num_x),                  # [B, D]
            self.coord_proj(coord_x),              # [B, D]
        ]

        # Stack tokens: [B, 4, D]
        x = torch.stack(tokens, dim=1)

        # Token type
        type_ids = torch.tensor([0, 1, 2, 3], device=x.device).unsqueeze(0).expand(B, -1)
        x = x + self.token_type_embedding(type_ids)

        # Add CLS
        cls = self.cls_token.expand(B, -1, -1)
        x = torch.cat([cls, x], dim=1)

        # Transformer
        x = self.transformer(x)

        # Output
        out = self.output_head(x[:, 0])
        out = F.normalize(out, p=2, dim=-1)

        return out


class POIGraphEncoder(nn.Module):
    """
    POI 图编码器（基于V1的GraphEncoder）

    使用KNN图聚合邻居信息
    """

    def __init__(self, config):
        super().__init__()
        self.embed_dim = config.embed_dim
        self.hidden_dim = config.hidden_dim

        # Embedding
        self.landuse_emb = nn.Embedding(13, self.hidden_dim // 3)
        self.road_emb = nn.Embedding(27, self.hidden_dim // 3)
        self.num_proj = nn.Linear(3, self.hidden_dim // 3)
        self.coord_proj = nn.Linear(2, self.hidden_dim // 3)

        # 输入投影
        input_dim = self.hidden_dim
        self.input_proj = nn.Sequential(
            nn.Linear(input_dim, self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
            nn.ReLU(),
            nn.Dropout(config.dropout),
        )

        # GCN层
        self.gcn_layers = nn.ModuleList([
            nn.Linear(config.hidden_dim, config.hidden_dim)
            for _ in range(config.gnn_layers)
        ])
        self.norms = nn.ModuleList([
            nn.LayerNorm(config.hidden_dim)
            for _ in range(config.gnn_layers)
        ])

        # 输出投影
        self.output_proj = nn.Sequential(
            nn.Linear(config.hidden_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, poi_features: torch.Tensor, poi_coords: torch.Tensor,
                adj_matrix: torch.Tensor) -> torch.Tensor:
        """
        Args:
            poi_features: [N, F]
            poi_coords: [N, 2]
            adj_matrix: [N, N] 邻接矩阵（稀疏或稠密）

        Returns:
            embedding: [N, D]
        """
        N = poi_features.size(0)

        # Embedding
        lu_emb = self.landuse_emb(poi_features[:, 0].long().clamp(0, 12))
        rd_emb = self.road_emb(poi_features[:, 1].long().clamp(0, 26))
        num_emb = self.num_proj(poi_features[:, 2:5].float())
        coord_emb = self.coord_proj(poi_coords.float())

        # 拼接并投影
        x = torch.cat([lu_emb, rd_emb, num_emb, coord_emb], dim=-1)
        x = self.input_proj(x)

        # GCN层
        for i, (gcn, norm) in enumerate(zip(self.gcn_layers, self.norms)):
            x_new = gcn(x)
            x_new = norm(x_new)
            x_new = F.relu(x_new)

            # 图聚合
            if adj_matrix.dim() == 2:
                x_new = torch.matmul(adj_matrix, x_new)
            elif adj_matrix.dim() == 3:
                # 批量处理
                x_new = torch.bmm(adj_matrix, x_new)

            # 残差连接
            if i > 0:
                x = x + x_new
            else:
                x = x_new

        # 输出
        out = self.output_proj(x)
        out = F.normalize(out, p=2, dim=-1)

        return out
