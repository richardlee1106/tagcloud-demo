#!/bin/bash
# 文件写入时执行安全扫描
# Hook: PostToolUse:Write

FILE=$1

if [ -z "$FILE" ]; then
  echo "用法: $0 <文件路径>"
  exit 0
fi

echo "🔒 正在对文件进行安全扫描: $FILE"

ISSUES_FOUND=0

# 检查硬编码密码
if grep -qE "(password|passwd|pwd)\s*=\s*['\"][^'\"]+['\"]" "$FILE"; then
  echo "⚠️  警告: 在 $FILE 中检测到可能的硬编码密码"
  ISSUES_FOUND=1
fi

# 检查硬编码 API 密钥
if grep -qE "(api[_-]?key|apikey|access[_-]?token)\s*=\s*['\"][^'\"]+['\"]" "$FILE"; then
  echo "⚠️  警告: 在 $FILE 中检测到可能的硬编码 API 密钥"
  ISSUES_FOUND=1
fi

# 检查硬编码密钥
if grep -qE "(secret|token)\s*=\s*['\"][^'\"]+['\"]" "$FILE"; then
  echo "⚠️  警告: 在 $FILE 中检测到可能的硬编码密钥"
  ISSUES_FOUND=1
fi

# 检查私钥
if grep -q "BEGIN.*PRIVATE KEY" "$FILE"; then
  echo "⚠️  警告: 在 $FILE 中检测到私钥"
  ISSUES_FOUND=1
fi

# 检查 AWS 密钥
if grep -qE "AKIA[0-9A-Z]{16}" "$FILE"; then
  echo "⚠️  警告: 在 $FILE 中检测到 AWS 访问密钥"
  ISSUES_FOUND=1
fi

# 如果 semgrep 可用则执行扫描
if command -v semgrep &> /dev/null; then
  semgrep --config=auto "$FILE" --quiet 2>/dev/null
fi

# 如果 trufflehog 可用则执行扫描
if command -v trufflehog &> /dev/null; then
  trufflehog filesystem "$FILE" --only-verified --quiet 2>/dev/null
fi

if [ $ISSUES_FOUND -eq 0 ]; then
  echo "✅ 未发现安全问题"
fi

# 不阻塞操作，仅警告
exit 0
