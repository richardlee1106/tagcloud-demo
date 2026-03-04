# Phase D Routing Critic Calibration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete Phase D by delivering critic sync/async routing, frontier emulation observability, and complexity recalibration outputs across Node and Python.

**Architecture:** Keep runtime behavior centralized in `spatialJobRunner` while exposing observability through `telemetry` and `ops` routes. Reuse existing validation/context/prefetch scaffolding and add bounded in-memory audit storage for async critic records.

**Tech Stack:** Node.js (Fastify, node:test), Python 3 (unittest), in-repo telemetry aggregation scripts.

---

### Task 1: Back-end Critic Routing (BE-D1 + BE-D3)

**Files:**
- Modify: `fastify-backend/services/spatialJobRunner.js`
- Create: `fastify-backend/services/opsAuditStore.js`
- Modify: `fastify-backend/routes/ops/index.js`
- Test: `fastify-backend/tests/criticRoutingPolicy.test.mjs`

**Step 1: Write failing tests**
- Add tests for:
  - `critical` -> `critic_mode=sync`
  - `high` -> `critic_mode=async`
  - `frontier` tier emulation -> `frontier_emulated=true` + effective tier `medium`
  - sync critic failure returns blocking outcome.

**Step 2: Run tests to verify failure**
- Run: `node --test fastify-backend/tests/criticRoutingPolicy.test.mjs`

**Step 3: Implement minimal behavior**
- Add routing decision helper (`off|async|sync`).
- Add frontier emulation helper and telemetry/log hooks.
- Add sync critic gate before compute execution.
- Add async critic audit write path to `opsAuditStore`.
- Add `/api/ops/audit` endpoint.

**Step 4: Re-run tests**
- Run: `node --test fastify-backend/tests/criticRoutingPolicy.test.mjs`

### Task 2: Complexity Recalibration Loop (BE-D2)

**Files:**
- Modify: `fastify-backend/services/telemetry.js`
- Create: `fastify-backend/scripts/recalibrate_complexity.js`
- Modify: `fastify-backend/scripts/kpi_report.js`
- Modify: `fastify-backend/package.json`
- Test: `fastify-backend/tests/telemetryComplexityCalibration.test.mjs`

**Step 1: Write failing tests**
- Add test covering telemetry complexity calibration report with:
  - query_type grouping
  - latency/failure/critic-hit derived recommendation
  - suggested complexity delta.

**Step 2: Run tests to verify failure**
- Run: `node --test fastify-backend/tests/telemetryComplexityCalibration.test.mjs`

**Step 3: Implement minimal behavior**
- Add telemetry report builder for complexity calibration.
- Add script that fetches ops calibration API and writes JSON/Markdown report.
- Register script in `package.json`.

**Step 4: Re-run tests**
- Run: `node --test fastify-backend/tests/telemetryComplexityCalibration.test.mjs`

### Task 3: Python Critic Payload Normalization (PY-D1)

**Files:**
- Modify: `fastify-backend/python_service/pipeline/self_validator.py`
- Modify: `fastify-backend/python_service/pipeline/spatial_pipeline.py`
- Modify: `fastify-backend/python_service/tests/test_spatial_pipeline.py`

**Step 1: Write failing test**
- Add test asserting FINAL payload contains normalized critic fields:
  - `critic_pass`
  - `critic_reasons`
  - `critic_fix_suggestions`
  - `critic_confidence`.

**Step 2: Run test to verify failure**
- Run: `python -m pytest fastify-backend/python_service/tests/test_spatial_pipeline.py -k critic -q`

**Step 3: Implement minimal behavior**
- Build critic summary from self-validation output.
- Surface normalized fields into `results.stats` and `diagnostics`.

**Step 4: Re-run tests**
- Run: `python -m pytest fastify-backend/python_service/tests/test_spatial_pipeline.py -k critic -q`

### Task 4: Full Verification and Regression Sweep

**Files:**
- Verify only

**Step 1: Backend syntax and tests**
- Run: `node --check fastify-backend/services/spatialJobRunner.js`
- Run: `node --check fastify-backend/routes/ops/index.js`
- Run: `node --test fastify-backend/tests/*.mjs`

**Step 2: Python compile and tests**
- Run: `python -m py_compile fastify-backend/python_service/pipeline/spatial_pipeline.py`
- Run: `python -m py_compile fastify-backend/python_service/pipeline/self_validator.py`
- Run: `python -m pytest fastify-backend/python_service/tests/test_spatial_pipeline.py -q`

**Step 3: Smoke script checks**
- Run: `node fastify-backend/scripts/recalibrate_complexity.js --window=14d`

**Step 4: Review against Phase D checklist**
- Confirm BE-D1, BE-D2, BE-D3, PY-D1 acceptance criteria mapping.
