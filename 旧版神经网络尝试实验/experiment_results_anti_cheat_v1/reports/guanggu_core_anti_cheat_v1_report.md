# 防作弊实验报告 V1: guanggu_core

## 实验设计

### 防作弊措施

1. **标签来源**: KMeans 空间聚类（K=15），与 category 完全无关
2. **输入特征**: 移除 category 特征，只保留 landuse、road_class、数值特征、坐标
3. **评估目标**: 测试模型是否真正学到空间拓扑能力

## 实验配置

- Train/Val/Test = 0.70/0.15/0.15
- Runs = 1
- Spatial Clusters = 15
- Device = cuda (NVIDIA GeForce RTX 5060 Laptop GPU)

# 防作弊实验结果: guanggu_core

> **标签来源**: KMeans 空间聚类（与 category 无关）

> **输入特征**: landuse + road_class + 数值 + 坐标（移除 category）

## 核心指标

| Model | Silhouette | NMI | ARI | Distance Ratio |
|:------|:----------:|:---:|:---:|:--------------:|
| Full Model | -0.0194±0.0000 | 0.2815±0.0000 | 0.1270±0.0000 | 0.8934±0.0000 |
| Pure GNN | 0.0123±0.0000 | 0.3067±0.0000 | 0.1568±0.0000 | 0.8995±0.0000 |

## 统计检验（vs Full Model）

| Compared | Mean Diff | Cohen's dz | t-p | Wilcoxon-p | Holm p | Sig |
|:---------|:---------:|:----------:|:---:|:----------:|:------:|:----:|
| Pure GNN | -0.0316 | 0.0000 | 1.0000 | 1.0000 | 1.0000 | ✗ |

## 参数量对比

| Model | Parameters | Relative to Full |
|:------|:----------:|:----------------:|
| Full Model | 1,523,766 | 100.0% |
| Pure GNN | 90,934 | 6.0% |

## 环境信息

- torch_version: 2.12.0.dev20260312+cu128
- cuda_version: 12.8
- device: cuda
- gpu_name: NVIDIA GeForce RTX 5060 Laptop GPU
- python_version: 3.13.3
- os: Windows-11-10.0.26100-SP0
- timestamp: 2026-03-14 15:38:33
- faiss_available: True
- faiss_version: 1.13.2