# -*- coding: utf-8 -*-
"""
V2 多模态空间编码器 - 主入口脚本

设计思路：
- 支持多模态输入：POI + 路网 + AOI
- 可配置启用/禁用各模态
- 统一的训练和评估流程
"""

import sys
from pathlib import Path

# 添加路径
sys.path.append(str(Path(__file__).parent.parent / "spatial_encoder"))

import torch
import torch.nn as nn
import torch.optim as optim
from dataclasses import asdict

# V2 模块
from config import CONFIG, SCHEMA, V2Config
from models import (
    POITransformerEncoder,
    POIGraphEncoder,
    get_fusion_module,
)


class SpatialEncoderV2(nn.Module):
    """
    多模态空间编码器 V2

    支持灵活的多模态组合：
    - POI: 必选
    - Road: 可选
    - AOI: 可选
    """

    def __init__(self, config: V2Config):
        super().__init__()
        self.config = config

        # 统计启用的模态
        self.enabled_modalities = []
        if config.use_poi:
            self.enabled_modalities.append("poi")
        if config.use_road:
            self.enabled_modalities.append("road")
        if config.use_aoi:
            self.enabled_modalities.append("aoi")
        if config.use_landuse:
            self.enabled_modalities.append("landuse")

        print(f"[V2] 启用的模态: {self.enabled_modalities}")

        # POI编码器
        if config.use_poi:
            self.poi_transformer = POITransformerEncoder(config)
            self.poi_graph = POIGraphEncoder(config)

        # 融合模块
        self.fusion = get_fusion_module(config, num_modalities=len(self.enabled_modalities))

    def forward(self, poi_data, road_data=None, aoi_data=None):
        """
        Args:
            poi_data: dict 包含 poi_features, poi_coords, adj_matrix
            road_data: dict 路网数据（可选）
            aoi_data: dict AOI数据（可选）

        Returns:
            embedding: [N, D]
        """
        embeddings = []

        # POI编码
        if self.config.use_poi:
            poi_emb = self.poi_transformer(
                poi_data["features"],
                poi_data["coords"]
            )
            embeddings.append(poi_emb)

        # 其他模态待添加...

        # 融合
        if len(embeddings) == 1:
            return embeddings[0]
        else:
            return self.fusion(embeddings)


def print_v2_architecture():
    """打印V2架构概览"""
    print("=" * 70)
    print("V2 多模态空间编码器架构")
    print("=" * 70)

    print("\n【输入模态】")
    print("  ├─ POI (必选)")
    print("  │    ├─ category, landuse, road_class (语义)")
    print("  │    └─ lng, lat (坐标)")
    print("  │")
    print("  ├─ Road (可选)")
    print("  │    ├─ 道路节点坐标")
    print("  │    └─ 道路边 (连通性)")
    print("  │")
    print("  └─ AOI (可选)")
    print("       ├─ 多边形边界")
    print("       └─ 功能类型 (商业/居住/工业)")

    print("\n【编码器】")
    print("  ├─ POI编码器: Transformer + Graph")
    print("  ├─ 路网编码器: GNN (GCN/GAT/SAGE)")
    print("  └─ AOI编码器: RNN/CNN 多边形编码")

    print("\n【融合策略】")
    print("  ├─ concat: 简单拼接")
    print("  ├─ gating: 门控机制")
    print("  └─ attention: 多头注意力")

    print("\n【待验证假设】")
    print("  H1: 引入路网拓扑能提升空间表示质量")
    print("  H2: 引入AOI功能区能提升空间表示质量")
    print("  H3: 多模态融合优于单模态")

    print("\n" + "=" * 70)


def run_demo():
    """运行演示"""
    print_v2_architecture()

    # 创建模型
    config = V2Config()
    model = SpatialEncoderV2(config)

    # 统计参数
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)

    print(f"\n模型参数量:")
    print(f"  - 总参数: {total_params:,}")
    print(f"  - 可训练: {trainable_params:,}")

    # 模拟前向传播
    batch_size = 32
    poi_features = torch.randint(0, 10, (batch_size, 5))
    poi_coords = torch.rand(batch_size, 2) * 0.1 + 114  # 武汉附近坐标

    poi_data = {
        "features": poi_features,
        "coords": poi_coords,
    }

    model.eval()
    with torch.no_grad():
        output = model(poi_data)

    print(f"\n前向传播:")
    print(f"  - 输入: {batch_size} 个POI")
    print(f"  - 输出: {output.shape}")

    print("\n[提示] V2框架已就绪，需要准备路网和AOI数据才能启用完整功能")


if __name__ == "__main__":
    run_demo()
