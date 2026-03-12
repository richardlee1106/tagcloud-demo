# Phase 2 Compare Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first Phase 2 capability-alignment slice by introducing a new-agent `compare_analysis` path plus parity/rollout documentation and regression tests.

**Architecture:** Keep the Phase 1 orchestrator as the single entry point, extend objective routing to allowlist `compare_analysis`, and add a dedicated compare specialist plus compare narrative branch. Preserve legacy fallback for export and coverage workflows, and document the current V1/V2 parity and rollout boundaries in new standalone files rather than editing the user's in-progress design docs.

**Tech Stack:** Node.js 22, Fastify, built-in `node:test`, existing orchestrator/agent runtime, markdown docs under `docs/`.

---

### Task 1: Add failing tests for compare objective routing and SSE output

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/analysis-route.test.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/intent-router-agent.test.js`
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/compare-agent.test.js`

**Step 1: Write the failing tests**

```js
assert.equal(fastResult.data.execution_path, 'new_agent')
assert.equal(fastResult.data.objective, 'compare_analysis')
assert.equal(fastResult.data.answer.sections[0].key, 'comparison')
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js tests/compare-agent.test.js`
Expected: FAIL because `compare_analysis` still falls back to legacy and compare agent module does not exist.

**Step 3: Write minimal implementation**

```js
export const OBJECTIVE_ALLOWLIST = new Set(['area_briefing', 'compare_analysis'])
```

**Step 4: Run test to verify the failure moved**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js tests/compare-agent.test.js`
Expected: FAIL on missing compare narrative/output details until the orchestrator branch is added.

**Step 5: Commit**

```bash
git add V2-Agent-backend/tests/analysis-route.test.js V2-Agent-backend/tests/intent-router-agent.test.js V2-Agent-backend/tests/compare-agent.test.js
git commit -m "test(v2-agent): add compare analysis regression coverage"
```

### Task 2: Implement compare specialist and orchestrator branch

**Files:**
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/agents/compare-agent.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/agents/intent-router-agent.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/agents/narrative-writer-agent.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/common/capabilities.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/orchestrator/task-orchestrator.js`

**Step 1: Write the failing test for compare agent behavior**

```js
assert.equal(result.section_type, 'comparison')
assert.equal(result.metrics.delta, 1)
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/compare-agent.test.js`
Expected: FAIL because `compare-agent.js` does not exist or returns no structured comparison section.

**Step 3: Write minimal implementation**

```js
export function analyzeCompare({ groundingResult, objectiveContract }) {
  return {
    section_type: 'comparison',
    claims: [...],
    metrics: { west, east, delta },
    summary_text: ...
  }
}
```

**Step 4: Extend orchestrator to branch by objective**

```js
if (routingOutput.objective === 'compare_analysis') {
  return analyzeCompareObjective(...)
}
```

**Step 5: Run tests**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js tests/compare-agent.test.js`
Expected: PASS

### Task 3: Add parity and rollout matrix docs for the current implementation state

**Files:**
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md`
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-objective-rollout-matrix.md`
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-fallback-matrix.md`

**Step 1: Write the docs**

```md
| capability | v1 | v2 current | notes |
|---|---|---|---|
| compare_analysis | yes | phase2-slice1 | new agent path enabled |
```

**Step 2: Verify files exist and content is readable**

Run: `Get-Content -Raw D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md`
Expected: readable markdown with current-state rows, not future-tense handwaving.

**Step 3: Commit**

```bash
git add V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md V2-Agent-backend/docs/phase2-objective-rollout-matrix.md V2-Agent-backend/docs/phase2-fallback-matrix.md
git commit -m "docs(v2-agent): add phase2 rollout and parity matrices"
```

### Task 4: Run full verification for the slice

**Files:**
- Test: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/*.test.js`

**Step 1: Run focused compare tests**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js tests/compare-agent.test.js`
Expected: PASS

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS with 0 failures

**Step 3: Check git status**

Run: `git -C D:/AAA_Edu/TagCloud/vite-project status --short`
Expected: only intended Phase 2 files changed, and the user's pre-existing dirty docs remain untouched unless newly created standalone docs were added.

**Step 4: Commit**

```bash
git add V2-Agent-backend/src/agents/compare-agent.js V2-Agent-backend/src/agents/intent-router-agent.js V2-Agent-backend/src/agents/narrative-writer-agent.js V2-Agent-backend/src/common/capabilities.js V2-Agent-backend/src/orchestrator/task-orchestrator.js V2-Agent-backend/tests/analysis-route.test.js V2-Agent-backend/tests/intent-router-agent.test.js V2-Agent-backend/tests/compare-agent.test.js V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md V2-Agent-backend/docs/phase2-objective-rollout-matrix.md V2-Agent-backend/docs/phase2-fallback-matrix.md
git commit -m "feat(v2-agent): add compare analysis phase2 slice"
```
