<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../resources/logos/claude-howto-logo-dark.svg">
  <img alt="Claude How To" src="../resources/logos/claude-howto-logo.svg">
</picture>

# Hooks（钩子）

钩子是一种自动化脚本，在 Claude Code 会话期间响应特定事件时执行。它们支持自动化、验证、权限管理和自定义工作流。

## 概述

钩子是自动化操作（Shell 命令、HTTP Webhook、LLM 提示词或子代理评估），当 Claude Code 中发生特定事件时自动执行。它们接收 JSON 输入，并通过退出码和 JSON 输出进行通信。

**主要特点：**
- 事件驱动的自动化
- 基于 JSON 的输入/输出
- 支持命令型、提示词型、HTTP 型和代理型钩子
- 工具特定钩子的模式匹配

## 配置

钩子在配置文件中设置，具有特定结构：

- `~/.claude/settings.json` - 用户设置（所有项目）
- `.claude/settings.json` - 项目设置（可共享、可提交）
- `.claude/settings.local.json` - 本地项目设置（不提交）
- 托管策略 - 组织范围设置
- 插件 `hooks/hooks.json` - 插件作用域钩子
- Skill/Agent frontmatter - 组件生命周期钩子

### 基本配置结构

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "your-command-here",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

**关键字段：**

| 字段 | 说明 | 示例 |
|------|------|------|
| `matcher` | 匹配工具名称的模式（区分大小写） | `"Write"`、`"Edit\|Write"`、`"*"` |
| `hooks` | 钩子定义数组 | `[{ "type": "command", ... }]` |
| `type` | 钩子类型：`"command"`（bash）、`"prompt"`（LLM）、`"http"`（webhook）或 `"agent"`（子代理） | `"command"` |
| `command` | 要执行的 Shell 命令 | `"$CLAUDE_PROJECT_DIR/.claude/hooks/format.sh"` |
| `timeout` | 可选超时时间（秒），默认 60 | `30` |
| `once` | 若为 `true`，则每个会话仅运行一次钩子 | `true` |

### Matcher 模式

| 模式 | 说明 | 示例 |
|------|------|------|
| 精确字符串 | 匹配特定工具 | `"Write"` |
| 正则表达式模式 | 匹配多个工具 | `"Edit\|Write"` |
| 通配符 | 匹配所有工具 | `"*"` 或 `""` |
| MCP 工具 | 服务器和工具模式 | `"mcp__memory__.*"` |

## 钩子类型

Claude Code 支持四种钩子类型：

### Command Hooks（命令型钩子）

默认钩子类型。执行 Shell 命令并通过 JSON stdin/stdout 和退出码通信。

```json
{
  "type": "command",
  "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate.py\"",
  "timeout": 60
}
```

### HTTP Hooks（HTTP 型钩子）

> v2.1.63 新增。

远程 Webhook 端点，接收与命令型钩子相同的 JSON 输入。HTTP 钩子将 JSON POST 到 URL 并接收 JSON 响应。启用沙盒时，HTTP 钩子通过沙盒路由。出于安全考虑，URL 中的环境变量插值需要显式的 `allowedEnvVars` 列表。

```json
{
  "hooks": {
    "PostToolUse": [{
      "type": "http",
      "url": "https://my-webhook.example.com/hook",
      "matcher": "Write"
    }]
  }
}
```

**关键属性：**
- `"type": "http"` -- 标识为 HTTP 钩子
- `"url"` -- Webhook 端点 URL
- 启用沙盒时通过沙盒路由
- URL 中任何环境变量插值都需要显式的 `allowedEnvVars` 列表

### Prompt Hooks（提示词型钩子）

LLM 评估的提示词，钩子内容是 Claude 评估的提示词。主要与 `Stop` 和 `SubagentStop` 事件配合使用，用于智能任务完成检查。

```json
{
  "type": "prompt",
  "prompt": "评估 Claude 是否完成了所有请求的任务。",
  "timeout": 30
}
```

LLM 评估提示词并返回结构化决策（详见 [基于提示词的钩子](#基于提示词的钩子)）。

### Agent Hooks（代理型钩子）

基于子代理的验证钩子，生成专用代理来评估条件或执行复杂检查。与提示词型钩子（单轮 LLM 评估）不同，代理型钩子可以使用工具并执行多步推理。

```json
{
  "type": "agent",
  "prompt": "验证代码变更是否遵循我们的架构指南。检查相关的设计文档并进行对比。",
  "timeout": 120
}
```

**关键属性：**
- `"type": "agent"` -- 标识为代理型钩子
- `"prompt"` -- 子代理的任务描述
- 代理可以使用工具（Read、Grep、Bash 等）执行评估
- 返回与提示词型钩子类似的结构化决策

## 钩子事件

Claude Code 支持 **25 个钩子事件**：

| 事件 | 触发时机 | Matcher 输入 | 可阻塞 | 常见用途 |
|------|----------|--------------|--------|----------|
| **SessionStart** | 会话开始/恢复/清除/压缩时 | startup/resume/clear/compact | 否 | 环境设置 |
| **InstructionsLoaded** | CLAUDE.md 或规则文件加载后 | （无） | 否 | 修改/过滤指令 |
| **UserPromptSubmit** | 用户提交提示词时 | （无） | 是 | 验证提示词 |
| **PreToolUse** | 工具执行前 | 工具名称 | 是（allow/deny/ask） | 验证、修改输入 |
| **PermissionRequest** | 显示权限对话框时 | 工具名称 | 是 | 自动批准/拒绝 |
| **PostToolUse** | 工具成功执行后 | 工具名称 | 否 | 添加上下文、反馈 |
| **PostToolUseFailure** | 工具执行失败时 | 工具名称 | 否 | 错误处理、日志记录 |
| **Notification** | 发送通知时 | 通知类型 | 否 | 自定义通知 |
| **SubagentStart** | 子代理生成时 | 代理类型名称 | 否 | 子代理设置 |
| **SubagentStop** | 子代理完成时 | 代理类型名称 | 是 | 子代理验证 |
| **Stop** | Claude 响应结束时 | （无） | 是 | 任务完成检查 |
| **StopFailure** | API 错误导致回合结束时 | （无） | 否 | 错误恢复、日志记录 |
| **TeammateIdle** | 团队代理空闲时 | （无） | 是 | 代理协调 |
| **TaskCompleted** | 任务标记为完成时 | （无） | 是 | 任务后操作 |
| **TaskCreated** | 通过 TaskCreate 创建任务时 | （无） | 否 | 任务跟踪、日志记录 |
| **ConfigChange** | 配置文件更改时 | （无） | 是（策略除外） | 响应配置更新 |
| **CwdChanged** | 工作目录更改时 | （无） | 否 | 目录特定设置 |
| **FileChanged** | 监视文件更改时 | （无） | 否 | 文件监视、重新构建 |
| **PreCompact** | 上下文压缩前 | manual/auto | 否 | 压缩前操作 |
| **PostCompact** | 压缩完成后 | （无） | 否 | 压缩后操作 |
| **WorktreeCreate** | 正在创建工作树时 | （无） | 是（返回路径） | 工作树初始化 |
| **WorktreeRemove** | 正在删除工作树时 | （无） | 否 | 工作树清理 |
| **Elicitation** | MCP 服务器请求用户输入时 | （无） | 是 | 输入验证 |
| **ElicitationResult** | 用户响应征询时 | （无） | 是 | 响应处理 |
| **SessionEnd** | 会话终止时 | （无） | 否 | 清理、最终日志 |

### PreToolUse

在 Claude 创建工具参数之后、处理之前运行。使用此钩子验证或修改工具输入。

**配置：**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-bash.py"
          }
        ]
      }
    ]
  }
}
```

**常用 matchers：** `Task`、`Bash`、`Glob`、`Grep`、`Read`、`Edit`、`Write`、`WebFetch`、`WebSearch`

**输出控制：**
- `permissionDecision`: `"allow"`、`"deny"` 或 `"ask"`
- `permissionDecisionReason`: 决策说明
- `updatedInput`: 修改后的工具输入参数

### PostToolUse

在工具完成后立即运行。用于验证、日志记录或向 Claude 提供上下文反馈。

**配置：**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/security-scan.py"
          }
        ]
      }
    ]
  }
}
```

**输出控制：**
- `"block"` 决策：用反馈提示 Claude
- `additionalContext`: 添加到 Claude 的上下文

### UserPromptSubmit

在用户提交提示词时、Claude 处理之前运行。

**配置：**
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/validate-prompt.py"
          }
        ]
      }
    ]
  }
}
```

**输出控制：**
- `decision`: `"block"` 阻止处理
- `reason`: 阻止原因
- `additionalContext`: 添加到提示词的上下文

### Stop 和 SubagentStop

在 Claude 完成响应时（Stop）或子代理完成时（SubagentStop）运行。支持基于提示词的评估以进行智能任务完成检查。

**附加输入字段：** `Stop` 和 `SubagentStop` 钩子的 JSON 输入中都包含一个 `last_assistant_message` 字段，其中包含 Claude 或子代理停止前的最后一条消息。这对评估任务完成情况很有用。

**配置：**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "评估 Claude 是否完成了所有请求的任务。",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### SubagentStart

在子代理开始执行时运行。matcher 输入是代理类型名称，允许钩子针对特定子代理类型。

**配置：**
```json
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "code-review",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/subagent-init.sh"
          }
        ]
      }
    ]
  }
}
```

### SessionStart

会话开始或恢复时运行。可以持久化环境变量。

**Matchers：** `startup`、`resume`、`clear`、`compact`

**特殊功能：** 使用 `CLAUDE_ENV_FILE` 持久化环境变量（在 `CwdChanged` 和 `FileChanged` 钩子中也可用）：

```bash
#!/bin/bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export NODE_ENV=development' >> "$CLAUDE_ENV_FILE"
fi
exit 0
```

### SessionEnd

会话结束时运行以执行清理或最终日志记录。无法阻止终止。

**reason 字段值：**
- `clear` - 用户清除了会话
- `logout` - 用户登出
- `prompt_input_exit` - 用户通过提示词输入退出
- `other` - 其他原因

**配置：**
```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/session-cleanup.sh\""
          }
        ]
      }
    ]
  }
}
```

### Notification 事件

通知事件的更新 matchers：
- `permission_prompt` - 权限请求通知
- `idle_prompt` - 空闲状态通知
- `auth_success` - 认证成功
- `elicitation_dialog` - 向用户显示的对话框

## 组件作用域钩子

钩子可以附加到 frontmatter 中特定组件（skills、agents、commands）：

**在 SKILL.md、agent.md 或 command.md 中：**

```yaml
---
name: secure-operations
description: 执行带安全检查的操作
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/check.sh"
          once: true  # 每个会话仅运行一次
---
```

**组件钩子支持的事件：** `PreToolUse`、`PostToolUse`、`Stop`

这允许在与使用它们的组件中直接定义钩子，将相关代码放在一起。

### 子代理 Frontmatter 中的钩子

当在子代理的 frontmatter 中定义 `Stop` 钩子时，它会自动转换为作用域限定在该子代理的 `SubagentStop` 钩子。这确保该停止钩子仅在该特定子代理完成时触发，而不是主会话停止时。

```yaml
---
name: code-review-agent
description: 自动化代码审查子代理
hooks:
  Stop:
    - hooks:
        - type: prompt
          prompt: "验证代码审查是否彻底完整。"
  # 上述 Stop 钩子自动转换为该子代理的 SubagentStop
---
```

## PermissionRequest 事件

使用自定义输出格式处理权限请求：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow|deny",
      "updatedInput": {},
      "message": "自定义消息",
      "interrupt": false
    }
  }
}
```

## 钩子输入和输出

### JSON 输入（通过 stdin）

所有钩子通过 stdin 接收 JSON 输入：

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.js",
    "content": "..."
  },
  "tool_use_id": "toolu_01ABC123...",
  "agent_id": "agent-abc123",
  "agent_type": "main",
  "worktree": "/path/to/worktree"
}
```

**常见字段：**

| 字段 | 说明 |
|------|------|
| `session_id` | 唯一会话标识符 |
| `transcript_path` | 对话记录文件路径 |
| `cwd` | 当前工作目录 |
| `hook_event_name` | 触发钩子的事件名称 |
| `agent_id` | 运行此钩子的代理标识符 |
| `agent_type` | 代理类型（`"main"`、子代理类型名称等） |
| `worktree` | git 工作树路径（如果代理正在其中运行） |

### 退出码

| 退出码 | 含义 | 行为 |
|--------|------|------|
| **0** | 成功 | 继续，解析 JSON stdout |
| **2** | 阻塞错误 | 阻止操作，stderr 显示为错误 |
| **其他** | 非阻塞错误 | 继续，stderr 在详细模式下显示 |

### JSON 输出（stdout，退出码 0）

```json
{
  "continue": true,
  "stopReason": "停止时的可选消息",
  "suppressOutput": false,
  "systemMessage": "可选警告消息",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "文件在允许的目录中",
    "updatedInput": {
      "file_path": "/modified/path.js"
    }
  }
}
```

## 环境变量

| 变量 | 可用性 | 说明 |
|------|--------|------|
| `CLAUDE_PROJECT_DIR` | 所有钩子 | 项目根目录的绝对路径 |
| `CLAUDE_ENV_FILE` | SessionStart、CwdChanged、FileChanged | 用于持久化环境变量的文件路径 |
| `CLAUDE_CODE_REMOTE` | 所有钩子 | 在远程环境中运行时为 `"true"` |
| `${CLAUDE_PLUGIN_ROOT}` | 插件钩子 | 插件目录路径 |
| `${CLAUDE_PLUGIN_DATA}` | 插件钩子 | 插件数据目录路径 |
| `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` | SessionEnd 钩子 | SessionEnd 钩子的可配置超时（毫秒），可覆盖默认值 |

## 基于提示词的钩子

对于 `Stop` 和 `SubagentStop` 事件，可以使用基于 LLM 的评估：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "检查所有任务是否完成。返回你的决定。",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**LLM 响应架构：**
```json
{
  "decision": "approve",
  "reason": "所有任务成功完成",
  "continue": false,
  "stopReason": "任务完成"
}
```

## 示例

### 示例 1：Bash 命令验证器（PreToolUse）

**文件：** `.claude/hooks/validate-bash.py`

```python
#!/usr/bin/env python3
import json
import sys
import re

BLOCKED_PATTERNS = [
    (r"\brm\s+-rf\s+/", "阻止危险的 rm -rf / 命令"),
    (r"\bsudo\s+rm", "阻止 sudo rm 命令"),
]

def main():
    input_data = json.load(sys.stdin)

    tool_name = input_data.get("tool_name", "")
    if tool_name != "Bash":
        sys.exit(0)

    command = input_data.get("tool_input", {}).get("command", "")

    for pattern, message in BLOCKED_PATTERNS:
        if re.search(pattern, command):
            print(message, file=sys.stderr)
            sys.exit(2)  # 退出码 2 = 阻塞错误

    sys.exit(0)

if __name__ == "__main__":
    main()
```

**配置：**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate-bash.py\""
          }
        ]
      }
    ]
  }
}
```

### 示例 2：安全扫描器（PostToolUse）

**文件：** `.claude/hooks/security-scan.py`

```python
#!/usr/bin/env python3
import json
import sys
import re

SECRET_PATTERNS = [
    (r"password\s*=\s*['\"][^'\"]+['\"]", "可能的硬编码密码"),
    (r"api[_-]?key\s*=\s*['\"][^'\"]+['\"]", "可能的硬编码 API 密钥"),
]

def main():
    input_data = json.load(sys.stdin)

    tool_name = input_data.get("tool_name", "")
    if tool_name not in ["Write", "Edit"]:
        sys.exit(0)

    tool_input = input_data.get("tool_input", {})
    content = tool_input.get("content", "") or tool_input.get("new_string", "")
    file_path = tool_input.get("file_path", "")

    warnings = []
    for pattern, message in SECRET_PATTERNS:
        if re.search(pattern, content, re.IGNORECASE):
            warnings.append(message)

    if warnings:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"文件 {file_path} 的安全警告: " + "; ".join(warnings)
            }
        }
        print(json.dumps(output))

    sys.exit(0)

if __name__ == "__main__":
    main()
```

### 示例 3：自动格式化代码（PostToolUse）

**文件：** `.claude/hooks/format-code.sh`

```bash
#!/bin/bash

# 从 stdin 读取 JSON
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('tool_name', ''))")
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('tool_input', {}).get('file_path', ''))")

if [ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ]; then
    exit 0
fi

# 根据文件扩展名格式化
case "$FILE_PATH" in
    *.js|*.jsx|*.ts|*.tsx|*.json)
        command -v prettier &>/dev/null && prettier --write "$FILE_PATH" 2>/dev/null
        ;;
    *.py)
        command -v black &>/dev/null && black "$FILE_PATH" 2>/dev/null
        ;;
    *.go)
        command -v gofmt &>/dev/null && gofmt -w "$FILE_PATH" 2>/dev/null
        ;;
esac

exit 0
```

### 示例 4：提示词验证器（UserPromptSubmit）

**文件：** `.claude/hooks/validate-prompt.py`

```python
#!/usr/bin/env python3
import json
import sys
import re

BLOCKED_PATTERNS = [
    (r"delete\s+(all\s+)?database", "危险操作：数据库删除"),
    (r"rm\s+-rf\s+/", "危险操作：根目录删除"),
]

def main():
    input_data = json.load(sys.stdin)
    prompt = input_data.get("user_prompt", "") or input_data.get("prompt", "")

    for pattern, message in BLOCKED_PATTERNS:
        if re.search(pattern, prompt, re.IGNORECASE):
            output = {
                "decision": "block",
                "reason": f"已阻止: {message}"
            }
            print(json.dumps(output))
            sys.exit(0)

    sys.exit(0)

if __name__ == "__main__":
    main()
```

### 示例 5：智能 Stop 钩子（基于提示词）

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "检查 Claude 是否完成了所有请求的任务。检查：1) 是否所有文件都已创建/修改？2) 是否有未解决的错误？如果不完整，请说明缺少的内容。",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### 示例 6：上下文用量追踪器（钩子对）

使用 `UserPromptSubmit`（消息前）和 `Stop`（消息后）钩子配合，追踪每个请求的 Token 消耗量。

**文件：** `.claude/hooks/context-tracker.py`

```python
#!/usr/bin/env python3
"""
上下文用量追踪器 - 追踪每个请求的 Token 消耗量。

使用 UserPromptSubmit 作为"消息前"钩子，Stop 作为"消息后"钩子，
来计算每个请求的 Token 使用增量。

Token 计数方法：
1. 字符估算（默认）：约每 4 个字符对应 1 个 Token，无依赖
2. tiktoken（可选）：更准确（约 90-95%），需要：pip install tiktoken
"""
import json
import os
import sys
import tempfile

# 配置
CONTEXT_LIMIT = 128000  # Claude 的上下文窗口（请根据你的模型调整）
USE_TIKTOKEN = False    # 如已安装 tiktoken 且需更高精度，设为 True


def get_state_file(session_id: str) -> str:
    """获取临时文件路径，用于存储会话隔离的消息前 Token 计数。"""
    return os.path.join(tempfile.gettempdir(), f"claude-context-{session_id}.json")


def count_tokens(text: str) -> int:
    """
    计算文本中的 Token 数量。

    如果 tiktoken 可用则使用 p50k_base 编码（约 90-95% 准确度），
    否则回退到字符估算（约 80-90% 准确度）。
    """
    if USE_TIKTOKEN:
        try:
            import tiktoken
            enc = tiktoken.get_encoding("p50k_base")
            return len(enc.encode(text))
        except ImportError:
            pass  # 回退到估算

    # 字符估算：英文约每 4 个字符对应 1 个 Token
    return len(text) // 4


def read_transcript(transcript_path: str) -> str:
    """读取并拼接转录文件中的所有内容。"""
    if not transcript_path or not os.path.exists(transcript_path):
        return ""

    content = []
    with open(transcript_path, "r") as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                # 从各种消息格式中提取文本内容
                if "message" in entry:
                    msg = entry["message"]
                    if isinstance(msg.get("content"), str):
                        content.append(msg["content"])
                    elif isinstance(msg.get("content"), list):
                        for block in msg["content"]:
                            if isinstance(block, dict) and block.get("type") == "text":
                                content.append(block.get("text", ""))
            except json.JSONDecodeError:
                continue

    return "\n".join(content)


def handle_user_prompt_submit(data: dict) -> None:
    """消息前钩子：在请求前保存当前 Token 数量。"""
    session_id = data.get("session_id", "unknown")
    transcript_path = data.get("transcript_path", "")

    transcript_content = read_transcript(transcript_path)
    current_tokens = count_tokens(transcript_content)

    # 保存到临时文件以便后续比较
    state_file = get_state_file(session_id)
    with open(state_file, "w") as f:
        json.dump({"pre_tokens": current_tokens}, f)


def handle_stop(data: dict) -> None:
    """消息后钩子：计算并报告 Token 增量。"""
    session_id = data.get("session_id", "unknown")
    transcript_path = data.get("transcript_path", "")

    transcript_content = read_transcript(transcript_path)
    current_tokens = count_tokens(transcript_content)

    # 加载消息前的计数
    state_file = get_state_file(session_id)
    pre_tokens = 0
    if os.path.exists(state_file):
        try:
            with open(state_file, "r") as f:
                state = json.load(f)
                pre_tokens = state.get("pre_tokens", 0)
        except (json.JSONDecodeError, IOError):
            pass

    # 计算增量
    delta_tokens = current_tokens - pre_tokens
    remaining = CONTEXT_LIMIT - current_tokens
    percentage = (current_tokens / CONTEXT_LIMIT) * 100

    # 报告用量
    method = "tiktoken" if USE_TIKTOKEN else "估算"
    print(f"上下文（{method}）: 约 {current_tokens:,} 个 Token（已使用 {percentage:.1f}%，约剩 {remaining:,} 个）", file=sys.stderr)
    if delta_tokens > 0:
        print(f"本次请求: 约 {delta_tokens:,} 个 Token", file=sys.stderr)


def main():
    data = json.load(sys.stdin)
    event = data.get("hook_event_name", "")

    if event == "UserPromptSubmit":
        handle_user_prompt_submit(data)
    elif event == "Stop":
        handle_stop(data)

    sys.exit(0)


if __name__ == "__main__":
    main()
```

**配置：**
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/context-tracker.py\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/context-tracker.py\""
          }
        ]
      }
    ]
  }
}
```

**工作原理：**
1. `UserPromptSubmit` 在处理提示词前触发 - 保存当前 Token 数量
2. `Stop` 在 Claude 响应后触发 - 计算增量并报告用量
3. 每个会话通过 temp 文件名中的 `session_id` 实现隔离

**Token 计数方法：**

| 方法 | 准确度 | 依赖 | 速度 |
|------|--------|------|------|
| 字符估算 | 约 80-90% | 无 | <1ms |
| tiktoken (p50k_base) | 约 90-95% | `pip install tiktoken` | <10ms |

> **注意：** Anthropic 尚未发布官方的离线分词器。两种方法都是近似值。转录内容包含用户提示词、Claude 的响应和工具输出，但不包含系统提示词或内部上下文。

### 示例 7：自动模式权限播种脚本（一劳永逸的设置脚本）

一个一次性设置脚本，用约 67 条安全权限规则播种 `~/.claude/settings.json`，相当于 Claude Code 自动模式基线——无需任何钩子，无需记住未来的选择。运行一次即可；可安全重复运行（跳过已存在的规则）。

**文件：** `09-advanced-features/setup-auto-mode-permissions.py`

```bash
# 预览将要添加的内容
python3 09-advanced-features/setup-auto-mode-permissions.py --dry-run

# 应用
python3 09-advanced-features/setup-auto-mode-permissions.py
```

**添加的内容：**

| 类别 | 示例 |
|------|------|
| 内置工具 | `Read(*)`、`Edit(*)`、`Write(*)`、`Glob(*)`、`Grep(*)`、`Agent(*)`、`WebSearch(*)` |
| Git 读取 | `Bash(git status:*)`、`Bash(git log:*)`、`Bash(git diff:*)` |
| Git 写入（本地） | `Bash(git add:*)`、`Bash(git commit:*)`、`Bash(git checkout:*)` |
| 包管理器 | `Bash(npm install:*)`、`Bash(pip install:*)`、`Bash(cargo build:*)` |
| 构建和测试 | `Bash(make:*)`、`Bash(pytest:*)`、`Bash(go test:*)` |
| 常用 Shell | `Bash(ls:*)`、`Bash(cat:*)`、`Bash(find:*)`、`Bash(cp:*)`、`Bash(mv:*)` |
| GitHub CLI | `Bash(gh pr view:*)`、`Bash(gh pr create:*)`、`Bash(gh issue list:*)` |

**有意排除的内容**（此脚本永远不会添加）：
- `rm -rf`、`sudo`、强制推送、`git reset --hard`
- `DROP TABLE`、`kubectl delete`、`terraform destroy`
- `npm publish`、`curl | bash`、生产环境部署

## 插件钩子

插件可以在其 `hooks/hooks.json` 文件中包含钩子：

**文件：** `plugins/hooks/hooks.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/validate.sh"
          }
        ]
      }
    ]
  }
}
```

**插件钩子中的环境变量：**
- `${CLAUDE_PLUGIN_ROOT}` - 插件目录路径
- `${CLAUDE_PLUGIN_DATA}` - 插件数据目录路径

这允许插件包含自定义验证和自动化钩子。

## MCP 工具钩子

MCP 工具遵循模式 `mcp__<服务器>__<工具>`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__memory__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"systemMessage\": \"Memory 操作已记录\"}'"
          }
        ]
      }
    ]
  }
}
```

## 安全注意事项

### 免责声明

**风险自担**：钩子执行任意 Shell 命令。你需要独自负责：
- 你配置的命令
- 文件访问/修改权限
- 潜在的数据丢失或系统损坏
- 在生产环境使用前在安全环境中测试钩子

### 安全说明

- **需要工作区信任：** `statusLine` 和 `fileSuggestion` 钩子输出中的命令现在需要工作区信任接受后才能生效。
- **HTTP 钩子和环境变量：** HTTP 钩子需要显式的 `allowedEnvVars` 列表才能在 URL 中使用环境变量插值。这防止了敏感环境变量意外泄露到远程端点。
- **托管设置层次结构：** `disableAllHooks` 设置现在遵循托管设置层次结构，意味着组织级设置可以强制执行钩子禁用，个别用户无法覆盖。

### 最佳实践

| 应该做 | 不应该做 |
|--------|----------|
| 验证并清理所有输入 | 盲目信任输入数据 |
| 用引号包裹 Shell 变量：`"$VAR"` | 不使用引号：`$VAR` |
| 阻止路径遍历（`..`） | 允许任意路径 |
| 使用 `$CLAUDE_PROJECT_DIR` 的绝对路径 | 硬编码路径 |
| 跳过敏感文件（`.env`、`.git/`、密钥） | 处理所有文件 |
| 先隔离测试钩子 | 部署未经测试的钩子 |
| HTTP 钩子使用显式 `allowedEnvVars` | 将所有环境变量暴露给 Webhook |

## 调试

### 启用调试模式

使用调试标志运行 Claude 以获取详细的钩子日志：

```bash
claude --debug
```

### 详细模式

在 Claude Code 中使用 `Ctrl+O` 启用详细模式，查看钩子执行进度。

### 独立测试钩子

```bash
# 使用示例 JSON 输入进行测试
echo '{"tool_name": "Bash", "tool_input": {"command": "ls -la"}}' | python3 .claude/hooks/validate-bash.py

# 检查退出码
echo $?
```

## 完整配置示例

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate-bash.py\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/format-code.sh\"",
            "timeout": 30
          },
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/security-scan.py\"",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate-prompt.py\""
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/session-init.sh\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "在停止前验证所有任务是否完成。",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## 钩子执行细节

| 方面 | 行为 |
|------|------|
| **超时** | 默认 60 秒，可按命令配置 |
| **并行化** | 所有匹配的钩子并行运行 |
| **去重** | 相同钩子命令去重 |
| **环境** | 在 Claude Code 的当前目录和环境下运行 |

## 故障排除

### 钩子未执行
- 验证 JSON 配置语法正确
- 检查 matcher 模式是否匹配工具名称
- 确保脚本存在且可执行：`chmod +x script.sh`
- 运行 `claude --debug` 查看钩子执行日志
- 验证钩子从 stdin 读取 JSON（不是命令参数）

### 钩子意外阻止
- 用示例 JSON 测试钩子：`echo '{"tool_name": "Write", ...}' | ./hook.py`
- 检查退出码：允许应为 0，阻止应为 2
- 检查 stderr 输出（退出码 2 时显示）

### JSON 解析错误
- 始终从 stdin 读取，不要用命令参数
- 使用正确的 JSON 解析（不是字符串操作）
- 优雅地处理缺失字段

## 安装

### 第一步：创建钩子目录
```bash
mkdir -p ~/.claude/hooks
```

### 第二步：复制示例钩子
```bash
cp 06-hooks/*.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/*.sh
```

### 第三步：在设置中配置
在 `~/.claude/settings.json` 或 `.claude/settings.json` 中编辑上面显示的钩子配置。

## 相关概念

- **[检查点和回退](../08-checkpoints/)** - 保存和恢复对话状态
- **[斜杠命令](../01-slash-commands/)** - 创建自定义斜杠命令
- **[Skills](../03-skills/)** - 可重用的自主能力
- **[子代理](../04-subagents/)** - 委托任务执行
- **[插件](../07-plugins/)** - 打包的扩展包
- **[高级功能](../09-advanced-features/)** - 探索 Claude Code 高级功能

## 其他资源

- **[官方钩子文档](https://code.claude.com/docs/en/hooks)** - 完整的钩子参考
- **[CLI 参考](https://code.claude.com/docs/en/cli-reference)** - 命令行接口文档
- **[Memory 指南](../02-memory/)** - 持久上下文配置
