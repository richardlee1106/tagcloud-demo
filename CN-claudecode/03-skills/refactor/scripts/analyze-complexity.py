#!/usr/bin/env python3
"""
代码度量分析器

分析 Python、JavaScript 和 TypeScript 文件的常见代码度量指标。
帮助衡量重构前后度量值的变化。

用法：
    python analyze-metrics.py <文件>
    python analyze-metrics.py <修改前文件> <修改后文件>  # 对比模式

度量指标：
    - Cyclomatic Complexity（圈复杂度）：代码中的决策点数量
    - Cognitive Complexity（认知复杂度）：理解代码的难度
    - Maintainability Index（可维护性指数）：整体可维护性评分（0-100）
    - Lines of Code（代码行数）：总行数
    - Function Count（函数数量）：函数/方法数量
    - Average Function Length（平均函数长度）：每个函数的行数
"""

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class FunctionMetrics:
    """单个函数的度量数据。"""
    name: str
    start_line: int
    end_line: int
    lines: int
    cyclomatic_complexity: int
    cognitive_complexity: int
    parameter_count: int


@dataclass
class FileMetrics:
    """单个文件的度量数据。"""
    filename: str
    lines_of_code: int
    blank_lines: int
    comment_lines: int
    function_count: int
    class_count: int
    cyclomatic_complexity: int
    cognitive_complexity: int
    maintainability_index: float
    avg_function_length: float
    max_function_length: int
    functions: List[FunctionMetrics]


class ComplexityAnalyzer:
    """分析多种编程语言的代码复杂度。"""

    # 不同语言的模式
    PATTERNS = {
        'python': {
            'function': r'^\s*def\s+(\w+)\s*\(',
            'class': r'^\s*class\s+(\w+)',
            'decision': [r'\bif\b', r'\belif\b', r'\bfor\b', r'\bwhile\b',
                        r'\bexcept\b', r'\band\b(?!$)', r'\bor\b(?!$)',
                        r'\bcase\b', r'\btry\b'],
            'comment': r'^\s*#',
            'multiline_comment_start': r'^\s*["\']["\']["\']',
            'multiline_comment_end': r'["\']["\']["\']',
        },
        'javascript': {
            'function': r'(?:function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))',
            'class': r'class\s+(\w+)',
            'decision': [r'\bif\b', r'\belse\s+if\b', r'\bfor\b', r'\bwhile\b',
                        r'\bcatch\b', r'\b\?\b', r'\b&&\b', r'\b\|\|\b',
                        r'\bcase\b', r'\btry\b'],
            'comment': r'^\s*//',
            'multiline_comment_start': r'/\*',
            'multiline_comment_end': r'\*/',
        },
        'typescript': {
            'function': r'(?:function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))',
            'class': r'class\s+(\w+)',
            'decision': [r'\bif\b', r'\belse\s+if\b', r'\bfor\b', r'\bwhile\b',
                        r'\bcatch\b', r'\b\?\b', r'\b&&\b', r'\b\|\|\b',
                        r'\bcase\b', r'\btry\b'],
            'comment': r'^\s*//',
            'multiline_comment_start': r'/\*',
            'multiline_comment_end': r'\*/',
        }
    }

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.filename = os.path.basename(filepath)
        self.language = self._detect_language()
        self.patterns = self.PATTERNS.get(self.language, self.PATTERNS['python'])

        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            self.code = f.read()
        self.lines = self.code.split('\n')

    def _detect_language(self) -> str:
        """根据文件扩展名检测编程语言。"""
        ext = os.path.splitext(self.filepath)[1].lower()
        ext_map = {
            '.py': 'python',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
        }
        return ext_map.get(ext, 'python')

    def calculate_cyclomatic_complexity(self, code: Optional[str] = None) -> int:
        """
        使用 McCabe 方法计算圈复杂度。
        CC = E - N + 2P，其中 E=边，N=节点，P=连通分量
        简化版：计算决策点数量 + 1
        """
        if code is None:
            code = self.code

        complexity = 1  # 基础复杂度

        for pattern in self.patterns['decision']:
            matches = re.findall(pattern, code)
            complexity += len(matches)

        return complexity

    def calculate_cognitive_complexity(self, code: Optional[str] = None) -> int:
        """
        计算认知复杂度。
        衡量理解代码的难度。
        考虑嵌套深度和控制流中断。
        """
        if code is None:
            code = self.code

        lines = code.split('\n')
        cognitive = 0
        nesting_depth = 0
        in_function = False

        for line in lines:
            stripped = line.strip()

            # 追踪函数边界
            if re.search(self.patterns['function'], line):
                in_function = True
                nesting_depth = 0

            # 控制流结构增加计数
            if re.search(r'\b(if|for|while|switch)\b', stripped):
                nesting_depth += 1
                cognitive += nesting_depth  # 嵌套结构成本更高

            elif re.search(r'\b(elif|else if|else|catch|finally)\b', stripped):
                cognitive += nesting_depth  # 与父级同级

            # 通过大括号/缩进追踪嵌套
            if self.language in ['javascript', 'typescript']:
                nesting_depth += stripped.count('{') - stripped.count('}')
                nesting_depth = max(0, nesting_depth)

            # 线性流程中断加分
            if re.search(r'\b(break|continue|return|throw)\b', stripped):
                if nesting_depth > 1:
                    cognitive += 1

            # 递归加分
            # （简化版：仅查找函数调用自身）

        return cognitive

    def calculate_maintainability_index(self) -> float:
        """
        计算可维护性指数（0-100）。
        基于 Halstead Volume（Halstead 量）、圈复杂度和代码行数。

        MI = max(0, (171 - 5.2*ln(V) - 0.23*CC - 16.2*ln(LOC)) * 100/171)

        解读：
        - 85-100：高度可维护
        - 65-84：中等可维护
        - 50-64：难以维护
        - 0-49：非常难以维护
        """
        import math

        loc = len([l for l in self.lines if l.strip()])
        cc = self.calculate_cyclomatic_complexity()

        # 简化的 Halstead Volume 近似
        # 统计唯一运算符和操作数
        operators = len(re.findall(r'[+\-*/%=<>!&|^~]', self.code))
        operands = len(re.findall(r'\b\w+\b', self.code))
        volume = (operators + operands) * math.log2(max(1, operators + operands))

        # 计算 MI
        mi = 171 - 5.2 * math.log(max(1, volume)) - 0.23 * cc - 16.2 * math.log(max(1, loc))
        mi = max(0, min(100, mi * 100 / 171))

        return round(mi, 2)

    def count_lines(self) -> Dict[str, int]:
        """统计不同类型的代码行。"""
        total = len(self.lines)
        blank = 0
        comment = 0
        in_multiline_comment = False

        for line in self.lines:
            stripped = line.strip()

            # 检查多行注释
            if re.search(self.patterns['multiline_comment_start'], stripped):
                in_multiline_comment = True
            if re.search(self.patterns['multiline_comment_end'], stripped):
                in_multiline_comment = False
                comment += 1
                continue

            if in_multiline_comment:
                comment += 1
            elif not stripped:
                blank += 1
            elif re.match(self.patterns['comment'], stripped):
                comment += 1

        return {
            'total': total,
            'blank': blank,
            'comment': comment,
            'code': total - blank - comment
        }

    def find_functions(self) -> List[FunctionMetrics]:
        """查找所有函数并计算各自的度量。"""
        functions = []
        current_function = None
        function_start = 0
        brace_depth = 0

        for i, line in enumerate(self.lines):
            # 检查函数定义
            match = re.search(self.patterns['function'], line)
            if match:
                # 保存之前的函数（如有）
                if current_function:
                    func_code = '\n'.join(self.lines[function_start:i])
                    functions.append(self._create_function_metrics(
                        current_function, function_start, i - 1, func_code
                    ))

                current_function = match.group(1) or match.group(2) if match.lastindex and match.lastindex > 1 else match.group(1)
                function_start = i
                brace_depth = 0

            # 追踪 JS/TS 的大括号
            if self.language in ['javascript', 'typescript']:
                brace_depth += line.count('{') - line.count('}')

        # 别忘了最后一个函数
        if current_function:
            func_code = '\n'.join(self.lines[function_start:])
            functions.append(self._create_function_metrics(
                current_function, function_start, len(self.lines) - 1, func_code
            ))

        return functions

    def _create_function_metrics(self, name: str, start: int, end: int, code: str) -> FunctionMetrics:
        """为单个函数创建度量数据。"""
        lines = end - start + 1

        # 统计参数数量（简化版）
        param_match = re.search(r'\(([^)]*)\)', code.split('\n')[0])
        param_count = 0
        if param_match and param_match.group(1).strip():
            param_count = len([p for p in param_match.group(1).split(',') if p.strip()])

        return FunctionMetrics(
            name=name,
            start_line=start + 1,
            end_line=end + 1,
            lines=lines,
            cyclomatic_complexity=self.calculate_cyclomatic_complexity(code),
            cognitive_complexity=self.calculate_cognitive_complexity(code),
            parameter_count=param_count
        )

    def analyze(self) -> FileMetrics:
        """对文件执行完整分析。"""
        line_counts = self.count_lines()
        functions = self.find_functions()

        # 统计类数量
        class_count = len(re.findall(self.patterns['class'], self.code))

        # 计算平均值
        func_lengths = [f.lines for f in functions] if functions else [0]
        avg_func_length = sum(func_lengths) / len(func_lengths)
        max_func_length = max(func_lengths)

        return FileMetrics(
            filename=self.filename,
            lines_of_code=line_counts['code'],
            blank_lines=line_counts['blank'],
            comment_lines=line_counts['comment'],
            function_count=len(functions),
            class_count=class_count,
            cyclomatic_complexity=self.calculate_cyclomatic_complexity(),
            cognitive_complexity=self.calculate_cognitive_complexity(),
            maintainability_index=self.calculate_maintainability_index(),
            avg_function_length=round(avg_func_length, 1),
            max_function_length=max_func_length,
            functions=functions
        )


def print_metrics(metrics: FileMetrics, verbose: bool = False) -> None:
    """以可读格式打印度量数据。"""
    print("=" * 60)
    print(f"代码复杂度分析：{metrics.filename}")
    print("=" * 60)

    print("\n📊 概览")
    print("-" * 40)
    print(f"  代码行数：              {metrics.lines_of_code}")
    print(f"  空行数：                {metrics.blank_lines}")
    print(f"  注释行数：              {metrics.comment_lines}")
    print(f"  函数/方法数：           {metrics.function_count}")
    print(f"  类数量：                {metrics.class_count}")

    print("\n📈 复杂度度量")
    print("-" * 40)
    print(f"  圈复杂度：              {metrics.cyclomatic_complexity}")
    print(f"  认知复杂度：            {metrics.cognitive_complexity}")
    print(f"  可维护性指数：          {metrics.maintainability_index}")

    # 解读可维护性
    mi = metrics.maintainability_index
    if mi >= 85:
        mi_label = "高度可维护 ✅"
    elif mi >= 65:
        mi_label = "中等可维护 🔶"
    elif mi >= 50:
        mi_label = "难以维护 ⚠️"
    else:
        mi_label = "非常难以维护 ❌"
    print(f"    → {mi_label}")

    print("\n📐 函数度量")
    print("-" * 40)
    print(f"  平均函数长度：          {metrics.avg_function_length} 行")
    print(f"  最大函数长度：         {metrics.max_function_length} 行")

    if verbose and metrics.functions:
        print("\n📋 函数详情")
        print("-" * 40)
        for f in sorted(metrics.functions, key=lambda x: x.cyclomatic_complexity, reverse=True):
            flag = " ⚠️" if f.cyclomatic_complexity > 10 or f.lines > 50 else ""
            print(f"  {f.name}() [第 {f.start_line}-{f.end_line} 行]{flag}")
            print(f"    - 行数: {f.lines}, CC: {f.cyclomatic_complexity}, "
                  f"认知: {f.cognitive_complexity}, 参数: {f.parameter_count}")

    print("\n" + "=" * 60)


def print_comparison(before: FileMetrics, after: FileMetrics) -> None:
    """打印两次分析的对比结果。"""
    print("=" * 70)
    print("代码复杂度对比")
    print("=" * 70)

    print(f"\n{'度量指标':<30} {'修改前':<15} {'修改后':<15} {'变化':<10}")
    print("-" * 70)

    def fmt_change(before_val, after_val, lower_is_better=True):
        diff = after_val - before_val
        if lower_is_better:
            symbol = "✅" if diff < 0 else ("⚠️" if diff > 0 else "➖")
        else:
            symbol = "✅" if diff > 0 else ("⚠️" if diff < 0 else "➖")
        return f"{diff:+.1f} {symbol}" if isinstance(diff, float) else f"{diff:+d} {symbol}"

    metrics_list = [
        ("代码行数", before.lines_of_code, after.lines_of_code, True),
        ("函数数量", before.function_count, after.function_count, False),
        ("类数量", before.class_count, after.class_count, False),
        ("圈复杂度", before.cyclomatic_complexity, after.cyclomatic_complexity, True),
        ("认知复杂度", before.cognitive_complexity, after.cognitive_complexity, True),
        ("可维护性指数", before.maintainability_index, after.maintainability_index, False),
        ("平均函数长度", before.avg_function_length, after.avg_function_length, True),
        ("最大函数长度", before.max_function_length, after.max_function_length, True),
    ]

    for name, b_val, a_val, lower_better in metrics_list:
        change = fmt_change(b_val, a_val, lower_better)
        print(f"{name:<30} {b_val:<15} {a_val:<15} {change:<10}")

    print("\n" + "=" * 70)

    # 总体评估
    print("\n🎯 评估")
    print("-" * 40)

    improvements = 0
    regressions = 0

    if after.maintainability_index > before.maintainability_index:
        print("  ✅ 可维护性提升")
        improvements += 1
    elif after.maintainability_index < before.maintainability_index:
        print("  ⚠️ 可维护性下降")
        regressions += 1

    if after.cyclomatic_complexity < before.cyclomatic_complexity:
        print("  ✅ 复杂度降低")
        improvements += 1
    elif after.cyclomatic_complexity > before.cyclomatic_complexity:
        print("  ⚠️ 复杂度增加")
        regressions += 1

    if after.avg_function_length < before.avg_function_length:
        print("  ✅ 平均函数长度减小")
        improvements += 1
    elif after.avg_function_length > before.avg_function_length:
        print("  ⚠️ 平均函数长度增加")
        regressions += 1

    print(f"\n  总结：{improvements} 项改善，{regressions} 项退化")
    print("=" * 70)


def analyze_directory(directory: str, verbose: bool = False) -> None:
    """分析目录中所有支持的文件。"""
    supported_extensions = ['.py', '.js', '.jsx', '.ts', '.tsx']
    files = []

    for root, _, filenames in os.walk(directory):
        for filename in filenames:
            if any(filename.endswith(ext) for ext in supported_extensions):
                files.append(os.path.join(root, filename))

    if not files:
        print(f"在 {directory} 中未找到支持的文件")
        return

    print(f"正在分析 {directory} 中的 {len(files)} 个文件...\n")

    total_loc = 0
    total_cc = 0
    total_functions = 0
    all_metrics = []

    for filepath in sorted(files):
        try:
            analyzer = ComplexityAnalyzer(filepath)
            metrics = analyzer.analyze()
            all_metrics.append(metrics)

            total_loc += metrics.lines_of_code
            total_cc += metrics.cyclomatic_complexity
            total_functions += metrics.function_count

            if verbose:
                print_metrics(metrics, verbose=True)
            else:
                flag = " ⚠️" if metrics.maintainability_index < 65 else ""
                print(f"  {metrics.filename}: LOC={metrics.lines_of_code}, "
                      f"CC={metrics.cyclomatic_complexity}, MI={metrics.maintainability_index}{flag}")
        except Exception as e:
            print(f"  分析 {filepath} 时出错：{e}")

    print("\n" + "=" * 60)
    print("汇总")
    print("=" * 60)
    print(f"  分析的文件数：          {len(all_metrics)}")
    print(f"  代码总行数：           {total_loc}")
    print(f"  总复杂度：             {total_cc}")
    print(f"  函数总数：             {total_functions}")

    if all_metrics:
        avg_mi = sum(m.maintainability_index for m in all_metrics) / len(all_metrics)
        print(f"  平均可维护性：         {avg_mi:.1f}")


def main():
    parser = argparse.ArgumentParser(
        description='分析代码复杂度度量',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  %(prog)s myfile.py                    分析单个文件
  %(prog)s before.py after.py           对比两个版本
  %(prog)s --dir src/                   分析目录
  %(prog)s -v myfile.py                 详细输出，包含函数详情
        """
    )
    parser.add_argument('files', nargs='*', help='要分析的文件')
    parser.add_argument('--dir', '-d', help='要分析的目录')
    parser.add_argument('--verbose', '-v', action='store_true', help='显示详细函数度量')
    parser.add_argument('--json', '-j', action='store_true', help='输出为 JSON 格式')

    args = parser.parse_args()

    if args.dir:
        analyze_directory(args.dir, args.verbose)
    elif len(args.files) == 1:
        analyzer = ComplexityAnalyzer(args.files[0])
        metrics = analyzer.analyze()

        if args.json:
            import json
            print(json.dumps({
                'filename': metrics.filename,
                'lines_of_code': metrics.lines_of_code,
                'cyclomatic_complexity': metrics.cyclomatic_complexity,
                'cognitive_complexity': metrics.cognitive_complexity,
                'maintainability_index': metrics.maintainability_index,
                'function_count': metrics.function_count,
                'avg_function_length': metrics.avg_function_length,
            }, indent=2))
        else:
            print_metrics(metrics, args.verbose)
    elif len(args.files) == 2:
        before_analyzer = ComplexityAnalyzer(args.files[0])
        after_analyzer = ComplexityAnalyzer(args.files[1])
        before_metrics = before_analyzer.analyze()
        after_metrics = after_analyzer.analyze()
        print_comparison(before_metrics, after_metrics)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
