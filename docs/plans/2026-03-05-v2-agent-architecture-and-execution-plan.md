# 2026-03-05 V2 空间智能体 + WebGIS 实施规格书（零上下文可执行版）

## 开篇导向（创建意图与预期结果）
- 创建意图：构建一套与 V1 完全独立、AI-native 的 Spatial Agent + WebGIS 架构，用“确定性 Chain + 不确定性 Agent + 真实 GIS 工具执行”替代臃肿慢链路与黑盒式文本推理。
- 最终预期结果：交付一个可持续迭代的 V2 工程体系，满足 Fast Lane `P95 <= 10s`、Deep Lane 可补全、全链路可解释、可观测、可回放、可自动诊断，并能支撑科研论文的可复现与可验证要求。
- 方向硬约束（最终意见）：
  - V2 禁止沿用 V1 的“默认调用模糊边界工具”逻辑；仅当 DSL 明确命中相关能力时才允许调用。
  - V2 采用纯 GIS Agent 思路：按用户意图动态选择工具链，而不是固定单工具管线。
  - LLM 只负责“意图理解 + DSL 翻译 + 结果叙述”，不直接做空间计算，不直连数据库。
  - Agent 必须把用户表达映射到预设 DSL，并触发可解释算子序列，支持同义表达归一化。
  - 首批基础工具样例固定纳入：`clip`（裁剪）、`buffer`（缓冲区）、`merge`（合并）。
  - 工具执行引擎按规则择优：简单集合操作优先 PostGIS SQL，复杂几何/大规模处理优先 Python。
  - 空间计算必须统一 CRS/单位策略（内部米制计算，输出统一 GeoJSON/EPSG:4326），避免尺度错误。
  - “当前区域”语义需有解析优先级：用户显式 AOI > 当前地图视窗 > 命名区域。
  - 输出不只包含结果文件，还必须包含处理谱系（输入图层、算子链、参数、耗时、版本）。
  - 几何质量门禁必须开启：`is_valid`、自交检查、空几何检查、修复策略。
  - 失败时必须降级返回可用中间成果，不允许只返回笼统错误。
  - 诊断体系必须机器优先：JSON 日志 + incident bundle 可让 AI 快速定位 bug、慢点、性能退化根因。
  - 论文导向要求：固定样本、固定参数、固定随机种子、可回放复现实验。
- 标准示例链路（必须可跑通）：
  - 用户意图示例：“当前区域所有 POI 的 50m 圆形缓冲区面，合并后导出 GeoJSON”。
  - 意图切片：`当前区域`、`POI`、`50m`、`buffer`、`merge`、`geojson`。
  - DSL 映射：`clip(poi, aoi)` -> `buffer(result, 50m)` -> `merge(result)` -> `export_geojson(result)`。
  - 响应要求：返回结果文件 + 结构化处理摘要 + 自然语言说明。
- 防偏航判定：任何设计/实现若削弱“10 秒可行动结果、工具真实执行、机器可诊断、V1/V2独立”四个核心目标之一，视为偏离方向，必须回退并重设方案。

## 0. 使用说明（给未来 AI 会话）
### 0.1 文档定位
- 本文是 V2 的单一事实来源（Single Source of Truth）。
- 用途：在没有历史上下文的全新会话中，直接指导 AI 连续执行 V2 架构建设。
- 要求：执行时不得依赖 V1 代码或运行时，不得引入 Dify/LangChain 作为生产核心编排。

### 0.2 零上下文启动指令（建议直接粘贴给新 AI）
```text
你现在负责执行《2026-03-05 V2 空间智能体 + WebGIS 实施规格书（零上下文可执行版）》。
必须遵守：
1) V2 与 V1 完全独立；
2) Fast Lane P95 <= 10s；
3) LLM 不直连数据库；
4) 生产路径不依赖 Dify/LangChain；
5) 严格按日志与契约门禁执行。
先输出你理解的阶段目标，再按 P0->P4 执行，每阶段必须给出可验证产物与门禁结果。
```

### 0.3 输入材料清单（执行前必须具备）
- 本文档。
- `docs/plans/2026-03-05-phase-f-followup-4-issues-remediation-plan.md`（用于 V1 问题背景对照）。
- 当前仓库代码树（仅用于 V2 新建，不复用 V1 业务代码）。

### 0.4 本轮评审结论落地（仅写入计划，不立即开发）
- 本文已纳入 5 个高优先修订项（P0）：
  - DSL 正式规范补齐（语法、schema、版本）。
  - Fast Lane 门禁分级（10s 目标不变，先达可落地门槛再收敛）。
  - 缓存策略补齐（结果缓存 + 中间缓存 + 失效规则）。
  - 状态机补齐（`S6_DEEP_PARTIAL` 行为、状态持久化、超时恢复）。
  - 资源限制量化（CPU/内存/超时阈值与超限动作）。
- 前端交互需求已写入计划：在“空间选区”控件左侧新增“架构选择”入口（`V1架构` / `V2 Agent架构`）用于 A/B 对比切换；当前阶段仅作为实施条目，不执行代码开发。

---

## 1. 目标与非目标
### 1.1 目标
- 构建现代化 Spatial Agent + WebGIS V2 架构。
- 满足双通道：
  - Fast Lane：10 秒内给到可行动首轮结论。
  - Deep Lane：异步补全复杂分析，可解释、可降级、可中断。
- 构建“机器优先”诊断体系：JSON 日志可让 AI 快速定位 bug、慢点、缺陷根因。

### 1.2 非目标
- 不做 V1 到 V2 的迁移切流方案。
- 不在本阶段重写全部 UI。
- 不追求一次性覆盖所有 GIS 工具，先确保模板化可扩展。

---

## 2. 硬约束（必须遵守）
- V2 不复用 V1 代码块，不依赖 V1 运行时。
- LLM 仅做意图理解与叙述，不直接执行 SQL/GIS 算子。
- 生产核心链路不依赖 Dify/LangChain runtime。
- Fast Lane `P95 <= 10s` 为强门禁。
- 所有关键模块必须输出结构化 JSON 日志并通过 schema 校验。
- 所有阶段必须设置硬超时、降级策略、防死循环机制。

---

## 3. V2 目标架构（总览）
## 3.1 五平面架构
- 交互平面：WebGIS + SSE/WS。
- 控制平面（TS）：Intent/DSL/Policy/Plan Graph。
- 执行平面（TS）：Agent Runtime、调度、预算、状态机。
- 工具平面（Py）：GIS/几何/仿真算子。
- 观测平面：日志、指标、回放、诊断快照。

## 3.2 关键组件
- `api-gateway`：统一入口、鉴权、流控、SSE 事件输出。
- `chain-engine`：意图拆解、DSL 生成、约束校验。
- `agent-runtime`：工具选择、参数搜索、执行监督、双通道调度。
- `narrator`：结构化结果转自然语言。
- `tool-registry`：工具注册、发现、调用、健康检查。
- `spatial-ops-service`（Py）：真实空间算子执行。

## 3.3 语言与框架分工
- TypeScript：控制/执行平面（Fastify + Node runtime）。
- Python：工具平面（FastAPI + gRPC aio）。
- 数据：PostgreSQL + PostGIS + pgvector；Redis 用于状态/队列加速。
- Java：当前阶段不引入为主后端语言，避免三语言核心复杂度。

---

## 4. Chain / Agent 边界（技术细化）
## 4.1 职责边界
| 维度 | Chain（确定性） | Agent（不确定性） |
|---|---|---|
| 输入 | 用户请求、会话上下文、视图参数 | Plan Graph、预算、工具白名单 |
| 处理 | 意图拆解、DSL 构建、策略约束 | 工具选择、动态调参、执行编排 |
| 输出 | 标准 Plan Graph + 执行边界 | 工具结果 + 证据 + 置信度 |
| 失败 | 校验失败直接阻断或降级计划 | 超时/失败重试，超阈值降级 |

## 4.2 禁止事项
- Chain 禁止直接调用 GIS 算子。
- Agent 禁止绕开 Chain 改写用户意图。
- LLM/Chain/Agent 禁止直接 SQL 查询。

## 4.3 Chain 输出契约（示例）
```json
{
  "trace_id": "uuid",
  "intent": {"type": "area_analysis", "confidence": 0.93},
  "plan_graph": {
    "nodes": [{"id": "n1", "kind": "retrieval"}, {"id": "n2", "kind": "tool"}],
    "edges": [{"from": "n1", "to": "n2"}],
    "acyclic": true
  },
  "constraints": {"lane": "fast", "deadline_ms": 10000, "max_retries": 2}
}
```

## 4.4 DSL 正式规范（P0 补齐）
### 4.4.1 设计目标
- 让 LLM->Agent->Tool 的中间契约可校验、可版本化、可回放。
- 禁止自由文本直接驱动工具执行，必须先落地为 DSL AST。

### 4.4.2 DSL 抽象结构（v0）
```json
{
  "dsl_version": "dsl.v0.1",
  "intent_type": "area_analysis|overlay|network_analysis",
  "scope": {
    "aoi_source": "user_aoi|viewport|named_region",
    "crs": "EPSG:4326"
  },
  "pipeline": [
    {"op": "clip", "args": {"source": "poi", "mask": "aoi"}},
    {"op": "buffer", "args": {"distance": 50, "unit": "m"}},
    {"op": "merge", "args": {"dissolve": true}},
    {"op": "export_geojson", "args": {"filename": "poi_buffer_50m.geojson"}}
  ],
  "constraints": {"deadline_ms": 10000, "max_retries": 2}
}
```

### 4.4.3 轻量语法（便于人读）
- `clip(source=poi, mask=aoi) -> buffer(distance=50m) -> merge(dissolve=true) -> export(type=geojson)`
- 编译规则：语法串 -> AST(JSON) -> schema 校验 -> 执行计划。

### 4.4.4 版本策略
- `dsl.v0.x`：允许字段新增，不允许语义破坏。
- `dsl.v1.0`：冻结核心算子签名（`clip/buffer/merge/export`）。
- 兼容策略：执行层至少兼容当前主版本和前一小版本。

---

## 5. Tool Registry 与工具接入规范
## 5.1 Descriptor 契约
```json
{
  "tool_id": "boundary.fuzzy_boundary.alpha_shape",
  "version": "1.0.0",
  "capability": ["boundary_reconstruct"],
  "input_schema_ref": "schema://tools/boundary.alpha_shape/input/v1",
  "output_schema_ref": "schema://tools/boundary.alpha_shape/output/v1",
  "timeout_ms_default": 2500,
  "timeout_ms_max": 8000,
  "idempotent": true,
  "retry_policy": "safe_retry_once",
  "side_effect": "none",
  "owner": "tool-plane-py",
  "sla_tier": "T2"
}
```

## 5.2 Invoke 契约
### Request
```json
{
  "trace_id": "uuid",
  "lane": "fast",
  "plan_step_id": "step-03",
  "tool_id": "boundary.fuzzy_boundary.alpha_shape",
  "tool_version": "1.0.0",
  "idempotency_key": "trace-step-hash",
  "budget_ms": 2200,
  "deadline_epoch_ms": 1772689999999,
  "input": {}
}
```

### Response
```json
{
  "status": "success|partial|failed|timeout|budget_exceeded|validation_failed",
  "output": {},
  "diagnostics": {"duration_ms": 1380, "retry_count": 0, "uncertainty": 0.18},
  "evidence": {"data_sources": ["postgis.layer.poi"], "geometry_refs": ["geom://..."]},
  "error": null
}
```

## 5.3 标准错误码
- `TOOL_NOT_FOUND`
- `TOOL_VERSION_UNSUPPORTED`
- `INPUT_SCHEMA_INVALID`
- `TOOL_TIMEOUT`
- `TOOL_BUDGET_EXCEEDED`
- `TOOL_DEP_UNAVAILABLE`
- `OUTPUT_CONTRACT_VIOLATION`
- `NON_IDEMPOTENT_RETRY_BLOCKED`

## 5.4 新增 GIS 工具最小文件集（强制）
- `tool.yaml`
- `schemas/input.v1.json`
- `schemas/output.v1.json`
- `handler.py`
- `adapter.py`
- `tests/`（至少 contract/happy_path/timeout）

## 5.5 级联目录规则
- 目录格式：`tools/<domain>/<subdomain>/<tool-name-version>`
- 首批 domain：`boundary`、`network`、`raster`、`vector`、`vision`、`simulation`

---

## 6. 双通道状态机与结果一致性
## 6.1 状态定义
- `S0_RECEIVED`
- `S1_CHAIN_PLANNED`
- `S2_FAST_RUNNING`
- `S3_FAST_DONE`
- `S4_DEEP_QUEUED`
- `S5_DEEP_RUNNING`
- `S6_DEEP_PARTIAL`
- `S7_DEEP_DONE`
- `S8_TERMINAL_DEGRADED`

## 6.2 状态转移
- Fast 主链：`S0 -> S1 -> S2 -> S3`
- Deep 补全：`S3 -> S4 -> S5 -> (S6)* -> S7`
- 异常出口：`S2/S5 -> S8`

## 6.3 事件协议（SSE/WS）
- `fast.result`
- `deep.accepted`
- `deep.progress`
- `deep.patch`
- `deep.final`
- `deep.failed`

## 6.4 一致性与防死循环
- 每个 `plan_step` 最多 `2` 次重试。
- 检测“同参数重复失败”立即熔断。
- Plan Graph 必须环检测，发现环直接失败并输出诊断。
- 前端合并规则：按 `result_version` 单调递增，不允许回退覆盖。

## 6.5 状态补齐（P0）
### 6.5.1 `S6_DEEP_PARTIAL` 处理
- 定义：Deep 任务输出了可合并分片，但未达到最终完成条件。
- 前端行为：显示“阶段性结果”，并以 `result_version` 增量合并，不覆盖已确认结果。
- 后端行为：继续执行剩余步骤，直到 `S7_DEEP_DONE` 或 `S8_TERMINAL_DEGRADED`。

### 6.5.2 状态持久化
- 持久层：Redis（热状态）+ PostgreSQL（审计/恢复）。
- 持久字段：`trace_id`、`state`、`result_version`、`last_event_ts`、`retry_count`、`budget_left_ms`。

### 6.5.3 超时恢复
- 进程重启后按 `trace_id` 恢复最近状态。
- 若 `deadline` 已过：转 `S8_TERMINAL_DEGRADED` 并返回可用中间结果。
- 若 `deadline` 未过：从最近未完成 `plan_step` 继续执行。

---

## 7. 时间预算与调度策略
## 7.1 Fast Lane（硬 10 秒）
- Intent + DSL + Policy：`<=1.2s`
- Retrieval + Context：`<=2.0s`
- Tool 执行：`<=4.8s`
- Contract + Narrator：`<=1.5s`
- 系统余量：`0.5s`

超时策略：
- 到达 10s 立刻输出降级可行动结果。
- 自动派发 Deep Lane 续跑。

## 7.2 Deep Lane（分级预算）
| 等级 | 场景 | 目标时长 | 硬超时 |
|---|---|---:|---:|
| DL1 | 单区域精算 | <=15s | 20s |
| DL2 | 多区域融合 | <=30s | 40s |
| DL3 | 仿真推演/大范围 | <=60s | 90s |

## 7.3 动态预算分配（建议公式）
- `budget_step = remaining_budget * weight(step_kind, uncertainty, risk)`
- 当 `critical_path` 连续两次集中于同类步骤时，下一轮自动降低其预算上限并触发降维策略。

## 7.4 Fast Lane 门禁分级（P0）
- 目标不变：`P95 <= 10s`。
- 发布门禁采用两阶段：
  - Gate-1（上线门槛）：`P95 <= 12s`，并确保降级可用率 `100%`。
  - Gate-2（收敛目标）：`P95 <= 10s`，稳定后固化为硬门禁。
- 支撑机制：
  - LLM 预热、Python worker 预热、连接池预热。
  - 首 token 优先策略，减少感知等待。

## 7.5 缓存策略（P0）
### 7.5.1 缓存层级
- L1（请求结果缓存）：相同 DSL + 相同数据版本命中直接返回。
- L2（中间算子缓存）：`clip/buffer/merge` 中间结果可复用。
- L3（检索缓存）：Retrieval 候选与排序结果短期缓存。

### 7.5.2 Key 设计
- `cache_key = hash(dsl_ast + data_snapshot + tool_version + crs + params)`
- 必含 `data_snapshot`，避免脏缓存污染。

### 7.5.3 TTL 与失效
- L1: 5-15 分钟；L2: 15-60 分钟；L3: 1-5 分钟（可配置）。
- 数据更新、schema 升级、工具版本变更时强制失效。

---

## 8. 机器优先日志与诊断规范
## 8.1 日志语言策略
- `msg`：中文必填。
- `msg_en`：可选。
- `LOG_LANGUAGE_MODE=zh|bilingual`，默认 `zh`。

## 8.2 JSON Envelope（强制字段）
- `schema_version`
- `ts`、`level`、`service`、`module`、`event`
- `trace_id`、`span_id`、`parent_span_id`
- `request_id`、`session_id`、`conversation_id`、`run_id`
- `lane`、`plan_step_id`、`phase`
- `msg`、`env`、`host`、`build_sha`

## 8.3 分层埋点字段（关键）
- 请求层：`query_type`、`viewport.area_km2`、`input_tokens_est`
- Chain 层：`dsl_build_ms`、`plan_graph_nodes`、`plan_graph_cycle_detected`
- Retrieval：`top_k_requested/effective`、`candidate_count`、`cache_hit`
- Tool：`tool_id`、`tool_duration_ms`、`tool_retry_count`、`tool_uncertainty`
- Writer：`writer_tokens_in/out`、`markdown_contract_normalized`
- 队列：`queue_mode`、`queue_wait_ms`、`queue_depth`
- 数据库：`db_duration_ms`、`db_rows_returned`、`db_index_used`
- 可靠性：`fallback_applied`、`degraded`、`budget_exceeded`

## 8.4 错误日志强制字段
- `error_code`
- `error_stage`
- `error_class`
- `error_msg`（中文）
- `stack`
- `cause_chain`
- `suspected_component`
- `suggested_fix_hint`
- `root_cause_confidence`

## 8.5 慢请求定位字段
- `e2e_duration_ms`
- `ttfb_ms`
- `stage_ms`
- `critical_path`
- `slowest_stage`
- `slow_reason_tags`
- `perf_regression_vs_baseline_pct`

## 8.6 incident bundle（给 AI 的诊断包）
- 内容：请求摘要、阶段耗时、错误链、降级链、工具输入输出摘要、建议排查顺序。
- 路径：
  - `observability/incidents/open/YYYY-MM-DD/<trace_id>.json`
  - 修复后移至 `observability/incidents/closed/`

## 8.7 采样与保留
- 错误/超时/降级：100% 保留。
- 慢请求：100% 保留。
- 正常请求：动态采样 10%-30%。
- 灰度期 `area_analysis`：100% 保留。

---

## 9. API 与事件契约（对外）
## 9.1 HTTP API（最小集）
- `POST /api/v2/analysis`
- `GET /api/v2/jobs/:jobId`
- `GET /api/v2/tools`
- `POST /api/v2/tools/health-check`

## 9.2 结果契约
- `result_type`: `fast_initial | deep_patch | deep_final | degraded`
- `result_version`: 整数递增
- `trace_id`: 全链路一致
- `confidence`: `0~1`
- `risk_flags`: 数组
- `evidence_refs`: 数组

## 9.3 向后兼容
- 契约采用语义化版本：`contract.vX.Y`。
- 新增字段只增不删；删字段需经历 `deprecated -> removed`。

## 9.4 前端架构切换入口（计划项，暂不开发）
- 需求：在前端 head 栏“空间选区”`el-select` 左侧新增一个同风格 `el-select`。
- 选项：`V1架构`、`V2 Agent架构`。
- 目的：作为后端路由切换入口，便于同一查询在 V1/V2 间做效果对比与回归。
- 实施约束（后续开发阶段）：
  - 切换仅影响请求路由目标，不改变查询文本本身。
  - 切换状态应持久化到会话级（刷新后可恢复）。
  - 所有对比请求必须附带 `arch_mode` 埋点（`v1|v2`）。

---

## 10. 安全与稳健性设计
- 权限控制：Tool Registry 按 capability 白名单授权。
- 输入安全：DSL 生成后必须再过 policy/safety 校验。
- 提示词注入防护：用户输入与系统工具指令分层隔离。
- 数据脱敏：日志与 incident bundle 禁止直接输出敏感原文。
- 资源保护：每请求 CPU/内存/时间预算上限。

## 10.1 资源限制量化（P0）
- 默认阈值（可按环境配置）：
  - 单请求 CPU 时间上限：`1500ms`（控制平面）/ `5000ms`（工具平面）。
  - 单请求内存上限：`512MB`（控制平面）/ `1024MB`（工具平面）。
  - Fast Lane 硬超时：`10000ms`；Deep Lane 按 DL1/DL2/DL3。
- 超限动作：
  - 第一次超限：记录 `budget_exceeded` + 降级。
  - 连续超限：触发熔断窗口并切换低成本策略。
  - 严重超限：终止当前 step，返回中间结果与诊断建议。

---

## 11. 测试、门禁与验收（DoD）
## 11.1 测试矩阵
- 单测：契约校验、状态机、预算分配、错误码映射。
- 集成：Chain->Agent->Tool 协同。
- E2E：Fast/Deep 双通道完整流程。
- 压测：延迟、吞吐、退化阈值。
- 混沌：依赖超时、工具失效、队列拥堵、冷启动。

## 11.2 强门禁指标
- Fast Lane `P95 <= 10s`
- 结果契约通过率 `>=99%`
- 错误日志强制字段缺失率 `0%`
- 死循环触发率 `0`
- `top-50 recall` 相对基线下降 `<=3%`

## 11.3 交付件清单（每阶段必须产出）
- 契约文件：`contracts/*`、`dsl-schema/*`、`tool-protocol/*`
- 日志 schema：`observability/schemas/log-events/*`
- 诊断 schema：`observability/schemas/incident-bundle/*`
- 回放报告：`scripts/replay` 产物
- 诊断报告：`scripts/diagnostics` 产物

---

## 12. AI-native 分阶段执行计划（不中断执行）
## 12.1 执行原则
- 以“机器门禁”推进，不按自然周推进。
- 默认并行执行，多轨道同步推进。
- 每阶段都要：执行 -> 校验 -> 失败即回退 -> 修复 -> 再校验。

## 12.2 并行轨道
- Track A：契约与协议
- Track B：运行时主链
- Track C：观测诊断
- Track D：工具生态

## 12.3 阶段节奏（小时级）
### P0（T+0h~T+4h）：契约与观测底座
- 目标：先可测、可诊断。
- 门禁：schema 通过率 100%，错误字段缺失率 0%。

### P1（T+4h~T+16h）：Fast Lane 闭环
- 目标：先完成 10s 可行动结果。
- 门禁：Fast P95 <= 10s，超时仍可降级响应。

### P2（T+16h~T+30h）：Deep Lane 闭环
- 目标：Fast 后稳定补全，无覆盖错乱。
- 门禁：版本冲突率 <0.1%，死循环 0。

### P3（T+30h~T+48h）：多工具扩展 + 自动诊断
- 目标：验证可扩展性与排障效率。
- 门禁：新工具接入一次通过率 >=95%，错误聚类可自动输出建议。

### P4（T+48h+）：持续优化循环（6h/轮）
- 每轮：回放->对比->根因聚类->优化->再回放。
- 门禁：`perf_regression_vs_baseline_pct <= 0` 且无新增 P0/P1 级错误。

---

## 13. 目录工程化蓝图（V2）
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

---

## 14. 最终交付验收定义（完工标准）
满足以下全部条件才可称为“V2 架构完工（第一阶段）”：
1. Fast Lane `P95 <= 10s`，且降级可用。
2. Deep Lane 可补全，状态机稳定，无死循环。
3. 工具注册/调用/错误码/schema 全链路可机检。
4. JSON 日志可直接支持 AI 自动排障（incident bundle 可生成）。
5. 至少 4 个能力域工具样例接入（boundary/network/raster/vector）。
6. 回放、压测、混沌三类报告齐全。

---

## 15. 风险与控制
- 风险：过度工程化、日志噪声、性能回退、工具扩展破坏稳定性。
- 控制：
  - 先闭环后扩展。
  - 每次新增能力必须走契约+回放+门禁。
  - 错误优先修复策略：P0/P1 > 性能优化 > 新功能。

---

## 16. 本文维护规则
- 任何架构或契约变化必须同步更新本文。
- 变更需记录版本与日期：
  - `Spec-Version: v2.0`
  - `Last-Updated: 2026-03-05`

---

## 17. 剩余可优化项（非阻塞）
> 说明：以下项目不阻塞 P0/P1 主链路落地，但建议按优先级逐步补齐。

| 项目 | 当前现状 | 建议补齐 | 优先级 | 触发条件 | 交付件 |
|---|---|---|---|---|---|
| DSL 完整 JSON Schema 文件 | 4.4 已给 DSL 结构与语法示例，但尚未落地独立 schema 文件 | 在 `observability/schemas` 之外新增 `dsl-schema/*.json`，并在 CI 中做 DSL 入参校验 | 高 | P1 进入联调前 | `dsl.v0.1.schema.json`、校验脚本、示例用例 |
| DSL x Tool 版本兼容矩阵 | 当前仅有“兼容当前+前一小版本”原则，未给映射表 | 补充“DSL 版本 × Tool 版本 × 兼容状态”对照表，并绑定回归样本 | 高 | 首次多工具并行接入前 | 兼容矩阵文档、版本回归报告 |
| 前端地图联动细节 | 9.2/9.3 已定义结果契约与版本规则，9.4 已定义架构切换入口需求 | 补前端 SDK 级消费规范：`deep.patch` 合并策略、地图图层刷新策略、失败回滚 UI 行为 | 中 | 前端进入 V2 可视化联调前 | 前端联动规范、时序图、验收清单 |
| P4 自动化回放闭环 | 12 章已定义循环流程，但自动化基建未落地 | 先做最小自动化（固定样本 + 定时回放 + 指标对比），再做错误聚类与根因建议自动化 | 中 | P3 验证稳定后 | 回放作业脚本、日报模板、回归看板 |

### 17.1 执行顺序建议（非阻塞）
1. `DSL 完整 JSON Schema 文件`
2. `DSL x Tool 版本兼容矩阵`
3. `前端地图联动细节`
4. `P4 自动化回放闭环`

