# Architecture Mode Selector Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the V1/V2 architecture selector so it matches the existing glassmorphism control bar and reads as a mode switch instead of a native form field.

**Architecture:** Replace the current native `select` with a segmented pill toggle component in Vue. Preserve the same `v-model` contract so the rest of the app remains untouched, and only adjust surrounding control-bar spacing where necessary.

**Tech Stack:** Vue 3 (`<script setup>`), scoped CSS, Vitest, Vue Test Utils.

---

### Task 1: Lock the new selector behavior with tests

**Files:**
- Modify: `src/components/__tests__/ArchitectureModeSelect.spec.js`

**Step 1: Write the failing test**

Add assertions for:
- two visible segment buttons
- active state class for current mode
- `update:modelValue` on clicking `v2`

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/__tests__/ArchitectureModeSelect.spec.js`

**Step 3: Write minimal implementation**

Replace the native `select` with two button segments while keeping the same `v-model`.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/components/__tests__/ArchitectureModeSelect.spec.js`

**Step 5: Commit**

```bash
git add src/components/ArchitectureModeSelect.vue src/components/__tests__/ArchitectureModeSelect.spec.js src/components/ControlPanel.vue docs/plans/2026-03-09-architecture-mode-selector-polish.md
git commit -m "重做架构切换器样式并贴合控制栏风格"
```
