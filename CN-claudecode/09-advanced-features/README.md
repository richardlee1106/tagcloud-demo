<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../resources/logos/claude-howto-logo-dark.svg">
  <img alt="Claude How To" src="../resources/logos/claude-howto-logo.svg">
</picture>

# 高级功能

Claude Code 高级功能综合指南，包括规划模式、扩展思考、自动模式、后台任务、权限模式、打印模式（非交互式）、会话管理、交互功能、频道、语音输入、远程控制、Web 会话、桌面应用、任务列表、提示建议、Git Worktrees、沙箱、托管设置和配置。

## 目录

1. [概述](#概述)
2. [规划模式](#规划模式)
3. [扩展思考](#扩展思考)
4. [自动模式](#自动模式)
5. [后台任务](#后台任务)
6. [定时任务](#定时任务)
7. [权限模式](#权限模式)
8. [无头模式](#无头模式)
9. [会话管理](#会话管理)
10. [交互功能](#交互功能)
11. [语音输入](#语音输入)
12. [频道](#频道)
13. [Chrome 集成](#chrome-集成)
14. [远程控制](#远程控制)
15. [Web 会话](#web-会话)
16. [桌面应用](#桌面应用)
17. [任务列表](#任务列表)
18. [提示建议](#提示建议)
19. [Git Worktrees](#git-worktrees)
20. [沙箱](#沙箱)
21. [托管设置（企业版）](#托管设置-企业版)
22. [配置和设置](#配置和设置)
23. [最佳实践](#最佳实践)
24. [相关概念](#相关概念)

---

## 概述

Claude Code 的高级功能扩展了核心能力，提供了规划、推理、自动化和控制机制。这些功能支持复杂开发任务、代码审查、自动化和多会话管理的复杂工作流。

**主要高级功能包括：**

- **规划模式（Planning Mode）**：在编码前创建详细的实施计划
- **扩展思考（Extended Thinking）**：对复杂问题进行深入推理
- **自动模式（Auto Mode）**：后台安全分类器在执行前审查每个操作（研究预览版）
- **后台任务（Background Tasks）**：运行长时间操作而不阻塞对话
- **权限模式（Permission Modes）**：控制 Claude 可以执行的操作（`default`、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`）
- **打印模式（Print Mode）**：非交互式运行 Claude Code，用于自动化和 CI/CD（`claude -p`）
- **会话管理（Session Management）**：管理多个工作会话
- **交互功能（Interactive Features）**：键盘快捷键、多行输入和命令历史
- **语音输入（Voice Dictation）**：支持 20 种语言的按键说话语音输入
- **频道（Channels）**：MCP 服务器向运行中的会话推送消息（研究预览版）
- **远程控制（Remote Control）**：从 claude.ai 或 Claude 应用控制 Claude Code
- **Web 会话（Web Sessions）**：在 claude.ai/code 的浏览器中运行 Claude Code
- **桌面应用（Desktop App）**：用于可视化差异审查和多会话的独立应用
- **任务列表（Task List）**：跨上下文压缩持久化的任务跟踪
- **提示建议（Prompt Suggestions）**：基于上下文的智能命令建议
- **Git Worktrees**：用于并行工作的隔离 worktree 分支
- **沙箱（Sandboxing）**：操作系统级别的文件系统和网络隔离
- **托管设置（Managed Settings）**：通过 plist、注册表或托管文件进行企业部署
- **配置（Configuration）**：使用 JSON 配置文件自定义行为

---

## 规划模式

规划模式允许 Claude 在实施复杂任务之前进行思考，创建一个您可以审查和批准的实施计划。

### 什么是规划模式？

规划模式采用两阶段方法：

1. **规划阶段**：Claude 分析任务并创建详细的实施计划
2. **实施阶段**：获得批准后，Claude 执行计划

### 何时使用规划模式

✅ 使用规划模式的场景：

- 复杂的多文件重构
- 新功能实施
- 架构变更
- 数据库迁移
- 主要的 API 重新设计

❌ 不使用规划模式的场景：

- 简单的 Bug 修复
- 格式化变更
- 单文件编辑
- 快速查询

### 激活规划模式

**斜杠命令**：

```bash
/plan 实现用户认证系统
```

**CLI 标志**：

```bash
claude --permission-mode plan
```

**设为默认**：

```json
{
  "permissions": {
    "defaultMode": "plan"
  }
}
```

**键盘快捷键**：

- `Shift + Tab` - 切换权限模式（包括 plan）
- `Alt + M` - 切换权限模式（Windows/Linux）

### 规划模式的优势

- **结构化的实施方法**：详细的实施步骤分解
- **审查和批准**：执行前批准或调整计划
- **风险识别**：实施前识别潜在问题
- **清晰的阶段**：有组织的实施阶段和里程碑

### 示例：功能实施

```
User: /plan 添加实时通知系统

Claude: 我将创建一个实时通知系统的实施计划。

## 实施计划

### 第一阶段：基础设施设置
1. 安装 WebSocket 库（socket.io）
2. 设置 WebSocket 服务器
3. 配置连接管理

### 第二阶段：后端实施
4. 创建通知服务
5. 实施通知队列
6. 添加通知数据库模式
7. 创建 API 端点

### 第三阶段：前端集成
8. 设置 WebSocket 客户端
9. 创建通知 UI 组件
10. 实施通知状态管理
11. 添加通知权限

### 第四阶段：测试与部署
12. 编写单元测试
13. 编写集成测试
14. 更新文档
15. 部署到预发布环境

预计时间：3-4 小时
需要修改的文件：12
需要创建的新文件：8

准备好继续了吗？（是/否/修改计划）

User: 是

Claude: [按照计划开始实施]
```

### 修改计划

```
User: 修改计划 - 现在跳过队列，我们稍后添加

Claude: 更新后的计划：
[显示移除了队列的修改计划]

User: 看起来不错，继续

Claude: [实施修改后的计划]
```

### 规划模式配置

规划模式通过 CLI 标志或斜杠命令激活：

```bash
# 通过 CLI 激活计划模式
claude --permission-mode plan

# 或在 REPL 中使用 /plan 斜杠命令
/plan 实现用户认证系统
```

**规划的模型别名**：使用 `opusplan` 作为模型别名来使用 Opus 进行规划，Sonnet 执行：

```bash
claude --model opusplan "设计和实施新的 API"
```

**在外部编辑器中编辑计划**：按 `Ctrl+G` 在外部编辑器中打开当前计划进行详细修改。

---

## 扩展思考

扩展思考允许 Claude 在提供解决方案之前花更多时间对复杂问题进行推理。

### 什么是扩展思考？

扩展思考是一种深思熟虑的逐步推理过程，Claude 在此过程中：

- 分解复杂问题
- 考虑多种方案
- 评估权衡
- 推理边缘情况

### 激活扩展思考

**键盘快捷键**：

- `Option + T`（macOS）/ `Alt + T`（Windows/Linux）- 切换扩展思考

**自动激活**：

- 默认情况下为所有模型启用（Opus 4.6、Sonnet 4.6、Haiku 4.5）
- Opus 4.6：支持不同努力级别（effort levels）的自适应推理：`low`（○）、`medium`（◐）、`high`（●）、`max`（仅限 Opus 4.6）
- 其他模型：固定预算最多 31,999 个 token

**配置方法**：

- 切换：`Alt+T` / `Option+T`，或通过 `/config`
- 查看推理：`Ctrl+O`（详细模式）
- 设置努力级别：`/effort` 命令或 `--effort` 标志

**自定义预算**：

```bash
export MAX_THINKING_TOKENS=1024
```

**努力级别**（仅限 Opus 4.6）：

```bash
export CLAUDE_CODE_EFFORT_LEVEL=high   # low (○), medium (◐), high (●), 或 max（仅限 Opus 4.6）
```

**CLI 标志**：

```bash
claude --effort high "复杂的架构审查"
```

**斜杠命令**：

```
/effort high
```

> **注意**：提示中的关键词 "ultrathink" 激活深度推理模式。`low`、`medium`、`high` 和 `max`（仅限 Opus 4.6）努力级别控制 Claude 执行多少推理。

### 扩展思考的优势

- **深入推理**：在复杂问题上花更多时间思考
- **更好的架构决策**：通过综合评估做出明智选择
- **考虑边缘情况**：思考潜在问题和场景
- **彻底分析**：复杂问题解决的结构化方法

### 示例：架构决策

```
User: /think 我们应该为电子商务平台使用微服务还是单体架构？

Claude: 让我仔细思考这个架构决策...

<extended_thinking>
## 上下文分析
- 团队规模：5 名开发人员
- 预期流量：最初每天 10,000 名用户
- 需要扩展到 100,000+ 用户
- DevOps 资源有限
- 6 个月到 MVP 的时间线

## 方案 1：微服务
优势：
+ 独立扩展
+ 技术灵活性
+ 团队独立性
+ 故障隔离

劣势：
- 运维复杂性
- 网络开销
- 需要分布式追踪
- 需要 DevOps 专业知识
- 初始开发较慢

## 方案 2：单体
优势：
+ 部署更简单
+ 初始开发更快
+ 调试更容易
+ 运维开销更低
+ 单一代码库

劣势：
- 后期扩展挑战
- 全有或全无的部署
- 技术锁定
- 潜在的紧耦合

## 决策因素
1. 团队规模（5 人）→ 支持单体
2. DevOps 资源（有限）→ 支持单体
3. 时间线（6 个月）→ 支持单体
4. 未来扩展（100,000 用户）→ 单体 + 缓存可实现
5. 复杂度预算 → 有限

## 建议
从**模块化单体**开始：
- 单一部署单元
- 清晰的模块边界
- 模块间干净接口
- 为将来提取微服务做准备

这为您提供：
✓ 快速初始开发
✓ 低运维复杂性
✓ 以后提取服务的选项
✓ 清晰的架构

迁移路径：当您达到 50,000+ 用户或特定模块需要独立扩展时，将这些模块提取为微服务。
</extended_thinking>

**建议**：实施具有清晰模块边界的模块化单体。

这种方法平衡了您当前的约束（团队规模、时间线、DevOps 资源）与未来的可扩展性需求。当有明确的业务需求时，您可以将特定模块迁移到微服务。
```

### 扩展思考配置

扩展思考通过环境变量、键盘快捷键和 CLI 标志进行控制：

```bash
# 设置思考 token 预算
export MAX_THINKING_TOKENS=16000

# 设置努力级别（仅限 Opus 4.6）：low (○), medium (◐), high (●), 或 max（仅限 Opus 4.6）
export CLAUDE_CODE_EFFORT_LEVEL=high
```

在会话中切换使用 `Alt+T` / `Option+T`，用 `/effort` 设置努力级别，或通过 `/config` 配置。

---

## 自动模式

自动模式（Auto Mode）是一种研究预览版的权限模式（2026 年 3 月），使用后台安全分类器在执行前审查每个操作。它允许 Claude 自主工作，同时阻止危险操作。

### 要求

- **计划**：团队计划（企业版和 API 正在推出）
- **模型**：Claude Sonnet 4.6 或 Opus 4.6
- **分类器**：在 Claude Sonnet 4.6 上运行（增加额外 token 成本）

### 启用自动模式

```bash
# 使用 CLI 标志解锁自动模式
claude --enable-auto-mode

# 然后在 REPL 中用 Shift+Tab 切换到该模式
```

或将其设为默认权限模式：

```bash
claude --permission-mode auto
```

通过配置设置：

```json
{
  "permissions": {
    "defaultMode": "auto"
  }
}
```

### 分类器如何工作

后台分类器使用以下决策顺序评估每个操作：

1. **允许/拒绝规则** -- 首先检查明确的权限规则
2. **只读/编辑自动批准** -- 文件读取和编辑自动通过
3. **分类器** -- 后台分类器审查操作
4. **回退** -- 连续 3 次或总共 20 次阻止后，回退到提示

### 默认阻止的操作

自动模式默认阻止以下操作：

| 被阻止的操作 | 示例 |
|----------------|---------|
| 管道到 shell 安装 | `curl \| bash` |
| 向外部发送敏感数据 | 跨网络的 API 密钥、凭据 |
| 生产部署 | 针对生产的部署命令 |
| 批量删除 | 对大目录的 `rm -rf` |
| IAM 变更 | 权限和角色修改 |
| 强制推送到 main | `git push --force origin main` |

### 默认允许的操作

| 允许的操作 | 示例 |
|----------------|---------|
| 本地文件操作 | 读取、写入、编辑项目文件 |
| 声明的依赖安装 | `npm install`、`pip install` 从清单 |
| 只读 HTTP | `curl` 用于获取文档 |
| 推送到当前分支 | `git push origin feature-branch` |

### 配置自动模式

**将默认规则打印为 JSON**：

```bash
claude auto-mode defaults
```

**为信任的基础设施配置**：通过企业部署的 `autoMode.environment` 托管设置配置。这允许管理员定义可信的 CI/CD 环境、部署目标和基础设施模式。

### 回退行为

当分类器不确定时，自动模式会回退到提示用户：

- 连续 **3 次**分类器阻止后
- 会话中总共 **20 次**分类器阻止后

这确保当分类器无法自信地批准操作时，用户始终保持控制。

### 种子化等效于自动模式的权限（无需团队计划）

如果您没有团队计划或想要一个更简单的方法（没有后台分类器），您可以在 `~/.claude/settings.json` 中种子化一组保守的安全权限规则。该脚本从只读和本地检查规则开始，然后让您在需要时选择加入编辑、测试、本地 git 写入、包安装和 GitHub 写入操作。

---

## 后台任务

后台任务允许长时间运行的操作在不影响对话的情况下执行。

### 什么是后台任务？

后台任务异步运行，而您继续工作：

- 长时间测试套件
- 构建过程
- 数据库迁移
- 部署脚本
- 分析工具

**基本用法：**

```bash
User: 在后台运行测试

Claude: 启动了任务 bg-1234

/task list           # 显示所有任务
/task status bg-1234 # 检查进度
/task show bg-1234   # 查看输出
/task cancel bg-1234 # 取消任务
```

### 启动后台任务

```
User: 在后台运行完整测试套件

Claude: 正在后台启动测试（任务 ID：bg-1234）
您可以在测试运行时继续工作。

[您可以继续对话]

User: 同时，让我们重构 auth 模块

Claude: [在测试后台运行的同时处理 auth 模块]

[稍后，当测试完成时]

Claude: 后台任务 bg-1234 完成：
✅ 245 个测试通过
❌ 3 个测试失败
查看结果：/task show bg-1234
```

### 管理后台任务

**列出活动任务**：

```
User: /task list

活动后台任务：
1. [bg-1234] 运行测试（50% 完成，剩余 2 分钟）
2. [bg-1235] 构建 Docker 镜像（25% 完成，剩余 8 分钟）
3. [bg-1236] 部署到预发布（90% 完成，剩余 30 秒）
```

**检查任务状态**：

```
User: /task status bg-1234

任务 bg-1234：运行测试
状态：进行中
进度：120/245 个测试（49%）
开始时间：2025-11-08 10:30:15
预计完成：2025-11-08 10:34:22
```

**查看任务输出**：

```
User: /task show bg-1234

[显示测试运行的实时输出]
```

**取消任务**：

```
User: /task cancel bg-1234

已取消后台任务 bg-1234
```

### 示例：并行开发

```
User: 在后台运行构建

Claude: 正在启动构建...（任务 ID：bg-5001）

User: 同时在后台运行 linter

Claude: 正在启动 linter...（任务 ID：bg-5002）

User: 在这些运行时，让我们实现新的 API 端点

Claude: [在构建和 linter 运行的同时实现 API 端点]

[10 分钟后]

Claude: 构建成功完成（bg-5001）
Linter 发现 12 个问题（bg-5002）

User: 给我看看 linter 问题

Claude: [显示 bg-5002 的 linter 输出]
```

### 配置

```json
{
  "backgroundTasks": {
    "enabled": true,
    "maxConcurrentTasks": 5,
    "notifyOnCompletion": true,
    "autoCleanup": true,
    "logOutput": true
  }
}
```

---

## 定时任务

定时任务让您按重复计划或作为一次性提醒自动运行提示。任务是会话范围的——它们在 Claude Code 处于活动状态时运行，并在会话结束时清除。自 v2.1.72+ 起可用。

### /loop 命令

```bash
# 显式间隔
/loop 5m 检查部署是否完成

# 自然语言
/loop 每 30 分钟检查一次构建状态
```

也支持标准 5 字段 cron 表达式以进行精确调度。

### 一次性提醒

设置在特定时间触发一次的提醒：

```
下午 3 点提醒我推送发布分支
45 分钟后运行集成测试
```

### 管理定时任务

| 工具 | 描述 |
|------|-------------|
| `CronCreate` | 创建新的定时任务 |
| `CronList` | 列出所有活动的定时任务 |
| `CronDelete` | 删除定时任务 |

**限制和行为**：

- 每个会话最多 **50 个**定时任务
- 会话范围——会话结束时清除
- 重复任务在 **3 天**后自动过期
- 任务仅在 Claude Code 运行时触发——不会为错过的触发补发

### 行为细节

| 方面 | 细节 |
|--------|--------|
| **重复抖动** | 间隔最多 10%（最多 15 分钟）|
| **单次触发抖动** | 在 :00/:30 边界最多 90 秒 |
| **错过的触发** | 不补发——如果 Claude Code 未运行则跳过 |
| **持久性** | 不会在重启后持久化 |

### 云定时任务

使用 `/schedule` 创建在 Anthropic 基础设施上运行的云定时任务：

```
/schedule 每天上午 9 点运行测试套件并报告失败
```

云定时任务跨重启持久化，不需要 Claude Code 在本地运行。

### 禁用定时任务

```bash
export CLAUDE_CODE_DISABLE_CRON=1
```

### 示例：监控部署

```
/loop 5m 检查预发布环境的部署状态。
        如果部署成功，通知我并停止循环。
        如果失败，显示错误日志。
```

> **提示**：定时任务是会话范围的。对于在重启后仍能存活的持久化自动化，请使用 CI/CD 流水线、GitHub Actions 或桌面应用定时任务。

---

## 权限模式

权限模式控制 Claude 可以执行哪些操作而无需明确批准。

### 可用的权限模式

| 模式 | 行为 |
|---|---|
| `default` | 仅读取文件；其他所有操作都提示 |
| `acceptEdits` | 读取和编辑文件；命令提示 |
| `plan` | 仅读取文件（研究模式，无编辑）|
| `auto` | 所有操作，但有后台安全分类器检查（研究预览版）|
| `bypassPermissions` | 所有操作，无权限检查（危险）|
| `dontAsk` | 仅预先批准的工具执行；其他都拒绝 |

在 CLI 中用 `Shift+Tab` 循环切换模式。使用 `--permission-mode` 标志或 `permissions.defaultMode` 设置默认值。

### 激活方法

**键盘快捷键**：

```bash
Shift + Tab  # 循环切换所有 6 种模式
```

**斜杠命令**：

```bash
/plan                  # 进入计划模式
```

**CLI 标志**：

```bash
claude --permission-mode plan
claude --permission-mode auto
```

**设置**：

```json
{
  "permissions": {
    "defaultMode": "auto"
  }
}
```

### 权限模式示例

#### 默认模式

Claude 在重要操作前请求确认：

```
User: 修复 auth.ts 中的 bug

Claude: 我需要修改 src/auth.ts 来修复这个 bug。
此变更将更新密码验证逻辑。

批准此变更？（是/否/显示）
```

#### 计划模式

在执行前审查实施计划：

```
User: /plan 实现用户认证系统

Claude: 我将创建一个认证系统的实施计划。

## 实施计划
[带有阶段和步骤的详细计划]

准备好继续了吗？（是/否/修改）
```

#### 接受编辑模式

自动接受文件修改：

```
User: acceptEdits
User: 修复 auth.ts 中的 bug

Claude: [在未询问的情况下进行更改]
```

### 使用场景

**代码审查**：

```
User: claude --permission-mode plan
User: 审查此 PR 并提出改进建议

Claude: [读取代码，提供反馈，但不能修改]
```

**结对编程**：

```
User: claude --permission-mode default
User: 让我们一起实现这个功能

Claude: [在每个更改前请求批准]
```

**自动化任务**：

```
User: claude --permission-mode acceptEdits
User: 修复代码库中的所有 lint 问题

Claude: [自动接受文件编辑而不询问]
```

---

## 无头模式

打印模式（`claude -p`）允许 Claude Code 无需交互输入即可运行，非常适合自动化和 CI/CD。这是非交互模式，取代了旧的 `--headless` 标志。

### 什么是打印模式？

打印模式支持：

- 自动化脚本执行
- CI/CD 集成
- 批处理
- 定时任务

### 在打印模式下运行（非交互式）

```bash
# 运行特定任务
claude -p "运行所有测试"

# 处理管道输入
cat error.log | claude -p "分析这些错误"

# CI/CD 集成（GitHub Actions）
- name: AI Code Review
  run: claude -p "审查 PR"
```

### 其他打印模式用法示例

```bash
# 运行特定任务并捕获输出
claude -p "运行所有测试并生成覆盖率报告"

# 使用结构化输出
claude -p --output-format json "分析代码质量"

# 使用 stdin 输入
echo "分析代码质量" | claude -p "explain this"
```

### 示例：CI/CD 集成

**GitHub Actions**：

```yaml
# .github/workflows/code-review.yml
name: AI Code Review

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code

      - name: Run Claude Code Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p --output-format json \
            --max-turns 3 \
            "审查此 PR：
            - 代码质量问题
            - 安全漏洞
            - 性能问题
            - 测试覆盖率
            将结果输出为 JSON" > review.json

      - name: Post Review Comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const review = JSON.parse(fs.readFileSync('review.json', 'utf8'));
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: JSON.stringify(review, null, 2)
            });
```

### 打印模式配置

打印模式（`claude -p`）支持多个自动化标志：

```bash
# 限制自主 turn 数
claude -p --max-turns 5 "重构此模块"

# 结构化 JSON 输出
claude -p --output-format json "分析此代码库"

# 使用 Schema 验证
claude -p --json-schema '{"type":"object","properties":{"issues":{"type":"array"}}}' \
  "查找此代码中的 bug"

# 禁用会话持久化
claude -p --no-session-persistence "一次性分析"
```

---

## 会话管理

有效管理多个 Claude Code 会话。

### 会话管理命令

| 命令 | 描述 |
|--------|-------------|
| `/resume` | 按 ID 或名称恢复对话 |
| `/rename` | 重命名当前会话 |
| `/fork` | 将当前会话分叉到新分支 |
| `claude -c` | 继续最近的对话 |
| `claude -r "session"` | 按名称或 ID 恢复会话 |

### 恢复会话

**继续最近的对话**：

```bash
claude -c
```

**恢复命名会话**：

```bash
claude -r "auth-refactor" "完成这个 PR"
```

**重命名当前会话**（在 REPL 内）：

```
/rename auth-refactor
```

### 分叉会话

分叉会话以尝试替代方案而不丢失原始会话：

```
/fork
```

或从 CLI：

```bash
claude --resume auth-refactor --fork-session "尝试 OAuth"
```

### 会话持久化

会话自动保存，可以恢复：

```bash
# 继续最近的对话
claude -c

# 按名称或 ID 恢复特定会话
claude -r "auth-refactor"

# 恢复并分叉以进行实验
claude --resume auth-refactor --fork-session "替代方案"
```

---

## 交互功能

### 键盘快捷键

Claude Code 支持键盘快捷键以提高效率。以下是来自官方文档的完整参考：

| 快捷键 | 描述 |
|----------|-------------|
| `Ctrl+C` | 取消当前输入/生成 |
| `Ctrl+D` | 退出 Claude Code |
| `Ctrl+G` | 在外部编辑器中编辑计划 |
| `Ctrl+L` | 清除终端屏幕 |
| `Ctrl+O` | 切换详细输出（查看推理）|
| `Ctrl+R` | 反向搜索历史 |
| `Ctrl+T` | 切换任务列表视图 |
| `Ctrl+B` | 后台运行任务 |
| `Esc+Esc` | 回溯代码/对话 |
| `Shift+Tab` / `Alt+M` | 切换权限模式 |
| `Option+P` / `Alt+P` | 切换模型 |
| `Option+T` / `Alt+T` | 切换扩展思考 |

**行编辑（标准 readline 快捷键）：**

| 快捷键 | 操作 |
|----------|--------|
| `Ctrl + A` | 移动到行首 |
| `Ctrl + E` | 移动到行尾 |
| `Ctrl + K` | 剪切到行尾 |
| `Ctrl + U` | 剪切到行首 |
| `Ctrl + W` | 向后删除单词 |
| `Ctrl + Y` | 粘贴（yank）|
| `Tab` | 自动补全 |
| `↑ / ↓` | 命令历史 |

### 自定义键绑定

通过运行 `/keybindings` 创建自定义键盘快捷键，它会打开 `~/.claude/keybindings.json` 进行编辑（v2.1.18+）。

### Tab 补全

Claude Code 提供智能 Tab 补全：

```
User: /rew<TAB>
→ /rewind

User: /plu<TAB>
→ /plugin

User: /plugin <TAB>
→ /plugin install
→ /plugin enable
→ /plugin disable
```

### 命令历史

访问以前的命令：

```
User: <↑>  # 上一条命令
User: <↓>  # 下一条命令
User: Ctrl+R  # 搜索历史

(reverse-i-search)`test': run all tests
```

### 多行输入

对于复杂查询，使用多行模式：

```bash
User: \
> 长的复杂提示
> 跨越多行
> \end
```

### Vim 模式

启用 Vi/Vim 键绑定进行文本编辑：

**激活**：

- 使用 `/vim` 命令或 `/config` 启用
- 使用 `Esc` 切换到 NORMAL，`i/a/o` 切换到 INSERT

### Bash 模式

使用 `!` 前缀直接执行 shell 命令：

```bash
! npm test
! git status
! cat src/index.js
```

---

## 语音输入

语音输入为 Claude Code 提供按键说话语音输入，允许您说出提示而不是输入。

### 激活语音输入

```
/voice
```

### 功能

| 功能 | 描述 |
|---------|-------------|
| **按键说话** | 按住一个键录音，松开发送 |
| **20 种语言** | 支持 20 种语言的语音转文字 |
| **自定义键绑定** | 通过 `/keybindings` 配置按键说话键 |
| **账户要求** | 需要 Claude.ai 账户进行 STT 处理 |

---

## 频道

频道（研究预览版）允许 MCP 服务器向运行中的 Claude Code 会话推送消息，实现与外部服务的实时集成。

### 订阅频道

```bash
# 启动时订阅频道插件
claude --channels discord,telegram
```

### 支持的集成

| 集成 | 描述 |
|-------------|-------------|
| **Discord** | 在会话中接收和回复 Discord 消息 |
| **Telegram** | 在会话中接收和回复 Telegram 消息 |

---

## Chrome 集成

Chrome 集成将 Claude Code 连接到 Chrome 或 Microsoft Edge 浏览器，用于实时 Web 自动化和调试。这是自 v2.0.73+ 起提供的测试版功能。

### 启用 Chrome 集成

**启动时**：

```bash
claude --chrome      # 启用 Chrome 连接
claude --no-chrome   # 禁用 Chrome 连接
```

**在会话中**：

```
/chrome
```

### 功能

| 功能 | 描述 |
|------------|-------------|
| **实时调试** | 实时读取控制台日志、检查 DOM 元素、调试 JavaScript |
| **设计验证** | 将渲染页面与设计模型进行比较 |
| **表单验证** | 测试表单提交、输入验证和错误处理 |
| ** Web 应用测试** | 与已认证应用交互（Gmail、Google Docs、Notion 等）|
| **数据提取** | 从网页抓取和处理内容 |
| **会话录制** | 将浏览器交互录制为 GIF 文件 |

---

## 远程控制

远程控制让您从手机、平板电脑或任何浏览器继续本地运行的 Claude Code 会话。您的本地会话继续在您的机器上运行——没有任何东西移到云端。在 Pro、Max、Team 和 Enterprise 计划上可用（v2.1.51+）。

### 开始远程控制

**从 CLI**：

```bash
# 使用默认会话名称启动
claude remote-control

# 使用自定义名称启动
claude remote-control --name "Auth Refactor"
```

**从会话内**：

```
/remote-control
/remote-control "Auth Refactor"
```

### 安全性

- **不打开入站端口**
- **仅出站 HTTPS**，通过 TLS 加密
- **范围限定的凭据** — 多个短期、窄范围的令牌
- **会话隔离** — 每个远程会话都是独立的

---

## Web 会话

Web 会话允许您直接在浏览器的 claude.ai/code 中运行 Claude Code，或从 CLI 创建 Web 会话。

### 创建 Web 会话

```bash
# 从 CLI 创建新的 Web 会话
claude --remote "实现新的 API 端点"
```

### 在本地恢复 Web 会话

如果您在 Web 上启动了会话并想继续在本地：

```bash
# 在本地终端恢复 Web 会话
claude --teleport
```

或在交互式 REPL 中：

```
/teleport
```

---

## 桌面应用

Claude Code 桌面应用提供了一个独立应用，具有可视化差异审查、并行会话和集成的连接器。在 macOS 和 Windows 上可用。

### 安装

从 claude.ai 下载适合您平台的版本：

- **macOS**：通用版本（Apple Silicon 和 Intel）
- **Windows**：x64 和 ARM64 安装程序

### 核心功能

| 功能 | 描述 |
|---------|-------------|
| **差异视图** | 逐文件的可视化审查，带内联评论；Claude 阅读评论并修订 |
| **应用预览** | 自动启动开发服务器，带嵌入式浏览器用于实时验证 |
| **PR 监控** | GitHub CLI 集成，自动修复 CI 失败和自动合并检查通过时 |
| **并行会话** | 侧边栏中的多个会话，带自动 Git worktree 隔离 |
| **定时任务** | 循环任务（每小时、每天、工作日、每周），在应用打开时运行 |
| **丰富渲染** | 带语法高亮的代码、markdown 和图表渲染 |

### 连接器

连接外部服务以获得更丰富的上下文：

| 连接器 | 功能 |
|-----------|------------|
| **GitHub** | PR 监控、问题跟踪、代码审查 |
| **Slack** | 通知、频道上下文 |
| **Linear** | 问题跟踪、Sprint 管理 |
| **Notion** | 文档、知识库访问 |
| **Asana** | 任务管理、项目跟踪 |
| **Calendar** | 日程感知、会议上下文 |

### 桌面中的权限模式

桌面应用支持与 CLI 相同的 4 种权限模式：

| 模式 | 行为 |
|------|-------------|
| **询问权限**（默认）| 审查和批准每个编辑和命令 |
| **自动接受编辑** | 文件编辑自动批准；命令需要手动批准 |
| **计划模式** | 在进行任何更改前审查方法 |
| **绕过权限** | 自动执行（仅沙箱、管理员控制）|

---

## 任务列表

任务列表功能提供持久化的任务跟踪，跨上下文压缩（当对话历史被修剪以适应上下文窗口时）保持不变。

### 切换任务列表

在会话期间按 `Ctrl+T` 切换任务列表视图的打开或关闭。

### 持久化任务

任务跨上下文压缩持久化，确保复杂的多步骤实施在对话上下文被修剪时不会丢失。

### 命名任务目录

使用 `CLAUDE_CODE_TASK_LIST_ID` 环境变量创建跨会话共享的命名任务目录：

```bash
export CLAUDE_CODE_TASK_LIST_ID=my-project-sprint-3
```

这允许多个会话共享相同的任务列表，对团队工作流或多会话项目很有用。

---

## 提示建议

提示建议根据您的 git 历史和当前对话上下文显示灰色示例命令。

### 工作原理

- 建议显示在输入提示下方作为灰色文本
- 按 `Tab` 接受建议
- 按 `Enter` 接受并立即提交
- 建议是上下文感知的，来源于 git 历史和对话状态

### 禁用提示建议

```bash
export CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false
```

---

## Git Worktrees

Git Worktrees 允许您在隔离的 worktree 中启动 Claude Code，实现不同分支上的并行工作，而无需 stash 或切换。

### 在 Worktree 中启动

```bash
# 在隔离的 worktree 中启动 Claude Code
claude --worktree
# 或
claude -w
```

### Worktree 位置

Worktree 创建在：

```
<repo>/.claude/worktrees/<name>
```

### 使用场景

- 在保持 main 分支不受影响的同时处理功能分支
- 在不影响工作目录的情况下隔离运行测试
- 在可丢弃的环境中尝试实验性更改
- 在 monorepo 中稀疏检出特定包以加快启动

---

## 沙箱

沙箱为 Claude Code 执行的 Bash 命令提供操作系统级别的文件系统和网络隔离。这是对权限规则的补充，并提供额外的安全层。

### 启用沙箱

**斜杠命令**：

```
/sandbox
```

**CLI 标志**：

```bash
claude --sandbox       # 启用沙箱
claude --no-sandbox    # 禁用沙箱
```

### 配置设置

| 设置 | 描述 |
|---------|-------------|
| `sandbox.enabled` | 启用或禁用沙箱 |
| `sandbox.failIfUnavailable` | 无法激活沙箱时失败 |
| `sandbox.filesystem.allowWrite` | 允许写入访问的路径 |
| `sandbox.filesystem.allowRead` | 允许读取访问的路径 |
| `sandbox.filesystem.denyRead` | 拒绝读取访问的路径 |
| `sandbox.enableWeakerNetworkIsolation` | 在 macOS 上启用较弱网络隔离 |

### 工作原理

- Bash 命令在具有受限文件系统访问的沙箱环境中运行
- 网络访问可以隔离以防止意外的外部连接
- 与权限规则一起用于纵深防御
- 在 macOS 上，使用 `sandbox.enableWeakerNetworkIsolation` 进行网络限制

### 使用场景

- 安全运行不受信任或生成的代码
- 防止意外修改项目外部的文件
- 在自动化任务期间限制网络访问

---

## 托管设置（企业版）

托管设置使企业管理员能够使用平台本机管理工具跨组织部署 Claude Code 配置。

### 部署方法

| 平台 | 方法 | 自 |
|----------|--------|---------|
| macOS | 托管 plist 文件（MDM）| v2.1.51+ |
| Windows | Windows 注册表 | v2.1.51+ |
| 跨平台 | 托管配置文件 | v2.1.51+ |
| 跨平台 | 托管 drop-in（`managed-settings.d/` 目录）| v2.1.83+ |

### 托管 Drop-in

自 v2.1.83 起，管理员可以将多个托管设置文件部署到 `managed-settings.d/` 目录。文件按字母顺序合并，允许跨团队的模块化配置。

### 可用的托管设置

| 设置 | 描述 |
|---------|-------------|
| `disableBypassPermissionsMode` | 阻止用户启用绕过权限 |
| `availableModels` | 限制用户可选择的模型 |
| `allowedChannelPlugins` | 控制允许哪些频道插件 |
| `autoMode.environment` | 为自动模式配置可信基础设施 |
| 自定义策略 | 组织特定的权限和工具策略 |

---

## 配置和设置

### 配置文件位置

1. **全局配置**：`~/.claude/config.json`
2. **项目配置**：`./.claude/config.json`
3. **用户配置**：`~/.config/claude-code/settings.json`

### 完整配置示例

**核心高级功能配置：**

```json
{
  "permissions": {
    "mode": "default"
  },
  "hooks": {
    "PreToolUse:Edit": "eslint --fix ${file_path}",
    "PostToolUse:Write": "~/.claude/hooks/security-scan.sh"
  },
  "mcp": {
    "enabled": true,
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"]
      }
    }
  }
}
```

### 环境变量

用环境变量覆盖配置：

```bash
# 模型选择
export ANTHROPIC_MODEL=claude-opus-4-6
export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-6
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5

# API 配置
export ANTHROPIC_API_KEY=sk-ant-...

# 思考配置
export MAX_THINKING_TOKENS=16000
export CLAUDE_CODE_EFFORT_LEVEL=high

# 功能开关
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=true
export CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=true
export CLAUDE_CODE_DISABLE_CRON=1
export CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=true
export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=true
export CLAUDE_CODE_DISABLE_1M_CONTEXT=true
export CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK=true
export CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false
export CLAUDE_CODE_ENABLE_TASKS=true
export CLAUDE_CODE_SIMPLE=true              # 由 --bare 标志设置

# MCP 配置
export MAX_MCP_OUTPUT_TOKENS=50000
export ENABLE_TOOL_SEARCH=true

# 任务管理
export CLAUDE_CODE_TASK_LIST_ID=my-project-tasks

# 代理团队（实验性）
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true

# 子代理和插件配置
export CLAUDE_CODE_SUBAGENT_MODEL=sonnet
export CLAUDE_CODE_PLUGIN_SEED_DIR=./my-plugins
export CLAUDE_CODE_NEW_INIT=true

# 子进程和流式传输
export CLAUDE_CODE_SUBPROCESS_ENV_SCRUB="SECRET_KEY,DB_PASSWORD"
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80
export CLAUDE_STREAM_IDLE_TIMEOUT_MS=30000
export ANTHROPIC_CUSTOM_MODEL_OPTION=my-custom-model
export SLASH_COMMAND_TOOL_CHAR_BUDGET=50000
```

### 配置管理命令

```
User: /config
[打开交互式配置菜单]
```

`/config` 命令提供一个交互式菜单来切换设置。

---

## 最佳实践

### 规划模式

- ✅ 用于复杂的多步骤任务
- ✅ 批准前仔细审查计划
- ✅ 需要时修改计划
- ❌ 不用于简单任务

### 扩展思考

- ✅ 用于架构决策
- ✅ 用于复杂问题解决
- ✅ 审查思考过程
- ❌ 不用于简单查询

### 后台任务

- ✅ 用于长时间运行的操作
- ✅ 监控任务进度
- ✅ 优雅处理任务失败
- ❌ 不要启动太多并发任务

### 权限

- ✅ 使用 `plan` 进行代码审查（只读）
- ✅ 使用 `default` 进行交互式开发
- ✅ 使用 `acceptEdits` 进行自动化工作流
- ✅ 使用 `auto` 进行带安全护栏的自主工作
- ❌ 除非绝对必要，否则不要使用 `bypassPermissions`

### 会话

- ✅ 为不同任务使用单独的会话
- ✅ 保存重要的会话状态
- ✅ 清理旧会话
- ❌ 不要在单个会话中混合不相关的工作

---

## 其他资源

有关 Claude Code 和相关功能的更多信息：

- [官方交互模式文档](https://code.claude.com/docs/en/interactive-mode)
- [官方无头模式文档](https://code.claude.com/docs/en/headless)
- [CLI 参考](https://code.claude.com/docs/en/cli-reference)
- [检查点指南](../08-checkpoints/) - 会话管理和回溯
- [斜杠命令](../01-slash-commands/) - 命令参考
- [内存指南](../02-memory/) - 持久化上下文
- [技能指南](../03-skills/) - 自主能力
- [子代理指南](../04-subagents/) - 委托任务执行
- [MCP 指南](../05-mcp/) - 外部数据访问
- [Hooks 指南](../06-hooks/) - 事件驱动自动化
- [插件指南](../07-plugins/) - 打包扩展
- [官方定时任务文档](https://code.claude.com/docs/en/scheduled-tasks)
- [官方 Chrome 集成文档](https://code.claude.com/docs/en/chrome)
- [官方远程控制文档](https://code.claude.com/docs/en/remote-control)
- [官方键绑定文档](https://code.claude.com/docs/en/keybindings)
- [官方桌面应用文档](https://code.claude.com/docs/en/desktop)
