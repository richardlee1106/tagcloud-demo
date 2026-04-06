# -*- coding: utf-8 -*-
"""
V2 多模态空间编码器 - 配置文件
"""

from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass
class V2Config:
    """V2实验配置"""

    # ============= 数据配置 =============
    # POI
    poi_max_count: int = 100000  # 最大POI数量

    # 路网
    road_knn_k: int = 10  # 道路节点KNN
    road_max_nodes: int = 50000  # 最大道路节点数

    # AOI
    aoi_max_count: int = 10000  # 最大AOI数量
    aoi_polygon_samples: int = 64  # 多边形采样点数

    # ============= 模型配置 =============
    embed_dim: int = 256
    hidden_dim: int = 128

    # POI编码器
    transformer_heads: int = 4
    transformer_layers: int = 2
    transformer_ffn_dim: int = 512
    dropout: float = 0.1

    # 路网编码器
    gnn_layers: int = 2
    gnn_type: str = "gcn"  # gcn, gat, sage

    # AOI编码器
    polygon_encoder_type: str = "rnn"  # rnn, cnn

    # 融合层
    fusion_type: str = "attention"  # concat, attention, gating

    # ============= 训练配置 =============
    num_epochs: int = 100
    batch_size: int = 256
    learning_rate: float = 2e-4
    weight_decay: float = 1e-5

    # 损失函数
    triplet_margin: float = 1.5
    use_contrastive: bool = False  # 是否使用对比学习

    # 早停
    early_stopping_patience: int = 15

    # 设备
    device: str = "cuda" if __import__("torch").cuda.is_available() else "cpu"

    # ============= 实验开关 =============
    # 可选实验组合
    use_poi: bool = True
    use_road: bool = False  # ⭐ 关键：是否使用路网
    use_aoi: bool = False   # ⭐ 关键：是否使用AOI
    use_landuse: bool = True

    # 评估指标
    eval_metrics: Tuple[str, ...] = ("silhouette", "nmi", "ari", "road_distance_corr")

    # 标签来源
    # "kmeans_spatial": 空间KMeans聚类
    # "admin_boundary": 行政区划
    # "aoi_type": AOI功能类型
    label_source: str = "kmeans_spatial"


@dataclass
class DataSchema:
    """V2 数据Schema"""

    # POI字段
    poi_lng_col: int = 0
    poi_lat_col: int = 1
    poi_category_col: int = 2
    poi_landuse_col: int = 3
    poi_road_class_col: int = 4
    poi_numerical_cols: Tuple[int, ...] = (5, 6, 7)

    # 路网字段（如果有）
    road_node_id_col: int = 0
    road_lng_col: int = 1
    road_lat_col: int = 2
    road_edge_src_col: int = 3
    road_edge_dst_col: int = 4
    road_class_col: Optional[int] = None

    # AOI字段（如果有）
    aoi_id_col: int = 0
    aoi_type_col: int = 1
    aoi_polygon_cols: Tuple[int, ...] = (2,)  # 多边形坐标列（可能有多个）


# 默认配置
CONFIG = V2Config()
SCHEMA = DataSchema()
