# Prefetch 灰度开关与端到端观测说明

日期：2026-03-04  
范围：Phase C（prefetch rollout）

## 1. 这一步是干嘛的

目标是把 prefetch 的启用从“写死在请求里”升级为“可运营灰度”：

1. 可按环境控制是否开（开发/测试/生产分开）。
2. 可按 `query_type` 控制只放量某些流量。
3. 保留一键熔断能力（紧急关停 prefetch）。
4. 每次请求都能看到 prefetch 是“请求显式开启”还是“灰度策略开启”，便于复盘。

## 2. 后端环境变量

1. `SPATIAL_PREFETCH_FORCE_DISABLE`
: `true/false`，强制关闭总开关，优先级最高。
2. `SPATIAL_PREFETCH_ROLLOUT_ENABLED`
: `true/false`，是否启用灰度策略。
3. `SPATIAL_PREFETCH_ROLLOUT_ENVS`
: 环境白名单，逗号分隔（如 `staging,production`），空表示不按环境限制。
4. `SPATIAL_PREFETCH_ROLLOUT_QUERY_TYPES`
: `query_type` 白名单，逗号分隔（如 `area_analysis,poi_search`），空表示不按类型限制。
5. `SPATIAL_PREFETCH_ROLLOUT_FIELDS`
: 默认触发字段，逗号分隔（默认 `scope,entities.categories`）。

## 3. 生效规则（优先级）

1. 若 `SPATIAL_PREFETCH_FORCE_DISABLE=true`：强制关闭。
2. 否则若请求本身 `allow_prefetch=true`：按请求开启。
3. 否则若灰度配置命中（环境 + query_type）：按灰度开启。
4. 其他情况：关闭。

## 4. 端到端观测脚本

1. `npm run prefetch:probe`（在 `fastify-backend` 目录）
: 发起一组真实 narrative 请求，输出每条请求的 `query_type`、prefetch 策略来源、命中/降级/浪费等结果，并自动保存报告。
2. `npm run prefetch:snapshot`（在 `fastify-backend` 目录）
: 拉取 `/api/ops/kpi-report` 的 prefetch 指标快照，输出 wasted/degraded/overlap 与按 `query_type` 的分布。

输出目录：

- `fastify-backend/reports/prefetch-e2e/`
