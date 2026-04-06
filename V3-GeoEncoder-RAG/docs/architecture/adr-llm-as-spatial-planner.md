# ADR: LLM As Spatial Planner

- Status: Accepted
- Date: 2026-03-28

## Context

V3 正在从 `rules_line` 驱动的空间问答后端，迁移到 `planner_line` 驱动的 Geo RAG 前台。阶段 A 和阶段 B1/B2 已经完成：

- `rules_line` 已经被明确标注为旧线路
- `planner_line` 已经拥有稳定的 plan schema、validator、prompt、output validator 与 harness
- `spatial_core` 已经拥有 planner-facing 的 tool catalog / tool schema / tool runner 骨架

当前的关键风险不在于“planner 能否输出 plan”，而在于后续阶段 C/B3 是否会把新主线重新接回旧后端。

尤其需要警惕这种错误路线：

`planner_line -> spatial_core -> rules_line orchestrator`

如果 `spatial_core` 只是把旧 `rules_line` 的任务编排整块包起来，那么：

1. LLM 仍然没有真正拿到查询决策权
2. `rules_line` 的 task-specific 判断会重新成为实际主线
3. B1/B2 做的 schema 与 tool contract 只剩形式意义

这会让迁移“看起来像新架构”，但本质上仍是旧后端在替 LLM 做决策。

## Decision

采用如下边界：

1. `planner_line` 负责：
   - 结构化查询规划
   - 计划合法性校验
   - 模型输出修复

2. `spatial_core` 负责：
   - 稳定的 planner-facing 空间能力接口
   - PostGIS、POI 编码器、cell 编码器等底层能力的统一调度
   - 仅保留与任务无关的能力实现，不保留 task-specific 业务决策

3. `rules_line` 只保留：
   - 现网兼容
   - 回归基线
   - 过渡期兜底

4. 除 `spatial_core.infer_intent_legacy` 外：
   - `spatial_core` 不直接依赖 `rules_line` 的旧任务编排逻辑
   - 发现某项可复用能力仅存在于 `rules_line` 文件内时，优先抽取/下沉/包装 adapter
   - 不允许直接把旧 orchestrator 整块挂到 `spatial_core` 后面

## Consequences

### Positive

1. planner 真正掌握“怎么查”的决策权
2. `spatial_core` 能成为稳定能力层，而不是旧逻辑的别名
3. 后续阶段 C/D 的 planExecutor / answer synthesis 有明确边界
4. `rules_line` 能继续作为 baseline，而不会不断反向污染新主线

### Negative

1. 迁移速度会比“整块复用旧 orchestrator”更慢
2. 部分能力需要先做 adapter 或抽取，短期内会出现重复代码
3. B3/B4 的依赖审计成本会增加

## Follow-up

1. 在 B3 文档中逐 tool 标记：
   - 可直接接纯能力模块
   - 需要 adapter
   - 需要从 `rules_line` 抽取下沉
2. 在阶段 C 之前，不实现把 `handleSpatialQuery()` 之类的旧 orchestrator 直接注册成 `spatial_core.search_nearby_pois`
3. `infer_intent_legacy` 明确保留为唯一合法的旧线直接依赖
