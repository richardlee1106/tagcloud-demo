# V2 智能体分阶段开发实施清单

> 日期：2026-03-09  
> 范围：`V2-Agent-backend`

## 当前实现状态（2026-03-09）

- Phase 1：已完成
- Phase 2：已完成
- Phase 3：已完成
- Phase 4：已完成
- 当前 `npm test` 全量通过，且已提供真实 grounding 校验脚本 `npm run grounding:check`
- 下方清单保留原始计划形态，当前完成度请以上述实现状态与代码提交为准

本文件用于直接指导研发执行，按阶段给出开发任务、交付物与验收点。

## Phase 1：片区快评 MVP

### 目标

让 V2 能正确回答：

`请在 30 秒内给我这片区的关键结论：主导业态、活力热点、最值得关注的机会点。`

### 开发清单

- [ ] 新建 `task orchestrator` 入口层
- [ ] 将现有 `analysis-service.js` 改造成 orchestrator 驱动模式
- [ ] 定义 `objective contract v1`
- [ ] 定义 `grounding result contract v1`
- [ ] 定义 `specialist result contract v1`
- [ ] 定义 `quality decision contract v1`
- [ ] 定义 SSE 事件契约
- [ ] 定义 `/jobs/:jobId` 快照契约
- [ ] 定义 `area_briefing` allowlist / fallback 规则
- [ ] 实现 `Intent Router Agent`
- [ ] 实现 `Data Grounding Agent`
- [ ] 为 grounding 补 PostGIS repository
- [ ] 实现 `Dominant Industry Agent`
- [ ] 实现 `Hotspot Agent`
- [ ] 实现 `Opportunity Agent`
- [ ] 实现 `Narrative Writer Agent`
- [ ] 实现 `Quality Guard Agent`
- [ ] 定义 `fast.result` 新结构
- [ ] 加入“无数据判定阶梯”
- [ ] 增加 30 秒快评的集成测试

### 交付物

- V2 可完成一次完整片区快评
- 回答中包含主导业态、热点、机会点三个部分
- 默认主动查 PostGIS
- 一套可执行的 objective / grounding / specialist / quality 契约
- 一套与当前接口兼容的 SSE / job snapshot 文档

### 验收标准

- [ ] 首个有效结果在 `<= 3s`
- [ ] 完整快评在 `<= 30s`
- [ ] 未查库前不会直接说“无数据”
- [ ] 返回结果不再错误承诺 artifact 文件
- [ ] 实现者仅看文档即可分辨 `fast.result`、`deep.accepted`、`deep.patch`、`deep.final` 的职责差异
- [ ] `handoff_legacy` 与 `no_data` 的触发条件有明确定义

## Phase 2：V1 能力对齐

### 目标

确保 V2 在业务能力上不低于 V1。

### 开发清单

- [ ] 梳理 V1 核心能力清单
- [ ] 建立 V1/V2 capability parity matrix
- [ ] 建立 objective rollout matrix
- [ ] 建立 fallback matrix
- [ ] 建立新路径 / legacy 路径对照表
- [ ] 实现 `Compare Agent`
- [ ] 实现 `Buffer-Coverage Agent`
- [ ] 打通 clip / buffer / merge / export 全路径
- [ ] 区分 insight 任务与 artifact 任务
- [ ] 为导出型任务补 artifact contract
- [ ] 增加 V1/V2 等价回归测试

### 交付物

- 一份完整能力对齐矩阵
- 一组 V1/V2 等价测试样例
- V2 支持全部核心空间工作流
- objective rollout matrix
- fallback matrix

### 验收标准

- [ ] V1 核心功能在 V2 均可执行
- [ ] artifact 任务有真实导出路径
- [ ] 非 artifact 任务不再出现误导性“文件可用”措辞
- [ ] 非白名单 objective 默认留在 legacy 兼容路径

## Phase 3：证据与质量体系

### 目标

让 V2 的回答不只是“能答”，而是“有证据、可追踪、可守卫”。

### 开发清单

- [ ] 统一 `evidence contract`
- [ ] 增加数据充分性评估逻辑
- [ ] 增加多智能体结果冲突检测
- [ ] 增加置信度等级
- [ ] 增加 Quality Guard 拒答 / 降级输出策略
- [ ] 增加无数据场景专项评测集
- [ ] 增加 routing 准确率评测集
- [ ] 增强 observability 与 trace 关联
- [ ] 补齐 evidence / quality decision 评测规范

### 交付物

- evidence contract
- 置信度规范
- 评测集与评测报告模板
- quality decision 评测规范

### 验收标准

- [ ] 强结论有证据来源
- [ ] 无数据结论可回溯到检索过程
- [ ] 存在冲突时能自动降级或提示不确定性
- [ ] `Quality Guard` 裁决与最终 SSE / job 输出一致

## Phase 4：性能与自适应优化

### 目标

让 V2 在真实流量下更快、更稳、更聪明。

### 开发清单

- [ ] 优化 grounding 缓存
- [ ] 优化 agent 并行调度
- [ ] 优化热点与机会点计算耗时
- [ ] 接入行为日志学习信号
- [ ] 调优 intent routing 权重
- [ ] 引入 adaptive execution policy
- [ ] 建立性能回归基线

### 交付物

- 性能基线报告
- routing 优化策略
- adaptive execution 规则

### 验收标准

- [ ] 关键场景时延较当前版本明显下降
- [ ] 路由稳定性提升
- [ ] 深度路径不会显著拖慢首轮回答

## 横向共性任务

以下任务贯穿所有阶段：

- [ ] 保持 SSE 事件契约向后兼容或可平滑迁移
- [ ] 保持作业持久化结构清晰可追踪
- [ ] 保持 incident bundle 可定位异常
- [ ] 保持文档与代码同步更新
- [ ] 每阶段补测试而非只补代码
- [ ] 每次新增 objective 前，先补 allowlist 与 fallback 条目
- [ ] 文档中的事件名、状态名、job 字段名必须与当前接口兼容或给出映射说明

## 阶段推进建议

建议实际推进顺序：

1. 先完成 Phase 1，证明 V2 的旗舰智能体场景成立
2. 再完成 Phase 2，保证 V2 可替代 V1
3. 再推进 Phase 3，提升质量和可解释性
4. 最后做 Phase 4，持续优化性能与自适应能力

## 最终验收清单

- [ ] V2 具备完整的多智能体架构入口
- [ ] V2 主动查 PostGIS，不等用户传数据
- [ ] V2 可回答 V1 能回答的问题
- [ ] V2 可以输出更快的片区快评
- [ ] V2 具备 V1 不具备的智能体协作能力
- [ ] 文档、契约、测试、回归清单齐备
- [ ] 本地 rollout allowlist 与 fallback 规则清楚
