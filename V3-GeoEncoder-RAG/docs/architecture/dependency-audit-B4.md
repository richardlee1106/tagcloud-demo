# dependency-audit-B4

## Goal

本审计回答一个核心问题：

> 在不把新主线重新接回 `rules_line` 的前提下，`spatial_core` 的 7 个 tool 各自应该如何落到真实实现？

原则：

- `infer_intent_legacy` 允许直接依赖旧线
- 其他 tool 不应整块复用旧 orchestrator
- 若能力仍埋在 `rules_line` 文件里，优先标记为“抽取/下沉”，而不是默认复用

---

## Tool-by-tool Audit

### 1. `spatial_core.resolve_anchor`

当前最接近的实现来源：

- [spatialSearchOrchestrator.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/retrieval/spatialSearchOrchestrator.js)
  中的 `resolveAnchorFromIntent()`
- [intentService.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/ai/intentService.js)
  中的地名抽取辅助函数
- [frontendDataService.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/data/frontendDataService.js)
  的 `quickSearchPois()`

建议归类：

- `quickSearchPois()`：纯能力，可直接依赖
- `resolveAnchorFromIntent()`：不应整块复用，应抽取为 `spatial_core/resolveAnchor.js`
- `extractPlaceNameFromQuery()` 等轻量 helper：可参考并迁移

结论：

- 分类：**需要从 rules_line 抽取下沉**
- 不建议：直接把旧 orchestrator 当 `resolve_anchor` handler

### 2. `spatial_core.search_nearby_pois`

当前真实骨架：

- [faissIndex.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/faissIndex.js)
  的 `faissHybridSearch()`

当前执行外壳：

- [spatialSearchOrchestrator.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/retrieval/spatialSearchOrchestrator.js)
  中的 `runHybridSearch` 闭包与 adaptive radius 扩搜

判断：

- `faissHybridSearch()` 是真正的 PostGIS-first 检索能力
- 旧 orchestrator 的价值主要在：
  - 参数整形
  - adaptive 扩搜策略
  - 与 intent 的耦合

结论：

- 分类：**可直接接纯能力模块 + 需要轻量 adapter**
- 可直接接：
  - `faissHybridSearch()`
- 需新增 adapter：
  - `searchNearbyPoisHandler({ anchor, radius_m, filter, limit })`
- 不建议：
  - 直接调用旧 `handleSpatialQuery()`

### 3. `spatial_core.vector_search`

当前真实能力来源：

- [queryEmbeddingService.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/queryEmbeddingService.js)
- [faissIndex.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/faissIndex.js)

判断：

- 这是典型纯能力模块组合
- 与 `rules_line` 的耦合很弱

结论：

- 分类：**可直接接纯能力模块**

### 4. `spatial_core.macro_cell_analysis`

当前真实能力来源：

- [runtimeSpatialAugmenter.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/runtimeSpatialAugmenter.js#L178)
  中的 `searchMacroCellsWithTownEncoder()`

当前旧线包装与聚合：

- [macroTaskExecutor.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/retrieval/macroTaskExecutor.js#L445)

判断：

- `searchMacroCellsWithTownEncoder()` 本质是纯能力，应该直接下沉到 `spatial_core`
- `macroTaskExecutor` 当前混杂了：
  - macro candidate merge
  - representative selection
  - comparison region payload
  - evidence summary merge

结论：

- 分类：**可直接接纯能力模块 + 需要从 rules_line 抽取部分聚合逻辑**

### 5. `spatial_core.spatial_encode`

当前来源：

- [runtimeSpatialAugmenter.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/runtimeSpatialAugmenter.js#L124)
  的 `enrichResultsWithSpatialEncoder()`
- [runtimeSpatialAugmenter.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/runtimeSpatialAugmenter.js#L270)
  的 `enrichResultsWithCellContext()`

判断：

- 这是典型的纯 enrichment 能力
- 不需要复用旧 task routing

结论：

- 分类：**可直接接纯能力模块**

### 6. `spatial_core.build_boundary`

当前来源：

- [spatialEvidenceService.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialEvidenceService.js#L1)

判断：

- 纯几何/边界/热点构建是 `spatial_core` 应有能力
- 但当前文件体积大、职责密，需要拆分

结论：

- 分类：**需要拆分后下沉**
- 不建议：直接把整个 `spatialEvidenceService.js` 当黑盒 handler

### 7. `spatial_core.infer_intent_legacy`

当前来源：

- [intentService.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/ai/intentService.js)

判断：

- 这是唯一被设计为“合法直接依赖旧线”的 tool
- 它的存在目的就是阶段 C/E 过渡兜底

结论：

- 分类：**允许直接依赖 rules_line**

---

## Summary Table

| Tool | 当前最佳来源 | 结论 |
|------|-------------|------|
| `resolve_anchor` | `quickSearchPois` + 旧锚点解析逻辑 | 需要抽取/下沉 |
| `search_nearby_pois` | `faissHybridSearch` | 纯能力 + adapter |
| `vector_search` | `queryEmbeddingService` + `faissIndex` | 可直接接纯能力 |
| `macro_cell_analysis` | `searchMacroCellsWithTownEncoder` | 纯能力 + 抽取聚合 |
| `spatial_encode` | `runtimeSpatialAugmenter` | 可直接接纯能力 |
| `build_boundary` | `spatialEvidenceService` | 需拆分后下沉 |
| `infer_intent_legacy` | `rules_line/ai/intentService` | 允许旧依赖 |

---

## Explicit Non-goals

以下做法在 B3/C 中应被视为错误路线：

1. 把 `handleSpatialQuery()` 直接注册成 `spatial_core.search_nearby_pois`
2. 把 `macroTaskExecutor.js` 整块挂为 `macro_cell_analysis`
3. 让 `planner_line` 重新调用旧 `spatialAnswerService`

这些方案虽然快，但会把旧任务编排与旧决策权重新带回新主线。

---

## Recommended Next Steps

1. 先做 `spatial_core` handler 的最小实现：
   - `resolve_anchor`
   - `search_nearby_pois`
   - `macro_cell_analysis`
2. handler 内部只接纯能力模块与最薄 adapter
3. `infer_intent_legacy` 保持为唯一直接旧依赖
4. `build_boundary` 与 evidence assembler 的进一步拆分，放入阶段 C/D 伴随推进
