<picture>
  <source media="(prefers-color-scheme: dark)" srcset="resources/logos/claude-howto-logo-dark.svg">
  <img alt="Claude How To" src="resources/logos/claude-howto-logo.svg">
</picture>

# Claude Code 功能目录

> 所有 Claude Code 功能的快速参考指南：命令、agents、skills、plugins 和 hooks。

**导航**：[Commands](#slash-commands) | [Permission Modes](#permission-modes) | [Subagents](#subagents) | [Skills](#skills) | [Plugins](#plugins) | [MCP Servers](#mcp-servers) | [Hooks](#hooks) | [Memory](#memory-files) | [新功能](#新功能-2026年3月)

---

## 摘要

| 功能 | 内置 | 示例 | 总计 | 参考 |
|---------|----------|----------|-------|-----------|
| **Slash Commands** | 55+ | 8 | 63+ | [01-slash-commands/](01-slash-commands/) |
| **Subagents** | 6 | 10 | 16 | [04-subagents/](04-subagents/) |
| **Skills** | 5 捆绑 | 4 | 9 | [03-skills/](03-skills/) |
| **Plugins** | - | 3 | 3 | [07-plugins/](07-plugins/) |
| **MCP Servers** | 1 | 8 | 9 | [05-mcp/](05-mcp/) |
| **Hooks** | 25 事件 | 7 | 7 | [06-hooks/](06-hooks/) |
| **Memory** | 7 类型 | 3 | 3 | [02-memory/](02-memory/) |
| **总计** | **99** | **43** | **117** | |

---

## Slash Commands

命令是用户触发的快捷方式，执行特定操作。

### 内置命令

| 命令 | 描述 | 何时使用 |
|---------|-------------|-------------|
| `/help` | 显示帮助信息 | 开始使用、学习命令 |
| `/btw` | 旁问题，不添加上下文 | 快速侧问 |
| `/chrome` | 配置 Chrome 集成 | 浏览器自动化 |
| `/clear` | 清除对话历史 | 重新开始、减少上下文 |
| `/diff` | 交互式 diff 查看器 | 审查更改 |
| `/config` | 查看/编辑配置 | 自定义行为 |
| `/status` | 显示会话状态 | 检查当前状态 |
| `/agents` | 列出可用 agents | 查看委托选项 |
| `/skills` | 列出可用 skills | 查看自动调用能力 |
| `/hooks` | 列出已配置的 hooks | 调试自动化 |
| `/insights` | 分析会话模式 | 会话优化 |
| `/install-slack-app` | 安装 Claude Slack 应用 | Slack 集成 |
| `/keybindings` | 自定义键盘快捷键 | 键位自定义 |
| `/mcp` | 列出 MCP servers | 检查外部集成 |
| `/memory` | 查看已加载的 memory 文件 | 调试上下文加载 |
| `/mobile` | 生成移动端二维码 | 移动访问 |
| `/passes` | 查看使用次数 | 订阅信息 |
| `/plugin` | 管理 plugins | 安装/删除扩展 |
| `/plan` | 进入 planning 模式 | 复杂实现 |
| `/rewind` | 回退到检查点 | 撤销更改、探索替代方案 |
| `/checkpoint` | 管理检查点 | 保存/恢复状态 |
| `/cost` | 显示 token 使用成本 | 监控支出 |
| `/context` | 显示上下文窗口使用情况 | 管理对话长度 |
| `/export` | 导出对话 | 保存参考 |
| `/extra-usage` | 配置额外使用限制 | 速率限制管理 |
| `/feedback` | 提交反馈或 bug 报告 | 报告问题 |
| `/login` | 通过 Anthropic 认证 | 访问功能 |
| `/logout` | 登出 | 切换账户 |
| `/sandbox` | 切换沙盒模式 | 安全命令执行 |
| `/vim` | 切换 vim 模式 | Vim 风格编辑 |
| `/doctor` | 运行诊断 | 故障排除 |
| `/reload-plugins` | 重新加载已安装的 plugins | Plugin 管理 |
| `/release-notes` | 显示发布说明 | 查看新功能 |
| `/remote-control` | 启用远程控制 | 远程访问 |
| `/permissions` | 管理权限 | 控制访问 |
| `/session` | 管理会话 | 多会话工作流 |
| `/rename` | 重命名当前会话 | 整理会话 |
| `/resume` | 恢复之前的会话 | 继续工作 |
| `/todo` | 查看/管理待办列表 | 跟踪任务 |
| `/tasks` | 查看后台任务 | 监控异步操作 |
| `/copy` | 复制上一个响应到剪贴板 | 快速分享输出 |
| `/teleport` | 将会话转移到另一台机器 | 远程继续工作 |
| `/desktop` | 打开 Claude Desktop 应用 | 切换到桌面界面 |
| `/theme` | 更改颜色主题 | 自定义外观 |
| `/usage` | 显示 API 使用统计 | 监控配额和成本 |
| `/fork` | 分叉当前对话 | 探索替代方案 |
| `/stats` | 显示会话统计 | 审查会话指标 |
| `/statusline` | 配置状态行 | 自定义状态显示 |
| `/stickers` | 查看会话贴纸 | 有趣的奖励 |
| `/fast` | 切换快速输出模式 | 加快响应 |
| `/terminal-setup` | 配置终端集成 | 设置终端功能 |
| `/upgrade` | 检查更新 | 版本管理 |

### 自定义命令（示例）

| 命令 | 描述 | 何时使用 | 范围 | 安装 |
|---------|-------------|-------------|-------|--------------|
| `/optimize` | 分析代码以进行优化 | 性能改进 | 项目 | `cp 01-slash-commands/optimize.md .claude/commands/` |
| `/pr` | 准备 pull request | 提交 PR 前 | 项目 | `cp 01-slash-commands/pr.md .claude/commands/` |
| `/generate-api-docs` | 生成 API 文档 | 记录 API | 项目 | `cp 01-slash-commands/generate-api-docs.md .claude/commands/` |
| `/commit` | 创建带上下文的 git 提交 | 提交更改 | 用户 | `cp 01-slash-commands/commit.md .claude/commands/` |
| `/push-all` | 暂存、提交并推送 | 快速部署 | 用户 | `cp 01-slash-commands/push-all.md .claude/commands/` |
| `/doc-refactor` | 重组文档 | 改进文档 | 项目 | `cp 01-slash-commands/doc-refactor.md .claude/commands/` |
| `/setup-ci-cd` | 设置 CI/CD pipeline | 新项目 | 项目 | `cp 01-slash-commands/setup-ci-cd.md .claude/commands/` |
| `/unit-test-expand` | 扩展测试覆盖率 | 改进测试 | 项目 | `cp 01-slash-commands/unit-test-expand.md .claude/commands/` |

> **范围**：`User` = 个人工作流（`~/.claude/commands/`），`Project` = 团队共享（`.claude/commands/`）

**参考**：[01-slash-commands/](01-slash-commands/) | [官方文档](https://code.claude.com/docs/en/interactive-mode)

**快速安装（所有自定义命令）**：
```bash
cp 01-slash-commands/*.md .claude/commands/
```

---

## Permission Modes

Claude Code 支持 6 种权限模式，控制工具使用的授权方式。

| 模式 | 描述 | 何时使用 |
|------|-------------|-------------|
| `default` | 每个工具调用都请求确认 | 标准交互使用 |
| `acceptEdits` | 自动接受文件编辑，其他请求确认 | 信任的编辑工作流 |
| `plan` | 仅允许只读工具，不写入 | Planning 和探索 |
| `auto` | 无需确认自动接受所有工具 | 完全自主操作（研究预览） |
| `bypassPermissions` | 跳过所有权限检查 | CI/CD、无头环境 |
| `dontAsk` | 跳过需要权限的工具 | 非交互式脚本 |

> **注意**：`auto` 模式是研究预览功能（2026年3月）。仅在可信的沙盒环境中使用 `bypassPermissions`。

**参考**：[官方文档](https://code.claude.com/docs/en/permissions)

---

## Subagents

用于特定任务、具有隔离上下文的专业 AI 助手。

### 内置 Subagents

| Agent | 描述 | 工具 | 模型 | 何时使用 |
|-------|-------------|-------|-------|-------------|
| **general-purpose** | 多步骤任务、研究 | 所有工具 | 继承模型 | 复杂研究、多文件任务 |
| **Plan** | 实现规划 | Read, Glob, Grep, Bash | 继承模型 | 架构设计、规划 |
| **Explore** | 代码库探索 | Read, Glob, Grep | Haiku 4.5 | 快速搜索、理解代码 |
| **Bash** | 命令执行 | Bash | 继承模型 | Git 操作、终端任务 |
| **statusline-setup** | 状态行配置 | Bash, Read, Write | Sonnet 4.6 | 配置状态行显示 |
| **Claude Code Guide** | 帮助和文档 | Read, Glob, Grep | Haiku 4.5 | 获取帮助、学习功能 |

### Subagent 配置字段

| 字段 | 类型 | 描述 |
|-------|------|---------|
| `name` | string | Agent 标识符 |
| `description` | string | Agent 用途 |
| `model` | string | 模型覆盖（如 `haiku-4.5`） |
| `tools` | array | 允许的工具列表 |
| `effort` | string | 推理努力级别（`low`、`medium`、`high`） |
| `initialPrompt` | string | Agent 启动时注入的系统提示 |
| `disallowedTools` | array | 明确拒绝此 agent 使用的工具 |

### 自定义 Subagents（示例）

| Agent | 描述 | 何时使用 | 范围 | 安装 |
|-------|-------------|-------------|-------|--------------|
| `code-reviewer` | 综合代码质量 | 代码审查会话 | 项目 | `cp 04-subagents/code-reviewer.md .claude/agents/` |
| `code-architect` | 功能架构设计 | 新功能规划 | 项目 | `cp 04-subagents/code-architect.md .claude/agents/` |
| `code-explorer` | 深度代码库分析 | 理解现有功能 | 项目 | `cp 04-subagents/code-explorer.md .claude/agents/` |
| `clean-code-reviewer` | Clean Code 原则审查 | 可维护性审查 | 项目 | `cp 04-subagents/clean-code-reviewer.md .claude/agents/` |
| `test-engineer` | 测试策略和覆盖率 | 测试规划 | 项目 | `cp 04-subagents/test-engineer.md .claude/agents/` |
| `documentation-writer` | 技术文档 | API 文档、指南 | 项目 | `cp 04-subagents/documentation-writer.md .claude/agents/` |
| `secure-reviewer` | 安全重点审查 | 安全审计 | 项目 | `cp 04-subagents/secure-reviewer.md .claude/agents/` |
| `implementation-agent` | 完整功能实现 | 功能开发 | 项目 | `cp 04-subagents/implementation-agent.md .claude/agents/` |
| `debugger` | 根本原因分析 | Bug 调查 | 用户 | `cp 04-subagents/debugger.md .claude/agents/` |
| `data-scientist` | SQL 查询、数据分析 | 数据任务 | 用户 | `cp 04-subagents/data-scientist.md .claude/agents/` |

> **范围**：`User` = 个人（`~/.claude/agents/`），`Project` = 团队共享（`.claude/agents/`）

**参考**：[04-subagents/](04-subagents/) | [官方文档](https://code.claude.com/docs/en/sub-agents)

**快速安装（所有自定义 agents）**：
```bash
cp 04-subagents/*.md .claude/agents/
```

---

## Skills

带说明、脚本和模板的可自动调用能力。

### 示例 Skills

| Skill | 描述 | 何时自动调用 | 范围 | 安装 |
|-------|-------------|-------------------|-------|--------------|
| `code-review` | 综合代码审查 | "审查代码"、"检查质量" | 项目 | `cp -r 03-skills/code-review .claude/skills/` |
| `brand-voice` | 品牌一致性检查器 | 编写营销文案 | 项目 | `cp -r 03-skills/brand-voice .claude/skills/` |
| `doc-generator` | API 文档生成器 | "生成文档"、"记录 API" | 项目 | `cp -r 03-skills/doc-generator .claude/skills/` |
| `refactor` | 系统化代码重构（Martin Fowler） | "重构代码"、"清理代码" | 用户 | `cp -r 03-skills/refactor ~/.claude/skills/` |

> **范围**：`User` = 个人（`~/.claude/skills/`），`Project` = 团队共享（`.claude/skills/`）

### Skill 结构

```
~/.claude/skills/skill-name/
├── SKILL.md          # Skill 定义和说明
├── scripts/          # 辅助脚本
└── templates/        # 输出模板
```

### Skill Frontmatter 字段

Skills 在 `SKILL.md` 中支持 YAML frontmatter 配置：

| 字段 | 类型 | 描述 |
|-------|------|---------|
| `name` | string | Skill 显示名称 |
| `description` | string | Skill 功能描述 |
| `autoInvoke` | array | 自动调用的触发短语 |
| `effort` | string | 推理努力级别（`low`、`medium`、`high`） |
| `shell` | string | 脚本使用的 shell（`bash`、`zsh`、`sh`） |

**参考**：[03-skills/](03-skills/) | [官方文档](https://code.claude.com/docs/en/skills)

**快速安装（所有 Skills）**：
```bash
cp -r 03-skills/* ~/.claude/skills/
```

### 捆绑 Skills

| Skill | 描述 | 何时自动调用 |
|-------|-------------|-------------------|
| `/simplify` | 审查代码质量 | 编写代码后 |
| `/batch` | 对多个文件运行 prompts | 批量操作 |
| `/debug` | 调试失败的测试/错误 | 调试会话 |
| `/loop` | 按间隔运行 prompts | 重复任务 |
| `/claude-api` | 使用 Claude API 构建应用 | API 开发 |

---

## Plugins

命令、agents、MCP servers 和 hooks 的打包集合。

### 示例 Plugins

| Plugin | 描述 | 组件 | 何时使用 | 范围 | 安装 |
|--------|-------------|------------|-------------|-------|--------------|
| `pr-review` | PR 审查工作流 | 3 个命令、3 个 agents、GitHub MCP | 代码审查 | 项目 | `/plugin install pr-review` |
| `devops-automation` | 部署和监控 | 4 个命令、3 个 agents、K8s MCP | DevOps 任务 | 项目 | `/plugin install devops-automation` |
| `documentation` | 文档生成套件 | 4 个命令、3 个 agents、模板 | 文档 | 项目 | `/plugin install documentation` |

> **范围**：`Project` = 团队共享，`User` = 个人工作流

### Plugin 结构

```
.claude-plugin/
├── plugin.json       # 清单文件
├── commands/         # Slash commands
├── agents/           # Subagents
├── skills/           # Skills
├── mcp/              # MCP 配置
├── hooks/            # Hook 脚本
└── scripts/          # 实用脚本
```

**参考**：[07-plugins/](07-plugins/) | [官方文档](https://code.claude.com/docs/en/plugins)

**Plugin 管理命令**：
```bash
/plugin list              # 列出已安装的 plugins
/plugin install <name>    # 安装 plugin
/plugin remove <name>     # 移除 plugin
/plugin update <name>     # 更新 plugin
```

---

## MCP Servers

用于外部工具和 API 访问的 Model Context Protocol servers。

### 常用 MCP Servers

| Server | 描述 | 何时使用 | 范围 | 安装 |
|--------|-------------|-------------|-------|--------------|
| **GitHub** | PR 管理、issues、代码 | GitHub 工作流 | 项目 | `claude mcp add github -- npx -y @modelcontextprotocol/server-github` |
| **Database** | SQL 查询、数据访问 | 数据库操作 | 项目 | `claude mcp add db -- npx -y @modelcontextprotocol/server-postgres` |
| **Filesystem** | 高级文件操作 | 复杂文件任务 | 用户 | `claude mcp add fs -- npx -y @modelcontextprotocol/server-filesystem` |
| **Slack** | 团队沟通 | 通知、更新 | 项目 | 在设置中配置 |
| **Google Docs** | 文档访问 | 文档编辑、审查 | 项目 | 在设置中配置 |
| **Asana** | 项目管理 | 任务跟踪 | 项目 | 在设置中配置 |
| **Stripe** | 支付数据 | 财务分析 | 项目 | 在设置中配置 |
| **Memory** | 持久化 memory | 跨会话记忆 | 用户 | 在设置中配置 |
| **Context7** | 库文档 | 最新文档查询 | 内置 | 内置 |

> **范围**：`Project` = 团队（`.mcp.json`），`User` = 个人（`~/.claude.json`），`Built-in` = 预安装

### MCP 配置示例

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**参考**：[05-mcp/](05-mcp/) | [MCP Protocol 文档](https://modelcontextprotocol.io)

**快速安装（GitHub MCP）**：
```bash
export GITHUB_TOKEN="your_token" && claude mcp add github -- npx -y @modelcontextprotocol/server-github
```

---

## Hooks

事件驱动的自动化，在 Claude Code 事件上执行 shell 命令。

### Hook 事件

| 事件 | 描述 | 何时触发 | 使用场景 |
|-------|-------------|----------------|-----------|
| `SessionStart` | 会话开始/恢复 | 会话初始化 | 设置任务 |
| `InstructionsLoaded` | 指令已加载 | CLAUDE.md 或规则文件已加载 | 自定义指令处理 |
| `UserPromptSubmit` | Prompt 处理前 | 用户发送消息 | 输入验证 |
| `PreToolUse` | 工具执行前 | 任何工具运行前 | 验证、日志记录 |
| `PermissionRequest` | 显示权限对话框 | 敏感操作前 | 自定义批准流程 |
| `PostToolUse` | 工具成功后 | 任何工具完成后 | 格式化、通知 |
| `PostToolUseFailure` | 工具执行失败 | 工具错误后 | 错误处理、日志记录 |
| `Notification` | 发送通知 | Claude 发送通知时 | 外部告警 |
| `SubagentStart` | Subagent 启动 | Subagent 任务开始 | 初始化 subagent 上下文 |
| `SubagentStop` | Subagent 完成 | Subagent 任务完成 | 链式操作 |
| `Stop` | Claude 完成响应 | 响应完成 | 清理、报告 |
| `StopFailure` | API 错误结束回合 | 发生 API 错误 | 错误恢复、日志记录 |
| `TeammateIdle` | Teammate agent 空闲 | Agent 团队协调 | 分配工作 |
| `TaskCompleted` | 任务标记完成 | 任务完成 | 任务后处理 |
| `TaskCreated` | 通过 TaskCreate 创建任务 | 创建新任务 | 任务跟踪、日志记录 |
| `ConfigChange` | 配置已更新 | 设置修改 | 对配置更改做出反应 |
| `CwdChanged` | 工作目录改变 | 目录改变 | 目录特定设置 |
| `FileChanged` | 监视文件改变 | 文件修改 | 文件监控、重新构建 |
| `PreCompact` | 压缩操作前 | 上下文压缩 | 状态保存 |
| `PostCompact` | 压缩完成后 | 压缩完成 | 压缩后操作 |
| `WorktreeCreate` | 正在创建 worktree | Git worktree 已创建 | 设置 worktree 环境 |
| `WorktreeRemove` | 正在删除 worktree | Git worktree 已删除 | 清理 worktree 资源 |
| `Elicitation` | MCP server 请求输入 | MCP elicitation | 输入验证 |
| `ElicitationResult` | 用户响应 elicitation | 用户响应 | 响应处理 |
| `SessionEnd` | 会话终止 | 会话终止 | 清理、保存状态 |

### 示例 Hooks

| Hook | 描述 | 事件 | 范围 | 安装 |
|------|-------------|-------|-------|--------------|
| `validate-bash.py` | 命令验证 | PreToolUse:Bash | 项目 | `cp 06-hooks/validate-bash.py .claude/hooks/` |
| `security-scan.py` | 安全扫描 | PostToolUse:Write | 项目 | `cp 06-hooks/security-scan.py .claude/hooks/` |
| `format-code.sh` | 自动格式化 | PostToolUse:Write | 用户 | `cp 06-hooks/format-code.sh ~/.claude/hooks/` |
| `validate-prompt.py` | Prompt 验证 | UserPromptSubmit | 项目 | `cp 06-hooks/validate-prompt.py .claude/hooks/` |
| `context-tracker.py` | Token 使用跟踪 | Stop | 用户 | `cp 06-hooks/context-tracker.py ~/.claude/hooks/` |
| `pre-commit.sh` | 提交前验证 | PreToolUse:Bash | 项目 | `cp 06-hooks/pre-commit.sh .claude/hooks/` |
| `log-bash.sh` | 命令日志 | PostToolUse:Bash | 用户 | `cp 06-hooks/log-bash.sh ~/.claude/hooks/` |

> **范围**：`Project` = 团队（`.claude/settings.json`），`User` = 个人（`~/.claude/settings.json`）

### Hook 配置

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "~/.claude/hooks/validate-bash.py"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write",
        "command": "~/.claude/hooks/format-code.sh"
      }
    ]
  }
}
```

**参考**：[06-hooks/](06-hooks/) | [官方文档](https://code.claude.com/docs/en/hooks)

**快速安装（所有 Hooks）**：
```bash
mkdir -p ~/.claude/hooks && cp 06-hooks/*.sh ~/.claude/hooks/ && chmod +x ~/.claude/hooks/*.sh
```

---

## Memory Files

跨会话自动加载的持久化上下文。

### Memory 类型

| 类型 | 位置 | 范围 | 何时使用 |
|------|----------|-------|-------------|
| **Managed Policy** | 组织管理的策略 | 组织 | 强制执行组织范围标准 |
| **Project** | `./CLAUDE.md` | 项目（团队） | 团队标准、项目上下文 |
| **Project Rules** | `.claude/rules/` | 项目（团队） | 模块化项目约定 |
| **User** | `~/.claude/CLAUDE.md` | 用户（个人） | 个人偏好 |
| **User Rules** | `~/.claude/rules/` | 用户（个人） | 模块化个人规则 |
| **Local** | `./CLAUDE.local.md` | 本地（git 忽略） | 机器特定覆盖（2026年3月官方文档中未收录；可能是遗留） |
| **Auto Memory** | 自动 | 会话 | 自动捕获的洞察和修正 |

> **范围**：`Organization` = 由管理员管理，`Project` = 通过 git 与团队共享，`User` = 个人偏好，`Local` = 不提交，`Session` = 自动管理

**参考**：[02-memory/](02-memory/) | [官方文档](https://code.claude.com/docs/en/memory)

**快速安装**：
```bash
cp 02-memory/project-CLAUDE.md ./CLAUDE.md
cp 02-memory/personal-CLAUDE.md ~/.claude/CLAUDE.md
```

---

## 新功能（2026年3月）

| 功能 | 描述 | 如何使用 |
|---------|-------------|------------|
| **Remote Control** | 通过 API 远程控制 Claude Code 会话 | 使用远程控制 API 以编程方式发送 prompts 和接收响应 |
| **Web Sessions** | 在基于浏览器的环境中运行 Claude Code | 通过 `claude web` 或 Anthropic Console 访问 |
| **Desktop App** | Claude Code 的原生桌面应用程序 | 使用 `/desktop` 或从 Anthropic 网站下载 |
| **Agent Teams** | 协调多个 agents 处理相关任务 | 配置协同工作和共享上下文的 teammate agents |
| **Task List** | 后台任务管理和监控 | 使用 `/tasks` 查看和管理后台操作 |
| **Prompt Suggestions** | 上下文感知的命令建议 | 根据当前上下文自动出现建议 |
| **Git Worktrees** | 用于并行开发的隔离 git worktrees | 使用 worktree 命令进行安全的并行分支工作 |
| **Sandboxing** | 用于安全性的隔离执行环境 | 使用 `/sandbox` 切换；在受限环境中运行命令 |
| **MCP OAuth** | MCP servers 的 OAuth 认证 | 在 MCP server 设置中配置 OAuth 凭据以实现安全访问 |
| **MCP Tool Search** | 动态搜索和发现 MCP 工具 | 使用工具搜索在连接的 servers 中找到可用的 MCP 工具 |
| **Scheduled Tasks** | 使用 `/loop` 和 cron 工具设置重复任务 | 使用 `/loop 5m /command` 或 CronCreate 工具 |
| **Chrome 集成** | 使用无头 Chromium 进行浏览器自动化 | 使用 `--chrome` 标志或 `/chrome` 命令 |
| **键盘自定义** | 包括组合键支持的自定义键绑定 | 使用 `/keybindings` 或编辑 `~/.claude/keybindings.json` |
| **Auto Mode** | 无权限提示的完全自主操作（研究预览） | 使用 `--mode auto` 或 `/permissions auto`；2026年3月 |
| **Channels** | 多通道通信（Telegram、Slack 等）（研究预览） | 配置 channel plugins；2026年3月 |
| **Voice Dictation** | 用于 prompts 的语音输入 | 使用麦克风图标或语音键绑定 |
| **Agent Hook 类型** | 生成 subagent 而不是运行 shell 命令的 hooks | 在 hook 配置中设置 `"type": "agent"` |
| **Prompt Hook 类型** | 向对话注入 prompt 文本的 hooks | 在 hook 配置中设置 `"type": "prompt"` |
| **MCP Elicitation** | MCP servers 可在工具执行期间请求用户输入 | 通过 `Elicitation` 和 `ElicitationResult` hook 事件处理 |
| **WebSocket MCP Transport** | MCP server 连接的基于 WebSocket 的传输 | 在 MCP server 配置中使用 `"transport": "websocket"` |
| **Plugin LSP 支持** | 通过 plugins 集成 Language Server Protocol | 在 `plugin.json` 中配置 LSP servers 以实现编辑器功能 |
| **Managed Drop-ins** | 组织管理的 drop-in 配置（v2.1.83） | 通过托管策略由管理员配置；自动应用于所有用户 |

---

## 快速参考矩阵

### 功能选择指南

| 需求 | 推荐功能 | 原因 |
|------|---------------------|-----|
| 快速快捷方式 | Slash Command | 手动、即时 |
| 持久化上下文 | Memory | 自动加载 |
| 复杂自动化 | Skill | 自动调用 |
| 专业任务 | Subagent | 隔离上下文 |
| 外部数据 | MCP Server | 实时访问 |
| 事件自动化 | Hook | 事件触发 |
| 完整解决方案 | Plugin | 一体化包 |

### 安装优先级

| 优先级 | 功能 | 命令 |
|----------|---------|---------|
| 1. 必要 | Memory | `cp 02-memory/project-CLAUDE.md ./CLAUDE.md` |
| 2. 日常使用 | Slash Commands | `cp 01-slash-commands/*.md .claude/commands/` |
| 3. 质量 | Subagents | `cp 04-subagents/*.md .claude/agents/` |
| 4. 自动化 | Hooks | `cp 06-hooks/*.sh ~/.claude/hooks/ && chmod +x ~/.claude/hooks/*.sh` |
| 5. 外部 | MCP | `claude mcp add github -- npx -y @modelcontextprotocol/server-github` |
| 6. 高级 | Skills | `cp -r 03-skills/* ~/.claude/skills/` |
| 7. 完整 | Plugins | `/plugin install pr-review` |

---

## 一键完整安装

从本仓库安装所有示例：

```bash
# 创建目录
mkdir -p .claude/{commands,agents,skills} ~/.claude/{hooks,skills}

# 安装所有功能
cp 01-slash-commands/*.md .claude/commands/ && \
cp 02-memory/project-CLAUDE.md ./CLAUDE.md && \
cp -r 03-skills/* ~/.claude/skills/ && \
cp 04-subagents/*.md .claude/agents/ && \
cp 06-hooks/*.sh ~/.claude/hooks/ && \
chmod +x ~/.claude/hooks/*.sh
```

---

## 更多资源

- [Claude Code 官方文档](https://code.claude.com/docs/en/overview)
- [MCP Protocol 规范](https://modelcontextprotocol.io)
- [学习路线图](LEARNING-ROADMAP.md)
- [主 README](README.md)

---

**最后更新**：2026年3月
