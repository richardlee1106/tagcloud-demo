# Pill Switch And V2 Fetch Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the architecture selector into a true two-segment pill switch and harden V2 requests so network-path issues no longer surface as a generic `Failed to fetch`.

**Architecture:** Keep the existing `v-model` contract for architecture mode, but simplify the selector markup into a two-button segmented control with glass outer chrome and a distinct active pill. In parallel, add a V2 request fallback path that retries through the dev proxy when the direct base fails, and improve the surfaced error so the UI can distinguish V2 reachability issues from backend application errors.

**Tech Stack:** Vue 3 (`<script setup>`), scoped CSS, Vitest, Vue Test Utils, Vite dev proxy, browser `fetch`.

---

### Task 1: Lock the pill switch markup and behavior

**Files:**
- Modify: `src/components/__tests__/ArchitectureModeSelect.spec.js`
- Modify: `src/components/ArchitectureModeSelect.vue`

**Step 1: Write the failing test**

Add assertions for:
- exactly two segment buttons with labels `V1` and `V2`
- no legacy prefix block rendered
- active segment class reflects `modelValue`

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/__tests__/ArchitectureModeSelect.spec.js`

Expected: FAIL because the legacy prefix markup is still present and labels do not match the two-segment pill design.

**Step 3: Write minimal implementation**

Update the component template and scoped CSS so the selector renders as a true two-segment pill switch while preserving `update:modelValue`.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/components/__tests__/ArchitectureModeSelect.spec.js`

Expected: PASS

### Task 2: Lock V2 network fallback before implementation

**Files:**
- Modify: `src/utils/__tests__/aiServiceV2Stream.spec.js`
- Modify: `vite.config.js`
- Modify: `src/utils/aiService.js`

**Step 1: Write the failing test**

Add a regression test that:
- calls `sendChatMessageStream(..., { architectureMode: 'v2' })`
- makes the first fetch reject with `TypeError('Failed to fetch')`
- expects a retry against `/proxy-api-v2/api/v2/analysis`
- expects streamed V2 output to still complete

**Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/__tests__/aiServiceV2Stream.spec.js`

Expected: FAIL because no V2 retry exists yet.

**Step 3: Write minimal implementation**

Implement a V2 fetch helper that:
- tries the configured V2 base first
- retries through `/proxy-api-v2` for network-level failures
- preserves existing SSE parsing behavior

Also add the corresponding Vite dev proxy entry for `/proxy-api-v2`.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/__tests__/aiServiceV2Stream.spec.js`

Expected: PASS

### Task 3: Verify the focused regression set

**Files:**
- Modify: `src/components/ControlPanel.vue`

**Step 1: Run the focused selector and V2 tests**

Run: `npm test -- src/components/__tests__/ArchitectureModeSelect.spec.js src/utils/__tests__/aiServiceV2Stream.spec.js`

**Step 2: Run one broader confidence check**

Run: `npm test -- src/utils/__tests__/aiServiceStreamError.spec.js`

**Step 3: Adjust spacing if the new pill switch needs control-bar alignment tweaks**

Keep layout changes minimal and local to the control bar.

**Step 4: Re-run the same commands**

Expected: PASS
