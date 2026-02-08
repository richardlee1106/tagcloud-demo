# Spatial-RAG Migration Status and Performance Notes

Updated: 2026-02-08

## 1) Quick takeaways

- The backend is now mostly aligned with the target architecture: **Node as gateway + Python as compute engine**.
- Performance is **not uniformly better** in every query type yet:
  - Core POI retrieval is faster on Python.
  - Some advanced analytics are still slower on Python because the Python path currently runs richer logic than the lightweight Node fallback.
- Major wins today are maintainability, deterministic outputs, and controlled fallback behavior.

---


### 1.1 2026-02-08 performance update

- Graph reasoning now uses Python fast path (skip heavy region modeling chain).
- Graph algorithm moved from all-pair scan to grid-neighbor pruning + haversine verify.
- Repository spatial SQL now uses `&&` bbox prefilter before `ST_Within` for polygon/viewport/WKT routes.
- For graph queries without explicit limit, candidate fetch is clamped by `graphMaxNodes` to cut transfer and compute overhead.

Measured on local stack (`POST /api/ai/execute`, 5 samples):

| Scenario | Avg | P95 |
|---|---:|---:|
| Python primary (`graph_reasoning`) | 102.2 ms | 126 ms |
| Node fallback (`graph_reasoning`) | 2.0 ms | 3 ms |

> Node fallback remains lighter but less complete; Python result carries richer graph payload and deterministic diagnostics.

### 1.2 2026-02-08 parity and boundary-performance update

- `dual_run_parity_check` now uses **graph-structure-first** checks for `graph_reasoning`:
  - hard alerts focus on Python graph validity and critical schema,
  - low POI overlap is downgraded to warning under lightweight Node fallback mode.
- Alpha-shape pipeline now includes deterministic point downsampling and adaptive simplify:
  - reduces heavy geometry cost on large clusters,
  - keeps outputs reproducible.
- Pipeline boundary modeling adds small-cluster convex-hull shortcut and preview-boundary sampling.

## 2) Measured performance snapshots

> Measurements were run locally on 2026-02-07. Absolute values will vary by machine load.

### 2.1 Compute-only benchmark (`POST /api/ai/execute`, 6 samples)

| Scenario | Python avg | Node avg | Observation |
|---|---:|---:|---|
| `poi_search` | 187.83 ms | 498.67 ms | Python is ~62.3% faster |
| `graph_reasoning` | 1017.17 ms | 104.50 ms | Python is slower (richer pipeline vs simplified Node fallback) |
| `region_comparison` | 2.33 ms | 1.17 ms | Python is slower, but both are low-latency |

### 2.2 End-to-end benchmark (`POST /api/jobs/narrative`, 4 samples)

- `poi_search` with Python primary: avg 9669.00 ms
- `poi_search` with Node fallback: avg 5319.50 ms

Important: this includes planner/writer/LLM latency, so it is not a pure spatial-compute metric.

### 2.3 Regression checks

- `npm --prefix fastify-backend run check:dualrun -- --samples=2 --out=reports/rollout/dual-run-latest.json`
  - Result: `all_passed = true`
- `npm --prefix fastify-backend run drill:fallback -- --out=reports/rollout/fallback-drill-latest.json`
  - Result: Python primary + Node fallback both passed

---

## 3) What each Python file does (`fastify-backend/python_service`)

## 3.1 Entry layer

- `fastify-backend/python_service/grpc_server.py`
  - gRPC entrypoint for spatial compute.
  - Loads proto stubs, accepts Node requests, streams STAGE/PROGRESS/PARTIAL/FINAL/ERROR events.

- `fastify-backend/python_service/app.py`
  - Lightweight HTTP service for health and metrics endpoints.

## 3.2 Pipeline layer

- `fastify-backend/python_service/pipeline/spatial_pipeline.py`
  - Main Python orchestration pipeline.
  - Handles request parsing, candidate loading, direction filtering, clustering, boundary generation, fuzzy membership, H3 aggregation, graph analysis, and region comparison.

## 3.3 Algorithm layer

- `fastify-backend/python_service/algorithms/hdbscan_cluster.py`
  - HDBSCAN clustering wrapper with DBSCAN fallback.

- `fastify-backend/python_service/algorithms/alpha_shape.py`
  - Alpha-shape boundary generation with convex-hull fallback.

- `fastify-backend/python_service/algorithms/direction_filter.py`
  - Direction normalization and directional POI filtering (E/W/N/S semantics).

- `fastify-backend/python_service/algorithms/h3_aggregate.py`
  - H3 aggregation (with deterministic grid fallback if H3 package is missing).

- `fastify-backend/python_service/algorithms/membership.py`
  - Multi-factor membership scoring model (density/purity/centrality/compactness/scale).

- `fastify-backend/python_service/algorithms/graph_reasoning.py`
  - Spatial graph construction and graph metrics extraction.

- `fastify-backend/python_service/algorithms/region_comparison.py`
  - Region-level aggregation and cross-region comparison output.

## 3.4 Data access layer

- `fastify-backend/python_service/db/repository.py`
  - PostGIS repository abstraction.
  - Provides viewport/boundary/multi-region/category constrained queries.
  - Keeps SQL aligned with existing `pois` schema.

## 3.5 Generated protocol files

- `fastify-backend/python_service/generated/spatial_compute_pb2.py`
  - Generated message types from proto.

- `fastify-backend/python_service/generated/spatial_compute_pb2_grpc.py`
  - Generated gRPC service stubs from proto.

## 3.6 Package markers

- `fastify-backend/python_service/__init__.py`
- `fastify-backend/python_service/algorithms/__init__.py`
- `fastify-backend/python_service/db/__init__.py`
- `fastify-backend/python_service/pipeline/__init__.py`

---

## 4) Node slimming changes applied in this round

### 4.1 Legacy executor is now lazy-loaded

File: `fastify-backend/services/spatialJobRunner.js`

- Previous behavior: `routes/ai/executor.js` was imported at module load time.
- New behavior: legacy Node executor is imported only when fallback is actually needed.
- Benefit: lower gateway startup/runtime footprint when Python primary path is healthy.

### 4.2 Advanced query fallback policy added

File: `fastify-backend/services/spatialJobRunner.js`

- New env flag: `SPATIAL_NODE_ADVANCED_FALLBACK`
  - `minimal` (default): advanced query fallback returns minimal safe structure on Node side
  - `legacy`: allow old Node heavy compute fallback
  - `disabled`: always use minimal Node fallback for advanced types
- Explicit `forceNodeFallback=true` still allows legacy fallback for drills/regression checks.

---

## 5) Next slimming plan (toward pure gateway Node)

1. Move remaining core fallback logic to thin SQL-only wrappers (remove Node-side spatial reasoning).
2. Remove direct legacy `executeQuery` usage in residual old routes; keep `spatialJobRunner` as single orchestration entry.
3. Keep Python as default for all advanced query types; retain Node only as emergency compatibility layer.
4. Complete staged rollout (10% -> 30% -> 60% -> 100%), then remove redundant Node compute branches after stabilization window.

---

## 6) Daily regression commands

```bash
npm --prefix fastify-backend run smoke:jobs
npm --prefix fastify-backend run check:dualrun -- --samples=2 --out=reports/rollout/dual-run-latest.json
npm --prefix fastify-backend run drill:fallback -- --out=reports/rollout/fallback-drill-latest.json
```
