# -*- coding: utf-8 -*-
"""
测试区域感知检索效果

验证空间编码器的区域预测能力是否能提升检索效果。

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


def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


def test_region_aware_search():
    """测试区域感知检索"""
    print("\n" + "="*60)
    print("测试区域感知检索")
    print("="*60)

    # 加载编码器服务
    sys.path.insert(0, str(PROJECT_ROOT))
    from python.poi_encoder_service import POIEncoderService

    service = POIEncoderService()

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 测试场景
    test_cases = [
        {
            "name": "武汉大学附近餐厅（教育区）",
            "anchor": {"lon": 114.3630, "lat": 30.5394},
            "radius_m": 1000,
            "category": "餐饮美食",
        },
        {
            "name": "江汉路附近餐厅（商业区）",
            "anchor": {"lon": 114.2800, "lat": 30.5800},
            "radius_m": 500,
            "category": "餐饮美食",
        },
        {
            "name": "汉口火车站附近餐厅（商业区）",
            "anchor": {"lon": 114.2600, "lat": 30.6200},
            "radius_m": 1000,
            "category": "餐饮美食",
        },
    ]

    for tc in test_cases:
        print(f"\n--- {tc['name']} ---")

        anchor = tc["anchor"]

        # 预测锚点区域
        anchor_region, anchor_probs = service.predict_region(anchor["lon"], anchor["lat"])
        print(f"锚点区域预测: {REGION_NAMES[anchor_region]} (置信度: {anchor_probs[anchor_region]:.2%})")

        # 查询附近餐饮
        cur.execute(f"""
            SELECT id, name, category_sub, region_label,
                   ST_X(geom) as lon, ST_Y(geom) as lat,
                   ST_Distance(geom::geography, ST_MakePoint({anchor['lon']}, {anchor['lat']})::geography) as dist_m,
                   spatial_embedding
            FROM pois
            WHERE category_main = '{tc['category']}'
              AND ST_DWithin(geom::geography, ST_MakePoint({anchor['lon']}, {anchor['lat']})::geography, {tc['radius_m']})
            ORDER BY dist_m
            LIMIT 20
        """)

        results = cur.fetchall()
        print(f"检索结果: {len(results)} 条")

        if not results:
            continue

        # 分析区域分布
        region_counts = {}
        for r in results:
            reg = r["region_label"]
            if reg is not None:
                reg_name = REGION_NAMES[reg]
                region_counts[reg_name] = region_counts.get(reg_name, 0) + 1

        print(f"区域分布: {region_counts}")

        # 区域感知重排：同区域加分
        reranked = []
        for r in results:
            poi_region = r["region_label"]
            boost = 0.0
            if poi_region is not None and poi_region == anchor_region:
                boost = 0.2  # 同区域加分

            # 计算综合分数
            spatial_score = 1.0 - (r["dist_m"] / tc["radius_m"])  # 距离越近分数越高
            final_score = spatial_score + boost

            reranked.append({
                "name": r["name"],
                "category": r["category_sub"],
                "dist_m": r["dist_m"],
                "region": REGION_NAMES[poi_region] if poi_region is not None else "未知",
                "spatial_score": spatial_score,
                "region_boost": boost,
                "final_score": final_score,
            })

        # 按综合分数排序
        reranked.sort(key=lambda x: x["final_score"], reverse=True)

        print("\n区域感知重排后 TOP 5:")
        for i, r in enumerate(reranked[:5]):
            print(f"  {i+1}. {r['name']} [{r['category']}] {r['dist_m']:.0f}m | {r['region']} | 分数: {r['final_score']:.2f}")

        # 对比原始排序
        print("\n原始距离排序 TOP 5:")
        original = sorted(reranked, key=lambda x: x["dist_m"])
        for i, r in enumerate(original[:5]):
            print(f"  {i+1}. {r['name']} [{r['category']}] {r['dist_m']:.0f}m | {r['region']}")

    cur.close()
    conn.close()


def test_semantic_clustering():
    """测试语义聚类能力"""
    print("\n" + "="*60)
    print("测试语义聚类能力（IntraRecall 91%）")
    print("="*60)

    # 加载编码器服务
    sys.path.insert(0, str(PROJECT_ROOT))
    from python.poi_encoder_service import POIEncoderService

    service = POIEncoderService()

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 测试：相似餐厅的 embedding 相似度
    test_pairs = [
        ("肯德基", "麦当劳"),
        ("星巴克", "瑞幸咖啡"),
        ("海底捞火锅", "小龙坎火锅"),
        ("肯德基", "海底捞火锅"),  # 不同类型，应该相似度低
    ]

    print("\n品牌对比分析:")
    for brand1, brand2 in test_pairs:
        cur.execute(f"""
            SELECT name, spatial_embedding
            FROM pois
            WHERE name LIKE '%{brand1}%'
            LIMIT 1
        """)
        r1 = cur.fetchone()

        cur.execute(f"""
            SELECT name, spatial_embedding
            FROM pois
            WHERE name LIKE '%{brand2}%'
            LIMIT 1
        """)
        r2 = cur.fetchone()

        if r1 and r2:
            emb1 = np.array(r1["spatial_embedding"])
            emb2 = np.array(r2["spatial_embedding"])
            sim = cosine_similarity(emb1, emb2)
            print(f"  {r1['name']} vs {r2['name']}: 相似度 = {sim:.4f}")
        else:
            print(f"  {brand1} vs {brand2}: 未找到数据")

    # 测试：同类餐厅的聚类效果
    print("\n同类餐厅聚类分析:")

    categories = ["中国菜", "咖啡", "小吃快餐"]

    for cat in categories:
        cur.execute(f"""
            SELECT name, spatial_embedding
            FROM pois
            WHERE category_sub = '{cat}'
            ORDER BY RANDOM()
            LIMIT 5
        """)
        samples = cur.fetchall()

        if len(samples) >= 2:
            embeddings = [np.array(r["spatial_embedding"]) for r in samples]
            # 计算类内相似度
            similarities = []
            for i in range(len(embeddings)):
                for j in range(i+1, len(embeddings)):
                    sim = cosine_similarity(embeddings[i], embeddings[j])
                    similarities.append(sim)

            avg_sim = np.mean(similarities)
            print(f"  {cat}: 类内相似度 = {avg_sim:.4f} (样本: {[r['name'][:10] for r in samples]})")

    cur.close()
    conn.close()


def main():
    print("\n" + "="*60)
    print("空间编码器分类能力测试")
    print("="*60)

    # 测试区域感知检索
    test_region_aware_search()

    # 测试语义聚类
    test_semantic_clustering()

    print("\n测试完成！")


if __name__ == "__main__":
    main()
