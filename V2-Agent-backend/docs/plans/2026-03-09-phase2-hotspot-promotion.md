# Phase 2 Hotspot Promotion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote `hotspot_analysis` onto the new-agent path using the existing hotspot specialist and objective routing.

**Architecture:** Reuse the existing hotspot specialist logic from the area briefing flow, add a dedicated objective branch in the orchestrator, and keep `opportunity_discovery` and `coverage_gap_analysis` on legacy fallback. Update the standalone Phase 2 matrix docs after the runtime behavior is verified.

**Tech Stack:** Node.js 22, Fastify, built-in `node:test`, existing orchestrator and agent modules, markdown docs under `docs/`.

---

### Task 1: Add failing tests for hotspot promotion

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/analysis-route.test.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/intent-router-agent.test.js`

**Step 1: Write the failing tests**

```js
assert.equal(fastResult.data.execution_path, 'new_agent')
assert.equal(fastResult.data.objective, 'hotspot_analysis')
assert.equal(fastResult.data.answer.sections[0].key, 'hotspots')
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js`
Expected: FAIL because `hotspot_analysis` is still on legacy.

### Task 2: Implement hotspot objective branch

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/agents/intent-router-agent.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/orchestrator/task-orchestrator.js`

**Step 1: Promote hotspot objective into the allowlist**

**Step 2: Add dedicated hotspot objective execution branch using existing `analyzeHotspots`**

**Step 3: Run focused tests**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js`
Expected: PASS

### Task 3: Update current-state docs

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-objective-rollout-matrix.md`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-fallback-matrix.md`

### Task 4: Verify and commit

**Step 1: Run `npm test`**

**Step 2: Commit**

```bash
git add V2-Agent-backend/src/agents/intent-router-agent.js V2-Agent-backend/src/orchestrator/task-orchestrator.js V2-Agent-backend/tests/analysis-route.test.js V2-Agent-backend/tests/intent-router-agent.test.js V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md V2-Agent-backend/docs/phase2-objective-rollout-matrix.md V2-Agent-backend/docs/phase2-fallback-matrix.md V2-Agent-backend/docs/plans/2026-03-09-phase2-hotspot-promotion.md
git commit -m "feat(v2-agent): promote hotspot analysis"
```
