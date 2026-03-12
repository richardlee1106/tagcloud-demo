# V2 下一代智能体架构设计文档索引

> 日期：2026-03-09  
> 范围：`V2-Agent-backend`

## 当前实现状态（2026-03-09）

- 本索引所指向的 4 份文档已不再只是方案文档，当前代码已完成对应阶段性落地。
- 建议阅读顺序仍然有效，但如需判断真实状态，应优先结合：
  - `docs/phase2-v1-v2-capability-parity-matrix.md`
  - `docs/phase2-objective-rollout-matrix.md`
  - `docs/phase2-fallback-matrix.md`
  - 仓库中的 `agents/`、`orchestrator/`、`contracts/`、`repositories/` 实现

本文档已拆分为 4 份中文子文档，便于分角色阅读、评审和实施。

## 文档目录

### 1. 架构总览

- 文件：`V2-Agent-backend/docs/2026-03-09-v2-agent-architecture-overview.md`
- 适合阅读对象：
  - 产品负责人
  - 架构设计者
  - 需要快速理解 V2 定位的人
- 主要内容：
  - 为什么 V2 必须区别于 V1
  - V2 的目标定位
  - 高层架构
  - 核心原则
  - 契约闭环
  - 决策所有权
  - 本地 rollout 边界与兼容不变式

### 2. 模块与契约设计

- 文件：`V2-Agent-backend/docs/2026-03-09-v2-agent-modules-and-contracts.md`
- 适合阅读对象：
  - 后端开发
  - 接口设计者
  - 智能体模块开发者
- 主要内容：
  - 多智能体职责划分
  - 强制 PostGIS grounding 策略
  - objective / grounding / specialist / quality 契约
  - SSE event contracts
  - job snapshot contract
  - artifact contract
  - fallback 与兼容映射

### 3. 实施路线

- 文件：`V2-Agent-backend/docs/2026-03-09-v2-agent-implementation-roadmap.md`
- 适合阅读对象：
  - 技术负责人
  - 项目经理
  - 排期和阶段验收相关人员
- 主要内容：
  - 30 秒快评标准链路
  - objective allowlist 与本地 fallback
  - V1/V2 能力对齐矩阵
  - 非功能目标
  - ADR
  - 契约验收与阶段推进策略

### 4. 分阶段开发实施清单

- 文件：`V2-Agent-backend/docs/2026-03-09-v2-agent-phased-implementation-checklist.md`
- 适合阅读对象：
  - 研发执行人员
  - 任务分解和验收人员
- 主要内容：
  - Phase 1 ~ Phase 4 的开发任务清单
  - 每阶段交付物
  - 文档先行交付物
  - 验收标准
  - 风险检查点

## 推荐阅读顺序

建议按以下顺序阅读：

1. `V2-Agent-backend/docs/2026-03-09-v2-agent-architecture-overview.md`
2. `V2-Agent-backend/docs/2026-03-09-v2-agent-modules-and-contracts.md`
3. `V2-Agent-backend/docs/2026-03-09-v2-agent-implementation-roadmap.md`
4. `V2-Agent-backend/docs/2026-03-09-v2-agent-phased-implementation-checklist.md`

若目标是实施，必须先读“模块与契约设计”中的 schema，再读“实施路线”中的 rollout / fallback 规则。

## 使用建议

- 如果你要评审方向是否正确，先看“架构总览”。
- 如果你要开始拆后端模块，优先看“模块与契约设计”。
- 如果你要安排阶段性开发，优先看“实施路线”和“分阶段开发实施清单”。
- 如果你要检查接口是否还能平滑演进，重点看模块与契约中的兼容映射和路线中的 ADR。
