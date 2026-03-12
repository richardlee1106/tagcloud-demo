# V1/V2 联调怎么跑

这份文档只说白话，不绕。

## 先看环境是不是能跑

```bash
npm run live-stack:status
```

你先看两个字段：

- `ready_for_v2_only`
- `ready_for_compare`

含义很简单：

- `ready_for_v2_only=true`
  说明 V2 这边自己能跑
- `ready_for_compare=true`
  说明 V1 和 V2 都能跑，可以做同请求对比

## 只看 V2

```bash
npm run smoke:live
npm run bench:live -- 3
npm run report:live -- 3
```

## 看 V1/V2 同请求对比

```bash
npm run live-stack:start
npm run live-stack:status
npm run compare:live -- 3
npm run report:live -- 3
npm run live-stack:stop
```

## 怎么看结果

### 1. `compare:live`

重点看这几个字段：

- `winner.initial_latency`
- `winner.completion_latency`
- `delta.completion_p95_reduction_ratio`

说白了：

- 首响谁快，看 `initial_latency`
- 整体谁快，看 `completion_latency`
- `completion_p95_reduction_ratio` 越接近 `1`，说明 V2 相对 V1 越快

### 2. `report:live`

这个是总报告。

重点看：

- `summary.comparison_available`
- `summary.persistence_ok`
- `summary.event_quality_ok`
- `warnings`

如果 `comparison_available=false`：
- 说明 V1 没起来，或者依赖不全

如果 `persistence_ok=false`：
- 说明 Redis / PostgreSQL 至少有一个有问题

如果 `warnings` 里有 `v1_unavailable`：
- 说明这次只能看 V2，不适合拿来做 V1/V2 对比

## 常见故障怎么处理

### `v1_backend_unavailable`

先查：

- `127.0.0.1:3200`
- `127.0.0.1:50051`
- `127.0.0.1:5432`

V1 最大概率是卡在：

- PostgreSQL 没起
- gRPC Python 没起

### `postgres_unavailable`

说明数据库没通。

这时候：

- V2 可能还能靠 Redis + file fallback 继续跑
- 但这不算稳定环境

### `redis_unavailable`

说明热缓存没了。

影响：

- 功能未必立刻坏
- 但性能会明显变差

## 现在该怎么用

如果你只是要验证 V2 是否正常：

```bash
npm run live-stack:status
npm run smoke:live
```

如果你要看 V1/V2 谁更快：

```bash
npm run live-stack:start
npm run compare:live -- 3
```

如果你要一份能存档的报告：

```bash
npm run report:live -- 3
```
