# Phase 2 Opportunity Promotion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote `opportunity_discovery` onto the new-agent path using the existing opportunity specialist.

**Architecture:** Reuse the existing opportunity specialist logic from the area briefing flow, add a dedicated objective branch in the orchestrator, and keep `coverage_gap_analysis` on legacy fallback until its dedicated grounding strategy is built.

**Tech Stack:** Node.js 22, Fastify, built-in `node:test`, existing orchestrator and agent modules, markdown docs under `docs/`.

---

### Task 1: Add failing tests for opportunity promotion

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/analysis-route.test.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/tests/intent-router-agent.test.js`

### Task 2: Implement opportunity objective branch

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/agents/intent-router-agent.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/src/orchestrator/task-orchestrator.js`

### Task 3: Update current-state docs

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-objective-rollout-matrix.md`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V2-Agent-backend/docs/phase2-fallback-matrix.md`

### Task 4: Verify and commit

**Step 1: Run `npm test`**

**Step 2: Commit**

```bash
git add V2-Agent-backend/src/agents/intent-router-agent.js V2-Agent-backend/src/orchestrator/task-orchestrator.js V2-Agent-backend/tests/analysis-route.test.js V2-Agent-backend/tests/intent-router-agent.test.js V2-Agent-backend/docs/phase2-v1-v2-capability-parity-matrix.md V2-Agent-backend/docs/phase2-objective-rollout-matrix.md V2-Agent-backend/docs/phase2-fallback-matrix.md V2-Agent-backend/docs/plans/2026-03-09-phase2-opportunity-promotion.md
git commit -m "feat(v2-agent): promote opportunity discovery"
```
