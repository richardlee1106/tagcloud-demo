# 严谨实验报告 V6: guanggu_core

## 实验配置

- Train/Val/Test = 0.70/0.15/0.15
- Runs = 5
- Batch Size = 256, Effective = 512
- Triplet Margin = 1.5
- KNN Method = auto
- Sparse Adjacency = True
- Device = cuda (NVIDIA GeForce RTX 5060 Laptop GPU)

# 实验结果: guanggu_core

## 核心指标

| Model | Silhouette | NMI | ARI | Distance Ratio |
|:------|:----------:|:---:|:---:|:--------------:|
| Full Model | 0.7948±0.0156 | 0.9417±0.0127 | 0.7913±0.0459 | 8.0538±0.4108 |
| Pure GNN | 0.4483±0.0221 | 0.9142±0.0097 | 0.7169±0.0381 | 1.9024±0.0879 |

## 统计检验（vs Full Model）

| Compared | Mean Diff | Cohen's dz | t-p | Wilcoxon-p | Holm p | Sig |
|:---------|:---------:|:----------:|:---:|:----------:|:------:|:----:|
| Pure GNN | 0.3465 | 8.9889 | 0.0000 | 0.0625 | 0.0000 | ✓ |

## 参数量对比

| Model | Parameters | Relative to Full |
|:------|:----------:|:----------------:|
| Full Model | 1,536,252 | 100.0% |
| Pure GNN | 97,276 | 6.3% |

## 环境信息

- torch_version: 2.12.0.dev20260312+cu128
- cuda_version: 12.8
- device: cuda
- gpu_name: NVIDIA GeForce RTX 5060 Laptop GPU
- python_version: 3.13.3
- os: Windows-11-10.0.26100-SP0
- timestamp: 2026-03-13 16:22:09
- faiss_available: False