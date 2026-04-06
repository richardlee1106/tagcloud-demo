#!/usr/bin/env python3
"""
代码异味检测器

检测 Python、JavaScript 和 TypeScript 文件中的常见代码异味。
基于 Martin Fowler 的代码异味目录。

用法：
    python detect-smells.py <文件>
    python detect-smells.py --dir <目录>
    python detect-smells.py -v <文件>  # 详细模式，带代码片段

检测内容：
    - Long Method（长方法，>30 行）
    - Long Parameter List（长参数列表，>4 个参数）
    - Duplicate Code（重复代码，相似代码块）
    - Large Class（大类，>300 行，>10 个方法）
    - Dead Code（死代码，未使用的变量/函数）
    - Complex Conditionals（复杂条件，深嵌套、长链）
    - Magic Numbers/Strings（魔法数字/字符串）
    - Feature Envy（特性依恋，方法大量使用其他类的数据）
    - Comments explaining what (not why)（解释"是什么"的注释，而非"为什么"）
"""

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict


class SmellSeverity(Enum):
    """代码异味的严重性级别。"""
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"


class SmellType(Enum):
    """代码异味的类型。"""
    LONG_METHOD = "Long Method（长方法）"
    LONG_PARAMETER_LIST = "Long Parameter List（长参数列表）"
    DUPLICATE_CODE = "Duplicate Code（重复代码）"
    LARGE_CLASS = "Large Class（大类）"
    DEAD_CODE = "Dead Code（死代码）"
    COMPLEX_CONDITIONAL = "Complex Conditional（复杂条件）"
    MAGIC_NUMBER = "Magic Number/String（魔法数字/字符串）"
    FEATURE_ENVY = "Feature Envy（特性依恋）"
    EXCESSIVE_COMMENTS = "Excessive Comments（过度注释）"
    DEEPLY_NESTED = "Deeply Nested Code（深度嵌套代码）"
    PRIMITIVE_OBSESSION = "Primitive Obsession（原始类型痴迷）"
    DATA_CLUMPS = "Data Clumps（数据泥团）"
    SWITCH_STATEMENT = "Switch Statement（Switch 语句）"
    MESSAGE_CHAIN = "Message Chain（消息链）"


@dataclass
class CodeSmell:
    """表示检测到的代码异味。"""
    smell_type: SmellType
    severity: SmellSeverity
    location: str
    line_start: int
    line_end: int
    description: str
    suggestion: str
    code_snippet: str = ""


@dataclass
class SmellReport:
    """文件中发现的所有异味的报告。"""
    filename: str
    smells: List[CodeSmell] = field(default_factory=list)

    @property
    def critical_count(self) -> int:
        return sum(1 for s in self.smells if s.severity == SmellSeverity.CRITICAL)

    @property
    def high_count(self) -> int:
        return sum(1 for s in self.smells if s.severity == SmellSeverity.HIGH)

    @property
    def medium_count(self) -> int:
        return sum(1 for s in self.smells if s.severity == SmellSeverity.MEDIUM)

    @property
    def low_count(self) -> int:
        return sum(1 for s in self.smells if s.severity == SmellSeverity.LOW)


class SmellDetector:
    """检测源文件中的代码异味。"""

    # 阈值（可配置）
    THRESHOLDS = {
        'long_method_lines': 30,
        'very_long_method_lines': 50,
        'max_parameters': 4,
        'large_class_lines': 300,
        'large_class_methods': 10,
        'max_nesting_depth': 4,
        'long_chain_length': 3,
        'duplicate_min_lines': 5,
    }

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.filename = os.path.basename(filepath)
        self.language = self._detect_language()

        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            self.code = f.read()
        self.lines = self.code.split('\n')
        self.smells: List[CodeSmell] = []

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

    def detect_all(self) -> SmellReport:
        """运行所有异味检测器。"""
        self._detect_long_methods()
        self._detect_long_parameter_lists()
        self._detect_large_class()
        self._detect_complex_conditionals()
        self._detect_magic_numbers()
        self._detect_excessive_comments()
        self._detect_deeply_nested()
        self._detect_switch_statements()
        self._detect_message_chains()
        self._detect_duplicate_code()
        self._detect_dead_code()

        return SmellReport(filename=self.filename, smells=self.smells)

    def _get_snippet(self, start: int, end: int, context: int = 2) -> str:
        """获取带上下文的代码片段。"""
        actual_start = max(0, start - context)
        actual_end = min(len(self.lines), end + context)
        snippet_lines = []
        for i in range(actual_start, actual_end):
            prefix = "→ " if start <= i < end else "  "
            snippet_lines.append(f"{i+1:4d} {prefix}{self.lines[i]}")
        return '\n'.join(snippet_lines)

    def _detect_long_methods(self) -> None:
        """检测过长的方法。"""
        if self.language == 'python':
            pattern = r'^\s*def\s+(\w+)\s*\([^)]*\):'
        else:
            pattern = r'(?:function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))'

        current_method = None
        method_start = 0
        brace_depth = 0
        indent_level = 0

        for i, line in enumerate(self.lines):
            match = re.search(pattern, line)
            if match:
                # 检查之前的方法（如有）
                if current_method:
                    method_lines = i - method_start
                    self._check_method_length(current_method, method_start, i - 1, method_lines)

                current_method = match.group(1) or (match.group(2) if match.lastindex and match.lastindex > 1 else None)
                method_start = i
                indent_level = len(line) - len(line.lstrip())

            # 通过缩进追踪 Python 函数的结束
            if self.language == 'python' and current_method:
                if line.strip() and not line.strip().startswith('#'):
                    current_indent = len(line) - len(line.lstrip())
                    if current_indent <= indent_level and i > method_start:
                        method_lines = i - method_start
                        self._check_method_length(current_method, method_start, i - 1, method_lines)
                        current_method = None

        # 检查最后一个方法
        if current_method:
            method_lines = len(self.lines) - method_start
            self._check_method_length(current_method, method_start, len(self.lines) - 1, method_lines)

    def _check_method_length(self, name: str, start: int, end: int, lines: int) -> None:
        """检查方法是否过长，如是则添加异味。"""
        if lines > self.THRESHOLDS['very_long_method_lines']:
            severity = SmellSeverity.HIGH
            desc = f"方法 '{name}' 有 {lines} 行（阈值：{self.THRESHOLDS['long_method_lines']}）"
        elif lines > self.THRESHOLDS['long_method_lines']:
            severity = SmellSeverity.MEDIUM
            desc = f"方法 '{name}' 有 {lines} 行（阈值：{self.THRESHOLDS['long_method_lines']}）"
        else:
            return

        self.smells.append(CodeSmell(
            smell_type=SmellType.LONG_METHOD,
            severity=severity,
            location=f"{self.filename}:{start+1}-{end+1}",
            line_start=start + 1,
            line_end=end + 1,
            description=desc,
            suggestion="应用提取方法，将大方法拆分为更小的函数",
            code_snippet=self._get_snippet(start, min(start + 5, end), 0)
        ))

    def _detect_long_parameter_lists(self) -> None:
        """检测参数过多的函数。"""
        if self.language == 'python':
            pattern = r'def\s+(\w+)\s*\(([^)]*)\)'
        else:
            pattern = r'(?:function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*[=:]\s*(?:async\s+)?(?:function\s*)?\(([^)]*)\))'

        for i, line in enumerate(self.lines):
            match = re.search(pattern, line)
            if match:
                # 安全提取分组
                groups = match.groups()
                func_name = groups[0] or (groups[2] if len(groups) > 2 else None)
                params_str = groups[1] if len(groups) > 1 else ""
                if not params_str and len(groups) > 3:
                    params_str = groups[3] or ""

                # 统计参数数量
                if params_str.strip():
                    params = [p.strip() for p in params_str.split(',') if p.strip()]
                    # 过滤 Python 的 'self'、'cls'
                    if self.language == 'python':
                        params = [p for p in params if p not in ('self', 'cls')]
                    param_count = len(params)

                    if param_count > self.THRESHOLDS['max_parameters']:
                        severity = SmellSeverity.HIGH if param_count > 6 else SmellSeverity.MEDIUM
                        self.smells.append(CodeSmell(
                            smell_type=SmellType.LONG_PARAMETER_LIST,
                            severity=severity,
                            location=f"{self.filename}:{i+1}",
                            line_start=i + 1,
                            line_end=i + 1,
                            description=f"函数 '{func_name}' 有 {param_count} 个参数（最多：{self.THRESHOLDS['max_parameters']}）",
                            suggestion="考虑引入参数对象或保留整个对象",
                            code_snippet=self._get_snippet(i, i + 1, 1)
                        ))

    def _detect_large_class(self) -> None:
        """检测过大的类。"""
        if self.language == 'python':
            class_pattern = r'^\s*class\s+(\w+)'
            method_pattern = r'^\s+def\s+\w+'
        else:
            class_pattern = r'class\s+(\w+)'
            method_pattern = r'(?:^\s+\w+\s*\([^)]*\)\s*\{|^\s+(?:async\s+)?\w+\s*=)'

        current_class = None
        class_start = 0
        method_count = 0
        class_indent = 0

        for i, line in enumerate(self.lines):
            class_match = re.search(class_pattern, line)
            if class_match:
                # 检查之前的类
                if current_class:
                    self._check_class_size(current_class, class_start, i - 1, method_count)

                current_class = class_match.group(1)
                class_start = i
                method_count = 0
                class_indent = len(line) - len(line.lstrip())

            # 统计当前类中的方法
            if current_class and re.search(method_pattern, line):
                method_count += 1

        # 检查最后一个类
        if current_class:
            self._check_class_size(current_class, class_start, len(self.lines) - 1, method_count)

    def _check_class_size(self, name: str, start: int, end: int, methods: int) -> None:
        """检查类是否过大。"""
        lines = end - start + 1

        issues = []
        severity = SmellSeverity.MEDIUM

        if lines > self.THRESHOLDS['large_class_lines']:
            issues.append(f"{lines} 行（最多：{self.THRESHOLDS['large_class_lines']}）")
            severity = SmellSeverity.HIGH

        if methods > self.THRESHOLDS['large_class_methods']:
            issues.append(f"{methods} 个方法（最多：{self.THRESHOLDS['large_class_methods']}）")
            if severity != SmellSeverity.HIGH:
                severity = SmellSeverity.MEDIUM

        if issues:
            self.smells.append(CodeSmell(
                smell_type=SmellType.LARGE_CLASS,
                severity=severity,
                location=f"{self.filename}:{start+1}-{end+1}",
                line_start=start + 1,
                line_end=end + 1,
                description=f"类 '{name}' 过大：{', '.join(issues)}",
                suggestion="应用提取类来分离职责",
                code_snippet=self._get_snippet(start, start + 3, 0)
            ))

    def _detect_complex_conditionals(self) -> None:
        """检测复杂的条件表达式。"""
        for i, line in enumerate(self.lines):
            # 统计行中的逻辑运算符数量
            and_or_count = len(re.findall(r'\b(and|or|&&|\|\|)\b', line))

            if and_or_count >= 3:
                self.smells.append(CodeSmell(
                    smell_type=SmellType.COMPLEX_CONDITIONAL,
                    severity=SmellSeverity.MEDIUM,
                    location=f"{self.filename}:{i+1}",
                    line_start=i + 1,
                    line_end=i + 1,
                    description=f"复杂条件，包含 {and_or_count} 个逻辑运算符",
                    suggestion="应用分解条件或合并条件表达式",
                    code_snippet=self._get_snippet(i, i + 1, 1)
                ))

    def _detect_magic_numbers(self) -> None:
        """检测魔法数字和字符串。"""
        # 跳过常见可接受的值
        acceptable = {'0', '1', '-1', '2', '100', 'true', 'false', 'null', 'None', '""', "''"}

        for i, line in enumerate(self.lines):
            # 跳过注释和导入
            stripped = line.strip()
            if stripped.startswith('#') or stripped.startswith('//') or \
               stripped.startswith('import') or stripped.startswith('from'):
                continue

            # 查找数字字面量（排除变量名中的）
            numbers = re.findall(r'(?<![a-zA-Z_])\b(\d+\.?\d*)\b(?![a-zA-Z_])', line)

            for num in numbers:
                if num not in acceptable and float(num) > 2:
                    # 检查它是否是魔法数字（在计算或比较中）
                    if re.search(rf'[<>=+\-*/]\s*{re.escape(num)}|{re.escape(num)}\s*[<>=+\-*/]', line):
                        self.smells.append(CodeSmell(
                            smell_type=SmellType.MAGIC_NUMBER,
                            severity=SmellSeverity.LOW,
                            location=f"{self.filename}:{i+1}",
                            line_start=i + 1,
                            line_end=i + 1,
                            description=f"魔法数字 '{num}' - 考虑使用命名常量",
                            suggestion="用命名常量替代魔法数字",
                            code_snippet=self._get_snippet(i, i + 1, 0)
                        ))
                        break  # 每行一个魔法数字就够了

    def _detect_excessive_comments(self) -> None:
        """检测解释"是什么"而非"为什么"的注释。"""
        what_patterns = [
            r'#\s*(set|get|return|loop|iterate|check|if|increment|decrement)',
            r'//\s*(set|get|return|loop|iterate|check|if|increment|decrement)',
        ]

        for i, line in enumerate(self.lines):
            for pattern in what_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    self.smells.append(CodeSmell(
                        smell_type=SmellType.EXCESSIVE_COMMENTS,
                        severity=SmellSeverity.LOW,
                        location=f"{self.filename}:{i+1}",
                        line_start=i + 1,
                        line_end=i + 1,
                        description="注释解释的是'是什么'而非'为什么'——考虑重命名或删除",
                        suggestion="用带有描述性名称的提取方法替代注释",
                        code_snippet=self._get_snippet(i, i + 1, 0)
                    ))
                    break

    def _detect_deeply_nested(self) -> None:
        """检测深度嵌套的代码块。"""
        max_depth = 0
        current_depth = 0
        depth_start = 0

        for i, line in enumerate(self.lines):
            if self.language == 'python':
                # 通过缩进统计
                if line.strip():
                    indent = len(line) - len(line.lstrip())
                    depth = indent // 4  # 假设 4 空格缩进
                    if depth > current_depth:
                        if depth > max_depth:
                            max_depth = depth
                            if depth >= self.THRESHOLDS['max_nesting_depth']:
                                depth_start = i
                    current_depth = depth
            else:
                # 统计大括号
                current_depth += line.count('{') - line.count('}')
                if current_depth > max_depth:
                    max_depth = current_depth
                    if current_depth >= self.THRESHOLDS['max_nesting_depth']:
                        depth_start = i

        if max_depth >= self.THRESHOLDS['max_nesting_depth']:
            self.smells.append(CodeSmell(
                smell_type=SmellType.DEEPLY_NESTED,
                severity=SmellSeverity.HIGH if max_depth > 5 else SmellSeverity.MEDIUM,
                location=f"{self.filename}:{depth_start+1}",
                line_start=depth_start + 1,
                line_end=depth_start + 1,
                description=f"代码嵌套 {max_depth} 层（最多：{self.THRESHOLDS['max_nesting_depth']}）",
                suggestion="应用用卫语句替代嵌套条件，或提取方法",
                code_snippet=self._get_snippet(depth_start, depth_start + 5, 0)
            ))

    def _detect_switch_statements(self) -> None:
        """检测可能需要多态的 switch 语句。"""
        if self.language == 'python':
            # Python 3.10+ match 语句或 if/elif 链
            pattern = r'^\s*(if|elif).*==.*:'
            consecutive_conditions = 0
            chain_start = 0

            for i, line in enumerate(self.lines):
                if re.search(pattern, line):
                    if consecutive_conditions == 0:
                        chain_start = i
                    consecutive_conditions += 1
                else:
                    if consecutive_conditions >= 4:
                        self._add_switch_smell(chain_start, i - 1, consecutive_conditions)
                    consecutive_conditions = 0
        else:
            # JavaScript/TypeScript switch
            pattern = r'\bswitch\s*\('
            for i, line in enumerate(self.lines):
                if re.search(pattern, line):
                    # 统计 case 数量
                    case_count = 0
                    for j in range(i, min(i + 50, len(self.lines))):
                        case_count += len(re.findall(r'\bcase\b', self.lines[j]))
                    if case_count >= 4:
                        self._add_switch_smell(i, i + 1, case_count)

    def _add_switch_smell(self, start: int, end: int, cases: int) -> None:
        """添加 switch 语句异味。"""
        self.smells.append(CodeSmell(
            smell_type=SmellType.SWITCH_STATEMENT,
            severity=SmellSeverity.MEDIUM,
            location=f"{self.filename}:{start+1}",
            line_start=start + 1,
            line_end=end + 1,
            description=f"Switch/case 语句有 {cases} 个分支——考虑使用多态",
            suggestion="应用用多态替代条件",
            code_snippet=self._get_snippet(start, start + 5, 0)
        ))

    def _detect_message_chains(self) -> None:
        """检测长方法链（火车残骸）。"""
        chain_pattern = r'(\w+(?:\.\w+\([^)]*\)){3,})'

        for i, line in enumerate(self.lines):
            matches = re.findall(chain_pattern, line)
            for match in matches:
                chain_length = match.count('.')
                if chain_length >= self.THRESHOLDS['long_chain_length']:
                    self.smells.append(CodeSmell(
                        smell_type=SmellType.MESSAGE_CHAIN,
                        severity=SmellSeverity.MEDIUM,
                        location=f"{self.filename}:{i+1}",
                        line_start=i + 1,
                        line_end=i + 1,
                        description=f"消息链有 {chain_length} 次调用——违反得墨忒耳定律",
                        suggestion="应用隐藏委托以减少耦合",
                        code_snippet=self._get_snippet(i, i + 1, 0)
                    ))

    def _detect_duplicate_code(self) -> None:
        """检测潜在的重复代码块（简化版）。"""
        # 创建用于比较的行哈希
        line_hashes: Dict[str, List[int]] = defaultdict(list)

        for i, line in enumerate(self.lines):
            normalized = re.sub(r'\s+', ' ', line.strip())
            if len(normalized) > 20:  # 仅统计有意义的行
                line_hashes[normalized].append(i)

        # 查找重复
        for normalized, positions in line_hashes.items():
            if len(positions) >= 3:  # 至少 3 次出现
                self.smells.append(CodeSmell(
                    smell_type=SmellType.DUPLICATE_CODE,
                    severity=SmellSeverity.MEDIUM,
                    location=f"{self.filename}:{positions[0]+1}",
                    line_start=positions[0] + 1,
                    line_end=positions[0] + 1,
                    description=f"发现潜在的重复代码 {len(positions)} 次",
                    suggestion="应用提取方法消除重复",
                    code_snippet=self._get_snippet(positions[0], positions[0] + 1, 0)
                ))

    def _detect_dead_code(self) -> None:
        """检测潜在的死代码（简化版）。"""
        # 查找常见的死代码模式
        patterns = [
            (r'^\s*#.*TODO.*delete', "TODO 待删除"),
            (r'^\s*#.*FIXME.*remove', "FIXME 待移除"),
            (r'^\s*//.*TODO.*delete', "TODO 待删除"),
            (r'^\s*//.*FIXME.*remove', "FIXME 待移除"),
            (r'^\s*if\s+False:', "'if False' 后的代码"),
            (r'^\s*if\s*\(\s*false\s*\)', "'if (false)' 后的代码"),
        ]

        for i, line in enumerate(self.lines):
            for pattern, desc in patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    self.smells.append(CodeSmell(
                        smell_type=SmellType.DEAD_CODE,
                        severity=SmellSeverity.LOW,
                        location=f"{self.filename}:{i+1}",
                        line_start=i + 1,
                        line_end=i + 1,
                        description=f"潜在死代码：{desc}",
                        suggestion="删除死代码",
                        code_snippet=self._get_snippet(i, i + 1, 0)
                    ))


def print_report(report: SmellReport, verbose: bool = False) -> None:
    """以可读格式打印异味报告。"""
    print("=" * 70)
    print(f"代码异味检测报告：{report.filename}")
    print("=" * 70)

    print(f"\n📊 汇总")
    print("-" * 40)
    print(f"  发现异味总数：         {len(report.smells)}")
    print(f"  Critical（严重）：               {report.critical_count}")
    print(f"  High（高）：                   {report.high_count}")
    print(f"  Medium（中）：                 {report.medium_count}")
    print(f"  Low（低）：                    {report.low_count}")

    if not report.smells:
        print("\n✅ 未检测到代码异味！")
        print("=" * 70)
        return

    # 按类型分组
    by_type: Dict[SmellType, List[CodeSmell]] = defaultdict(list)
    for smell in report.smells:
        by_type[smell.smell_type].append(smell)

    print(f"\n📋 按类型分类的发现")
    print("-" * 40)

    for smell_type, smells in sorted(by_type.items(), key=lambda x: -len(x[1])):
        print(f"\n### {smell_type.value}（发现 {len(smells)} 个）")

        for smell in sorted(smells, key=lambda x: x.severity.value):
            severity_icon = {
                SmellSeverity.CRITICAL: "🔴",
                SmellSeverity.HIGH: "🟠",
                SmellSeverity.MEDIUM: "🟡",
                SmellSeverity.LOW: "🟢",
            }[smell.severity]

            print(f"\n  {severity_icon} [{smell.severity.value}] {smell.location}")
            print(f"     {smell.description}")
            print(f"     💡 {smell.suggestion}")

            if verbose and smell.code_snippet:
                print(f"\n     代码：")
                for snippet_line in smell.code_snippet.split('\n'):
                    print(f"       {snippet_line}")

    print("\n" + "=" * 70)
    print("💡 建议的行动")
    print("-" * 40)

    if report.critical_count > 0:
        print("  1. 立即处理 CRITICAL（严重）问题")
    if report.high_count > 0:
        print("  2. 计划在本 sprint 中修复 HIGH（高）严重性问题")
    if report.medium_count > 0:
        print("  3. 安排 MEDIUM（中）问题到近期工作中")
    if report.low_count > 0:
        print("  4. 顺便修复 LOW（低）问题")

    print("\n" + "=" * 70)


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

    print(f"正在扫描 {directory} 中的 {len(files)} 个文件...\n")

    total_smells = 0
    total_critical = 0
    total_high = 0
    files_with_smells = 0

    for filepath in sorted(files):
        try:
            detector = SmellDetector(filepath)
            report = detector.detect_all()

            if report.smells:
                files_with_smells += 1
                total_smells += len(report.smells)
                total_critical += report.critical_count
                total_high += report.high_count

                flag = " 🔴" if report.critical_count else (" 🟠" if report.high_count else " 🟡")
                print(f"  {report.filename}: {len(report.smells)} 个异味{flag}")

                if verbose:
                    for smell in report.smells:
                        print(f"    - [{smell.severity.value}] {smell.smell_type.value}: 第 {smell.line_start} 行")
            else:
                print(f"  {report.filename}: ✅ 无异味")

        except Exception as e:
            print(f"  分析 {filepath} 时出错：{e}")

    print("\n" + "=" * 60)
    print("汇总")
    print("=" * 60)
    print(f"  分析的文件数：          {len(files)}")
    print(f"  有异味的文件数：       {files_with_smells}")
    print(f"  发现异味总数：         {total_smells}")
    print(f"  严重问题：             {total_critical}")
    print(f"  高严重性问题：          {total_high}")


def main():
    parser = argparse.ArgumentParser(
        description='检测源文件中的代码异味',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  %(prog)s myfile.py                    分析单个文件
  %(prog)s --dir src/                   分析目录
  %(prog)s -v myfile.py                 详细输出，带代码片段
        """
    )
    parser.add_argument('file', nargs='?', help='要分析的文件')
    parser.add_argument('--dir', '-d', help='要分析的目录')
    parser.add_argument('--verbose', '-v', action='store_true', help='显示代码片段')
    parser.add_argument('--json', '-j', action='store_true', help='输出为 JSON 格式')

    args = parser.parse_args()

    if args.dir:
        analyze_directory(args.dir, args.verbose)
    elif args.file:
        detector = SmellDetector(args.file)
        report = detector.detect_all()

        if args.json:
            import json
            smells_data = [{
                'type': s.smell_type.value,
                'severity': s.severity.value,
                'location': s.location,
                'line_start': s.line_start,
                'line_end': s.line_end,
                'description': s.description,
                'suggestion': s.suggestion,
            } for s in report.smells]
            print(json.dumps({
                'filename': report.filename,
                'total_smells': len(report.smells),
                'critical': report.critical_count,
                'high': report.high_count,
                'medium': report.medium_count,
                'low': report.low_count,
                'smells': smells_data
            }, indent=2))
        else:
            print_report(report, args.verbose)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
