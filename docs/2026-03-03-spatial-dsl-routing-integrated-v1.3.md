# SpatialRAG-WebGIS DSL 与路由综合设计（整合版 v1.3）

- 日期: 2026-03-03
- 适用项目: `vite-project`（`src` + `fastify-backend` + `python_service`）
- 基线文档:
  - `docs/2026-03-02-spatial-llm-dsl-routing-design.md`
  - `docs/2026-03-02-spatial-dsl-validator-checklist.md`
  - `docs/2026-03-03-spatial-dsl-routing-integrated-v1.2.md`
- 本版变更（v1.3 相对 v1.2）:
  1. 为 `context_binding` 增加并发语义：`client_view_id` + `event_seq`，避免多标签页/并发请求误判
  2. 为 `patch_ops` 增加安全边界：声明允许路径与禁止路径，防止策略字段被 patch 篡改
  3. 修复 patch 示例与规则冲突：示例不再 patch `query_type`
  4. 增加模型分层到实际模型 ID 的映射表（贴合当前三模型落地）
  5. 重写第10节预算口径：分离“分段毛耗时”和“并发重叠收益”，并给出三类场景总计模板
  6. 补充 schema 落地门槛：新增字段接入前必须完成 schema 扩展与兼容回退

---

## 1. 综合评估结论（对 Gemini 评价的处理）

### 1.1 采纳（正确且关键）

1. `operators.params` 过于宽松（`additionalProperties: true`）存在晚失败风险。
2. `complexity_score` 需要线上校准闭环，否则长期漂移。
3. 缺少多轮会话下 DSL 增量修订策略（Rebuild vs Patch）。
4. 缺少 Streaming JSON + Prefetch 的时延重叠设计。
5. Critic 需要明确同步/异步分层，否则高风险路径时延不稳定。

### 1.2 部分采纳（方向对，但需工程化约束）

1. "高风险必走 critic 会拖慢"并非全错，但不能简单取消。
2. 正确做法是:
   - `critical` 走同步 Critic（阻断执行）
   - `high` 默认异步 Critic（不阻断首包结果）
   - 用规则校验器承担大部分"可静态判定"工作

### 1.3 不采纳（表述偏差）

1. "完全缺少 Spatial Context Binding"不准确。
2. 现有方案有 `scope.viewport` 与前端映射入口思路，但确实未细化"注入时机 + 一致性 + 失效判断"。

---

## 2. 设计原则（v1.3）

1. 参数通道优先，文本通道按需触发。
2. 结构化约束尽量前置（Schema + 语义校验 + 策略校验）。
3. 高风险优先正确性，低风险优先时延。
4. 会话态可追溯（`trace_id/session_id/base_trace_id`）。
5. 任何"智能"机制都必须可观测、可回放、可降级。

---

## 3. 综合目标架构

1. `Planner`：意图 -> DSL（含 routing/uncertainty/policy）。
2. `Validator`：Schema + Semantic + Policy 三段校验。
3. `Executor`：仅消费 DSL，不消费自由文本。
4. `Fusion/Critic`：
   - 同步 Critic: 仅 critical、必须阻断的场景
   - 异步 Critic: high 场景复核与回写，不阻断首响应
5. `Writer`：`need_text_answer=true` 或用户显式请求时触发。
6. `Stream Orchestrator`：DSL 流式解析 + 数据预取并发编排。

---

## 4. Spatial Query DSL v1.2（整合规范）

## 4.1 顶层字段（兼容 v1）

保留当前 schema 主结构（已落地于 `fastify-backend/schemas/spatial_query_v1.schema.json`）:

- `dsl_version`
- `trace_id`
- `session_id`
- `created_at`
- `task`
- `scope`
- `entities`
- `constraints`
- `operators`
- `output_contract`
- `uncertainty`
- `policy`
- `routing`（可选）

## 4.2 新增字段（v1.2 建议）

```json
{
  "context_binding": {
    "viewport_hash": "sha1:...",
    "client_view_id": "view_9f2c7a",
    "event_seq": 42,
    "map_state_version": "map_20260303_120102",
    "captured_at_ms": 1760000000000,
    "source": "frontend_injected"
  },
  "revision": {
    "mode": "rebuild",
    "base_trace_id": null,
    "patch_ops": []
  },
  "streaming_hints": {
    "allow_prefetch": true,
    "prefetch_on_fields": ["scope", "entities.categories"]
  }
}
```

字段语义:

1. `context_binding`：用于 Spatial Context Binding 的一致性校验（见第5节）；`client_view_id + event_seq` 用于并发时序判定。
2. `revision`：声明本轮 DSL 是全量重建还是基于上轮 patch（见第6节）。
3. `streaming_hints`：允许编排器提前触发预取（见第7节）。

## 4.3 `operators.params` 强约束（替代宽松对象）

当前问题: `params` 允许任意键，导致 Python 执行期才失败。
修订: 按 `operator.type` 分配子 schema（`oneOf + if/then`）。

示例约束表:

| operator.type | params 必填 | params 可选 | 约束 |
|---|---|---|---|
| `fetch_candidates` | `limit` | `order_by_distance` | `limit: 1..500000` |
| `filter_constraints` | 无 | `rating_min`,`distance_max_m`,`open_now`,`direction` | 类型与枚举严格 |
| `aggregate_h3` | `resolution` | `max_cells` | `resolution: 5..12` |
| `cluster_hdbscan` | `min_cluster_size` | `min_samples`,`max_points` | 全部为正整数 |
| `region_compare` | `target_region_ids` | `metrics` | `target_region_ids >= 2` |
| `graph_reasoning` | `distance_threshold_m` | `max_nodes` | `distance_threshold_m: 50..2000` |
| `counterfactual_eval` | `scenario` | `objective_weights` | `scenario` 非空 |
| `visual_review` | `enabled` | `model`,`timeout_ms` | `enabled` 布尔 |
| `self_validate` | `enabled` | `threshold` | `threshold: 0..1` |
| `name_audit` | `enabled` | `max_items`,`model` | `max_items: 1..200` |
| `rank_candidates` | `objective` | `weights` | `objective` 非空数组 |
| `compose_summary` | 无 | `style`,`max_tokens` | Writer 场景专用 |

## 4.4 语义校验（v1.1 最低要求）

1. `operators` 必须是 DAG。
2. `query_type=region_comparison` -> `scope.geometry_source=regions` 且 `region_ids>=2`。
3. `query_type=graph_reasoning` -> 必须存在 `graph_reasoning` 算子。
4. `task.need_text_answer=false` -> `output_contract.include_writer_text=false`。
5. `budget_tier` 与 `latency_budget_ms` 对齐:
   - realtime `<=1500`
   - interactive `<=5000`
   - deep `<=12000`
6. `risk_level=critical 且 planner_confidence<0.7` -> 强制澄清。

## 4.5 Schema 落地要求（v1.3 新增）

1. 在 `spatial_query_v1.schema.json` 增加 `context_binding / revision / streaming_hints` 字段定义后，才能默认启用 Planner 对这些字段的输出。
2. `operators.params` 从 `additionalProperties: true` 升级为按 `operator.type` 的条件子 schema 之前，不得声称“严格前置校验已完成”。
3. 在 schema 未升级阶段，后端必须支持兼容回退：
   - 忽略未知字段并打点 `dsl_schema_degraded=true`
   - 或启用 `v1_compat_mode=true` 的严格拒绝策略（二选一，需在环境变量中显式配置）

---

## 5. Spatial Context Binding（补齐机制）

## 5.1 前端注入时机

在 `AiChat.vue` 发起请求前，统一采样并冻结:

1. `mapViewport`
2. `mapZoom`
3. `regions/drawMode`
4. `selectedCategories`
5. `snapshot`（如需视觉/OCR）

采样结果写入:

- `options.spatialContext`
- `dsl.scope`
- `dsl.context_binding`

## 5.2 一致性校验

> **v1.2 修订**：判断空间上下文是否失效的依据不再是"打包时间与请求发出的时间差"，而是"用户发送期间地图是否发生了移动"。原因：用户在思考阶段通常停留 5~30 秒后才发送请求，若以 3 秒时间差作为失效阈值，会对正常用户造成不必要的 `clarification_needed` 打断，严重伤害交互体验。

后端执行前校验规则（v1.3）:

1. **状态存储维度**：服务端按 `(session_id, client_view_id)` 维护最近一次上下文记录：
   - `last_event_seq`
   - `last_viewport_hash`
   - `last_scope_snapshot`
2. **主判断顺序**（同一 `client_view_id` 内）：
   - 若 `event_seq < last_event_seq`：判定为陈旧请求（`context_stale=true`）。
   - 若 `event_seq == last_event_seq` 且 `viewport_hash` 一致：视为幂等重放，允许继续。
   - 若 `event_seq >= last_event_seq` 且 `viewport_hash` 一致：视为有效，更新 `last_event_seq` 后继续。
   - 若 `event_seq >= last_event_seq` 且 `viewport_hash` 不一致：判定为“发送期间视图发生变化”。
3. **处置策略**：
   - 低风险场景：自动用最新 viewport 刷新 `scope.viewport` 后继续，标记 `context_refreshed=true`。
   - 高风险场景（`risk_level=high/critical`）：转 `clarification_needed`，要求用户确认视角。
4. `captured_at_ms` 字段保留，仅用于审计日志与异步质量分析，不参与执行阻断决策。

## 5.3 并发与多标签页约束（v1.3 新增）

1. 前端每个地图视图实例生成唯一 `client_view_id`（页面刷新可重置）。
2. 同一 `client_view_id` 内，`event_seq` 必须单调递增。
3. 缺少 `client_view_id` 或 `event_seq` 时，后端退化为 v1.2 逻辑，并记录 `context_binding_degraded=true`。

## 5.4 指代词绑定（"这里/附近"）

规则:

1. 若 query 含空间指代词且无显式地点名，默认绑定当前 `viewport`。
2. 若有显式地点名且与 viewport 冲突，进入澄清。
3. 澄清文案固定化，避免模型自由发挥。

---

## 6. 多轮 DSL 增量修订（补齐机制）

## 6.1 两种模式

1. `rebuild`：重建全量 DSL（默认）。
2. `patch`：基于 `base_trace_id` 做局部修改。

## 6.2 Patch 格式

> **v1.3 声明**：`patch_ops` 遵循 **RFC 6902 JSON Patch** 标准（参见 <https://datatracker.ietf.org/doc/html/rfc6902>）。
> 当前版本仅支持以下三种操作，其余操作（`copy / move / test`）暂不支持，Validator 应拒绝并返回 `dsl_semantic_invalid`：
>
> - `add`：向目标路径新增值
> - `remove`：移除目标路径的字段或数组元素
> - `replace`：替换目标路径的现有值

```json
{
  "revision": {
    "mode": "patch",
    "base_trace_id": "req_20260303_001",
    "patch_ops": [
      {"op": "replace", "path": "/entities/categories", "value": ["咖啡"]},
      {"op": "replace", "path": "/constraints/distance_max_m", "value": 1200}
    ]
  }
}
```

## 6.3 决策规则

1. 命中"轻改词"模式（如"换成咖啡店"）优先 patch。
2. 涉及 `scope` 或 `query_type` 大改时强制 rebuild。
   - 原因：`scope` 一变，所有空间索引的命中策略都可能失效，patch 无法安全处理此类变更。
3. patch 后必须重新通过 Schema + 语义 + 策略全量校验。
4. patch 命中禁止路径时直接拒绝，返回 `dsl_semantic_invalid`。

## 6.4 Patch 路径白名单/黑名单（v1.3 新增）

允许 patch 的路径（默认白名单）:

1. `/entities/categories`
2. `/entities/keywords`
3. `/constraints/*`
4. `/output_contract/include_writer_text`
5. `/output_contract/max_items`

强制 rebuild 的路径:

1. `/scope/*`
2. `/task/query_type`
3. `/entities/anchor`

禁止 patch 的路径（黑名单）:

1. `/policy/*`
2. `/uncertainty/*`
3. `/routing/*`
4. `/trace_id`
5. `/session_id`

---

## 7. Streaming DSL + Prefetch（补齐机制）

## 7.1 编排思路

1. Planner 流式输出 JSON token。
2. Streaming Parser 在字段闭合时触发事件。
3. 事件驱动 Prefetch:
   - `scope` 闭合 -> 启动空间候选预取
   - `entities.categories` 闭合 -> 启动分类过滤预取
4. DSL 完整闭合后做最终校验与执行。

## 7.2 触发状态机

1. `S0`: 等待首字段
2. `S1`: scope-ready（可预取空间）
3. `S2`: entities-ready（可预取类别）
4. `S3`: dsl-complete（执行前总校验）
5. `S4`: executing

## 7.3 失败回退与预取质量观测

1. 流式 JSON 非法（如截断/格式错误）-> 回退非流式 Planner，不向用户暴露。
2. 预取失败不阻断主执行，标记 `prefetch_degraded=true`。
3. **（v1.2 新增）预取命中但 DSL 最终校验失败时**：
   - 此情形代表 Planner 生成的 DSL 在 `scope/entities` 字段已可解析，但整体 DSL 语义不合法（例如后续的 `query_type` 与前置 `scope` 存在冲突）。预取资源将被静默丢弃。
   - 必须记录 `prefetch_wasted=true` 指标（同时附带 `dsl_failure_error_code`），用于长期监控 LLM Planner 的 DSL 生成质量。
   - 建议将该指标纳入 Planner 质量门禁：若 `prefetch_wasted_rate > 5%`（按周统计），触发路由策略审查。

---

## 8. 模型路由决策表（整合版）

| query_type | complexity | budget | risk | planner | critic_mode | visual | reasoning | writer_default |
|---|---:|---|---|---|---|---|---|---|
| `poi_search` | 0-1 | realtime | low/medium | rule | off | off | off | off |
| `poi_search` | 2-3 | interactive | medium | small | off | conditional | off | brief |
| `area_analysis` | 2-3 | interactive | medium | medium | off/async | conditional | optional | brief |
| `area_analysis` | 4-6 | deep | high | frontier | async | on | on | standard |
| `region_comparison` | 3-5 | deep | high | frontier | async | optional | on | standard |
| `graph_reasoning` | 3-6 | deep | high | frontier | async | optional | must | standard |
| `site_selection` | 4-7 | deep | high/critical | frontier | critical->sync | on | on | detailed |
| `counterfactual` | 4-8 | deep | high/critical | frontier | critical->sync | optional | must | detailed |
| `general_qa` | 0-2 | realtime | low | rule/small | off | off | off | brief |
| `irrelevant_input` | 0 | realtime | low | rule | off | off | off | preset |

说明:

1. `sync` 仅用于必须阻断风险的关键任务。
2. `async` 结果写入审计日志与质量回放，不阻断首响应。

## 8.1 分层到模型 ID 映射（v1.3 新增）

| 角色/层 | 当前实现 |
|---|---|
| OCR | `glm-ocr` |
| planner=rule | 规则引擎（无模型调用） |
| planner=small | `qwen3.5-0.8b`（不可用时回退 `qwen3.5-4b`） |
| planner=medium | `qwen3.5-4b` |
| planner=frontier | `qwen3.5-4b`（当前本地上限；预留远端更大模型扩展位） |
| visual_overview_light | `qwen3.5-0.8b` |
| visual_review / reasoning / writer | `qwen3.5-4b` |

约束:

1. 不允许在路由表中再出现旧 `qwen3`（非 `qwen3.5`）模型代号。
2. 文档中的 tier 描述必须始终可映射到可运行模型 ID，避免“策略可执行、配置不可执行”。

---

## 9. Critic 策略（同步/异步）

## 9.1 同步 Critic（阻断）

触发条件:

1. `risk_level=critical`
2. `planner_confidence < 0.7` 或命中高危策略规则

动作:

1. Critic 复核 DSL
2. 复核失败 -> `clarification_needed` 或 `dsl_execution_blocked`

## 9.2 异步 Critic（不阻断）

触发条件:

1. `risk_level=high` 且 `query_type in {area_analysis, region_comparison, graph_reasoning, site_selection, counterfactual}`

动作:

1. 首结果先返回
2. 异步复核结果写入:
   - `ops/audit`
   - 质量数据集（用于路由和复杂度校准）

---

## 10. 请求到响应耗时预算模板（P50/P95）

> **v1.3 说明**：下表中的数值为上线前的**目标预算**（工程估算），不代表实测基准。
> Phase C（Streaming Prefetch）完成后，必须用真实线上请求的数据回填各阶段实测 P50/P95，将本表从"目标预算"升级为"实测基准"，用于后续版本的 SLO 门禁计算。

### 10.1 分段“毛耗时”预算（不含重叠扣减）

| 阶段 | P50(ms) 目标 | P95(ms) 目标 | 说明 |
|---|---:|---:|---|
| 前端采样与打包 | 40 | 90 | context binding + snapshot 决策 |
| 网络到网关 | 30 | 100 | 含 TLS/队列抖动 |
| Planner（含路由） | 180 | 700 | realtime 应尽量 rule/small |
| DSL 校验（3段） | 8 | 25 | schema+semantic+policy |
| Executor 主查询 | 260 | 1400 | DB/空间算子/聚类 |
| OCR/视觉（按需） | 180 | 900 | 有截图时触发 |
| Fusion/Critic（sync） | 0/120 | 0/1200 | critical 才阻断 |
| Writer（按需） | 0/260 | 0/2200 | 参数通道默认 0 |
| 返回与前端渲染 | 50 | 180 | SSE/JSON 渲染 |

### 10.2 并发重叠收益（独立指标）

| 指标 | P50(ms) 目标 | P95(ms) 目标 | 说明 |
|---|---:|---:|---|
| `prefetch_overlap_delta_ms` | -120 | -350 | 仅用于总计扣减，不作为独立阶段耗时 |

### 10.3 场景总计模板（含重叠扣减）

| 场景 | 组成 | P50(ms) 目标 | P95(ms) 目标 |
|---|---|---:|---:|
| 参数通道（默认） | 10.1 基础链路 + 10.2 扣减，不含视觉/Writer/sync Critic | ~650 | ~1800 |
| 参数通道 + 视觉 | 默认参数通道 + OCR/视觉 | ~830 | ~2700 |
| 解释通道（含视觉+Writer） | 参数通道 + OCR/视觉 + Writer | ~980 | ~8200 |

说明:

1. `sync Critic` 只在 `critical` 路径触发，触发时按表内上限叠加。
2. 实测回填时必须分别回填三种场景，不能只给单一“全局平均”。

---

## 11. 优化顺序表（执行优先级）

| 优先级 | 项目 | 预估收益 | 风险 | 依赖 |
|---|---|---|---|---|
| P0 | `operators.params` 子 schema 严格化 | 高（错误前置） | 低 | schema/validator |
| P0 | Context Binding 一致性校验（`client_view_id + event_seq + viewport_hash`） | 高（避免错查/误判） | 中 | 前后端协议 |
| P0 | 多轮 DSL patch 机制（RFC 6902 + 路径白名单/黑名单） | 高（交互体验+安全） | 中 | 会话存储 |
| P0 | 路由层级到模型 ID 映射固化 | 高（可执行性） | 低 | 模型配置 |
| P1 | Streaming JSON + Prefetch（含 prefetch_wasted 指标） | 高（时延） | 中高 | parser/orchestrator |
| P1 | Critic 同步/异步分层 | 中高（稳态时延） | 中 | 路由策略 |
| P1 | complexity_score 校准闭环 | 中（长期收益） | 低 | 观测体系 |
| P2 | Writer 进一步模板化 | 中（成本） | 低 | 文案规范 |
| P2 | 路由策略 A/B 自动调参 | 中 | 中 | telemetry |

---

## 12. 验证清单（合并版）

1. Schema 校验通过率 >= 99%。
2. `dsl_semantic_invalid_rate < 1%`。
3. 参数通道 `P95 <= 1800ms`。
4. `critical` 风险请求无越权执行。
5. 多轮 patch 成功率与回退率可观测。
6. 异步 Critic 覆盖率与修正命中率可观测。
7. `prefetch_wasted_rate`（周统计）可观测，超过 5% 触发路由审查。
8. `context_binding.viewport_hash` 不一致率可观测，用于评估前端采样稳定性。
9. patch 命中黑名单路径时，100% 返回 `dsl_semantic_invalid`。
10. `client_view_id` 缺失降级率可观测（`context_binding_degraded_rate`），并持续下降。

---

## 13. 实施路线（整合）

## Phase A（1 周）

1. 固化 v1.3 文档与规则。
2. 将 `operators.params` 子 schema 接入 validator。
3. 将 `context_binding / revision / streaming_hints` 正式纳入 schema，并提供 `v1_compat_mode` 回退开关。
4. 接入 `dsl_schema_invalid / dsl_semantic_invalid / dsl_policy_invalid`。

## Phase B（1 周）

1. 实现 `context_binding` 采样与一致性检查（基于 `client_view_id + event_seq + viewport_hash`）。
2. 实现 `revision.mode=patch` 最小闭环（RFC 6902，仅支持 add/remove/replace）。
3. 落地 patch 路径白名单/黑名单与“强制 rebuild 路径”。
4. 建立 patch -> rebuild 自动回退策略。

## Phase C（1-2 周）

1. 实现 Streaming JSON Parser。
2. 接入 scope/entities 预取并发。
3. 增加 prefetch 降级与观测字段（`prefetch_degraded`、`prefetch_wasted`）。
4. 增加 `prefetch_overlap_delta_ms` 指标并接入预算看板。
5. **Phase C 完成后：将第10节耗时预算表用实测 P50/P95 回填，升级为实测基准。**

## Phase D（1 周）

1. Critic 同步/异步双路径上线。
2. `complexity_score` 校准任务周期开启（双周）。
3. 路由参数 A/B 与回放评估。
4. 路由层级（rule/small/medium/frontier）与模型 ID 的一致性巡检自动化。

---

## 14. 最小落地任务（本周可执行）

1. 把 `operators.params` 从"宽松对象"升级为"按 type 严格校验"。
2. 在请求头或 options 中加入 `context_binding`（至少含 `client_view_id`、`event_seq`、`viewport_hash`），后端按并发语义判定上下文有效性。
3. 在 Planner 输出中新增 `revision` 元信息，先支持 `rebuild` 和一个 `replace` patch（遵循 RFC 6902），并接入 patch 路径白名单。
4. 在 telemetry 打点:
   - `routing.complexity_score`
   - `critic_mode`
   - `prefetch_degraded`
   - `prefetch_wasted`
   - `prefetch_overlap_delta_ms`
   - `revision_mode`
   - `context_refreshed`
   - `context_binding_degraded`

---

## 15. 结论

1. 原方案方向正确，v1.1 的主要批评点中有 4 项属于高价值补丁。
2. v1.3 在 v1.2 基础上补齐了可签字落地的四个关键缺口：
   - **Context Binding 并发语义**：引入 `client_view_id + event_seq`，避免多标签页与并发请求误判。
   - **Patch 安全边界**：新增路径白名单/黑名单与强制 rebuild 路径，避免策略字段被 patch 篡改。
   - **模型路由可执行性**：把 tier 映射到实际模型 ID（`glm-ocr`、`qwen3.5-0.8b`、`qwen3.5-4b`）。
   - **预算口径可审计**：拆分毛耗时、重叠收益、场景总计三层模板，便于实测回填。
3. 按本整合版推进，可同时守住:
   - 正确性（前置约束）
   - 时延（并发重叠）
   - 成本（Writer 与 Critic 可控）
   - 可演进性（会话修订与校准闭环）
