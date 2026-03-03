# SpatialRAG-WebGIS v1.3 可执行开发任务单（Frontend / Backend / Python）

- 日期：2026-03-03
- 适用仓库：`vite-project`
- 基线设计：`docs/2026-03-03-spatial-dsl-routing-integrated-v1.3.md`
- 文档目标：将 v1.3 设计拆解为可分派、可验收、可回滚的工程任务单

---

## 1. 执行目标

1. 将 DSL 校验从“执行期失败”前移到“网关入站失败”。
2. 落地 `context_binding` 并发语义（`client_view_id + event_seq + viewport_hash`）。
3. 落地 RFC 6902 patch 最小子集（`add/remove/replace`）并加安全边界。
4. 上线 Streaming + Prefetch 的可观测闭环（`prefetch_degraded/prefetch_wasted/prefetch_overlap_delta_ms`）。
5. 落地 critic 同步/异步分层与路由校准闭环。
6. 确保三模型策略一致执行：
   - `glm-ocr`
   - `qwen3.5-0.8b`
   - `qwen3.5-4b`

---

## 2. 分工边界

| 领域 | 责任团队 | 主要职责 |
|---|---|---|
| 前端 | Frontend | 采样冻结、`context_binding` 注入、会话视图并发序列、SSE 阶段可视化 |
| 网关与编排 | Backend (Fastify/Node) | DSL schema/semantic/policy 三段校验、patch 引擎、streaming parser、prefetch 编排、critic 路由、遥测 |
| 空间计算 | Python Service | 执行器消费 DSL 元信息、stats 观测字段、模型计时/降级原因输出、critic 结果结构统一 |

---

## 3. 里程碑与节奏

| Phase | 周期 | 目标 |
|---|---|---|
| A | 1 周 | schema/validator 基础落地（可阻断错误 DSL） |
| B | 1 周 | context binding + patch 安全闭环 |
| C | 1-2 周 | streaming parser + prefetch + 观测闭环 |
| D | 1 周 | critic 分层 + complexity 校准 + 路由策略收敛 |

---

## 4. 全局前置约束（必须先确认）

1. 所有新增字段遵循 UTF-8 编码，不引入乱码字符。
2. v1.3 中新增字段未进 schema 前，不允许默认开启生产写入。
3. 允许 `frontier` 临时等价 `medium`，但必须打 `frontier_emulated=true` 遥测，避免“伪分层”。
4. 关键错误码保持可机器消费：
   - `dsl_schema_invalid`
   - `dsl_semantic_invalid`
   - `dsl_policy_invalid`
   - `clarification_needed`

---

## 5. 任务总览（按团队+阶段）

| 任务ID | 阶段 | 团队 | 标题 | 依赖 |
|---|---|---|---|---|
| BE-A1 | A | Backend | 扩展 `spatial_query_v1.schema.json` 顶层字段 | - |
| BE-A2 | A | Backend | `operators.params` 条件子 schema 严格化 | BE-A1 |
| BE-A3 | A | Backend | 三段 validator（schema/semantic/policy）接入 | BE-A1, BE-A2 |
| BE-A4 | A | Backend | DSL 错误码与 SSE/日志映射 | BE-A3 |
| FE-A1 | A | Frontend | 请求体新增 DSL 元信息骨架（先占位） | BE-A1 |
| PY-A1 | A | Python | 透传并输出 DSL 观测字段占位 | BE-A4 |
| FE-B1 | B | Frontend | `client_view_id + event_seq + viewport_hash` 生成与冻结 | FE-A1 |
| BE-B1 | B | Backend | 会话视图状态存储（按 session+view） | BE-A3 |
| BE-B2 | B | Backend | context 一致性状态机校验（< / == / >=） | FE-B1, BE-B1 |
| BE-B3 | B | Backend | RFC6902 patch 引擎（add/remove/replace） | BE-A3 |
| BE-B4 | B | Backend | patch 路径白名单/黑名单/强制 rebuild | BE-B3 |
| BE-B5 | B | Backend | `constraints` 细粒度 patch 规则与 budget 联动校验 | BE-B4 |
| PY-B1 | B | Python | 消费 `revision/context_binding` 并产出 `context_refreshed` | BE-B2 |
| BE-C0 | C | Backend | Streaming JSON parser 技术预研（Spike） | BE-A3 |
| BE-C1 | C | Backend | Streaming JSON parser 状态机落地 | BE-C0 |
| BE-C2 | C | Backend | Prefetch 编排器（scope/entities 触发） | BE-C1 |
| BE-C3 | C | Backend | `prefetch_degraded/wasted/overlap_delta` 遥测落地 | BE-C2 |
| FE-C1 | C | Frontend | 前端阶段提示支持 prefetch 状态透传 | BE-C3 |
| PY-C1 | C | Python | 输出 prefetch 相关可诊断字段 | BE-C3 |
| BE-D1 | D | Backend | critic 同步/异步路由实现 | BE-A3 |
| PY-D1 | D | Python | critic 复核结果结构规范化 | BE-D1 |
| BE-D2 | D | Backend | complexity 校准任务与周报 | BE-D1 |
| BE-D3 | D | Backend | frontier=medium 仿真标记与路由收敛 | BE-D2 |
| FE-D1 | D | Frontend | 暴露 critic_mode / frontier_emulated UI 标记（可选） | BE-D3 |

---

## 6. 详细任务单

### BE-A1：扩展 DSL Schema 顶层字段

- 目标：在 schema 层纳入 `context_binding/revision/streaming_hints`，提供 v1.3 的结构入口。
- 主要文件：
  - `fastify-backend/schemas/spatial_query_v1.schema.json`
- 实施步骤：
  1. 新增 `context_binding` 定义：`viewport_hash/client_view_id/event_seq/map_state_version/captured_at_ms/source`。
  2. 新增 `revision` 定义：`mode/base_trace_id/patch_ops`。
  3. 新增 `streaming_hints` 定义：`allow_prefetch/prefetch_on_fields`。
  4. 增加 `v1_compat_mode` 行为说明（通过环境变量控制“忽略未知”或“严格拒绝”）。
- 验收标准：
  1. 合法 v1.3 DSL 能通过 schema 校验。
  2. 缺失关键字段时给出明确路径错误。
- 验证：
  - `node --test fastify-backend/tests/*.mjs`（新增 schema 测试）

### BE-A2：`operators.params` 严格化

- 目标：消除 `additionalProperties: true` 的晚失败风险。
- 主要文件：
  - `fastify-backend/schemas/spatial_query_v1.schema.json`
  - 新增 `fastify-backend/tests/dslOperatorsParamsSchema.test.mjs`
- 实施步骤：
  1. 按 `operator.type` 设计 `oneOf + if/then` 子 schema。
  2. 收紧 `fetch_candidates/filter_constraints/aggregate_h3/...` 约束。
  3. 对未知 param 键直接报 schema 错误。
- 验收标准：
  1. 非法 param 在 schema 阶段被拒绝。
  2. 现有合法请求不发生批量回归。

### BE-A3：三段 Validator 接入

- 目标：统一输出 schema/semantic/policy 三段校验结果与错误码。
- 主要文件：
  - 新增 `fastify-backend/services/dslValidator.js`
  - 新增 `fastify-backend/services/dslSemanticRules.js`
  - 新增 `fastify-backend/services/dslPolicyRules.js`
  - `fastify-backend/services/spatialJobRunner.js`
  - `fastify-backend/routes/ai/index.js`
- 实施步骤：
  1. `dslValidator.validate(dsl, runtimeContext)` 返回统一结构：`ok/error_code/errors/fix_hint`。
  2. 语义规则落地：DAG、`query_type` 与 `scope`、writer 互斥、risk 阈值等。
  3. 策略规则落地：`budget_tier` 与 `latency_budget_ms` 对齐。
  4. 在执行前阻断并写入 SSE error 事件。
- 验收标准：
  1. 三段失败可区分（`dsl_schema_invalid` / `dsl_semantic_invalid` / `dsl_policy_invalid`）。
  2. 错误响应可带修复建议。

### BE-A4：错误码与 SSE/日志映射

- 目标：把 DSL 校验错误纳入现有 SSE 与 telemetry 体系。
- 主要文件：
  - `fastify-backend/routes/ai/index.js`
  - `fastify-backend/services/errorDiagnostics.js`
  - `fastify-backend/services/telemetry.js`
- 实施步骤：
  1. 统一 `error_code`、`error_signature`、`failure_diagnostics` 输出。
  2. 新增 KPI：`dsl_schema_invalid_total`、`dsl_semantic_invalid_total`、`dsl_policy_invalid_total`。
  3. 保证异常路径不打断 SSE 通道关闭流程。
- 验收标准：
  1. 所有 DSL 校验失败均能被 telemetry 统计。
  2. 前端可稳定收到错误事件而不是 silent fail。

### FE-A1：请求体 DSL 元信息骨架

- 目标：前端先稳定输出 v1.3 字段骨架，便于后端灰度接入。
- 主要文件：
  - `src/components/AiChat.vue`
  - `src/composables/ai/useSpatialRequestBuilder.js`
  - `src/utils/aiService.js`
- 实施步骤：
  1. 在 options 中新增 `context_binding/revision/streaming_hints` 占位结构。
  2. 确保与现有 `spatialContext` 共存，不影响现有流程。
  3. 增加前端字段开关（灰度）。
- 验收标准：
  1. 关闭灰度时与现网行为一致。
  2. 开启灰度时请求字段完整、类型稳定。

### PY-A1：Python 观测字段占位

- 目标：Python pipeline 能接收并回传 DSL 元字段，便于端到端调试。
- 主要文件：
  - `fastify-backend/python_service/pipeline/spatial_pipeline.py`
  - `fastify-backend/python_service/tests/test_spatial_pipeline.py`
- 实施步骤：
  1. 解析 hints 中 DSL 元字段（仅透传，不改变业务逻辑）。
  2. 在 `results.stats` 与 `diagnostics` 增加回显字段（例如 revision_mode）。
- 验收标准：
  1. gRPC FINAL 返回可看到新增观测字段。
  2. 不影响既有核心结果结构。

### FE-B1：并发语义字段生成

- 目标：落地 `client_view_id + event_seq + viewport_hash`。
- 主要文件：
  - 新增 `src/utils/contextBinding.js`
  - `src/components/AiChat.vue`
  - `src/composables/ai/useSpatialRequestBuilder.js`
- 实施步骤：
  1. 每个地图视图实例生成一次 `client_view_id`。
  2. 每次提交请求递增 `event_seq`。
  3. 对冻结后的 viewport + drawMode + regions 生成稳定 hash。
- 验收标准：
  1. 同一视图内 `event_seq` 严格单调递增。
  2. 仅地图状态变化时 `viewport_hash` 变化。

### BE-B1：会话视图状态存储

- 目标：后端按 `(session_id, client_view_id)` 保存最后上下文状态。
- 主要文件：
  - 新增 `fastify-backend/services/contextBindingState.js`
  - `fastify-backend/services/spatialJobRunner.js`
- 实施步骤：
  1. **本期拍板**：采用“进程内内存态 + TTL”，不引入 Redis。
  2. 字段：`last_event_seq/last_viewport_hash/last_scope_snapshot`。
  3. 提供 `load/update/evict` 接口。
  4. 在 PR description 增加决策记录：当前单实例开发部署选择内存态；多实例时再迁移 Redis。
- 验收标准：
  1. 多标签页互不污染。
  2. 长会话不会无限增长（TTL 生效）。

### BE-B2：context 一致性状态机校验

- 目标：严格执行 `< / == / >=` 三分支判定。
- 主要文件：
  - `fastify-backend/services/dslSemanticRules.js`
  - `fastify-backend/services/spatialJobRunner.js`
- 实施步骤：
  1. `event_seq < last_event_seq` -> `context_stale=true`。
  2. `event_seq == last_event_seq && hash一致` -> 幂等重放。
  3. `event_seq >= last_event_seq && hash不一致` -> 低风险刷新/高风险澄清。
  4. 缺字段走降级：`context_binding_degraded=true`。
- 验收标准：
  1. 与 v1.3 文档规则一致。
  2. 低风险自动刷新、高风险阻断澄清可复现。

### BE-B3：Patch 引擎（RFC6902 子集）

- 目标：支持 `add/remove/replace`，拒绝 `copy/move/test`。
- 主要文件：
  - 新增 `fastify-backend/services/dslPatchEngine.js`
  - `fastify-backend/services/dslValidator.js`
- 实施步骤：
  1. 校验 patch op 结构。
  2. 逐条应用 patch，失败时返回精确路径错误。
  3. patch 后强制触发三段全量校验。
- 验收标准：
  1. 非支持 op 必须返回 `dsl_semantic_invalid`。
  2. patch 成功后 DSL 可直接进入执行。

### BE-B4：Patch 路径边界

- 目标：消除 patch 越权修改策略/风险字段的漏洞。
- 主要文件：
  - `fastify-backend/services/dslPatchEngine.js`
  - `fastify-backend/services/dslSemanticRules.js`
- 实施步骤：
  1. 落地白名单、黑名单、强制 rebuild 路径。
  2. 命中黑名单直接拒绝。
  3. 命中强制 rebuild 路径返回“建议重建”。
- 验收标准：
  1. `/policy/*`、`/uncertainty/*`、`/routing/*` 无法被 patch。
  2. `/scope/*`、`/task/query_type` patch 会被拦截并建议 rebuild。

### BE-B5：`constraints` 细粒度 patch 规则（补 Claude 指出缺口）

- 目标：修复 `/constraints/*` 通配符过宽问题。
- 主要文件：
  - `fastify-backend/services/dslPatchEngine.js`
  - `fastify-backend/services/dslPolicyRules.js`
  - `fastify-backend/services/dslSemanticRules.js`
- 实施步骤：
  1. 将 `/constraints/*` 拆细为字段级白名单。
  2. 对 `latency_budget_ms`、`token_budget` 定义“条件可 patch”：
     - patch 这两者后，必须验证与 `policy.budget_tier` 一致。
  3. 若不一致，返回 `dsl_semantic_invalid` + `fix_hint`（建议 rebuild 或同步 patch policy）。
- 验收标准：
  1. 单改 `latency_budget_ms` 导致不一致时，必然被拒绝。
  2. 修复建议文本可被前端直接展示。

### PY-B1：Python 执行器接入 context/revision 语义结果

- 目标：消费后端决策结果并透传到 stats，便于回溯。
- 主要文件：
  - `fastify-backend/python_service/pipeline/spatial_pipeline.py`
  - `fastify-backend/python_service/tests/test_spatial_pipeline.py`
- 实施步骤：
  1. 接收 `context_refreshed/context_stale/revision_mode`。
  2. 输出到 `results.stats` 与 `diagnostics`。
- 验收标准：
  1. 端到端链路可在最终 payload 中看到 context/revision 状态。

### BE-C0：Streaming JSON Parser 技术预研（Spike）

- 目标：在 Phase C 正式开发前完成 parser 选型，降低延期风险。
- 主要文件：
  - 新增 `fastify-backend/scripts/spikes/streaming_dsl_parser_spike.mjs`
  - 新增 `docs/spikes/2026-03-streaming-parser-spike.md`
- 实施步骤：
  1. 对比两种方案：
     - 方案A：第三方流式 JSON 解析库
     - 方案B：项目内最小状态机（先支持 `scope` 闭合识别）
  2. 用真实样本流（正常/截断/乱序）跑最小 demo。
  3. 输出选型结论、已知限制、性能初测。
- 验收标准：
  1. 能稳定识别 `scope` 字段闭合事件。
  2. 截断 JSON 不导致进程异常。
  3. 形成 1 份可审阅 spike 结论文档。

### BE-C1：Streaming JSON Parser 状态机

- 目标：在 Planner token 流中识别字段闭合点，触发早期事件。
- 主要文件：
  - 新增 `fastify-backend/services/dslStreamingParser.js`
  - `fastify-backend/services/spatialJobRunner.js`
- 实施步骤：
  1. 状态定义：`S0/S1/S2/S3/S4`。
  2. 触发点：`scope` 闭合、`entities.categories` 闭合、dsl complete。
  3. 非法流回退到非流式 planner。
- 验收标准：
  1. 截断 JSON 不导致进程异常。
  2. 回退路径可观测（带 error_code）。

### BE-C2：Prefetch 编排器

- 目标：实现 scope/entities 级别预取并发与取消。
- 主要文件：
  - 新增 `fastify-backend/services/prefetchOrchestrator.js`
  - `fastify-backend/services/spatialJobRunner.js`
  - `fastify-backend/services/queryCache.js`
- 实施步骤：
  1. `scope-ready` 启动空间候选预取。
  2. `entities-ready` 启动分类过滤预取。
  3. DSL 最终校验失败时释放预取结果并标记 wasted。
- 验收标准：
  1. 预取失败不阻断主执行。
  2. 预取命中且 DSL 失败时，`prefetch_wasted=true`。

### BE-C3：Prefetch 可观测性闭环

- 目标：补齐 prefetch 指标体系与周度门禁。
- 主要文件：
  - `fastify-backend/services/telemetry.js`
  - `fastify-backend/services/spatialJobRunner.js`
  - `fastify-backend/scripts/kpi_report.js`（如需扩展）
- 实施步骤：
  1. 新增 KPI：
     - `prefetch_degraded_total`
     - `prefetch_wasted_total`
     - `prefetch_overlap_delta_ms`
  2. 输出周报字段 `prefetch_wasted_rate`。
  3. 加入审查阈值（>5% 触发路由审查）。
- 验收标准：
  1. 第10节预算口径可用真实数据回填。
  2. 指标可按 query_type 维度聚合。

### FE-C1：前端 prefetch 状态可视化

- 目标：将 prefetch 降级/浪费信号接入调试态 UI。
- 主要文件：
  - `src/components/AiChat.vue`
  - `src/composables/ai/useAiStreamDispatcher.js`
- 实施步骤：
  1. 识别并存储 `prefetch_degraded/prefetch_wasted`。
  2. 调试模式显示“预取有效/浪费/降级”标记。
- 验收标准：
  1. 不影响普通用户路径（默认隐藏）。
  2. 调试态可快速定位 parser/prefetch 问题。

### PY-C1：Python 预取可诊断字段

- 目标：在 Python 返回中补齐 prefetch 相关诊断承接字段。
- 主要文件：
  - `fastify-backend/python_service/pipeline/spatial_pipeline.py`
- 实施步骤：
  1. 透传 `prefetch_degraded/prefetch_wasted/prefetch_overlap_delta_ms`。
  2. 纳入 `stats` 与 `diagnostics` 统一结构。
- 验收标准：
  1. Node/Python 指标口径一致。

### BE-D1：Critic 同步/异步分层

- 目标：`critical` 同步阻断、`high` 异步复核。
- 主要文件：
  - `fastify-backend/services/spatialJobRunner.js`
  - `fastify-backend/routes/ai/index.js`
  - `fastify-backend/services/queue.js`
- 实施步骤：
  1. 路由决策输出 `critic_mode=off|async|sync`。
  2. sync critic 失败 -> `clarification_needed` 或 `dsl_execution_blocked`。
  3. async critic 结果写入 `ops/audit` 与 telemetry。
- 验收标准：
  1. `critical` 请求无越权执行。
  2. `high` 请求首包时延不被 critic 阻断。

### PY-D1：critic 结构规范化

- 目标：Python 侧复核结果与 Node 侧审计结构一致。
- 主要文件：
  - `fastify-backend/python_service/pipeline/self_validator.py`
  - `fastify-backend/python_service/pipeline/spatial_pipeline.py`
- 实施步骤：
  1. 统一字段：`critic_pass/reasons/fix_suggestions/confidence`。
  2. 保障 FINAL payload 可被 Node 无损消费。
- 验收标准：
  1. 异步回写与同步阻断共享同一数据结构。

### BE-D2：complexity 校准闭环

- 目标：双周校准 complexity_score，避免漂移。
- 主要文件：
  - `fastify-backend/services/telemetry.js`
  - `fastify-backend/scripts/kpi_report.js`
  - 新增 `fastify-backend/scripts/recalibrate_complexity.js`
- 实施步骤：
  1. 按 query_type、latency、失败率、critic 命中率输出校准建议。
  2. 生成路由参数建议差异报告。
- 验收标准：
  1. 有周期产物（报告）且可复盘。

### BE-D3：frontier 仿真策略（补 Claude 指出缺口）

- 目标：在尚无更大模型时，避免“frontier 名义存在、能力无差异”。
- 主要文件：
  - `fastify-backend/services/spatialJobRunner.js`
  - `fastify-backend/routes/ai/planner.js`
  - `docs/2026-03-03-spatial-dsl-routing-integrated-v1.3.md`（如仅注释可不改）
- 实施步骤：
  1. 将 `frontier` 路由行为显式等价 `medium`。
  2. 强制打点 `frontier_emulated=true`。
  3. 在日志中标记“当前结果质量上限受本地模型约束”。
- 验收标准：
  1. 任何 frontier 路径都可追踪到 emulated 事实。

### FE-D1：critic/frontier 状态展示（可选）

- 目标：在调试态展示 `critic_mode` 与 `frontier_emulated`。
- 主要文件：
  - `src/components/AiChat.vue`
  - `src/utils/aiTemplateMetrics.js`
- 验收标准：
  1. 不影响用户默认体验。
  2. 调试态可直观看到路由模式。

---

## 7. 验收口径（与 v1.3 对齐 + 补丁）

1. Schema 校验通过率 `>= 99%`。
2. `dsl_semantic_invalid_rate < 1%`。
3. 参数通道 `P95 <= 1800ms`（以实测回填为准）。
4. `critical` 风险请求无越权执行。
5. patch 命中黑名单路径时，100% 返回 `dsl_semantic_invalid`。
6. `prefetch_wasted_rate` 可观测，周统计 >5% 自动告警。
7. `context_binding_degraded_rate` 可观测并持续下降。
8. 将原“viewport_hash 不一致率”升级为：
   - `context_stale_rate`（`event_seq < last_event_seq`）
   - `context_view_changed_rate`（`event_seq >= last_event_seq && hash mismatch`）
9. `context_stale_rate` 与 `context_view_changed_rate` 均为“可观测（基线待实测确定）”，Phase B 上线后观测 2-3 天建立基线，Phase D 再固化告警阈值。

---

## 8. 测试与验证清单（执行顺序）

### 前端

1. `npm run test -- src/utils/__tests__/sseEventSchema.spec.js`
2. `npm run test -- src/utils/__tests__/aiServiceModelTiming.spec.js`
3. `npm run test -- src/composables/ai/__tests__/useIntentTemplateSelector.spec.js`

### 后端

1. `node --check fastify-backend/routes/ai/index.js`
2. `node --check fastify-backend/services/spatialJobRunner.js`
3. `node --test fastify-backend/tests/*.mjs`

### Python

1. `python -m py_compile fastify-backend/python_service/pipeline/spatial_pipeline.py`
2. `python -m py_compile fastify-backend/python_service/pipeline/vlm_reviewer.py`
3. `python -m py_compile fastify-backend/python_service/pipeline/reasoning_reviewer.py`
4. `python -m pytest fastify-backend/python_service/tests/test_spatial_pipeline.py -q`

---

## 9. 风险与回退策略

1. Schema 升级导致请求拒绝率骤升：
   - 回退：启用 `v1_compat_mode=true`，临时降为“忽略新增字段 + 打点”。
2. context 状态机误判导致澄清率上升：
   - 回退：仅对 `critical` 执行状态机，`low/high` 临时退回 v1.2 逻辑。
3. patch 引擎误拦截：
   - 回退：强制 `revision.mode=rebuild` 并保留 patch 日志样本。
4. prefetch 引发资源抖动：
   - 回退：关闭 `allow_prefetch`，主流程保持可用。

---

## 10. 本周执行建议（可直接开工）

1. 先做 Phase A（BE-A1/A2/A3/A4 + FE-A1 + PY-A1），把“前置校验”打稳。
2. 紧接做 Phase B（优先 BE-B5），先修复 Claude 指出的 `constraints` patch 缺口。
3. Phase C 前先执行 BE-C0（1-2 天 Spike）：确定 parser 选型并跑通最小 demo，再进入 BE-C1 正式开发。
4. Phase C 上 prefetch 前，先对 telemetry 扩展字段定稿，避免返工。
5. Phase D 完成前，先落地 `frontier_emulated=true`，避免策略层虚假分层。
