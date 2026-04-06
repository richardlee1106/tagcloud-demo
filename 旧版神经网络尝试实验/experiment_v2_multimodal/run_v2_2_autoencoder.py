# -*- coding: utf-8 -*-
"""
V2.2 多模态空间编码器 - 自编码器版本

核心改进：
- 放弃Triplet Loss，改用重构损失
- 目标：让模型学会"保留空间信息"
- 成功标准：Silhouette > 0.3

实验区域：guanggu_core（先用一个验证）
"""

import sys
import json
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, Tuple
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GATv2Conv
from torch_geometric.utils import add_self_loops
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.neighbors import kneighbors_graph

sys.path.append(str(Path(__file__).parent.parent / "spatial_encoder"))


@dataclass
class V22Config:
    # 数据
    data_dir: str = "D:/AAA_Edu/TagCloud/vite-project/scripts/experiment_data"
    area_name: str = "guanggu_core"

    # 模型
    embed_dim: int = 64
    hidden_dim: int = 128
    gat_heads: int = 4
    gat_layers: int = 2
    dropout: float = 0.1

    # 图构建
    knn_k: int = 10

    # 训练
    num_epochs: int = 500
    learning_rate: float = 1e-3
    weight_decay: float = 1e-5

    # 损失权重
    recon_weight: float = 1.0  # 坐标重构损失
    feature_weight: float = 0.1  # 特征重构损失（可选）

    # 标签
    n_clusters: int = 15

    # 设备
    device: str = "cuda" if torch.cuda.is_available() else "cpu"


def load_area_data(area_name: str, data_dir: str) -> Dict:
    """加载区域数据"""
    area_dir = Path(data_dir) / area_name

    with open(area_dir / "pois.geojson", 'r', encoding='utf-8') as f:
        pois = json.load(f)

    # 解析POI
    category_map, landuse_map, aoi_type_map, road_class_map = {}, {}, {}, {}
    poi_coords, poi_features = [], []

    for f in pois['features']:
        props = f['properties']
        coords = f['geometry']['coordinates']
        poi_coords.append(coords)

        # 离散特征映射
        cat = props.get('category_big', 'unknown') or 'unknown'
        if cat not in category_map:
            category_map[cat] = len(category_map)

        lu = props.get('land_use_type', 'unknown') or 'unknown'
        if lu not in landuse_map:
            landuse_map[lu] = len(landuse_map)

        aoi_type = props.get('aoi_type', 'unknown') or 'unknown'
        if aoi_type not in aoi_type_map:
            aoi_type_map[aoi_type] = len(aoi_type_map)

        rc = props.get('nearest_road_class', 'unknown') or 'unknown'
        if rc not in road_class_map:
            road_class_map[rc] = len(road_class_map)

        # 数值特征
        density = float(props.get('poi_density_500m', 0) or 0)
        entropy = float(props.get('category_entropy', 0) or 0)
        road_dist = float(props.get('nearest_road_dist_m', 0) or 0)

        poi_features.append([
            category_map[cat], landuse_map[lu], aoi_type_map[aoi_type],
            road_class_map[rc], density, entropy, road_dist
        ])

    return {
        'coords': np.array(poi_coords, dtype=np.float32),
        'features': np.array(poi_features, dtype=np.float32),
        'metadata': {
            'num_pois': len(poi_coords),
            'num_categories': len(category_map),
            'num_landuses': len(landuse_map),
            'num_aoi_types': len(aoi_type_map),
            'num_road_classes': len(road_class_map),
        }
    }


class SpatialAutoEncoder(nn.Module):
    """
    空间自编码器 V2.2

    编码器：特征 + 坐标 -> GATv2 -> embedding
    解码器：embedding -> 坐标（重构）
    """

    def __init__(self, config: V22Config, num_categories: int, num_landuses: int,
                 num_aoi_types: int, num_road_classes: int):
        super().__init__()
        self.config = config
        self.embed_dim = config.embed_dim
        self.hidden_dim = config.hidden_dim

        # ===== 编码器 =====
        # Embedding层
        self.category_emb = nn.Embedding(num_categories + 1, self.hidden_dim // 6)
        self.landuse_emb = nn.Embedding(num_landuses + 1, self.hidden_dim // 6)
        self.aoi_type_emb = nn.Embedding(num_aoi_types + 1, self.hidden_dim // 6)
        self.road_class_emb = nn.Embedding(num_road_classes + 1, self.hidden_dim // 6)
        self.num_proj = nn.Linear(3, self.hidden_dim // 6)
        self.coord_proj = nn.Linear(2, self.hidden_dim // 6)

        # 输入投影
        input_dim = self.hidden_dim // 6 * 6
        self.input_proj = nn.Sequential(
            nn.Linear(input_dim, self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
            nn.GELU(),
        )

        # GATv2层（简化版：用MLP替代，避免图聚合干扰）
        self.use_gat = False  # 禁用GATv2，先用简单MLP
        if self.use_gat:
            self.gat_layers = nn.ModuleList([
                GATv2Conv(self.hidden_dim, self.hidden_dim // config.gat_heads,
                          heads=config.gat_heads, concat=True, dropout=config.dropout)
                for _ in range(config.gat_layers)
            ])
            self.gat_norms = nn.ModuleList([
                nn.LayerNorm(self.hidden_dim) for _ in range(config.gat_layers)
            ])
        else:
            # 简单MLP层
            self.mlp_layers = nn.Sequential(
                nn.Linear(self.hidden_dim, self.hidden_dim),
                nn.LayerNorm(self.hidden_dim),
                nn.GELU(),
                nn.Linear(self.hidden_dim, self.hidden_dim),
                nn.LayerNorm(self.hidden_dim),
                nn.GELU(),
            )

        # 输出投影（encoder output）
        self.encoder_out = nn.Sequential(
            nn.Linear(self.hidden_dim, self.embed_dim),
            nn.LayerNorm(self.embed_dim),
        )

        # ===== 解码器 =====
        # 坐标重构头
        self.coord_decoder = nn.Sequential(
            nn.Linear(self.embed_dim, self.hidden_dim),
            nn.ReLU(),
            nn.Linear(self.hidden_dim, self.hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(self.hidden_dim // 2, 2),  # 输出坐标
        )

    def encode(self, features: torch.Tensor, coords: torch.Tensor,
               edge_index: torch.Tensor) -> torch.Tensor:
        """编码：输入 -> embedding"""
        # Embedding
        cat_emb = self.category_emb(features[:, 0].long())
        lu_emb = self.landuse_emb(features[:, 1].long())
        aoi_emb = self.aoi_type_emb(features[:, 2].long())
        rc_emb = self.road_class_emb(features[:, 3].long())
        num_emb = self.num_proj(features[:, 4:7])

        # 坐标归一化
        coords_norm = (coords - coords.mean(dim=0)) / (coords.std(dim=0) + 1e-8)
        coord_emb = self.coord_proj(coords_norm)

        # 拼接
        x = torch.cat([cat_emb, lu_emb, aoi_emb, rc_emb, num_emb, coord_emb], dim=-1)
        x = self.input_proj(x)

        # GATv2或MLP
        if self.use_gat:
            for i, (gat, norm) in enumerate(zip(self.gat_layers, self.gat_norms)):
                x_new = gat(x, edge_index)
                x_new = norm(x_new)
                x_new = F.gelu(x_new)
                x = x + x_new  # 残差
        else:
            x = x + self.mlp_layers(x)  # MLP + 残差

        # 输出
        z = self.encoder_out(x)
        return F.normalize(z, p=2, dim=-1)

    def decode_coord(self, z: torch.Tensor) -> torch.Tensor:
        """解码：embedding -> 坐标"""
        return self.coord_decoder(z)

    def forward(self, features: torch.Tensor, coords: torch.Tensor,
                edge_index: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """前向传播：编码 + 解码"""
        z = self.encode(features, coords, edge_index)
        coord_recon = self.decode_coord(z)
        return z, coord_recon


def build_knn_graph(coords: np.ndarray, k: int = 10) -> torch.Tensor:
    """构建KNN图"""
    n = len(coords)
    k = min(k, n - 1)
    adj = kneighbors_graph(coords, n_neighbors=k, mode='connectivity', include_self=False)
    row, col = adj.nonzero()
    edge_index = torch.from_numpy(np.stack([row, col], axis=0)).long()
    edge_index, _ = add_self_loops(edge_index, num_nodes=n)
    return edge_index


def run_v22_experiment(config: V22Config):
    """运行V2.2实验"""
    print("=" * 70)
    print(f"V2.2 空间自编码器实验: {config.area_name}")
    print("=" * 70)

    device = torch.device(config.device)
    print(f"设备: {device}")

    # 1. 加载数据
    print("\n[1] 加载数据...")
    data = load_area_data(config.area_name, config.data_dir)

    coords = data['coords']
    features = data['features']
    metadata = data['metadata']

    print(f"  POI数量: {metadata['num_pois']}")
    print(f"  类别数: {metadata['num_categories']}")
    print(f"  土地利用类型: {metadata['num_landuses']}")
    print(f"  AOI类型: {metadata['num_aoi_types']}")
    print(f"  道路等级: {metadata['num_road_classes']}")

    # 2. 构建图
    print("\n[2] 构建KNN图...")
    edge_index = build_knn_graph(coords, k=config.knn_k)
    print(f"  边数: {edge_index.shape[1]}")

    # 3. 生成标签
    print("\n[3] 生成空间聚类标签...")
    kmeans = KMeans(n_clusters=config.n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(coords)
    print(f"  聚类数: {config.n_clusters}")

    # 计算理论上限
    sil_upper_bound = silhouette_score(coords, labels)
    print(f"  理论上限（原始坐标）: {sil_upper_bound:.4f}")

    # 4. 标准化坐标（用于重构目标）
    coords_mean = coords.mean(axis=0)
    coords_std = coords.std(axis=0)
    coords_norm = (coords - coords_mean) / coords_std

    # 5. 创建模型
    print("\n[4] 创建模型...")
    model = SpatialAutoEncoder(
        config,
        num_categories=metadata['num_categories'],
        num_landuses=metadata['num_landuses'],
        num_aoi_types=metadata['num_aoi_types'],
        num_road_classes=metadata['num_road_classes'],
    ).to(device)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"  参数量: {total_params:,}")

    # 6. 训练
    print("\n[5] 开始训练...")
    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate,
                                  weight_decay=config.weight_decay)

    features_t = torch.from_numpy(features).float().to(device)
    coords_t = torch.from_numpy(coords).float().to(device)
    coords_norm_t = torch.from_numpy(coords_norm).float().to(device)
    edge_index = edge_index.to(device)

    best_sil = -1.0
    history = []

    for epoch in range(config.num_epochs):
        model.train()
        optimizer.zero_grad()

        # 前向传播
        z, coord_recon = model(features_t, coords_t, edge_index)

        # 重构损失
        loss_recon = F.mse_loss(coord_recon, coords_norm_t)

        loss = config.recon_weight * loss_recon

        # 反向传播
        loss.backward()
        optimizer.step()

        # 评估
        if epoch % 20 == 0 or epoch == config.num_epochs - 1:
            model.eval()
            with torch.no_grad():
                z = model.encode(features_t, coords_t, edge_index)
                z_np = z.cpu().numpy()
                sil = silhouette_score(z_np, labels)

            history.append({'epoch': epoch, 'loss': loss.item(), 'silhouette': sil})

            if sil > best_sil:
                best_sil = sil

            print(f"  Epoch {epoch:3d} | Loss={loss.item():.6f} | Sil={sil:.4f} | Best={best_sil:.4f}")

    # 7. 最终结果
    print("\n" + "=" * 70)
    print("实验结果")
    print("=" * 70)
    print(f"最佳 Silhouette: {best_sil:.4f}")
    print(f"理论上限: {sil_upper_bound:.4f}")
    print(f"达成率: {best_sil / sil_upper_bound * 100:.1f}%")

    if best_sil > 0.3:
        print("\n结论: V2.2 成功！模型学到了空间表示")
        return {'success': True, 'silhouette': best_sil, 'history': history}
    else:
        print("\n结论: 效果有限，需要进一步优化")
        return {'success': False, 'silhouette': best_sil, 'history': history}


if __name__ == "__main__":
    config = V22Config()
    results = run_v22_experiment(config)
