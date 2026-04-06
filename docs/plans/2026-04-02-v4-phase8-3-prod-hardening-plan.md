# V4 Phase 8.3 Prod Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `V4-GeoLoom-beta` 补齐生产级护栏，包括 10 题固定回归、运行时指标、Redis 真连接升格，以及 FAISS / 路网 / Python 编码器远程接入验证，并明确 MiniMax 是真实编排 smoke 的主入口。

**Architecture:** 在不重写 `GeoLoomAgent` 主链路的前提下，新增一个低侵入的内存指标收集层，把聚合指标挂到 `health` 视图；再将现有零散的题型集成测试提升为 fixture 驱动的 10 题回归。依赖接入继续沿用 `RemoteFirst + Local Fallback` 抽象，只补状态感知、失败分类和回归验证。

**Tech Stack:** TypeScript, Fastify, Vitest, Node.js, MiniMax Anthropic-compatible API, Redis RESP client, existing remote bridge abstractions

---

### Task 1: 写出运行时指标聚合器

**Files:**
- Create: `V4-GeoLoom-beta/src/metrics/RuntimeMetrics.ts`
- Test: `V4-GeoLoom-beta/tests/unit/metrics/RuntimeMetrics.spec.ts`

**Step 1: Write the failing test**

在 `RuntimeMetrics.spec.ts` 中先覆盖这几个行为：

```ts
it('aggregates latency percentiles and derived rates', () => {
  const metrics = new RuntimeMetrics({ windowSize: 10 })
  metrics.recordRequest({ latencyMs: 100, sqlValidated: true, sqlAccepted: true, answerGrounded: true })
  metrics.recordRequest({ latencyMs: 500, sqlValidated: true, sqlAccepted: false, answerGrounded: false })

  expect(metrics.snapshot().latency.p50_ms).toBe(100)
  expect(metrics.snapshot().latency.p95_ms).toBe(500)
  expect(metrics.snapshot().sql_valid_rate).toBe(0.5)
  expect(metrics.snapshot().evidence_grounded_answer_rate).toBe(0.5)
})
```

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/unit/metrics/RuntimeMetrics.spec.ts`

Expected: FAIL because `RuntimeMetrics.ts` does not exist yet

**Step 3: Write minimal implementation**

实现一个纯内存指标聚合器：

1. 维护最近 N 次请求时延
2. 记录 SQL 校验尝试/通过次数
3. 记录 grounded answer 次数
4. 暴露 `snapshot()`

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/unit/metrics/RuntimeMetrics.spec.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add V4-GeoLoom-beta/src/metrics/RuntimeMetrics.ts V4-GeoLoom-beta/tests/unit/metrics/RuntimeMetrics.spec.ts
git commit -m "feat: add v4 runtime metrics aggregator"
```

### Task 2: 把指标挂进 GeoLoomAgent 和 health

**Files:**
- Modify: `V4-GeoLoom-beta/src/agent/GeoLoomAgent.ts`
- Modify: `V4-GeoLoom-beta/src/server.ts`
- Modify: `V4-GeoLoom-beta/src/routes/geo.ts`
- Test: `V4-GeoLoom-beta/tests/integration/routes/geo.spec.ts`

**Step 1: Write the failing test**

在 `geo.spec.ts` 中增加 health 指标断言：

```ts
expect(payload.metrics.latency.p50_ms).toBeTypeOf('number')
expect(payload.metrics.sql_valid_rate).toBeTypeOf('number')
expect(payload.metrics.evidence_grounded_answer_rate).toBeTypeOf('number')
```

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/integration/routes/geo.spec.ts`

Expected: FAIL because `metrics` is not returned yet

**Step 3: Write minimal implementation**

1. 在 `server.ts` 中创建单例 `RuntimeMetrics`
2. 注入到 `GeoLoomAgent`
3. 在每次请求完成时记录：
   - latency
   - 是否发生 SQL 校验
   - 是否 SQL accepted
   - 是否 evidence grounded
4. 在 `getHealth()` 中返回 metrics snapshot

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/integration/routes/geo.spec.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add V4-GeoLoom-beta/src/agent/GeoLoomAgent.ts V4-GeoLoom-beta/src/server.ts V4-GeoLoom-beta/src/routes/geo.ts V4-GeoLoom-beta/tests/integration/routes/geo.spec.ts
git commit -m "feat: expose v4 health metrics"
```

### Task 3: 固化 10 题 fixture 化回归

**Files:**
- Create: `V4-GeoLoom-beta/tests/integration/e2e/phase8_3_regression.fixture.ts`
- Create: `V4-GeoLoom-beta/tests/integration/e2e/phase8_3_regression.spec.ts`
- Modify: `V4-GeoLoom-beta/package.json`

**Step 1: Write the failing test**

先建立最小 fixture 和一条用例：

```ts
it('covers all phase 8.3 regression fixtures', async () => {
  expect(regressionFixtures).toHaveLength(10)
})
```

再给每题加入通用断言：

```ts
expect(refined.results.stats.query_type).toBe(fixture.expectedQueryType)
expect(refined.results.evidence_view.type).toBe(fixture.expectedEvidenceType)
```

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/integration/e2e/phase8_3_regression.spec.ts`

Expected: FAIL because fixtures/spec do not exist yet

**Step 3: Write minimal implementation**

1. 提炼 10 题 fixture
2. 复用现有测试 app builder
3. 先实现 mock/stable 模式
4. 在 `package.json` 中增加专门脚本，例如：
   - `test:e2e:phase8-3`

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/integration/e2e/phase8_3_regression.spec.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add V4-GeoLoom-beta/tests/integration/e2e/phase8_3_regression.fixture.ts V4-GeoLoom-beta/tests/integration/e2e/phase8_3_regression.spec.ts V4-GeoLoom-beta/package.json
git commit -m "test: add phase 8.3 regression fixtures"
```

### Task 4: 为 MiniMax 真服务 smoke 预留执行入口

**Files:**
- Create: `V4-GeoLoom-beta/tests/smoke/minimaxPhase8_3.smoke.spec.ts`
- Modify: `V4-GeoLoom-beta/package.json`
- Modify: `V4-GeoLoom-beta/.env.example`

**Step 1: Write the failing test**

写一个仅在环境变量满足时才执行的 smoke：

```ts
it.skipIf(!process.env.LLM_API_KEY || !process.env.LLM_BASE_URL)('runs selected fixtures through MiniMax', async () => {
  expect(createDefaultLLMProvider().getStatus().provider).toContain('minimax')
})
```

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/smoke/minimaxPhase8_3.smoke.spec.ts`

Expected: FAIL because file/script is missing

**Step 3: Write minimal implementation**

1. 新增 smoke 规范，默认只跑 2-3 题关键题
2. 校验 provider 状态、返回 evidence type、关键实体命中
3. 在 `package.json` 增加例如：
   - `test:smoke:minimax`
4. 在 `.env.example` 里标明 MiniMax 是当前主编排入口

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/smoke/minimaxPhase8_3.smoke.spec.ts`

Expected: When env missing, SKIP; when env ready, PASS

**Step 5: Commit**

```bash
git add V4-GeoLoom-beta/tests/smoke/minimaxPhase8_3.smoke.spec.ts V4-GeoLoom-beta/package.json V4-GeoLoom-beta/.env.example
git commit -m "test: add minimax smoke entry for phase 8.3"
```

### Task 5: 升格 Redis 真连接健康验证

**Files:**
- Modify: `V4-GeoLoom-beta/src/memory/RedisShortTermStore.ts`
- Modify: `V4-GeoLoom-beta/src/memory/ShortTermMemory.ts`
- Test: `V4-GeoLoom-beta/tests/unit/memory/ShortTermMemory.spec.ts`
- Create: `V4-GeoLoom-beta/tests/unit/memory/RedisShortTermStore.spec.ts`

**Step 1: Write the failing test**

新增 Redis store 行为测试：

```ts
it('reports remote status after a successful ping', async () => {
  // fake redis server or mocked runCommands
})
```

以及 fallback 状态锁定测试：

```ts
expect(await memory.getStatus()).toMatchObject({
  mode: 'fallback',
  reason: 'remote_store_unavailable',
})
```

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/unit/memory/ShortTermMemory.spec.ts tests/unit/memory/RedisShortTermStore.spec.ts`

Expected: FAIL because new cases are not handled yet

**Step 3: Write minimal implementation**

1. 补充 ping/写入后的状态升级
2. 明确远程失败后的 fallback 状态
3. 尽量不改 RESP 协议核心，只补状态机与测试钩子

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/unit/memory/ShortTermMemory.spec.ts tests/unit/memory/RedisShortTermStore.spec.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add V4-GeoLoom-beta/src/memory/RedisShortTermStore.ts V4-GeoLoom-beta/src/memory/ShortTermMemory.ts V4-GeoLoom-beta/tests/unit/memory/ShortTermMemory.spec.ts V4-GeoLoom-beta/tests/unit/memory/RedisShortTermStore.spec.ts
git commit -m "feat: harden redis short-term memory status handling"
```

### Task 6: 补齐 FAISS / 路网 / Python 编码器远程成功与降级验证

**Files:**
- Modify: `V4-GeoLoom-beta/tests/unit/integration/faissIndex.spec.ts`
- Modify: `V4-GeoLoom-beta/tests/unit/integration/osmBridge.spec.ts`
- Modify: `V4-GeoLoom-beta/tests/unit/integration/pythonBridge.spec.ts`
- Optional Modify: `V4-GeoLoom-beta/src/integration/faissIndex.ts`
- Optional Modify: `V4-GeoLoom-beta/src/integration/osmBridge.ts`
- Optional Modify: `V4-GeoLoom-beta/src/integration/pythonBridge.ts`

**Step 1: Write the failing test**

分别补 2 类断言：

1. 远程健康成功时 `mode: 'remote'`
2. 请求失败时 `mode: 'fallback'` 且 `reason: 'remote_request_failed'`

例如：

```ts
await expect(index.getStatus()).resolves.toMatchObject({
  mode: 'remote',
  degraded: false,
})
```

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/unit/integration/faissIndex.spec.ts tests/unit/integration/osmBridge.spec.ts tests/unit/integration/pythonBridge.spec.ts`

Expected: FAIL on at least one missing edge case

**Step 3: Write minimal implementation**

仅在必要时微调 bridge：

1. 保持 `RemoteFirst + Fallback`
2. 统一 status 回写
3. 保证成功/失败路径都能稳定复现

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta; npx vitest run tests/unit/integration/faissIndex.spec.ts tests/unit/integration/osmBridge.spec.ts tests/unit/integration/pythonBridge.spec.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add V4-GeoLoom-beta/tests/unit/integration/faissIndex.spec.ts V4-GeoLoom-beta/tests/unit/integration/osmBridge.spec.ts V4-GeoLoom-beta/tests/unit/integration/pythonBridge.spec.ts V4-GeoLoom-beta/src/integration/faissIndex.ts V4-GeoLoom-beta/src/integration/osmBridge.ts V4-GeoLoom-beta/src/integration/pythonBridge.ts
git commit -m "test: cover remote and fallback bridge paths"
```

### Task 7: 全量验证与文档回写

**Files:**
- Modify: `docs/plans/2026-04-02-v4-phase8-2.md`
- Modify: `docs/plans/2026-04-01-v4-geo-agent-开发计划文档.md`
- Optional Modify: `docs/plans/2026-04-02-v4-phase8-3-prod-hardening-design.md`

**Step 1: Run focused verification**

Run:

```bash
cd V4-GeoLoom-beta
npx vitest run tests/unit/metrics/RuntimeMetrics.spec.ts tests/unit/memory/ShortTermMemory.spec.ts tests/unit/memory/RedisShortTermStore.spec.ts tests/unit/integration/faissIndex.spec.ts tests/unit/integration/osmBridge.spec.ts tests/unit/integration/pythonBridge.spec.ts tests/integration/routes/geo.spec.ts tests/integration/e2e/phase8_3_regression.spec.ts
```

Expected: PASS

**Step 2: Run full verification**

Run:

```bash
cd V4-GeoLoom-beta
npm test
npx tsc --noEmit
```

Expected: PASS

**Step 3: Run MiniMax smoke when env is ready**

Run:

```bash
cd V4-GeoLoom-beta
npx vitest run tests/smoke/minimaxPhase8_3.smoke.spec.ts
```

Expected: SKIP when env missing, PASS when MiniMax env is configured

**Step 4: Write execution results back to docs**

把以下信息回写到文档：

1. 指标已落地
2. Redis 状态升格结果
3. 远程依赖成功/降级验证结果
4. MiniMax smoke 结果

**Step 5: Commit**

```bash
git add docs/plans/2026-04-02-v4-phase8-2.md docs/plans/2026-04-01-v4-geo-agent-开发计划文档.md docs/plans/2026-04-02-v4-phase8-3-prod-hardening-design.md
git commit -m "docs: record phase 8.3 prod hardening results"
```

---

Plan complete and saved to `docs/plans/2026-04-02-v4-phase8-3-prod-hardening-plan.md`.

默认执行假设：

1. 继续在当前会话内实施
2. 不额外开新 session
3. MiniMax smoke 作为可选真实验收入口，只有环境已配置时才执行
