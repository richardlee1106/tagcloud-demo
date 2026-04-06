# spatial_core

`spatial_core` 是 planner-facing 的稳定空间能力接入层。

当前 B2 只提供接口骨架：

- `defaultHandlers.js`
- `toolSchemas.js`
- `toolCatalog.js`
- `toolRunner.js`

这些文件定义：

- planner 可以调用哪些 tool
- 每个 tool 的 planner-facing 输入/输出契约
- 阶段 C 以后 `planExecutor` 将如何统一调度 tool handler
- `defaultHandlers.js` 当前已接上 3 个最小真实 handler：
  - `resolve_anchor`
  - `search_nearby_pois`
  - `macro_cell_analysis`

其余 handler 仍保持骨架状态，后续阶段继续补齐。
