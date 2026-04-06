# -*- coding: utf-8 -*-
"""
V2 多模态空间编码器实验

使用三个实验区域验证可行性：
- guanggu_core: 13,399 POI
- wuda_area: 6,847 POI
- zhongjia_cun: 17,407 POI

多模态输入：
- POI: 使用GATv2处理KNN图
- Roads: 道路拓扑图（提取交叉口和连通性）
- AOI: POI所属功能区类型

验证目标：
- 相比V1（Silhouette≈0），V2能否学到真正的空间拓扑？
"""

import sys
import json
import os
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GATv2Conv
from torch_geometric.utils import add_self_loops
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score, normalized_mutual_info_score, adjusted_rand_score
from sklearn.neighbors import kneighbors_graph

# 添加spatial_encoder路径
sys.path.append(str(Path(__file__).parent.parent / "spatial_encoder"))


# =========================================================
# 配置
# =========================================================

@dataclass
class V2ExperimentConfig:
    # 数据
    data_dir: str = "D:/AAA_Edu/TagCloud/vite-project/scripts/experiment_data"
    areas: Tuple[str, ...] = ("guanggu_core",)  # 先测试一个区域

    # 模型
    embed_dim: int = 256
    hidden_dim: int = 128
    gat_heads: int = 4
    gat_layers: int = 2
    dropout: float = 0.1

    # 图构建
    knn_k: int = 10

    # 训练
    num_epochs: int = 100
    batch_size: int = 256
    learning_rate: float = 2e-4
    weight_decay: float = 1e-5
    triplet_margin: float = 1.5
    early_stopping_patience: int = 15

    # 标签
    n_clusters: int = 15  # KMeans聚类数

    # 设备
    device: str = "cuda" if torch.cuda.is_available() else "cpu"


# =========================================================
# 数据加载
# =========================================================

def load_geojson(filepath: str) -> Dict:
    """加载GeoJSON文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_area_data(area_name: str, data_dir: str) -> Dict:
    """
    加载一个实验区域的所有数据

    Returns:
        dict: {
            'pois': dict,
            'roads': dict,
            'aois': dict,
            'landuse': dict,
            'poi_features': np.array,
            'poi_coords': np.array,
            'metadata': dict
        }
    """
    area_dir = Path(data_dir) / area_name

    # 加载GeoJSON
    pois = load_geojson(area_dir / "pois.geojson")
    roads = load_geojson(area_dir / "roads.geojson")
    aois = load_geojson(area_dir / "aois.geojson")
    landuse = load_geojson(area_dir / "landuse.geojson")

    print(f"[{area_name}] POI: {len(pois['features'])}, Roads: {len(roads['features'])}, AOIs: {len(aois['features'])}")

    # 解析POI
    category_map = {}
    landuse_map = {}
    aoi_type_map = {}
    road_class_map = {}

    poi_coords = []
    poi_features = []

    for f in pois['features']:
        props = f['properties']
        coords = f['geometry']['coordinates']

        # 坐标
        poi_coords.append(coords)

        # 类别
        cat = props.get('category_big', 'unknown') or 'unknown'
        if cat not in category_map:
            category_map[cat] = len(category_map)

        # 土地利用
        lu = props.get('land_use_type', 'unknown') or 'unknown'
        if lu not in landuse_map:
            landuse_map[lu] = len(landuse_map)

        # AOI类型
        aoi_type = props.get('aoi_type', 'unknown') or 'unknown'
        if aoi_type not in aoi_type_map:
            aoi_type_map[aoi_type] = len(aoi_type_map)

        # 道路等级
        rc = props.get('nearest_road_class', 'unknown') or 'unknown'
        if rc not in road_class_map:
            road_class_map[rc] = len(road_class_map)

        # 数值特征
        density = props.get('poi_density_500m', 0) or 0
        entropy = props.get('category_entropy', 0) or 0
        road_dist = props.get('nearest_road_dist_m', 0) or 0

        # 特征向量: [category_id, landuse_id, aoi_type_id, road_class_id, density, entropy, road_dist]
        poi_features.append([
            category_map[cat],
            landuse_map[lu],
            aoi_type_map[aoi_type],
            road_class_map[rc],
            float(density),
            float(entropy),
            float(road_dist),
        ])

    return {
        'pois': pois,
        'roads': roads,
        'aois': aois,
        'landuse': landuse,
        'poi_coords': np.array(poi_coords, dtype=np.float32),
        'poi_features': np.array(poi_features, dtype=np.float32),
        'metadata': {
            'num_pois': len(poi_coords),
            'num_categories': len(category_map),
            'num_landuses': len(landuse_map),
            'num_aoi_types': len(aoi_type_map),
            'num_road_classes': len(road_class_map),
            'category_map': category_map,
            'landuse_map': landuse_map,
            'aoi_type_map': aoi_type_map,
            'road_class_map': road_class_map,
        }
    }


def build_knn_graph(coords: np.ndarray, k: int = 10) -> torch.Tensor:
    """构建KNN图的边索引"""
    n = len(coords)
    k = min(k, n - 1)

    adj = kneighbors_graph(coords, n_neighbors=k, mode='connectivity', include_self=False)
    row, col = adj.nonzero()
    edge_index = torch.from_numpy(np.stack([row, col], axis=0)).long()

    # 添加自环
    edge_index, _ = add_self_loops(edge_index, num_nodes=n)

    return edge_index


def generate_spatial_labels(coords: np.ndarray, n_clusters: int = 15, seed: int = 42) -> np.ndarray:
    """基于坐标生成空间聚类标签"""
    kmeans = KMeans(n_clusters=n_clusters, random_state=seed, n_init=10)
    labels = kmeans.fit_predict(coords)
    return labels


# =========================================================
# 模型定义
# =========================================================

class GATv2SpatialEncoder(nn.Module):
    """
    GATv2空间编码器 V2.1

    核心改进：显式加入坐标信息！

    输入: POI特征 + 坐标 + KNN图
    输出: 空间embedding
    """

    def __init__(self, config: V2ExperimentConfig, num_categories: int, num_landuses: int,
                 num_aoi_types: int, num_road_classes: int):
        super().__init__()
        self.config = config
        self.embed_dim = config.embed_dim
        self.hidden_dim = config.hidden_dim

        # Embedding层（离散特征）
        self.category_emb = nn.Embedding(num_categories + 1, self.hidden_dim // 6)
        self.landuse_emb = nn.Embedding(num_landuses + 1, self.hidden_dim // 6)
        self.aoi_type_emb = nn.Embedding(num_aoi_types + 1, self.hidden_dim // 6)
        self.road_class_emb = nn.Embedding(num_road_classes + 1, self.hidden_dim // 6)

        # 数值特征投影（density, entropy, road_dist）
        self.num_proj = nn.Linear(3, self.hidden_dim // 6)

        # ⭐ 核心改进：坐标投影（直接加入空间信息）
        self.coord_proj = nn.Linear(2, self.hidden_dim // 6)

        # 输入投影: 6个模态
        input_dim = self.hidden_dim // 6 * 6
        self.input_proj = nn.Sequential(
            nn.Linear(input_dim, self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
            nn.GELU(),
            nn.Dropout(config.dropout),
        )

        # GATv2层
        self.gat_layers = nn.ModuleList([
            GATv2Conv(self.hidden_dim, self.hidden_dim // config.gat_heads,
                      heads=config.gat_heads, concat=True, dropout=config.dropout),
            GATv2Conv(self.hidden_dim, self.hidden_dim // config.gat_heads,
                      heads=config.gat_heads, concat=True, dropout=config.dropout),
        ])

        self.norms = nn.ModuleList([
            nn.LayerNorm(self.hidden_dim),
            nn.LayerNorm(self.hidden_dim),
        ])

        # 输出投影
        self.output_proj = nn.Sequential(
            nn.Linear(self.hidden_dim, self.embed_dim),
            nn.LayerNorm(self.embed_dim),
        )

    def forward(self, features: torch.Tensor, coords: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        """
        Args:
            features: [N, 7] (category, landuse, aoi_type, road_class, density, entropy, road_dist)
            coords: [N, 2] (lng, lat) ⭐ 新增：坐标信息
            edge_index: [2, E]

        Returns:
            embedding: [N, D]
        """
        # Embedding（离散特征）
        cat_emb = self.category_emb(features[:, 0].long())
        lu_emb = self.landuse_emb(features[:, 1].long())
        aoi_emb = self.aoi_type_emb(features[:, 2].long())
        rc_emb = self.road_class_emb(features[:, 3].long())

        # 数值特征（标准化后）
        num_emb = self.num_proj(features[:, 4:7])

        # ⭐ 坐标编码（归一化）
        # 坐标归一化：减去均值
        coords_norm = (coords - coords.mean(dim=0)) / (coords.std(dim=0) + 1e-8)
        coord_emb = self.coord_proj(coords_norm)

        # 拼接：6个模态
        x = torch.cat([cat_emb, lu_emb, aoi_emb, rc_emb, num_emb, coord_emb], dim=-1)
        x = self.input_proj(x)

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


class BatchHardTripletLoss(nn.Module):
    """Batch Hard Triplet Loss"""

    def __init__(self, margin: float = 1.0):
        super().__init__()
        self.margin = margin

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        """
        Args:
            embeddings: [N, D]
            labels: [N]
        """
        # 计算距离矩阵
        dist_matrix = torch.cdist(embeddings, embeddings, p=2)

        # 对每个样本找最难的正样本和负样本
        labels = labels.view(-1, 1)
        mask_pos = (labels == labels.T).float()
        mask_neg = (labels != labels.T).float()

        # 最难正样本
        dist_pos = (dist_matrix * mask_pos).max(dim=1)[0]

        # 最难负样本
        dist_neg = (dist_matrix + 1e6 * mask_pos).min(dim=1)[0]

        # Triplet loss
        loss = F.relu(dist_pos - dist_neg + self.margin)

        return loss.mean()


# =========================================================
# 训练和评估
# =========================================================

def train_epoch(model, optimizer, features, coords, edge_index, labels, config, device):
    """训练一个epoch"""
    model.train()
    optimizer.zero_grad()

    features = torch.from_numpy(features).float().to(device)
    coords = torch.from_numpy(coords).float().to(device)
    edge_index = edge_index.to(device)
    labels = torch.from_numpy(labels).long().to(device)

    # 前向传播
    embeddings = model(features, coords, edge_index)

    # Triplet loss
    triplet_loss = BatchHardTripletLoss(config.triplet_margin)
    loss = triplet_loss(embeddings, labels)

    # 反向传播
    loss.backward()
    optimizer.step()

    return loss.item()


def evaluate(model, features, coords, edge_index, labels, device):
    """评估模型"""
    model.eval()

    with torch.no_grad():
        features = torch.from_numpy(features).float().to(device)
        coords = torch.from_numpy(coords).float().to(device)
        edge_index = edge_index.to(device)

        embeddings = model(features, coords, edge_index)
        embeddings = embeddings.cpu().numpy()

    # 计算指标
    sil = silhouette_score(embeddings, labels)

    return {
        'silhouette': sil,
        'embeddings': embeddings,
    }


def run_v2_experiment(area_name: str, config: V2ExperimentConfig):
    """运行V2实验"""
    print(f"\n{'='*70}")
    print(f"V2实验: {area_name}")
    print(f"{'='*70}")

    device = torch.device(config.device)
    print(f"设备: {device}")

    # 1. 加载数据
    print("\n[1] 加载数据...")
    area_data = load_area_data(area_name, config.data_dir)

    features = area_data['poi_features']
    coords = area_data['poi_coords']
    metadata = area_data['metadata']

    print(f"  POI数量: {metadata['num_pois']}")
    print(f"  类别数: {metadata['num_categories']}")
    print(f"  土地利用类型数: {metadata['num_landuses']}")
    print(f"  AOI类型数: {metadata['num_aoi_types']}")
    print(f"  道路等级数: {metadata['num_road_classes']}")

    # 2. 构建图
    print("\n[2] 构建KNN图...")
    edge_index = build_knn_graph(coords, k=config.knn_k)
    print(f"  边数: {edge_index.shape[1]}")

    # 3. 生成标签（空间聚类）
    print("\n[3] 生成空间聚类标签...")
    labels = generate_spatial_labels(coords, n_clusters=config.n_clusters)
    print(f"  聚类数: {config.n_clusters}")
    print(f"  标签分布: {np.bincount(labels)}")

    # 4. 创建模型
    print("\n[4] 创建模型...")
    model = GATv2SpatialEncoder(
        config,
        num_categories=metadata['num_categories'],
        num_landuses=metadata['num_landuses'],
        num_aoi_types=metadata['num_aoi_types'],
        num_road_classes=metadata['num_road_classes'],
    ).to(device)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"  参数量: {total_params:,}")

    # 5. 训练
    print("\n[5] 开始训练...")
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=config.num_epochs)

    best_sil = -1.0
    patience = 0
    history = []

    for epoch in range(config.num_epochs):
        # 训练
        loss = train_epoch(model, optimizer, features, coords, edge_index, labels, config, device)
        scheduler.step()

        # 评估
        if epoch % 5 == 0 or epoch == config.num_epochs - 1:
            metrics = evaluate(model, features, coords, edge_index, labels, device)
            sil = metrics['silhouette']

            history.append({
                'epoch': epoch,
                'loss': loss,
                'silhouette': sil,
            })

            print(f"  Epoch {epoch:3d} | Loss={loss:.4f} | Sil={sil:.4f}")

            if sil > best_sil:
                best_sil = sil
                patience = 0
            else:
                patience += 1

            if patience >= config.early_stopping_patience:
                print(f"  早停于 epoch {epoch}")
                break

    # 6. 最终评估
    print("\n[6] 最终评估...")
    final_metrics = evaluate(model, features, coords, edge_index, labels, device)

    print(f"  最终 Silhouette: {final_metrics['silhouette']:.4f}")
    print(f"  最佳 Silhouette: {best_sil:.4f}")

    # 对比V1
    print(f"\n[对比] V1 Silhouette = 0.01")
    if best_sil > 0.1:
        print(f"  [OK] V2明显优于V1!")
    elif best_sil > 0.01:
        print(f"  [WARN] V2略优于V1，但效果有限")
    else:
        print(f"  [FAIL] V2与V1相当或更差，需要进一步分析")

    return {
        'area_name': area_name,
        'best_silhouette': best_sil,
        'final_silhouette': final_metrics['silhouette'],
        'history': history,
        'metadata': metadata,
    }


# =========================================================
# 主函数
# =========================================================

if __name__ == "__main__":
    config = V2ExperimentConfig()

    # 运行实验
    results = run_v2_experiment("guanggu_core", config)

    print("\n" + "="*70)
    print("V2实验完成")
    print("="*70)
    print(f"最佳 Silhouette: {results['best_silhouette']:.4f}")
    print(f"\n结论: {'V2架构有效' if results['best_silhouette'] > 0.1 else '需要进一步改进'}")
