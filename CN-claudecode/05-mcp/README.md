<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../resources/logos/claude-howto-logo-dark.svg">
  <img alt="Claude How To" src="../resources/logos/claude-howto-logo.svg">
</picture>

# MCP（Model Context Protocol，模型上下文协议）

本模块包含 MCP 服务器配置和 Claude Code 使用方法的完整文档和示例。

## 概述

MCP（Model Context Protocol，模型上下文协议）是一种标准化方式，使 Claude 能够访问外部工具、API 和实时数据源。与 Memory 不同，MCP 提供对变化数据的实时访问能力。

主要特点：
- 实时访问外部服务
- 实时数据同步
- 可扩展的架构
- 安全认证
- 基于工具的交互

## MCP 架构

```mermaid
graph TB
    A["Claude"]
    B["MCP 服务器"]
    C["外部服务"]

    A -->|请求: list_issues| B
    B -->|查询| C
    C -->|数据| B
    B -->|响应| A

    A -->|请求: create_issue| B
    B -->|操作| C
    C -->|结果| B
    B -->|响应| A

    style A fill:#e1f5fe,stroke:#333,color:#333
    style B fill:#f3e5f5,stroke:#333,color:#333
    style C fill:#e8f5e9,stroke:#333,color:#333
```

## MCP 生态系统

```mermaid
graph TB
    A["Claude"] -->|MCP| B["文件系统<br/>MCP 服务器"]
    A -->|MCP| C["GitHub<br/>MCP 服务器"]
    A -->|MCP| D["数据库<br/>MCP 服务器"]
    A -->|MCP| E["Slack<br/>MCP 服务器"]
    A -->|MCP| F["Google Docs<br/>MCP 服务器"]

    B -->|文件 I/O| G["本地文件"]
    C -->|API| H["GitHub 仓库"]
    D -->|查询| I["PostgreSQL/MySQL"]
    E -->|消息| J["Slack 工作区"]
    F -->|文档| K["Google Drive"]

    style A fill:#e1f5fe,stroke:#333,color:#333
    style B fill:#f3e5f5,stroke:#333,color:#333
    style C fill:#f3e5f5,stroke:#333,color:#333
    style D fill:#f3e5f5,stroke:#333,color:#333
    style E fill:#f3e5f5,stroke:#333,color:#333
    style F fill:#f3e5f5,stroke:#333,color:#333
    style G fill:#e8f5e9,stroke:#333,color:#333
    style H fill:#e8f5e9,stroke:#333,color:#333
    style I fill:#e8f5e9,stroke:#333,color:#333
    style J fill:#e8f5e9,stroke:#333,color:#333
    style K fill:#e8f5e9,stroke:#333,color:#333
```

## MCP 安装方式

Claude Code 支持多种传输协议来连接 MCP 服务器：

### HTTP 传输（推荐）

```bash
# 基础 HTTP 连接
claude mcp add --transport http notion https://mcp.notion.com/mcp

# 带认证头的 HTTP
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

### Stdio 传输（本地）

适用于本地运行的 MCP 服务器：

```bash
# 本地 Node.js 服务器
claude mcp add --transport stdio myserver -- npx @myorg/mcp-server

# 带环境变量
claude mcp add --transport stdio myserver --env KEY=value -- npx server
```

### SSE 传输（已弃用）

Server-Sent Events 传输已被弃用，以 `http` 代替，但仍受支持：

```bash
claude mcp add --transport sse legacy-server https://example.com/sse
```

### WebSocket 传输

适用于持久双向连接的 WebSocket 传输：

```bash
claude mcp add --transport ws realtime-server wss://example.com/mcp
```

### Windows 特定说明

在原生 Windows（而非 WSL）环境下，对 npx 命令使用 `cmd /c`：

```bash
claude mcp add --transport stdio my-server -- cmd /c npx -y @some/package
```

### OAuth 2.0 认证

Claude Code 支持对需要 OAuth 认证的 MCP 服务器的 OAuth 2.0 连接。连接到启用 OAuth 的服务器时，Claude Code 会处理整个认证流程：

```bash
# 连接到启用 OAuth 的 MCP 服务器（交互式流程）
claude mcp add --transport http my-service https://my-service.example.com/mcp

# 预配置 OAuth 凭证以实现非交互式设置
claude mcp add --transport http my-service https://my-service.example.com/mcp \
  --client-id "your-client-id" \
  --client-secret "your-client-secret" \
  --callback-port 8080
```

| 功能 | 说明 |
|------|------|
| **交互式 OAuth** | 使用 `/mcp` 触发基于浏览器的 OAuth 流程 |
| **预配置 OAuth 客户端** | 内置对 Notion、Stripe 等常见服务的 OAuth 客户端（v2.1.30+） |
| **预配置凭证** | `--client-id`、`--client-secret`、`--callback-port` 标志用于自动化设置 |
| **Token 存储** | Token 安全存储在系统密钥链中 |
| **Step-up 认证** | 支持特权操作的升级认证 |
| **发现缓存** | OAuth 发现元数据会被缓存以加快重新连接速度 |
| **元数据覆盖** | `.mcp.json` 中的 `oauth.authServerMetadataUrl` 可覆盖默认 OAuth 元数据发现 |

#### 覆盖 OAuth 元数据发现

如果 MCP 服务器在标准 OAuth 元数据端点（`/.well-known/oauth-authorization-server`）上返回错误，但暴露了一个可用的 OIDC 端点，则可以告诉 Claude Code 从特定 URL 获取 OAuth 元数据。在服务器配置的 `oauth` 对象中设置 `authServerMetadataUrl`：

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "authServerMetadataUrl": "https://auth.example.com/.well-known/openid-configuration"
      }
    }
  }
}
```

URL 必须使用 `https://`。此选项需要 Claude Code v2.1.64 或更高版本。

### Claude.ai MCP 连接器

在 Claude.ai 账户中配置的 MCP 服务器会自动在 Claude Code 中可用。这意味着你在 Claude.ai 网页界面中设置的任何 MCP 连接都无需额外配置即可在 Claude Code 中访问。

Claude.ai MCP 连接器也可在 `--print` 模式下使用（v2.1.83+），支持非交互式和脚本化使用。

要在 Claude Code 中禁用 Claude.ai MCP 服务器，请将 `ENABLE_CLAUDEAI_MCP_SERVERS` 环境变量设置为 `false`：

```bash
ENABLE_CLAUDEAI_MCP_SERVERS=false claude
```

> **注意：** 此功能仅对使用 Claude.ai 账户登录的用户可用。

## MCP 设置流程

```mermaid
sequenceDiagram
    participant 用户
    participant Claude as Claude Code
    participant 配置 as 配置文件
    participant 服务 as 外部服务

    用户->>Claude: 输入 /mcp
    Claude->>Claude: 列出可用的 MCP 服务器
    Claude->>用户: 显示选项
    用户->>Claude: 选择 GitHub MCP
    Claude->>配置: 更新配置
    配置->>Claude: 激活连接
    Claude->>服务: 测试连接
    服务-->>Claude: 认证成功
    Claude->>用户: ✅ MCP 已连接！
```

## MCP 工具搜索

当 MCP 工具描述超过上下文窗口的 10% 时，Claude Code 会自动启用工具搜索，以高效选择正确的工具，同时不会使模型上下文过载。

| 设置 | 值 | 说明 |
|------|-----|------|
| `ENABLE_TOOL_SEARCH` | `auto`（默认） | 当工具描述超过上下文的 10% 时自动启用 |
| `ENABLE_TOOL_SEARCH` | `auto:<N>` | 在自定义阈值 `N` 个工具时自动启用 |
| `ENABLE_TOOL_SEARCH` | `true` | 不论工具数量如何始终启用 |
| `ENABLE_TOOL_SEARCH` | `false` | 禁用；所有工具描述完整发送 |

> **注意：** 工具搜索需要 Sonnet 4 或更高版本，或 Opus 4 或更高版本。Haiku 模型不支持工具搜索。

## 动态工具更新

Claude Code 支持 MCP 的 `list_changed` 通知。当 MCP 服务器动态添加、移除或修改其可用工具时，Claude Code 会收到更新并自动调整其工具列表——无需重新连接或重启。

## MCP 征询（Elicitation）

MCP 服务器可以通过交互式对话框（v2.1.49+）向用户请求结构化输入。这允许 MCP 服务器在工作流中途请求额外信息——例如，提示用户确认、从选项列表中选择，或填写必填字段——为 MCP 服务器交互增添了互动性。

## 工具描述和说明上限

从 v2.1.84 起，Claude Code 对每个 MCP 服务器的工具描述和说明强制执行 **2 KB 上限**。这防止了单个服务器通过过于冗长的工具定义消耗过多上下文，减少了上下文膨胀并保持了交互效率。

## MCP 提示词作为斜杠命令

MCP 服务器可以暴露提示词（Prompts），这些提示词在 Claude Code 中以斜杠命令的形式出现。提示词可通过以下命名约定访问：

```
/mcp__<服务器名>__<提示词名>
```

例如，如果一个名为 `github` 的服务器暴露了一个名为 `review` 的提示词，你可以将其调用为 `/mcp__github__review`。

## 服务器去重

当同一 MCP 服务器在多个作用域（本地、项目、用户）中定义时，本地配置优先。这允许你用本地自定义覆盖项目级或用户级的 MCP 设置，而不会产生冲突。

## 通过 @ 引用 MCP 资源

你可以使用 `@` 引用语法直接在提示词中引用 MCP 资源：

```
@服务器名:protocol://资源/路径
```

例如，引用特定的数据库资源：

```
@database:postgres://mydb/users
```

这允许 Claude 获取并内联包含 MCP 资源内容作为对话上下文的一部分。

## MCP 作用域

MCP 配置可以存储在不同共享级别的工作域中：

| 作用域 | 位置 | 说明 | 共享对象 | 需要批准 |
|--------|------|------|----------|----------|
| **本地**（默认） | `~/.claude.json`（项目路径下） | 仅当前用户、当前项目专用（旧版本称 `project`） | 仅你自己 | 否 |
| **项目** | `.mcp.json` | 纳入 git 版本控制 | 团队成员 | 是（首次使用） |
| **用户** | `~/.claude.json` | 在所有项目中可用（旧版本称 `global`） | 仅你自己 | 否 |

### 使用项目作用域

在 `.mcp.json` 中存储项目专用的 MCP 配置：

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp"
    }
  }
}
```

团队成员在首次使用项目 MCP 时会看到批准提示。

## MCP 配置管理

### 添加 MCP 服务器

```bash
# 添加基于 HTTP 的服务器
claude mcp add --transport http github https://api.github.com/mcp

# 添加本地 stdio 服务器
claude mcp add --transport stdio database -- npx @company/db-server

# 列出所有 MCP 服务器
claude mcp list

# 获取特定服务器的详细信息
claude mcp get github

# 移除一个 MCP 服务器
claude mcp remove github

# 重置项目级别的批准选择
claude mcp reset-project-choices

# 从 Claude Desktop 导入
claude mcp add-from-claude-desktop
```

## 常用 MCP 服务器一览

| MCP 服务器 | 用途 | 常用工具 | 认证方式 | 实时性 |
|------------|------|----------|----------|--------|
| **Filesystem** | 文件操作 | read, write, delete | OS 权限 | ✅ 是 |
| **GitHub** | 仓库管理 | list_prs, create_issue, push | OAuth | ✅ 是 |
| **Slack** | 团队沟通 | send_message, list_channels | Token | ✅ 是 |
| **Database** | SQL 查询 | query, insert, update | 凭证 | ✅ 是 |
| **Google Docs** | 文档访问 | read, write, share | OAuth | ✅ 是 |
| **Asana** | 项目管理 | create_task, update_status | API Key | ✅ 是 |
| **Stripe** | 支付数据 | list_charges, create_invoice | API Key | ✅ 是 |
| **Memory** | 持久记忆 | store, retrieve, delete | 本地 | ❌ 否 |

## 实践示例

### 示例 1：GitHub MCP 配置

**文件：** `.mcp.json`（项目根目录）

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**可用的 GitHub MCP 工具：**

#### 拉取请求管理
- `list_prs` - 列出仓库中所有 PR
- `get_pr` - 获取 PR 详情（包括 diff）
- `create_pr` - 创建新 PR
- `update_pr` - 更新 PR 描述/标题
- `merge_pr` - 合并 PR 到主分支
- `review_pr` - 添加评审评论

**示例请求：**
```
/mcp__github__get_pr 456

# 返回：
标题: 添加深色模式支持
作者: @alice
描述: 使用 CSS 变量实现深色主题
状态: OPEN
评审人: @bob, @charlie
```

#### Issue 管理
- `list_issues` - 列出所有 issue
- `get_issue` - 获取 issue 详情
- `create_issue` - 创建新 issue
- `close_issue` - 关闭 issue
- `add_comment` - 添加评论

#### 仓库信息
- `get_repo_info` - 仓库详情
- `list_files` - 文件树结构
- `get_file_content` - 读取文件内容
- `search_code` - 搜索代码库

#### 提交操作
- `list_commits` - 提交历史
- `get_commit` - 特定提交详情
- `create_commit` - 创建新提交

**设置：**
```bash
export GITHUB_TOKEN="your_github_token"
# 或直接使用 CLI 添加：
claude mcp add --transport stdio github -- npx @modelcontextprotocol/server-github
```

### 配置中的环境变量展开

MCP 配置支持带备用默认值的环境变量展开。`${VAR}` 和 `${VAR:-default}` 语法适用于以下字段：`command`、`args`、`env`、`url` 和 `headers`。

```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}",
        "X-Custom-Header": "${CUSTOM_HEADER:-default-value}"
      }
    },
    "local-server": {
      "command": "${MCP_BIN_PATH:-npx}",
      "args": ["${MCP_PACKAGE:-@company/mcp-server}"],
      "env": {
        "DB_URL": "${DATABASE_URL:-postgresql://localhost/dev}"
      }
    }
  }
}
```

变量在运行时展开：
- `${VAR}` - 使用环境变量，如未设置则报错
- `${VAR:-default}` - 使用环境变量，如未设置则使用默认值

### 示例 2：数据库 MCP 设置

**配置：**

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-database"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost/mydb"
      }
    }
  }
}
```

**使用示例：**

```markdown
用户：获取订单数超过 10 的所有用户

Claude：我来查询你的数据库以找到该信息。

# 使用 MCP 数据库工具：
SELECT u.*, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id
HAVING COUNT(o.id) > 10
ORDER BY order_count DESC;

# 结果：
- Alice: 15 个订单
- Bob: 12 个订单
- Charlie: 11 个订单
```

**设置：**
```bash
export DATABASE_URL="postgresql://user:pass@localhost/mydb"
# 或直接使用 CLI 添加：
claude mcp add --transport stdio database -- npx @modelcontextprotocol/server-database
```

### 示例 3：多 MCP 工作流

**场景：每日报告生成**

```markdown
# 使用多个 MCP 的每日报告工作流

## 设置
1. GitHub MCP - 获取 PR 指标
2. Database MCP - 查询销售数据
3. Slack MCP - 发布报告
4. Filesystem MCP - 保存报告

## 工作流

### 步骤 1：获取 GitHub 数据
/mcp__github__list_prs completed:true last:7days

输出：
- PR 总数: 42
- 平均合并时间: 2.3 小时
- 评审周转时间: 1.1 小时

### 步骤 2：查询数据库
SELECT COUNT(*) as sales, SUM(amount) as revenue
FROM orders
WHERE created_at > NOW() - INTERVAL '1 day'

输出：
- 销售额: 247
- 收入: $12,450

### 步骤 3：生成报告
将数据合并为 HTML 报告

### 步骤 4：保存到文件系统
将 report.html 写入 /reports/

### 步骤 5：发布到 Slack
向 #daily-reports 频道发送摘要

最终输出：
✅ 报告已生成并发布
📊 本周合并了 47 个 PR
💰 每日销售额 $12,450
```

**设置：**
```bash
export GITHUB_TOKEN="your_github_token"
export DATABASE_URL="postgresql://user:pass@localhost/mydb"
export SLACK_TOKEN="your_slack_token"
# 通过 CLI 或在 .mcp.json 中配置来添加各个 MCP 服务器
```

### 示例 4：文件系统 MCP 操作

**配置：**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/home/user/projects"]
    }
  }
}
```

**可用操作：**

| 操作 | 命令 | 用途 |
|------|------|------|
| 列出文件 | `ls ~/projects` | 显示目录内容 |
| 读取文件 | `cat src/main.ts` | 读取文件内容 |
| 写入文件 | `create docs/api.md` | 创建新文件 |
| 编辑文件 | `edit src/app.ts` | 修改文件 |
| 搜索 | `grep "async function"` | 在文件中搜索 |
| 删除 | `rm old-file.js` | 删除文件 |

**设置：**
```bash
# 直接使用 CLI 添加：
claude mcp add --transport stdio filesystem -- npx @modelcontextprotocol/server-filesystem /home/user/projects
```

## MCP 与 Memory：决策矩阵

```mermaid
graph TD
    A["需要外部数据？"]
    A -->|否| B["使用 Memory"]
    A -->|是| C["数据频繁变化？"]
    C -->|否/很少| B
    C -->|是/经常| D["使用 MCP"]

    B -->|存储| E["偏好设置<br/>上下文<br/>历史记录"]
    D -->|访问| F["实时 API<br/>数据库<br/>服务"]

    style A fill:#fff3e0,stroke:#333,color:#333
    style B fill:#e1f5fe,stroke:#333,color:#333
    style C fill:#fff3e0,stroke:#333,color:#333
    style D fill:#f3e5f5,stroke:#333,color:#333
    style E fill:#e8f5e9,stroke:#333,color:#333
    style F fill:#e8f5e9,stroke:#333,color:#333
```

## 请求/响应模式

```mermaid
sequenceDiagram
    participant 应用 as Claude
    participant MCP as MCP 服务器
    participant DB as 数据库

    应用->>MCP: 请求: "SELECT * FROM users WHERE id=1"
    MCP->>DB: 执行查询
    DB-->>MCP: 结果集
    MCP-->>应用: 返回解析后的数据
    应用->>应用: 处理结果
    应用->>应用: 继续任务

    Note over MCP,DB: 实时访问<br/>无缓存
```

## 环境变量

将敏感凭证存储在环境变量中：

```bash
# ~/.bashrc 或 ~/.zshrc
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxx"
export DATABASE_URL="postgresql://user:pass@localhost/mydb"
export SLACK_TOKEN="xoxb-xxxxxxxxxxxxx"
```

然后在 MCP 配置中引用：

```json
{
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  }
}
```

## Claude 作为 MCP 服务器（`claude mcp serve`）

Claude Code 本身可以作为其他应用程序的 MCP 服务器。这使得外部工具、编辑器和自动化系统能够通过标准 MCP 协议利用 Claude 的能力。

```bash
# 在 stdio 上启动 Claude Code 作为 MCP 服务器
claude mcp serve
```

其他应用程序可以像连接任何基于 stdio 的 MCP 服务器一样连接到此服务器。例如，要在另一个 Claude Code 实例中将 Claude Code 添加为 MCP 服务器：

```bash
claude mcp add --transport stdio claude-agent -- claude mcp serve
```

这对于构建多代理工作流非常有用，其中一个 Claude 实例编排另一个。

## 托管 MCP 配置（企业版）

对于企业部署，IT 管理员可以通过 `managed-mcp.json` 配置文件强制执行 MCP 服务器策略。该文件提供了对组织范围内允许或阻止哪些 MCP 服务器的完全控制。

**位置：**
- macOS: `/Library/Application Support/ClaudeCode/managed-mcp.json`
- Linux: `~/.config/ClaudeCode/managed-mcp.json`
- Windows: `%APPDATA%\ClaudeCode\managed-mcp.json`

**功能：**
- `allowedMcpServers` —— 允许列表
- `deniedMcpServers` —— 拒绝列表
- 支持按服务器名称、命令和 URL 模式匹配
- 在用户配置之前强制执行组织范围的 MCP 策略
- 防止未授权的服务器连接

**配置示例：**

```json
{
  "allowedMcpServers": [
    {
      "serverName": "github",
      "serverUrl": "https://api.github.com/mcp"
    },
    {
      "serverName": "company-internal",
      "serverCommand": "company-mcp-server"
    }
  ],
  "deniedMcpServers": [
    {
      "serverName": "untrusted-*"
    },
    {
      "serverUrl": "http://*"
    }
  ]
}
```

> **注意：** 当 `allowedMcpServers` 和 `deniedMcpServers` 同时匹配一个服务器时，拒绝规则优先。

## 插件提供的 MCP 服务器

插件可以打包自己的 MCP 服务器，在安装插件时自动使其可用。插件提供的 MCP 服务器可以通过两种方式定义：

1. **独立的 `.mcp.json`** —— 在插件根目录中放置一个 `.mcp.json` 文件
2. **内联在 `plugin.json`** —— 在插件清单中直接定义 MCP 服务器

使用 `${CLAUDE_PLUGIN_ROOT}` 变量来引用相对于插件安装目录的路径：

```json
{
  "mcpServers": {
    "plugin-tools": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js"],
      "env": {
        "CONFIG_PATH": "${CLAUDE_PLUGIN_ROOT}/config.json"
      }
    }
  }
}
```

## 子代理作用域 MCP

MCP 服务器可以在代理 frontmatter 中使用 `mcpServers:` 键内联定义，将其作用域限定为特定子代理，而不是整个项目。当某个代理需要访问其他代理不需要的特定 MCP 服务器时，这很有用。

```yaml
---
mcpServers:
  my-tool:
    type: http
    url: https://my-tool.example.com/mcp
---

你是一个可以访问 my-tool 进行专业操作的代理。
```

子代理作用域的 MCP 服务器仅在该代理的执行上下文中可用，不会与父代理或兄弟代理共享。

## MCP 输出限制

Claude Code 对 MCP 工具输出实施限制，以防止上下文溢出：

| 限制类型 | 阈值 | 行为 |
|----------|------|------|
| **警告** | 10,000 个 Token | 显示输出过大的警告 |
| **默认最大值** | 25,000 个 Token | 超过此限制的输出被截断 |
| **磁盘持久化** | 50,000 个字符 | 超过 50K 字符的工具结果持久化到磁盘 |

最大输出限制可通过 `MAX_MCP_OUTPUT_TOKENS` 环境变量配置：

```bash
# 将最大输出增加到 50,000 个 Token
export MAX_MCP_OUTPUT_TOKENS=50000
```

## 通过代码执行解决上下文膨胀问题

随着 MCP 的普及，连接到数十个服务器、数百甚至数千个工具会带来一个重大挑战：**上下文膨胀**。这可以说是大规模使用 MCP 最大的问题，而 Anthropic 的工程团队提出了一个优雅的解决方案——使用代码执行代替直接工具调用。

> **来源**：[Code Execution with MCP: Building More Efficient Agents](https://www.anthropic.com/engineering/code-execution-with-mcp) — Anthropic 工程博客

### 问题：两个 Token 浪费来源

**1. 工具定义使上下文窗口过载**

大多数 MCP 客户端预先加载所有工具定义。当连接到数千个工具时，模型在读取用户请求之前必须处理数十万个 Token。

**2. 中间结果消耗额外 Token**

每个中间工具结果都会通过模型的上下文。例如，将会议记录从 Google Drive 传输到 Salesforce 时，完整的会议记录会通过上下文**两次**：一次是读取，一次是写入到目标。一个 2 小时的会议记录可能意味着 50,000+ 个额外 Token。

```mermaid
graph LR
    A["模型"] -->|"工具调用: getDocument"| B["MCP 服务器"]
    B -->|"完整记录 (50K Token)"| A
    A -->|"工具调用: updateRecord<br/>(重新发送完整记录)"| B
    B -->|"确认"| A

    style A fill:#ffcdd2,stroke:#333,color:#333
    style B fill:#f3e5f5,stroke:#333,color:#333
```

### 解决方案：MCP 工具作为代码 API

代理不通过上下文窗口传递工具定义和结果，而是**编写代码**来调用 MCP 工具作为 API。代码在沙盒化执行环境中运行，只有最终结果返回给模型。

```mermaid
graph LR
    A["模型"] -->|"编写代码"| B["代码执行<br/>环境"]
    B -->|"直接调用工具"| C["MCP 服务器"]
    C -->|"数据留在<br/>执行环境中"| B
    B -->|"仅返回最终结果<br/>(少量 Token)"| A

    style A fill:#c8e6c9,stroke:#333,color:#333
    style B fill:#e1f5fe,stroke:#333,color:#333
    style C fill:#f3e5f5,stroke:#333,color:#333
```

#### 工作原理

MCP 工具作为类型化函数文件树呈现：

```
servers/
├── google-drive/
│   ├── getDocument.ts
│   └── index.ts
├── salesforce/
│   ├── updateRecord.ts
│   └── index.ts
└── ...
```

每个工具文件包含一个类型化包装器：

```typescript
// ./servers/google-drive/getDocument.ts
import { callMCPTool } from "../../../client.js";

interface GetDocumentInput {
  documentId: string;
}

interface GetDocumentResponse {
  content: string;
}

export async function getDocument(
  input: GetDocumentInput
): Promise<GetDocumentResponse> {
  return callMCPTool<GetDocumentResponse>(
    'google_drive__get_document', input
  );
}
```

然后代理编写代码来编排工具：

```typescript
import * as gdrive from './servers/google-drive';
import * as salesforce from './servers/salesforce';

// 数据直接在工具之间流动——永不经过模型
const transcript = (
  await gdrive.getDocument({ documentId: 'abc123' })
).content;

await salesforce.updateRecord({
  objectType: 'SalesMeeting',
  recordId: '00Q5f000001abcXYZ',
  data: { Notes: transcript }
});
```

**结果：Token 使用量从约 150,000 降至约 2,000——减少 98.7%。**

### 主要优势

| 优势 | 说明 |
|------|------|
| **渐进式披露** | 代理浏览文件系统以加载其仅需的工具定义，而不是预先加载所有工具 |
| **高效的上下文结果** | 数据在返回模型之前在执行环境中进行过滤/转换 |
| **强大的控制流** | 循环、条件判断和错误处理在代码中运行，无需通过模型往返 |
| **隐私保护** | 中间数据（个人识别信息、敏感记录）保留在执行环境中；永不进入模型上下文 |
| **状态持久化** | 代理可以将中间结果保存到文件并构建可重用的技能函数 |

#### 示例：过滤大型数据集

```typescript
// 无代码执行 — 全部 10,000 行都经过上下文
// 工具调用: gdrive.getSheet(sheetId: 'abc123')
//   -> 在上下文中返回 10,000 行

// 有代码执行 — 在执行环境中过滤
const allRows = await gdrive.getSheet({ sheetId: 'abc123' });
const pendingOrders = allRows.filter(
  row => row["Status"] === 'pending'
);
console.log(`找到 ${pendingOrders.length} 个待处理订单`);
console.log(pendingOrders.slice(0, 5)); // 只有 5 行到达模型
```

#### 示例：循环无需往返

```typescript
// 轮询部署通知 — 完全在代码中运行
let found = false;
while (!found) {
  const messages = await slack.getChannelHistory({
    channel: 'C123456'
  });
  found = messages.some(
    m => m.text.includes('deployment complete')
  );
  if (!found) await new Promise(r => setTimeout(r, 5000));
}
console.log('已收到部署通知');
```

### 需要考虑的权衡

代码执行引入了自身的复杂性。运行代理生成的代码需要：

- 一个**安全的沙盒化执行环境**，具有适当的资源限制
- 对执行代码的**监控和日志记录**
- 与直接工具调用相比额外的**基础设施开销**

收益——减少 Token 成本、降低延迟、改进工具组合——应与这些实现成本相权衡。对于仅有几个 MCP 服务器的代理，直接工具调用可能更简单。对于大规模使用（数十个服务器、数百个工具），代码执行是一个重大改进。

### MCPorter：MCP 工具组合的运行时

[MCPorter](https://github.com/steipete/mcporter) 是一个 TypeScript 运行时和 CLI 工具包，使调用 MCP 服务器变得实用，无需样板代码——并通过选择性工具暴露和类型化包装器帮助减少上下文膨胀。

**解决的问题：** 不用预先从所有 MCP 服务器加载所有工具定义，MCPorter 让你按需发现、检查和调用特定工具——保持上下文精简。

**主要功能：**

| 功能 | 说明 |
|------|------|
| **零配置发现** | 自动从 Cursor、Claude、Codex 或本地配置中挖掘 MCP 服务器 |
| **类型化工具客户端** | `mcporter emit-ts` 生成 `.d.ts` 接口和可直接运行的包装器 |
| **可组合 API** | `createServerProxy()` 将工具作为驼峰命名方法暴露，带有 `.text()`、`.json()`、`.markdown()` 辅助方法 |
| **CLI 生成** | `mcporter generate-cli` 将任何 MCP 服务器转换为独立 CLI，支持 `--include-tools` / `--exclude-tools` 过滤 |
| **参数隐藏** | 可选参数默认隐藏，减少模式冗长度 |

**安装：**

```bash
npx mcporter list          # 无需安装 — 即时挖掘服务器
pnpm add mcporter         # 添加到项目
brew install steipete/tap/mcporter  # macOS 通过 Homebrew
```

**示例——在 TypeScript 中组合工具：**

```typescript
import { createRuntime, createServerProxy } from "mcporter";

const runtime = await createRuntime();
const gdrive = createServerProxy(runtime, "google-drive");
const salesforce = createServerProxy(runtime, "salesforce");

// 数据在工具之间流动，不经过模型上下文
const doc = await gdrive.getDocument({ documentId: "abc123" });
await salesforce.updateRecord({
  objectType: "SalesMeeting",
  recordId: "00Q5f000001abcXYZ",
  data: { Notes: doc.text() }
});
```

**示例——CLI 工具调用：**

```bash
# 直接调用特定工具
npx mcporter call linear.create_comment issueId:ENG-123 body:'Looks good!'

# 列出可用的服务器和工具
npx mcporter list
```

MCPorter 通过提供运行时基础设施来调用 MCP 工具作为类型化 API 来补充上述代码执行方法——使中间数据轻松保持在模型上下文之外。

## 最佳实践

### 安全注意事项

#### 应该做 ✅
- 对所有凭证使用环境变量
- 定期轮换 Token 和 API 密钥（建议每月）
- 尽可能使用只读 Token
- 将 MCP 服务器访问范围限制为最低所需
- 监控 MCP 服务器使用情况和访问日志
- 在外部服务可用时使用 OAuth
- 对 MCP 请求实施速率限制
- 在生产使用前测试 MCP 连接
- 记录所有活动的 MCP 连接
- 保持 MCP 服务器包更新

#### 不应该做 ❌
- 不要在配置文件中硬编码凭证
- 不要将 Token 或密钥提交到 git
- 不要在团队聊天或邮件中分享 Token
- 不要为团队项目使用个人 Token
- 不要授予不必要的权限
- 不要忽略认证错误
- 不要公开暴露 MCP 端点
- 不要以 root/admin 权限运行 MCP 服务器
- 不要在日志中缓存敏感数据
- 不要禁用认证机制

### 配置最佳实践

1. **版本控制**：将 `.mcp.json` 纳入 git，但对密钥使用环境变量
2. **最小权限**：为每个 MCP 服务器授予所需的最少权限
3. **隔离**：尽可能在不同进程中运行不同的 MCP 服务器
4. **监控**：记录所有 MCP 请求和错误以供审计
5. **测试**：在部署到生产环境之前测试所有 MCP 配置

### 性能提示

- 在应用层缓存频繁访问的数据
- 使用具体的 MCP 查询以减少数据传输
- 监控 MCP 操作响应时间
- 考虑对外部 API 实施速率限制
- 执行多个操作时使用批处理

## 安装说明

### 前置条件
- 已安装 Node.js 和 npm
- 已安装 Claude Code CLI
- 外部服务的 API Token/凭证

### 分步设置

1. **添加你的第一个 MCP 服务器**（以 GitHub 为例）：
```bash
claude mcp add --transport stdio github -- npx @modelcontextprotocol/server-github
```

   或在项目根目录创建 `.mcp.json` 文件：
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

2. **设置环境变量：**
```bash
export GITHUB_TOKEN="your_github_personal_access_token"
```

3. **测试连接：**
```bash
claude /mcp
```

4. **使用 MCP 工具：**
```bash
/mcp__github__list_prs
/mcp__github__create_issue "标题" "描述"
```

### 特定服务的安装

**GitHub MCP：**
```bash
npm install -g @modelcontextprotocol/server-github
```

**Database MCP：**
```bash
npm install -g @modelcontextprotocol/server-database
```

**Filesystem MCP：**
```bash
npm install -g @modelcontextprotocol/server-filesystem
```

**Slack MCP：**
```bash
npm install -g @modelcontextprotocol/server-slack
```

## 故障排除

### MCP 服务器未找到
```bash
# 验证 MCP 服务器是否已安装
npm list -g @modelcontextprotocol/server-github

# 如果缺失则安装
npm install -g @modelcontextprotocol/server-github
```

### 认证失败
```bash
# 验证环境变量是否已设置
echo $GITHUB_TOKEN

# 如需要则重新导出
export GITHUB_TOKEN="your_token"

# 验证 Token 是否有正确的权限
# 检查 GitHub Token 作用域：https://github.com/settings/tokens
```

### 连接超时
- 检查网络连接：`ping api.github.com`
- 验证 API 端点可访问
- 检查 API 速率限制
- 尝试在配置中增加超时
- 检查防火墙或代理问题

### MCP 服务器崩溃
- 检查 MCP 服务器日志：`~/.claude/logs/`
- 验证所有环境变量已设置
- 确保文件权限正确
- 尝试重新安装 MCP 服务器包
- 检查同一端口上是否有冲突进程

## 相关概念

### Memory 与 MCP 的对比
- **Memory**：存储持久不变的静态数据（偏好设置、上下文、历史记录）
- **MCP**：访问实时变化的数据（API、数据库、实时服务）

### 何时使用
- **使用 Memory**：用户偏好设置、对话历史记录、学到的上下文
- **使用 MCP**：当前 GitHub issues、实时数据库查询、实时数据

### 与其他 Claude 功能的集成
- 将 MCP 与 Memory 结合以获得丰富的上下文
- 在提示词中使用 MCP 工具以获得更好的推理能力
- 利用多个 MCP 实现复杂工作流

## 其他资源

- [官方 MCP 文档](https://code.claude.com/docs/en/mcp)
- [MCP 协议规范](https://modelcontextprotocol.io/specification)
- [MCP GitHub 仓库](https://github.com/modelcontextprotocol/servers)
- [可用的 MCP 服务器](https://github.com/modelcontextprotocol/servers)
- [MCPorter](https://github.com/steipete/mcporter) — 调用 MCP 服务器的 TypeScript 运行时和 CLI
- [Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) — Anthropic 的工程博客，讲述如何解决上下文膨胀问题
- [Claude Code CLI 参考](https://code.claude.com/docs/en/cli-reference)
- [Claude API 文档](https://docs.anthropic.com)
