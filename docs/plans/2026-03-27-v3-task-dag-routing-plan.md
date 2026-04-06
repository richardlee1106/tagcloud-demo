# V3 Task DAG Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn V3 from a mostly unified spatial QA pipeline into a staged, testable task-routing system where intent parsing, model routing, evidence shaping, and answer generation can be improved independently and measured with the same 10-question regression set after each phase.

**Architecture:** Keep the current `poi_encoder + town_encoder` backbone, but shift complexity upward into deterministic task parsing, route-specific executors, and evidence contracts. Phase 1 focuses on stop-loss fixes that unblock the largest observed errors without introducing a full DAG framework yet: harden explicit-place parsing for macro tasks, reduce unnecessary small-LLM control-plane calls, and fix support-bucket evidence mapping so retrieval evidence is not lost in summarization.

**Tech Stack:** Node.js (Fastify/Vitest), Python (FastAPI/Torch), PostGIS/pgvector, structured SSE, local Ollama/LM Studio.

---

## Global Delivery Rules

1. Every phase must be independently testable.
2. After every completed phase, rerun the original 10 `/api/ai/chat` questions and save fresh evidence.
3. Every phase must append experiment results, caveats, and next steps to `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`.
4. Prefer deterministic control-plane logic first; only keep LLM in the expression plane unless confidence is low.

## Regression Set (fixed across phases)

1. `武汉大学附近有哪些咖啡店？`
2. `湖北大学附近有哪些地铁站？`
3. `武汉大学附近有哪些医院？`
4. `武汉大学附近有哪些商超？`
5. `光谷附近有哪些咖啡店？`
6. `请分析武汉大学附近的配套、热门业态和明显缺口。`
7. `请分析湖北大学附近的配套、热门业态和明显缺口。`
8. `请概览武汉大学附近的空间结构和业态分布。`
9. `武汉大学附近适合布局什么业态？`
10. `比较武汉大学和湖北大学附近的业态差异。`

## Execution TODO

- [x] Phase 1.A: 修复显式地点 `area_overview / site_suitability` 的 deterministic 意图解析。
- [x] Phase 1.B: 扩展稳定非校园锚点 fast-path，解决 `光谷` 类慢解析。
- [x] Phase 1.C: 修复 `support bucket` 餐饮映射与显式地点 deterministic answer。
- [x] Phase 1.D: 建立 10 题回归脚本并把实验结果写入 `CHANGELOG.md`。
- [x] Phase 2.A: 为 `region_comparison` 引入 `anchors[]`、双锚点 deterministic parser、query plan/schema 透传。
- [x] Phase 2.B: 为双锚点比较增加 deterministic guardrail answer，先止住慢解析与错误对比生成。
- [x] Phase 2.C: 继续把宏观证据补成 schema，增加 `support_buckets / representative_pois / uncertainty` 的更完整消费链路。
- [x] Phase 3.A: 为 `area_overview / site_suitability` 拆出专用执行器，减少统一流水线绕路。
- [x] Phase 3.B: 为 `region_comparison` 拆出双区域独立执行器，再做 deterministic merge。
- [x] Phase 4.A: 给 `town_encoder` 增加宏观输出头与 uncertainty 传播。
- [x] Phase 4.B: 按任务重排宏观 `support_buckets`，把宏观回答从“片区身份”拉回“可经营信号”。
- [x] Phase 4.C: comparison 进入量化 evidence contract，并把 `support_gap_analysis` 拉回更像空间推理的 deterministic answer。
- [x] Phase 4.D: 把 quantitative evidence 翻译成人话，避免 support-gap / comparison 退化成报表朗读。
- [x] Phase 4.E: 为 `support_gap_analysis` 增加明确 gap ranking、低样本 `先补查` guardrail、以及 evidence-verified bucket 判断。
- [x] Phase 4.F: 收紧 comparison denominator，只让有可读证据支撑的 bucket 进入 comparison metrics。
- [ ] Phase 4.G: 在分母收紧后，继续把 comparison 的“第二特征”从共性 bucket 压成更有区分度的业务差异轴。

## Current Status

- `Phase 1` 已完成并完成 10 题回归记录。
- `Phase 2.A / 2.B` 已完成：比较题现在可以 deterministic 识别双锚点，并把 `anchors[]` 透传到 query plan 与 RAG schema。
- `Phase 2.C` 已完成：宏观任务现在会稳定暴露 `support_buckets / representative_pois / uncertainty`，并透传到 answer options 与 RAG schema。
- `Phase 3.A` 已完成：`area_overview / site_suitability` 现在会走 dedicated macro executor，主检索切到 `town_encoder` 宏观路由，`poi_encoder` 不再作为默认主链路参与。
- `Phase 3.B` 已完成：`region_comparison` 现在会分别为双锚点取证，并在 answer 层消费结构化 comparison evidence 生成真实对比摘要。
- `Phase 4.A` 已完成：`town_encoder` 现在会稳定返回 `support_bucket_distribution / dominant_buckets / scene_tags / cell_mix / macro_uncertainty`，这些字段已经贯通到 JS evidence contract 和 deterministic answer 消费链路。
- `Phase 4.B` 已完成：`area_overview / site_suitability / region_comparison` 现在会按任务重排宏观 `support_buckets`，并过滤掉 `公交站 / 校区 / 教学楼` 这类泛基础设施代表点对比较结论的污染。
- `Phase 4.C / 4.D` 已完成：comparison 已具备 quantitative contract，support-gap / comparison 的 answer 也已经从“报表/口号”切回用户可读的人话表达。
- `Phase 4.E` 已完成：support-gap 现在会给出 `第一优先 / 第二优先` 的明确缺口排序；低样本时会自动切换到 `先补查` guardrail；宏观 summary 里只有泛化标签、没有可读 representative POI 的 bucket，不再被当成 fully-present evidence。
- `Phase 4.F` 已完成：comparison metrics 现在会优先统计“有可读证据支撑”的 bucket，`Q10` 的 secondary traits 不再继续吞入只存在于宏观 summary 里的宽 bucket。
- 下一阶段优先做 `Phase 4.G`，把 comparison 的第二特征继续压成更有区分度的业务差异轴；只有原始 10 题在 clean rerun 上保持稳定后，再扩展到更难的新评测集。 

## Phase Breakdown

### Phase 1: Intent Stop-Loss + Evidence Stop-Loss

**Objective:** Fix the highest-value control-plane and answer-plane mistakes without waiting for dedicated task executors.

**Expected impact:**
- Reduce slow small-LLM parsing on `光谷` and explicit-place macro tasks.
- Stop anchor pollution for `请概览武汉大学...` style prompts.
- Correct the false “餐饮不足” class of answer-layer mistakes.
- Improve Q5/Q7/Q8/Q9 first, while laying parsing groundwork for Q10.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/intentService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/intentService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Create: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/scripts/testing/eval_ai_chat_10q.mjs`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**Steps:**
1. Write failing tests for explicit-place `area_overview`, `site_suitability`, `光谷` deterministic parsing, and support-bucket restaurant evidence.
2. Verify those tests fail for the current code.
3. Harden deterministic intent parsing:
   - extend lead-in stripping for `概览 / 概况 / 比较 / 对比 / 适合布局`
   - widen site-suitability task signals
   - allow deterministic bypass for selected stable non-campus anchors and explicit-place macro tasks
4. Fix answer-layer support-bucket inference so `中国菜 / 面馆 / 火锅 / 小吃 / 咖啡 / 奶茶` are consumed as餐饮 evidence, not dropped.
5. Extend deterministic answer short-circuiting to explicit-place `area_overview` / `site_suitability` when evidence is available.
6. Add a reusable 10-question `/api/ai/chat` regression script that writes fresh JSON evidence under `V3-GeoEncoder-RAG/logs/`.
7. Run targeted Vitest tests, then rerun the 10-question regression set, and record deltas in `CHANGELOG.md`.

### Phase 2: Comparison-Aware Intent Schema + Structured Evidence Contract

**Objective:** Introduce `anchors[]`, structured macro evidence, and schemaized LLM context so complex tasks stop depending on flat facts.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/intentService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialRagContextService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/intentService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialSearchOrchestrator.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialRagContextService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**Steps:**
1. Add failing tests for comparison-anchor extraction and structured evidence payloads.
2. Parse and normalize dual anchors for comparison prompts.
3. Extend evidence/query-plan outputs from single `anchor` to task-friendly schema fields such as `anchors`, `representative_pois`, `support_buckets`, and `uncertainty`.
4. Keep backward compatibility for existing consumers.
5. Re-run targeted tests and the 10-question regression set.

**Suggested testable slices:**
- Stage 2.A: 双锚点解析 + `anchors[]` query plan/schema 透传。
- Stage 2.B: 比较题 deterministic guardrail answer，先避免把单区域证据误写成双区域结论。
- Stage 2.C: 宏观 evidence contract 补全 `support_buckets / representative_pois / uncertainty`。

### Phase 3: Dedicated Task Executors

**Objective:** Split macro tasks into route-specific executors instead of forcing them through the nearby pipeline.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialSearchOrchestrator.js`
- Create or modify route executor modules under `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**Steps:**
1. Add failing tests for route-specific execution of `area_overview`, `site_suitability`, and `region_comparison`.
2. Build lightweight task executors on top of the current orchestrator dependencies.
3. Make `region_comparison` run anchor A / B independently and merge evidence deterministically.
4. Re-run targeted tests and the 10-question regression set.

**Completed slice: Phase 3.A**
- Added a dedicated macro executor for `area_overview / site_suitability`.
- Removed default dependence on nearby-oriented query embedding and small-LLM candidate filtering for those two task types.
- Kept `region_comparison` on the existing guardrail path for now, to be completed in `Phase 3.B`.

### Phase 3.A Result: Dedicated Macro Executor for Overview / Suitability

**Objective:** Let `area_overview / site_suitability` stop borrowing the nearby pipeline and instead consume macro evidence through a route-specific executor.

**Files:**
- Create: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/macroTaskExecutor.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialSearchOrchestrator.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. Added `macroTaskExecutor.js` to execute `area_overview / site_suitability` with `town_encoder` macro cells as the primary route and representative POIs as supporting evidence.
2. Updated `spatialSearchOrchestrator.js` so those two task types bypass:
   - `buildSpatialQueryEmbedding()`
   - `buildQueryEmbeddingSearchOptions()`
   - `filterCandidatesWithSmallLLM()`
3. Added orchestrator dependency defaulting via `effectiveDeps = { ...buildDefaultDeps(), ...deps }`, which keeps route-level tests easy to inject without touching unrelated branches.
4. Tightened representative-POI selection so wide noisy categories do not dominate the top readable evidence for macro answers.
5. Exposed `route_executor / route_executor_reason` into pipeline stats so the 10-question regression can confirm real routing, not just test doubles.

**Verification:**
- `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
  - `11/11` passed
- `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai`
  - `60/60` passed
- `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialRagContextService.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
  - `14/14` passed

**10-question regression evidence:**
- `V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T03-50-43-092Z.json`

**Observed impact:**
- `Q8` now reports:
  - `query_embedding_source=town_encoder_macro_route`
  - `route_executor=macro_overview_executor`
  - answer focus changed from `其他配套` to `零售购物`
- `Q9` now reports:
  - `query_embedding_source=town_encoder_macro_route`
  - `route_executor=macro_overview_executor`
  - answer focus changed from `其他配套` to `零售购物`
- `Q10` remains on the comparison guardrail answer, which is expected because dual-region dedicated execution is intentionally deferred to `Phase 3.B`.

**Delta summary vs Phase 2.C:**
| Q | Prompt | Phase 2.C | Phase 3.A | Delta |
|---|--------|-----------|-----------|-------|
| 8 | `请概览武汉大学附近的空间结构和业态分布。` | `2459ms` | `2340ms` | `-119ms` |
| 9 | `武汉大学附近适合布局什么业态？` | `2516ms` | `2340ms` | `-176ms` |
| 10 | `比较武汉大学和湖北大学附近的业态差异。` | `2627ms` | `2330ms` | `-297ms` |

**Exit criteria assessment:**
- `Phase 3.A` can be considered complete.
- The result is not “all macro tasks are done”; the result is:
  1. overview / suitability no longer rely on the nearby-oriented control path;
  2. regression evidence now proves the dedicated macro route is real end-to-end;
  3. remaining comparison work is isolated and can be implemented cleanly in `Phase 3.B`.

### Phase 3.B Result: Dual-Anchor Comparison Executor + Deterministic Merge

**Objective:** Upgrade `region_comparison` from a safe guardrail answer to a dedicated dual-anchor evidence pipeline that can produce a real comparison summary.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/macroTaskExecutor.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialSearchOrchestrator.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/server.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. Refactored macro retrieval into reusable per-region execution inside `macroTaskExecutor.js`, then built a dedicated comparison executor on top of it.
2. `spatialSearchOrchestrator.js` now resolves both comparison anchors, bypasses nearby-oriented query embedding and small-LLM candidate filtering, and routes `region_comparison` into `macro_comparison_executor`.
3. `chatPipeline.js` now exposes `comparison_regions` and `comparison_region_count` in the evidence contract so the comparison route is visible in structured outputs.
4. `spatialAnswerService.js` now reads structured dual-region evidence and emits a deterministic comparison summary instead of the previous “pipeline not ready yet” guardrail text when the evidence exists.
5. `server.js` now forwards `comparisonRegions` to the answer layer.

**Verification:**
- `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
  - `12/12` passed
- `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai`
  - `63/63` passed
- `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialRagContextService.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js`
  - `15/15` passed

**10-question regression evidence:**
- `V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T04-08-39-062Z.json`

**Observed impact:**
- `Q10` now reports:
  - `query_embedding_source=town_encoder_comparison_route`
  - `route_executor=macro_comparison_executor`
  - `comparison_region_count=2`
  - the final answer is now a real comparison summary instead of a guardrail placeholder
- `Q8 / Q9` remain on:
  - `query_embedding_source=town_encoder_macro_route`
  - `route_executor=macro_overview_executor`
  - which confirms `Phase 3.B` did not break `Phase 3.A`

**Delta summary vs Phase 3.A:**
| Q | Prompt | Phase 3.A | Phase 3.B | Delta |
|---|--------|-----------|-----------|-------|
| 8 | `请概览武汉大学附近的空间结构和业态分布。` | `2340ms` | `2266ms` | `-74ms` |
| 9 | `武汉大学附近适合布局什么业态？` | `2340ms` | `2294ms` | `-46ms` |
| 10 | `比较武汉大学和湖北大学附近的业态差异。` | `2330ms` | `4525ms` | `+2195ms` |

**Exit criteria assessment:**
- `Phase 3.B` can be considered complete.
- The important tradeoff is explicit:
  1. comparison latency increased because the system is now doing real dual-anchor retrieval rather than returning a guardrail stub;
  2. that extra cost bought a material quality upgrade, because `Q10` now has observable dedicated routing and evidence-backed contrast text;
  3. some comparison noise remains, especially when broad transport/support categories dominate one side, which is a good fit for `Phase 4.A`.

### Phase 4: Town Macro Outputs + Confidence/Refusal

**Objective:** Make `town_encoder` produce evidence that is easier for downstream reasoning to consume and safer to refuse when weak.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/python/services/spatialEncoderService.py`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/infra/spatialEncoderClient.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/runtimeSpatialAugmenter.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**Steps:**
1. Add failing tests for macro-output fields and uncertainty propagation.
2. Return macro summaries such as cell mix, support buckets, scene tags, and uncertainty.
3. Surface refusal/low-confidence handling in answer generation.
4. Re-run targeted tests and the 10-question regression set.

### Phase 4.A Result: Town Macro Summary + Uncertainty Propagation

**Objective:** Make `town_encoder` macro retrieval return evidence that downstream components can consume directly, not just `cells[]`.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/python/services/spatialEncoderService.py`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/spatial_encoder/v26_GLM/data_loader_town.py`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/runtimeSpatialAugmenter.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/macroTaskExecutor.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/supportEvidenceUtils.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. `/cell/search` 不再只返回宏观相似 cell 列表，而是同步暴露：
   - `support_bucket_distribution`
   - `dominant_buckets`
   - `scene_tags`
   - `cell_mix`
   - `macro_uncertainty`
2. `runtimeSpatialAugmenter.js` 把这些字段完整保留进 JS 侧 `macroCellSearch`。
3. `macroTaskExecutor.js`、`chatPipeline.js` 与 `spatialAnswerService.js` 已能消费这些结构化宏观字段，不再只依赖 flat facts。

**Verification:**
- `python -m py_compile D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/python/services/spatialEncoderService.py D:/AAA_Edu/TagCloud/vite-project/spatial_encoder/v26_GLM/data_loader_town.py`
- `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/runtimeSpatialAugmenter.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
  - `63/63` passed
- `http://127.0.0.1:3300/health`
- `http://127.0.0.1:8100/health`

**10-question regression evidence:**
- `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T04-41-19-203Z.json`

**Observed impact:**
1. 宏观任务已经能稳定暴露 richer evidence contract，而不再只是 `cells[]`。
2. `Q8 / Q9 / Q10` 的“缺口乱判”有所收敛，但新的主问题也被暴露出来了：
   - 宏观标签开始过宽，容易落到 `教育服务 / 生活服务` 这类片区身份；
   - `site_suitability / region_comparison` 仍然缺少“可经营/可对比”优先级。
3. 这说明 `Phase 4.A` 主要完成的是“证据变厚”，还没有完成“证据排序更像业务判断”。

### Phase 4.B Result: Task-Aware Macro Bucket Ranking + Deterministic Business-Facing Macro Answers

**Objective:** Stop `area_overview / site_suitability / region_comparison` from defaulting to broad campus identity buckets when more actionable consumer/service signals are present.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/supportEvidenceUtils.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. `supportEvidenceUtils.js`
   - 新增按任务类型区分的 bucket prior；
   - 新增对 `学校 / 校区 / 教学楼 / 公交站 / 地铁站 / 停车场` 这类泛基础设施代表点的识别；
   - 新增 `sortSupportBucketsForTask()`，让宏观 evidence 不再只按原始 count 排序。
2. `chatPipeline.js`
   - `support_buckets` 会在进入 evidence contract 前按 `taskType` 重排；
   - `comparison_regions` 也会同步重排，避免 answer 层继续吃到宽泛排序。
3. `spatialAnswerService.js`
   - `area_overview` 会优先讲“更能体现街区活跃度”的 bucket；
   - `site_suitability` 会输出更像经营建议的 deterministic 文案；
   - `region_comparison` 会优先对比更有区分度的消费/服务 bucket，并过滤掉 `公交站 / 校区` 这类代表点噪声。

**Verification:**
- Red:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - 新增 `4` 条用例先失败，证明打中了 `Q8 / Q9 / Q10` 现有偏差。
- Green:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - `46/46` passed
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/runtimeSpatialAugmenter.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - `67/67` passed

**10-question regression evidence:**
- Interim latest-code validation:
  - `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T04-59-23-019Z.json`
  - 说明：当时 `3300` 仍挂着旧进程，因此先在 `3301` 做了最新代码验证。
- Official final snapshot after refreshing `3300`:
  - `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T05-02-29-282Z.json`

**Delta summary vs Phase 4.A:**
| Q | Prompt | Phase 4.A | Phase 4.B | Delta |
|---|--------|-----------|-----------|-------|
| 6 | `请分析武汉大学附近的配套、热门业态和明显缺口。` | `2551ms` | `2719ms` | `+168ms` |
| 7 | `请分析湖北大学附近的配套、热门业态和明显缺口。` | `2585ms` | `2622ms` | `+37ms` |
| 8 | `请概览武汉大学附近的空间结构和业态分布。` | `2739ms` | `2686ms` | `-53ms` |
| 9 | `武汉大学附近适合布局什么业态？` | `2509ms` | `2545ms` | `+36ms` |
| 10 | `比较武汉大学和湖北大学附近的业态差异。` | `4999ms` | `5188ms` | `+189ms` |

**Observed impact:**
1. `Q8` 从“`教育服务` 主导的片区标签”切回了更符合街区体感的 `零售购物`。
2. `Q9` 从泛泛的“同类补充/轻量业态”改成了可执行的 `零售购物 / 餐饮配套 / 生活服务` 方向。
3. `Q10` 从 `教育服务 vs 生活服务` 改成了更可经营、也更可比较的 `零售购物 vs 餐饮配套`；
   - 代表点也从 `公交站 / 校区` 这类泛点，收敛到 `轩轩副食 / 雪糕批发 / 芊烨餐馆` 这类具体证据。
4. 这轮没有解决 `Q6 / Q7`。
   - `support_gap_analysis` 仍然会被校园类宽标签放大；
   - `Q7` 甚至从更偏 `生活服务` 回到更偏 `教育服务`，说明 support-gap 需要单独处理，不能指望 overview/comparison 的排序策略顺带修好。

**Exit criteria assessment:**
- `Phase 4.B` can be considered complete.
- 它完成的是“宏观证据开始按任务重排”，不是“所有宏观题都已经稳定”。
- 下一步应进入 `Phase 4.C`：
  1. 给 `support_gap_analysis` 单独加 bucket 排序；
  2. 明确低置信不下结论/只给方向性提示；
  3. 继续用同一套 10 题先把 `Q6 / Q7` 拉稳，再考虑旅游景点 / 出行时间 / 路网级新评测集。

## Immediate Execution Choice

Proceed to **Phase 4.C**. `town_encoder` 的宏观证据已经更厚、也开始按任务重排了；当前最高 ROI 已经切到 `support_gap_analysis` 的专用排序和低置信 guardrail，而不是立刻扩展到更难的新题集。

### Phase 4.C Result: Quantitative Comparison Contract + Pop-Grid-Aware Comparison Answer

**Objective:** Stop `region_comparison` from ending at bucket slogans like “更偏零售 / 更偏餐饮”, and instead expose same-caliber quantitative evidence that downstream answers can read directly.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/supportEvidenceUtils.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/macroTaskExecutor.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. `supportEvidenceUtils.js`
   - 新增 `support_bucket_metrics` 归一化与构建；
   - 新增 `population_metrics` 归一化与基于 cell 的聚合；
   - `buildMacroCellSummary()` 现在不只返回 bucket / scene / mix / uncertainty，也会带出可直接消费的量化字段。
2. `macroTaskExecutor.js`
   - comparison region payload 现在会显式带出：
     - `support_bucket_metrics`
     - `population_metrics`
   - 也就是 “town 宏观检索 -> 对比区域结构化量化证据” 这段链路已经接通。
3. `chatPipeline.js`
   - `comparison_regions` 进入 refined result 时不再丢失这些量化字段。
4. `spatialAnswerService.js`
   - comparison deterministic answer 改为优先读量化证据；
   - 文案里会直接给出：
     - bucket 占比
     - `pop栅格` 均值
     - 高密度 cell 占比
     - 代表点
   - 同时新增 task-aware 回退规则，避免 raw metrics 里的 `教育服务` 把高校比较重新拖回“校园底色”。

**Verification:**
- Red:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js`
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js`
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
  - 新增用例先失败，命中：
    - comparison 区域还没有量化 metrics；
    - refined result 会丢掉 comparison metrics；
    - answer 仍然输出旧的 “更偏 XX” 文案；
    - answer 在 raw metrics 与 task-aware bucket 冲突时仍会退回 `教育服务`。
- Green:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/runtimeSpatialAugmenter.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - `69/69` passed

**10-question regression evidence:**
- 临时 clean instance 回归：
  - `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T05-43-55-550Z.json`
  - 说明：`3300` 仍被旧进程占用，所以本阶段继续使用临时新实例做干净回归，避免把旧代码结果误记到新阶段。

**Observed impact:**
1. `Q10` 已经从“只给 bucket 判断”升级成“带数字的证据型比较”。
   - 当前会显式回答：
     - `零售购物 / 餐饮配套` 的占比；
     - `pop栅格均值`；
     - `高密度cell占比`；
     - 代表点。
2. `Q10` 不再回退到 `教育服务 vs 餐饮配套` 这类明显不对路的头部判断。
   - 说明 task-aware bucket 和 quantitative contract 已经真正接到 answer 层。
3. 这轮仍然不是“最终形态”。
   - 当前 comparison 的分母仍然偏宽；
   - 百分比已经有了，但还不够像“经营业态 market share”；
   - 更准确地说，它现在是“同口径宏观 bucket 占比”，已经比之前强很多，但还没有达到最终业务表达上限。
4. `Q6 / Q7` 依然是当前最差点。
   - `support_gap_analysis` 还没有切到量化 contract；
   - 这两题仍然会被校园类宽标签拖偏。

**Delta summary vs Phase 4.B:**
| Q | Prompt | Phase 4.B | Phase 4.C | Delta |
|---|--------|-----------|-----------|-------|
| 6 | `请分析武汉大学附近的配套、热门业态和明显缺口。` | `2719ms` | `2648ms` | `-71ms` |
| 7 | `请分析湖北大学附近的配套、热门业态和明显缺口。` | `2622ms` | `2550ms` | `-72ms` |
| 8 | `请概览武汉大学附近的空间结构和业态分布。` | `2686ms` | `2464ms` | `-222ms` |
| 9 | `武汉大学附近适合布局什么业态？` | `2545ms` | `2444ms` | `-101ms` |
| 10 | `比较武汉大学和湖北大学附近的业态差异。` | `5188ms` | `5053ms` | `-135ms` |

**Next TODO:**
1. `Phase 4.D`
   - 单独重做 `support_gap_analysis` 的量化证据 contract；
   - 把 “当前命中几处” 升级成 “各类配套占比 / 样本数 / 缺口只在低证据时保守表达”。
2. `Phase 4.E`
   - 继续校准 comparison 的分母；
   - 更接近“真实可经营业态构成”，减少宽 bucket 对百分比的稀释。
3. `Phase 4.F`
   - 只有在原始 10 题明显变稳之后，再扩展到旅游景点、出行、路网、通行时间等更难评测集。

### Phase 4.D Result: Evidence-To-Language Translation + Quantitative Support-Gap Answer

**Objective:** Stop treating facts like a report dump. Use metrics as evidence, but translate them into “user-facing human language”, while also moving `support_gap_analysis` onto a more quantitative deterministic contract.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/server.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. `comparison` answer 不再直接把 `share_pct / pop_grid` 当报表念出来。
   - 同样使用真实 evidence；
   - 但会翻译成：
     - “顺手买东西更方便”
     - “吃饭更方便”
     - “人流更活跃 / 更热闹”
   - 指标退到“事实依据”层，而不是直接塞给用户看。
2. `support_gap_analysis` 不再主打“当前命中 4 处 / 出现 2 次”。
   - 改成围绕：
     - 这个地方更像什么生活圈；
     - 哪些需求已经成型；
     - 真正的缺口更像什么；
   - 同时保留低样本 caution。
3. `chatPipeline.js` 和 `server.js`
   - 把 `support_bucket_metrics / population_metrics` 真正贯通到 answer options；
   - 避免数据已经有了，但 answer 层吃不到。

**Verification:**
- Red:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
  - 新增/调整测试先失败，命中：
    - comparison 仍在 dump `pop栅格均值`
    - support-gap 仍在 dump `当前命中 x 处`
- Green:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/runtimeSpatialAugmenter.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - `70/70` passed

**10-question regression evidence:**
- 最终 clean-instance 报告：
  - `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T14-09-45-846Z.json`

**Observed impact:**
1. `Q10` 终于开始“拿数据说人话”。
   - 现在不再直接输出：
     - `pop栅格均值约 30947`
   - 而会输出：
     - `武汉大学更像顺手买东西更方便的校园生活圈`
     - `湖北大学更像吃饭更方便的片区`
     - `湖北大学这一侧整体还要更热闹一些`
2. `Q6 / Q7` 终于不再像计数报表。
   - 现在会直接回答：
     - 更像什么生活圈
     - 哪类需求已经有基础
     - 缺口更像“还需要继续深挖哪类能力”
3. 这一轮也暴露了新的边界。
   - `support_gap` 虽然已经更像人话；
   - 但“缺口到底缺什么”还偏保守；
   - 目前更像是把“报表式计数”升级成了“方向性判断”，还没有到真正精准的 gap ranking。

**Delta summary vs Phase 4.C:**
| Q | Prompt | Phase 4.C | Phase 4.D | Delta |
|---|--------|-----------|-----------|-------|
| 6 | `请分析武汉大学附近的配套、热门业态和明显缺口。` | `2648ms` | `2459ms` | `-189ms` |
| 7 | `请分析湖北大学附近的配套、热门业态和明显缺口。` | `2550ms` | `2454ms` | `-96ms` |
| 8 | `请概览武汉大学附近的空间结构和业态分布。` | `2464ms` | `2414ms` | `-50ms` |
| 9 | `武汉大学附近适合布局什么业态？` | `2444ms` | `2333ms` | `-111ms` |
| 10 | `比较武汉大学和湖北大学附近的业态差异。` | `5053ms` | `4563ms` | `-490ms` |

**Next TODO:**
1. `Phase 4.E`
   - 继续把 `support_gap` 从“方向性描述”推进到“更具体的缺口排序”；
   - 重点压掉“说了很多，但还没明确告诉用户真正差哪一类”的保守倾向。
2. `Phase 4.F`
   - 继续收 comparison 的 denominator；
   - 让“更像顺手买东西 / 更像吃饭方便”背后的量化口径更稳定、更接近真实经营结构。

### Phase 4.E Result: Support-Gap Priority Ranking + Evidence-Verified Gap Guardrail

**Objective:** Push `support_gap_analysis` from “方向性判断” into explicit first/second-priority gap ranking, while refusing to treat generic macro-only bucket labels as fully-present evidence.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/supportEvidenceUtils.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. `supportEvidenceUtils.js`
   - 给 `support_gap_analysis` 增加了专用 bucket prior；
   - 提升 `零售购物 / 餐饮配套 / 生活服务 / 医疗健康 / 休闲娱乐` 的排序权重；
   - 下调 `教育服务 / 交通出行 / 其他配套` 这类宽 bucket 对 gap 判断的干扰。
2. `spatialAnswerService.js`
   - `support_gap` 的 deterministic fallback 不再停在“继续深挖”；
   - 现在会直接输出 `第一优先 / 第二优先` 的 gap ranking；
   - 低样本时自动切到 `先补查` 话术，不把弱证据写成确定缺口；
   - 对 bucket presence 的判断新增了 evidence-verification：
     - 如果某个 bucket 只有宏观 summary 标签、没有可读 representative POI 或可读 examples；
     - 它不会再被当成 fully-present evidence。
   - LLM prompt 也同步要求“按优先级给出 1-2 类更值得先补查或继续验证的缺口方向”。
3. `spatialAnswerService.spec.js`
   - 新增 red-green 用例覆盖：
     - prompt 中缺少 prioritized-gap guidance；
     - 成熟消费场景下 support-gap 仍停留在泛泛方向；
     - 低样本场景仍使用过度确定的缺口措辞。

**Verification:**
- Red:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
  - 新增断言先失败，命中：
    - support-gap prompt 还没有“优先级”约束；
    - deterministic answer 仍停在泛化缺口描述；
    - low-sample answer 还会把 gap 写得过于肯定。
- Green:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - `19/19` passed
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/runtimeSpatialAugmenter.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - `72/72` passed
  - `http://127.0.0.1:3300/health`
    - `status=ok`

**10-question regression evidence:**
- Final clean snapshot:
  - `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T14-35-58-915Z.json`

**Delta summary vs Phase 4.D:**
| Q | Prompt | Phase 4.D | Phase 4.E | Delta |
|---|--------|-----------|-----------|-------|
| 6 | `请分析武汉大学附近的配套、热门业态和明显缺口。` | `2459ms` | `2448ms` | `-11ms` |
| 7 | `请分析湖北大学附近的配套、热门业态和明显缺口。` | `2454ms` | `2741ms` | `+287ms` |
| 8 | `请概览武汉大学附近的空间结构和业态分布。` | `2414ms` | `2843ms` | `+429ms` |
| 9 | `武汉大学附近适合布局什么业态？` | `2333ms` | `2640ms` | `+307ms` |
| 10 | `比较武汉大学和湖北大学附近的业态差异。` | `4563ms` | `4924ms` | `+361ms` |

**Observed impact:**
1. `Q6 / Q7` 不再都落回“继续深挖”的保守尾句。
   - 现在会明确给出：
     - `第一优先`
     - `第二优先`
   - 至少 answer plane 已经真正进入“可执行 gap ranking”。
2. 低样本场景现在被 prompt + deterministic fallback 双重约束。
   - 当 evidence sparse 时，answer 会切到 `先补查`，而不是把弱信号写成确定缺口。
3. support-gap 开始区分“macro label 存在”和“readable evidence 存在”。
   - 这一步很关键，因为 `Q6 / Q7` 之前最容易被校园宏观标签拖偏；
   - 现在这类 bucket 想要影响最终 gap ranking，必须更接近真实可读证据。
4. 这一轮仍然不是终局。
   - `Q6` 仍可能把 `餐饮配套` 这类“宏观上有、但 readable evidence 不够连续”的 bucket 排到 gap top slot；
   - 这比 `Phase 4.D` 的泛化结论更具体了，但 denominator / evidence normalization 还可以继续收紧。

**Next TODO:**
1. `Phase 4.F`
   - 继续收 comparison denominator，尤其是 `Q10` 的 quantitative contrast；
   - 让 dual-region share 更接近真实可经营结构，而不是宽 bucket 混合分母。
2. 原始 10 题稳定后
   - 再扩展到旅游景点、出行、路网时间等更难评测集；
   - 避免在旧回归集仍有抖动时过早扩题。

### Phase 4.F Result: Evidence-Verified Comparison Denominator

**Objective:** Tighten `region_comparison` metrics so bucket shares stop counting broad macro-only labels and start reflecting buckets with readable evidence support.

**Files:**
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/supportEvidenceUtils.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/macroTaskExecutor.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/spatialAnswerService.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
- Modify: `D:/AAA_Edu/TagCloud/vite-project/CHANGELOG.md`

**What changed:**
1. `supportEvidenceUtils.js`
   - 新增 `hasReadableBucketEvidence()`；
   - 新增 `buildVerifiedSupportBucketMetrics()`；
   - bucket example 现在会同时过滤：
     - `科教文化 / 商务住宅 / 餐饮美食 / 购物消费` 这类泛化宏观 label；
     - `公交站 / 地铁站 / 交叉口 / 校区` 这类基础设施名。
2. `macroTaskExecutor.js`
   - comparison region payload 的 `support_bucket_metrics` 不再直接吃 raw macro summary；
   - 改成只对“有可读 evidence 的 bucket”重算 share。
3. `chatPipeline.js`
   - `comparison_regions` 进入 refined result 时会继续保持这套 tightened metrics；
   - 避免 answer 层和前端调试看到的还是旧分母。
4. `spatialAnswerService.js`
   - `resolveRegionBucketMetrics()` 现在优先消费 comparison region 上已经收紧过的 metrics；
   - 当提供了 verified metrics 时，不再从 raw `support_buckets` 把被淘汰的 generic bucket 加回来。
5. 测试层
   - 新增 comparison-specific red-green 用例：
     - macroTaskExecutor：交通类 infra bucket 不应继续占 comparison denominator；
     - chatPipeline：refined result 的 comparison metrics 应按 verified denominator 透传；
     - spatialAnswerService：answer 不应再把 generic macro-only secondary bucket 写成具体 trait。

**Verification:**
- Red:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
  - 新增断言先失败，命中：
    - comparison metrics 还在把 infra / generic macro-only buckets 算进分母；
    - refined result 仍透传旧 denominator；
    - answer 仍会把 generic dining/life bucket 写成具体 secondary trait。
- Green:
  - `npx vitest run V3-GeoEncoder-RAG/services/__tests__/retrieval/runtimeSpatialAugmenter.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/macroTaskExecutor.spec.js V3-GeoEncoder-RAG/services/__tests__/retrieval/spatialSearchOrchestrator.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/chatPipeline.spec.js V3-GeoEncoder-RAG/services/__tests__/ai/spatialAnswerService.spec.js`
    - `73/73` passed
  - `http://127.0.0.1:3300/health`
    - `status=ok`

**10-question regression evidence:**
- Final clean snapshot:
  - `D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/logs/eval_10q_report_2026-03-27T14-55-23-354Z.json`

**Delta summary vs Phase 4.E:**
| Q | Prompt | Phase 4.E | Phase 4.F | Delta |
|---|--------|-----------|-----------|-------|
| 6 | `请分析武汉大学附近的配套、热门业态和明显缺口。` | `2448ms` | `2515ms` | `+67ms` |
| 7 | `请分析湖北大学附近的配套、热门业态和明显缺口。` | `2741ms` | `2614ms` | `-127ms` |
| 8 | `请概览武汉大学附近的空间结构和业态分布。` | `2843ms` | `2554ms` | `-289ms` |
| 9 | `武汉大学附近适合布局什么业态？` | `2640ms` | `2514ms` | `-126ms` |
| 10 | `比较武汉大学和湖北大学附近的业态差异。` | `4924ms` | `4919ms` | `-5ms` |

**Observed impact:**
1. `Q10` 的 comparison denominator 现在更干净了。
   - 武汉大学侧不再继续把 generic `餐饮配套` 算成 concrete secondary trait；
   - 当前会更诚实地落到：
     - `零售购物`
     - `医疗健康`
   - 湖北大学侧也从 `餐饮 + 零售/交通混合噪声` 收敛成：
     - `餐饮配套`
     - `医疗健康`
2. 这轮说明“分母收紧”方向是对的。
   - `Q10` 的 latency 基本没变；
   - `Q6-Q9` 也没有被带崩，说明这次改动的 blast radius 是可控的。
3. 这一轮同时暴露了新的上限。
   - 一旦 generic bucket 被剔掉，两边都会落到 `医疗健康` 这种共性 secondary trait；
   - 这说明下一步最值得做的，不是继续机械收分母，而是压缩“共性 bucket”，把比较轴继续推向更有业务区分度的 secondary signal。

**Next TODO:**
1. `Phase 4.G`
   - 在 tightened denominator 的基础上，继续压缩 comparison 的共性 secondary bucket；
   - 让 `Q10` 更稳定地呈现“真正能区分两边”的第二特征，而不是双方都落到同一个保底 bucket。
2. 原始 10 题继续稳定后
   - 再扩展到旅游景点、出行、路网时间等更难评测集；
   - 继续保持“先阶段回归、再决定方向”的节奏。
