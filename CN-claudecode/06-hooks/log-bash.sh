#!/bin/bash
# 记录所有 Bash 命令
# Hook: PostToolUse:Bash

COMMAND="$1"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
LOGFILE="$HOME/.claude/bash-commands.log"

# 如果日志目录不存在则创建
mkdir -p "$(dirname "$LOGFILE")"

# 记录命令
echo "[$TIMESTAMP] $COMMAND" >> "$LOGFILE"

# 可选：同时记录到系统日志
# logger -t "claude-bash" "$COMMAND"

exit 0
