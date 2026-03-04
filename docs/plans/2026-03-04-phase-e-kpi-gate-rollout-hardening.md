# Phase E KPI Gate And Rollout Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Phase D 已完成的路由/critic/calibration 基础上，补齐“可发布门禁、可灰度放量、可审计追踪”的持续交付闭环。  

**Architecture:** 延续 `spatialJobRunner` 作为运行时中心，`telemetry` 负责门禁指标聚合与阈值判定，`ops` 路由负责对外可观测接口，脚本层负责发布阻断与周期调参执行。通过最小改动方式补强集成验证与 stop-loss 机制。  

**Tech Stack:** Node.js (Fastify, node:test), Python 3 (pytest), in-repo telemetry + ops scripts.

---

### Task 1: KPI 门禁参数化与发布阻断

**Files:**
- Modify: `fastify-backend/services/telemetry.js`
- Modify: `fastify-backend/routes/ops/index.js`
- Modify: `fastify-backend/scripts/kpi_report.js`
- Create: `fastify-backend/scripts/release_gate_check.js`
- Modify: `fastify-backend/package.json`
- Test: `fastify-backend/tests/telemetryKpiGateConfig.test.mjs`
- Test: `fastify-backend/tests/releaseGateCheck.test.mjs`

**Step 1: Write failing tests**
- 新增阈值参数化测试：环境变量覆盖后，`m1/stability/prefetch_quality` 判定按新阈值生效。
- 新增发布阻断脚本测试：当 `route_b_ready=false` 时，脚本返回非 0 退出码并输出阻断原因。

**Step 2: Run tests to verify failure**
- Run: `node --test fastify-backend/tests/telemetryKpiGateConfig.test.mjs`
- Run: `node --test fastify-backend/tests/releaseGateCheck.test.mjs`

**Step 3: Implement minimal behavior**
- 在 `telemetry` 中集中解析 KPI 阈值配置（保留现有默认值）。
- 在 `ops` 新增 `GET /api/ops/release-gate`，返回门禁总状态与阻断原因列表。
- 为 `kpi_report.js` 增加 `--enforce-route-b-ready` 选项。
- 新增 `release_gate_check.js`，用于 CI/CD 或发布前检查。

**Step 4: Re-run tests**
- Run: `node --test fastify-backend/tests/telemetryKpiGateConfig.test.mjs`
- Run: `node --test fastify-backend/tests/releaseGateCheck.test.mjs`

---

### Task 2: 关键路由端到端回归（/api/ai/execute + /api/ops/audit）

**Files:**
- Create: `fastify-backend/app.js`
- Modify: `fastify-backend/server.js`
- Modify: `fastify-backend/routes/ai/index.js`
- Modify: `fastify-backend/routes/ops/index.js`
- Test: `fastify-backend/tests/criticRoutingE2E.test.mjs`
- Test: `fastify-backend/tests/opsAuditRouteE2E.test.mjs`

**Step 1: Write failing tests**
- `critical` 且需澄清时，`/api/ai/execute` 返回 `400`，错误码为 `clarification_needed` 或 `dsl_execution_blocked`。
- `high` 风险请求不阻断首包，且写入 `critic_async_review` 到 `/api/ops/audit` 可查询。
- `frontier` tier 请求响应中保留 `frontier_emulated=true` 证据。

**Step 2: Run tests to verify failure**
- Run: `node --test fastify-backend/tests/criticRoutingE2E.test.mjs`
- Run: `node --test fastify-backend/tests/opsAuditRouteE2E.test.mjs`

**Step 3: Implement minimal behavior**
- 抽离 Fastify app factory（`app.js`）以便 `inject` 集成测试，不改变生产启动入口语义。
- 对 `ai/ops` 路由响应字段做最小规范化，确保测试可稳定断言。

**Step 4: Re-run tests**
- Run: `node --test fastify-backend/tests/criticRoutingE2E.test.mjs`
- Run: `node --test fastify-backend/tests/opsAuditRouteE2E.test.mjs`

---

### Task 3: Complexity 调参闭环自动化与审计追踪

**Files:**
- Modify: `fastify-backend/scripts/recalibrate_complexity.js`
- Create: `fastify-backend/scripts/complexity_recalibrate_cron.js`
- Modify: `fastify-backend/package.json`
- Test: `fastify-backend/tests/recalibrateComplexityCron.test.mjs`

**Step 1: Write failing tests**
- 新增测试覆盖：
  - `recalibrate_complexity` 支持审计追加（history append）；
  - `complexity_recalibrate_cron` 在 API 不可达时返回非 0，成功时产出固定格式摘要。

**Step 2: Run tests to verify failure**
- Run: `node --test fastify-backend/tests/recalibrateComplexityCron.test.mjs`

**Step 3: Implement minimal behavior**
- 为 `recalibrate_complexity.js` 增加 `--history-file`，默认写入 `reports/routing/complexity-recalibrate-history.jsonl`。
- 新增 `complexity_recalibrate_cron.js`，用于定时任务环境的一键执行与标准日志输出。
- `package.json` 注册 `complexity:cron` 脚本。

**Step 4: Re-run tests**
- Run: `node --test fastify-backend/tests/recalibrateComplexityCron.test.mjs`

---

### Task 4: Prefetch 灰度放量与止损策略

**Files:**
- Modify: `fastify-backend/services/prefetchRolloutPolicy.js`
- Modify: `fastify-backend/services/telemetry.js`
- Modify: `fastify-backend/scripts/prefetch_rollout_probe.js`
- Modify: `fastify-backend/scripts/prefetch_rollout_snapshot.js`
- Test: `fastify-backend/tests/prefetchRolloutPolicy.test.mjs`
- Test: `fastify-backend/tests/telemetryPrefetchKpi.test.mjs`
- Test: `fastify-backend/tests/prefetchRolloutSnapshot.test.mjs`

**Step 1: Write failing tests**
- 新增百分比灰度能力测试（示例：10/30/60/100）与 query_type 维度并存判定。
- 新增 stop-loss 建议测试：`prefetch_wasted_rate` 连续超阈值时给出 `force_disable` 建议。

**Step 2: Run tests to verify failure**
- Run: `node --test fastify-backend/tests/prefetchRolloutPolicy.test.mjs`
- Run: `node --test fastify-backend/tests/telemetryPrefetchKpi.test.mjs`
- Run: `node --test fastify-backend/tests/prefetchRolloutSnapshot.test.mjs`

**Step 3: Implement minimal behavior**
- 在 rollout policy 增加灰度百分比配置与 deterministic sampling（基于 trace/session hash）。
- 在 snapshot/probe 报告补充“是否建议止损、建议动作、命中 query_type”字段。

**Step 4: Re-run tests**
- Run: `node --test fastify-backend/tests/prefetchRolloutPolicy.test.mjs`
- Run: `node --test fastify-backend/tests/telemetryPrefetchKpi.test.mjs`
- Run: `node --test fastify-backend/tests/prefetchRolloutSnapshot.test.mjs`

---

### Task 5: Node 回退链路瘦身与路径统一

**Files:**
- Modify: `fastify-backend/services/spatialJobRunner.js`
- Modify: `fastify-backend/routes/ai/executor.js`
- Modify: `fastify-backend/routes/ai/index.js`
- Test: `fastify-backend/tests/aiRouteFallbackMode.test.mjs`
- Test: `fastify-backend/tests/criticRoutingPolicy.test.mjs`

**Step 1: Write failing tests**
- 新增测试：高复杂查询默认走 Python 主路径；Node 仅在 `minimal/legacy` 允许场景触发回退。
- 新增测试：旧路径 `executeQuery` 不再直接绕过 `spatialJobRunner`。

**Step 2: Run tests to verify failure**
- Run: `node --test fastify-backend/tests/aiRouteFallbackMode.test.mjs`

**Step 3: Implement minimal behavior**
- 统一 `ai` 执行入口到 `spatialJobRunner`。
- 默认 `SPATIAL_NODE_ADVANCED_FALLBACK=minimal`，并保留 `legacy` 作为应急开关。
- 记录 fallback 命中 KPI 事件，支持后续下线评估。

**Step 4: Re-run tests**
- Run: `node --test fastify-backend/tests/aiRouteFallbackMode.test.mjs`
- Run: `node --test fastify-backend/tests/criticRoutingPolicy.test.mjs`

---

### Task 6: Full Verification + Ghost Bug Review

**Files:**
- Verify only

**Step 1: Backend test sweep**
- Run: `node --test fastify-backend/tests/*.mjs`

**Step 2: Python regression**
- Run: `python -m pytest fastify-backend/python_service/tests/test_spatial_pipeline.py -q`

**Step 3: Build and script checks**
- Run: `npm run build`
- Run: `npm --prefix fastify-backend run complexity:recalibrate`
- Run: `npm --prefix fastify-backend run kpi:report`
- Run: `npm --prefix fastify-backend run prefetch:probe`
- Run: `npm --prefix fastify-backend run prefetch:snapshot`

**Step 4: Checklist-based review against Phase E goals**
- 发布门禁：阈值可配置、可阻断发布、可解释阻断原因。
- 路由回归：critical 同步阻断、high 异步审计、frontier 仿真可观测。
- 调参闭环：可周期执行、可追踪历史、可回溯建议来源。
- 灰度放量：支持分阶段比例放量，异常时可自动建议止损。
- 瘦身目标：Node 仅保留应急兼容职责，不与主路径并行漂移。
