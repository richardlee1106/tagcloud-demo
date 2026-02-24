# GIS Agent 代码审阅与改进清单（2026-02-24）

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
