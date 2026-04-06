# -*- coding: utf-8 -*-
"""
V2 多模态空间编码器 - 修正版

核心改进（基于用户反馈）：
1. POI使用GATv2（KNN图），而不是Transformer
2. 路网使用GATv2（拓扑图），更自然
3. 统一使用GATv2处理图数据
"""

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent / "spatial_encoder"))

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GATv2Conv
from torch_geometric.utils import add_self_loops
import numpy as np


class GATv2POIEncoder(nn.Module):
    """
    POI编码器 - 使用GATv2（基于V61验证有效的架构）

    输入：
        - POI特征: [N, F] (category, landuse, road_class, 3个数值)
        - POI坐标: [N, 2]
        - 邻接矩阵: [N, N] (KNN图)

    输出：
        - embedding: [N, D]
    """

    def __init__(self, config):
        super().__init__()
        self.embed_dim = config.embed_dim
        self.hidden_dim = config.hidden_dim

        # Embedding层（处理离散特征）
        # 5个模态，每个 hidden_dim // 4，总共 5 * (hidden_dim // 4)
        self.category_emb = nn.Embedding(50, self.hidden_dim // 5)
        self.landuse_emb = nn.Embedding(13, self.hidden_dim // 5)
        self.road_class_emb = nn.Embedding(27, self.hidden_dim // 5)

        # 数值特征投影
        self.num_proj = nn.Linear(3, self.hidden_dim // 5)

        # 坐标投影
        self.coord_proj = nn.Linear(2, self.hidden_dim // 5)

        # 输入投影：5个模态拼接
        input_dim = self.hidden_dim // 5 * 5  # = hidden_dim
        self.input_proj = nn.Sequential(
            nn.Linear(input_dim, self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
            nn.GELU(),
            nn.Dropout(config.dropout),
        )

        # GATv2层（使用与V61相同的配置）
        self.gat_layers = nn.ModuleList([
            GATv2Conv(self.hidden_dim, self.hidden_dim // 4, heads=4, concat=True, dropout=config.dropout),
            GATv2Conv(self.hidden_dim, self.hidden_dim // 4, heads=4, concat=True, dropout=config.dropout),
        ])

        self.norms = nn.ModuleList([
            nn.LayerNorm(self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
        ])

        # 输出投影
        self.output_proj = nn.Sequential(
            nn.Linear(config.hidden_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, poi_features, poi_coords, edge_index, edge_weight=None):
        """
        Args:
            poi_features: [N, F]
            poi_coords: [N, 2]
            edge_index: [2, E] 边索引
            edge_weight: [E] 边权重（可选）

        Returns:
            embedding: [N, D]
        """
        N = poi_features.size(0)

        # Embedding
        cat_emb = self.category_emb(poi_features[:, 0].long().clamp(0, 49))
        lu_emb = self.landuse_emb(poi_features[:, 1].long().clamp(0, 12))
        rc_emb = self.road_class_emb(poi_features[:, 2].long().clamp(0, 26))
        num_emb = self.num_proj(poi_features[:, 3:6].float())
        coord_emb = self.coord_proj(poi_coords)

        # 拼接
        x = torch.cat([cat_emb, lu_emb, rc_emb, num_emb, coord_emb], dim=-1)
        x = self.input_proj(x)

        # GATv2层（带残差连接）
        for i, (gat, norm) in enumerate(zip(self.gat_layers, self.norms)):
            x_new = gat(x, edge_index, edge_weight)
            x_new = norm(x_new)
            x_new = F.gelu(x_new)

            if i > 0:  # 残差连接
                x = x + x_new
            else:
                x = x_new

        # 输出
        out = self.output_proj(x)
        out = F.normalize(out, p=2, dim=-1)

        return out


class GATv2RoadEncoder(nn.Module):
    """
    路网编码器 - 使用GATv2

    输入：
        - 道路节点特征: [M, F] (坐标, 道路等级, 度中心性等)
        - 道路边: [2, E] (连通性)

    输出：
        - embedding: [M, D]
    """

    def __init__(self, config):
        super().__init__()
        self.embed_dim = config.embed_dim
        self.hidden_dim = config.hidden_dim

        # 节点特征编码
        self.node_feature_proj = nn.Sequential(
            nn.Linear(8, self.hidden_dim),  # 坐标 + 道路等级 + 度中心性
            nn.LayerNorm(self.hidden_dim),
            nn.GELU(),
        )

        # GATv2层
        self.gat_layers = nn.ModuleList([
            GATv2Conv(self.hidden_dim, self.hidden_dim // 4, heads=4, concat=True, dropout=config.dropout),
            GATv2Conv(self.hidden_dim, self.hidden_dim // 4, heads=4, concat=True, dropout=config.dropout),
        ])

        self.norms = nn.ModuleList([
            nn.LayerNorm(self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
        ])

        # 输出投影
        self.output_proj = nn.Sequential(
            nn.Linear(config.hidden_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, node_features, edge_index):
        """
        Args:
            node_features: [M, F] 节点特征
            edge_index: [2, E] 边索引

        Returns:
            embedding: [M, D]
        """
        # 投影
        x = self.node_feature_proj(node_features)

        # GATv2层
        for i, (gat, norm) in enumerate(zip(self.gat_layers, self.norms)):
            x_new = gat(x, edge_index)
            x_new = norm(x_new)
            x_new = F.gelu(x_new)

            if i > 0:
                x = x + x_new
            else:
                x = x_new

        # 输出
        out = self.output_proj(x)
        out = F.normalize(out, p=2, dim=-1)

        return out


class GATv2MultiModalEncoder(nn.Module):
    """
    多模态空间编码器 V2 - 修正版

    统一使用GATv2处理：
    - POI: KNN图（基于距离）
    - 路网: 拓扑图（基于连通性）

    融合：拼接 + 投影
    """

    def __init__(self, config):
        super().__init__()
        self.config = config

        # POI编码器
        self.poi_encoder = GATv2POIEncoder(config)

        # 路网编码器（可选）
        self.use_road = config.use_road
        if self.use_road:
            self.road_encoder = GATv2RoadEncoder(config)

        # 融合
        num_modalities = 1 + (1 if self.use_road else 0)
        self.fusion_proj = nn.Sequential(
            nn.Linear(config.embed_dim * num_modalities, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.ReLU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.embed_dim, config.embed_dim),
        )

    def forward(self, poi_data, road_data=None):
        """
        Args:
            poi_data: dict {
                'features': [N, F],
                'coords': [N, 2],
                'edge_index': [2, E],
                'edge_weight': [E] (optional)
            }
            road_data: dict {
                'node_features': [M, F],
                'edge_index': [2, E]
            } (optional)

        Returns:
            embedding: [N, D] (POI的表示)
        """
        embeddings = []

        # POI编码
        poi_emb = self.poi_encoder(
            poi_data['features'],
            poi_data['coords'],
            poi_data['edge_index'],
            poi_data.get('edge_weight')
        )
        embeddings.append(poi_emb)

        # 路网编码（可选）
        if self.use_road and road_data is not None:
            # 将POI映射到最近的道路节点
            # 这里简化处理：直接用道路编码的聚合结果
            # 实际实现需要：POI -> 道路节点映射

            # 简化版本：假设已经做好POI-道路映射
            road_emb = self.road_encoder(
                road_data['node_features'],
                road_data['edge_index']
            )
            embeddings.append(road_emb)

        # 融合
        if len(embeddings) == 1:
            return embeddings[0]
        else:
            combined = torch.cat(embeddings, dim=-1)
            out = self.fusion_proj(combined)
            out = F.normalize(out, p=2, dim=-1)
            return out


def build_knn_graph(coords, k=10):
    """
    构建KNN图

    Args:
        coords: [N, 2] 坐标
        k: 邻居数

    Returns:
        edge_index: [2, E]
    """
    from sklearn.neighbors import kneighbors_graph

    # KNN图
    adj = kneighbors_graph(coords, n_neighbors=k, mode='connectivity', include_self=False)

    # 转为边索引（修复警告）
    row, col = adj.nonzero()
    edge_index = torch.from_numpy(np.stack([row, col], axis=0)).long()

    # 添加自环
    edge_index, _ = add_self_loops(edge_index, num_nodes=len(coords))

    return edge_index


if __name__ == "__main__":
    # 测试
    from dataclasses import dataclass

    @dataclass
    class TestConfig:
        embed_dim: int = 256
        hidden_dim: int = 128
        dropout: float = 0.1
        use_road: bool = False

    config = TestConfig()

    # 模型
    model = GATv2MultiModalEncoder(config)

    # 模拟数据
    N = 100
    poi_features = torch.randint(0, 10, (N, 6))
    poi_coords = torch.rand(N, 2) * 0.1 + 114  # 武汉附近

    # KNN图
    edge_index = build_knn_graph(poi_coords.numpy(), k=10)

    poi_data = {
        'features': poi_features,
        'coords': poi_coords,
        'edge_index': edge_index,
    }

    # 前向传播
    model.eval()
    with torch.no_grad():
        out = model(poi_data)

    print(f"输入: {N} 个POI")
    print(f"输出: {out.shape}")
    print(f"模型参数量: {sum(p.numel() for p in model.parameters()):,}")
