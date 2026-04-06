# -*- coding: utf-8 -*-
"""
路网编码器模块

核心思路：
- 将路网建模为图结构
- 道路交叉口作为节点
- 道路段作为边
- 编码路网的拓扑结构
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, GATConv, SAGEConv
from torch_geometric.data import Data as PyGData


class RoadGNNEncoder(nn.Module):
    """
    路网GNN编码器

    输入：路网图（节点+边）
    输出：路网表示向量
    """

    def __init__(self, config):
        super().__init__()
        self.config = config

        # 节点特征编码
        self.node_feature_dim = 8  # 道路等级、长度等特征

        # GNN层
        gnn_type = config.gnn_type.lower()
        if gnn_type == "gcn":
            self.convs = nn.ModuleList([
                GCNConv(config.hidden_dim, config.hidden_dim),
                GCNConv(config.hidden_dim, config.embed_dim),
            ])
        elif gnn_type == "gat":
            self.convs = nn.ModuleList([
                GATConv(config.hidden_dim, config.hidden_dim // 4, heads=4),
                GATConv(config.hidden_dim, config.embed_dim, heads=1),
            ])
        elif gnn_type == "sage":
            self.convs = nn.ModuleList([
                SAGEConv(config.hidden_dim, config.hidden_dim),
                SAGEConv(config.hidden_dim, config.embed_dim),
            ])
        else:
            raise ValueError(f"Unknown GNN type: {gnn_type}")

        self.norms = nn.ModuleList([
            nn.LayerNorm(config.hidden_dim),
            nn.LayerNorm(config.embed_dim),
        ])

    def forward(self, road_data) -> torch.Tensor:
        """
        Args:
            road_data: PyG Data对象
                - x: [num_nodes, feature_dim] 节点特征
                - edge_index: [2, num_edges] 边索引

        Returns:
            road_embedding: [num_nodes, embed_dim]
        """
        x, edge_index = road_data.x, road_data.edge_index

        # GNN前向传播
        for i, (conv, norm) in enumerate(zip(self.convs, self.norms)):
            x_new = conv(x, edge_index)
            x_new = norm(x_new)

            if i < len(self.convs) - 1:
                x_new = F.relu(x_new)

            x = x + x_new  # 残差

        return F.normalize(x, p=2, dim=-1)


class RoadAwarePOIEncoder(nn.Module):
    """
    路网感知的POI编码器

    核心改进：不是基于坐标KNN找邻居，而是基于路网拓扑找可达邻居

    思路：
    1. 将POI映射到最近的道路节点
    2. 沿路网拓扑聚合邻居信息
    3. 结合道路属性（道路等级）加权
    """

    def __init__(self, config):
        super().__init__()
        self.config = config

        # 道路等级嵌入
        self.road_class_emb = nn.Embedding(10, config.hidden_dim // 2)

        # POI特征编码
        self.poi_proj = nn.Linear(5, config.hidden_dim // 2)

        # 道路可达性编码
        self.reachability_proj = nn.Sequential(
            nn.Linear(config.hidden_dim, config.hidden_dim),
            nn.LayerNorm(config.hidden_dim),
            nn.ReLU(),
        )

        # 输出
        self.output_proj = nn.Sequential(
            nn.Linear(config.hidden_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, poi_features: torch.Tensor, poi_to_road_map: torch.Tensor,
                road_embeddings: torch.Tensor) -> torch.Tensor:
        """
        Args:
            poi_features: [N, F] POI特征
            poi_to_road_map: [N] 每个POI映射到的道路节点ID
            road_embeddings: [M, D] 道路节点表示

        Returns:
            poi_embedding: [N, D]
        """
        # POI特征编码
        poi_emb = self.poi_proj(poi_features.float())

        # 映射到道路节点
        road_emb = road_embeddings[poi_to_road_map]  # [N, D]

        # 融合POI和道路信息
        combined = torch.cat([poi_emb, road_emb], dim=-1)
        combined = self.reachability_proj(combined)

        # 输出
        out = self.output_proj(combined)
        out = F.normalize(out, p=2, dim=-1)

        return out


class RoadGraphBuilder:
    """
    路网图构建器

    将原始路网数据转换为PyG格式
    """

    def __init__(self):
        pass

    @staticmethod
    def build_graph(road_nodes, road_edges):
        """
        构建路网图

        Args:
            road_nodes: [num_nodes, 3] 节点 (id, lng, lat)
            road_edges: [num_edges, 2] 边 (src, dst)

        Returns:
            PyG Data对象
        """
        # 节点特征：坐标 + 度中心性（后续可添加道路等级）
        node_features = []
        for node in road_nodes:
            lng, lat = node[1], node[2]
            node_features.append([lng, lat, 0, 0, 0, 0, 0, 0])  # 预留8维

        node_features = torch.tensor(node_features, dtype=torch.float32)

        # 边索引
        edge_index = torch.tensor(road_edges, dtype=torch.long).t().contiguous()

        # 构建PyG数据
        data = PyGData(
            x=node_features,
            edge_index=edge_index,
        )

        return data

    @staticmethod
    def map_poi_to_road(poi_coords, road_nodes, k=3):
        """
        将POI映射到最近的道路节点

        Args:
            poi_coords: [N, 2] POI坐标
            road_nodes: [M, 3] 道路节点 (id, lng, lat)
            k: 考虑最近的k个道路节点

        Returns:
            mapping: [N] 每个POI对应的道路节点ID
            distances: [N, k] 对应的距离
        """
        from sklearn.neighbors import NearestNeighbors

        road_coords = road_nodes[:, 1:3]  # [M, 2]

        nn_model = NearestNeighbors(n_neighbors=k, metric="euclidean")
        nn_model.fit(road_coords)

        distances, indices = nn_model.kneighbors(poi_coords)

        # 选择最近的一个
        min_idx = distances.argmin(axis=1)
        nearest_road = indices[min_idx, 0]

        return nearest_road, distances.min(axis=1)
