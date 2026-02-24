# Spatial-RAG 本地开发报告

## 1. 系统概览

ǰ˼ܹΪ **Node  + Python ռ**ĿǱ֤ռԼ +  + ʴ𡱵Сջá

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

ڱ memory еĿʧЧӺѣ

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

## 6. 收口2运维补充

### 6.1 新增健康接口

- `GET /api/jobs/health`

接口会返回队列模式、积压指标、失败任务统计、迁移开关快照与告警列表。

### 6.2 双跑与回退演练脚本

在 `fastify-backend` 目录执行：

```bash
npm run check:dualrun -- --samples=2 --out=reports/rollout/dual-run-latest.json
npm run drill:fallback -- --out=reports/rollout/fallback-drill-latest.json
```

脚本用途：

- `check:dualrun`：同一请求分别走 Python 主路径与 Node 回退路径，验证结构一致性与结果稳定性。
- `drill:fallback`ǿƿ Node ˣ֤µĿɻָ

### 6.3 灰度建议

- 发布前按顺序执行：`smoke:jobs` → `check:dualrun` → `drill:fallback`。
- 灰度观察期可定时轮询 `/api/jobs/health`。
- 澯ߣʱ `SPATIAL_FORCE_NODE_FALLBACK=true` ٽ
