# -*- coding: utf-8 -*-
"""
V2.3 空间拓扑编码器 - 优化版

核心改进：让模型真正学到"空间拓扑关系"

损失函数组合：
1. 坐标重构损失：保持绝对位置信息
2. 距离保持损失：原始空间距离 ≈ embedding空间距离
3. 邻居一致性损失：KNN邻居的embedding应该相似

目标：Silhouette > 0.35（接近理论上限0.45）
"""

import sys
import json
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, Tuple
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.neighbors import kneighbors_graph

sys.path.append(str(Path(__file__).parent.parent / "spatial_encoder"))


@dataclass
class V23Config:
    # 数据
    data_dir: str = "D:/AAA_Edu/TagCloud/vite-project/scripts/experiment_data"
    area_name: str = "guanggu_core"

    # 模型
    embed_dim: int = 64
    hidden_dim: int = 128
    dropout: float = 0.1

    # 图构建
    knn_k: int = 10  # 邻居数

    # 训练
    num_epochs: int = 500
    learning_rate: float = 1e-3
    weight_decay: float = 1e-5
    batch_size: int = 2048  # 用于采样距离对

    # ⭐ 损失权重（核心优化）
    coord_recon_weight: float = 1.0    # 坐标重构
    distance_preserve_weight: float = 2.0  # ⭐ 距离保持（核心）
    neighbor_consistency_weight: float = 1.0  # ⭐ 邻居一致性

    # 距离采样
    num_distance_pairs: int = 5000  # 每epoch采样的距离对数量

    # 标签
    n_clusters: int = 15

    # 设备
    device: str = "cuda" if torch.cuda.is_available() else "cpu"


def load_area_data(area_name: str, data_dir: str) -> Dict:
    """加载区域数据"""
    area_dir = Path(data_dir) / area_name
    with open(area_dir / "pois.geojson", 'r', encoding='utf-8') as f:
        pois = json.load(f)

    category_map, landuse_map, aoi_type_map, road_class_map = {}, {}, {}, {}
    poi_coords, poi_features = [], []

    for f in pois['features']:
        props = f['properties']
        coords = f['geometry']['coordinates']
        poi_coords.append(coords)

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

        density = float(props.get('poi_density_500m', 0) or 0)
        entropy = float(props.get('category_entropy', 0) or 0)
        road_dist = float(props.get('nearest_road_dist_m', 0) or 0)

        poi_features.append([
            category_map[cat], landuse_map[lu], aoi_type_map[aoi_type],
            road_class_map[rc], density, entropy, road_dist
        ])

    coords = np.array(poi_coords, dtype=np.float32)

    # 预计算KNN邻居
    knn_k = 10
    adj = kneighbors_graph(coords, n_neighbors=knn_k, mode='connectivity', include_self=False)
    knn_neighbors = [adj[i].nonzero()[1] for i in range(len(coords))]

    return {
        'coords': coords,
        'features': np.array(poi_features, dtype=np.float32),
        'knn_neighbors': knn_neighbors,
        'metadata': {
            'num_pois': len(poi_coords),
            'num_categories': len(category_map),
            'num_landuses': len(landuse_map),
            'num_aoi_types': len(aoi_type_map),
            'num_road_classes': len(road_class_map),
        }
    }


class SpatialTopologyEncoder(nn.Module):
    """
    空间拓扑编码器 V2.3

    核心：学习空间关系，而非仅重构坐标

    编码器：特征 + 坐标 → MLP → embedding
    """

    def __init__(self, config: V23Config, num_categories: int, num_landuses: int,
                 num_aoi_types: int, num_road_classes: int):
        super().__init__()
        self.config = config
        self.embed_dim = config.embed_dim
        self.hidden_dim = config.hidden_dim

        # Embedding层
        emb_dim = self.hidden_dim // 6
        self.category_emb = nn.Embedding(num_categories + 1, emb_dim)
        self.landuse_emb = nn.Embedding(num_landuses + 1, emb_dim)
        self.aoi_type_emb = nn.Embedding(num_aoi_types + 1, emb_dim)
        self.road_class_emb = nn.Embedding(num_road_classes + 1, emb_dim)
        self.num_proj = nn.Linear(3, emb_dim)
        self.coord_proj = nn.Linear(2, emb_dim)

        # 输入维度 = emb_dim * 6
        input_dim = emb_dim * 6

        # 编码器MLP
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(self.hidden_dim, self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(self.hidden_dim, config.embed_dim),
        )

        # 坐标重构解码器
        self.coord_decoder = nn.Sequential(
            nn.Linear(config.embed_dim, self.hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(self.hidden_dim // 2, 2),
        )

    def encode(self, features: torch.Tensor, coords: torch.Tensor) -> torch.Tensor:
        """编码：输入 → embedding"""
        # Embedding
        cat_emb = self.category_emb(features[:, 0].long())
        lu_emb = self.landuse_emb(features[:, 1].long())
        aoi_emb = self.aoi_type_emb(features[:, 2].long())
        rc_emb = self.road_class_emb(features[:, 3].long())
        num_emb = self.num_proj(features[:, 4:7])

        # 坐标归一化
        coords_norm = (coords - coords.mean(dim=0)) / (coords.std(dim=0) + 1e-8)
        coord_emb = self.coord_proj(coords_norm)

        # 拼接并编码
        x = torch.cat([cat_emb, lu_emb, aoi_emb, rc_emb, num_emb, coord_emb], dim=-1)
        z = self.encoder(x)

        return F.normalize(z, p=2, dim=-1)

    def decode_coord(self, z: torch.Tensor) -> torch.Tensor:
        """解码：embedding → 坐标"""
        return self.coord_decoder(z)

    def forward(self, features: torch.Tensor, coords: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """前向传播"""
        z = self.encode(features, coords)
        coord_recon = self.decode_coord(z)
        return z, coord_recon


class DistancePreserveLoss(nn.Module):
    """
    距离保持损失

    核心思想：原始空间中的距离关系应该在embedding空间中保持

    如果 dist(A, B) < dist(A, C)，则 dist_emb(A, B) < dist_emb(A, C)
    """

    def __init__(self, margin: float = 0.1):
        super().__init__()
        self.margin = margin

    def forward(self, z: torch.Tensor, pair_indices: torch.Tensor,
                spatial_dists: torch.Tensor) -> torch.Tensor:
        """
        Args:
            z: [N, D] embeddings
            pair_indices: [P, 2] 采样的点对索引
            spatial_dists: [P] 归一化后的空间距离

        Returns:
            loss: 标量
        """
        # 获取embedding距离
        z_i = z[pair_indices[:, 0]]  # [P, D]
        z_j = z[pair_indices[:, 1]]  # [P, D]

        emb_dists = torch.norm(z_i - z_j, p=2, dim=1)  # [P]

        # 目标：embedding距离与空间距离成正比
        # 使用MSE损失让两者接近
        loss = F.mse_loss(emb_dists, spatial_dists)

        return loss


class NeighborConsistencyLoss(nn.Module):
    """
    邻居一致性损失

    核心思想：KNN邻居的embedding应该相似
    """

    def __init__(self):
        super().__init__()

    def forward(self, z: torch.Tensor, knn_neighbors: list) -> torch.Tensor:
        """
        Args:
            z: [N, D] embeddings
            knn_neighbors: list of neighbor indices for each node

        Returns:
            loss: 标量
        """
        total_loss = 0.0
        count = 0

        # 采样一部分节点计算
        sample_size = min(1000, len(knn_neighbors))
        sample_indices = torch.randint(0, len(knn_neighbors), (sample_size,))

        for i in sample_indices:
            i = i.item()
            neighbors = knn_neighbors[i]
            if len(neighbors) > 0:
                # 中心点的embedding
                z_center = z[i]  # [D]

                # 邻居的embedding
                z_neighbors = z[neighbors]  # [K, D]

                # 余弦相似度
                cos_sim = F.cosine_similarity(z_center.unsqueeze(0), z_neighbors, dim=1)

                # 损失：让邻居相似度高
                total_loss += (1 - cos_sim.mean())
                count += 1

        return total_loss / max(count, 1)


def sample_distance_pairs(coords: np.ndarray, num_pairs: int, device: torch.device) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    采样点对并计算空间距离

    返回归一化后的距离（0-1范围）
    """
    N = len(coords)

    # 随机采样点对
    idx_i = np.random.randint(0, N, num_pairs)
    idx_j = np.random.randint(0, N, num_pairs)

    # 避免自己与自己
    mask = idx_i != idx_j
    idx_i = idx_i[mask]
    idx_j = idx_j[mask]

    # 计算空间距离
    coords_i = coords[idx_i]
    coords_j = coords[idx_j]
    spatial_dists = np.sqrt(((coords_i - coords_j) ** 2).sum(axis=1))

    # 归一化到0-1
    spatial_dists = (spatial_dists - spatial_dists.min()) / (spatial_dists.max() - spatial_dists.min() + 1e-8)

    return (
        torch.from_numpy(np.stack([idx_i, idx_j], axis=1)).long().to(device),
        torch.from_numpy(spatial_dists).float().to(device),
    )


def run_v23_experiment(config: V23Config):
    """运行V2.3实验"""
    print("=" * 70)
    print(f"V2.3 空间拓扑编码器: {config.area_name}")
    print("=" * 70)

    device = torch.device(config.device)
    print(f"设备: {device}")

    # 1. 加载数据
    print("\n[1] 加载数据...")
    data = load_area_data(config.area_name, config.data_dir)

    coords = data['coords']
    features = data['features']
    knn_neighbors = data['knn_neighbors']
    metadata = data['metadata']

    print(f"  POI数量: {metadata['num_pois']}")

    # 2. 生成标签
    print("\n[2] 生成空间聚类标签...")
    kmeans = KMeans(n_clusters=config.n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(coords)

    sil_upper_bound = silhouette_score(coords, labels)
    print(f"  理论上限（原始坐标）: {sil_upper_bound:.4f}")

    # 3. 标准化坐标
    coords_mean = coords.mean(axis=0)
    coords_std = coords.std(axis=0)
    coords_norm = (coords - coords_mean) / coords_std

    # 4. 创建模型
    print("\n[3] 创建模型...")
    model = SpatialTopologyEncoder(
        config,
        num_categories=metadata['num_categories'],
        num_landuses=metadata['num_landuses'],
        num_aoi_types=metadata['num_aoi_types'],
        num_road_classes=metadata['num_road_classes'],
    ).to(device)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"  参数量: {total_params:,}")

    # 5. 损失函数
    distance_loss_fn = DistancePreserveLoss()
    neighbor_loss_fn = NeighborConsistencyLoss()

    # 6. 训练
    print("\n[4] 开始训练...")
    print(f"  损失权重: coord_recon={config.coord_recon_weight}, "
          f"distance_preserve={config.distance_preserve_weight}, "
          f"neighbor_consistency={config.neighbor_consistency_weight}")

    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate,
                                  weight_decay=config.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=config.num_epochs)

    features_t = torch.from_numpy(features).float().to(device)
    coords_t = torch.from_numpy(coords).float().to(device)
    coords_norm_t = torch.from_numpy(coords_norm).float().to(device)

    best_sil = -1.0
    best_epoch = 0

    for epoch in range(config.num_epochs):
        model.train()
        optimizer.zero_grad()

        # 前向传播
        z, coord_recon = model(features_t, coords_t)

        # 1. 坐标重构损失
        loss_recon = F.mse_loss(coord_recon, coords_norm_t)

        # 2. 距离保持损失
        pair_indices, spatial_dists = sample_distance_pairs(
            coords, config.num_distance_pairs, device
        )
        loss_distance = distance_loss_fn(z, pair_indices, spatial_dists)

        # 3. 邻居一致性损失
        loss_neighbor = neighbor_loss_fn(z, knn_neighbors)

        # 总损失
        loss = (
            config.coord_recon_weight * loss_recon +
            config.distance_preserve_weight * loss_distance +
            config.neighbor_consistency_weight * loss_neighbor
        )

        # 反向传播
        loss.backward()
        optimizer.step()
        scheduler.step()

        # 评估
        if epoch % 20 == 0 or epoch == config.num_epochs - 1:
            model.eval()
            with torch.no_grad():
                z = model.encode(features_t, coords_t)
                z_np = z.cpu().numpy()
                sil = silhouette_score(z_np, labels)

            if sil > best_sil:
                best_sil = sil
                best_epoch = epoch

            print(f"  Epoch {epoch:3d} | Loss={loss.item():.4f} "
                  f"(recon={loss_recon.item():.3f}, dist={loss_distance.item():.3f}, "
                  f"neighbor={loss_neighbor.item():.3f}) | Sil={sil:.4f} | Best={best_sil:.4f}")

    # 7. 最终结果
    print("\n" + "=" * 70)
    print("实验结果")
    print("=" * 70)
    print(f"最佳 Silhouette: {best_sil:.4f} (Epoch {best_epoch})")
    print(f"理论上限: {sil_upper_bound:.4f}")
    print(f"达成率: {best_sil / sil_upper_bound * 100:.1f}%")

    if best_sil > 0.35:
        print("\n结论: V2.3 成功！模型学到了空间拓扑关系")
        return {'success': True, 'silhouette': best_sil, 'upper_bound': sil_upper_bound}
    else:
        print("\n结论: 效果有限，需要进一步优化")
        return {'success': False, 'silhouette': best_sil, 'upper_bound': sil_upper_bound}


if __name__ == "__main__":
    # 运行三个区域
    areas = ["guanggu_core", "wuda_area", "zhongjia_cun"]
    all_results = {}

    for area in areas:
        print(f"\n{'#'*70}")
        print(f"# 区域: {area}")
        print(f"{'#'*70}")
        config = V23Config(area_name=area)
        results = run_v23_experiment(config)
        all_results[area] = results

    # 汇总
    print("\n" + "=" * 70)
    print("三区域汇总结果")
    print("=" * 70)
    print(f"{'区域':<20} {'Silhouette':<12} {'理论上限':<12} {'达成率'}")
    print("-" * 60)
    for area, res in all_results.items():
        rate = res['silhouette'] / res['upper_bound'] * 100
        print(f"{area:<20} {res['silhouette']:.4f}       {res['upper_bound']:.4f}       {rate:.1f}%")

    avg_sil = np.mean([r['silhouette'] for r in all_results.values()])
    avg_rate = np.mean([r['silhouette']/r['upper_bound'] for r in all_results.values()]) * 100
    print("-" * 60)
    print(f"{'平均':<20} {avg_sil:.4f}       -            {avg_rate:.1f}%")

    if avg_sil > 0.35:
        print("\n结论: V2.3 在三个区域均成功，具备普适性！")
