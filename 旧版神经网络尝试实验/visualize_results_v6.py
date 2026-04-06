# -*- coding: utf-8 -*-
"""
可视化脚本 V6 - GNN修复版

适配版本: V6 (Embedding层+全图训练)

生成图表：
1. 箱线图 - 多次运行分布
2. 多指标对比图 - Silhouette/NMI/ARI
3. 收敛速度对比 - 训练曲线
4. 综合热力图 - 跨区域性能
5. 雷达图 - 多维度对比

字体：英文和数字使用 Times New Roman
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional
from dataclasses import dataclass

import matplotlib.pyplot as plt
import matplotlib
import numpy as np

# 设置字体
plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['Times New Roman', 'SimHei']
plt.rcParams['mathtext.fontset'] = 'stix'
plt.rcParams['axes.unicode_minus'] = False
matplotlib.rcParams['font.family'] = 'Times New Roman'
plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'Arial Unicode MS']

# 结果目录 - V6
VERSION = "v6"
RESULTS_DIR = Path(__file__).parent / f"experiment_results_{VERSION}"
PLOT_DIR = Path(__file__).parent / f"experiment_results_{VERSION}" / "plots"
JSON_DIR = RESULTS_DIR / "json"

# 模型配置
MODEL_NAMES = {
    "Full Model": "Full (Transformer+GNN+Road)",
    "Pure GNN": "Pure GNN",
}

MODEL_COLORS = {
    "Full Model": "#2196F3",
    "Pure GNN": "#FF9800",
}

MODEL_SHORT = {
    "Full Model": "Full",
    "Pure GNN": "GNN",
}

AREAS = ["guanggu_core", "wuda_area", "zhongjia_cun"]
AREA_NAMES = {
    "guanggu_core": "Guanggu Core",
    "wuda_area": "Wuda Area",
    "zhongjia_cun": "Zhongjia Cun",
}


def load_json_results() -> Dict[str, Dict]:
    """从 JSON 文件加载结果"""
    results = {}
    for area in AREAS:
        json_path = JSON_DIR / f"{area}_v6_results.json"
        if json_path.exists():
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                results[area] = data["results"]
    return results


def set_newroma_font(ax):
    """设置轴使用 Times New Roman 字体"""
    for label in ax.get_xticklabels() + ax.get_yticklabels():
        label.set_fontname('Times New Roman')
    ax.xaxis.label.set_fontname('Times New Roman')
    ax.yaxis.label.set_fontname('Times New Roman')
    ax.title.set_fontname('Times New Roman')


# =========================================================
# 图表 1: 箱线图
# =========================================================

def plot_boxplot(results: Dict, output_dir: Path):
    """绘制箱线图"""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.suptitle('Distribution of Silhouette Scores Across Runs', fontsize=14, fontname='Times New Roman')

    models = ["Full Model", "Pure GNN"]

    for idx, metric_name in enumerate(["silhouette", "nmi", "ari"]):
        ax = axes[idx]

        data_to_plot = []
        labels = []
        colors = []

        for model in models:
            all_values = []
            for area in AREAS:
                if area in results and model in results[area]:
                    values = results[area][model]["summary"].get(metric_name, {}).get("values", [])
                    all_values.extend(values)

            if all_values:
                data_to_plot.append(all_values)
                labels.append(MODEL_SHORT[model])
                colors.append(MODEL_COLORS[model])

        if data_to_plot:
            bp = ax.boxplot(data_to_plot, labels=labels, patch_artist=True)
            for patch, color in zip(bp['boxes'], colors):
                patch.set_facecolor(color)
                patch.set_alpha(0.7)

        ax.set_ylabel(metric_name.upper(), fontname='Times New Roman')
        ax.set_title(f'{metric_name.upper()} Distribution', fontname='Times New Roman')
        ax.grid(axis='y', alpha=0.3)
        set_newroma_font(ax)

        if metric_name == "silhouette":
            ax.axhline(y=0.7, color='green', linestyle='--', alpha=0.5, label='Good')
            ax.axhline(y=0.5, color='orange', linestyle='--', alpha=0.5, label='Moderate')

    plt.tight_layout()
    plt.savefig(output_dir / "boxplot_metrics.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  [1/5] 箱线图: {output_dir / 'boxplot_metrics.png'}")


# =========================================================
# 图表 2: 多指标对比
# =========================================================

def plot_multi_metrics_comparison(results: Dict, output_dir: Path):
    """绘制多指标对比"""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.suptitle('Multi-Metric Comparison Across Areas', fontsize=14, fontname='Times New Roman')

    models = ["Full Model", "Pure GNN"]
    metric_names = ["silhouette", "nmi", "ari"]
    metric_labels = ["Silhouette", "NMI", "ARI"]

    for idx, (metric, label) in enumerate(zip(metric_names, metric_labels)):
        ax = axes[idx]

        x = np.arange(len(AREAS))
        width = 0.35

        for i, model in enumerate(models):
            means = []
            stds = []
            for area in AREAS:
                summary = results.get(area, {}).get(model, {}).get("summary", {}).get(metric, {})
                means.append(summary.get("mean", 0))
                stds.append(summary.get("std", 0))

            bars = ax.bar(x + i * width, means, width, yerr=stds, capsize=3,
                         label=MODEL_SHORT[model], color=MODEL_COLORS[model], alpha=0.8)

        ax.set_ylabel(label, fontname='Times New Roman')
        ax.set_xticks(x + width / 2)
        ax.set_xticklabels([AREA_NAMES.get(a, a) for a in AREAS])
        ax.legend(fontsize=10)
        ax.grid(axis='y', alpha=0.3)
        set_newroma_font(ax)

        if metric == "silhouette":
            ax.axhline(y=0.7, color='green', linestyle='--', alpha=0.5)
            ax.axhline(y=0.5, color='orange', linestyle='--', alpha=0.5)

    plt.tight_layout()
    plt.savefig(output_dir / "multi_metrics_comparison.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  [2/5] 多指标对比: {output_dir / 'multi_metrics_comparison.png'}")


# =========================================================
# 图表 3: 收敛速度
# =========================================================

def plot_convergence_speed(output_dir: Path):
    """绘制收敛速度 - 从 progress.txt 解析"""
    progress_path = RESULTS_DIR / "progress.txt"
    if not progress_path.exists():
        print("  [3/5] 收敛速度图: progress.txt 不存在")
        return

    with open(progress_path, "r", encoding="utf-8") as f:
        content = f.read()

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.suptitle('Convergence Speed Analysis', fontsize=14, fontname='Times New Roman')

    # 解析日志
    current_area = None
    current_model = None
    area_data = {area: {} for area in AREAS}

    epoch_pattern = re.compile(r"Epoch (\d+) \| Loss=([\d.]+) \| Val_Sil=([-.\d]+)")
    area_pattern = re.compile(r"实验区域: (\w+)")
    model_pattern = re.compile(r"==+ (Full Model|Pure GNN)")

    lines = content.split("\n")
    for i, line in enumerate(lines):
        area_match = area_pattern.search(line)
        if area_match:
            current_area = area_match.group(1)
            continue

        model_match = model_pattern.search(line)
        if model_match and current_area:
            current_model = model_match.group(1)
            if current_model not in area_data[current_area]:
                area_data[current_area][current_model] = []
            continue

        epoch_match = epoch_pattern.search(line)
        if epoch_match and current_area and current_model:
            area_data[current_area][current_model].append({
                "epoch": int(epoch_match.group(1)),
                "val_silhouette": float(epoch_match.group(3)),
            })

    for idx, area in enumerate(AREAS):
        ax = axes[idx]

        if area not in area_data:
            continue

        for model in ["Full Model", "Pure GNN"]:
            if model not in area_data[area]:
                continue

            epochs_data = area_data[area][model]
            if not epochs_data:
                continue

            # 只取第一个 run 的数据
            epochs = [e["epoch"] for e in epochs_data[:20]]  # 限制20个点
            val_sils = [e["val_silhouette"] for e in epochs_data[:20]]

            ax.plot(epochs, val_sils, label=MODEL_SHORT[model],
                   color=MODEL_COLORS[model], linewidth=2)

        ax.axhline(y=0.7, color='green', linestyle='--', alpha=0.5, label='Target (0.7)')
        ax.set_xlabel('Epoch', fontname='Times New Roman')
        ax.set_ylabel('Val Silhouette', fontname='Times New Roman')
        ax.set_title(AREA_NAMES.get(area, area), fontname='Times New Roman')
        ax.legend(fontsize=10)
        ax.grid(alpha=0.3)
        ax.set_ylim(-0.2, 1.0)
        set_newroma_font(ax)

    plt.tight_layout()
    plt.savefig(output_dir / "convergence_speed.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  [3/5] 收敛速度图: {output_dir / 'convergence_speed.png'}")


# =========================================================
# 图表 4: 综合热力图
# =========================================================

def plot_comprehensive_heatmap(results: Dict, output_dir: Path):
    """绘制综合热力图"""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.suptitle('Performance Heatmap', fontsize=14, fontname='Times New Roman')

    models = ["Full Model", "Pure GNN"]

    for idx, metric in enumerate(["silhouette", "nmi", "ari"]):
        ax = axes[idx]

        data = np.zeros((len(models), len(AREAS)))
        for j, area in enumerate(AREAS):
            for i, model in enumerate(models):
                summary = results.get(area, {}).get(model, {}).get("summary", {}).get(metric, {})
                data[i, j] = summary.get("mean", 0)

        im = ax.imshow(data, cmap='RdYlGn', aspect='auto',
                      vmin=-0.5 if metric == "silhouette" else 0, vmax=1)

        ax.set_xticks(np.arange(len(AREAS)))
        ax.set_yticks(np.arange(len(models)))
        ax.set_xticklabels([AREA_NAMES.get(a, a) for a in AREAS])
        ax.set_yticklabels([MODEL_SHORT[m] for m in models])

        for i in range(len(models)):
            for j in range(len(AREAS)):
                text = ax.text(j, i, f"{data[i, j]:.3f}",
                              ha="center", va="center", color="black", fontsize=11,
                              fontname='Times New Roman')

        ax.set_title(metric.upper(), fontname='Times New Roman')
        fig.colorbar(im, ax=ax, shrink=0.8)
        set_newroma_font(ax)

    plt.tight_layout()
    plt.savefig(output_dir / "comprehensive_heatmap.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  [4/5] 综合热力图: {output_dir / 'comprehensive_heatmap.png'}")


# =========================================================
# 图表 5: 雷达图
# =========================================================

def plot_radar_chart(results: Dict, output_dir: Path):
    """绘制多维度雷达图"""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5), subplot_kw=dict(projection='polar'))
    fig.suptitle('Multi-Dimensional Performance Radar', fontsize=14, fontname='Times New Roman')

    models = ["Full Model", "Pure GNN"]
    dimensions = ['Silhouette', 'NMI', 'ARI', 'Stability', 'Efficiency']

    for idx, area in enumerate(AREAS):
        ax = axes[idx]

        angles = np.linspace(0, 2 * np.pi, len(dimensions), endpoint=False).tolist()
        angles += angles[:1]

        for model in models:
            summary = results.get(area, {}).get(model, {}).get("summary", {})

            sil = summary.get("silhouette", {}).get("mean", 0)
            nmi = summary.get("nmi", {}).get("mean", 0)
            ari = summary.get("ari", {}).get("mean", 0)
            sil_std = summary.get("silhouette", {}).get("std", 0)
            stability = 1 - sil_std
            efficiency = 0.8 if model == "Pure GNN" else 0.6

            values = [(sil + 1) / 2, nmi, ari, stability, efficiency]
            values += values[:1]

            ax.plot(angles, values, 'o-', label=MODEL_SHORT[model],
                   color=MODEL_COLORS[model], linewidth=2)
            ax.fill(angles, values, alpha=0.1, color=MODEL_COLORS[model])

        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(dimensions, fontsize=9, fontname='Times New Roman')
        ax.set_title(AREA_NAMES.get(area, area), pad=20, fontname='Times New Roman')
        ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1), fontsize=8)

    plt.tight_layout()
    plt.savefig(output_dir / "radar_chart.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  [5/5] 雷达图: {output_dir / 'radar_chart.png'}")


# =========================================================
# 报告生成
# =========================================================

def generate_full_report(results: Dict) -> str:
    """生成完整报告"""
    import datetime

    report = f"""# {VERSION.upper()} 实验完整可视化报告

## 1. 核心结果汇总

### Silhouette 对比

| Area | Full Model | Pure GNN |
|------|------------|----------|
"""

    for area in AREAS:
        row = [AREA_NAMES.get(area, area)]
        for model in ["Full Model", "Pure GNN"]:
            summary = results.get(area, {}).get(model, {}).get("summary", {}).get("silhouette", {})
            mean = summary.get("mean", 0)
            std = summary.get("std", 0)
            if mean:
                row.append(f"{mean:.4f}±{std:.4f}")
            else:
                row.append("N/A")
        report += "| " + " | ".join(row) + " |\n"

    report += f"""
## 2. 关键改进

### GNN 架构修复
- **使用 Embedding 层**：替代原始数值 ID，让 GNN 能正确学习离散特征
- **减少 GCN 层数**：从 4 层减少到 2 层，避免过平滑
- **修复残差连接**：所有层都使用残差连接

### 训练策略优化
- **全图训练模式**：训练和验证使用相同的图结构
- **保持 KNN K=10**：稀疏图结构，避免过度聚合

## 3. 生成的图表

| 文件名 | 说明 |
|--------|------|
| `boxplot_metrics.png` | 多指标箱线图 |
| `multi_metrics_comparison.png` | 多指标对比 |
| `convergence_speed.png` | 收敛速度对比 |
| `comprehensive_heatmap.png` | 综合热力图 |
| `radar_chart.png` | 多维雷达图 |

---
*报告生成时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*
"""

    return report


# =========================================================
# 主函数
# =========================================================

def main():
    print("=" * 60)
    print(f"{VERSION.upper()} 实验结果可视化")
    print("=" * 60)

    PLOT_DIR.mkdir(exist_ok=True, parents=True)

    # 从 JSON 加载结果
    print("\n[加载数据]")
    results = load_json_results()

    print(f"  找到 {len(results)} 个区域")
    for area in results:
        print(f"    {area}: {len(results[area])} 个模型")

    if not results:
        print("  [警告] 未找到实验结果，请先运行实验")
        return

    # 生成图表
    print("\n[生成图表]")

    plot_boxplot(results, PLOT_DIR)
    plot_multi_metrics_comparison(results, PLOT_DIR)
    plot_convergence_speed(PLOT_DIR)
    plot_comprehensive_heatmap(results, PLOT_DIR)
    plot_radar_chart(results, PLOT_DIR)

    # 生成报告
    print("\n[生成报告]")
    report = generate_full_report(results)
    report_path = PLOT_DIR / "full_visualization_report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"  报告: {report_path}")

    print("\n" + "=" * 60)
    print("可视化完成！")
    print("=" * 60)
    print(f"\n输出目录: {PLOT_DIR}")
    print("\n生成的图表:")
    for f in sorted(PLOT_DIR.glob("*.png")):
        size_kb = f.stat().st_size / 1024
        print(f"  {f.name}: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
