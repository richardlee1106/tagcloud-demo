# V3 L5 Boundary Evidence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the V3 placeholder boundary evidence with V3-native L5 vector boundary, region, and fuzzy-layer generation.

**Architecture:** Keep the existing V3 L6 ask/search pipeline intact, but move geometric evidence generation into a V3-only helper that builds polygons from V3 result points and `spatialContext`. Do not call or reuse the V1 Python boundary pipeline; only borrow ideas from its design. The output must stay compatible with the current frontend SSE schema (`boundary`, `spatial_clusters`, `vernacular_regions`, `fuzzy_regions`, `stats`, `refined_result`).

**Tech Stack:** Node.js, Fastify, Vitest, GeoJSON, lightweight in-process geometry utilities

---

### Task 1: Lock the desired V3 L5 behavior with failing tests

**Files:**
- Modify: `V3-GeoEncoder-RAG/services/__tests__/chatPipeline.spec.js`

**Step 1: Write failing tests**

- Add a test proving V3 builds region-specific boundaries instead of reusing a single global boundary for every region.
- Add a test proving V3 emits fuzzy multi-layer boundary evidence and geometry-related stats.

**Step 2: Run test to verify it fails**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/chatPipeline.spec.js`

Expected: FAIL because current `buildSpatialEvidence()` reuses one boundary and returns an empty `fuzzyRegions` array.

### Task 2: Add a V3-only geometry evidence helper

**Files:**
- Create: `V3-GeoEncoder-RAG/services/spatialEvidenceService.js`
- Modify: `V3-GeoEncoder-RAG/services/chatPipeline.js`

**Step 1: Implement minimal geometry primitives**

- Add coordinate normalization helpers.
- Add convex-hull generation for point sets.
- Add fallback padded boundary generation for sparse/degenerate point sets.
- Add polygon scaling utilities for outer/transition/core layers.

**Step 2: Build structured V3 evidence generators**

- Build overall boundary generation from search results when the user did not provide an explicit polygon.
- Build per-region boundaries from `regionLabel` groups.
- Build hotspot evidence from grouped results.
- Build fuzzy multi-layer evidence from the generated boundary.
- Emit geometry stats such as method name, source, and generated region counts.

**Step 3: Integrate into `chatPipeline.js`**

- Keep `deriveSpatialAnchor()` and intent gating untouched.
- Replace bbox-only placeholder logic in `buildSpatialEvidence()` with calls into the new V3 helper.
- Preserve the frontend-facing payload shape.

### Task 3: Verify V3 regression safety

**Files:**
- Modify if needed: `V3-GeoEncoder-RAG/services/__tests__/chatPipeline.spec.js`
- Modify if needed: `V3-GeoEncoder-RAG/services/__tests__/frontendDataService.spec.js`

**Step 1: Run targeted tests**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/frontendDataService.spec.js`

Expected: PASS

**Step 2: Sanity-check the SSE output contract**

- Ensure `boundary`, `spatial_clusters`, `vernacular_regions`, `fuzzy_regions`, `stats`, and `refined_result` still exist.
- Ensure no V1-only runtime dependency was introduced.
