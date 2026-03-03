# SpatialRAG-WebGIS DSL 与路由综合设计（整合版 v1.1）

- 日期: 2026-03-03
- 适用项目: `vite-project`（`src` + `fastify-backend` + `python_service`）
- 基线文档:
  - `docs/2026-03-02-spatial-llm-dsl-routing-design.md`
  - `docs/2026-03-02-spatial-dsl-validator-checklist.md`
  - `gemini评价.md`
- 目标:
  - 保留原方案主干（DSL 化、参数通道优先、Writer 可选化）
  - 吸收有效评审意见，补齐缺口并转为可执行规则
  - 给出统一落地路径（Schema/Validator/Router/Streaming/多轮会话）

---

## 1. 综合评估结论（对 Gemini 评价的处理）

### 1.1 采纳（正确且关键）

1. `operators.params` 过于宽松（`additionalProperties: true`）存在晚失败风险。  
2. `complexity_score` 需要线上校准闭环，否则长期漂移。  
3. 缺少多轮会话下 DSL 增量修订策略（Rebuild vs Patch）。  
4. 缺少 Streaming JSON + Prefetch 的时延重叠设计。  
5. Critic 需要明确同步/异步分层，否则高风险路径时延不稳定。

### 1.2 部分采纳（方向对，但需工程化约束）

1. “高风险必走 critic 会拖慢”并非全错，但不能简单取消。  
2. 正确做法是:
   - `critical` 走同步 Critic（阻断执行）
   - `high` 默认异步 Critic（不阻断首包结果）
   - 用规则校验器承担大部分“可静态判定”工作

### 1.3 不采纳（表述偏差）

1. “完全缺少 Spatial Context Binding”不准确。  
2. 现有方案有 `scope.viewport` 与前端映射入口思路，但确实未细化“注入时机 + 一致性 + 失效判断”。

---

## 2. 设计原则（v1.1）

1. 参数通道优先，文本通道按需触发。  
2. 结构化约束尽量前置（Schema + 语义校验 + 策略校验）。  
3. 高风险优先正确性，低风险优先时延。  
4. 会话态可追溯（`trace_id/session_id/base_trace_id`）。  
5. 任何“智能”机制都必须可观测、可回放、可降级。  

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

## 4. Spatial Query DSL v1.1（整合规范）

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

## 4.2 新增字段（v1.1 建议）

```json
{
  "context_binding": {
    "viewport_hash": "sha1:...",
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

1. `context_binding`：用于 Spatial Context Binding 的一致性校验。  
2. `revision`：声明本轮 DSL 是全量重建还是基于上轮 patch。  
3. `streaming_hints`：允许编排器提前触发预取。  

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

后端执行前校验:

1. `captured_at_ms` 与请求时间差是否超阈值（例如 3s）。  
2. `viewport_hash` 是否与当前会话状态匹配。  
3. 若 mismatch:
   - 低风险: 自动刷新 `scope.viewport` 后继续
   - 高风险: 转 `clarification_needed`

## 5.3 指代词绑定（“这里/附近”）

规则:

1. 若 query 含空间指代词且无显式地点名，默认绑定当前 `viewport`。  
2. 若有显式地点名且与 viewport 冲突，进入澄清。  
3. 澄清文案固定化，避免模型自由发挥。  

---

## 6. 多轮 DSL 增量修订（补齐机制）

## 6.1 两种模式

1. `rebuild`：重建全量 DSL（默认）。  
2. `patch`：基于 `base_trace_id` 做局部修改。  

## 6.2 Patch 格式（建议）

```json
{
  "revision": {
    "mode": "patch",
    "base_trace_id": "req_20260303_001",
    "patch_ops": [
      {"op": "replace", "path": "/entities/categories", "value": ["咖啡"]},
      {"op": "replace", "path": "/task/query_type", "value": "poi_search"}
    ]
  }
}
```

## 6.3 决策规则

1. 命中“轻改词”模式（如“换成咖啡店”）优先 patch。  
2. 涉及 `scope` 或 `query_type` 大改时强制 rebuild。  
3. patch 后必须重新通过 Schema + 语义 + 策略校验。  

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

## 7.3 失败回退

1. 流式 JSON 非法 -> 回退非流式 Planner。  
2. 预取失败不阻断主执行，标记 `prefetch_degraded=true`。  

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

| 阶段 | P50(ms) | P95(ms) | 说明 |
|---|---:|---:|---|
| 前端采样与打包 | 40 | 90 | context binding + snapshot 决策 |
| 网络到网关 | 30 | 100 | 含 TLS/队列抖动 |
| Planner（含路由） | 180 | 700 | realtime 应尽量 rule/small |
| DSL 校验（3段） | 8 | 25 | schema+semantic+policy |
| Streaming 预取重叠收益 | -120 | -350 | 与 planner 并发重叠 |
| Executor 主查询 | 260 | 1400 | DB/空间算子/聚类 |
| OCR/视觉（按需） | 180 | 900 | 有截图时触发 |
| Fusion/Critic（sync） | 0/120 | 0/1200 | critical 才阻断 |
| Writer（按需） | 0/260 | 0/2200 | 参数通道默认 0 |
| 返回与前端渲染 | 50 | 180 | SSE/JSON 渲染 |
| 总计（参数通道） | ~650 | ~1800 | 目标线 |
| 总计（解释通道） | ~980 | ~8200 | 包含 writer |

---

## 11. 优化顺序表（执行优先级）

| 优先级 | 项目 | 预估收益 | 风险 | 依赖 |
|---|---|---|---|---|
| P0 | `operators.params` 子 schema 严格化 | 高（错误前置） | 低 | schema/validator |
| P0 | Context Binding 一致性校验 | 高（避免错查） | 中 | 前后端协议 |
| P0 | 多轮 DSL patch 机制 | 高（交互体验） | 中 | 会话存储 |
| P1 | Streaming JSON + Prefetch | 高（时延） | 中高 | parser/orchestrator |
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

---

## 13. 实施路线（整合）

## Phase A（1 周）

1. 固化 v1.1 文档与规则。  
2. 将 `operators.params` 子 schema 接入 validator。  
3. 接入 `dsl_schema_invalid / dsl_semantic_invalid / dsl_policy_invalid`。  

## Phase B（1 周）

1. 实现 `context_binding` 采样与一致性检查。  
2. 实现 `revision.mode=patch` 最小闭环。  
3. 建立 patch -> rebuild 自动回退策略。  

## Phase C（1-2 周）

1. 实现 Streaming JSON Parser。  
2. 接入 scope/entities 预取并发。  
3. 增加 prefetch 降级与观测字段。  

## Phase D（1 周）

1. Critic 同步/异步双路径上线。  
2. `complexity_score` 校准任务周期开启（双周）。  
3. 路由参数 A/B 与回放评估。  

---

## 14. 最小落地任务（本周可执行）

1. 把 `operators.params` 从“宽松对象”升级为“按 type 严格校验”。  
2. 在请求头或 options 中加入 `context_binding` 并做后端校验。  
3. 在 Planner 输出中新增 `revision` 元信息，先支持 `rebuild` 和一个 `replace` patch。  
4. 在 telemetry 打点:
   - `routing.complexity_score`
   - `critic_mode`
   - `prefetch_degraded`
   - `revision_mode`

---

## 15. 结论

1. 原方案方向正确，Gemini 的主要批评点中有 4 项属于高价值补丁。  
2. v1.1 的重点不是推翻，而是补“绑定、增量、流式、分层”四个工程缺口。  
3. 按本整合版推进，可同时守住:
   - 正确性（前置约束）
   - 时延（并发重叠）
   - 成本（Writer 与 Critic 可控）
   - 可演进性（会话修订与校准闭环）

