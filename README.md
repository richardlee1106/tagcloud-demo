# Spatial-RAG 本地开发报告

## 1. 系统概览

当前后端架构为 **Node 网关 + Python 空间计算**，目标是保证“空间约束 + 语义检索 + 方向问答”的最小闭环可用。

主要组成：

- 前端：Vue 3 + Vite
- 网关：fastify-backend
- 计算服务：fastify-backend/python_service
- 队列：BullMQ + Redis（无 Redis 时降级 memory）
- 数据库：PostgreSQL + PostGIS（可选 pgvector）

## 2. 本地启动

### 2.1 推荐方式

```bash
cd fastify-backend
npm run dev:stack
```

启动策略：

- 有 Redis 配置：启动独立 worker + backend
- 无 Redis 配置：跳过独立 worker，backend 内联 worker

这个策略用于避免 memory 队列的跨进程失效（入队后无人消费）。

### 2.2 前端启动

```bash
npm install
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3200

## 3. 接口说明

### 3.1 兼容接口

- `POST /api/ai/chat`

保留 SSE 事件：`stage` `pois` `boundary` `spatial_clusters` `vernacular_regions` `fuzzy_regions`

新增可选事件：`job` `progress` `partial` `refined_result`

### 3.2 Jobs 接口

- `POST /api/jobs/narrative`
- `GET /api/jobs/:job_id`
- `GET /api/jobs/:job_id/stream`
- `GET /api/jobs/:job_id/result`

## 4. 验证脚本

在 `fastify-backend` 目录执行：

```bash
npm run smoke:jobs
npm run bench:jobs -- 10 6
```

## 5. 常见问题

1. Vite 代理报 `ECONNREFUSED`：检查后端是否启动。
2. Jobs 超时：检查是否误用了“无 Redis + 独立 worker”。
3. 检索结果为空：检查空间边界、分类过滤、数据存在性。
