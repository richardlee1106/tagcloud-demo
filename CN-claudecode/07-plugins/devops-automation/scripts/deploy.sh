#!/bin/bash
set -e

# 🚀 开始部署
echo "🚀 Starting deployment..."

# 加载环境变量
ENV=${1:-staging}
echo "📦 Target environment: $ENV"

# 部署前检查
echo "✓ Running pre-deployment checks..."
npm run lint
npm test

# 构建
echo "🔨 Building application..."
npm run build

# 部署
echo "🚢 Deploying to $ENV..."
kubectl apply -f k8s/$ENV/

# 健康检查
echo "🏥 Running health checks..."
sleep 10
curl -f http://api.$ENV.example.com/health

echo "✅ Deployment complete!"
