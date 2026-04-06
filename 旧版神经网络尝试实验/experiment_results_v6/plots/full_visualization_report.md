# V6 实验完整可视化报告

## 1. 核心结果汇总

### Silhouette 对比

| Area | Full Model | Pure GNN |
|------|------------|----------|
| Guanggu Core | 0.7948±0.0156 | 0.4483±0.0221 |
| Wuda Area | 0.7832±0.0124 | 0.4151±0.0255 |
| Zhongjia Cun | 0.8038±0.0086 | 0.4814±0.0296 |

## 2. 关键改进

### GNN 架构修复
- **使用 Embedding 层**：替代原始数值 ID，让 GNN 能正确学习离散特征
- **减少 GCN 层数**：从 4 层减少到 2 层，避免过平滑
- **修复残差连接**：所有层都使用残差连接

### 训练策略优化
- **全图训练模式**：训练和验证使用相同的图结构
- **保持 KNN K=10**：稀疏图结构，避免过度聚合

## 3. 生成的图表

| 文件名 | 说明 |
|--------|------|
| `boxplot_metrics.png` | 多指标箱线图 |
| `multi_metrics_comparison.png` | 多指标对比 |
| `convergence_speed.png` | 收敛速度对比 |
| `comprehensive_heatmap.png` | 综合热力图 |
| `radar_chart.png` | 多维雷达图 |

---
*报告生成时间: 2026-03-13 16:46:24*
