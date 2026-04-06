# V4 Realtime LBS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 给 V4 增加浏览器实时定位 LBS 能力，让“我附近 / 离我最近”能基于真实位置严谨工作。

**Architecture:** 前端通过浏览器 geolocation 获取单次位置并注入 `spatialContext.userLocation`；V4 路由和智能体把它视为 `user_location` synthetic anchor，复用现有 PostGIS 和 route_distance 查询链。

**Tech Stack:** Vue 3, Vitest, Fastify, TypeScript, PostGIS, MiniMax Anthropic-compatible orchestration

---

### Task 1: 协议与请求构造

**Files:**
- Modify: `src/composables/ai/useSpatialRequestBuilder.js`
- Test: `src/composables/ai/__tests__/useSpatialRequestBuilder.spec.js`

**Step 1: Write the failing test**

- 新增 `userLocation` 注入测试
- 断言 `buildSpatialContext()` 会保留 `lon/lat/accuracyM/source/capturedAt`

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/ai/__tests__/useSpatialRequestBuilder.spec.js`

**Step 3: Write minimal implementation**

- 为 `buildSpatialContext()` 增加 `userLocation` 标准化逻辑

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/ai/__tests__/useSpatialRequestBuilder.spec.js`

---

### Task 2: AiChat 前端定位体验

**Files:**
- Modify: `src/components/AiChat.vue`
- Test: `src/components/__tests__/AiChatV4.spec.js`

**Step 1: Write the failing test**

- 验证 V4 UI 出现“使用当前位置”入口
- 验证定位成功后发送消息时会带 `spatialContext.userLocation`
- 验证无定位权限时有用户可见提示

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/__tests__/AiChatV4.spec.js`

**Step 3: Write minimal implementation**

- 添加 geolocation 状态机
- 添加定位按钮和状态文案
- 在发消息时将最近一次定位注入 `buildSpatialContext()`

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/__tests__/AiChatV4.spec.js`

---

### Task 3: V4 路由识别 user_location 锚点

**Files:**
- Modify: `V4-GeoLoom-beta/src/chat/types.ts`
- Modify: `V4-GeoLoom-beta/src/chat/DeterministicRouter.ts`
- Test: `V4-GeoLoom-beta/tests/unit/chat/DeterministicRouter.spec.ts`

**Step 1: Write the failing test**

- 测试 `我附近有哪些咖啡店` 在存在 `userLocation` 时可被识别为 `nearby_poi`
- 测试 `离我最近的地铁站` 在存在 `userLocation` 时可被识别为 `nearest_station`
- 测试无 `userLocation` 时返回授权/补地点提示

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta && npx vitest run tests/unit/chat/DeterministicRouter.spec.ts`

**Step 3: Write minimal implementation**

- 增加 `anchorSource`
- 读取 `request.options.spatialContext.userLocation`
- 支持 `我附近 / 离我最近 / 从我这里`

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta && npx vitest run tests/unit/chat/DeterministicRouter.spec.ts`

---

### Task 4: GeoLoomAgent 支持 synthetic user anchor

**Files:**
- Modify: `V4-GeoLoom-beta/src/agent/GeoLoomAgent.ts`
- Test: `V4-GeoLoom-beta/tests/integration/routes/chat.spec.ts`

**Step 1: Write the failing test**

- 为 `/api/geo/chat` 新增携带 `userLocation` 的“我附近咖啡店”与“离我最近地铁站”用例
- 断言流式结果不再要求 placeName 澄清

**Step 2: Run test to verify it fails**

Run: `cd V4-GeoLoom-beta && npx vitest run tests/integration/routes/chat.spec.ts`

**Step 3: Write minimal implementation**

- 从 `request.options.spatialContext.userLocation` 构造 synthetic anchor
- 让核心 recovery/template SQL 直接复用该 anchor

**Step 4: Run test to verify it passes**

Run: `cd V4-GeoLoom-beta && npx vitest run tests/integration/routes/chat.spec.ts`

---

### Task 5: 联调验证与文档回写

**Files:**
- Modify: `docs/plans/2026-04-02-v4-phase8-3.md`
- Modify: `docs/plans/2026-04-01-v4-geo-agent-开发计划文档.md`
- Modify: `C:/Users/Richard/Desktop/V4开发计划-0401.md`

**Step 1: Run targeted verification**

Run:

- `npx vitest run src/composables/ai/__tests__/useSpatialRequestBuilder.spec.js src/components/__tests__/AiChatV4.spec.js`
- `cd V4-GeoLoom-beta && npx vitest run tests/unit/chat/DeterministicRouter.spec.ts tests/integration/routes/chat.spec.ts`

**Step 2: Run broader safety verification**

Run:

- `cd V4-GeoLoom-beta && npm test`
- `npm test`
- `npx vite build --mode v4`

**Step 3: Write docs**

- 记录实时定位 LBS 的新增能力、边界、实测命令与结果

**Step 4: Final review**

- 确认没有把“地点锚点查询”和“实时 LBS 查询”混写
