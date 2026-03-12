# V2 GIS Agent Route A Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a runnable, V1-independent V2 GIS Agent backend that delivers Route A from the roadmap: Intent Router v2, template reranking, L1/L2 caching, versioned SSE contracts, observability, and a minimal real GIS execution loop.

**Architecture:** The backend lives entirely under `V2-Agent-backend/` as an independent Node/Fastify service. A deterministic control flow converts user query + map context into a validated DSL plan, then runs a small registry-backed GIS toolchain over sample GeoJSON data, streams fast/deep results via SSE, and records structured telemetry plus incident bundles.

**Tech Stack:** Node.js 22, Fastify, ESM JavaScript, built-in `node:test`, Ajv JSON schema validation, Turf.js for GeoJSON operations.

---

### Task 1: Bootstrap the independent V2 backend package

**Files:**
- Create: `V2-Agent-backend/package.json`
- Create: `V2-Agent-backend/src/app.js`
- Create: `V2-Agent-backend/src/server.js`
- Create: `V2-Agent-backend/tests/health.test.js`

**Step 1: Write the failing test**

```js
test('health endpoint returns v2 service metadata', async () => {
  const { app } = await createApp()
  const response = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(response.statusCode, 200)
})
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="health endpoint returns v2 service metadata"`

Expected: FAIL because the app/server package does not exist yet.

**Step 3: Write minimal implementation**

```js
app.get('/health', async () => ({
  status: 'ok',
  service: 'v2-gis-agent',
  schema_version: 'contract.v2.0'
}))
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="health endpoint returns v2 service metadata"`

Expected: PASS

**Step 5: Commit**

```bash
git add V2-Agent-backend docs/plans/2026-03-08-v2-gis-agent-route-a-implementation.md
git commit -m "初始化 V2 GIS Agent 工程骨架"
```

### Task 2: Implement Intent Router v2 and template reranking

**Files:**
- Create: `V2-Agent-backend/src/chain/intent-router.js`
- Create: `V2-Agent-backend/src/chain/template-ranker.js`
- Create: `V2-Agent-backend/src/chain/planner.js`
- Create: `V2-Agent-backend/tests/intent-router.test.js`
- Create: `V2-Agent-backend/tests/template-ranker.test.js`

**Step 1: Write the failing tests**

```js
test('classifies primary and sub intent from query and viewport context', () => {})
test('reranks templates with rule fallback and learned weights', () => {})
```

**Step 2: Run tests to verify they fail**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="classifies|reranks"`

Expected: FAIL because routing and ranking modules do not exist yet.

**Step 3: Write minimal implementation**

```js
const routeIntent = ({ query, viewport, history }) => ({ primary_intent: 'micro', sub_intent: 'buffer_merge' })
const rankTemplates = ({ candidates, signals }) => candidates.sort((a, b) => b.score - a.score)
```

**Step 4: Run tests to verify they pass**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="classifies|reranks"`

Expected: PASS

**Step 5: Commit**

```bash
git add V2-Agent-backend
git commit -m "完成 V2 意图路由与模板重排"
```

### Task 3: Add DSL validation, lane state machine, and L1/L2 caches

**Files:**
- Create: `V2-Agent-backend/src/contracts/dsl.schema.json`
- Create: `V2-Agent-backend/src/runtime/lane-state-machine.js`
- Create: `V2-Agent-backend/src/runtime/multi-level-cache.js`
- Create: `V2-Agent-backend/tests/lane-state-machine.test.js`
- Create: `V2-Agent-backend/tests/multi-level-cache.test.js`
- Create: `V2-Agent-backend/tests/dsl-schema.test.js`

**Step 1: Write the failing tests**

```js
test('accepts valid DSL plans for clip-buffer-merge-export', () => {})
test('tracks fast/deep transitions without invalid regressions', () => {})
test('reuses session and process cache layers independently', async () => {})
```

**Step 2: Run tests to verify they fail**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="DSL|transitions|cache"`

Expected: FAIL because schema, cache, and state machine modules do not exist yet.

**Step 3: Write minimal implementation**

```js
const machine = createLaneStateMachine()
const cache = createMultiLevelCache()
const validateDsl = buildDslValidator(schema)
```

**Step 4: Run tests to verify they pass**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="DSL|transitions|cache"`

Expected: PASS

**Step 5: Commit**

```bash
git add V2-Agent-backend
git commit -m "补齐 DSL 契约 状态机 与分层缓存"
```

### Task 4: Add telemetry, incident bundles, and tool registry backed GIS execution

**Files:**
- Create: `V2-Agent-backend/src/observability/logger.js`
- Create: `V2-Agent-backend/src/observability/incident-bundle.js`
- Create: `V2-Agent-backend/src/tools/tool-registry.js`
- Create: `V2-Agent-backend/src/tools/vector-tools.js`
- Create: `V2-Agent-backend/tests/tool-registry.test.js`
- Create: `V2-Agent-backend/tests/incident-bundle.test.js`

**Step 1: Write the failing tests**

```js
test('registers vector tools and executes a clip-buffer-merge pipeline', async () => {})
test('writes structured incident bundle when execution degrades', async () => {})
```

**Step 2: Run tests to verify they fail**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="registers vector tools|incident bundle"`

Expected: FAIL because tool registry and incident bundle modules do not exist yet.

**Step 3: Write minimal implementation**

```js
const registry = createToolRegistry()
registry.register(toolDescriptor)
await executePlan({ registry, dsl })
```

**Step 4: Run tests to verify they pass**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="registers vector tools|incident bundle"`

Expected: PASS

**Step 5: Commit**

```bash
git add V2-Agent-backend
git commit -m "接入观测诊断与 GIS 工具注册执行"
```

### Task 5: Expose the Fastify API and SSE analysis stream

**Files:**
- Create: `V2-Agent-backend/src/routes/analysis.js`
- Create: `V2-Agent-backend/src/routes/tools.js`
- Create: `V2-Agent-backend/src/runtime/analysis-service.js`
- Create: `V2-Agent-backend/tests/analysis-route.test.js`
- Create: `V2-Agent-backend/tests/tools-route.test.js`

**Step 1: Write the failing tests**

```js
test('streams schema_version and capabilities on analysis SSE events', async () => {})
test('lists registered tools with health metadata', async () => {})
```

**Step 2: Run tests to verify they fail**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="streams schema_version|lists registered tools"`

Expected: FAIL because routes do not exist yet.

**Step 3: Write minimal implementation**

```js
reply.raw.write(`event: fast.result\n`)
reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
```

**Step 4: Run tests to verify they pass**

Run: `npm --prefix V2-Agent-backend test -- --test-name-pattern="streams schema_version|lists registered tools"`

Expected: PASS

**Step 5: Commit**

```bash
git add V2-Agent-backend
git commit -m "打通 V2 分析接口与 SSE 流式返回"
```

### Task 6: Final verification and runnable delivery

**Files:**
- Create: `V2-Agent-backend/README.md`
- Create: `V2-Agent-backend/scripts/smoke-analysis.js`
- Modify: `V2-Agent-backend/package.json`

**Step 1: Write the failing verification target**

```js
test('end-to-end analysis stream returns fast and deep results', async () => {})
```

**Step 2: Run verification to observe any failures**

Run: `npm --prefix V2-Agent-backend test`

Expected: PASS only when the complete backend is wired correctly.

**Step 3: Add runnable smoke command and docs**

```js
"scripts": {
  "dev": "node --watch src/server.js",
  "smoke": "node scripts/smoke-analysis.js"
}
```

**Step 4: Run all verification commands**

Run: `npm --prefix V2-Agent-backend test`
Run: `npm --prefix V2-Agent-backend run smoke`

Expected: PASS and smoke stream prints the full event sequence.

**Step 5: Commit**

```bash
git add V2-Agent-backend
git commit -m "完成 V2 GIS Agent 可运行交付"
```
