# V2 智能体实施路线

> 日期：2026-03-09  
> 范围：`V2-Agent-backend`

## 当前实现状态（2026-03-09）

- 路线中的 Phase 1 ~ Phase 4 关键代码已全部落地。
- Objective rollout 已从最初单点放行推进到 6 个核心 objective 全部走 new agent path。
- 真实 PostGIS grounding 已接入，默认查询 `public.pois`，并保留 sample fallback。
- `report-live-summary` 与 `verify-final` 已接入 evidence / evaluator / performance baseline / grounding check 链路。
- 后文保留的是路线设计视角，实际状态以代码与新增阶段文档为准。

## 1. 路线目标

本路线文件用于说明：

- V2 如何从当前状态平滑演进
- 哪些能力优先做
- 如何保证在架构升级过程中不丢失 V1 的职能覆盖
- 如何在本地测试和联调阶段维持清晰的 rollout 边界

## 2. 第一优先场景

最优先打透的场景是：

`请在 30 秒内给我这片区的关键结论：主导业态、活力热点、最值得关注的机会点。`

原因：

- 最能体现 V2 与 V1 的架构差异
- 最能验证主动 grounding 是否成立
- 最容易沉淀成可复用的快评模板与智能体协作流程
- 最适合作为本地 rollout allowlist 的第一个 objective

## 3. 标准执行链路

### 3.1 Fast Lane

1. `Task Orchestrator Agent` 接收请求
2. `Intent Router Agent` 输出 objective routing output
3. 编排器先做 objective allowlist 判断
4. 若 objective 不在 allowlist，则直接进入 legacy 兼容路径
5. 若 objective 在 allowlist，编排器生成 `objective contract`
6. `Data Grounding Agent` 主动查询 PostGIS
7. 并行执行：
   - `Dominant Industry Agent`
   - `Hotspot Agent`
   - `Opportunity Agent`
8. `Narrative Writer Agent` 合成快评
9. `Quality Guard Agent` 进行质量裁决
10. 若裁决为 `handoff_legacy`，则不继续承诺 deep lane
11. 输出 `fast.result`

### 3.2 Deep Lane

1. 只有在以下条件同时满足时才进入 deep lane：
   - objective 命中 allowlist
   - `Quality Guard` 未裁决为 `handoff_legacy`
   - fast 结果已形成可展示快照
2. 在 `fast.result` 之后异步启动更深分析
3. 进行更细热点解释、机会点验证、基线对照
4. 如果任务需要导出，再走 artifact 路线
5. 输出 `deep.accepted`
6. 如有中间增量，则输出 `deep.patch`
7. 最终输出 `deep.final` 或 `deep.failed`

## 4. 本地 rollout 规则

本路线只定义本地测试与联调阶段的 rollout，不定义生产灰度。

### 4.1 默认 allowlist

| objective | 默认路径 | 状态 |
|---|---|---|
| `area_briefing` | new agent path | 默认放行 |
| `hotspot_analysis` | legacy path | 待补完整契约 |
| `opportunity_discovery` | legacy path | 待补完整契约 |
| `compare_analysis` | legacy path | 待补 compare/fallback 规则 |
| `buffer_export_workflow` | legacy path | 待补 artifact contract |
| `coverage_gap_analysis` | legacy path | 待补专属 grounding 规则 |

### 4.2 fallback 触发条件

以下任一条件成立时，编排器必须 fallback 到 legacy 兼容路径：

- objective 不在 allowlist
- 当前 objective 尚未完成能力对齐
- grounding 无法满足最小数据充分性且没有合法降级结果
- `Quality Guard` 裁决为 `handoff_legacy`

## 5. V1 / V2 能力对齐矩阵

| 业务能力 | V1 | V2 目标 |
|---|---|---|
| 当前片区分析 | yes | yes |
| POI 类别概览 | yes | yes |
| 热点识别与解释 | yes | yes |
| 缓冲、合并、导出 | yes | yes |
| 区域对比 | yes | yes |
| 叙事化回答 | yes | yes |
| 主动 PostGIS grounding | limited | required |
| 自主任务拆解 | no | required |
| 多智能体并行 | no | required |
| 回答质量守卫 | weak | required |

这张矩阵的含义是：

- 架构可以升级
- 职能不能缩水
- rollout 只能在能力闭环后逐个 objective 放行

## 6. 非功能目标

### 6.1 响应时延

- 首个有效结论：`<= 3s`
- 30 秒快评完成：`<= 30s`

### 6.2 稳定性

- Deep lane 失败不能拖垮 fast lane
- grounding 失败时必须有降级与说明
- 异常时必须有 trace 与 incident 线索

### 6.3 可解释性

- 每个强结论都应尽量有证据来源
- 无数据必须有明确的检索路径说明

### 6.4 契约稳定性

- SSE 事件顺序必须合法
- `/api/v2/jobs/:jobId` 快照必须与 SSE 终态一致
- 非 artifact 任务误报 artifact 为 `0`

## 7. 关键 ADR

### ADR-001：V2 必须与 V1 能力对齐

决策：

- V2 在业务覆盖上不允许低于 V1。

### ADR-002：标准片区分析问题必须先走 PostGIS grounding

决策：

- 片区快评、热点分析、机会点发现等问题必须先查数据库。

### ADR-003：优先采用“固定职责的专业智能体集”

决策：

- 初期不做无限扩张的 swarm，而是做 5~8 个稳定角色的 agent 集。

### ADR-004：洞察任务与导出任务分开处理

决策：

- 不再默认把所有成功回答都描述成“GeoJSON 文件可用”。

### ADR-005：本地 rollout 采用 objective allowlist + legacy fallback

决策：

- 本地测试和联调阶段，新路径只对 allowlist objective 默认放行。
- 非白名单 objective 必须走 legacy 兼容路径。
- `Quality Guard` 可以裁决 `handoff_legacy`。

### ADR-006：对外契约保持增量兼容，内部实现可逐步替换

决策：

- 对外保持现有路径、事件名和 job 主字段不变。
- 内部可逐步从 template/DSL 驱动收敛到 objective contract 驱动。
- 文档优先补齐契约，再推动内部实现替换。

## 8. 风险与缓解

| 风险 | 描述 | 缓解措施 |
|---|---|---|
| 选错智能体 | 路由不准导致结果偏题 | 强化 objective contract 和离线评测 |
| 数据稀疏误判 | 太早判无数据 | 执行无数据判定阶梯 |
| 编排过重 | 新架构反而更慢 | 控制 agent 数量、并行执行、缓存 grounding |
| 语义输出混乱 | artifact 任务和 insight 任务混用 | 分离 SSE、job、artifact 契约 |
| 职能缺失 | 升级期间某些 V1 功能失效 | 维持 V1/V2 能力对齐矩阵和回归用例 |
| 契约漂移 | 文档 schema、SSE 事件、job 快照三者定义不一致 | 统一在模块与契约文档维护单一来源定义 |

## 9. 分阶段路线建议

### Phase 1：片区快评闭环

目标：

- 先把“30 秒片区快评”做成 V2 的旗舰能力

交付：

- 编排器原型
- objective contract
- grounding result contract
- specialist result contract
- quality decision contract
- SSE event contracts
- `/api/v2/jobs/:jobId` snapshot contract
- Data Grounding Agent
- 主导业态 / 热点 / 机会点智能体
- Narrative Writer Agent
- Quality Guard Agent

### Phase 2：V1 能力全量追平

目标：

- 保证 V2 可以完整替代 V1 的核心业务路径

交付：

- Compare Agent
- Buffer-Coverage Agent
- 导出型 artifact 流程
- V1/V2 能力对齐回归清单
- objective rollout matrix
- fallback matrix
- 新路径 / legacy 路径对照表

### Phase 3：证据与评估体系强化

目标：

- 让 V2 不只是“能答”，而是“答得稳”

交付：

- 统一 evidence contract
- 数据充分性评估
- agent 路由评测集
- 无数据场景评测集
- evidence / quality decision 评测规范

### Phase 4：学习与自适应优化

目标：

- 基于真实请求逐步优化时延、路由与答案质量

交付：

- 行为日志学习
- routing 调优
- 缓存优化
- adaptive execution policy

## 10. 路线结论

V2 的演进路径应当遵循：

- 先打透一个旗舰场景
- 先补齐文档契约，再替换实现
- 再完成 V1 能力对齐
- 再做证据与评估体系
- 最后再引入更高级的自适应能力

这样可以保证：

- 架构升级有明确收益
- rollout 边界清楚
- 契约演进不脱离当前接口现实
- 每个阶段都有清晰交付物和验收标准
