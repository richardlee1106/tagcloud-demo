# Spatial Query DSL v1 Validator 实施清单

- 日期: 2026-03-02
- 关联 Schema: `fastify-backend/schemas/spatial_query_v1.schema.json`
- 目标: 将 DSL 从“文档约定”升级为“运行时强约束”

---

## 1. 实施范围

1. 输入端校验
- 对 `Planner` 产出的 DSL 做 JSON Schema 校验 + 语义校验

2. 执行端校验
- `Executor` 在执行前做二次校验，拒绝非法计划

3. 输出端一致性校验
- 结果是否满足 `output_contract.required_fields`

4. 可观测性
- 记录校验错误类型、失败率、耗时、回退路径

---

## 2. 目录与文件建议

1. 新增目录
- `fastify-backend/schemas/`
- `fastify-backend/services/validation/`

2. 新增文件建议
- `fastify-backend/services/validation/dslSchemaLoader.js`
- `fastify-backend/services/validation/dslSemanticValidator.js`
- `fastify-backend/services/validation/dslValidator.js`
- `fastify-backend/tests/dslValidator.test.js`

3. 已完成
- `fastify-backend/schemas/spatial_query_v1.schema.json`

---

## 3. 依赖建议

当前后端依赖中没有 JSON Schema validator，建议新增：

1. 主依赖
- `ajv`
- `ajv-formats`

2. 安装命令
```bash
cd fastify-backend
npm i ajv ajv-formats
```

---

## 4. 校验流水线（必须按顺序）

1. Step A: Schema 校验
- 目标: 结构合法、字段类型合法、枚举合法、if/then 规则合法
- 失败返回:
  - `error_code=dsl_schema_invalid`
  - `details=[{path, message}]`

2. Step B: 语义校验
- 目标: 校验跨字段逻辑与业务约束
- 失败返回:
  - `error_code=dsl_semantic_invalid`
  - `details=[{rule_id, message}]`

3. Step C: 执行前策略校验
- 目标: budget、risk、模型路由安全约束
- 失败返回:
  - `error_code=dsl_policy_invalid`

4. Step D: 输出契约校验
- 目标: 输出字段满足 `output_contract.required_fields`
- 失败返回:
  - `error_code=dsl_output_contract_invalid`

---

## 5. 语义校验规则清单（第一版）

## 5.1 QueryType 规则

1. `region_comparison`
- `scope.geometry_source` 必须是 `regions`
- `scope.region_ids.length >= 2`
- `operators` 中必须包含 `region_compare`

2. `graph_reasoning`
- `operators` 中必须包含 `graph_reasoning`

3. `counterfactual`
- `operators` 中必须包含 `counterfactual_eval`

4. `clarification_needed`
- `uncertainty.clarification.required` 必须为 `true`

## 5.2 DAG 规则

1. `operators.id` 唯一
2. `depends_on` 引用必须存在
3. 不允许依赖环

## 5.3 Budget 规则

1. `policy.budget_tier=realtime`
- `constraints.latency_budget_ms <= 1500`

2. `policy.budget_tier=interactive`
- `constraints.latency_budget_ms <= 5000`

3. `policy.budget_tier=deep`
- `constraints.latency_budget_ms <= 12000`

## 5.4 Writer 规则

1. `task.need_text_answer=false`
- `output_contract.include_writer_text` 必须是 `false`

## 5.5 风险规则

1. `uncertainty.risk_level in [high, critical]`
- `routing.critic_enabled` 必须为 `true`

2. `uncertainty.risk_level=critical` 且 `planner_confidence<0.7`
- 必须进入澄清流程（`clarification.required=true`）

## 5.6 缓存规则

1. `policy.cache_key_profile=no_cache`
- `policy.cacheable` 必须是 `false`

---

## 6. 接入点（按你当前代码）

## 6.1 Planner 出口接入

文件:
- `fastify-backend/routes/ai/planner.js`

接入位置:
- `parseIntent(...)` 输出后
- 在返回 `queryPlan` 之前，构造 `dsl` 并校验

改造目标:
1. 返回结构从:
- `{ queryPlan, ... }`
2. 升级为:
- `{ dsl, queryPlan_legacy, ... }`

## 6.2 JobRunner/Executor 入口接入

文件:
- `fastify-backend/services/spatialJobRunner.js`

接入位置:
- `runNarrativeSpatialJob(...)` 在 `executor` stage 前
- `executeSpatialPlanWithFallback(...)` 入参检查处

改造目标:
1. 若入参是旧 `queryPlan`，先转换为 DSL 再校验
2. 执行链统一消费 DSL（旧字段仅兼容）

## 6.3 Writer 接入

文件:
- `fastify-backend/routes/ai/writer.js`

接入位置:
- `generateAnswer(...)` 前

规则:
1. 仅当 `task.need_text_answer=true` 或显式触发时进入 Writer
2. 默认参数通道不触发 Writer

---

## 7. 错误码与响应规范

建议统一错误码：

1. `dsl_schema_invalid`
2. `dsl_semantic_invalid`
3. `dsl_policy_invalid`
4. `dsl_output_contract_invalid`
5. `dsl_execution_blocked`

标准错误响应结构：

```json
{
  "error": "DSL validation failed",
  "error_code": "dsl_semantic_invalid",
  "trace_id": "req_xxx",
  "details": [
    {
      "rule_id": "REGION_IDS_MIN_2",
      "path": "scope.region_ids",
      "message": "region_comparison requires at least 2 region_ids"
    }
  ]
}
```

---

## 8. 观测指标与门禁

新增指标建议：

1. `dsl_validation_total{result=pass|fail, stage=schema|semantic|policy|output}`
2. `dsl_validation_duration_ms`
3. `dsl_failure_total{error_code}`
4. `dsl_fallback_total{from=dsl,to=legacy}`

门禁建议：

1. `Plan Valid Rate >= 99%`
2. `dsl_schema_invalid_rate < 0.5%`
3. `dsl_semantic_invalid_rate < 1%`
4. `P95 validation_duration_ms < 20ms`

---

## 9. 测试清单

## 9.1 单元测试

1. Schema 正例（最小可执行 DSL）
2. Schema 反例（缺字段、错误枚举、错误类型）
3. 语义正例（各 `query_type`）
4. 语义反例（region_ids不足、缺关键算子、budget不匹配）
5. DAG 反例（环依赖、depends_on 不存在）

## 9.2 集成测试

1. `/api/ai/plan` 返回 DSL + 通过校验
2. `/api/ai/execute` 对非法 DSL 正确拒绝
3. `/api/ai/chat` 在 `need_text_answer=false` 不触发 writer
4. 错误码和 `trace_id` 一致可追踪

---

## 10. 迁移策略（不破坏现网）

1. Phase 1（兼容）
- 保留旧 `queryPlan`
- 新增 `dsl` 并双写

2. Phase 2（切换）
- Executor 优先消费 DSL
- 旧 `queryPlan` 仅作 fallback

3. Phase 3（收敛）
- 逐步下线旧字段
- 文档、监控、测试全部以 DSL 为准

---

## 11. Definition of Done

以下条件同时满足才算完成：

1. Schema 文件纳入仓库并被运行时加载
2. Planner、Executor、Writer 三处接入校验链
3. 新增错误码和统一错误结构
4. 单元测试和集成测试通过
5. 观测指标上线并可在 `/api/ops/*` 侧验证
6. 兼容旧链路，不引入 Sev1/Sev2

