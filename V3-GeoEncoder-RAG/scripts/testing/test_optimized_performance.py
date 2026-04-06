#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
优化后性能测试脚本
验证 PostGIS 空间过滤 + FAISS 向量检索的性能
"""

import requests
import json
import time
from datetime import datetime

BASE_URL = "http://127.0.0.1:3300"

TEST_QUERIES = [
    "武汉大学附近的餐厅",
    "江汉路附近的咖啡店",
    "汉口火车站附近的小吃",
    "武汉大学附近商业区的餐厅",
    "光谷附近的火锅",
    "华中科技大学附近的餐厅",
    "武汉市有哪些景点推荐",
    "一日游推荐",
    "适合约会的餐厅推荐",
    "江汉路附近的酒店",
]

def test_api(query):
    """测试单个查询"""
    start = time.time()
    try:
        resp = requests.post(
            f"{BASE_URL}/api/ask",
            json={"query": query},
            timeout=60
        )
        duration = (time.time() - start) * 1000

        if resp.status_code != 200:
            return {
                "query": query,
                "success": False,
                "error": resp.text[:200],
                "duration_ms": duration
            }

        data = resp.json()
        results = data.get("results", [])
        pipeline = data.get("pipeline", {})
        stages = {s["name"]: s.get("duration_ms", 0) for s in pipeline.get("stages", [])}

        return {
            "query": query,
            "success": data.get("success", False),
            "result_count": len(results),
            "duration_ms": duration,
            "stages": stages,
            "search_method": stages.get("hybrid_search", "unknown"),
            "intent_method": stages.get("intent_parsing", "unknown"),
            "top_results": [r.get("name", "N/A") for r in results[:3]]
        }
    except Exception as e:
        return {
            "query": query,
            "success": False,
            "error": str(e),
            "duration_ms": (time.time() - start) * 1000
        }

def main():
    print("=" * 70)
    print(f"优化后性能测试 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # 检查 FAISS 状态
    health = requests.get(f"{BASE_URL}/health").json()
    faiss_status = health.get("services", {}).get("faiss", "unknown")
    print(f"\nFAISS Status: {faiss_status}")
    print(f"POI Count: {health.get('faiss', {}).get('poiCount', 0)}")
    print(f"Load Time: {health.get('faiss', {}).get('loadTime', 0)}ms")

    print("\n" + "-" * 70)
    print("测试查询:")
    print("-" * 70)

    results = []
    total_duration = 0
    success_count = 0

    for query in TEST_QUERIES:
        result = test_api(query)
        results.append(result)
        total_duration += result.get("duration_ms", 0)

        status = "[OK]" if result.get("success") and result.get("result_count", 0) > 0 else "[FAIL]"
        if result.get("success"):
            success_count += 1

        stages = result.get("stages", {})
        search_time = stages.get("hybrid_search", 0)
        intent_time = stages.get("intent_parsing", 0)

        print(f"\n{status} {query}")
        print(f"   结果数: {result.get('result_count', 0)}, 总耗时: {result.get('duration_ms', 0):.0f}ms")
        print(f"   阶段耗时: 意图解析={intent_time:.0f}ms, 检索={search_time:.0f}ms")
        if result.get("top_results"):
            print(f"   示例: {', '.join(result['top_results'][:3])}")

    print("\n" + "=" * 70)
    print("测试汇总:")
    print("=" * 70)
    print(f"成功率: {success_count}/{len(TEST_QUERIES)} ({success_count/len(TEST_QUERIES)*100:.0f}%)")
    print(f"平均耗时: {total_duration/len(TEST_QUERIES):.0f}ms")
    print(f"总耗时: {total_duration:.0f}ms")

    # 分析各阶段耗时
    stage_totals = {}
    for r in results:
        for stage, duration in r.get("stages", {}).items():
            stage_totals[stage] = stage_totals.get(stage, 0) + duration

    print("\n各阶段平均耗时:")
    for stage, total in sorted(stage_totals.items(), key=lambda x: -x[1]):
        avg = total / len(TEST_QUERIES)
        print(f"  {stage}: {avg:.0f}ms")

    # 保存详细报告
    report = {
        "timestamp": datetime.now().isoformat(),
        "faiss_status": faiss_status,
        "summary": {
            "success_rate": f"{success_count}/{len(TEST_QUERIES)}",
            "avg_duration_ms": total_duration / len(TEST_QUERIES),
        },
        "results": results
    }

    with open("test_results_optimized.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n详细报告已保存至: test_results_optimized.json")

if __name__ == "__main__":
    main()
