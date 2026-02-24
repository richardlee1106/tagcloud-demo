<<<<<<< HEAD
﻿# GIS Agent 代码审阅与改进清单（2026-02-24）

## 审阅范围
- 前端联动链路：`src/components/AiChat.vue`、`src/components/MapContainer.vue`、`src/components/SpatialEvidenceCard.vue`、`src/components/EmbeddedTagCloud.vue`
- 证据归一化与事件透传：`src/utils/refinedResultEvidence.js`
- 标签抽取策略：`src/utils/placeTagExtractor.js`

## 已修复（本轮）
1. 高优先级：地图拖动卡顿
- 问题：Deck 图层在视图中心变化时按帧重建，拖动时频繁 `setProps({layers})`，导致掉帧。
- 修复：拆分为“视图同步”和“图层刷新”两条调度链，中心移动仅更新视图，图层刷新按需触发。
- 位置：`src/components/MapContainer.vue`

2. 高优先级：Tip 气泡越界且与矢量面不同步
- 问题：旧实现采用像素锚点，一旦地图平移会漂移；边缘处会超出容器。
- 修复：改为坐标锚定（支持要素几何中心），并在每次视图变化时重算像素位置；加入边界钳制与上下翻转策略。
- 位置：`src/components/MapContainer.vue`

3. 中高优先级：AI 证据面板模板过少，无法覆盖不同意图
- 问题：证据呈现长期依赖固定的“高活力/主导业态”，缺少意图适配。
- 修复：重构为意图驱动模板卡，自动选择 1-3 个信息聚合组件（宏观/微观/对比）。
- 位置：`src/components/SpatialEvidenceCard.vue`

4. 中优先级：地名标签云弱相关噪声高
- 问题：直接截取 POI 前 K 条，缺少弱相关词过滤、别名归并与语义加权。
- 修复：新增 `placeTagExtractor`，支持弱词过滤、别名去重、频次与语义权重融合。
- 位置：`src/utils/placeTagExtractor.js`、`src/components/EmbeddedTagCloud.vue`

5. 中优先级：意图元信息在前端链路中未充分利用
- 问题：前端未系统读取 refined_result 中 `query_plan` / `query_type` / `intent_mode`。
- 修复：补充归一化解析，并回灌到消息对象用于模板与标签云模式选择。
- 位置：`src/utils/refinedResultEvidence.js`、`src/components/AiChat.vue`

## 仍建议继续优化（未在本轮实施）
1. 架构级：`AiChat.vue` 体量过大（流式协议解析、UI 渲染、消息状态、地图联动全部耦合）
- 风险：维护成本高，回归面大，测试难覆盖。
- 建议：拆分为 composables：`useChatStream`、`useIntentMeta`、`useMapLinkActions`。

2. 架构级：`MapContainer.vue` 为超大单体组件
- 风险：地图渲染、图层管理、交互事件、证据绘制、截图采集、投影换算混杂。
- 建议：抽离 `useDeckBridge`、`usePopupAnchor`、`useEvidenceLayer`、`useProjection`。

3. 性能级：前端 vendor 包体积偏大
- 现象：`vendor-element-plus`、`vendor-deckgl`、`vendor-three` 体积高。
- 建议：按路由和场景懒加载，Narrative 专属依赖拆 chunk，必要时引入预编译 icon 集。

4. 协议级：SSE 事件 schema 弱约束
- 风险：字段漂移后前后端靠“兼容写法”兜底，隐患累积。
- 建议：定义统一 schema（zod/jsonschema）并在前后端双向校验。

5. 算法级：标签抽取策略仍是规则主导
- 风险：跨城市和多语言场景泛化有限。
- 建议：引入轻量 reranker（语义相关度+地理上下文）作为第二阶段重排。

## 回归验证记录
- `npm run test` 通过（12/12）
- `npm run build` 通过（vite 生产构建成功）
=======
# GIS Agent 代码审阅（2026-02-24）

## 验证快照

- `npm run build` 已通过
- `npm run test` 已通过（6 个测试文件、15 个测试用例）
- 近期已完成的关键拆分：
  - `MapContainer` 拆分为 `useProjection`、`usePopupAnchor`、`useDeckBridge`、`useEvidenceLayer`
  - `AiChat` 拆分出 `useAiStreamDispatcher`、`useSpatialRequestBuilder`

## 高优先级问题

1. `MainLayout.vue` 仍是超大单体
- 现状：文件体量极大，承载地图编排、面板联动、导入流程与选区生命周期等多类职责。
- 风险：局部变更容易触发跨功能回归，联调和回归成本高。
- 建议：按领域继续拆分为选择域、AI 编排、导入流程、Narrative 入口四类子域，并把跨面板状态迁移到独立 store/service。

2. `AiChat.vue` 职责依旧偏重
- 现状：虽有 composable 拆分，但仍承担流式渲染、上下文构建、消息展示与交互动画。
- 风险：可维护性与迭代速度受限。
- 建议：继续下沉为 `useStreamRenderer`、`useMessageViewModel`、`useSnapshotCapture` 等可测试模块，组件保留“视图壳 + 调度”。

3. 前端 Vendor 体积仍偏大
- 现状：`vendor-element-plus`、`vendor-deckgl`、`vendor-narrative-three` 体积较大。
- 风险：首屏解析压力与弱网场景体验受影响。
- 建议：继续按路由与场景懒加载，收敛 Element Plus 全量引入，CI 增加 chunk 预算守门。

## 中优先级问题

4. SSE 事件契约虽已落地，但“未知事件”仍偏宽松
- 现状：前后端已引入 schema 校验，但兼容路径较多。
- 风险：字段漂移可能被兼容分支掩盖。
- 建议：生产环境启用严格模式；关键事件统一携带 `schema_version` 并纳入监控。

5. `schema_error` 缺少统一可视化诊断闭环
- 现状：前端可接收警告但缺乏统一展示区。
- 风险：联调时定位效率低。
- 建议：在 AI 面板增加“数据契约告警”区，并接入遥测链路。

6. 标签重排仍在前端主导
- 现状：`src/utils/tagExtraction.js` 已实现二阶段排序与语义/地理权重。
- 风险：多端结果一致性与复现性不足。
- 建议：逐步后端化标签重排，前端保留 fallback；API 返回 `scoreBreakdown` 以增强可解释性。

## 低优先级问题

7. Pipeline 相关样式仍有重复与覆盖复杂
- 建议：抽离为独立样式模块，降低后续样式回归概率。

8. 缺少自动化体积守门
- 建议：CI 增加入口路由与关键 vendor chunk 预算阈值，超限即失败。

## 下一步建议

1. 优先拆分 `MainLayout` 状态编排职责（先状态、后视图）。
2. 继续下沉 `AiChat` 逻辑至 composable，并补充单测覆盖。
3. 对 SSE schema 启用严格模式与版本化字段。
4. 推进标签重排后端化，前端保留兜底。
>>>>>>> 2152efd (优化前端性能，checkpoint v5)
