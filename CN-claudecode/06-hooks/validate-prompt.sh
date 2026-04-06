#!/bin/bash
# 验证用户输入的提示词
# Hook: UserPromptSubmit

# 从标准输入读取提示词
PROMPT=$(cat)

echo "🔍 正在验证提示词..."

# 检查危险操作
DANGEROUS_PATTERNS=(
  "rm -rf /"
  "delete database"
  "drop database"
  "format disk"
  "dd if="
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$PROMPT" | grep -qi "$pattern"; then
    echo "❌ 已拦截: 检测到危险操作: $pattern"
    exit 1
  fi
done

# 检查生产环境部署
if echo "$PROMPT" | grep -qiE "(deploy|push).*production"; then
  if [ ! -f ".deployment-approved" ]; then
    echo "❌ 已拦截: 生产环境部署需要批准"
    echo "请创建 .deployment-approved 文件以继续"
    exit 1
  fi
fi

# 检查特定操作是否包含所需上下文
if echo "$PROMPT" | grep -qi "refactor"; then
  if [ ! -f "tests/" ] && [ ! -f "test/" ]; then
    echo "⚠️  警告: 重构时没有测试可能存在风险"
  fi
fi

echo "✅ 提示词验证通过"
exit 0
