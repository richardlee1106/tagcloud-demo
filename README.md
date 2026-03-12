# GeoLoom-RAG（地理认知探索）

GeoLoom-RAG 是一个面向地理空间分析的全栈系统，支持地图与标签云联动、AI 对话式空间推理、以及模板化证据聚合看板。

## 1. 技术栈

- 前端：Vue 3 + Vite + Element Plus（含 Vuetify）
- 后端：Fastify（Node.js）
- 空间计算：Python（gRPC）
- 数据库：PostgreSQL + PostGIS + pgvector
- 队列：BullMQ（无 Redis 时自动降级 memory）

## 2. 快速启动

### 2.1 一键启动（推荐，Windows）

```bash
start.bat
```

该脚本会启动：

- 前端：`npm run dev`（默认 `http://localhost:5173`）
- 后端：`npm run dev:stack`（默认 `http://127.0.0.1:3200`）

### 2.2 手动启动

```bash
# 终端1：V1 后端
cd V1-fastify-backend && npm run dev:stack

# 终端2：前端
npm run dev
```

### 2.3 健康检查

```bash
curl http://127.0.0.1:3200/health
curl http://127.0.0.1:3200/api/ai/status
```

## 3. 常用命令

### 3.1 根目录

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run dev:all
npm run dev:stack
```

### 3.2 `V1-fastify-backend/`

```bash
npm run start
npm run dev
npm run dev:stack
npm run python:grpc
npm run python:http
npm run worker:spatial

npm run kpi:report
npm run ops:hotspots
npm run template:weights
```

## 4. 当前系统行为（最新）

### 4.1 AI 对话面板

- 消息流与“最新回复分析看板”已合并为**同一滚动区**，可一体上下滚动
- `地名标签云` 继续保留为消息内嵌组件（不参与模板选择）
- 看板支持解释性文本 + 模板组件并行展示
- 模板引擎按意图与数据可用性选择 Top 1-3 个模板

### 4.2 开发环境 API 连通策略

- 前端开发环境默认直连：`http://127.0.0.1:3200`（见 `src/config.js`）
- 可通过 `VITE_DEV_API_BASE` 覆盖，例如：

```bash
VITE_DEV_API_BASE=http://127.0.0.1:3300 npm run dev
```

### 4.3 后端监听

- V1 后端默认：`HOST=127.0.0.1`，`PORT=3200`（见 `V1-fastify-backend/server.js`）

## 5. 关键 API

- AI：
  - `POST /api/ai/chat`
  - `GET /api/ai/status`
  - `GET /api/ai/models`
  - `POST /api/ai/template-feedback`
  - `GET /api/ai/template-feedback/weights`
- 空间与检索：
  - `POST /api/spatial/query`
  - `POST /api/spatial/fetch`
  - `GET /api/spatial/status`
  - `GET /api/search/quick`
  - `GET /api/category/tree`
- Jobs：
  - `POST /api/jobs/narrative`
  - `GET /api/jobs/:job_id`
  - `GET /api/jobs/:job_id/stream`
  - `GET /api/jobs/:job_id/result`
  - `GET /api/jobs/health`
- Ops（可观测）：
  - `GET /api/ops/metrics`
  - `GET /api/ops/kpi-report`
  - `GET /api/ops/operator-hotspots`

## 6. 可观测与学习能力（路线 A）

- SSE 元数据增强：`trace_id`、`schema_version`、`capabilities`
- 模板反馈闭环：曝光/点击/定位/追问/会话结果
- 模板权重离线重算：`cd V1-fastify-backend && npm run template:weights`
- 分层缓存：L1 内存 + 可选 L2 Redis（自动降级）
- 相关 SQL：`V1-fastify-backend/sql/05_ai_observability.sql`

## 7. 常见问题

### 7.1 `ERR_CONNECTION_REFUSED http://127.0.0.1:3200`

V1 后端未启动或已退出。执行：

```bash
cd V1-fastify-backend && npm run dev:stack
```

### 7.2 `502 Bad Gateway`

前端请求链路到后端失败。排查顺序：

1. 检查后端健康：`/health`
2. 重启前端 dev（配置变更后必须重启）
3. 检查本机端口占用（尤其是 3200）

### 7.3 AI 面板显示离线

先确认：

- `http://127.0.0.1:3200/api/ai/status` 可访问
- 面板可点击“重试连接”

## 8. 相关文档

- `AGENT.md`
- `CLAUDE.md`
- `docs/2026-02-25-gis-agent-architecture-roadmap.md`
- `docs/2026-02-24-gis-agent-architecture-innovation.md`
