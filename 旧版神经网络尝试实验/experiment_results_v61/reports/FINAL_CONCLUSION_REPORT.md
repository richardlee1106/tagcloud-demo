# V6.1 实验最终结论报告

## 实验配置

- GATv2 heads: 4
- GATv2 layers: 2
- 距离编码维度: 16
- 方向编码 bins: 8
- 训练模式: 全图训练 (use_sampling=False)

## 实验结果

| 区域 | Silhouette | POI数量 |
|------|------------|---------|
| guanggu_core | 0.9954 | 13399 |
| wuda_area | 0.9895 | 6847 |
| zhongjia_cun | 0.9972 | 17407 |

## V6 vs V61 对比

| 区域 | V6 Silhouette | V61 Silhouette | 提升 |
|------|---------------|-----------------|------|
| guanggu_core | 0.7948 | 0.9954 | +25.2% |
| wuda_area | 0.7832 | 0.9895 | +26.3% |
| zhongjia_cun | 0.8038 | 0.9972 | +24.1% |

## 关键发现

1. **全图训练优于采样训练**: 使用use_sampling=False进行全图训练，Silhouette显著提升
2. **GATv2有效**: V61使用的GATv2ConvLayer配合空间注意力机制效果良好
3. **禁用Memory Bank**: 实验发现Memory Bank会干扰Triplet Loss学习