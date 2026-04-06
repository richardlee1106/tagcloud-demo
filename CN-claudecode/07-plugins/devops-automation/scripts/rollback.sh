#!/bin/bash
set -e

# ⏪ 开始回滚
echo "⏪ Starting rollback..."

ENV=${1:-staging}
echo "📦 Target environment: $ENV"

# 获取上一部署版本
PREVIOUS=$(kubectl rollout history deployment/app -n $ENV | tail -2 | head -1 | awk '{print $1}')
echo "🔄 Rolling back to revision: $PREVIOUS"

# 执行回滚
kubectl rollout undo deployment/app -n $ENV

# 等待回滚完成
echo "⏳ Waiting for rollback to complete..."
kubectl rollout status deployment/app -n $ENV

# 健康检查
echo "🏥 Running health checks..."
sleep 5
curl -f http://api.$ENV.example.com/health

echo "✅ Rollback complete!"
