# V2 GIS Agent Backend

独立于 V1 的可运行 V2 GIS Agent 后端，实现了路线图 Route A 的最小闭环：

- Intent Router v2
- 规则 + 学习信号模板重排
- DSL 契约校验
- L1/L2 分层缓存
- 结构化日志与 incident bundle
- 基于真实 GeoJSON 工具链的 `clip -> buffer -> merge -> export_geojson`
- `POST /api/v2/analysis` 的 SSE 流式返回

## 快速启动

```bash
npm install
npm run dev
```

默认监听：`http://127.0.0.1:3400`

## 关键接口

- `GET /health`
- `POST /api/v2/analysis`
- `GET /api/v2/tools`
- `POST /api/v2/tools/health-check`
- `GET /api/v2/jobs/:jobId`

## 示例请求

```bash
curl -N -X POST http://127.0.0.1:3400/api/v2/analysis ^
  -H "Content-Type: application/json" ^
  -d "{\"session_id\":\"demo-session\",\"query\":\"当前区域所有 POI 的 50m 圆形缓冲区面，合并后导出 GeoJSON\",\"viewport\":{\"zoom\":15,\"bbox\":[114.30,30.52,114.36,30.57]}}"
```

## 验证命令

```bash
npm test
npm run smoke
```

## 持久层配置

V2 作业状态支持三层持久化：

- Redis：热状态缓存，优先读取，默认 TTL 为 `3600s`
- PostgreSQL：耐久存储，按 `job_id` UPSERT
- 本地文件：远端存储不可用时的兜底

可选环境变量：

```bash
REDIS_URL=redis://127.0.0.1:6379
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=123456
POSTGRES_DATABASE=geoloom
V2_JOB_REDIS_TTL_SEC=3600
V2_JOB_PG_POOL_MAX=6
V2_JOB_PG_POOL_MIN=1
V2_JOB_PG_CONNECT_TIMEOUT_MS=2000
V2_JOB_PG_IDLE_TIMEOUT_MS=10000
V2_JOB_PG_STATEMENT_TIMEOUT_MS=1500
```

PostgreSQL 建表与索引脚本见：

`data-plane/sql/001_job_state_store.sql`

## 运维检查

健康检查：

```bash
npm run persistence:check
```

Job store 基线压测：

```bash
npm run bench:job-store -- 100
```

真实运行中的 V2 栈压测：

```bash
npm run bench:live -- 5
```

同一请求下的 V1 / V2 真实对比：

```bash
npm run compare:live -- 3
```

本机启动 V1 / V2 联调对比栈：

```bash
npm run live-stack:start
npm run compare:live -- 3
npm run live-stack:stop
```

## 容器化运行

准备环境文件：

```bash
cp .env.v2.example .env.v2
```

启动前检查：

```bash
npm run stack:check
```

启动整套 V2 栈：

```bash
npm run stack:up
```

停止整套 V2 栈：

```bash
npm run stack:down
```

默认宿主机端口：

- PostgreSQL: `55432`
- Redis: `56379`
- Python Tool Plane: `8801`
- V2 Backend: `3400`

说明：
- `bench:job-store` 会先做一次连接预热，再统计稳态读写时延。
- `smoke:live` 会请求正在运行的 V2 backend，并轮询 `/api/v2/jobs/:jobId` 验证异步 deep lane。
