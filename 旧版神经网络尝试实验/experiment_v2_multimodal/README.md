# V2 多模态空间编码器实验框架

## 设计目标

让模型理解真实的空间拓扑关系，而非仅依赖POI坐标。

## 核心改进

### 1. 多模态输入

```
┌─────────────────────────────────────────────────────────────────┐
│                        V2 多模态输入                              │
├─────────────────────────────────────────────────────────────────┤
│  POI点数据     │ 语义特征   │ category, landuse, road_class     │
│                │ 坐标       │ lng, lat (2D)                     │
├────────────────┼────────────┼───────────────────────────────────┤
│  路网线数据    │ 拓扑结构   │ 边(连通性), 节点(交叉口)           │
│                │ 属性       │ 道路等级, 长度, 方向              │
├────────────────┼────────────┼───────────────────────────────────┤
│  AOI面数据     │ 功能区域   │ 商业区, 居住区, 工业区, 公园...    │
│                │ 边界       │ 多边形坐标序列                    │
├────────────────┼────────────┼───────────────────────────────────┤
│  Landuse      │ 土地利用   │ 13种土地利用类型                  │
└────────────────┴────────────┴───────────────────────────────────┘
```

### 2. 核心假设

**为什么需要多模态？**

1. **路网提供"可达性"**：两个POI即使坐标相近，如果被河流/铁路隔开，也不应该被聚合
2. **AOI提供"功能"**：知道某区域是"商业区"比知道POI类型更能理解空间
3. **Landuse提供"基础属性"**：土地利用是空间的"底层操作系统"

### 3. 架构设计

```python
class SpatialEncoderV2(nn.Module):
    """
    多模态空间编码器 V2

    输入：
        - poi_features: [N, F_poi]  POI特征
        - poi_coords: [N, 2]         POI坐标
        - road_graph: 路网图结构
        - aoi_polygons: AOI多边形数据

    输出：
        - spatial_embedding: [N, D] 空间表示向量
    """

    def __init__(self, config):
        super().__init__()

        # 1. POI编码器（保留V1的Transformer）
        self.poi_encoder = POITransformerEncoder(config)

        # 2. 路网编码器（GNN）
        self.road_encoder = RoadGNNEncoder(config)

        # 3. AOI编码器（Polygon encoder）
        self.aoi_encoder = AOIEncoder(config)

        # 4. 跨模态融合
        self.fusion = CrossModalFusion(config)

    def forward(self, poi_data, road_data, aoi_data):
        # 独立编码
        poi_emb = self.poi_encoder(poi_data)
        road_emb = self.road_encoder(road_data)
        aoi_emb = self.aoi_encoder(aoi_data)

        # 融合
        fused = self.fusion(poi_emb, road_emb, aoi_emb)

        return fused
```

### 4. 数据准备优先级

| 优先级 | 数据 | 难度 | 价值 |
|--------|------|------|------|
| ⭐⭐⭐ | POI + Landuse | 低 | 已有 |
| ⭐⭐⭐ | POI + 简单路网（只取交叉口） | 中 | 高 |
| ⭐⭐ | POI + AOI（面数据） | 高 | 高 |
| ⭐ | 完整路网（带属性） | 高 | 中 |

### 5. 验证策略

**问题：如何验证V2真的学到了空间拓扑？**

方案A：**行政区划标签**
- 标签 = 街道/社区边界
- 优点：与POI语义无关
- 缺点：需要行政区划数据

方案B：**路网距离 vs 语义距离**
- 计算POI对之间的"路网最短路径距离"
- 与模型embedding的cosine距离做相关性分析
- 期望：高相关性

方案C：**功能区预测**
- 用embedding预测AOI类型
- 期望：比随机猜测好

---

## 文件结构

```
experiment_v2_multimodal/
├── README.md                 # 本文档
├── config.py                 # 配置文件
├── data_loader.py            # 多模态数据加载
├── models/
│   ├── __init__.py
│   ├── poi_encoder.py        # POI编码器
│   ├── road_encoder.py       # 路网编码器
│   ├── aoi_encoder.py        # AOI编码器
│   └── fusion.py             # 跨模态融合
├── training.py               # 训练脚本
├── evaluate.py               # 评估脚本
└── run_experiment.py        # 入口脚本
```

---

## 关键实验方向

### 实验1：路网感知编码

**假设**：引入路网拓扑后，模型能区分"可达"和"不可达"的区域

**实现**：
```python
# 构建"道路可达图"
# POI -> 映射到最近道路节点
# 道路节点间连通性作为边

class RoadAwareGraph:
    def __init__(self, road_edges):
        # 边：哪些道路是连通的
        self.adjacency = build_adjacency(road_edges)

    def get_poi_reachable_neighbors(self, poi_id, max_distance):
        # 获取从POI出发在路网上可达的邻居
        return bfs_from_poi(poi_id, max_distance)
```

### 实验2：AOI功能区编码

**假设**：知道区域功能（如商业区）能提升空间表示

**实现**：
```python
# AOI: 标注好功能类型的多边形
# 编码: 多边形 -> 向量（Polygon CNN / Boundary RNN）

class AOIEncoder(nn.Module):
    def __init__(self):
        self.polygon_rnn = nn.LSTM(input_size=2, hidden_size=128)
        self.type_embedding = nn.Embedding(num_aoi_types, 64)

    def forward(self, polygons, aoi_types):
        # polygons: [B, T, 2] 边界点序列
        # aoi_types: [B] 功能类型

        # 1. 编码边界形状
        boundary_emb = self.polygon_rnn(polygons)

        # 2. 编码功能类型
        type_emb = self.type_embedding(aoi_types)

        # 3. 融合
        return boundary_emb + type_emb
```

---

## 待思考问题

1. **标签问题**：如何定义"正确"的空间表示？
   - 行政边界？路网连通性？功能相似性？

2. **规模问题**：
   - 完整路网可能有百万节点
   - 如何高效处理？

3. **融合策略**：
   - 早融合（特征拼接）vs 晚融合（embedding拼接）？
   - 注意力机制是否必要？

---

**最后更新**：2026-03-14
**版本**：V2.0 (多模态架构设计)
