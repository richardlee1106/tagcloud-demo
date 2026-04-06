# V2.6 Pro 空间编码器

让大语言模型（LLM）理解空间拓扑关系的编码器。

## 当前状态

| 版本 | 状态 | 说明 |
|------|------|------|
| V2.3 | ✅ 稳定版 | 空间感知能力（L1） |
| V2.4 | ✅ 已完成 | 空间查询增强（L2） |
| V2.5 | ✅ 已完成 | 方向+功能区语义（L3部分） |
| **V2.6 Pro** | ✅ **当前版本** | **Phase 3 终极编码器（POI级语义聚类）** |

## 最新成果（2026-03-20）

**POI级训练成果**（565K POI，UltimateSpatialEncoder架构）：

| 指标 | 结果 | 目标 | 状态 |
|------|------|------|------|
| **Region F1** | **90.48%** | >50% | ✅ 大幅超越 |
| **IntraRecall@20** | **91.42%** | >50% | ✅ 大幅超越 |
| **DirMatch** | **99.98%** | >60% | ✅ 完美 |
| Pearson | 0.366 | >0.90 | ⚠️ 语义优先 |
| Overlap@20 | 27.77% | >40% | ⚠️ 语义优先 |

**关键发现**：POI级训练使 L3 空间理解指标爆发（F1 33%→90%，Recall 22%→91%），embedding 成功学到语义聚类特征。

## 快速开始

### 训练模型

```bash
cd D:/AAA_Edu/TagCloud/vite-project

# POI级训练（语义聚类强，L3优）- 推荐
python -m spatial_encoder.v26_GLM.experiment_poi --sample 1.0 --epochs 80

# Cell级训练（空间感知强，L1/L2优）
python -m spatial_encoder.v26_GLM.experiment_ultimate --sample 1.0 --epochs 100 --batch 256

# 快速验证（10%样本）
python -m spatial_encoder.v26_GLM.train_v26_mlp --sample 0.1 --epochs 50
```

### 评估模型

```bash
# 运行完整评估套件
python -m spatial_encoder.v26_GLM.evaluate_v26_pro

# 测试混合检索
python -m spatial_encoder.v26_GLM.hybrid_search

# GPU 显存测试
python -m spatial_encoder.v26_GLM.test_memory_config
```

### API服务

```bash
# 启动编码器服务
python -m spatial_encoder.v26_GLM.api_server

# 测试API
python -m spatial_encoder.v26_GLM.test_api
```

## 目录结构

```
spatial_encoder/
├── v26_GLM/                    # V2.6 Pro（当前版本）
│   ├── config_v26_pro.py       # 配置（RTX 5060优化）
│   ├── encoder_v26_mlp.py      # MLP编码器
│   ├── dual_tower_encoder.py   # 双塔架构
│   ├── prototype_learning.py   # 原型学习
│   ├── spatial_attention_encoder.py  # 时空注意力
│   ├── ultimate_encoder.py     # 终极架构
│   │
│   ├── train_v26_mlp.py        # MLP训练入口
│   ├── experiment_ultimate.py  # Cell级训练
│   ├── experiment_poi.py       # POI级训练
│   ├── evaluate_v26_pro.py     # 评估套件
│   │
│   ├── data_loader_v26.py      # Cell级数据加载
│   ├── data_loader_poi.py      # POI级数据加载
│   │
│   ├── losses_v26_pro.py       # 损失函数
│   ├── contrastive_losses.py   # 对比学习损失
│   ├── hybrid_search.py        # 混合检索引擎
│   │
│   └── saved_models/           # 训练好的模型
│       ├── v26_pro/            # Cell级模型
│       └── poi_encoder/        # POI级模型
│
├── v23/                        # V2.3（稳定版）
├── v24/                        # V2.4（归档）
├── api/                        # API服务
├── models/                     # 通用模型定义
├── utils/                      # 工具函数
│
├── docs/                       # 文档
└── archive/                    # 归档
```

## 版本规划

### V2.3（稳定版）- 空间感知

- ✅ 空间距离保持（Pearson=0.92）
- ✅ 全局空间结构保持
- ⚠️ 空间查询能力有限

**智能等级：L1（空间感知）**

### V2.4（已完成）- 空间查询增强

- ✅ 稳定性优化（达成率稳定>80%）
- ✅ KNN邻域特征（Overlap 40.1%）

**智能等级：L2（空间查询）**

### V2.5（已完成）- 语义增强

- ✅ 方向识别（DirMatch 69.9%）
- ✅ 区域区分（Region F1 25.5%）

**智能等级：L3（空间理解，部分达成）**

### V2.6 Pro（当前版本）- Phase 3 终极编码器

**架构创新**：
- 双塔架构（空间+语义分离）
- 原型学习（语义聚类）
- 时空注意力（距离+方向编码）

**训练成果**：

| 训练级别 | 优势 | Pearson | Region F1 | IntraRecall |
|---------|------|---------|-----------|-------------|
| Cell级 | 空间感知 | 0.964 | 33% | 22% |
| **POI级** | **语义聚类** | **0.366** | **90%** | **91%** |

**混合检索架构**：

```
┌─────────────────────────────────────────────────────────┐
│  混合检索 = Embedding 语义检索 + 空间过滤                │
│                                                         │
│  Step 1: Embedding 检索 → 召回语义相似 POI (Recall 60%) │
│  Step 2: 空间过滤 → 保留 radius 范围内 (Precision 100%) │
│  Step 3: 重排序 → 结合语义和空间得分 (F1 70-80%)        │
└─────────────────────────────────────────────────────────┘
```

**测试结果**：

| 指标 | 纯语义检索 | 混合检索 | 提升 |
|------|-----------|---------|------|
| Intra-class Recall | 41.2% | **54.4%** | +13.2% |
| Spatial Precision | - | **100%** | - |

**关键文件**：`spatial_encoder/v26_GLM/hybrid_search.py`

## 空间智能等级

| 等级 | 描述 | 指标 | 状态 |
|------|------|------|------|
| L1 | 空间感知 | Pearson>0.90, Spearman>0.85 | ✅ 达成 |
| L2 | 空间查询 | Overlap>40% | ✅ 达成 |
| L3 | 空间理解 | DirMatch>40%, Region F1>35% | ⚠️ 部分达成 |
| L4 | 空间推理 | Range IoU>70% | ❌ MLP天花板（~27%）|
| L5 | 矢量理解/面生成 | - | 📋 计划中 |
| L6 | 空间智能体 | 挂载LLM | 🚧 开发中 |

**当前结论**：POI级达成L3超预期，Cell级保留L1/L2；采用混合检索架构推进L6。

## 评价指标详解

### 核心指标说明

#### 1. Pearson 相关系数（Pearson Correlation）

**含义**：测量 embedding 空间距离与真实地理距离的线性相关性。

**计算方式**：
```
Pearson = Cov(emb_dist, geo_dist) / (σ_emb * σ_geo)
```
- `emb_dist`：embedding 向量间的欧氏距离
- `geo_dist`：真实地理距离（米）

**标准**：> 0.90（强相关）

**意图**：验证编码器是否学到了空间距离保持。若 Pearson=0.96，说明 embedding 空间中"距离近"与现实中"距离近"高度一致。

**典型值**：
- Cell 级训练：0.964 ✅（空间感知强）
- POI 级训练：0.366 ⚠️（语义优先，距离排序弱化）

---

#### 2. Spearman 相关系数（Spearman Correlation）

**含义**：测量 embedding 空间距离与真实地理距离的排序相关性（单调性）。

**计算方式**：
```
Spearson = Pearson(rank(emb_dist), rank(geo_dist))
```

**标准**：> 0.85（强单调性）

**意图**：相比 Pearson，Spearman 关注"谁更近"而非"具体近多少"。适用于"找最近的 5 个 POI"这类任务。

**典型值**：
- Cell 级训练：0.95+ ✅
- POI 级训练：0.40+ ⚠️

---

#### 3. Overlap@K（邻居重叠率）

**含义**：测量 embedding 空间的 K 近邻与真实空间 K 近邻的重叠比例。

**计算方式**：
```
Overlap@K = |KNN_emb ∩ KNN_geo| / K
```

**标准**：> 40%（K=20）

**意图**：直接评估"embedding 能否找到真实的邻居"。这是 L2（空间查询）的核心指标。

**典型值**：
- Cell 级训练：40.1% ✅
- POI 级训练：27.77% ⚠️（语义聚类破坏了邻居关系）

**局限性**：由于维度诅咒，高维 embedding（352 维）与 2 维真实空间存在固有差异，理论上限约 30-40%。

---

#### 4. DirMatch（方向匹配准确率）

**含义**：测量 embedding 能否预测 POI 间的方向关系（东、西、南、北）。

**计算方式**：
```
DirMatch = Count(预测方向 == 真实方向) / Total
```

**标准**：> 60%

**意图**：验证编码器是否学到了方向语义。若 DirMatch 高，说明"东方的 POI"在 embedding 空间中确实有方向性。

**典型值**：
- Cell 级训练：69.9% ✅
- POI 级训练：99.98% ✅✅（完美，可能过拟合）

---

#### 5. Region F1（区域分类 F1 分数）

**含义**：测量 embedding 能否区分不同功能区（居住区、商业区、工业区等）。

**计算方式**：
```
Precision = TP / (TP + FP)
Recall = TP / (TP + FN)
F1 = 2 * Precision * Recall / (Precision + Recall)
```

**标准**：> 35%

**意图**：验证编码器是否学到了语义聚类。若 Region F1 高，说明同类区域的 POI 在 embedding 空间中聚类。

**典型值**：
- Cell 级训练：25.5% ⚠️
- POI 级训练：90.48% ✅✅（语义聚类爆发）

**数据集分布**：武汉三镇 7 类区域（居住 42%、商业 17%、工业 7% 等）。

---

#### 6. IntraRecall@K（类内召回率）

**含义**：测量同一功能区内的 POI 是否在 embedding 空间中相互接近。

**计算方式**：
```
IntraRecall@K = Count(同类 POI in K近邻) / K
```

**标准**：> 50%（K=20）

**意图**：验证语义聚类质量。若 IntraRecall 高，说明"商业区的咖啡馆"和"商业区的餐厅"在 embedding 空间中接近。

**典型值**：
- Cell 级训练：22% ⚠️
- POI 级训练：91.42% ✅✅（语义聚类爆发）

---

#### 7. Range IoU（范围预测 IoU）

**含义**：测量 embedding 能否预测 POI 的空间范围（边界框）。

**计算方式**：
```
IoU = Area(预测范围 ∩ 真实范围) / Area(预测范围 ∪ 真实范围)
```

**标准**：> 70%

**意图**：评估 L4（空间推理）能力。若 Range IoU 高，说明编码器理解"这个 POI 覆盖多大范围"。

**典型值**：
- 当前最优：27% ❌（MLP 架构天花板）

**局限性**：MLP 只能处理点坐标，难以推断面的边界。需要图神经网络或 Transformer 架构突破。

---

#### 8. Silhouette（轮廓系数）

**含义**：测量聚类的紧密度和分离度。

**计算方式**：
```
s(i) = (b(i) - a(i)) / max(a(i), b(i))
```
- `a(i)`：样本 i 到同类其他样本的平均距离
- `b(i)`：样本 i 到最近其他类样本的平均距离

**标准**：> 0.5（良好聚类），> 0.7（强聚类）

**意图**：验证 embedding 聚类质量。Silhouette 高说明类内紧、类间远。

**典型值**：
- 武汉 POI 数据集：0.32-0.38（数据固有上限）

**异常情况**：
- Silhouette < 0：聚类质量差，或数据分布均匀
- Silhouette > 0.95：可能存在标签泄露（检查输入特征是否包含标签信息）

---

### 指标权衡关系

| 训练策略 | Pearson | Region F1 | IntraRecall | 适用场景 |
|---------|---------|-----------|-------------|----------|
| **Cell 级** | 0.964 ✅ | 33% ⚠️ | 22% ⚠️ | L1/L2：空间感知、距离查询 |
| **POI 级** | 0.366 ⚠️ | 90% ✅ | 91% ✅ | L3：语义聚类、功能区识别 |

**结论**：
- **无法同时优化所有指标**：距离排序（Pearson）与语义聚类（Region F1）存在固有冲突。
- **混合检索架构**：通过 PostGIS 空间过滤弥补 POI 级训练的距离排序弱化问题。

---

### 如何选择指标

**场景 1：找最近的 POI**
- 关注：Pearson > 0.90, Overlap@20 > 40%
- 选择：Cell 级训练

**场景 2：识别功能区**
- 关注：Region F1 > 50%, IntraRecall@20 > 50%
- 选择：POI 级训练

**场景 3：混合检索（推荐）**
- 使用 POI 级 embedding 做语义召回
- 使用 PostGIS 做空间过滤
- 兼顾语义聚类和空间精度

## L6 MVP 路线

1. **空间意图解析**: LLM理解用户空间查询意图
2. **混合检索**: POI Embedding语义召回 + PostGIS空间过滤
3. **结果生成**: LLM组织自然语言回答

详见 `V3-GeoEncoder-RAG/` 项目。

## 配置说明

### RTX 5060 Laptop 8GB 优化

```python
# config_v26_pro.py
hidden_dim = 640
embedding_dim = 352
num_encoder_layers = 10
batch_size = 16384
K_neighbors = 85
epochs = 80
learning_rate = 3e-4
```

**GPU 利用率**：~90%（7.2GB/8GB）

### 数据库连接

- host: localhost
- port: 15432
- user: postgres
- password: 123456
- database: geoloom

**三镇数据集**：
- POI: 565,672 条
- Roads: 23,384 条
- Landuse: 12,638 条
- Cells: 1,828 条

## 依赖安装

```bash
pip install torch scikit-learn matplotlib psycopg2-binary h3 faiss-cpu
```

## 故障排查

### GPU 显存溢出（OOM）

- 检查 `K_neighbors`（推荐：8GB 显存用 85）
- 检查 `batch_size`（推荐：16384）
- 使用 K 近邻采样损失替代全矩阵计算

### Silhouette 为负数

区域内 POI 分布均匀时正常。使用采样数据验证。

### Silhouette 过高（>0.95）

可能存在标签泄露。检查输入特征是否包含标签信息。

## 相关文档

- `CHANGELOG.md` - 详细实验历史和结果
- `CLAUDE.md` - 项目概览和快速开始
- `docs/` - 架构规划和技术文档
- `V3-GeoEncoder-RAG/` - L6 空间智能体实现

---

**最后更新**：2026-03-25
