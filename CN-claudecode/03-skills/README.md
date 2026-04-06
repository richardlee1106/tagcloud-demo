<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../resources/logos/claude-howto-logo-dark.svg">
  <img alt="Claude How To" src="../resources/logos/claude-howto-logo.svg">
</picture>

# Agent Skills 指南

Agent Skills（智能体技能）是一种可复用的、基于文件系统的扩展能力，能够增强 Claude 的功能。它们将领域专业知识、工作流程和最佳实践打包成可发现的组件，Claude 会在相关场景下自动使用。

## 概述

**Agent Skills** 是模块化的能力，可以将通用型智能体转化为专业型助手。与提示词（会话级的一次性任务指令）不同，Skills 按需加载，无需在多个会话中重复提供相同的指导。

### 核心优势

- **专业化 Claude**：针对特定领域的任务定制能力
- **减少重复**：创建一次，自动在所有会话中复用
- **组合能力**：可将多个 Skills 组合以构建复杂工作流程
- **扩展工作流程**：跨项目和团队复用 Skills
- **保证质量**：将最佳实践直接嵌入工作流程

Skills 遵循 [Agent Skills](https://agentskills.io) 开放标准，可跨多种 AI 工具使用。Claude Code 在标准基础上扩展了额外功能，如调用控制、子智能体执行和动态上下文注入。

> **注意**：自定义斜杠命令已合并到 Skills 中。`.claude/commands/` 文件仍然有效，并支持相同的前置元数据字段。推荐在新开发中使用 Skills。当同一路径下同时存在两者时（如 `.claude/commands/review.md` 和 `.claude/skills/review/SKILL.md`），Skill 优先。

## Skills 工作原理：渐进式披露

Skills 采用**渐进式披露**架构——Claude 按需分阶段加载信息，而非预先消耗上下文。这实现了高效的上下文管理，同时保持无限的可扩展性。

### 三个加载层级

```mermaid
graph TB
    subgraph "层级 1: 元数据（始终加载）"
        A["YAML 前置元数据"]
        A1["每个 Skill 约 100 个 token"]
        A2["name + description"]
    end

    subgraph "层级 2: 指令（触发时加载）"
        B["SKILL.md 正文"]
        B1["低于 5k tokens"]
        B2["工作流程和指导"]
    end

    subgraph "层级 3+: 资源（按需加载）"
        C["打包文件"]
        C1["实际上无限"]
        C2["脚本、模板、文档"]
    end

    A --> B
    B --> C
```

| 层级 | 加载时机 | Token 消耗 | 内容 |
|-------|----------|------------|------|
| **层级 1: 元数据** | 始终（启动时） | 每个 Skill 约 100 tokens | YAML 前置元数据中的 `name` 和 `description` |
| **层级 2: 指令** | Skill 被触发时 | 低于 5k tokens | SKILL.md 正文中的指令和指导 |
| **层级 3+: 资源** | 按需 | 实际上无限 | 打包文件通过 bash 执行，内容不加载到上下文 |

这意味着你可以在不增加上下文负担的情况下安装大量 Skills——Claude 只知道每个 Skill 的存在以及何时使用它，直到实际被触发。

## Skill 加载流程

```mermaid
sequenceDiagram
    participant User
    participant Claude as Claude
    participant System as System
    participant Skill as Skill

    User->>Claude: "审查这段代码的安全性"
    Claude->>System: 检查可用 Skills（元数据）
    System-->>Claude: Skill 描述在启动时加载
    Claude->>Claude: 将请求与 Skill 描述匹配
    Claude->>Skill: bash: 读取 code-review/SKILL.md
    Skill-->>Claude: 指令加载到上下文
    Claude->>Claude: 判断：需要模板吗？
    Claude->>Skill: bash: 读取 templates/checklist.md
    Skill-->>Claude: 模板已加载
    Claude->>Claude: 执行 Skill 指令
    Claude->>User: 全面的代码审查
```

## Skill 类型和位置

| 类型 | 位置 | 作用域 | 共享 | 适用场景 |
|------|------|--------|------|----------|
| **企业级** | 托管设置 | 所有组织用户 | 是 | 组织级标准 |
| **个人级** | `~/.claude/skills/<skill-name>/SKILL.md` | 个人 | 否 | 个人工作流程 |
| **项目级** | `.claude/skills/<skill-name>/SKILL.md` | 团队 | 是（通过 git） | 团队标准 |
| **插件级** | `<plugin>/skills/<skill-name>/SKILL.md` | 启用位置 | 视情况 | 随插件打包 |

当多个层级的 Skills 名称相同时，优先级高的位置优先：**企业级 > 个人级 > 项目级**。插件 Skills 使用 `plugin-name:skill-name` 命名空间，因此不会冲突。

### 自动发现

**嵌套目录**：当你处理子目录中的文件时，Claude Code 会自动从嵌套的 `.claude/skills/` 目录中发现 Skills。例如，如果你正在编辑 `packages/frontend/` 中的文件，Claude Code 也会在 `packages/frontend/.claude/skills/` 中查找 Skills。这支持了 monorepo 架构下各包拥有自己的 Skills。

**`--add-dir` 目录**：通过 `--add-dir` 添加的目录中的 Skills 会自动加载并实时检测变化。对这些目录中 Skill 文件的任何编辑都会立即生效，无需重启 Claude Code。

**描述预算**：Skill 描述（层级 1 元数据）有上限，为上下文窗口的 **2%**（备用方案：**16,000 个字符**）。如果安装了大量 Skills，部分可能会被排除。运行 `/context` 检查是否有警告。使用 `SLASH_COMMAND_TOOL_CHAR_BUDGET` 环境变量可覆盖预算。

## 创建自定义 Skills

### 基本目录结构

```
my-skill/
├── SKILL.md           # 主指令（必需）
├── template.md        # Claude 填充的模板
├── examples/
│   └── sample.md      # 展示预期格式的示例输出
└── scripts/
    └── validate.sh    # Claude 可执行的脚本
```

### SKILL.md 格式

```yaml
---
name: your-skill-name
description: 关于此 Skill 功能和使用时机的简要描述
---

# 你的 Skill 名称

## 指令
为 Claude 提供清晰的分步指导。

## 示例
展示使用此 Skill 的具体示例。
```

### 必需字段

- **name**：仅使用小写字母、数字和连字符（最多 64 个字符）。不能包含 "anthropic" 或 "claude"。
- **description**：此 Skill 的功能**以及**使用时机（最多 1024 个字符）。这对 Claude 决定何时激活 Skill 至关重要。

### 可选前置元数据字段

```yaml
---
name: my-skill
description: 此 Skill 的功能和适用场景
argument-hint: "[filename] [format]"        # 自动补全提示
disable-model-invocation: true              # 仅用户可调用
user-invocable: false                       # 在斜杠菜单中隐藏
allowed-tools: Read, Grep, Glob             # 限制工具访问权限
model: opus                                 # 指定使用的模型
effort: high                                # 工作量级别覆盖（low, medium, high, max）
context: fork                               # 在独立子智能体中运行
agent: Explore                              # 子智能体类型（配合 context: fork 使用）
shell: bash                                 # 命令使用的 Shell：bash（默认）或 powershell
hooks:                                      # Skill 作用域的钩子
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
---
```

| 字段 | 说明 |
|-------|------|
| `name` | 仅小写字母、数字、连字符（最多 64 字符）。不能包含 "anthropic" 或 "claude"。 |
| `description` | Skill 的功能和适用场景（最多 1024 字符）。对自动调用匹配至关重要。 |
| `argument-hint` | `/` 自动补全菜单中显示的提示（如 `"[filename] [format]"`）。 |
| `disable-model-invocation` | `true` = 仅用户可通过 `/name` 调用。Claude 不会自动调用。 |
| `user-invocable` | `false` = 在 `/` 菜单中隐藏。仅 Claude 可自动调用。 |
| `allowed-tools` | Skill 可使用且无需权限提示的工具列表，逗号分隔。 |
| `model` | Skill 激活期间使用的模型覆盖（如 `opus`、`sonnet`）。 |
| `effort` | Skill 激活期间的工作量级别覆盖：`low`、`medium`、`high` 或 `max`。 |
| `context` | `fork` 在分叉子智能体上下文中运行 Skill，拥有独立的上下文窗口。 |
| `agent` | `context: fork` 时的子智能体类型（如 `Explore`、`Plan`、`general-purpose`）。 |
| `shell` | `!command`` 替换和脚本使用的 Shell：`bash`（默认）或 `powershell`。 |
| `hooks` | 绑定到此 Skill 生命周期的钩子（格式与全局钩子相同）。 |

## Skill 内容类型

Skills 可包含两类内容，各适用于不同目的：

### 参考内容

为 Claude 提供应用于当前工作的知识——约定、模式、样式指南、领域知识。与会话上下文内联运行。

```yaml
---
name: api-conventions
description: 本代码库的 API 设计模式
---

编写 API 端点时：
- 使用 RESTful 命名约定
- 返回一致的错误格式
- 包含请求验证
```

### 任务内容

特定操作的逐步指令。通常直接用 `/skill-name` 调用。

```yaml
---
name: deploy
description: 将应用程序部署到生产环境
context: fork
disable-model-invocation: true
---

部署应用程序：
1. 运行测试套件
2. 构建应用程序
3. 推送到部署目标
```

## 控制 Skill 调用

默认情况下，你和 Claude 都可以调用任何 Skill。两个前置元数据字段控制三种调用模式：

| 前置元数据 | 你可以调用 | Claude 可以调用 |
|---|---|---|
| （默认） | 是 | 是 |
| `disable-model-invocation: true` | 是 | 否 |
| `user-invocable: false` | 否 | 是 |

**使用 `disable-model-invocation: true`** 适用于有副作用的工作流程：`/commit`、`/deploy`、`/send-slack-message`。你不希望 Claude 因为你的代码看起来准备好了就决定部署。

**使用 `user-invocable: false`** 适用于用户无法将其作为有意义的命令操作的背景知识。`legacy-system-context` Skill 解释了旧系统的工作方式——对 Claude 有用，但对用户来说不是有意义的操作。

## 字符串替换

Skills 支持在 Skill 内容到达 Claude 之前解析的动态值：

| 变量 | 说明 |
|----------|------|
| `$ARGUMENTS` | 调用 Skill 时传递的所有参数 |
| `$ARGUMENTS[N]` 或 `$N` | 按索引（从 0 开始）访问特定参数 |
| `${CLAUDE_SESSION_ID}` | 当前会话 ID |
| `${CLAUDE_SKILL_DIR}` | 包含 Skill 的 SKILL.md 文件的目录 |
| `` !`command` `` | 动态上下文注入——运行 Shell 命令并内联输出 |

**示例：**

```yaml
---
name: fix-issue
description: 修复 GitHub issue
---

按照我们的编码标准修复 GitHub issue $ARGUMENTS。
1. 阅读 issue 描述
2. 实现修复
3. 编写测试
4. 创建提交
```

运行 `/fix-issue 123` 会将 `$ARGUMENTS` 替换为 `123`。

## 注入动态上下文

`!`command`` 语法在 Skill 内容发送到 Claude 之前运行 Shell 命令：

```yaml
---
name: pr-summary
description: 总结 Pull Request 的变更
context: fork
agent: Explore
---

## Pull Request 上下文
- PR diff: !`gh pr diff`
- PR 评论: !`gh pr view --comments`
- 变更文件: !`gh pr diff --name-only`

## 你的任务
总结这个 Pull Request...
```

命令立即执行；Claude 只看到最终输出。默认情况下，命令在 `bash` 中运行。在前置元数据中设置 `shell: powershell` 可改用 PowerShell。

## 在子智能体中运行 Skills

添加 `context: fork` 即可在独立子智能体上下文中运行 Skill。Skill 内容成为专用子智能体的任务，拥有独立的上下文窗口，保持主会话整洁。

`agent` 字段指定使用的子智能体类型：

| 智能体类型 | 最佳适用场景 |
|---|---|
| `Explore` | 只读研究、代码库分析 |
| `Plan` | 创建实施计划 |
| `general-purpose` | 需要所有工具的广泛任务 |
| 自定义智能体 | 在配置中定义的专业智能体 |

**示例前置元数据：**

```yaml
---
context: fork
agent: Explore
---
```

**完整 Skill 示例：**

```yaml
---
name: deep-research
description: 深入研究一个主题
context: fork
agent: Explore
---

深入研究 $ARGUMENTS：
1. 使用 Glob 和 Grep 查找相关文件
2. 阅读并分析代码
3. 用具体文件引用总结发现
```

## 实用示例

### 示例 1：代码审查 Skill

**目录结构：**

```
~/.claude/skills/code-review/
├── SKILL.md
├── templates/
│   ├── review-checklist.md
│   └── finding-template.md
└── scripts/
    ├── analyze-metrics.py
    └── compare-complexity.py
```

**文件：** `~/.claude/skills/code-review/SKILL.md`

```yaml
---
name: code-review-specialist
description: 全面的代码审查，包含安全性、性能和质量分析。当用户要求审查代码、分析代码质量、评估 Pull Request，或提及代码审查、安全分析、性能优化时使用。
---

# 代码审查 Skill

此 Skill 提供全面的代码审查能力，重点关注：

1. **安全分析**
   - 认证/授权问题
   - 数据暴露风险
   - 注入漏洞
   - 加密弱点

2. **性能审查**
   - 算法效率（Big O 分析）
   - 内存优化
   - 数据库查询优化
   - 缓存机会

3. **代码质量**
   - SOLID 原则
   - 设计模式
   - 命名约定
   - 测试覆盖率

4. **可维护性**
   - 代码可读性
   - 函数大小（应小于 50 行）
   - 圈复杂度
   - 类型安全

## 审查模板

对每段审查的代码，提供：

### 概要
- 整体质量评估（1-5 分）
- 主要发现数量
- 推荐优先领域

### 关键问题（如有）
- **问题**：清晰描述
- **位置**：文件和行号
- **影响**：为何重要
- **严重性**：Critical/High/Medium
- **修复**：代码示例

详细清单请参见 [templates/review-checklist.md](templates/review-checklist.md)。
```

### 示例 2：代码库可视化 Skill

一个生成交互式 HTML 可视化的 Skill：

**目录结构：**

```
~/.claude/skills/codebase-visualizer/
├── SKILL.md
└── scripts/
    └── visualize.py
```

**文件：** `~/.claude/skills/codebase-visualizer/SKILL.md`

```yaml
---
name: codebase-visualizer
description: 生成代码库结构的交互式可折叠树形可视化。在探索新仓库、理解项目结构或识别大文件时使用。
allowed-tools: Bash(python *)
---

# 代码库可视化

生成显示项目文件结构的交互式 HTML 树视图。

## 使用方法

从项目根目录运行可视化脚本：

```bash
python ~/.claude/skills/codebase-visualizer/scripts/visualize.py .
```

这会创建 `codebase-map.html` 并在默认浏览器中打开。

## 可视化展示内容

- **可折叠目录**：点击文件夹展开/折叠
- **文件大小**：显示在每个文件旁边
- **颜色**：不同文件类型用不同颜色
- **目录总计**：显示每个文件夹的汇总大小
```

打包的 Python 脚本完成繁重工作，Claude 负责协调。

### 示例 3：部署 Skill（仅用户调用）

```yaml
---
name: deploy
description: 将应用程序部署到生产环境
disable-model-invocation: true
allowed-tools: Bash(npm *), Bash(git *)
---

将 $ARGUMENTS 部署到生产环境：

1. 运行测试套件：`npm test`
2. 构建应用程序：`npm run build`
3. 推送到部署目标
4. 验证部署成功
5. 报告部署状态
```

### 示例 4：品牌调性 Skill（背景知识）

```yaml
---
name: brand-voice
description: 确保所有沟通内容符合品牌调性和语气指南。在创建营销文案、客户沟通、公共面向内容时使用。
user-invocable: false
---

## 语气风格
- **友好但专业**——平易近人但不随意
- **清晰简洁**——避免行话
- **自信**——我们知道自己做什么
- **共情**——理解用户需求

## 写作指南
- 称呼读者时使用"你"
- 使用主动语态
- 句子保持在 20 个词以内
- 以价值主张开头

模板请参见 [templates/](templates/)。
```

### 示例 5：CLAUDE.md 生成器 Skill

```yaml
---
name: claude-md
description: 按照 AI 智能体最佳入职实践创建或更新 CLAUDE.md 文件。当用户提及 CLAUDE.md、项目文档或 AI 入职时使用。
---

## 核心原则

**LLM 是无状态的**：CLAUDE.md 是唯一在每个会话中自动包含的文件。

### 黄金法则

1. **少即是多**：保持在 300 行以内（理想情况低于 100 行）
2. **普遍适用性**：只包含与每个会话相关的信息
3. **不要用 Claude 做 Linter**：使用确定性工具代替
4. **绝不自动生成**：手工精心制作，考虑周全

## 必需部分

- **项目名称**：简要的一行描述
- **技术栈**：主要语言、框架、数据库
- **开发命令**：安装、测试、构建命令
- **关键约定**：仅限不显而易见且影响重大的约定
- **已知问题/陷阱**：容易让开发者绊倒的事项
```

### 示例 6：带脚本的重构 Skill

**目录结构：**

```
refactor/
├── SKILL.md
├── references/
│   ├── code-smells.md
│   └── refactoring-catalog.md
├── templates/
│   └── refactoring-plan.md
└── scripts/
    ├── analyze-complexity.py
    └── detect-smells.py
```

**文件：** `refactor/SKILL.md`

```yaml
---
name: code-refactor
description: 基于 Martin Fowler 方法论的系统化代码重构。当用户要求重构代码、改进代码结构、减少技术债务或消除代码异味时使用。
---

# 代码重构 Skill

一种强调安全、增量变更和测试保障的阶段性方法。

## 工作流程

阶段 1: 研究与分析 → 阶段 2: 测试覆盖率评估 →
阶段 3: 代码异味识别 → 阶段 4: 重构计划制定 →
阶段 5: 增量实施 → 阶段 6: 审查与迭代

## 核心原则

1. **行为保持**：外部行为必须保持不变
2. **小步前进**：做出微小、可测试的变更
3. **测试驱动**：测试是安全网
4. **持续进行**：重构是持续性的，不是一次性事件

代码异味目录请参见 [references/code-smells.md](references/code-smells.md)。
重构技术请参见 [references/refactoring-catalog.md](references/refactoring-catalog.md)。
```

## 支持文件

Skills 可在其目录中包含除 `SKILL.md` 以外的多个文件。这些支持文件（模板、示例、脚本、参考文档）让你保持主 Skill 文件专注，同时为 Claude 提供按需加载的额外资源。

```
my-skill/
├── SKILL.md              # 主指令（必需，保持在 500 行以内）
├── templates/            # Claude 填充的模板
│   └── output-format.md
├── examples/             # 展示预期格式的示例输出
│   └── sample-output.md
├── references/           # 领域知识和规格说明
│   └── api-spec.md
└── scripts/              # Claude 可执行的脚本
    └── validate.sh
```

支持文件指南：

- 保持 `SKILL.md` 在 **500 行以内**。将详细参考材料、大型示例和规格说明移到单独文件中。
- 使用**相对路径**从 `SKILL.md` 引用附加文件（如 `[API 参考](references/api-spec.md)`）。
- 支持文件在层级 3（按需加载），因此在 Claude 实际读取之前不会消耗上下文。

## 管理 Skills

### 查看可用 Skills

直接问 Claude：
```
有哪些可用的 Skills？
```

或检查文件系统：
```bash
# 列出个人 Skills
ls ~/.claude/skills/

# 列出项目 Skills
ls .claude/skills/
```

### 测试 Skill

两种测试方式：

**让 Claude 自动调用**，提出与描述匹配的请求：
```
你能帮我审查这段代码的安全性吗？
```

**或直接调用**：
```
/code-review src/auth/login.ts
```

### 更新 Skill

直接编辑 `SKILL.md` 文件。下次 Claude Code 启动时生效。

```bash
# 个人 Skill
code ~/.claude/skills/my-skill/SKILL.md

# 项目 Skill
code .claude/skills/my-skill/SKILL.md
```

### 限制 Claude 的 Skill 访问

三种控制 Claude 可调用哪些 Skills 的方式：

**在 `/permissions` 中禁用所有 Skills**：
```
# 添加到拒绝规则：
Skill
```

**允许或拒绝特定 Skills**：
```
# 仅允许特定 Skills
Skill(commit)
Skill(review-pr *)

# 拒绝特定 Skills
Skill(deploy *)
```

**隐藏单个 Skill**，在其前置元数据中添加 `disable-model-invocation: true`。

## 最佳实践

### 1. 让描述具体化

- **差（模糊）**："帮助处理文档"
- **好（具体）**："从 PDF 文件中提取文本和表格，填写表单，合并文档。在处理 PDF 文件或用户提及 PDF、表单、文档提取时使用。"

### 2. 保持 Skills 专注

- 一个 Skill = 一种能力
- 正确："PDF 表单填写"
- 错误："文档处理"（太宽泛）

### 3. 包含触发关键词

在描述中添加用户自然会说的关键词：
```yaml
description: 分析 Excel 电子表格，生成数据透视表，创建图表。在处理 Excel 文件、电子表格或 .xlsx 文件时使用。
```

### 4. 保持 SKILL.md 在 500 行以内

将详细参考材料移到 Claude 按需加载的单独文件中。

### 5. 引用支持文件

```markdown
## 额外资源

- 完整的 API 详情，请参见 [reference.md](reference.md)
- 使用示例，请参见 [examples.md](examples.md)
```

### 应当做

- 使用清晰、有描述性的名称
- 包含全面的指令
- 添加具体示例
- 打包相关的脚本和模板
- 用真实场景测试
- 记录依赖项

### 不应当做

- 不要为一次性任务创建 Skills
- 不要复制现有功能
- 不要让 Skills 太宽泛
- 不要跳过 description 字段
- 不要安装来源不明的 Skills 而不审核

## 故障排除

### 快速参考

| 问题 | 解决方案 |
|-------|----------|
| Claude 不使用 Skill | 让描述更具体，加入触发关键词 |
| Skill 文件未找到 | 验证路径：`~/.claude/skills/name/SKILL.md` |
| YAML 错误 | 检查 `---` 标记、缩进，禁止使用 Tab |
| Skills 冲突 | 在描述中使用不同的触发关键词 |
| 脚本不运行 | 检查权限：`chmod +x scripts/*.py` |
| Claude 看不到所有 Skills | Skills 太多；检查 `/context` 中的警告 |

### Skill 未触发

如果 Claude 在预期时未使用你的 Skill：

1. 检查描述是否包含用户自然会说出的关键词
2. 验证在问"有哪些可用的 Skills？"时 Skill 是否出现
3. 尝试重新表述请求以匹配描述
4. 用 `/skill-name` 直接调用测试

### Skill 触发过于频繁

如果 Claude 在不需要时使用了你的 Skill：

1. 让描述更具体
2. 对仅手动调用添加 `disable-model-invocation: true`

### Claude 看不到所有 Skills

Skill 描述在上下文窗口的 **2%**（备用方案：**16,000 个字符**）时加载。运行 `/context` 检查是否有被排除 Skills 的警告。使用 `SLASH_COMMAND_TOOL_CHAR_BUDGET` 环境变量覆盖预算。

## 安全注意事项

**只使用来自可信来源的 Skills。** Skills 通过指令和代码为 Claude 提供能力——恶意 Skill 可能引导 Claude 以有害方式调用工具或执行代码。

**关键安全注意事项：**

- **彻底审核**：审查 Skill 目录中的所有文件
- **外部来源有风险**：从外部 URL 获取内容的 Skills 可能被篡改
- **工具滥用**：恶意 Skills 可能以有害方式调用工具
- **像安装软件一样对待**：只使用来自可信来源的 Skills

## Skills 与其他功能对比

| 功能 | 调用方式 | 最佳适用场景 |
|---------|------------|--------------|
| **Skills** | 自动或 `/name` | 可复用专业知识、工作流程 |
| **斜杠命令** | 用户发起的 `/name` | 快速快捷方式（已合并到 Skills） |
| **子智能体** | 自动委托 | 隔离任务执行 |
| **记忆（CLAUDE.md）** | 始终加载 | 持久项目上下文 |
| **MCP** | 实时 | 外部数据/服务访问 |
| **Hooks** | 事件驱动 | 自动化副作用 |

## 捆绑 Skills

Claude Code 自带多个内置 Skills，无需安装始终可用：

| Skill | 说明 |
|-------|-------------|
| `/simplify` | 审查变更文件，寻找复用、质量和效率问题；生成 3 个并行审查智能体 |
| `/batch <instruction>` | 使用 git worktree 在整个代码库中编排大规模并行变更 |
| `/debug [description]` | 通过读取调试日志排查当前会话问题 |
| `/loop [interval] <prompt>` | 按间隔重复运行提示（如 `/loop 5m check the deploy`） |
| `/claude-api` | 加载 Claude API/SDK 参考；在 `anthropic`/`@anthropic-ai/sdk` 导入时自动激活 |

这些 Skills 开箱即用，无需安装或配置。它们遵循与自定义 Skills 相同的 SKILL.md 格式。

## 分享 Skills

### 项目 Skills（团队共享）

1. 在 `.claude/skills/` 中创建 Skill
2. 提交到 git
3. 团队成员拉取变更——Skills 立即可用

### 个人 Skills

```bash
# 复制到个人目录
cp -r my-skill ~/.claude/skills/

# 使脚本可执行
chmod +x ~/.claude/skills/my-skill/scripts/*.py
```

### 插件分发

将 Skills 打包在插件的 `skills/` 目录中以便更广泛分发。

## 更进一步：Skill 集合与 Skill 管理器

一旦你开始认真构建 Skills，有两件事变得必不可少：一个经过验证的 Skills 库和一个管理它们的工具。

**[luongnv89/skills](https://github.com/luongnv89/skills)** —— 我日常在几乎所有项目中使用的 Skills 集合。亮点包括 `logo-designer`（即时生成项目 logo）和 `ollama-optimizer`（根据你的硬件调优本地 LLM 性能）。如果你想要现成的 Skills，这是一个很好的起点。

**[luongnv89/asm](https://github.com/luongnv89/asm)** —— Agent Skill Manager。处理 Skill 开发、重复检测和测试。`asm link` 命令让你在任何项目中测试 Skill 而无需四处复制文件——一旦你有了几十个 Skills，这就必不可少。

## 更多资源

- [官方 Skills 文档](https://code.claude.com/docs/en/skills)
- [Agent Skills 架构博客](https://claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills)
- [Skills 仓库](https://github.com/luongnv89/skills) - 现成可用的 Skills 集合
- [斜杠命令指南](../01-slash-commands/) - 用户发起的快捷方式
- [子智能体指南](../04-subagents/) - 委托的 AI 智能体
- [记忆指南](../02-memory/) - 持久上下文
- [MCP（模型上下文协议）](../05-mcp/) - 实时外部数据
- [Hooks 指南](../06-hooks/) - 事件驱动自动化
