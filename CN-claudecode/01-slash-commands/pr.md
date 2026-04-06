---
name: Pull Request Preparation
description: 清理代码、暂存更改并准备拉取请求
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git diff:*), Bash(npm test:*), Bash(npm run lint:*)
---

# 拉取请求准备清单

在创建 PR 之前，执行以下步骤：

1. 运行代码检查：`prettier --write .`
2. 运行测试：`npm test`
3. 审查 git 差异：`git diff HEAD`
4. 暂存更改：`git add .`
5. 按照 conventional commits 规范创建提交消息：
   - `fix:` 用于错误修复
   - `feat:` 用于新功能
   - `docs:` 用于文档
   - `refactor:` 用于代码重构
   - `test:` 用于添加测试
   - `chore:` 用于维护任务

6. 生成 PR 摘要，包括：
   - 更改了什么
   - 为什么更改
   - 执行的测试
   - 潜在影响
