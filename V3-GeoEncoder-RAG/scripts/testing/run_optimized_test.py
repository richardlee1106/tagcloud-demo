# -*- coding: utf-8 -*-
"""
运行 10 道空间问题测试（优化后版本）

根据 2026-03-21_Small_LLM_Architecture_Test_Report.md 中的测试内容执行测试。

Author: Sisyphus
Date: 2026-03-21
"""

import requests
import json
import time
from datetime import datetime
from pathlib import Path

BASE_URL = "http://localhost:3300"
REPORTS_DIR = Path(__file__).resolve().parents[2] / "docs" / "reports" / "test-runs"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# 测试题目
TEST_CASES = [
    {"id": 1, "difficulty": "简单", "query": "武汉大学附近500米内有哪些餐厅"},
    {"id": 2, "difficulty": "简单", "query": "光谷广场周边1公里内的酒店"},
    {"id": 3, "difficulty": "简单", "query": "华中科技大学附近哪里可以喝咖啡"},
    {"id": 4, "difficulty": "一般", "query": "武汉市有哪些景点推荐"},
    {"id": 5, "difficulty": "一般", "query": "附近哪里有银行"},
    {"id": 6, "difficulty": "一般", "query": "汉口火车站附近有什么好吃的"},
    {"id": 7, "difficulty": "复杂", "query": "适合约会的餐厅推荐"},
    {"id": 8, "difficulty": "复杂", "query": "带小孩去哪里玩比较好"},
    {"id": 9, "difficulty": "复杂", "query": "中午想找个地方休息喝咖啡"},
    {"id": 10, "difficulty": "复杂", "query": "武汉一日游推荐"},
]

REGION_NAMES = ['居住类', '商业类', '工业类', '教育类', '公共类', '自然类']


def run_test(test_case):
    """运行单个测试"""
    start_time = time.time()

    try:
        resp = requests.post(
            f"{BASE_URL}/api/ask",
            json={"query": test_case["query"], "topK": 10},
            timeout=60
        )
        result = resp.json()

        total_duration = int((time.time() - start_time) * 1000)

        return {
            "id": test_case["id"],
            "difficulty": test_case["difficulty"],
            "query": test_case["query"],
            "success": result.get("success", False),
            "total_results": result.get("total", 0),
            "total_duration_ms": total_duration,
            "intent": result.get("intent", {}),
            "anchor": result.get("anchor", {}),
            "pipeline": result.get("pipeline", {}),
            "results": result.get("results", []),
            "answer": result.get("answer", ""),
        }
    except Exception as e:
        return {
            "id": test_case["id"],
            "difficulty": test_case["difficulty"],
            "query": test_case["query"],
            "success": False,
            "error": str(e),
            "total_duration_ms": int((time.time() - start_time) * 1000),
        }


def main():
    print("=" * 60)
    print("L6 MVP 空间查询测试（优化后版本）")
    print(f"测试时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 检查服务状态
    try:
        resp = requests.get(f"{BASE_URL}/health", timeout=5)
        health = resp.json()
        print(f"\n服务状态: {health.get('status')}")
        print(f"FAISS: {health.get('services', {}).get('faiss')}")
    except Exception as e:
        print(f"\n错误: 服务未就绪 - {e}")
        return

    results = []

    # 运行测试
    for tc in TEST_CASES:
        print(f"\n测试 {tc['id']}: {tc['query']}")
        result = run_test(tc)
        results.append(result)

        if result.get("success"):
            print(f"  ✅ 成功 | 结果数: {result['total_results']} | 耗时: {result['total_duration_ms']}ms")
            if result.get("results"):
                print(f"  Top 3:")
                for r in result["results"][:3]:
                    region = REGION_NAMES[r.get("regionLabel")] if r.get("regionLabel") is not None else "未知"
                    print(f"    - {r['name']} [{r['category']}] {r['distance_m']}m | 区域: {region}")
        else:
            print(f"  ❌ 失败 | 原因: {result.get('error', '无结果')}")

    # 生成报告
    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)

    # 成功率
    success_count = sum(1 for r in results if r.get("success"))
    print(f"\n成功率: {success_count}/10 ({success_count * 10}%)")

    # 平均耗时
    durations = [r["total_duration_ms"] for r in results if r.get("success")]
    avg_duration = sum(durations) / len(durations) if durations else 0
    print(f"平均耗时: {avg_duration:.0f}ms")

    # 详细表格
    print("\n| # | 难度 | 查询 | 耗时 | 成功 | 结果数 |")
    print("|---|------|------|------|------|--------|")
    for r in results:
        success_mark = "✅" if r.get("success") else "❌"
        print(f"| {r['id']} | {r['difficulty']} | {r['query'][:20]}... | {r['total_duration_ms']}ms | {success_mark} | {r.get('total_results', 0)} |")

    # 保存报告
    report_path = REPORTS_DIR / f"{datetime.now().strftime('%Y-%m-%d_%H-%M')}_Optimized_Test_Report.md"

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# L6 MVP 空间查询测试报告（优化后版本）\n\n")
        f.write(f"**测试时间**：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write("---\n\n")
        f.write("## 一、测试结果汇总\n\n")
        f.write(f"| 指标 | 值 |\n")
        f.write(f"|------|-----|\n")
        f.write(f"| 成功率 | {success_count}/10 |\n")
        f.write(f"| 平均耗时 | {avg_duration:.0f}ms |\n\n")
        f.write("---\n\n")
        f.write("## 二、详细测试记录\n\n")
        f.write("| # | 难度 | 查询 | 总耗时 | 成功 | 结果数 |\n")
        f.write("|---|------|------|--------|------|--------|\n")
        for r in results:
            success_mark = "✅" if r.get("success") else "❌"
            f.write(f"| {r['id']} | {r['difficulty']} | {r['query']} | {r['total_duration_ms']}ms | {success_mark} | {r.get('total_results', 0)} |\n")

        f.write("\n---\n\n")
        f.write("## 三、各测试详情\n\n")
        for r in results:
            f.write(f"### 测试 {r['id']}: {r['query']}\n\n")
            f.write(f"- **难度**: {r['difficulty']}\n")
            f.write(f"- **成功**: {'是' if r.get('success') else '否'}\n")
            f.write(f"- **总耗时**: {r['total_duration_ms']}ms\n")

            if r.get("intent"):
                f.write(f"- **意图类别**: {r['intent'].get('category', 'N/A')}\n")
                f.write(f"- **语义标签**: {r['intent'].get('semanticTags', [])}\n")

            if r.get("results"):
                f.write(f"\n**结果 ({len(r['results'])}条)**:\n\n")
                for i, res in enumerate(r["results"][:5]):
                    region = REGION_NAMES[res.get("regionLabel")] if res.get("regionLabel") is not None else "未知"
                    f.write(f"{i+1}. {res['name']} [{res['category']}] {res['distance_m']}m | 区域: {region}\n")

            f.write("\n")

    print(f"\n报告已保存至: {report_path}")


if __name__ == "__main__":
    main()
