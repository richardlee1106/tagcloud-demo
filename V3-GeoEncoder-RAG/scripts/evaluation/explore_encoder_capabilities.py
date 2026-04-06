# -*- coding: utf-8 -*-
"""
探索空间编码器分类能力的利用方案

分析：
1. 空间编码器的分类能力（方向预测、区域预测）
2. 当前架构如何利用这些能力
3. 改进方案

Author: Sisyphus
Date: 2026-03-21
"""

import os
import sys
from pathlib import Path

# 添加项目路径
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

import psycopg2
from psycopg2.extras import RealDictCursor
import numpy as np
import torch

# 数据库连接
def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "15432")),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "123456"),
        database=os.getenv("POSTGRES_DATABASE", "geoloom"),
    )


def analyze_encoder_capabilities():
    """分析空间编码器的分类能力"""
    print("\n" + "="*60)
    print("分析空间编码器的分类能力")
    print("="*60)

    # 加载编码器服务
    sys.path.insert(0, str(PROJECT_ROOT))
    from python.poi_encoder_service import POIEncoderService

    service = POIEncoderService()

    # 区域类别名称
    REGION_NAMES = ["居住类", "商业类", "工业类", "教育类", "公共类", "自然类"]
    DIRECTION_NAMES = ["东", "东南", "南", "西南", "西", "西北", "北", "东北"]

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 测试样本：不同区域的餐饮 POI
    test_cases = [
        {"name": "武汉大学", "lon": 114.3630, "lat": 30.5394},
        {"name": "光谷广场", "lon": 114.4100, "lat": 30.5000},
        {"name": "汉口火车站", "lon": 114.2600, "lat": 30.6200},
        {"name": "黄鹤楼", "lon": 114.3000, "lat": 30.5500},
        {"name": "江汉路步行街", "lon": 114.2800, "lat": 30.5800},
    ]

    print("\n--- 方向预测 vs 区域预测 ---\n")

    for tc in test_cases:
        lon, lat = tc["lon"], tc["lat"]

        # 方向预测
        direction, dir_probs = service.predict_direction(lon, lat)

        # 区域预测
        region, reg_probs = service.predict_region(lon, lat)

        print(f"{tc['name']} ({lon:.4f}, {lat:.4f}):")
        print(f"  方向预测: {DIRECTION_NAMES[direction]} (置信度: {dir_probs[direction]:.2%})")
        print(f"  区域预测: {REGION_NAMES[region]} (置信度: {reg_probs[region]:.2%})")
        print(f"  区域概率分布: {dict(zip(REGION_NAMES, reg_probs.round(2)))}")
        print()

    # 分析餐饮 POI 的区域分布
    print("\n--- 餐饮美食 POI 的区域分布 ---\n")

    cur.execute("""
        SELECT
            CASE
                WHEN region_label = 0 THEN '居住类'
                WHEN region_label = 1 THEN '商业类'
                WHEN region_label = 2 THEN '工业类'
                WHEN region_label = 3 THEN '教育类'
                WHEN region_label = 4 THEN '公共类'
                WHEN region_label = 5 THEN '自然类'
                ELSE '未知'
            END as region_type,
            COUNT(*) as cnt
        FROM pois
        WHERE category_main = '餐饮美食'
        GROUP BY region_label
        ORDER BY cnt DESC
    """)

    for row in cur.fetchall():
        print(f"  {row['region_type']}: {row['cnt']:,}")

    # 分析餐饮 POI 的空间聚类特征
    print("\n--- 餐饮美食 POI 的空间聚类分析 ---\n")

    cur.execute("""
        SELECT
            category_sub,
            COUNT(*) as cnt,
            AVG(ST_X(geom)) as avg_lon,
            AVG(ST_Y(geom)) as avg_lat,
            STDDEV(ST_X(geom)) as std_lon,
            STDDEV(ST_Y(geom)) as std_lat
        FROM pois
        WHERE category_main = '餐饮美食'
        GROUP BY category_sub
        HAVING COUNT(*) > 100
        ORDER BY cnt DESC
        LIMIT 10
    """)

    print("中类 | 数量 | 平均坐标 | 空间分散度")
    print("-" * 60)
    for row in cur.fetchall():
        dispersion = (row['std_lon'] + row['std_lat']) / 2 * 100
        print(f"{row['category_sub']}: {row['cnt']:,}, ({row['avg_lon']:.4f}, {row['avg_lat']:.4f}), 分散度: {dispersion:.2f}")

    cur.close()
    conn.close()

    return service


def propose_integration_scheme(service):
    """提出集成方案"""
    print("\n" + "="*60)
    print("空间编码器分类能力的集成方案")
    print("="*60)

    print("""
## 当前问题

空间编码器达成了 L3 级别：
- Region F1: 90.48% (区域分类准确)
- DirAcc: 68.41% (方向预测准确)
- IntraRecall: 91.42% (语义聚类能力)

但这些能力在当前 L6 MVP 架构中**未被利用**：

```
当前流程：
用户查询 → 意图解析(LLM) → FAISS检索 → 语义筛选(LLM) → 结果

缺失环节：
- 区域预测能力未用于筛选
- 方向预测能力未用于排序
- 语义聚类能力只用于召回，未用于精排
```

## 方案一：区域感知检索

将区域预测集成到检索流程：

```python
def region_aware_search(query_embedding, anchor, candidates):
    # 1. 预测锚点的区域类型
    anchor_region, region_probs = encoder.predict_region(anchor.lon, anchor.lat)

    # 2. 对候选 POI 进行区域打分
    for poi in candidates:
        poi_region, _ = encoder.predict_region(poi.lon, poi.lat)
        # 同区域加分
        if poi_region == anchor_region:
            poi.region_boost = 0.2
        else:
            poi.region_boost = 0.0

    # 3. 重新排序
    return sorted(candidates, key=lambda p: p.score + p.region_boost, reverse=True)
```

## 方案二：方向感知排序

利用方向预测优化"附近的X"类查询：

```python
def direction_aware_sort(candidates, anchor, query_direction):
    # query_direction: 用户意图中的方向（如"东边的餐厅"）
    for poi in candidates:
        # 计算实际方向
        actual_direction = compute_direction(anchor, poi)
        # 方向匹配加分
        if actual_direction == query_direction:
            poi.direction_boost = 0.3
        else:
            poi.direction_boost = 0.0
```

## 方案三：语义聚类精排

利用 IntraRecall 91% 的语义聚类能力：

```python
def semantic_cluster_rerank(candidates, query_embedding):
    # 1. 获取候选 POI 的 embedding
    candidate_embeddings = [poi.spatial_embedding for poi in candidates]

    # 2. 计算与查询的语义相似度
    for poi in candidates:
        poi.semantic_score = cosine_similarity(query_embedding, poi.spatial_embedding)

    # 3. 结合空间距离和语义相似度
    return sorted(candidates, key=lambda p:
        0.5 * p.spatial_score + 0.5 * p.semantic_score, reverse=True)
```

## 方案四：区域类型过滤

利用 Region F1 90% 的高准确率：

```python
# 用户查询"商业区的餐厅"
def region_type_filter(candidates, target_region_type):
    filtered = []
    for poi in candidates:
        region, probs = encoder.predict_region(poi.lon, poi.lat)
        if region == target_region_type and probs[region] > 0.7:
            filtered.append(poi)
    return filtered
```

## 推荐优先级

1. **方案三（语义聚类精排）** - 最容易实现，提升明显
2. **方案一（区域感知检索）** - 增加上下文理解
3. **方案四（区域类型过滤）** - 支持更复杂的查询
4. **方案二（方向感知排序）** - 针对特定查询类型
""")


def main():
    print("\n" + "="*60)
    print("空间编码器分类能力探索")
    print("="*60)

    # 分析编码器能力
    service = analyze_encoder_capabilities()

    # 提出集成方案
    propose_integration_scheme(service)

    print("\n完成！")


if __name__ == "__main__":
    main()
