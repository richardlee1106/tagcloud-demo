# V2 智能体模块与契约设计

> 日期：2026-03-09  
> 范围：`V2-Agent-backend`

## 当前实现状态（2026-03-09）

- 文中列出的 `orchestrator/agents/contracts/repositories` 目标结构已在仓库中具备对应运行时模块。
- `objective contract`、`artifact contract`、`evidence contract` 已实际进入运行链路。
- `specialist result` 与 `quality decision` 已用于 SSE 输出和 `/api/v2/jobs/:jobId` 快照。
- `Data Grounding Agent` 已支持真实 PostGIS 查询与 sample fallback 双路径。
- 兼容层仍保留 legacy fallback，但已不再是 6 个核心 objective 的默认路径。

## 1. 设计目标

本文件回答四个问题：

1. V2 应该有哪些核心智能体模块？
2. 每个智能体分别负责什么？
3. 模块之间如何通过统一契约协作？
4. SSE、job snapshot、artifact 与 fallback 如何闭环？

本文档是 V2 契约定义的单一来源。总览负责原则，路线负责迁移，本文件负责 schema 和字段语义。

## 2. 智能体模块拆分

### 2.1 编排层

#### `Task Orchestrator Agent`

职责：

- 接管整个请求生命周期
- 分配响应时间预算
- 决定是否进入 fast/deep 双车道
- 决定激活哪些专业智能体
- 汇总结果并输出统一响应
- 在允许范围内决定是否 fallback 到 legacy 兼容路径

输入：

- 用户 query
- 会话上下文
- AOI / viewport / regions
- objective routing output
- rollout allowlist / fallback policy

输出：

- objective contract
- 子任务分派结果
- SSE public response events
- `/api/v2/jobs/:jobId` 物化快照

### 2.2 决策所有权约束

- `Task Orchestrator` 是唯一合法的任务入口。
- `Task Orchestrator` 是唯一合法的对外响应出口。
- 其他智能体可以输出判断，但不直接改写对外事件协议。

## 3. 路由层

### `Intent Router Agent`

职责：

- 把自然语言转为任务目标
- 判断问题属于哪一类目标
- 输出 objective routing output，而不是只给一个模板名

应识别的核心目标类型：

- `area_briefing`
- `hotspot_analysis`
- `opportunity_discovery`
- `compare_analysis`
- `buffer_export_workflow`
- `coverage_gap_analysis`

路由输出至少应包含：

- `objective`
- `confidence`
- `routing_features`
- `legacy_hint`

约束结论：

- 路由输出是 objective contract 的输入，不是最终可执行协议。
- `Intent Router` 无权单独承诺 artifact、deep path 或 handoff legacy。

## 4. Grounding 层

### `Data Grounding Agent`

职责：

- 解析 AOI
- 查询 PostGIS / pgvector
- 构建工作数据集
- 判断数据是否充分
- 当数据稀疏时自动扩圈检索
- 记录 no-data ladder 的尝试轨迹

### 4.1 强制规则

对于片区分析类问题，必须先经过 `Data Grounding Agent`。

禁止：

- 未查库先说无数据
- 只靠前端传数回答标准片区问题
- 不区分洞察任务和导出任务

### 4.2 输出边界

`Data Grounding Agent` 的合法输出只有 grounding result contract。它不直接生成用户结论，不直接定义 artifact 文案。

## 5. 专业分析层

### `Dominant Industry Agent`

负责：

- 主导业态识别
- 类别集中度分析
- Top categories 摘要

### `Hotspot Agent`

负责：

- 活力热点识别
- 热点强度计算
- 热点子区域解释

### `Opportunity Agent`

负责：

- 供给失衡识别
- 高潜机会点发现
- 可关注区域建议

### `Compare Agent`

负责：

- 多区域对比
- 差异解释
- 优先级对照判断

### `Buffer-Coverage Agent`

负责：

- clip
- buffer
- merge
- dissolve
- export

它承担 V1 中明确的几何空间操作能力对齐任务。

### `Narrative Writer Agent`

负责：

- 将结构化结果压缩成用户可读结论
- 输出 30 秒快评版本
- 保留必要的不确定性措辞

### `Quality Guard Agent`

负责：

- 校验数据充分性
- 检查结论是否夸大
- 检查多智能体结果是否冲突
- 对结果做最终裁决

唯一合法裁决：

- `pass`
- `conditional`
- `narrow_scope`
- `handoff_legacy`
- `no_data`

## 6. Objective Contract

V2 不应继续把内部决策只表达为 `template_id`，而应升级为完整的 `objective contract`。

### 6.1 标准结构

```json
{
  "objective": "area_briefing",
  "response_mode": "brief_30s",
  "must_cover": ["dominant_industries", "hotspots", "opportunity_points"],
  "latency_budget_ms": 30000,
  "requires_grounding": true,
  "requires_artifact": false,
  "quality_level": "fast",
  "request_context": {
    "session_id": "demo-session",
    "query": "请在 30 秒内给我这片区的关键结论",
    "history_summary": []
  },
  "scope": {
    "aoi_source": "viewport",
    "viewport": {
      "bbox": [114.30, 30.52, 114.36, 30.57],
      "zoom": 15
    },
    "regions": [],
    "crs": "EPSG:4326"
  },
  "execution_policy": {
    "lane": "fast_then_deep",
    "deadline_ms": 30000,
    "max_retries": 2,
    "allow_fallback": true
  },
  "artifact_policy": {
    "artifact_required": false,
    "artifact_type": null,
    "delivery_mode": "none"
  },
  "fallback_policy": {
    "allowlist_hit": true,
    "legacy_hint": "micro-poi-summary",
    "fallback_target": "legacy-compatible-path"
  }
}
```

### 6.2 字段定义

| 字段 | 定义 | 默认规则 |
|---|---|---|
| `objective` | 任务目标类型 | 必填，无默认值 |
| `response_mode` | 对外回答模式 | 未显式指定时按 objective 默认模式 |
| `must_cover` | 必须覆盖的 section 列表 | 未指定时按 objective 模板默认值 |
| `latency_budget_ms` | 业务级时延预算 | 未指定时继承 objective 默认预算 |
| `requires_grounding` | 是否强制先查库 | 片区分析类 objective 默认 `true` |
| `requires_artifact` | 是否要求导出型交付物 | 洞察类默认 `false` |
| `quality_level` | 当前执行阶段或质量等级 | fast path 默认 `fast` |
| `request_context` | 请求原文及最小上下文 | 未提供 history 时使用空数组 |
| `scope` | AOI、viewport、regions 与 CRS | 未给 regions 时用空数组 |
| `execution_policy` | lane、deadline、retry、fallback 策略 | 未指定时使用系统缺省 |
| `artifact_policy` | artifact 是否必须、产物类型、交付方式 | 非 artifact 任务默认 `none` |
| `fallback_policy` | allowlist 命中、legacy hint、fallback 目标 | allowlist 未命中时必须显式写出 fallback |

### 6.3 约束结论

- `objective contract` 是新路径唯一合法执行协议。
- `template` 只允许出现在 `fallback_policy.legacy_hint`，不再承担主契约角色。
- 非 artifact 任务的 `artifact_policy.artifact_required` 必须为 `false`。

## 7. Grounding Result Contract

`grounding result contract` 是 `Data Grounding Agent` 的唯一合法输出。

### 7.1 标准结构

```json
{
  "aoi": {
    "resolved": true,
    "source": "viewport",
    "geometry_ref": "aoi://request/current"
  },
  "query_summary": {
    "data_source": "postgis",
    "tables": ["poi"],
    "filters": ["within_aoi"]
  },
  "coverage": {
    "status": "sufficient",
    "poi_count": 182,
    "sufficiency_reason": "AOI 内样本量满足快评阈值"
  },
  "working_set_refs": [
    "dataset://poi/current-aoi"
  ],
  "no_data_ladder": [
    { "step": "aoi_exact", "status": "success" }
  ],
  "limitations": []
}
```

### 7.2 必填语义

- `aoi`：AOI 是否解析成功，以及 AOI 来源。
- `query_summary`：至少记录查询了什么数据源、什么实体、什么过滤条件。
- `coverage`：必须明确 `sufficient / partial / insufficient / none` 之一。
- `working_set_refs`：供 specialist 消费的数据集引用。
- `no_data_ladder`：必须保留每一步尝试记录，即使第一步成功也要写轨迹。
- `limitations`：需要显式暴露 grounding 阶段已知限制。

### 7.3 约束结论

- 如果 `coverage.status` 为 `none`，必须能从 `no_data_ladder` 追溯到检索过程。
- 如果 `coverage.status` 为 `partial`，`Quality Guard` 不能无条件输出高置信结论。

## 8. Specialist Result Contract

每个专业智能体都必须输出统一的 specialist result contract。

### 8.1 标准结构

```json
{
  "section_type": "hotspots",
  "claims": [
    {
      "statement": "热点主要集中在东南侧商业界面",
      "confidence": 0.78,
      "evidence_refs": ["dataset://poi/current-aoi", "metric://hotspot/grid-7"]
    }
  ],
  "metrics": {
    "top_clusters": 3
  },
  "limitations": [
    "夜间时段数据缺失"
  ],
  "summary_text": "热点集中，南侧强于北侧。"
}
```

### 8.2 字段语义

| 字段 | 定义 |
|---|---|
| `section_type` | 该智能体负责的 section 类型 |
| `claims` | 对外可引用的结论单元 |
| `metrics` | 支撑 claims 的结构化指标 |
| `limitations` | 影响解释强度的局限 |
| `summary_text` | 给叙事写作层消费的压缩文本 |

### 8.3 约束结论

- `claims[].evidence_refs` 可以为空，但高置信 claim 不应长期为空。
- `Specialist Result` 只描述本 section，不得直接替代总回答。

## 9. Quality Decision Contract

`Quality Guard Agent` 的输出必须统一为 quality decision contract。

### 9.1 标准结构

```json
{
  "decision": "conditional",
  "reason_codes": ["partial_grounding", "weak_evidence_for_opportunity"],
  "allowed_output": {
    "can_emit_fast": true,
    "can_emit_deep": true,
    "can_claim_artifact": false
  },
  "required_disclaimers": [
    "机会点结论需结合周边人工核验"
  ],
  "next_action": "continue_with_constraints"
}
```

### 9.2 裁决类型

| 裁决 | 含义 | 编排器动作 |
|---|---|---|
| `pass` | 可正常对外输出 | 正常生成 fast/deep |
| `conditional` | 可输出，但必须保留条件措辞 | 输出受限版本 |
| `narrow_scope` | 当前范围过大或数据不稳定 | 要求缩小范围或降维输出 |
| `handoff_legacy` | 新路径不应继续处理 | 切回 legacy 兼容路径 |
| `no_data` | 已完成合法检索仍无可用数据 | 输出无数据说明和检索轨迹摘要 |

### 9.3 约束结论

- `Quality Guard` 有权裁定 `handoff_legacy`。
- 一旦裁定 `handoff_legacy`，新路径不得继续承诺新的 deep 分析收益。
- `no_data` 必须依赖 grounding 的 `no_data_ladder`，不得凭空得出。

## 10. SSE Event Contracts

V2 对外结果协议按 SSE 事件拆分定义，不再用单一 JSON 响应覆盖全部语义。

### 10.1 `fast.result`

- 触发时机：fast path 产生首个可展示快照时。
- 必填字段：
  - `schema_version`
  - `trace_id`
  - `job_id`
  - `result_type`
  - `result_version`
  - `state`
  - `objective`
  - `answer`
  - `evidence`
- 可选字段：
  - `telemetry`
  - `warnings`
  - `artifact`
- 禁止表达：
  - 在 `requires_artifact=false` 时承诺“文件可用”
  - 把 fast 结果表述成 deep 最终结论

### 10.2 `deep.accepted`

- 触发时机：deep path 被排队或接受执行时。
- 必填字段：
  - `schema_version`
  - `trace_id`
  - `job_id`
  - `result_type`
  - `result_version`
  - `state`
- 可选字段：
  - `queue_reason`
  - `estimated_budget_ms`
- 禁止表达：
  - 承诺 deep 一定成功
  - 在无 artifact manifest 时承诺 artifact 可用

### 10.3 `deep.patch`

- 触发时机：deep path 产生中间增量快照时。
- 必填字段：
  - `schema_version`
  - `trace_id`
  - `job_id`
  - `result_type`
  - `result_version`
  - `state`
- 可选字段：
  - `answer`
  - `evidence`
  - `telemetry`
  - `warnings`
- 禁止表达：
  - 伪装成标准 JSON Patch 协议
  - 在非 artifact 任务中使用 artifact 可用措辞

`deep.patch` 的明确结论：

- 它是**增量补充快照**，不是 JSON Patch 协议。
- 客户端 merge 语义为：**按顶层字段覆盖，以最新事件为准**。

### 10.4 `deep.final`

- 触发时机：deep path 正常结束时。
- 必填字段：
  - `schema_version`
  - `trace_id`
  - `job_id`
  - `result_type`
  - `result_version`
  - `state`
  - `answer` 或 `completion_summary`
- 可选字段：
  - `evidence`
  - `artifact`
  - `telemetry`
- 禁止表达：
  - 在 artifact 不存在时输出“文件可用”

### 10.5 `deep.failed`

- 触发时机：deep path 失败，但不应拖垮 fast path 时。
- 必填字段：
  - `schema_version`
  - `trace_id`
  - `job_id`
  - `result_type`
  - `state`
  - `error`
- 可选字段：
  - `incident_bundle`
  - `warnings`
- 禁止表达：
  - 否定已成功交付的 fast 结果

## 11. Job Snapshot Contract

`GET /api/v2/jobs/:jobId` 是 SSE 事件的最终物化视图，不是另一套独立协议。

### 11.1 标准结构

```json
{
  "job_id": "job-123",
  "trace_id": "trace-123",
  "state": "S7_DEEP_DONE",
  "result_version": 3,
  "history": ["S0_RECEIVED", "S1_CHAIN_PLANNED", "S3_FAST_DONE", "S7_DEEP_DONE"],
  "objective": "area_briefing",
  "routing_output": {
    "objective": "area_briefing",
    "confidence": 0.82
  },
  "fast_result": {},
  "deep_partial": {},
  "deep_final": {}
}
```

### 11.2 映射规则

- `fast_result` 对应最新一次 `fast.result`
- `deep_partial` 对应最新一次 `deep.patch`
- `deep_final` 对应 `deep.final`
- `state` 与 `history` 必须满足状态机约束

### 11.3 约束结论

- `/jobs/:jobId` 必须可回放任务终态，但不要求完整回放全部 SSE 文本。
- `deep_partial` 可以为空，但其语义永远是“最新 deep patch 快照”。
- `deep_final` 一旦存在，应覆盖同任务的最终 deep 状态。

## 12. Artifact Contract

artifact 只属于导出型任务，不属于所有成功回答的默认组成部分。

### 12.1 标准结构

```json
{
  "artifact": {
    "exists": true,
    "type": "geojson",
    "path": "artifacts/trace-123.geojson",
    "delivery_mode": "path",
    "manifest_ref": "artifact://trace-123"
  }
}
```

### 12.2 强制规则

- 只有 `requires_artifact=true` 的任务，才允许对外输出 artifact 相关措辞。
- 只有真实 artifact manifest 或 path 已存在时，才允许说“文件可用”。
- `artifact` 可以为空。
- 非 artifact 任务不得以任何措辞暗示“GeoJSON 已可下载”。

## 13. 兼容映射表

本文件是抽象升级，不代表当前代码已经完成模块拆分。为避免误读，现将当前实现术语与文档术语映射如下：

| 当前实现术语 | 文档术语 | 说明 |
|---|---|---|
| `intent` | objective routing output | 当前路由结果，未来应收敛为 objective routing output |
| `template` | legacy execution hint | 在新架构中只承担兼容提示作用 |
| `fast_result` | 首个对外快照 | SSE `fast.result` 的物化快照 |
| `deep_partial` | 最新 deep patch 快照 | SSE `deep.patch` 的最新快照 |
| `deep_final` | deep 终态快照 | SSE `deep.final` 的终态快照 |

补充说明：

- 当前仓库仍存在 template/DSL 驱动路径。
- 本文档定义的是收敛后的目标术语，不是对现状目录和模块化程度的宣称。

## 14. 演进目录建议

以下目录是**演进目录建议**，表示收敛方向，不表示当前仓库已经具备该结构。

- `orchestrator/`
  - `task-orchestrator.js`
  - `task-contract.js`
- `agents/`
  - `intent-router-agent.js`
  - `data-grounding-agent.js`
  - `dominant-industry-agent.js`
  - `hotspot-agent.js`
  - `opportunity-agent.js`
  - `compare-agent.js`
  - `buffer-coverage-agent.js`
  - `narrative-writer-agent.js`
  - `quality-guard-agent.js`
- `repositories/`
  - `postgis-poi-repository.js`
  - `postgis-region-repository.js`
  - `aggregation-repository.js`
- `contracts/`
  - `objective.schema.json`
  - `grounding-result.schema.json`
  - `specialist-result.schema.json`
  - `quality-decision.schema.json`
  - `analysis-result.schema.json`
- `runtime/`
  - 将现有 `analysis-service.js` 逐步收敛为 orchestrator 入口

## 15. PostGIS Grounding 策略

### 15.1 标准片区分析请求的强制流程

1. 解析 AOI
2. 查询 PostGIS
3. 判断数据充分性
4. 如不足则扩圈或降级检索
5. 再决定是否输出无数据

### 15.2 无数据判定阶梯

必须至少按以下顺序尝试：

1. AOI 精确查询
2. AOI 范围扩圈
3. 类别放宽
4. 邻近区域回退
5. 城市级基线或对照回退

## 16. 模块设计结论

V2 的关键不是“增加更多工具”，而是：

- 让编排器成为唯一任务入口
- 让 grounding 成为片区分析的必经之路
- 让专业智能体各司其职
- 让 SSE、job snapshot、artifact、fallback 共享同一套契约语言

这样才能避免当前这类“有分析、无 artifact，却误说文件可用”的问题再次发生。
