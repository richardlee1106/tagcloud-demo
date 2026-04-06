#!/bin/bash
# 提交前运行测试
# Hook: PreToolUse (matcher: Bash) - 检查命令是否为 git commit
# 注意: 没有 "PreCommit" 钩子事件。请使用 PreToolUse 配合 Bash matcher
# 并检查命令内容来检测 git commit 操作。

echo "🧪 正在提交前运行测试..."

# 检查 package.json 是否存在 (Node.js 项目)
if [ -f "package.json" ]; then
  if grep -q "\"test\":" package.json; then
    npm test
    if [ $? -ne 0 ]; then
      echo "❌ 测试失败！已阻止提交。"
      exit 1
    fi
  fi
fi

# 检查 pytest 是否可用 (Python 项目)
if [ -f "pytest.ini" ] || [ -f "setup.py" ]; then
  if command -v pytest &> /dev/null; then
    pytest
    if [ $? -ne 0 ]; then
      echo "❌ 测试失败！已阻止提交。"
      exit 1
    fi
  fi
fi

# 检查 go.mod 是否存在 (Go 项目)
if [ -f "go.mod" ]; then
  go test ./...
  if [ $? -ne 0 ]; then
    echo "❌ 测试失败！已阻止提交。"
    exit 1
  fi
fi

# 检查 Cargo.toml 是否存在 (Rust 项目)
if [ -f "Cargo.toml" ]; then
  cargo test
  if [ $? -ne 0 ]; then
    echo "❌ 测试失败！已阻止提交。"
    exit 1
  fi
fi

echo "✅ 所有测试通过！继续执行提交。"
exit 0
