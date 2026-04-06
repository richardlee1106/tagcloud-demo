#!/bin/bash
# 写入文件前自动格式化代码
# Hook: PreToolUse:Write

FILE=$1

if [ -z "$FILE" ]; then
  echo "用法: $0 <文件路径>"
  exit 1
fi

# 根据文件类型检测并格式化
case "$FILE" in
  *.js|*.jsx|*.ts|*.tsx)
    if command -v prettier &> /dev/null; then
      echo "正在格式化 JavaScript/TypeScript 文件: $FILE"
      prettier --write "$FILE"
    fi
    ;;
  *.py)
    if command -v black &> /dev/null; then
      echo "正在格式化 Python 文件: $FILE"
      black "$FILE"
    fi
    ;;
  *.go)
    if command -v gofmt &> /dev/null; then
      echo "正在格式化 Go 文件: $FILE"
      gofmt -w "$FILE"
    fi
    ;;
  *.rs)
    if command -v rustfmt &> /dev/null; then
      echo "正在格式化 Rust 文件: $FILE"
      rustfmt "$FILE"
    fi
    ;;
  *.java)
    if command -v google-java-format &> /dev/null; then
      echo "正在格式化 Java 文件: $FILE"
      google-java-format -i "$FILE"
    fi
    ;;
esac

exit 0
