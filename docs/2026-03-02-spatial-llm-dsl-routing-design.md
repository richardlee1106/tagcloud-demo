# SpatialRAG-WebGIS LLM 升级设计（含 DSL v1 与模型路由）

- 日期: 2026-03-02
- 适用项目: `vite-project`（`src` + `fastify-backend` + `python_service`）
- 文档目标:
  - 明确“LLM 不仅用于抽参，而用于空间决策编排”的升级路径
  - 定义 `Spatial Query DSL v1` 完整 JSON Schema（字段、枚举、校验规则）
  - 给出项目专用模型路由决策表（按 `query_type/复杂度/预算/风险`）

---

## 1. 背景与问题定义

### 1.1 现状判断（正确但未榨干价值）

当前系统已经具备良好基础：
- 规则快路径 Planner（非强依赖 LLM）
- 结构化接口（`/api/ai/plan` + `/api/ai/execute`）
- Python 主执行链 + SSE 可观测

但高价值能力仍偏后置（主要落在 Writer 文本生成），会导致：
- LLM 价值集中在“解释”，而非“决策”
- 参数型请求被不必要地拉入文本链路
- 高级任务（多目标权衡、反事实、冲突约束）没有统一决策语义层

### 1.2 核心升级方向

将系统从“对话问答架构”升级为“空间决策编排架构”：
1. LLM 主职责前移到 `Planner/Fusion`，输出可执行计划（DSL）
2. Writer 降级为可选层（按需解释，不再是主链路依赖）
3. Executor 只执行 DSL，不执行自由文本
4. 建立证据闭环和不确定性管理机制

---

## 2. 目标架构（V2）

## 2.1 双通道架构

1. `参数结果通道`（默认）
- 输入: 用户问题 + 空间上下文
- 输出: 结构化结果（POIs、boundary、stats、evidence_refs）
- 特点: 不经过 Writer 文本生成；用于产品主功能、低时延、高确定性

2. `解释文本通道`（按需）
- 输入: 参数通道结果 + 用户明确“要解释/要报告”
- 输出: 自然语言结论
- 特点: 末端能力；不阻塞主结果

## 2.2 分层职责

1. Rule/NLP 层: 快速意图分流、低成本抽参、硬规则拦截
2. LLM Planner 层: 复杂意图 -> DSL 计划生成
3. Static Validator 层: JSON Schema + 语义校验 + 安全策略
4. Executor 层: 按 DSL 算子图执行（Python/SQL/图分析）
5. Fusion/Critic 层: 证据一致性、冲突裁决、置信度复核
6. Writer 层: 可选文本说明（仅在 `need_text_answer=true` 启用）

---

## 3. Spatial Query DSL v1 规范

## 3.1 设计原则

1. 可执行: 每个字段必须可被后端消费
2. 可验证: 机器可校验（Schema）+ 语义可校验（规则）
3. 可追踪: 全链路 `trace_id`、`policy`、`uncertainty` 必须可记录
4. 可降级: 低置信度可转澄清，不进入盲目执行

## 3.2 完整 JSON Schema（Draft 2020-12）

> 文件名建议: `fastify-backend/schemas/spatial_query_v1.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://geoloom.local/schemas/spatial_query_v1.schema.json",
  "title": "Spatial Query DSL v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "dsl_version",
    "trace_id",
    "task",
    "scope",
    "entities",
    "constraints",
    "operators",
    "output_contract",
    "uncertainty",
    "policy"
  ],
  "properties": {
    "dsl_version": {
      "type": "string",
      "const": "spatial_query_v1"
    },
    "trace_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[a-zA-Z0-9._:-]+$"
    },
    "session_id": {
      "type": ["string", "null"],
      "maxLength": 128
    },
    "created_at": {
      "type": ["string", "null"],
      "format": "date-time"
    },
    "task": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query_type",
        "goal",
        "need_text_answer"
      ],
      "properties": {
        "query_type": {
          "type": "string",
          "enum": [
            "poi_search",
            "area_analysis",
            "region_comparison",
            "graph_reasoning",
            "site_selection",
            "counterfactual",
            "general_qa",
            "irrelevant_input",
            "clarification_needed"
          ]
        },
        "goal": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "need_text_answer": {
          "type": "boolean"
        },
        "answer_style": {
          "type": "string",
          "enum": ["none", "brief", "standard", "detailed"],
          "default": "none"
        },
        "priority": {
          "type": "string",
          "enum": ["low", "normal", "high", "urgent"],
          "default": "normal"
        }
      }
    },
    "scope": {
      "type": "object",
      "additionalProperties": false,
      "required": ["geometry_source"],
      "properties": {
        "geometry_source": {
          "type": "string",
          "enum": ["viewport", "polygon", "circle", "regions", "global"]
        },
        "viewport": {
          "type": "array",
          "description": "[minLon, minLat, maxLon, maxLat]",
          "items": { "type": "number" },
          "minItems": 4,
          "maxItems": 4
        },
        "polygon": {
          "type": "array",
          "description": "Polygon ring: [[lon,lat], ... closed optional]",
          "items": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 2,
            "maxItems": 2
          },
          "minItems": 3
        },
        "circle": {
          "type": "object",
          "additionalProperties": false,
          "required": ["center", "radius_m"],
          "properties": {
            "center": {
              "type": "object",
              "additionalProperties": false,
              "required": ["lon", "lat"],
              "properties": {
                "lon": { "type": "number", "minimum": -180, "maximum": 180 },
                "lat": { "type": "number", "minimum": -90, "maximum": 90 }
              }
            },
            "radius_m": { "type": "integer", "minimum": 10, "maximum": 100000 }
          }
        },
        "region_ids": {
          "type": "array",
          "items": { "type": "string", "minLength": 1, "maxLength": 128 },
          "minItems": 1,
          "maxItems": 50,
          "uniqueItems": true
        },
        "analysis_scale": {
          "type": "string",
          "enum": ["street", "block", "district", "city", "custom"],
          "default": "district"
        }
      },
      "allOf": [
        {
          "if": { "properties": { "geometry_source": { "const": "viewport" } } },
          "then": { "required": ["viewport"] }
        },
        {
          "if": { "properties": { "geometry_source": { "const": "polygon" } } },
          "then": { "required": ["polygon"] }
        },
        {
          "if": { "properties": { "geometry_source": { "const": "circle" } } },
          "then": { "required": ["circle"] }
        },
        {
          "if": { "properties": { "geometry_source": { "const": "regions" } } },
          "then": { "required": ["region_ids"] }
        }
      ]
    },
    "entities": {
      "type": "object",
      "additionalProperties": false,
      "required": ["categories"],
      "properties": {
        "anchor": {
          "type": ["object", "null"],
          "additionalProperties": false,
          "required": ["name", "resolve_required"],
          "properties": {
            "name": { "type": "string", "minLength": 1, "maxLength": 200 },
            "gate": { "type": ["string", "null"], "maxLength": 100 },
            "direction_hint": {
              "type": ["string", "null"],
              "enum": ["north", "south", "east", "west", "nearby", null]
            },
            "resolve_required": { "type": "boolean" }
          }
        },
        "categories": {
          "type": "array",
          "items": { "type": "string", "minLength": 1, "maxLength": 100 },
          "maxItems": 100,
          "uniqueItems": true
        },
        "category_mode": {
          "type": "string",
          "enum": ["ui_selected", "planner_inferred", "all"],
          "default": "planner_inferred"
        },
        "semantic_query": {
          "type": ["string", "null"],
          "maxLength": 500
        },
        "keywords": {
          "type": "array",
          "items": { "type": "string", "minLength": 1, "maxLength": 64 },
          "maxItems": 50,
          "uniqueItems": true
        }
      }
    },
    "constraints": {
      "type": "object",
      "additionalProperties": false,
      "required": ["result_limit", "latency_budget_ms"],
      "properties": {
        "rating_min": { "type": ["number", "null"], "minimum": 0, "maximum": 5 },
        "rating_max": { "type": ["number", "null"], "minimum": 0, "maximum": 5 },
        "distance_max_m": { "type": ["integer", "null"], "minimum": 10, "maximum": 100000 },
        "direction": {
          "type": "string",
          "enum": ["none", "north", "south", "east", "west"]
        },
        "open_now": { "type": ["boolean", "null"] },
        "result_limit": { "type": "integer", "minimum": 1, "maximum": 5000 },
        "latency_budget_ms": { "type": "integer", "minimum": 300, "maximum": 120000 },
        "token_budget": { "type": ["integer", "null"], "minimum": 100, "maximum": 32000 },
        "max_region_outputs": { "type": "integer", "minimum": 1, "maximum": 200, "default": 30 }
      }
    },
    "operators": {
      "type": "array",
      "minItems": 0,
      "maxItems": 30,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "type", "enabled"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$"
          },
          "type": {
            "type": "string",
            "enum": [
              "resolve_anchor",
              "fetch_candidates",
              "filter_constraints",
              "aggregate_h3",
              "cluster_hdbscan",
              "region_compare",
              "graph_reasoning",
              "counterfactual_eval",
              "visual_review",
              "self_validate",
              "name_audit",
              "rank_candidates",
              "compose_summary"
            ]
          },
          "depends_on": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$"
            },
            "maxItems": 20,
            "uniqueItems": true
          },
          "params": {
            "type": "object",
            "additionalProperties": true
          },
          "enabled": { "type": "boolean" },
          "critical": { "type": "boolean", "default": false }
        }
      }
    },
    "output_contract": {
      "type": "object",
      "additionalProperties": false,
      "required": ["required_fields", "max_items", "include_evidence_refs"],
      "properties": {
        "required_fields": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "pois",
              "boundary",
              "spatial_clusters",
              "region_analyses",
              "comparison",
              "graph_analysis",
              "stats",
              "evidence_refs",
              "diagnostics"
            ]
          },
          "minItems": 1,
          "maxItems": 20,
          "uniqueItems": true
        },
        "max_items": { "type": "integer", "minimum": 1, "maximum": 1000 },
        "include_evidence_refs": { "type": "boolean" },
        "include_writer_text": { "type": "boolean", "default": false }
      }
    },
    "uncertainty": {
      "type": "object",
      "additionalProperties": false,
      "required": ["planner_confidence", "risk_level", "clarification"],
      "properties": {
        "planner_confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "risk_level": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
        "ambiguities": {
          "type": "array",
          "items": { "type": "string", "maxLength": 200 },
          "maxItems": 20
        },
        "clarification": {
          "type": "object",
          "additionalProperties": false,
          "required": ["required", "question"],
          "properties": {
            "required": { "type": "boolean" },
            "question": { "type": ["string", "null"], "maxLength": 300 },
            "options": {
              "type": "array",
              "items": { "type": "string", "maxLength": 100 },
              "maxItems": 8
            }
          }
        }
      }
    },
    "policy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "cacheable",
        "cache_key_profile",
        "execution_profile",
        "budget_tier",
        "allow_visual_review",
        "allow_reasoning"
      ],
      "properties": {
        "cacheable": { "type": "boolean" },
        "cache_key_profile": {
          "type": "string",
          "enum": ["strict", "semantic", "execute_semantic_v2", "no_cache"]
        },
        "execution_profile": {
          "type": "string",
          "enum": ["core", "advanced", "shadow"]
        },
        "budget_tier": {
          "type": "string",
          "enum": ["realtime", "interactive", "deep"]
        },
        "allow_visual_review": { "type": "boolean" },
        "allow_reasoning": { "type": "boolean" },
        "allow_self_validation": { "type": "boolean", "default": true },
        "allow_name_audit": { "type": "boolean", "default": true }
      }
    },
    "routing": {
      "type": "object",
      "additionalProperties": false,
      "required": ["complexity_score"],
      "properties": {
        "complexity_score": { "type": "integer", "minimum": 0, "maximum": 10 },
        "planner_model_tier": { "type": "string", "enum": ["rule", "small", "medium", "frontier"] },
        "critic_enabled": { "type": "boolean", "default": false }
      }
    }
  }
}
```

## 3.3 Schema 之外的语义校验规则（必须实现）

以下规则不适合仅靠 JSON Schema 表达，需在 Validator 中做二次校验：

1. `operators` 必须是 DAG
- `depends_on` 必须引用已存在 `id`
- 不允许环依赖

2. `query_type` 约束
- `region_comparison`: `scope.region_ids` 至少 2 个
- `counterfactual`: 必须包含 `counterfactual_eval` 算子
- `graph_reasoning`: 必须包含 `graph_reasoning` 算子

3. 预算一致性
- `constraints.latency_budget_ms` 与 `policy.budget_tier` 必须匹配
- `realtime <= 1500ms`, `interactive <= 5000ms`, `deep <= 12000ms`（可按部署调整）

4. 文本链路约束
- 当 `task.need_text_answer=false` 时，`output_contract.include_writer_text` 必须为 `false`

5. 风险约束
- `uncertainty.risk_level in [high, critical]` 时，`routing.critic_enabled` 必须为 `true`

6. 缓存约束
- `policy.cache_key_profile=no_cache` 时，`policy.cacheable` 必须为 `false`

---

## 4. 模型路由决策体系（项目专用）

## 4.1 路由输入维度

1. `query_type`
2. `complexity_score`（0-10）
3. `budget_tier`（`realtime/interactive/deep`）
4. `risk_level`（`low/medium/high/critical`）
5. 是否需要视觉审查（`allow_visual_review`）
6. 是否需要图推理/反事实（`allow_reasoning`）

## 4.2 复杂度评分规则（建议）

初始分 `0`，命中项累计：
- 多区域比较（`region_ids >= 2`）: +2
- 反事实任务: +2
- 图推理任务: +2
- 约束项数量 `>= 3`: +1
- 同时存在微观 + 宏观意图冲突: +1
- 需要视觉审查: +1
- 需要自验证: +1

分档：
- `0-1`: 低复杂
- `2-3`: 中复杂
- `4-6`: 高复杂
- `7-10`: 极高复杂

## 4.3 模型池分层（与现有项目兼容）

1. `rule`
- 非模型；纯规则/词典/模板

2. `small`（<=2B）
- 示例: `qwen3.5-4b`（本地）
- 用途: 轻量抽象、低风险补全、快响应

3. `medium`（7B~14B）
- 示例: 本地 7B/14B 指令模型（可配置）
- 用途: 正常复杂规划、约束整合

4. `frontier`
- 示例: 云端高性能模型（当前项目可映射 `glm-4.5-air`）
- 用途: 高风险、多目标权衡、反事实决策

5. `vision`
- 示例: `qwen3.5-4b`
- 用途: 视觉锚点/OCR/版面语义

## 4.4 路由决策表（核心）

| query_type | complexity_score | budget_tier | risk_level | Planner tier | Critic | Visual | Reasoning | Writer 默认 |
|---|---:|---|---|---|---|---|---|---|
| `poi_search` | 0-1 | realtime | low/medium | `rule` | no | no | no | off |
| `poi_search` | 2-3 | interactive | medium | `small` | no | conditional | no | brief |
| `area_analysis` | 2-3 | interactive | medium | `medium` | optional | conditional | optional | brief |
| `area_analysis` | 4-6 | deep | high | `frontier` | yes | yes | yes | standard |
| `region_comparison` | 3-5 | deep | high | `frontier` | yes | optional | yes | standard |
| `graph_reasoning` | 3-6 | deep | high | `frontier` | yes | optional | yes (must) | standard |
| `site_selection` | 4-7 | deep | high/critical | `frontier` | yes (must) | yes | yes | detailed |
| `counterfactual` | 4-8 | deep | high/critical | `frontier` | yes (must) | optional | yes (must) | detailed |
| `general_qa` | 0-2 | realtime | low | `rule/small` | no | no | no | brief |
| `irrelevant_input` | 0 | realtime | low | `rule` | no | no | no | preset |

## 4.5 预算分层规则

1. `realtime`（面向即时交互）
- 总预算目标: `<= 1500ms`
- 禁止重模型并发、禁止长 Writer

2. `interactive`（普通分析）
- 总预算目标: `<= 5000ms`
- 允许单路视觉或轻量推理

3. `deep`（深度策略分析）
- 总预算目标: `<= 12000ms`
- 允许 `visual + reasoning + self_validate`

## 4.6 风险触发规则

1. `risk_level=high/critical` 时：
- 强制 `critic_enabled=true`
- 强制输出 `evidence_refs`
- 强制包含 `uncertainty.ambiguities`

2. `critical` 时：
- 若 `planner_confidence < 0.7`，必须进入澄清流程，不可直接执行

---

## 5. 路由算法（伪代码）

```text
if hard_block(query):
  return preset_irrelevant

if fast_path_hit(query, context):
  return plan(rule)

score = complexity_score(query, context, constraints)
risk = risk_level(task, user_intent, domain_policy)
budget = budget_tier(latency_budget_ms, task_type)

planner_tier = route_planner(query_type, score, budget, risk)
plan = planner_model(planner_tier).generate_dsl(...)

validate_schema(plan)
validate_semantics(plan)

if risk in [high, critical]:
  plan = critic_model.review(plan)
  validate_schema(plan)
  validate_semantics(plan)

if plan.uncertainty.clarification.required:
  return ask_one_clarification(plan.uncertainty.clarification)

result = execute(plan)

if plan.task.need_text_answer:
  text = writer(result, style=plan.task.answer_style)
  return { result, text }
else:
  return { result }
```

---

## 6. 与当前代码的映射建议

## 6.1 Planner 层

- 当前入口: `fastify-backend/routes/ai/planner.js`
- 建议新增:
  - `buildDslFromIntent(intent, context, options)`
  - `validateDsl(schema + semantics)`
  - 返回从 `queryPlan` 升级为 `dsl`

## 6.2 Executor 层

- 当前入口: `fastify-backend/services/spatialJobRunner.js`
- 建议调整:
  - `computeSpatialWithFallback` 入参从 `queryPlan` 兼容 `dsl`
  - `operators` 映射为 Python pipeline flags
  - 强制记录 `evidence_refs`

## 6.3 Writer 层

- 当前入口: `fastify-backend/routes/ai/writer.js`
- 建议:
  - 仅在 `need_text_answer=true` 时触发
  - `realtime` 默认 `writerQuality=fast`
  - 明确从 `result + evidence_refs` 生成文本，不读取原始大对象

## 6.4 前端层

- 当前入口: `src/components/AiChat.vue`, `src/utils/aiService.js`
- 建议:
  - 默认走结构化通道（`plan->execute`）并先渲染结构化结果
  - 用户点击“解释/报告”再触发 writer 通道
  - Python直查模式时不上传大体积 `poiFeatures`

---

## 7. 实施顺序（推荐）

1. Phase A（1-2 周）
- 引入 DSL Schema + Validator
- Planner 输出 DSL（保留 queryPlan 兼容字段）

2. Phase B（1 周）
- Executor 兼容 DSL，按 `operators` 执行
- 添加语义校验失败的错误码与诊断

3. Phase C（1 周）
- 模型路由器上线（先仅切 Planner）
- Writer 改按需触发

4. Phase D（1-2 周）
- Critic 流程 + 反事实算子
- 证据引用质量门禁

5. Phase E（持续）
- A/B 与 KPI 门禁
- 按 `P95` 与成功率滚动调参

---

## 8. 验收指标（必须量化）

1. `Plan Valid Rate >= 99%`
- DSL 通过 schema + semantics

2. `Execute Success Rate >= 98%`
- DSL 可执行率

3. `Evidence Coverage >= 95%`
- 输出结论中可溯源证据覆盖率

4. `Clarification Efficiency`
- 平均澄清轮次 <= 1.3

5. `P95 Latency`（分通道）
- 参数通道 `<= 1800ms`
- 解释通道 `<= 8200ms`

6. `Cost / Successful Task`
- 成功任务成本持续下降（按周追踪）

---

## 9. 示例 DSL（最小可执行）

```json
{
  "dsl_version": "spatial_query_v1",
  "trace_id": "req_20260302_001",
  "task": {
    "query_type": "area_analysis",
    "goal": "评估当前选区的主导业态与热点并给出补点建议",
    "need_text_answer": false,
    "answer_style": "none",
    "priority": "normal"
  },
  "scope": {
    "geometry_source": "regions",
    "region_ids": ["region_a", "region_b"],
    "analysis_scale": "district"
  },
  "entities": {
    "anchor": null,
    "categories": ["餐饮", "咖啡", "便利店"],
    "category_mode": "ui_selected",
    "semantic_query": "高活力但供给不足的生活服务点",
    "keywords": ["热点", "补点", "可达性"]
  },
  "constraints": {
    "rating_min": 3.5,
    "rating_max": null,
    "distance_max_m": 3000,
    "direction": "none",
    "open_now": null,
    "result_limit": 800,
    "latency_budget_ms": 5000,
    "token_budget": 2000,
    "max_region_outputs": 40
  },
  "operators": [
    {
      "id": "op_fetch",
      "type": "fetch_candidates",
      "depends_on": [],
      "params": { "limit": 5000 },
      "enabled": true,
      "critical": true
    },
    {
      "id": "op_cluster",
      "type": "cluster_hdbscan",
      "depends_on": ["op_fetch"],
      "params": { "max_points": 2500 },
      "enabled": true,
      "critical": false
    },
    {
      "id": "op_rank",
      "type": "rank_candidates",
      "depends_on": ["op_fetch", "op_cluster"],
      "params": { "objective": ["demand_supply_gap", "accessibility"] },
      "enabled": true,
      "critical": true
    }
  ],
  "output_contract": {
    "required_fields": ["pois", "spatial_clusters", "stats", "evidence_refs"],
    "max_items": 50,
    "include_evidence_refs": true,
    "include_writer_text": false
  },
  "uncertainty": {
    "planner_confidence": 0.82,
    "risk_level": "medium",
    "ambiguities": [],
    "clarification": {
      "required": false,
      "question": null,
      "options": []
    }
  },
  "policy": {
    "cacheable": true,
    "cache_key_profile": "execute_semantic_v2",
    "execution_profile": "advanced",
    "budget_tier": "interactive",
    "allow_visual_review": false,
    "allow_reasoning": true,
    "allow_self_validation": true,
    "allow_name_audit": true
  },
  "routing": {
    "complexity_score": 3,
    "planner_model_tier": "medium",
    "critic_enabled": false
  }
}
```

---

## 10. 结论

你不需要否定现有架构。  
你需要的是“职责重排”：

1. 抽参与快路径继续保留（这本来就该低成本）
2. 前沿 LLM 用在 DSL 规划、冲突约束、反事实、风险裁决
3. Writer 从“核心链路”降为“可选渲染层”

这样才能真正把前沿 LLM 的价值转化为 SpatialRAG-WebGIS 的业务价值，而不是只提升对话“聪明感”。

