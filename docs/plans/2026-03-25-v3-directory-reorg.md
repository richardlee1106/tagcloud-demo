# V3 Directory Reorg Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize `V3-GeoEncoder-RAG` so transient scripts, test assets, and service modules are grouped by responsibility without changing runtime behavior.

**Architecture:** Keep the V3 runtime entrypoint at `server.js`, but move service modules into domain folders (`ai`, `retrieval`, `data`, `infra`, `diagnostics`, `legacy`) and move Python service code under `python/`. Reclassify one-off scripts into cache, data-prep, evaluation, and testing folders, then repair all import paths and script references.

**Tech Stack:** Node.js ESM, Python scripts, Fastify, local filesystem reorganization

---

### Task 1: Create the target folder layout

**Files:**
- Create: `V3-GeoEncoder-RAG/services/ai/`
- Create: `V3-GeoEncoder-RAG/services/retrieval/`
- Create: `V3-GeoEncoder-RAG/services/data/`
- Create: `V3-GeoEncoder-RAG/services/infra/`
- Create: `V3-GeoEncoder-RAG/services/diagnostics/`
- Create: `V3-GeoEncoder-RAG/services/legacy/`
- Create: `V3-GeoEncoder-RAG/services/__tests__/ai/`
- Create: `V3-GeoEncoder-RAG/services/__tests__/retrieval/`
- Create: `V3-GeoEncoder-RAG/services/__tests__/data/`
- Create: `V3-GeoEncoder-RAG/services/__tests__/infra/`
- Create: `V3-GeoEncoder-RAG/services/__tests__/diagnostics/`
- Create: `V3-GeoEncoder-RAG/python/services/`
- Create: `V3-GeoEncoder-RAG/python/tests/`
- Create: `V3-GeoEncoder-RAG/scripts/cache/`
- Create: `V3-GeoEncoder-RAG/scripts/data-prep/`
- Create: `V3-GeoEncoder-RAG/scripts/evaluation/`
- Create: `V3-GeoEncoder-RAG/scripts/testing/`

### Task 2: Move Node service files into domain folders

**Files:**
- Move: `V3-GeoEncoder-RAG/services/chatPipeline.js`
- Move: `V3-GeoEncoder-RAG/services/intentParser.js`
- Move: `V3-GeoEncoder-RAG/services/intentService.js`
- Move: `V3-GeoEncoder-RAG/services/llmService.js`
- Move: `V3-GeoEncoder-RAG/services/spatialAnswerService.js`
- Move: `V3-GeoEncoder-RAG/services/streamService.js`
- Move: `V3-GeoEncoder-RAG/services/database.js`
- Move: `V3-GeoEncoder-RAG/services/frontendDataService.js`
- Move: `V3-GeoEncoder-RAG/services/surfaceDataService.js`
- Move: `V3-GeoEncoder-RAG/services/dockerService.js`
- Move: `V3-GeoEncoder-RAG/services/ollamaRuntimeConfig.js`
- Move: `V3-GeoEncoder-RAG/services/ollamaService.js`
- Move: `V3-GeoEncoder-RAG/services/pythonClient.js`
- Move: `V3-GeoEncoder-RAG/services/spatialEncoderClient.js`
- Move: `V3-GeoEncoder-RAG/services/faissIndex.js`
- Move: `V3-GeoEncoder-RAG/services/queryEmbeddingService.js`
- Move: `V3-GeoEncoder-RAG/services/runtimeSpatialAugmenter.js`
- Move: `V3-GeoEncoder-RAG/services/spatialEvidenceService.js`
- Move: `V3-GeoEncoder-RAG/services/spatialRagContextService.js`
- Move: `V3-GeoEncoder-RAG/services/spatialRerank.js`
- Move: `V3-GeoEncoder-RAG/services/spatialSearchOrchestrator.js`
- Move: `V3-GeoEncoder-RAG/services/encoderTrace.js`
- Move: `V3-GeoEncoder-RAG/services/llmService_backup.js`
- Move: `V3-GeoEncoder-RAG/services/llmService_stream_patch.js`

### Task 3: Move Python service files and tests to Python-specific folders

**Files:**
- Move: `V3-GeoEncoder-RAG/services/spatialEncoderService.py`
- Move: `V3-GeoEncoder-RAG/services/tests/test_spatial_encoder_service.py`

### Task 4: Reclassify scripts by lifecycle

**Files:**
- Move: `V3-GeoEncoder-RAG/scripts/build_embedding_cache.js`
- Move: `V3-GeoEncoder-RAG/scripts/add_spatial_embedding.py`
- Move: `V3-GeoEncoder-RAG/scripts/enhance_poi_data.py`
- Move: `V3-GeoEncoder-RAG/scripts/enhance_region_labels.py`
- Move: `V3-GeoEncoder-RAG/scripts/generate_spatial_embeddings.py`
- Move: `V3-GeoEncoder-RAG/scripts/regenerate_food_embeddings.py`
- Move: `V3-GeoEncoder-RAG/scripts/evaluate_spatial_llm_stack.py`
- Move: `V3-GeoEncoder-RAG/scripts/explore_encoder_capabilities.py`
- Move: `V3-GeoEncoder-RAG/scripts/run_optimized_test.py`
- Move: `V3-GeoEncoder-RAG/scripts/test_optimized_performance.py`
- Move: `V3-GeoEncoder-RAG/scripts/test_region_aware_search.py`
- Move: `V3-GeoEncoder-RAG/scripts/test_rerank_params.py`
- Move: `V3-GeoEncoder-RAG/scripts/test_results_optimized.json`

### Task 5: Repair references after moving files

**Files:**
- Modify: `V3-GeoEncoder-RAG/server.js`
- Modify: `V3-GeoEncoder-RAG/package.json`
- Modify: `V3-GeoEncoder-RAG/README.md`
- Modify: `V3-GeoEncoder-RAG/services/**/*.js`
- Modify: `V3-GeoEncoder-RAG/services/__tests__/**/*.js`
- Modify: `V3-GeoEncoder-RAG/python/tests/test_spatial_encoder_service.py`
- Modify: `V3-GeoEncoder-RAG/scripts/**/*.py`
- Modify: `V3-GeoEncoder-RAG/scripts/**/*.js`

### Task 6: Verify the reorganization

**Files:**
- Verify: `V3-GeoEncoder-RAG/server.js`
- Verify: `V3-GeoEncoder-RAG/package.json`
- Verify: `V3-GeoEncoder-RAG/services/**/*.js`
- Verify: `V3-GeoEncoder-RAG/scripts/**/*.py`
- Verify: `V3-GeoEncoder-RAG/tests/manual/test_5_rounds.js`

Run:
- `node --check V3-GeoEncoder-RAG/server.js`
- `python -m py_compile V3-GeoEncoder-RAG/scripts/testing/run_optimized_test.py`
- `python -m py_compile V3-GeoEncoder-RAG/scripts/testing/test_optimized_performance.py`
- `python -m py_compile V3-GeoEncoder-RAG/scripts/testing/test_rerank_params.py`

Expected:
- All syntax checks pass
- No broken import paths remain in `server.js`, `services/`, or moved scripts
