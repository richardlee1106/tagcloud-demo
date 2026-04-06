---
name: code-review-specialist
description: Comprehensive code review with security, performance, and quality analysis. Use when users ask to review code, analyze code quality, evaluate pull requests, or mention code review, security analysis, or performance optimization.
---

# Code Review Skill（代码审查技能）

This skill provides comprehensive code review capabilities focusing on:

1. **Security Analysis（安全分析）**
   - Authentication/authorization issues（认证/授权问题）
   - Data exposure risks（数据暴露风险）
   - Injection vulnerabilities（注入漏洞）
   - Cryptographic weaknesses（加密弱点）
   - Sensitive data logging（敏感数据日志记录）

2. **Performance Review（性能审查）**
   - Algorithm efficiency（算法效率，Big O 分析）
   - Memory optimization（内存优化）
   - Database query optimization（数据库查询优化）
   - Caching opportunities（缓存机会）
   - Concurrency issues（并发问题）

3. **Code Quality（代码质量）**
   - SOLID principles（SOLID 原则）
   - Design patterns（设计模式）
   - Naming conventions（命名约定）
   - Documentation（文档）
   - Test coverage（测试覆盖率）

4. **Maintainability（可维护性）**
   - Code readability（代码可读性）
   - Function size（函数大小，应小于 50 行）
   - Cyclomatic complexity（圈复杂度）
   - Dependency management（依赖管理）
   - Type safety（类型安全）

## Review Template（审查模板）

For each piece of code reviewed, provide:

### Summary（概要）
- Overall quality assessment（整体质量评估）（1-5）
- Key findings count（主要发现数量）
- Recommended priority areas（推荐优先领域）

### Critical Issues（关键问题）（如有）
- **Issue（问题）**: Clear description（清晰描述）
- **Location（位置）**: File and line number（文件和行号）
- **Impact（影响）**: Why this matters（为何重要）
- **Severity（严重性）**: Critical/High/Medium
- **Fix（修复）**: Code example（代码示例）

### Findings by Category（按类别分类的发现）

#### Security（如有安全问题）
List security vulnerabilities with examples（列出安全漏洞并附上示例）

#### Performance（如有性能问题）
List performance problems with complexity analysis（列出性能问题并附上复杂度分析）

#### Quality（如有质量问题）
List code quality issues with refactoring suggestions（列出代码质量问题并附上重构建议）

#### Maintainability（如有可维护性问题）
List maintainability problems with improvements（列出可维护性问题并附上改进建议）

## Version History（版本历史）

- v1.0.0 (2024-12-10): Initial release with security, performance, quality, and maintainability analysis（初始版本，包含安全、性能、质量和可维护性分析）
