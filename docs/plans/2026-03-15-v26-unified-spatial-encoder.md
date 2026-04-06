# V26 Unified Spatial Encoder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified `v26` spatial-encoder experiment that combines the V2.4 retrieval objective and the V2.5 semantic objective into one LLM-consumable spatial embedding foundation for spatial retrieval, hybrid text+space retrieval, and RAG context assembly.

**Architecture:** `v26` replaces the current POI-only training path with an H3 cell-centered pipeline. Point, line, and polygon agents are first projected into H3 cells, then cell-level features and relation graphs are constructed, then a unified encoder learns cell embeddings with retrieval, direction, and region-semantics objectives, and finally exports agent-level vectors and metadata for downstream LLM/RAG consumption.

**Tech Stack:** Python 3.13, PyTorch, scikit-learn, H3, psycopg2/PostGIS, pytest, FastAPI, NumPy

---

### Task 1: Create `v26` Package Skeleton

**Files:**
- Create: `spatial_encoder/v26/__init__.py`
- Create: `spatial_encoder/v26/config_v26.py`
- Create: `spatial_encoder/v26/train_v26.py`
- Create: `spatial_encoder/v26/export_v26.py`
- Create: `spatial_encoder/v26/quick_validate_v26.py`
- Test: `spatial_encoder/tests/test_v26_config.py`

**Step 1: Write the failing test**

```python
from spatial_encoder.v26.config_v26 import V26Config

def test_v26_config_defaults():
    cfg = V26Config()
    assert cfg.h3_resolution in {8, 9, 10}
    assert cfg.embedding_dim == 64
    assert cfg.enable_direction_head is True
    assert cfg.enable_region_head is True
```

**Step 2: Run test to verify it fails**

Run: `pytest spatial_encoder/tests/test_v26_config.py -v`
Expected: FAIL with `ModuleNotFoundError` or missing `V26Config`

**Step 3: Write minimal implementation**

Create a dataclass-backed `V26Config` with:
- H3 resolution
- embedding dimension
- neighborhood ring count
- relation graph feature toggles
- direction / region head toggles
- export toggles for LLM/RAG consumption

**Step 4: Run test to verify it passes**

Run: `pytest spatial_encoder/tests/test_v26_config.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add spatial_encoder/v26 spatial_encoder/tests/test_v26_config.py
git commit -m "feat: add v26 config skeleton"
```

### Task 2: Build H3 Projection Utilities for Point / Line / Polygon Agents

**Files:**
- Create: `spatial_encoder/v26/h3_projection.py`
- Test: `spatial_encoder/tests/test_h3_projection.py`

**Step 1: Write the failing test**

```python
from spatial_encoder.v26.h3_projection import (
    point_to_cell,
    line_to_cells,
    polygon_to_cells,
)

def test_point_to_cell_returns_single_h3_cell():
    cell = point_to_cell(114.364, 30.532, 9)
    assert isinstance(cell, str)

def test_line_to_cells_returns_multi_cell_coverage():
    coords = [(114.360, 30.530), (114.365, 30.535)]
    cells = line_to_cells(coords, 9)
    assert len(cells) >= 1

def test_polygon_to_cells_returns_weighted_coverage():
    polygon = [
        (114.360, 30.530),
        (114.366, 30.530),
        (114.366, 30.536),
        (114.360, 30.536),
        (114.360, 30.530),
    ]
    cells = polygon_to_cells(polygon, 9)
    assert all("cell" in item and "weight" in item for item in cells)
```

**Step 2: Run test to verify it fails**

Run: `pytest spatial_encoder/tests/test_h3_projection.py -v`
Expected: FAIL with missing functions

**Step 3: Write minimal implementation**

Implement:
- `point_to_cell(lng, lat, resolution)`
- `line_to_cells(coords, resolution)` using sampled path coverage
- `polygon_to_cells(coords, resolution)` returning weighted or equal coverage

Use ASCII code only; keep comments concise.

**Step 4: Run test to verify it passes**

Run: `pytest spatial_encoder/tests/test_h3_projection.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add spatial_encoder/v26/h3_projection.py spatial_encoder/tests/test_h3_projection.py
git commit -m "feat: add h3 projection utilities for v26"
```

### Task 3: Build Unified Agent Records for LLM-Consumable Export

**Files:**
- Create: `spatial_encoder/v26/agent_records.py`
- Test: `spatial_encoder/tests/test_agent_records.py`

**Step 1: Write the failing test**

```python
from spatial_encoder.v26.agent_records import build_agent_record

def test_build_agent_record_for_point_agent():
    record = build_agent_record(
        agent_id="poi:1",
        agent_type="point",
        cells=[{"cell": "89283082813ffff", "weight": 1.0}],
        metadata={"name": "test poi", "category": "cafe"}
    )
    assert record["agent_type"] == "point"
    assert record["primary_cell"] == "89283082813ffff"
    assert record["metadata"]["category"] == "cafe"
```

**Step 2: Run test to verify it fails**

Run: `pytest spatial_encoder/tests/test_agent_records.py -v`
Expected: FAIL with missing module/function

**Step 3: Write minimal implementation**

Implement a unified record builder that normalizes:
- `agent_id`
- `agent_type`
- `cell coverage`
- `primary cell`
- `metadata`
- optional downstream fields for vector retrieval and LLM context injection

**Step 4: Run test to verify it passes**

Run: `pytest spatial_encoder/tests/test_agent_records.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add spatial_encoder/v26/agent_records.py spatial_encoder/tests/test_agent_records.py
git commit -m "feat: add unified agent record builder"
```

### Task 4: Build Cell Feature Aggregation for Multi-Geometry Inputs

**Files:**
- Create: `spatial_encoder/v26/cell_features.py`
- Test: `spatial_encoder/tests/test_cell_features.py`

**Step 1: Write the failing test**

```python
from spatial_encoder.v26.cell_features import aggregate_cell_features

def test_aggregate_cell_features_collects_point_line_polygon_signals():
    records = [
        {"agent_type": "point", "cells": [{"cell": "c1", "weight": 1.0}], "metadata": {"category": "cafe"}},
        {"agent_type": "line", "cells": [{"cell": "c1", "weight": 0.5}, {"cell": "c2", "weight": 0.5}], "metadata": {"road_class": "primary"}},
        {"agent_type": "polygon", "cells": [{"cell": "c1", "weight": 0.8}], "metadata": {"landuse": "commercial"}},
    ]
    result = aggregate_cell_features(records)
    assert "c1" in result
    assert result["c1"]["point_count"] == 1
    assert result["c1"]["line_weight_sum"] > 0
    assert result["c1"]["polygon_weight_sum"] > 0
```

**Step 2: Run test to verify it fails**

Run: `pytest spatial_encoder/tests/test_cell_features.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Aggregate per-cell features for:
- point density
- point category distribution
- line coverage strength
- polygon coverage strength
- landuse / AOI signals
- optional entropy / tf-idf style distribution summaries

**Step 4: Run test to verify it passes**

Run: `pytest spatial_encoder/tests/test_cell_features.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add spatial_encoder/v26/cell_features.py spatial_encoder/tests/test_cell_features.py
git commit -m "feat: add v26 cell feature aggregation"
```

### Task 5: Build Relation Graph Assembly Beyond Road Topology

**Files:**
- Create: `spatial_encoder/v26/relation_graph.py`
- Test: `spatial_encoder/tests/test_relation_graph.py`

**Step 1: Write the failing test**

```python
from spatial_encoder.v26.relation_graph import build_relation_edges

def test_build_relation_edges_supports_multiple_relation_types():
    edges = build_relation_edges(
        adjacency_pairs=[("c1", "c2")],
        functional_pairs=[("c1", "c3", 0.8)],
        cooccurrence_pairs=[("c2", "c3", 0.4)],
    )
    relation_types = {edge["relation_type"] for edge in edges}
    assert "adjacency" in relation_types
    assert "functional_similarity" in relation_types
    assert "cooccurrence" in relation_types
```

**Step 2: Run test to verify it fails**

Run: `pytest spatial_encoder/tests/test_relation_graph.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Implement a pluggable relation graph builder that can represent:
- spatial adjacency
- road topology adjacency
- functional similarity
- co-occurrence
- optional OD flow when data is available

Keep OD optional, not blocking.

**Step 4: Run test to verify it passes**

Run: `pytest spatial_encoder/tests/test_relation_graph.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add spatial_encoder/v26/relation_graph.py spatial_encoder/tests/test_relation_graph.py
git commit -m "feat: add multi-relation graph builder for v26"
```

### Task 6: Add V26 Encoder Export Contract for LLM / RAG

**Files:**
- Create: `spatial_encoder/v26/export_contract.py`
- Modify: `spatial_encoder/v26/export_v26.py`
- Test: `spatial_encoder/tests/test_export_contract.py`

**Step 1: Write the failing test**

```python
from spatial_encoder.v26.export_contract import build_export_manifest

def test_build_export_manifest_marks_rag_and_llm_consumption():
    manifest = build_export_manifest(
        version="v26",
        embedding_dim=64,
        supports=["spatial_search", "hybrid_retrieval", "llm_context"]
    )
    assert manifest["version"] == "v26"
    assert "hybrid_retrieval" in manifest["supports"]
    assert manifest["embedding_dim"] == 64
```

**Step 2: Run test to verify it fails**

Run: `pytest spatial_encoder/tests/test_export_contract.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Create an export manifest and wrappers that explicitly mark the output as consumable by:
- spatial retrieval
- text + spatial hybrid retrieval
- RAG vector search
- LLM context feature injection

**Step 4: Run test to verify it passes**

Run: `pytest spatial_encoder/tests/test_export_contract.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add spatial_encoder/v26/export_contract.py spatial_encoder/v26/export_v26.py spatial_encoder/tests/test_export_contract.py
git commit -m "feat: add v26 export contract for llm and rag"
```

### Task 7: Add Minimal V26 Training Entrypoint

**Files:**
- Modify: `spatial_encoder/run.py`
- Modify: `spatial_encoder/README.md`
- Modify: `spatial_encoder/requirements.txt`
- Modify: `spatial_encoder/v26/train_v26.py`
- Test: `spatial_encoder/tests/test_run_v26_entrypoint.py`

**Step 1: Write the failing test**

```python
from pathlib import Path

def test_run_py_mentions_v26_command():
    text = Path("spatial_encoder/run.py").read_text(encoding="utf-8")
    assert 'elif cmd == "train_v26"' in text
```

**Step 2: Run test to verify it fails**

Run: `pytest spatial_encoder/tests/test_run_v26_entrypoint.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Add:
- `train_v26`
- `validate_v26`
- `export_v26`

Document the commands in `README.md`.

**Step 4: Run test to verify it passes**

Run: `pytest spatial_encoder/tests/test_run_v26_entrypoint.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add spatial_encoder/run.py spatial_encoder/README.md spatial_encoder/requirements.txt spatial_encoder/v26/train_v26.py spatial_encoder/tests/test_run_v26_entrypoint.py
git commit -m "feat: add v26 training entrypoints"
```

### Task 8: Verify Python Test Suite and Frontend Baseline Remain Green

**Files:**
- Test: `spatial_encoder/tests/*.py`
- Test: `src/**/*.spec.js`

**Step 1: Run Python tests**

Run: `pytest spatial_encoder/tests -q`
Expected: all `v26` tests PASS

**Step 2: Run frontend tests**

Run: `npm test`
Expected: existing frontend suite PASS

**Step 3: Capture current limitations**

Record:
- whether OD data source is present
- whether polygon weighting is exact or approximate
- whether `train_v26.py` is scaffold-only or fully trainable

**Step 4: Commit**

```bash
git add spatial_encoder docs/plans/2026-03-15-v26-unified-spatial-encoder.md
git commit -m "feat: scaffold v26 unified spatial encoder experiment"
```

## Testing Notes

- Use UTF-8 for all new Chinese documentation and comments.
- Keep `v24` untouched as the comparison baseline.
- Follow the gradual experiment rule from `CLAUDE.md`: validate small first, then broaden.
- Treat OD relation inputs as optional extension data. The first `v26` milestone must support adjacency, co-occurrence, and functional similarity even if OD is not yet available.
- Export artifacts must be explicitly shaped for downstream LLM consumption, not just offline model evaluation.

## Immediate Execution Scope

The first implementation pass should complete Tasks 1 through 6 before attempting full end-to-end training.

Plan complete and saved to `docs/plans/2026-03-15-v26-unified-spatial-encoder.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
