# 2026-03-05 Phase F Follow-up: 四个关键问题修复开发计划

## 0. 文档目的与范围
- 目的: 面向当前线上/联调暴露的 4 个关键问题，形成可执行的修复方案与验收门槛。
- 范围: `fastify-backend`（planner / writer / spatialJobRunner / queue / launcher）、`python_service`（spatial_pipeline）、`src/components/AiChat.vue`。
- 非范围: UI 风格改版、业务口径重定义（仅修正确性与稳定性）。

## 1. 现存问题总览
| ID | 问题 | 严重度 | 当前影响 |
|---|---|---|---|
| P1 | 大视图下仅出现 1~2 簇“模糊边界” | 高 | 分析结果失真，热点/机会点结论不可信 |
| P2 | 输出文本仍出现 `###**...***` 等异常 Markdown | 中高 | 前端导出与部分链路显示异常，文档可读性差 |
| P3 | 全程链路分析耗时过长 | 高 | 典型请求 50s+，明显超出“30秒内给结论”目标 |
| P4 | 启动日志看似正常但存在性能/稳定性风险信号 | 中 | 冷启动窗口失败率上升，并发吞吐受限 |

## 2. 问题诊断与根因

### 2.1 P1 大视图单簇/少簇问题
#### 现象
- 在 `area_km2=45.777` 的大视图场景中，出现 `clusters=1` 或 `clusters=2`，与同面积场景下 `clusters=13` 明显不一致。

#### 证据
- `RAG_LOG/RAG_2026-03-03.jsonl`:
  - line 10: `area_km2=45.777`, `clusters=1`, `cache_hit=false`
  - line 11: `area_km2=45.777`, `clusters=1`, `cache_hit=false`
- `RAG_LOG/RAG_2026-03-04.jsonl`:
  - line 26: `area_km2=45.777`, `clusters=13`, `cache_hit=false`
  - line 27: `area_km2=45.777`, `clusters=2`, `cache_hit=true`

#### 根因
1. 聚类兜底策略会在“无分组 + 点数>=8”时强制单簇。
   - `fastify-backend/python_service/pipeline/spatial_pipeline.py:4721-4728`
2. undersegmentation guard 仅覆盖“dedup 导致簇数骤降”的场景，无法修复“原始结果就只有单簇”的情况。
   - `spatial_pipeline.py:2862-2868`, `5404-5418`
3. 历史缓存命中会把低簇结果快速复用（虽已有 V2 key + post-hit guard，但历史污染与边界条件仍会出现）。

---

### 2.2 P2 Markdown 结构异常
#### 现象
- 导出文本仍出现 `###**1...***`、`***标题**` 等非法混排。
- 典型文件: `TagCloud_Chat_1772633636502.txt`。

#### 根因
1. Writer 先流式 `yield`，后做 markdown contract 校验；规范化后的 `cleanedOutput` 没有回写替换已输出流。
   - `fastify-backend/routes/ai/writer.js:870-877`, `1338-1341`
2. 前端导出使用 `sanitizeAssistantVisibleText`，未执行 markdown normalize。
   - `src/components/AiChat.vue:1000-1003`, `988-1013`
3. RAG 日志中的大对象会被截断预览，导致 markdown_contract 观测不完整，排查成本升高。
   - `fastify-backend/routes/ai/index.js:146-157`

---

### 2.3 P3 链路过慢
#### 现象
- 典型 `area_analysis` 请求耗时 54s~56s。
- 关键慢点常见在 planner、vector retrieval、cluster/fusion、writer。

#### 证据（样本）
- `RAG_LOG/RAG_2026-03-05.jsonl` line 1:
  - 总时长 `55730ms`
  - `vector_retrieval_start -> done`: `16100ms`
  - `model_parallel_start -> done`: `8631ms`
  - `cluster -> fusion_validation`: `9608ms`
  - `writer -> writer_validation`: `6632ms`
- `RAG_LOG/RAG_2026-03-05.jsonl` line 2:
  - 总时长 `54383ms`
  - `planner -> planner_stream_fallback`: `20495ms`
  - 错误码: `planner_stream_truncated`（来自 parser），若 parser 未给出错误码则回退为 `planner_stream_no_json`

#### 根因
1. Planner 流式失败后会回退 non-stream，形成双调用成本；且流式错误码来源有两级（parser 优先，其次 `planner_stream_no_json` 兜底）。
   - `fastify-backend/routes/ai/planner.js:679-681`
   - `fastify-backend/services/dslStreamingParser.js:24`
2. Vector 检索 `top_k` 上限较高（1200），在高负载时显著拉长。
   - `fastify-backend/services/spatialJobRunner.js:1365`
3. Python 并行模型阶段频繁降级（`budget_exceeded` / `vlm_remote_error:*`），既耗时又影响质量。
   - `spatial_pipeline.py:3227-3234`, `3705-3708`
4. Writer token 预算偏高（`area_analysis` 默认 1800，运行时可被 options/env 覆盖），输出阶段耗时明显。
   - `fastify-backend/routes/ai/writer.js:71`, `80-99`
5. Redis 缺失时内存队列串行消费（并发=1）。
   - `fastify-backend/services/queue.js:13`, `273-286`
6. 启动窗口期 gRPC 未就绪触发失败（`14 UNAVAILABLE`），造成重试/失败成本。
   - `RAG_2026-03-04.jsonl` line 13/14 出现 `python_fallback_error` + `14 UNAVAILABLE`

---

### 2.4 P4 启动日志健康性
#### 现状判断
- 数据库、PostGIS、pgvector、服务监听均正常。
- 但存在风险信号:
  - `inline-worker (redis-missing)`
  - `python gRPC not ready within 15000ms`

#### 根因
1. 缺少 Redis，队列退化到 memory mode，吞吐被单 worker 限制。
2. launcher 在 gRPC 就绪等待超时后直接继续启动 backend，冷启动窗口内请求可能失败。
   - `fastify-backend/scripts/dev_stack.js:294-299`
3. 启动日志文案“fallback path”与当前“强制 Python 主路径”策略语义不一致，易误导排障。
   - `fastify-backend/services/migrationPolicy.js:151-156`

## 3. 修复方案（按优先级）

### 3.1 P0（立即止损，1~2天）
#### P0-1 修复 Markdown 异常链路
- Backend:
  - 将 Writer 规范化前置到输出链路（流式分段规范化），或在完成时发“canonical replace”事件并强制覆盖最终 message content。
  - 在 `writer_validation` 中上报 `normalized_before_emit` 与 `normalized_after_emit` 指标。
- Frontend:
  - `saveChatHistory` 导出前统一调用 `normalizeMarkdownForRender`。
- 验收:
  - 任意导出文本不得出现 `###**`、`***标题**`。

#### P0-2 降低大视图单簇概率
- Python:
  - 对 `area_analysis` 在 `area_km2 >= 20` 且 `total_candidates >= 120` 时，禁用 `allowSingleClusterFallback`。
  - 新增“单簇风险补救”: 当 `cluster_count < min_regions` 时进入二次切分（先参数重试，再轻量网格切分）。
- 验收:
  - 当 `area_km2 >= 20` 且 `total_candidates >= 120` 时，`cluster_count` 必须 `>= 5`。
  - 仅当 `total_candidates < 120` 或数据质量不足时，允许输出 `undersegmentation_risk=true`，并附带补救标记。

### 3.2 P1（性能优化，2~4天）
#### P1-1 Planner 慢点治理
- 对 `planner_stream_truncated` / `planner_stream_malformed` 引入快速失败阈值（超时/连续 parse fail 直接切 non-stream，而不是长时间等待）。
- 明确阈值（默认值，可配置）:
  - `planner_stream_max_wait_ms = 3000`
  - `planner_stream_max_no_progress_chunks = 80`
  - `planner_stream_fallback_nonstream_timeout_ms = 5000`
- 记录 parser 状态转移耗时与 chunk 数，便于后续回归。

#### P1-2 Vector 与模型并行治理
- 动态 `top_k`：按 query_type / area / zoom 分级，默认映射如下:
  - `area_km2 < 5`: `top_k=400`, `modelBudgetMs=5000`
  - `5 <= area_km2 < 20`: `top_k=600`, `modelBudgetMs=6500`
  - `area_km2 >= 20`: `top_k=800`, `modelBudgetMs=8000`
- 配置映射示例（便于实现与评审对齐）:
```javascript
const TOP_K_BY_AREA = {
  '<5': 400,
  '5-20': 600,
  '>=20': 800
}
```
- 仅在“候选稀疏且召回不足”时允许上调一级，不超过 `top_k=1000`。
- 增加向量检索分阶段超时与熔断策略。
- `modelBudgetMs` 分层配置（小视图更短，大视图按需放大），避免统一预算导致频繁 `budget_exceeded`。
- 引入召回率保护门槛：性能优化后，固定回归集 `top-50` 召回下降不得超过 `3%`。
- 固定回归集来源（2026-03-05 版）:
  - 离线评估样本: `fastify-backend/python_service/scripts/eval_output/hubei_university_latest_v7_eval.json`、`shahu_park_latest_v7_eval.json`
  - 在线回放样本: `RAG_LOG/RAG_2026-03-03.jsonl`、`RAG_LOG/RAG_2026-03-04.jsonl`、`RAG_LOG/RAG_2026-03-05.jsonl` 中 `area_analysis` traces（去重后不少于 50 条）

#### P1-3 Writer 耗时治理
- 细化 `area_analysis` 的 maxTokens 与 context 裁剪策略。
- 当上游结果已具备结构化结论时，Writer 改为“短模板渲染优先”。

### 3.3 P2（基础设施与可观测，2~3天）
#### P2-1 队列与启动稳定性
- 接入 Redis（至少测试/预发环境），提升并发消费能力。
- 启动阶段增加 gRPC readiness 门禁与重试策略，减少 `UNAVAILABLE` 窗口。
- 对 launcher 文案进行语义修正（明确当前是否存在可用回退路径）。

#### P2-2 诊断可观测增强
- RAG 日志对关键字段采用白名单透传（字段路径）:
  - `stats.single_cluster_fallback_applied`
  - `stats.undersegmentation_risk`
  - `stats.undersegmentation_reason`
  - `stats.undersegmentation_effective_cluster_count`
  - `stats.writer_markdown_contract_normalized`
  - `diagnostics.markdown_contract.normalized`
- 看板兼容别名（可选）:
  - `markdown_contract_fix = stats.writer_markdown_contract_normalized`
- 固化错误码看板：
  - `planner_stream_truncated`
  - `model_parallel_failed:budget_exceeded`
  - `vlm_remote_error:*`
  - `14 UNAVAILABLE`
  - `writer_fallback_empty`

## 4. 实施清单（模块级）
- `fastify-backend/routes/ai/writer.js`
  - 调整流式输出与校验顺序。
  - 增加 canonical output 覆盖逻辑。
- `src/components/AiChat.vue`
  - 导出路径增加 markdown normalize。
- `fastify-backend/python_service/pipeline/spatial_pipeline.py`
  - 调整单簇 fallback 策略与 underseg 补救分支。
- `fastify-backend/routes/ai/planner.js`
  - planner streaming fallback 触发阈值优化。
- `fastify-backend/services/spatialJobRunner.js`
  - 动态 top_k、更多阶段耗时上报。
- `fastify-backend/services/queue.js` / `scripts/dev_stack.js`
  - 启动健康门禁与提示文案修正。

## 5. 验收标准（DoD）
1. 大视图回放集:
   - 当 `area_km2 >= 20` 且 `total_candidates >= 120` 时，必须满足 `cluster_count >= 5`。
   - 仅当 `total_candidates < 120` 或数据质量不足（有明确诊断证据）时，允许 `undersegmentation_risk=true`，且必须带有“已触发补救/建议重算”标记。
2. Markdown:
   - 导出与展示均不出现 `###**` / `***标题**`。
3. 性能:
   - 基线与环境前提:
     - 样本: `RAG_2026-03-03/04/05` 的 `area_analysis` 回放集。
     - 模式: `sync`，单请求串行压测（并发=1），同一测试机与相同网络条件。
   - 目标:
     - `area_analysis` 端到端 P95 `<= 30s`。
     - 阶段级 SLO:
       - Planner `<= 6s`
       - Vector Retrieval `<= 8s`
       - Cluster + Fusion `<= 8s`
       - Writer `<= 6s`
     - 召回保护:
       - 固定回归集（见 3.2 P1-2）`top-50` 召回下降 `<= 3%`（对比修复前基线快照）。
4. 稳定性:
   - 冷启动窗口 `14 UNAVAILABLE` 显著下降；无连续失败。
5. 日志可观测:
   - 关键诊断字段可直接在 RAG_LOG 检索，不依赖 preview 截断内容。
6. 开关可回滚性:
   - 每项修复必须绑定 feature flag，灰度验证与一键回滚路径均可用。

## 6. 测试与回归计划
- Backend 单测:
  - `fastify-backend/tests/writerMarkdownContract.test.mjs`
  - 新增: `writerStreamCanonicalization.test.mjs`
  - 新增: `plannerStreamingFallbackThreshold.test.mjs`
- Frontend 单测:
  - `src/utils/__tests__/markdownContract.spec.js`
  - 新增: `AiChat.exportMarkdownNormalize.spec.js`
- Python 测试:
  - 新增: `test_large_view_single_cluster_guard.py`
  - 新增: `test_undersegmentation_secondary_split.py`
- 回放验证:
  - 对 `RAG_2026-03-03/04/05` 中典型 trace 回放并对比指标。
- 召回回归验证:
  - 使用 `fastify-backend/python_service/scripts/eval_output/hubei_university_latest_v7_eval.json` 与 `shahu_park_latest_v7_eval.json` 作为离线基线。
  - 从 `RAG_2026-03-03/04/05` 生成固定在线回放子集（`area_analysis` 去重后 >= 50 条）并固化为版本化清单。

## 7. 发布策略与回滚开关
- 分批次发布: P0 -> P1 -> P2。
- 已存在且可直接用于灰度/回滚的开关:
  - `PLANNER_STREAMING_ENABLED`
  - `SPATIAL_CACHE_POST_HIT_GUARD`
  - `SPATIAL_UNDERSEGMENTATION_GUARD`
  - `SPATIAL_UNDERSEGMENTATION_AREA_THRESHOLD_KM2`
- 当前为参数或硬编码（需先标准化为环境变量）:
  - `hints.options.allowSingleClusterFallback`（当前为请求级 options，不是全局 env）
  - `validateWriterOutput(..., { enforceMarkdownContract: true })`（当前为代码常量）
- 建议新增并在代码落地后再纳入发布开关:
  - `WRITER_MARKDOWN_CONTRACT_ENABLED`
  - `WRITER_CANONICAL_REPLACE_ENABLED`
  - `SPATIAL_ALLOW_SINGLE_CLUSTER_FALLBACK_DEFAULT`
- 回滚原则:
  - 任一阶段出现 P0 级回归（空输出、崩溃、大面积超时）立即回退该阶段开关，不影响其余已稳定改动。

## 8. 里程碑
- M1（D+1）: Markdown 全链路修复 + 大视图单簇止损。
- M2（D+3）: Planner / Vector / Writer 慢点优化上线。
- M3（D+5）: 启动稳定性与日志可观测增强完成，输出复盘报告。
