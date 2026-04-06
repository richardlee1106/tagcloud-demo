# Dual Model Semantic Retrieval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make V3 retrieval understand entity semantics from names/brands instead of category labels alone, and ensure both `poi_encoder` and `town_encoder` are actually used on the main query path with observable routing metadata.

**Architecture:** Introduce an entity ontology layer for query/candidate concept inference, fix and extend the Python spatial encoder service into a dual-model runtime that loads both POI and town checkpoints, and blend cell-context signals into the existing POI retrieval path. Keep POI offline embeddings as the fine-grained retrieval backbone while using town/cell embeddings for macro-context scoring and route selection.

**Tech Stack:** Node.js (Fastify/Vitest), Python (FastAPI/Torch), PostgreSQL/PostGIS, H3.

---

### Task 1: Lock the target behavior with failing tests

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/faissIndex.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/infra/spatialEncoderClient.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/diagnostics/encoderTrace.spec.js`

**Step 1:** Add failing tests for brand/entity inference (`海底捞` -> `火锅` + `中餐`, `巴奴` -> `火锅`, `协和医院` -> `医院`).

**Step 2:** Add a failing test proving orchestrator stats expose both models and routing metadata when cell context is available.

**Step 3:** Add a failing test for health/status normalization that expects dual-model readiness metadata.

**Step 4:** Run targeted Vitest commands and confirm failures are due to missing behavior.

### Task 2: Add entity ontology driven semantic understanding

**Files:**
- Create: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/entityOntology.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/intentService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/faissIndex.js`

**Step 1:** Implement query/candidate concept inference with brand aliases, entity families, and parent concepts.

**Step 2:** Feed ontology inference into intent parsing so subtype/category inference can come from semantic concepts rather than `category_sub` labels alone.

**Step 3:** Replace the simple keyword-only subtype filter with ontology-backed candidate concept matching and semantic boosts.

**Step 4:** Re-run targeted tests and keep changes minimal until green.

### Task 3: Turn the Python service into a real dual-model runtime

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/python/services/spatialEncoderService.py`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/infra/spatialEncoderClient.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/queryEmbeddingService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/runtimeSpatialAugmenter.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialSearchOrchestrator.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/diagnostics/encoderTrace.js`

**Step 1:** Fix repository root resolution so the Python service can actually import `spatial_encoder`.

**Step 2:** Load both checkpoints at startup and precompute town/cell embeddings from the real `cells` dataset.

**Step 3:** Expose cell-context endpoints and dual-model health metadata.

**Step 4:** Call the cell-context runtime from Node, blend macro cell similarity into candidate scoring, and emit model routing / usage stats.

### Task 4: Verify, document, and record delivery boundaries

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**Step 1:** Run targeted tests for ontology, orchestrator, encoder client, and diagnostics.

**Step 2:** Run one live request against `http://127.0.0.1:3300/api/ai/chat` and inspect the structured SSE payload for subtype correctness and model usage fields.

**Step 3:** Update `CHANGELOG.md` with:
- what is fully implemented
- what is partially implemented
- what remains unimplemented
- what is not realistically guaranteed yet
- next-step mitigation plan

**Step 4:** Summarize the result truthfully with explicit caveats.
