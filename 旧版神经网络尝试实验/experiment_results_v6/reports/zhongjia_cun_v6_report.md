# 严谨实验报告 V6: zhongjia_cun

## 实验配置

- Train/Val/Test = 0.70/0.15/0.15
- Runs = 5
- Batch Size = 256, Effective = 512
- Triplet Margin = 1.5
- KNN Method = auto
- Sparse Adjacency = True
- Device = cuda (NVIDIA GeForce RTX 5060 Laptop GPU)

# 实验结果: zhongjia_cun

## 核心指标

| Model | Silhouette | NMI | ARI | Distance Ratio |
|:------|:----------:|:---:|:---:|:--------------:|
| Full Model | 0.8038±0.0086 | 0.9408±0.0077 | 0.7896±0.0183 | 8.3126±0.3993 |
| Pure GNN | 0.4814±0.0296 | 0.9189±0.0049 | 0.7338±0.0241 | 2.0929±0.1342 |

## 统计检验（vs Full Model）

| Compared | Mean Diff | Cohen's dz | t-p | Wilcoxon-p | Holm p | Sig |
|:---------|:---------:|:----------:|:---:|:----------:|:------:|:----:|
| Pure GNN | 0.3224 | 11.9999 | 0.0000 | 0.0625 | 0.0000 | ✓ |

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