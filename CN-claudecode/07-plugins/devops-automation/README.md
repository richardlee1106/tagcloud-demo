<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../resources/logos/claude-howto-logo-dark.svg">
  <img alt="Claude How To" src="../../resources/logos/claude-howto-logo.svg">
</picture>

# DevOps 自动化插件

面向部署、监控和事件响应的完整 DevOps 自动化。

## 功能特性

✅ 自动化部署
✅ 回滚流程
✅ 系统健康监控
✅ 事件响应工作流
✅ Kubernetes 集成

## 安装

```bash
/plugin install devops-automation
```

## 包含内容

### 斜杠命令
- `/deploy` — 部署到生产或预发环境
- `/rollback` — 回滚到上一版本
- `/status` — 检查系统健康状态
- `/incident` — 处理生产环境事件

### 子代理
- `deployment-specialist` — 部署操作
- `incident-commander` — 事件协调
- `alert-analyzer` — 系统健康分析

### MCP 服务器
- Kubernetes 集成

### 脚本
- `deploy.sh` — 部署自动化
- `rollback.sh` — 回滚自动化
- `health-check.sh` — 健康检查工具

### 钩子
- `pre-deploy.js` — 部署前验证
- `post-deploy.js` — 部署后任务

## 使用方法

### 部署到预发环境
```
/deploy staging
```

### 部署到生产环境
```
/deploy production
```

### 回滚
```
/rollback production
```

### 检查状态
```
/status
```

### 处理事件
```
/incident
```

## 要求

- Claude Code 1.0+
- Kubernetes CLI（kubectl）
- 已配置集群访问权限

## 配置

设置你的 Kubernetes 配置：
```bash
export KUBECONFIG=~/.kube/config
```

## 示例工作流

```
用户: /deploy production

Claude:
1. 运行部署前钩子（验证 kubectl、集群连接）
2. 委托给 deployment-specialist 子代理
3. 运行 deploy.sh 脚本
4. 通过 Kubernetes MCP 监控部署进度
5. 运行部署后钩子（等待 pods、冒烟测试）
6. 提供部署总结

结果:
✅ 部署完成
📦 版本: v2.1.0
🚀 Pods: 3/3 就绪
⏱️  用时: 2m 34s
```
