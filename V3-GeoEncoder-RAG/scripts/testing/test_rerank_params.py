# -*- coding: utf-8 -*-
"""
精排参数调优实验

测试不同 spatial/semantic 权重组合对检索效果的影响。

Author: Sisyphus
Date: 2026-03-21
"""

import requests
import json
import time
from collections import defaultdict

# 测试查询集
TEST_QUERIES = [
    # {query, expected_keywords, expected_region}
    {"query": "武汉大学附近500米内的餐厅", "keywords": ["餐厅", "中国菜", "小吃", "快餐", "美食"], "region": None},
    {"query": "江汉路附近的咖啡店", "keywords": ["咖啡", "茶饮", "甜品"], "region": None},
    {"query": "汉口火车站附近的小吃", "keywords": ["小吃", "快餐", "中国菜"], "region": None},
    {"query": "武汉大学附近商业区的餐厅", "keywords": ["餐厅", "中国菜", "小吃"], "region": 1},
    {"query": "光谷附近的火锅", "keywords": ["火锅", "中国菜", "烧烤"], "region": None},
    {"query": "华中科技大学附近的餐厅", "keywords": ["餐厅", "中国菜", "小吃", "快餐"], "region": None},
]

# 参数组合
PARAM_COMBINATIONS = [
    {"spatial": 0.5, "semantic": 0.5, "name": "balanced"},
    {"spatial": 0.6, "semantic": 0.4, "name": "spatial_priority"},
    {"spatial": 0.4, "semantic": 0.6, "name": "semantic_priority"},
    {"spatial": 0.7, "semantic": 0.3, "name": "strong_spatial"},
    {"spatial": 0.3, "semantic": 0.7, "name": "strong_semantic"},
]


def test_query(query, timeout=60):
    """执行单次查询"""
    try:
        resp = requests.post(
            'http://127.0.0.1:3300/api/ask',
            json={'query': query},
            timeout=timeout
        )
        return resp.json()
    except Exception as e:
        return {"error": str(e)}


def evaluate_result(result, expected):
    """评估查询结果"""
    if not result.get('success'):
        return {"score": 0, "reason": result.get('error', 'unknown error')}

    results = result.get('results', [])
    expected_keywords = expected.get('keywords', [])
    expected_region = expected.get('region')

    # 1. 关键词匹配率（检查 category 是否包含期望关键词）
    keyword_match = 0
    for r in results:
        cat = r.get('category', '')
        name = r.get('name', '')
        # 检查类别或名称是否包含关键词
        if any(kw in cat or kw in name for kw in expected_keywords):
            keyword_match += 1
    keyword_match_rate = keyword_match / len(results) if results else 0

    # 2. 区域匹配率（如果指定）
    region_match_rate = None
    if expected_region is not None:
        region_match_rate = 1.0 if results else 0

    # 3. 结果多样性（不同类别的数量）
    unique_categories = set(r.get('category', '') for r in results)
    diversity = len(unique_categories)

    # 4. 综合评分
    score = keyword_match_rate * 0.5 + (region_match_rate or 0.5) * 0.3 + min(diversity / 5, 1) * 0.2

    return {
        "score": score,
        "keyword_match_rate": keyword_match_rate,
        "region_match_rate": region_match_rate,
        "diversity": diversity,
        "result_count": len(results),
    }


def run_experiment():
    """运行参数调优实验"""
    print("=" * 60)
    print("精排参数调优实验")
    print("=" * 60)

    results = defaultdict(list)

    for query_info in TEST_QUERIES:
        query = query_info['query']
        print(f"\n查询: {query}")

        result = test_query(query)
        evaluation = evaluate_result(result, query_info)

        print(f"  Results: {evaluation.get('result_count', 0)}")
        print(f"  Keyword match: {evaluation.get('keyword_match_rate', 0):.1%}")
        print(f"  Diversity: {evaluation.get('diversity', 0)}")
        print(f"  Score: {evaluation.get('score', 0):.2f}")

        results[query].append({
            "result": result,
            "evaluation": evaluation,
        })

    # 汇总
    print("\n" + "=" * 60)
    print("实验总结")
    print("=" * 60)

    total_score = 0
    total_keyword_match = 0
    total_diversity = 0
    count = 0

    for query, query_results in results.items():
        for qr in query_results:
            eval_data = qr['evaluation']
            total_score += eval_data.get('score', 0)
            total_keyword_match += eval_data.get('keyword_match_rate', 0)
            total_diversity += eval_data.get('diversity', 0)
            count += 1

    print(f"Avg score: {total_score / count:.2f}")
    print(f"Avg keyword match: {total_keyword_match / count:.1%}")
    print(f"Avg diversity: {total_diversity / count:.1f}")

    return results


if __name__ == "__main__":
    run_experiment()
