# V2.6 Cell-Context Encoder (A + C) 设计文档

**日期**：2026-03-15  
**状态**：已确认（v1 先做 A 相邻方向 + C 功能区语义）  
**范围**：`spatial_encoder/v26` 训练管线中的 `encoder_v26.py`、`losses_v26.py`、`train_v26.py` 的首版实现

---

## 1. 目标与背景

V2.6 需要从 POI 级 MLP 过渡到 **Cell 级空间上下文编码器**。首版落地的目标是：

- 让 cell embedding 学到空间邻域结构（检索能力基础）
- 引入 **方向监督（A）** 与 **功能区语义监督（C）**
- 可在小样本区跑通训练与评估，并符合“渐进式验证”原则

---

## 2. 非目标（v1 不做）

- 复杂图神经网络（GAT/多层 GCN）先不引入
- OD 流方向监督先不做（无则跳过）
- 线要素方向监督暂时不接入（后续可扩展）

---

## 3. 架构概览

**输入**：
- `cell_features`（点/线/面聚合特征）
- cell 位置编码（H3 cell center -> 极坐标/多尺度位置编码）
- 邻接关系（H3 k=1 邻接对）

**编码器**：
1. 特征 MLP：`cell_features -> hidden -> embedding`
2. 邻域聚合：对邻接 cell embedding 做 mean 聚合
3. 融合输出：`final_embedding = MLP(self) + agg(neighbors)`

**任务头**：
- 方向头（A）：邻接对方向分类（8 类默认）
- 功能区头（C）：landuse 主类分类（从 cell 聚合权重取最大）

**输出**：
cell embedding + 方向预测 + 功能区预测

---

## 4. 数据流（Data Flow）

1. PostGIS 拉取点/线/面数据
2. `dataset_builder.py` 投影为 cell 级 agent 记录
3. `cell_features.py` 聚合 cell 特征
4. H3 邻接（k=1）生成 `(cell_i, cell_j)` 对
5. 方向标签：用 cell center 计算方位角 -> 离散成 8 类
6. 功能区标签：用 `landuse_types` 权重最高者作为监督标签
7. 训练/验证按 cell id 分割

---

## 5. 损失设计（v1）

总损失：

```
L = L_dist + w_dir * L_dir + w_region * L_region
```

- **L_dist（距离加权损失）**  
  使用邻接对作为正样本，随机远邻作为负样本。  
  采用 cosine similarity + 温度系数，邻接对更强约束。

- **L_dir（方向损失）**  
  8 方向分类交叉熵。

- **L_region（功能区损失）**  
  landuse 主类分类交叉熵。  
  若无 landuse 标签则跳过该 cell 的 `L_region`。

默认权重建议：  
`w_dir=0.5, w_region=0.5`（可在 `config_v26.py` 调整）

---

## 6. 训练策略

- **阶段化验证**（严格遵循项目原则）  
  1) 单实验区小样本  
  2) 三实验区  
  3) 全量 10% → 30% → 60% → 80% → 100%

- **采样策略**  
  - 邻接对作为正样本  
  - 随机远邻作为负样本  
  - 每 batch 保证负样本数量足够

---

## 7. 评估指标（v1）

- 方向准确率（direction accuracy）
- 功能区准确率（region accuracy）
- 简单检索指标（neighbor recall@k，后续补齐）

---

## 8. 容错与降级

- 无 landuse 标签：只训练 L_dist + L_dir
- 邻接对不足：退化为仅 L_dist（并记录日志）

---

## 9. 测试计划（最小可用）

- `encoder_v26` 前向输出 shape 检查
- `losses_v26` 返回非 NaN
- 小样本（mock）训练能跑通 1 step

---

## 10. 预计文件改动

- 新增：`encoder_v26.py`
- 新增：`losses_v26.py`
- 更新：`train_v26.py`（接入真实训练循环）
- 新增（轻量）：`evaluate_v26.py`

