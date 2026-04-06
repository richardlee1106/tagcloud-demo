# V3 Spatial LLM Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the trained V3 spatial encoder into a reliable, LLM-agnostic spatial intelligence addon that powers spatial retrieval, evidence generation, and spatial RAG across models.

**Architecture:** Split the work into four layers: encoder runtime, addon API, spatial RAG orchestration, and evaluation. First recover the real trained encoder runtime and expose stable health/capability metadata. Then wrap it behind reusable APIs that any LLM pipeline can call for coordinate encoding, spatial evidence enrichment, retrieval context, and future intent-aware query fusion.

**Tech Stack:** Python, FastAPI, Node.js, Fastify, Vitest, unittest, pgvector, FAISS, GeoJSON

---

### Task 1: Recover the real trained encoder runtime

**Files:**
- Modify: `V3-GeoEncoder-RAG/services/spatialEncoderService.py`
- Test: `V3-GeoEncoder-RAG/services/tests/test_spatial_encoder_service.py`

**Step 1: Write the failing test**

- Add tests that prove checkpoint architecture must be inferred from the saved weights.
- Add tests that prove `poi_encoder/best_model.pt` maps to the stronger `ultimate` architecture.
- Add tests that prove `v26_pro/best_model.pt` maps to the MLP architecture.

**Step 2: Run test to verify it fails**

Run: `python -m unittest V3-GeoEncoder-RAG.services.tests.test_spatial_encoder_service`

Expected: FAIL because the helper functions do not exist yet.

**Step 3: Write minimal implementation**

- Add checkpoint inspection helpers.
- Add architecture-aware builder selection.
- Add model metadata to encoder state.
- Load `ultimate` checkpoints with `build_ultimate_encoder()` and MLP checkpoints with `build_mlp_encoder()`.
- Fallback cleanly across multiple saved model candidates.

**Step 4: Run test to verify it passes**

Run: `python -m unittest V3-GeoEncoder-RAG.services.tests.test_spatial_encoder_service`

Expected: PASS

**Step 5: Commit**

```bash
git add V3-GeoEncoder-RAG/services/spatialEncoderService.py V3-GeoEncoder-RAG/services/tests/test_spatial_encoder_service.py
git commit -m "fix: recover V3 encoder runtime with architecture-aware checkpoint loading"
```

### Task 2: Harden encoder readiness semantics for addon callers

**Files:**
- Modify: `V3-GeoEncoder-RAG/services/spatialEncoderClient.js`
- Test: `V3-GeoEncoder-RAG/services/__tests__/spatialEncoderClient.spec.js`

**Step 1: Write the failing test**

- Add a test proving `encoder_not_loaded` is not treated as encoder-ready.
- Add a test proving `status=ok && encoder_loaded=true` is treated as ready.
- Add a test proving addon callers can read capability metadata from health/status responses.

**Step 2: Run test to verify it fails**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/spatialEncoderClient.spec.js`

Expected: FAIL because current client only checks HTTP 200.

**Step 3: Write minimal implementation**

- Add response parsing helpers for health/capabilities.
- Make `isSpatialEncoderRunning()` require real encoder readiness instead of any 200 response.
- Return richer status metadata to higher-level orchestrators.

**Step 4: Run test to verify it passes**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/spatialEncoderClient.spec.js`

Expected: PASS

**Step 5: Commit**

```bash
git add V3-GeoEncoder-RAG/services/spatialEncoderClient.js V3-GeoEncoder-RAG/services/__tests__/spatialEncoderClient.spec.js
git commit -m "fix: require real V3 encoder readiness for addon clients"
```

### Task 3: Promote the encoder to a reusable spatial addon API

**Files:**
- Modify: `V3-GeoEncoder-RAG/services/spatialEncoderService.py`
- Modify: `V3-GeoEncoder-RAG/services/spatialEncoderClient.js`
- Test: `V3-GeoEncoder-RAG/services/tests/test_spatial_encoder_service.py`

**Step 1: Write the failing test**

- Add a test for capability metadata returned by `/health` or `/capabilities`.
- Add a test for model path, architecture, embedding dimension, and supported features being exposed.

**Step 2: Run test to verify it fails**

Run: `python -m unittest V3-GeoEncoder-RAG.services.tests.test_spatial_encoder_service`

Expected: FAIL because current health response is too thin.

**Step 3: Write minimal implementation**

- Extend health/status payload to include architecture, checkpoint path, embedding dimension, and supported endpoints.
- Add a dedicated capability response if needed.
- Keep backward compatibility for current V3 callers.

**Step 4: Run test to verify it passes**

Run: `python -m unittest V3-GeoEncoder-RAG.services.tests.test_spatial_encoder_service`

Expected: PASS

**Step 5: Commit**

```bash
git add V3-GeoEncoder-RAG/services/spatialEncoderService.py V3-GeoEncoder-RAG/services/spatialEncoderClient.js V3-GeoEncoder-RAG/services/tests/test_spatial_encoder_service.py
git commit -m "feat: expose V3 encoder capability metadata for external LLM addons"
```

### Task 4: Add a generic spatial RAG context contract

**Files:**
- Modify: `V3-GeoEncoder-RAG/server.js`
- Create: `V3-GeoEncoder-RAG/services/spatialRagContextService.js`
- Test: `V3-GeoEncoder-RAG/services/__tests__/spatialRagContextService.spec.js`

**Step 1: Write the failing test**

- Add a test proving a generic request can return anchor, query embedding status, spatial evidence summary, and top spatial contexts without forcing chat generation.

**Step 2: Run test to verify it fails**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/spatialRagContextService.spec.js`

Expected: FAIL because the service does not exist yet.

**Step 3: Write minimal implementation**

- Extract a reusable “spatial context only” service from the current ask/search path.
- Return a model-agnostic payload that another LLM can consume directly.
- Keep chat generation optional.

**Step 4: Run test to verify it passes**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/spatialRagContextService.spec.js`

Expected: PASS

**Step 5: Commit**

```bash
git add V3-GeoEncoder-RAG/server.js V3-GeoEncoder-RAG/services/spatialRagContextService.js V3-GeoEncoder-RAG/services/__tests__/spatialRagContextService.spec.js
git commit -m "feat: add model-agnostic spatial rag context API"
```

### Task 5: Add intent-aware query fusion on top of the anchor encoder

**Files:**
- Modify: `V3-GeoEncoder-RAG/services/queryEmbeddingService.js`
- Modify: `V3-GeoEncoder-RAG/services/intentService.js`
- Test: `V3-GeoEncoder-RAG/services/__tests__/queryEmbeddingService.spec.js`

**Step 1: Write the failing test**

- Add a test proving same-anchor different-intent requests do not collapse to the same fused query embedding.
- Add a test proving intent fusion remains backward compatible when no intent signal is available.

**Step 2: Run test to verify it fails**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/queryEmbeddingService.spec.js`

Expected: FAIL because current implementation only encodes anchor coordinates.

**Step 3: Write minimal implementation**

- Keep the anchor encoder as the geometric backbone.
- Add an intent feature adapter that converts structured intent into a lightweight spatial preference vector.
- Fuse anchor embedding and intent adapter output with explicit provenance metadata.

**Step 4: Run test to verify it passes**

Run: `npx vitest run V3-GeoEncoder-RAG/services/__tests__/queryEmbeddingService.spec.js`

Expected: PASS

**Step 5: Commit**

```bash
git add V3-GeoEncoder-RAG/services/queryEmbeddingService.js V3-GeoEncoder-RAG/services/intentService.js V3-GeoEncoder-RAG/services/__tests__/queryEmbeddingService.spec.js
git commit -m "feat: add intent-aware fusion for V3 spatial query embeddings"
```

### Task 6: Build an evaluation harness for spatial-LLM utility

**Files:**
- Create: `V3-GeoEncoder-RAG/scripts/evaluate_spatial_llm_stack.py`
- Create: `reports/`
- Test: manual benchmark runs documented in the report

**Step 1: Define evaluation slices**

- Runtime health and encoder readiness
- Retrieval quality with and without query embedding
- Boundary evidence quality
- Same-anchor different-intent sensitivity
- LLM-facing context completeness

**Step 2: Implement the harness**

- Save metrics and qualitative examples.
- Emit markdown summaries into `reports/`.

**Step 3: Run the evaluation**

Run: `python V3-GeoEncoder-RAG/scripts/evaluate_spatial_llm_stack.py`

Expected: report files generated under `reports/`

**Step 4: Commit**

```bash
git add V3-GeoEncoder-RAG/scripts/evaluate_spatial_llm_stack.py reports/
git commit -m "feat: add evaluation harness for V3 spatial llm stack"
```

Plan complete and saved to `docs/plans/2026-03-23-v3-spatial-llm-platform.md`. I’m taking the recommended path and executing the first phase in this session: recover the real encoder runtime and harden addon readiness before moving up the stack.
