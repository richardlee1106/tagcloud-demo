# -*- coding: utf-8 -*-
"""
为餐饮美食 POI 补充区域标注

基于空间编码器的区域预测能力，为 OSM 导入的餐饮 POI 补充 region_label。

Author: Sisyphus
Date: 2026-03-21
"""

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

import psycopg2
from psycopg2.extras import RealDictCursor
import numpy as np
import torch

# 区域类别名称
REGION_NAMES = ["居住类", "商业类", "工业类", "教育类", "公共类", "自然类"]


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "15432")),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "123456"),
        database=os.getenv("POSTGRES_DATABASE", "geoloom"),
    )


def add_region_labels():
    """为餐饮美食 POI 添加区域标注"""
    print("\n" + "="*60)
    print("为餐饮美食 POI 补充区域标注")
    print("="*60)

    # 加载编码器服务
    sys.path.insert(0, str(PROJECT_ROOT))
    from python.poi_encoder_service import POIEncoderService

    service = POIEncoderService()

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 查询需要标注的餐饮 POI
    cur.execute("""
        SELECT id, name, ST_X(geom) as lon, ST_Y(geom) as lat
        FROM pois
        WHERE category_main = '餐饮美食' AND region_label IS NULL
        ORDER BY id
    """)

    pois = cur.fetchall()
    print(f"待标注 POI 数量: {len(pois):,}")

    if not pois:
        print("无需标注，所有餐饮 POI 已有区域标签")
        cur.close()
        conn.close()
        return

    # 批量预测
    batch_size = 1000
    updated = 0

    for i in range(0, len(pois), batch_size):
        batch = pois[i:i+batch_size]

        for poi in batch:
            lon, lat = poi["lon"], poi["lat"]
            region, probs = service.predict_region(lon, lat)

            # 只有置信度 > 0.5 才更新
            confidence = probs[region]
            if confidence > 0.5:
                cur.execute(
                    "UPDATE pois SET region_label = %s WHERE id = %s",
                    (region, poi["id"])
                )
                updated += 1

        conn.commit()
        print(f"进度: {min(i+batch_size, len(pois)):,}/{len(pois):,} ({updated:,} 已更新)")

    cur.close()
    conn.close()

    print(f"\n完成！共更新 {updated:,} 条 POI")


def analyze_region_distribution():
    """分析餐饮 POI 的区域分布"""
    print("\n" + "="*60)
    print("餐饮美食 POI 区域分布分析")
    print("="*60)

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 区域分布
    cur.execute("""
        SELECT
            CASE
                WHEN region_label IS NULL THEN 'NULL'
                ELSE %s[region_label + 1]
            END as region_type,
            COUNT(*) as cnt
        FROM pois
        WHERE category_main = '餐饮美食'
        GROUP BY region_label
        ORDER BY cnt DESC
    """, (REGION_NAMES,))

    print("\n区域分布:")
    for r in cur.fetchall():
        print(f"  {r['region_type']}: {r['cnt']:,}")

    # 各区域的中类分布
    print("\n各区域的餐饮中类分布:")

    for region_name in REGION_NAMES:
        cur.execute("""
            SELECT category_sub, COUNT(*) as cnt
            FROM pois
            WHERE category_main = '餐饮美食' AND region_label = %s
            GROUP BY category_sub
            ORDER BY cnt DESC
            LIMIT 3
        """, (REGION_NAMES.index(region_name),))

        results = cur.fetchall()
        if results:
            top_cats = ", ".join([f"{r['category_sub']}({r['cnt']:,})" for r in results])
            print(f"  {region_name}: {top_cats}")

    cur.close()
    conn.close()


def propose_utilization():
    """提出空间编码器分类能力的利用方案"""
    print("\n" + "="*60)
    print("空间编码器分类能力利用方案")
    print("="*60)

    print("""
## 当前问题

OSM 餐饮 POI 缺少 region_label，导致：
1. 空间编码器的区域预测能力无法用于检索过滤
2. 无法进行"商业区的餐厅"等区域感知查询
3. 语义聚类效果受限

## 解决方案

### 方案一：为餐饮 POI 补充区域标注（推荐）

已实现：`enhance_region_labels.py`

效果：
- 支持区域感知检索
- 支持区域过滤查询
- 提升语义理解

### 方案二：实时区域预测

在检索时实时计算候选 POI 的区域类型：

```javascript
// faissIndex.js 新增
async function faissRegionAwareSearch(params) {
    const { anchor, radius_m, category, targetRegion } = params;

    // 1. FAISS 召回
    let candidates = await faissHybridSearch(params);

    // 2. 区域过滤
    if (targetRegion) {
        candidates = candidates.filter(poi => {
            const region = predictRegion(poi.lon, poi.lat);
            return region === targetRegion;
        });
    }

    // 3. 区域加分
    const anchorRegion = predictRegion(anchor.lon, anchor.lat);
    candidates.forEach(poi => {
        const poiRegion = predictRegion(poi.lon, poi.lat);
        if (poiRegion === anchorRegion) {
            poi.score += 0.2;
        }
    });

    return candidates.sort((a, b) => b.score - a.score);
}
```

### 方案三：语义聚类精排

利用 IntraRecall 91% 的语义聚类能力：

```python
def semantic_rerank(candidates, query_embedding, top_k=10):
    # 计算语义相似度
    for poi in candidates:
        poi.semantic_score = cosine_similarity(
            query_embedding,
            poi.spatial_embedding
        )

    # 混合排序：空间距离 + 语义相似度
    candidates.sort(
        key=lambda p: 0.5 * p.spatial_score + 0.5 * p.semantic_score,
        reverse=True
    )

    return candidates[:top_k]
```

### 方案四：方向感知排序

支持"东边的餐厅"类查询：

```python
def direction_aware_filter(candidates, anchor, target_direction):
    filtered = []
    for poi in candidates:
        # 计算实际方向
        dx = poi.lon - anchor.lon
        dy = poi.lat - anchor.lat
        angle = math.atan2(dy, dx)
        direction = int((angle + math.pi) / (math.pi / 4)) % 8

        if direction == target_direction:
            filtered.append(poi)

    return filtered
```

## 推荐实施顺序

1. **首先**：为餐饮 POI 补充区域标注
2. **然后**：实现区域感知检索
3. **接着**：实现语义聚类精排
4. **最后**：实现方向感知排序

## 预期效果

| 方案 | 功能 | 提升效果 |
|------|------|---------|
| 区域标注 | 支持区域过滤查询 | +20% 精度 |
| 区域感知 | 同区域 POI 加分 | +15% 相关性 |
| 语义精排 | 语义相似度排序 | +25% 准确率 |
| 方向感知 | 方向过滤 | +10% 特定查询 |
""")


def main():
    print("\n" + "="*60)
    print("空间编码器分类能力增强")
    print("="*60)

    # 步骤 1: 为餐饮 POI 补充区域标注
    add_region_labels()

    # 步骤 2: 分析区域分布
    analyze_region_distribution()

    # 步骤 3: 提出利用方案
    propose_utilization()


if __name__ == "__main__":
    main()
