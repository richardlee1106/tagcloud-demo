---
description: 暂存所有更改，创建提交，并推送到远程（请谨慎使用）
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(git log:*), Bash(git pull:*)
---

# 提交并推送所有更改

**警告**：暂存所有更改、提交并推送到远程。仅在确信所有更改属于一起时使用。

## 工作流程

### 1. 分析更改

并行运行：
- `git status` - 显示已修改/已添加/已删除/未跟踪的文件
- `git diff --stat` - 显示更改统计
- `git log -1 --oneline` - 显示最近的提交以了解消息风格

### 2. 安全检查

**检测到以下情况时停止并警告：**
- 密钥：`.env*`、`*.key`、`*.pem`、`credentials.json`、`secrets.yaml`、`id_rsa`、`*.p12`、`*.pfx`、`*.cer`
- API 密钥：任何带有真实值的 `*_API_KEY`、`*_SECRET`、`*_TOKEN` 变量（不是占位符如 `your-api-key`、`xxx`、`placeholder`）
- 大文件：`>10MB` 且无 Git LFS
- 构建产物：`node_modules/`、`dist/`、`build/`、`__pycache__/`、`*.pyc`、`.venv/`
- 临时文件：`.DS_Store`、`thumbs.db`、`*.swp`、`*.tmp`

**API 密钥验证：**
检查修改的文件中是否有以下模式：
```bash
OPENAI_API_KEY=sk-proj-xxxxx  # 检测到真实密钥！
AWS_SECRET_KEY=AKIA...         # 检测到真实密钥！
STRIPE_API_KEY=sk_live_...    # 检测到真实密钥！

# 可接受的占位符：
API_KEY=your-api-key-here
SECRET_KEY=placeholder
TOKEN=xxx
API_KEY=<your-key>
SECRET=${YOUR_SECRET}
```

**验证：**
- `.gitignore` 配置正确
- 无合并冲突
- 分支正确（如果是 main/master 则警告）
- API 密钥仅为占位符

### 3. 请求确认

呈现摘要：
```
变更摘要：
- X 个文件已修改，Y 个已添加，Z 个已删除
- 总计：+AAA 行添加，-BBB 行删除

安全检查：✅ 无密钥 | ✅ 无大文件 | ⚠️ [警告]
分支：[名称] → origin/[名称]

我将执行：git add . → commit → push

输入 'yes' 继续或 'no' 取消。
```

**等待明确的 "yes" 后再继续。**

### 4. 执行（确认后）

按顺序运行：
```bash
git add .
git status  # 验证暂存
```

### 5. 生成提交消息

分析更改并创建符合规范的提交：

**格式：**
```
[type]: 简要总结（最多 72 个字符）

- 关键更改 1
- 关键更改 2
- 关键更改 3
```

**类型：** `feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`、`perf`、`build`、`ci`

**示例：**
```
docs: 更新概念 README 文件，添加全面文档

- 添加架构图和表格
- 包含实际示例
- 扩展最佳实践部分
```

### 6. 提交并推送

```bash
git commit -m "$(cat <<'EOF'
[生成的提交消息]
EOF
)"
git push  # 如果失败：git pull --rebase && git push
git log -1 --oneline --decorate  # 验证
```

### 7. 确认成功

```
✅ 成功推送到远程！

提交：[哈希] [消息]
分支：[分支] → origin/[分支]
文件更改：X（+添加行数，-删除行数）
```

## 错误处理

- **git add 失败**：检查权限、锁定文件、验证仓库已初始化
- **git commit 失败**：修复 pre-commit 钩子，检查 git 配置（user.name/email）
- **git push 失败**：
  - 非快进：先拉取再推送 `git pull --rebase && git push`
  - 无远程分支：`git push -u origin [分支]`
  - 受保护分支：改用 PR 工作流程

## 使用场景

**适合的场景：**
- 多文件文档更新
- 带测试和文档的功能
- 跨文件的错误修复
- 全项目格式化/重构
- 配置更改

**避免的场景：**
- 不确定正在提交什么
- 包含密钥/敏感数据
- 受保护分支无审查
- 存在合并冲突
- 想要粒度化的提交历史
- pre-commit 钩子失败

## 替代方案

如果用户想要控制，建议：
1. **选择性暂存**：审查/暂存特定文件
2. **交互式暂存**：`git add -p` 进行补丁选择
3. **PR 工作流程**：创建分支 → 推送 → PR（使用 `/pr` 命令）

**请记住**：推送前务必审查更改。如有疑问，使用单独的 git 命令以获得更多控制。
