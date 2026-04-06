# 更新日志

## v2.2.0 — 2026-03-26

### 文档

- 将所有教程和参考与 Claude Code v2.1.84 同步 (f78c094) @luongnv89
  - 更新 slash commands 到 55+ 内置 + 5 捆绑 skills，标记 3 个已弃用
  - 将 hook 事件从 18 扩展到 25，添加 `agent` hook 类型（现为 4 种类型）
  - 将 Auto Mode、Channels、Voice Dictation 添加到高级功能
  - 添加 `effort`、`shell` skill frontmatter 字段；`initialPrompt`、`disallowedTools` agent 字段
  - 添加 WebSocket MCP 传输、elicitation、2KB 工具限制
  - 添加 plugin LSP 支持、`userConfig`、`${CLAUDE_PLUGIN_DATA}`
  - 更新所有参考文档（CATALOG、QUICK_REFERENCE、LEARNING-ROADMAP、INDEX）
- 将 README 重写为落地页结构化指南 (32a0776) @luongnv89

### Bug 修复

- 为 CI 合规性添加缺失的 cSpell 单词和 README 部分 (93f9d51) @luongnv89
- 将 `Sandboxing` 添加到 cSpell 词典 (b80ce6f) @luongnv89

**完整更新日志**：https://github.com/luongnv89/claude-howto/compare/v2.1.1...v2.2.0

---

## v2.1.1 — 2026-03-13

### Bug 修复

- 移除导致 CI 链接检查失败的无效 marketplace 链接 (3fdf0d6) @luongnv89
- 将 `sandboxed` 和 `pycache` 添加到 cSpell 词典 (dc64618) @luongnv89

**完整更新日志**：https://github.com/luongnv89/claude-howto/compare/v2.1.0...v2.1.1

---

## v2.1.0 — 2026-03-13

### 功能

- 添加带自测和课程测验 skills 的自适应学习路径 (1ef46cd) @luongnv89
  - `/self-assessment` — 跨 10 个功能领域的交互式水平测验，带个性化学习路径
  - `/lesson-quiz [lesson]` — 每个课程 8-10 个针对性问题的知识检查

### Bug 修复

- 更新损坏的 URL、弃用和过时引用 (8fe4520) @luongnv89
- 修复资源和自测 skill 中的损坏链接 (7a05863) @luongnv89
- 在概念指南中使用波浪号围栏处理嵌套代码块 (5f82719) @VikalpP
- 将缺失单词添加到 cSpell 词典 (8df7572) @luongnv89

### 文档

- 阶段 5 QA — 修复文档间的一致性、URL 和术语 (00bbe4c) @luongnv89
- 完成阶段 3-4 — 新功能覆盖和参考文档更新 (132de29) @luongnv89
- 将 MCPorter 运行时添加到 MCP 上下文膨胀部分 (ef52705) @luongnv89
- 在 6 个指南中添加缺失的命令、功能和设置 (4bc8f15) @luongnv89
- 添加基于现有仓库约定的样式指南 (84141d0) @luongnv89
- 在指南对比表中添加自测行 (8fe0c96) @luongnv89
- 在贡献者列表中添加 VikalpP 的 PR #7 (d5b4350) @luongnv89
- 在 README 和路线图中添加自测和课程测验 skill 引用 (d5a6106) @luongnv89

### 新贡献者

- @VikalpP 在 #7 中进行了首次贡献

**完整更新日志**：https://github.com/luongnv89/claude-howto/compare/v2.0.0...v2.1.0

---

## v2.0.0 — 2026-02-01

### 功能

- 将所有文档与 Claude Code 2026年2月功能同步 (487c96d)
  - 更新全部 10 个教程目录和 7 个参考文档的 26 个文件
  - 添加 **Auto Memory** 文档 — 每个项目的持久化学习
  - 添加 **Remote Control**、**Web Sessions** 和 **Desktop App** 文档
  - 添加 **Agent Teams** 文档（实验性多 agent 协作）
  - 添加 **MCP OAuth 2.0**、**Tool Search** 和 **Claude.ai Connectors** 文档
  - 添加 **Persistent Memory** 和 **Worktree Isolation** 文档用于 subagents
  - 添加 **Background Subagents**、**Task List**、**Prompt Suggestions** 文档
  - 添加 **Sandboxing** 和 **Managed Settings**（企业版）文档
  - 添加 **HTTP Hooks** 和 7 个新 hook 事件文档
  - 添加 **Plugin Settings**、**LSP Servers** 和 Marketplace 更新文档
  - 添加 **Summarize from Checkpoint** 回退选项文档
  - 记录 17 个新 slash commands（`/fork`、`/desktop`、`/teleport`、`/tasks`、`/fast` 等）
  - 记录新 CLI 标志（`--worktree`、`--from-pr`、`--remote`、`--teleport`、`--teammate-mode` 等）
  - 记录用于自动 memory、努力级别、agent teams 等的新环境变量

### 设计

- 重新设计 logo，使用指南针括号标记和简约调色板 (20779db)

### Bug 修复/更正

- 更新模型名称：Sonnet 4.5 → **Sonnet 4.6**，Opus 4.5 → **Opus 4.6**
- 修复权限模式名称：将虚构的 "Unrestricted/Confirm/Read-only" 替换为实际的 `default`/`acceptEdits`/`plan`/`dontAsk`/`bypassPermissions`
- 修复 hook 事件：移除虚构的 `PreCommit`/`PostCommit`/`PrePush`，添加实际事件（`SubagentStart`、`WorktreeCreate`、`ConfigChange` 等）
- 修复 CLI 语法：将 `claude-code --headless` 替换为 `claude -p`（打印模式）
- 修复检查点命令：将虚构的 `/checkpoint save/list/rewind/diff` 替换为实际的 `Esc+Esc` / `/rewind` 界面
- 修复会话管理：将虚构的 `/session list/new/switch/save` 替换为实际的 `/resume`/`/rename`/`/fork`
- 修复 plugin 清单格式：将 `plugin.yaml` 迁移到 `.claude-plugin/plugin.json`
- 修复 MCP 配置路径：`~/.claude/mcp.json` → `.mcp.json`（项目）/ `~/.claude.json`（用户）
- 修复文档 URL：`docs.claude.com` → `docs.anthropic.com`；移除虚构的 `plugins.claude.com`
- 移除跨多个文件的虚构配置字段
- 将所有"最后更新"日期更新为 2026年2月

**完整更新日志**：https://github.com/luongnv89/claude-howto/compare/20779db...v2.0.0
