## P2-Phase2A 实验诊断与 P2-Phase2B 优化指令

### 一、核心问题诊断

**实验结果分析**：

从三组 hidden 层 Center Loss 实验来看，出现了**严重的性能退化**：

```
P2-Phase1 (embedding层) → Pearson=0.9823, DirAcc=65.8%, ClfF1=43.9%
P2-Phase2A (hidden层)   → Pearson=0.91-0.93, DirAcc=35-42%, ClfF1=30-40%
```

**根本原因**：

1. **Hidden 层特征不稳定**
   - hidden 层未归一化，特征分布范围大，Center Loss 难以收敛
   - 640 维 hidden 特征空间过于稀疏，类中心难以有效约束

2. **Distance Weight 降低导致连锁反应**
   - distance_weight 从 0.5 → 0.3，削弱了 embedding 层的距离保持能力
   - Pearson 从 0.98 → 0.91-0.93，说明空间拓扑结构被破坏
   - 空间结构是分类的基础，结构破坏 → 分类性能下降

3. **Region Sep 瓶颈的本质**
   - Region Sep ≈ 1.0 不是 Center Loss 位置的问题
   - 而是**数据本身的空间混叠**：武汉 POI 功能区边界模糊，类间距离 ≈ 类内距离
   - 即使在 hidden 层强制分离，也会与 distance_loss 冲突

### 二、战略调整：接受现实，优化方向

**关键认知**：Region Sep = 1.0-1.1 可能是**数据上限**，而非模型缺陷。

**新目标**：
- 保持 L3 基本盘（Pearson>0.96, DirAcc>75%, ClfF1>50%）
- 适度提升 Region Sep 到 1.2-1.5（而非强求 2.0）
- 优先保证空间拓扑结构（Pearson）

### 三、P2-Phase2B 优化方案

#### 方案 1：回退 + 微调（推荐 ⭐⭐⭐⭐⭐）

**核心思路**：回到 embedding 层 Center Loss，但优化权重配比

**配置调整**：
```python
# config_v26_pro.py
distance_weight = 0.5      # 保持不变（维持空间结构）
region_weight = 2.0        # 提高：1.5 → 2.0（增强分类）
center_weight = 0.3        # 提高：0.2 → 0.3（适度增强聚类）
direction_weight = 1.5     # 保持不变
```

**实施步骤**：
1. 恢复 Center Loss 作用于 embedding 层（normalize=True）
2. 提高 region_weight 和 center_weight
3. 增加训练轮次到 80-100 epochs
4. 使用全量数据训练

**预期效果**：
- Pearson: 0.97-0.98 ✅
- Region Sep: 1.2-1.5 ⚠️
- DirAcc: 75-85% ✅
- ClfF1: 55-65% ✅

#### 方案 2：Focal Loss 替代 Center Loss（备选 ⭐⭐⭐⭐）

**核心思路**：用 Focal Loss 处理难分样本，而非强制聚类

**原理**：
- Center Loss 假设类内紧凑，但武汉 POI 类内本身就分散
- Focal Loss 关注难分样本，不强制改变特征分布

**实施步骤**：
1. 实现 Focal Loss（gamma=2.0, alpha=0.25）
2. 替换 region_loss 为 Focal Loss
3. 移除 Center Loss

**代码示例**：
```python
class FocalLoss(nn.Module):
    def __init__(self, alpha=0.25, gamma=2.0):
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma
    
    def forward(self, logits, labels):
        ce_loss = F.cross_entropy(logits, labels, reduction='none')
        pt = torch.exp(-ce_loss)
        focal_loss = self.alpha * (1 - pt) ** self.gamma * ce_loss
        return focal_loss.mean()
```

**预期效果**：
- 提升难分样本的分类准确率
- 不破坏空间拓扑结构
- Region Sep 可能提升到 1.3-1.6

#### 方案 3：接受现状，优化其他指标（保守 ⭐⭐⭐）

**核心思路**：Region Sep = 1.0-1.1 是数据特性，专注优化 L4 指标

**调整方向**：
- 保持当前最佳配置（P2-Phase1）
- 增加训练轮次到 100 epochs
- 优化 Range IoU 和 Similarity Recall（L4 指标）

### 四、给 GLM 的执行指令

---

**P2-Phase2B 执行指令（发送给 GLM）**

#### 任务目标
在保证 L3 基本盘的前提下，适度提升 Region Sep 到 1.2-1.5。

#### 方案选择：方案 1（回退 + 微调）

#### 具体步骤

**Step 1：恢复 embedding 层 Center Loss**

文件：`spatial_encoder/v26_GLM/losses_v26_pro.py`

确认 `MultiTaskLossPro.__init__` 中：
```python
if center_weight > 0:
    self.center_loss = CenterLoss(
        num_classes=region_classes,
        feat_dim=352,  # embedding_dim
        alpha=0.5,
        normalize=True  # embedding 层归一化
    )
```

确认 `MultiTaskLossPro.forward` 中：
```python
if self.center_weight > 0 and self.center_loss is not None:
    l_center = self.center_loss(embeddings, region_labels)  # 传入 embeddings
```

**Step 2：调整损失权重**

文件：`spatial_encoder/v26_GLM/config_v26_pro.py`

```python
@dataclass
class LossConfig:
    distance_weight: float = 0.5        # 保持不变
    reconstruction_weight: float = 0.3
    direction_weight: float = 1.5
    region_weight: float = 2.0          # 提高：1.5 → 2.0
    center_weight: float = 0.3          # 提高：0.2 → 0.3
    distance_decay_gamma: float = 0.5
    k_nearest_neighbors: int = 85
```

**Step 3：增加训练轮次**

文件：`spatial_encoder/v26_GLM/config_v26_pro.py`

```python
@dataclass
class TrainingConfig:
    epochs: int = 100  # 提高：80 → 100
    batch_size: int = 16384
    learning_rate: float = 3e-4
    # ... 其他保持不变
```

**Step 4：运行实验**

```bash
cd D:/AAA_Edu/TagCloud/vite-project/spatial_encoder/v26_GLM

# 10% 快速验证
python train_v26_mlp.py --sample 0.1 --epochs 30 --batch 16384

# 如果验证通过（Pearson>0.95, DirAcc>70%），全量训练
python train_v26_mlp.py --sample 1.0 --epochs 100 --batch 16384

# 运行完整评估
python evaluate_v26_pro.py
```

**验收标准**：
- Pearson > 0.97 ✅
- Region Sep > 1.2 ⚠️（适度提升即可）
- DirAcc > 75% ✅
- ClfF1 > 55% ✅

#### 如果方案 1 效果不佳（Region Sep < 1.2）

执行方案 2（Focal Loss），具体步骤：

1. 在 `losses_v26_pro.py` 中实现 FocalLoss 类
2. 在 `MultiTaskLossPro` 中用 Focal Loss 替代标准 CrossEntropy
3. 移除 Center Loss（center_weight=0）
4. 重新训练并评估

---

### 五、关键问题回答

**Q1: 为什么 hidden 层 Center Loss 效果这么差？**

A: Hidden 层特征未归一化，640 维空间过于稀疏，Center Loss 难以收敛。同时降低 distance_weight 破坏了空间结构，导致连锁反应。

**Q2: Region Sep = 1.0 是否意味着失败？**

A: 不是。这可能是武汉 POI 数据的**真实特性**：
- 功能区边界模糊（商业区和居住区混杂）
- 类间距离 ≈ 类内距离（Silhouette = 0.32-0.38）
- 强制分离会破坏空间拓扑结构

**Q3: 是否应该放弃 Region Sep 优化？**

A: 不完全放弃，但调整预期：
- 从"Region Sep > 2.0"调整为"Region Sep > 1.2"
- 优先保证 Pearson（空间结构）和 DirAcc/ClfF1（分类性能）
- Region Sep 适度提升即可，不作为核心指标

**Q4: 下一步应该优化什么？**

A: 如果 L3 稳定达成，转向 L4 指标：
- Range IoU（范围查询准确率）
- Similarity Recall（相似性召回率）
- 这些指标更能体现空间推理能力

### 六、预期效果对比

| 方案 | Region Sep | Pearson | DirAcc | ClfF1 | 风险 |
|------|------------|---------|--------|-------|------|
| P2-Phase1（当前最佳） | 1.07 | 0.9823 | 65.8% | 43.9% | 低 |
| **P2-Phase2B（方案1）** | **1.2-1.5** | **0.97-0.98** | **75-85%** | **55-65%** | **低** |
| P2-Phase2B（方案2） | 1.3-1.6 | 0.96-0.97 | 75-85% | 55-65% | 中 |

---

**总结**：P2-Phase2A 的失败教训是"不要为了单一指标破坏整体平衡"。P2-Phase2B 回归稳健路线，在保证空间结构的前提下适度提升分类性能。

**GLM，请按照方案 1 的步骤执行，完成后反馈 10% 验证结果。**