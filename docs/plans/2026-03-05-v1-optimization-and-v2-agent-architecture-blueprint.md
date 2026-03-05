# 2026-03-05 V1 优化与 V2 空间智能体架构蓝图

## 0. 文档目的
- 在已将后端目录重命名为 `V1-fastify-backend`、并创建 `V2-Agent-backend` 的前提下，维护两套长期并行、相互独立的方案：
  - V1：不改变当前架构思路下，持续优化性能与稳定性。
  - V2：面向现代化 Spatial Agent + WebGIS 的工程化新架构设计。
- 明确边界：
  - 本文不定义“V1 迁移到 V2”的切流计划。
  - V2 不复用 V1 代码块，不依赖 V1 运行时。
- 性能目标拆分：
  - `<=10s` 定义为 Fast Lane 的“可行动首轮结论”目标。
  - Deep Lane 用于复杂分析异步补全，采用分级预算而非统一 10s。

## 1. 当前状态确认
- 当前 V1 主后端目录：`V1-fastify-backend`
- 预留 V2 目录：`V2-Agent-backend`
- 现有系统核心链路（V1）：`planner -> dsl_validate -> vector_retrieval -> python_compute -> writer -> sse`
- 双轨独立基线：
  - V1 与 V2 各自独立发布、独立回滚、独立监控看板。
  - 可以共享同一数据源（PostGIS/pgvector），但通过稳定接口/视图隔离，不共享业务代码。

## 2. V1 可优化策略（不改架构思路）

### 2.1 优化边界
- 不更换技术栈（继续 Node/Fastify + Python 空间算子）。
- 不推翻现有 DSL/校验/队列/SSE 主链。
- 优先做“低风险高收益”的参数、调度、缓存、观测与输出链路优化。

### 2.2 融合四个关键问题修复计划（Phase F）
以下内容融合自 `2026-03-05-phase-f-followup-4-issues-remediation-plan.md`，并按 10 秒目标补强。

#### P1 大视图单簇问题
- 根因：`allowSingleClusterFallback` 在大视图仍可能触发单簇兜底；undersegmentation guard 未覆盖全部场景。
- V1 策略：
  - 在 `area_km2 >= 20 && total_candidates >= 120` 场景禁用单簇 fallback。
  - 触发 underseg risk 时执行二次切分补救（参数重试 + 轻量网格切分）。
  - 强化日志透传：`single_cluster_fallback_applied`、`undersegmentation_risk`、`undersegmentation_effective_cluster_count`。
- 验收：满足大视图条件时 `cluster_count >= 5`，否则必须明确 `risk=true` 且附补救标记。

#### P2 Markdown 输出结构异常
- 根因：Writer 先输出后校验，前端导出未统一 normalize。
- V1 策略：
  - Writer 增加“规范化前置”或“结束时 canonical replace”。
  - 前端导出统一走 `normalizeMarkdownForRender`。
  - 白名单透传字段：`stats.writer_markdown_contract_normalized`、`diagnostics.markdown_contract.normalized`。
- 验收：导出与渲染都不再出现 `###**...***`、`***标题**`。

#### P3 全链路过慢
- 根因：Planner fallback 双调用成本、top_k 偏大、模型预算超时、Writer token 偏高、内存队列串行。
- V1 策略：
  - Planner 快速失败阈值：`planner_stream_max_wait_ms=3000`、`max_no_progress_chunks=80`。
  - 动态 `top_k`（映射示例）：
    - `<5km2: 400`
    - `5-20km2: 600`
    - `>=20km2: 800`
    - 稀疏召回不足可上调一级，封顶 `1000`。
  - 模型预算分层：小视图更短、大视图按需增长，减少 `budget_exceeded`。
  - Writer 控长：`area_analysis` 下调 token 上限，优先结构化模板短答案。
  - 队列并发：尽快接入 Redis，避免内存模式单 worker。
- 验收：
  - 同条件回放集中，`P95 <= 30s`（先达成）。
  - 同时建立 10 秒快速通道（见 2.4）。

#### P4 启动日志健康性
- 判断：日志“可启动但有风险”，主要是 Redis 缺失和 gRPC 冷启动窗口。
- V1 策略：
  - 启动门禁：gRPC readiness 强化 + 重试策略。
  - 文案修正：明确 fallback 是否真实可用，减少误判。
  - 加入冷启动专项指标：`UNAVAILABLE` 次数、首个成功请求耗时。

### 2.3 召回保护与配置一致性（补强）
- 固定回归集：
  - 离线：`hubei_university_latest_v7_eval.json`、`shahu_park_latest_v7_eval.json`
  - 在线：`RAG_2026-03-03/04/05` 中 `area_analysis` 去重样本（>=50）
- 召回门槛：优化后 `top-50 recall` 下降不得超过 `3%`。
- Feature flag 一致性：仅使用代码中真实存在变量做灰度；不存在的先落地再纳入发布开关。

### 2.4 面向“10 秒内可用响应”的 V1 快速通道
说明：10 秒目标定义为“首个可行动结论可见”，而不是“全部深度分析完成”。

- 快速通道触发条件：
  - `query_type=area_analysis` 且 `area_km2 <= 20`
  - 非高风险校验阻断
  - 关闭重型可选算子（例如高开销视觉/深推理）
- 阶段预算（建议值）：
  - Planner + DSL 校验：`<= 1.5s`
  - Vector 检索：`<= 2.5s`
  - Python 主计算（轻量模式）：`<= 4.0s`
  - Writer（短模板）：`<= 1.5s`
  - 预算余量：`0.5s`
- 输出策略：
  - 先返回“结构化结论 + 置信度 + 风险提示”。
  - 深度内容异步补全（同一 `trace_id` 追发）。

### 2.5 V1 分阶段实施建议
- 第 1 阶段（1-2 天）：P0 级止损（P1 单簇、P2 markdown）。
- 第 2 阶段（2-4 天）：P3 慢点治理（planner/vector/writer）。
- 第 3 阶段（2-3 天）：P4 启动与可观测强化（readiness + 白名单日志）。
- 第 4 阶段（并行）：快速通道灰度（10% -> 30% -> 60% -> 100%）。

---

## 3. V2 架构设计（现代化 Spatial Agent + WebGIS）

### 3.1 核心设计原则
- Chain 解决确定性问题：
  - 用户意图拆解
  - 空间 DSL 编排
  - 参数约束与安全校验
  - 结构化输出合同
- Agent 解决不确定性问题：
  - 在工具集合中进行策略决策
  - 动态调参（LOD、范围、采样、预算）
  - 调用真实 GIS/仿真/几何工具获得可验证结果
- LLM 不直接接触数据库：
  - LLM 只消费结构化摘要，不直接执行 SQL/几何计算。
- 结果可解释：
  - 输出附带图结构/证据链/算子执行轨迹。
- 自检可纠错：
  - 执行后自动做 contract 校验、风险评估、必要时重试或降级。
- 独立性硬约束：
  - V2 不复用 V1 代码，不引用 V1 内部模块，不共享运行时进程。
- 编排自主可控：
  - 不把核心执行链路绑定在 Dify/LangChain 运行时上。

### 3.2 Chain / Agent 边界（职责清单）
| 维度 | Chain（确定性） | Agent（不确定性） | 禁止事项 |
|---|---|---|---|
| 输入 | 用户自然语言、会话上下文、视图参数 | Chain 产出的 Plan Graph、预算、工具白名单 | Agent 不得绕过 Chain 直接改写用户意图 |
| 核心职责 | 意图拆解、DSL 生成、约束校验、计划图编排 | 工具选择、参数探索、执行顺序优化、重试/降级 | Chain 不得直接执行 GIS 算子 |
| 数据访问 | 仅访问结构化摘要与契约元数据 | 通过 Tool Protocol 获取工具结果 | LLM/Chain/Agent 均不直接执行 SQL |
| 输出 | 标准化 Plan Graph + 执行边界 + 预算 | 工具执行结果、证据、置信度、不确定性 | Agent 不输出未验证结论 |
| 可解释性 | 给出“为什么这样规划” | 给出“为什么这样选工具/参数” | 不允许黑盒无证据结论 |
| 失败处理 | 校验失败即拒绝执行或降级计划 | 超时/失败按策略重试，超阈值转降级结果 | 禁止无限重试、禁止无上限递归调用 |

### 3.3 Tool Registry 接口契约设计

#### 3.3.1 Tool Descriptor（注册元数据）
```json
{
  "tool_id": "geometry.alpha_shape",
  "version": "1.0.0",
  "capability": ["boundary_reconstruct", "polygon_refine"],
  "input_schema_ref": "schema://tools/geometry.alpha_shape/input/v1",
  "output_schema_ref": "schema://tools/geometry.alpha_shape/output/v1",
  "timeout_ms_default": 2500,
  "timeout_ms_max": 8000,
  "idempotent": true,
  "side_effect": "none",
  "retry_policy": "safe_retry_once",
  "owner": "tool-plane-py",
  "sla_tier": "T2"
}
```

#### 3.3.2 Invoke Request / Response
```json
{
  "trace_id": "uuid",
  "lane": "fast|deep",
  "plan_step_id": "step-03",
  "tool_id": "geometry.alpha_shape",
  "tool_version": "1.0.0",
  "idempotency_key": "trace-step-hash",
  "budget_ms": 2200,
  "deadline_epoch_ms": 1772689999999,
  "input": {},
  "dry_run": false
}
```

```json
{
  "status": "success|partial|failed|timeout|budget_exceeded|validation_failed",
  "output": {},
  "diagnostics": {
    "duration_ms": 1380,
    "retry_count": 0,
    "uncertainty": 0.18,
    "quality_score": 0.92
  },
  "evidence": {
    "data_sources": ["postgis.layer.poi"],
    "geometry_refs": ["geom://trace/step-03/out-1"]
  },
  "error": null
}
```

#### 3.3.3 Registry API（最小集合）
- `registerTool(descriptor)`：注册工具及版本。
- `listTools(filter)`：按 capability、SLA、side_effect、version 查询。
- `getTool(tool_id, version)`：获取精确契约。
- `invokeTool(request)`：执行工具调用。
- `healthCheck(tool_id)`：可用性探测。
- `deprecateTool(tool_id, version)`：版本下线管理。

#### 3.3.4 标准错误码
- `TOOL_NOT_FOUND`
- `TOOL_VERSION_UNSUPPORTED`
- `INPUT_SCHEMA_INVALID`
- `TOOL_TIMEOUT`
- `TOOL_BUDGET_EXCEEDED`
- `TOOL_DEP_UNAVAILABLE`
- `OUTPUT_CONTRACT_VIOLATION`
- `NON_IDEMPOTENT_RETRY_BLOCKED`

#### 3.3.5 新增 GIS 工具接入最小文件集（预留接口）
- 每新增一个工具，必须同时提交以下文件（避免“只加 handler 不加契约”）：
  - `tool.yaml`：工具元数据（`tool_id/version/capability/sla/retry_policy`）。
  - `schemas/input.v1.json`：输入契约。
  - `schemas/output.v1.json`：输出契约。
  - `handler.py`：工具执行入口（仅处理业务逻辑，不做协议层拼装）。
  - `adapter.py`：Tool Protocol 适配层（请求反序列化、响应规范化、错误码映射）。
  - `tests/`：最少包含 `contract`、`happy_path`、`timeout` 三类测试。
- Registry 发布顺序：
  - 先注册 Descriptor 与 Schema。
  - 再开放 `invokeTool`。
  - 最后将 capability 加入 Agent 可选白名单。

#### 3.3.6 能力域级联命名规范（便于扩展更多 GIS 工具）
- 目录命名采用三级级联：`<domain>/<subdomain>/<tool-name>`。
- 推荐 domain：
  - `boundary`（边界重建、模糊边界、多边形修复）
  - `network`（路径规划、可达域、流量传播）
  - `raster`（栅格分析、热力、指数计算）
  - `vector`（空间连接、缓冲区、叠置分析）
  - `vision`（OCR、遥感分割、目标提取）
  - `simulation`（情景推演、参数扫描、蒙特卡洛）
- 示例：`boundary/fuzzy-boundary/alpha-shape-v1`、`network/routing/shortest-path-v2`

### 3.4 双通道状态机（Fast 返回后 Deep 补全）

#### 3.4.1 状态定义
- `S0_RECEIVED`：请求进入系统。
- `S1_CHAIN_PLANNED`：Chain 完成 DSL/Plan Graph。
- `S2_FAST_RUNNING`：Fast Lane 执行中。
- `S3_FAST_DONE`：Fast Lane 已返回首轮可行动结果。
- `S4_DEEP_QUEUED`：Deep Lane 任务入队。
- `S5_DEEP_RUNNING`：Deep Lane 执行中。
- `S6_DEEP_PARTIAL`：Deep Lane 输出阶段性补丁。
- `S7_DEEP_DONE`：Deep Lane 完整补全完成。
- `S8_TERMINAL_DEGRADED`：超时/失败后的最终降级状态。

#### 3.4.2 关键状态流转
- `S0 -> S1 -> S2 -> S3`：快速闭环。
- `S3 -> S4 -> S5 -> (S6)* -> S7`：异步补全过程。
- `S2/S5 -> S8`：硬超时或不可恢复错误。
- `S8` 必须输出：已完成内容 + 风险标识 + 建议动作。

#### 3.4.3 前端事件协议（同一 trace_id）
- `fast.result`：Fast Lane 首轮结果。
- `deep.accepted`：Deep 任务已接管。
- `deep.progress`：阶段进度（0-100）。
- `deep.patch`：可合并补丁（按 `result_version` 递增）。
- `deep.final`：Deep 最终结果。
- `deep.failed`：Deep 失败与降级说明。

#### 3.4.4 防死循环与预算保护
- 每个 `plan_step` 最多 `2` 次重试。
- 单请求 Deep Lane 最大累计执行时长按 DL 等级硬截止。
- 若出现“同参数重复失败”则直接熔断，不再重试。
- Plan Graph 必须做环检测，检测到环路直接拒绝执行并回传诊断。

### 3.5 V2 双通道执行模型与时间预算
- Fast Lane（10 秒通道）：
  - 目标：在 `<=10s` 返回“可行动最小闭环结果”（摘要 + 证据 + 风险 + 下一步）。
  - 阶段预算：
    - Intent + DSL + Policy：`<=1.2s`
    - Retrieval + Context Build：`<=2.0s`
    - Agent Lite Tool 执行：`<=4.8s`
    - Contract + Narrator：`<=1.5s`
    - 系统余量：`0.5s`
  - 超时策略：硬截止 `10s`，超时即返回降级结果并自动转 Deep Lane。
- Deep Lane（深度通道）：
  - 目标：补全复杂分析，不阻塞 Fast Lane 首轮结果。
  - 分级预算：

| Deep 等级 | 典型场景 | 目标时长 | 硬超时 | 失败降级 |
|---|---|---:|---:|---|
| DL1 | 单区域高精度重算、1-2 次参数重试 | `<=15s` | `20s` | 回传部分结果 + 不确定性标记 |
| DL2 | 多区域对比、跨图层融合、3-4 工具串联 | `<=30s` | `40s` | 自动降维（减少工具链），输出可解释中间结果 |
| DL3 | 仿真推演/历史回放/大范围复杂任务 | `<=60s` | `90s` | 拆分子任务异步续跑，前端显示“进行中 + 已完成分片” |

- 结论：10 秒可实现，但目标是 Fast Lane；Deep Lane 承诺的是可观测、可中断、可降级。

### 3.6 语言与框架职责（V2 建议）
- TypeScript（控制平面主语言）：
  - 负责 API Gateway、Chain Engine、Agent Runtime、Narrator、策略内核、契约管理、观测埋点。
  - 推荐框架：`Fastify`（高吞吐、SSE/WS 友好、插件生态适中）。
- Python（工具平面主语言）：
  - 负责空间算子、几何算法、GIS/仿真工具、重计算任务。
  - 推荐框架：`FastAPI + gRPC(aio)` 组合（HTTP 易调试，gRPC 高效互调）。
- 数据层：
  - `PostgreSQL + PostGIS + pgvector`，并用 Redis 做短期状态和队列加速。
- 是否引入 Java：
  - 现阶段不建议作为 V2 首选主后端。原因是会引入第三套核心语言，提升组织复杂度与交付成本。
  - 若后续出现强企业治理诉求（统一 JVM 平台、强事务中台），可在独立服务边界再评估。

### 3.7 AI 工作流策略（不引入 Dify/LangChain 依赖）
- 生产核心链路不依赖 Dify/LangChain 运行时。
- 采用自研轻量编排内核：
  - Plan Graph Executor
  - Tool Protocol Runtime
  - Budget/Retry Supervisor
  - Contract Validator
- 可选边界：
  - 允许在离线实验环境接入第三方框架做 prompt A/B 或对比评测；
  - 但不得进入生产请求关键路径。

### 3.8 V2 质量与性能目标（建议）
- 首 token：`<= 1.5s`
- Fast Lane 完成：`P95 <= 10s`
- Deep Lane：按 DL1/DL2/DL3 分级目标执行（见 3.5）
- 结果契约通过率：`>= 99%`
- 关键场景 `top-50 recall` 下降：`<= 3%`

### 3.9 V2 运行日志与落盘策略（中文优先）
- 目标：
  - 具备和 V1 一样的运行期可观测能力（启动、链路、错误、降级、工具调用）。
  - 日志可检索、可回放、可归档。
  - 文案采用“中文优先，可英可中”。

#### 3.9.1 日志输出层次
- 控制台实时日志（开发/联调）：便于即时排错。
- 结构化运行日志（NDJSON）：用于检索、聚合、告警。
- 诊断快照日志（Trace Snapshot）：用于复杂请求回放。
- 审计日志（Audit）：记录关键配置变更与人工操作。

#### 3.9.2 日志字段规范（中文优先）
- 必选字段：
  - `ts`、`level`、`service`、`event`、`trace_id`、`msg`
- 推荐字段：
  - `msg_en`（可选英文）、`lane`、`duration_ms`、`error_code`、`tool_id`、`budget_ms`、`retry_count`
- 文案策略：
  - `msg` 固定中文。
  - `msg_en` 可选，仅用于跨团队或外部系统对接。

日志样例：
```json
{
  "ts": "2026-03-05T14:32:10.221+08:00",
  "level": "info",
  "service": "agent-runtime",
  "event": "fast_lane.completed",
  "trace_id": "a2f1-...",
  "lane": "fast",
  "duration_ms": 8420,
  "msg": "Fast通道已完成，返回首轮可行动结论",
  "msg_en": "Fast lane completed with actionable first response"
}
```

#### 3.9.3 落盘与保留策略
- 本地落盘（按天分片）：
  - `observability/logs/runtime/YYYY-MM-DD/*.ndjson`
  - `observability/logs/diagnostics/YYYY-MM-DD/*.ndjson`
  - `observability/logs/audit/YYYY-MM-DD/*.ndjson`
- 保留建议：
  - `runtime`：本地 7 天，归档 30 天。
  - `diagnostics`：本地 14 天，归档 90 天。
  - `audit`：本地 30 天，归档 180 天。
- 压缩与清理：
  - 日切 + `gzip` 压缩。
  - 定时清理过期文件，清理动作写入审计日志。

#### 3.9.4 关键事件白名单（首批）
- 启动与健康：`startup.begin`、`startup.ready`、`grpc.readiness.timeout`
- 双通道：`fast_lane.started`、`fast_lane.completed`、`deep_lane.accepted`、`deep_lane.finalized`
- 工具链：`tool.invoke`、`tool.timeout`、`tool.contract_violation`
- 降级与熔断：`budget.exceeded`、`retry.exhausted`、`request.degraded`
- 输出契约：`markdown.normalized`、`result.contract.failed`

#### 3.9.5 语言模式开关（建议）
- `LOG_LANGUAGE_MODE=zh|bilingual`
  - `zh`：仅输出中文 `msg`
  - `bilingual`：输出 `msg` + `msg_en`
- 默认值：`zh`

### 3.10 JSON 诊断埋点规范（机器优先，给 AI 助手用）
- 目标：
  - 在 bug、缺陷、慢请求、性能退化时，AI 助手可在 1 次检索中快速定位“发生在哪一层、哪一步、哪种错误模式”。
  - `md` 给人阅读，`json` 给机器诊断，二者分层设计。

#### 3.10.1 统一日志信封（Envelope）
- 每条 JSON 日志必须包含：
  - `schema_version`：如 `log.v2.1`
  - `ts`、`level`、`service`、`module`、`event`
  - `trace_id`、`span_id`、`parent_span_id`
  - `request_id`、`session_id`、`conversation_id`、`run_id`
  - `lane`（`fast|deep`）、`plan_step_id`、`phase`
  - `msg`（中文必填）、`msg_en`（可选）
  - `env`、`region`、`host`、`pid`、`build_sha`

#### 3.10.2 分层诊断字段（尽可能全埋点）
- 请求层：
  - `query_type`、`input_chars`、`input_tokens_est`、`viewport.zoom`、`viewport.area_km2`
  - `request_priority`、`user_tier`、`is_retry_request`
- Chain 层：
  - `intent_parse_ms`、`dsl_build_ms`、`policy_check_ms`、`plan_graph_nodes`
  - `plan_graph_edges`、`plan_graph_cycle_detected`、`plan_complexity_score`
- Retrieval 层：
  - `retrieval.top_k_requested`、`retrieval.top_k_effective`
  - `retrieval.index_ms`、`retrieval.filter_ms`、`retrieval.rerank_ms`
  - `retrieval.candidate_count`、`retrieval.hit_count`、`retrieval.cache_hit`
  - `retrieval.score_p50`、`retrieval.score_p95`
- Tool 层：
  - `tool_id`、`tool_version`、`tool_capability`、`tool_input_hash`
  - `tool_budget_ms`、`tool_timeout_ms`、`tool_duration_ms`
  - `tool_retry_count`、`tool_idempotent`、`tool_side_effect`
  - `tool_output_size`、`tool_geometry_count`、`tool_uncertainty`
- Python/GIS 层：
  - `py_op`、`py_kernel`、`py_cpu_ms`、`py_io_wait_ms`、`py_mem_mb`
  - `cluster_count`、`single_cluster_fallback_applied`
  - `undersegmentation_risk`、`undersegmentation_reason`
- Writer/输出层：
  - `writer_tokens_in`、`writer_tokens_out`、`writer_duration_ms`
  - `markdown_contract_checked`、`markdown_contract_normalized`
  - `output_contract_passed`、`output_version`
- 队列/并发层：
  - `queue_mode`、`queue_wait_ms`、`queue_depth`、`worker_id`
  - `worker_concurrency`、`dequeue_attempt`
- 数据库层：
  - `db_engine`、`db_query_id`、`db_duration_ms`
  - `db_rows_returned`、`db_rows_scanned`、`db_index_used`
- 可靠性层：
  - `fallback_applied`、`fallback_reason`
  - `circuit_state`、`degraded`、`degrade_reason`
  - `retry_exhausted`、`budget_exceeded`

#### 3.10.3 错误日志强制字段（报错必带）
- `error_code`（稳定错误码）
- `error_stage`（`chain|retrieval|tool|writer|queue|db|io|network`）
- `error_class`（异常类型）
- `error_msg`（中文）
- `error_msg_en`（可选）
- `stack`（截断后的堆栈）
- `cause_chain`（上游触发链）
- `suspected_component`
- `suggested_fix_hint`
- `root_cause_confidence`（`0~1`）
- `is_user_visible`

#### 3.10.4 性能分析必备字段（慢请求定位）
- `e2e_duration_ms`
- `ttfb_ms`
- `stage_ms`（对象，逐阶段耗时）
- `critical_path`（数组，最大耗时路径）
- `slowest_stage`
- `slow_reason_tags`（如 `topk_too_high`、`planner_fallback_double_call`、`grpc_cold_start`）
- `perf_regression_vs_baseline_pct`

#### 3.10.5 双通道专有字段（Fast/Deep 联合诊断）
- `fast_result_version`
- `deep_job_id`
- `deep_state`（`queued|running|partial|done|failed|degraded`）
- `deep_progress_pct`
- `deep_patch_count`
- `handoff_latency_ms`（Fast->Deep 交接延迟）
- `deep_total_budget_ms`

#### 3.10.6 事件粒度建议（最小可定位集）
- 启动类：
  - `startup.begin`、`startup.config_loaded`、`startup.ready`
- 请求类：
  - `request.received`、`request.validated`、`request.completed`
- Chain 类：
  - `chain.intent.started`、`chain.intent.done`
  - `chain.dsl.started`、`chain.dsl.done`
  - `chain.policy.done`
- Retrieval 类：
  - `retrieval.started`、`retrieval.done`
- Tool 类：
  - `tool.invoke.started`、`tool.invoke.done`、`tool.invoke.failed`
- Writer 类：
  - `writer.started`、`writer.normalized`、`writer.done`
- 双通道类：
  - `fast_lane.completed`、`deep_lane.accepted`、`deep_lane.patch`、`deep_lane.finalized`
- 失败与降级类：
  - `budget.exceeded`、`retry.exhausted`、`request.degraded`、`request.failed`

#### 3.10.7 采样与保留策略（防止日志爆炸）
- 错误日志、超时日志、降级日志：`100%` 保留。
- 慢请求日志（超过阈值）：`100%` 保留。
- 正常成功日志：按 `10%-30%` 动态采样（可配置）。
- 关键业务类型（`area_analysis`）在灰度期建议 `100%` 保留。

#### 3.10.8 面向 AI 助手的“诊断快照”文件
- 每个异常 trace 自动生成 `incident bundle`（JSON）：
  - 请求摘要
  - 全阶段耗时分解
  - 错误链与降级链
  - 相关 tool 输入输出摘要（脱敏后）
  - 建议优先排查清单
- 建议路径：
  - `observability/incidents/open/YYYY-MM-DD/<trace_id>.json`
  - 修复后归档至 `observability/incidents/closed/`

#### 3.10.9 日志 Schema 版本管理
- 日志契约必须版本化：
  - `log.v2.1`（当前）
  - 新增字段只增不删；删除字段需经历 `deprecated -> removed` 两阶段。
- 每次 schema 变更必须更新：
  - `observability/schemas/log-events/`
  - `observability/schemas/incident-bundle/`

---

## 4. V2 目录工程化设计（`V2-Agent-backend`）

> 以下为建议目录蓝图，当前阶段为设计，不要求立即编码。

```text
V2-Agent-backend/
  control-plane-ts/
    apps/
      api-gateway/
      chain-engine/
      agent-runtime/
      narrator/
      ops-console/
    packages/
      contracts/
      dsl-schema/
      tool-protocol/
      tool-registry-sdk/
      tool-catalog/
      lane-state-machine/
      policy-kernel/
      telemetry/
      eval-kit/
      common/
  tool-plane-py/
    tools/
      boundary/
        fuzzy-boundary/
          alpha-shape-v1/
            tool.yaml
            schemas/
              input.v1.json
              output.v1.json
            handler.py
            adapter.py
            tests/
      network/
      raster/
      vector/
      vision/
      simulation/
      templates/
        gis-tool-template/
    services/
      tool-registry-adapter/
      spatial-ops-service/
      geometry-toolkit/
      raster-vector-adapters/
      simulation-service/
    libs/
      op-contracts/
      op-kernels/
      uncertainty/
  data-plane/
    sql/
    migrations/
    materialized-views/
    seed/
  observability/
    logs/
      runtime/
      diagnostics/
      audit/
    schemas/
      log-events/
      incident-bundle/
    incidents/
      open/
      closed/
    replay-index/
    dashboards/
  platform/
    docker/
    k8s/
    terraform/
  scripts/
    bootstrap/
    dev/
    benchmark/
    replay/
    diagnostics/
    dataset/
  tests/
    unit/
    integration/
    e2e/
    load/
    chaos/
  docs/
    adr/
    runbooks/
    api/
    architecture/
```

### 4.1 各目录作用说明
- `control-plane-ts/apps/api-gateway`：统一 API 入口、鉴权、SSE/WS 出口、流量治理。
- `control-plane-ts/apps/chain-engine`：意图解析、DSL 生成、语义/策略校验、计划图输出。
- `control-plane-ts/apps/agent-runtime`：Agent 决策循环、双通道编排、状态机驱动、执行监督。
- `control-plane-ts/apps/narrator`：结构化结果到自然语言表达，不直接触碰底层数据。
- `control-plane-ts/apps/ops-console`：运维面板接口（指标、回放、灰度、告警）。

- `control-plane-ts/packages/contracts`：统一请求/响应契约（TS types + JSON schema）。
- `control-plane-ts/packages/dsl-schema`：DSL 版本管理、schema、校验器。
- `control-plane-ts/packages/tool-protocol`：工具调用协议、错误码、结果标准结构。
- `control-plane-ts/packages/tool-registry-sdk`：注册、发现、调用、健康检查 SDK。
- `control-plane-ts/packages/tool-catalog`：工具目录快照、capability 白名单、版本选择策略。
- `control-plane-ts/packages/lane-state-machine`：Fast/Deep 状态机模型与转移守卫。
- `control-plane-ts/packages/policy-kernel`：预算、重试、降级、路由策略内核。
- `control-plane-ts/packages/telemetry`：trace/log/metrics 埋点 SDK。
- `control-plane-ts/packages/eval-kit`：回放集、评测器、质量门禁。
- `control-plane-ts/packages/common`：通用工具、常量、错误处理基类。

- `tool-plane-py/tools/*`：GIS 工具级联目录（domain/subdomain/tool），新增工具统一从模板衍生。
  - `tool.yaml`：工具元数据。
  - `schemas/*.json`：输入输出契约。
  - `handler.py`：业务逻辑。
  - `adapter.py`：协议适配与错误码映射。
  - `tests/`：工具级契约与行为测试。
- `tool-plane-py/services/tool-registry-adapter`：将 Python 工具按统一契约接入 Registry。
- `tool-plane-py/services/spatial-ops-service`：统一暴露空间算子服务（gRPC/HTTP）。
- `tool-plane-py/services/geometry-toolkit`：凸包、alpha-shape、网格切分、边界修复等几何算子。
- `tool-plane-py/services/raster-vector-adapters`：栅格/矢量转换与图层适配。
- `tool-plane-py/services/simulation-service`：情景仿真与参数扫描。
- `tool-plane-py/libs/op-contracts`：Python 工具输入输出契约与校验。
- `tool-plane-py/libs/op-kernels`：可复用算子内核库。
- `tool-plane-py/libs/uncertainty`：不确定性评估、置信度计算、风险标注。

- `data-plane/*`：SQL、迁移、物化视图、种子数据，数据模型独立演进。
- `observability/logs/*`：运行日志、诊断日志、审计日志统一落盘目录。
- `observability/schemas/log-events`：运行日志 JSON Schema（机器校验）。
- `observability/schemas/incident-bundle`：异常诊断快照 JSON Schema。
- `observability/incidents/open|closed`：AI 助手排障用异常快照仓。
- `observability/replay-index`：回放索引（trace_id -> 日志切片/结果版本）。
- `observability/dashboards`：日志检索与告警看板配置。
- `platform/*`：部署与基础设施定义（容器、K8s、IaC）。
- `scripts/bootstrap`：V2 独立初始化脚本（不是 V1->V2 迁移脚本）。
- `scripts/dev`：本地启动、联调辅助。
- `scripts/benchmark`：性能压测与预算回归。
- `scripts/replay`：日志回放、故障复现。
- `scripts/diagnostics`：自动生成 incident bundle、慢点剖析报告、错误聚类报告。
- `scripts/dataset`：固定评测集管理与版本化。
- `tests/*`：单测、集成、端到端、压测、混沌实验。
- `docs/*`：ADR、运维手册、接口文档、架构设计。

---

## 5. 双轨独立维护策略（非迁移）
- 策略定位：
  - V1 与 V2 长期并行维护，不做“以 V2 替代 V1”的阶段性切流计划。
  - 两套方案各自承担不同目标：V1 重稳态业务、V2 重新范式验证与增量能力。
- 工程边界：
  - 代码边界：禁止跨目录直接依赖（V2 不 import V1 代码）。
  - 运行边界：独立进程与配置，独立 CI/CD，独立回滚。
  - 观测边界：各自 SLI/SLO 看板独立；仅在评测层做统一对比。
- 统一标准（仅标准，不共享实现）：
  - 输出契约标准（字段语义一致，版本独立）。
  - 性能评测标准（同一回放集 + 同一指标口径）。
  - 质量门禁标准（召回、契约通过率、超时率）。

## 6. 风险与控制
- 风险：双轨维护成本上升、指标口径偏移、数据口径漂移、V2 过度工程化。
- 控制：
  - 每个重大技术选择先写 ADR（尤其是时间预算、栈选型、工具协议）。
  - 所有性能结论必须基于固定回放集与可复现实验。
  - Fast/Deep Lane 均必须有硬超时、降级与防死循环策略。
  - 维持“最小可运行核心”，先跑通闭环再逐步扩展工具。

## 7. 立即可执行项
1. 按 Phase F 继续推进 V1 四个关键问题修复与回归（保持现架构思路）。
2. 在 V2 文档层先固化 3 个 ADR：`时间预算策略`、`TS/Python 职责划分`、`无 Dify/LangChain 依赖策略`。
3. 在 `V2-Agent-backend` 下先搭空目录与契约文档骨架，并预建 `tool-plane-py/tools/templates/gis-tool-template` 接口模板（仍不进入业务实现编码）。
4. 先定义并冻结首版 `log.v2.1` 与 `incident-bundle.v1` JSON Schema，确保后续每个模块都按同一诊断契约埋点。
5. 执行 V2 时统一以独立规格书为准：`docs/plans/2026-03-05-v2-agent-architecture-and-execution-plan.md`（零上下文可执行版）。

## 8. V2 分阶段执行计划（AI-native）
### 8.1 执行原则（区别于人类周排期）
- 以“机器门禁”推进，不以自然周推进。
- 所有阶段默认并行，只有存在硬依赖时才串行。
- 每阶段必须满足可机检退出条件（SLO/Schema/回放/错误率）。
- 任一门禁失败立即触发：
  - 自动生成 `incident bundle`
  - 回退到上一个稳定版本
  - 进入修复再验证循环

### 8.2 并行轨道（全程并行）
- Track A：契约与协议（`contracts/dsl-schema/tool-protocol`）
- Track B：运行时（`api-gateway/chain-engine/agent-runtime/narrator`）
- Track C：观测与诊断（`log.v2.1/incident-bundle/diagnostics`）
- Track D：工具生态（`tools/<domain>/<subdomain>/<tool>` 模板化接入）

### 8.3 阶段节奏（小时级）
### Phase P0（T+0h ~ T+4h）：契约冻结与可观测底座
- 目标：先让系统“可测、可诊断、可回放”。
- 关键动作：
  - 冻结 `log.v2.1`、`incident-bundle.v1`、`tool-protocol.v1`。
  - 建立最小事件流：`request.received -> fast_lane.completed -> request.completed`。
  - 建立 schema 校验闸门（不合法日志直接失败）。
- 退出门禁：
  - Schema 校验通过率 `100%`
  - 错误日志强制字段缺失率 `0%`

### Phase P1（T+4h ~ T+16h）：Fast Lane 最小闭环
- 目标：先把“10s 可行动结果”跑通。
- 关键动作：
  - 打通 `request -> chain -> retrieval -> 1个GIS工具 -> narrator`。
  - 启用 Fast Lane 10s 硬超时与降级结果。
  - 输出阶段耗时 `stage_ms` 与 `critical_path`。
- 退出门禁：
  - 回放集 Fast Lane `P95 <= 10s`
  - 降级可用率 `100%`（超时时也有可行动响应）

### Phase P2（T+16h ~ T+30h）：Deep Lane 与状态机闭环
- 目标：Fast 返回后 Deep 稳定补全，不覆盖错乱。
- 关键动作：
  - 实装状态机：`S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S6/S7/S8`。
  - 实装事件协议：`deep.accepted/progress/patch/final/failed`。
  - 实装反死循环：步骤重试上限、参数重复失败熔断、环检测。
- 退出门禁：
  - Fast/Deep 结果版本冲突率 `< 0.1%`
  - 死循环触发率 `0`（由状态机与重试策略保障）

### Phase P3（T+30h ~ T+48h）：多工具扩展与自动诊断
- 目标：验证“新增工具不会拖垮系统”。
- 关键动作：
  - 新增 `network/raster/vector` 各 1 个工具样例。
  - 工具统一走 `tool.yaml + schemas + adapter + tests`。
  - `scripts/diagnostics` 自动生成慢点报告与错误聚类报告。
- 退出门禁：
  - 新工具接入一次通过率 `>= 95%`
  - Top 10 错误模式可自动聚类并给出 `suggested_fix_hint`

### Phase P4（T+48h 以后）：持续优化循环（6h/轮）
- 目标：把性能与稳定性做成持续系统能力，而非一次性项目。
- 每轮固定流程：
  - 回放基准 -> 指标对比 -> 根因聚类 -> 参数/策略优化 -> 再回放
- 每轮硬指标：
  - `perf_regression_vs_baseline_pct <= 0`
  - 新增 `P0/P1` 级错误 `= 0`
  - 关键 query 类型成功率与契约通过率不下降
