# Phase 2 Buffer Artifact Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote `buffer_export_workflow` onto the new-agent path with an explicit artifact contract and regression coverage.

**Architecture:** Keep the orchestrator as the only public entry point, add a dedicated buffer export agent that executes a fixed clip-buffer-merge-export pipeline, and emit a richer artifact object only when the artifact truly exists. Preserve all non-buffer fallback behavior and update the standalone Phase 2 rollout/parity/fallback docs to reflect the promotion.

**Tech Stack:** Node.js 22, Fastify, built-in `node:test`, existing tool registry and DSL execution runtime, markdown docs under `docs/`.

---

### Task 1: Add failing tests for buffer export new path

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/analysis-route.test.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/intent-router-agent.test.js`
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/buffer-coverage-agent.test.js`

**Step 1: Write the failing tests**

```js
assert.equal(fastResult.data.execution_path, 'new_agent')
assert.equal(fastResult.data.objective, 'buffer_export_workflow')
assert.equal(fastResult.data.artifact.exists, true)
assert.equal(fastResult.data.artifact.type, 'geojson')
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js tests/buffer-coverage-agent.test.js`
Expected: FAIL because `buffer_export_workflow` still falls back to legacy and no dedicated buffer agent exists.

### Task 2: Implement buffer export agent and artifact contract

**Files:**
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/agents/buffer-coverage-agent.js`
- Create: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/contracts/artifact-contract.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/agents/intent-router-agent.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/orchestrator/task-orchestrator.js`

**Step 1: Implement the failing unit target**

```js
export async function executeBufferExportWorkflow(...) {
  return {
    artifact: {
      exists: true,
      type: 'geojson',
      path,
      delivery_mode: 'path'
    }
  }
}
```

**Step 2: Run targeted tests**

Run: `node --test tests/analysis-route.test.js tests/intent-router-agent.test.js tests/buffer-coverage-agent.test.js`
Expected: PASS

### Task 3: Update current-state docs

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-objective-rollout-matrix.md`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-fallback-matrix.md`

**Step 1: Update rows to mark buffer export as promoted**

**Step 2: Verify docs are readable**

Run: `Get-Content -Raw D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-objective-rollout-matrix.md`
Expected: `buffer_export_workflow` row shows `new_agent`.

### Task 4: Full verification and commit

**Files:**
- Test: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/*.test.js`

**Step 1: Run full suite**

Run: `npm test`
Expected: PASS with 0 failures

**Step 2: Commit**

```bash
git add V2-Agent-backend/src/agents/buffer-coverage-agent.js V2-Agent-backend/src/contracts/artifact-contract.js V2-Agent-backend/src/agents/intent-router-agent.js V2-Agent-backend/src/orchestrator/task-orchestrator.js V2-Agent-backend/tests/analysis-route.test.js V2-Agent-backend/tests/intent-router-agent.test.js V2-Agent-backend/tests/buffer-coverage-agent.test.js V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md V2-Agent-backend/docs/phase2-objective-rollout-matrix.md V2-Agent-backend/docs/phase2-fallback-matrix.md V2-Agent-backend/docs/plans/2026-03-09-phase2-buffer-artifact-alignment.md
git commit -m "feat(v2-agent): promote buffer export workflow"
```
