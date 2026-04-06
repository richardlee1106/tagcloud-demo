# planner_line

`planner_line` 是面向未来 Geo RAG 查询规划器的契约层目录。

当前 B1 只提供：

- `plannerService.js`：查询规划服务（模型输出 + legacy fallback）
- `planExecutor.js`：单轮步骤执行器（顺序执行、$ref 解析、基础 condition）
- `answerSynthesis.js`：基于 evidence bundle 的答案综合
- `evidenceBundle.js`：单轮执行结果到 evidence bundle 的最小组装
- `plannerRunner.js`：将 planning / execution / synthesis 串成单轮运行入口
- `plannerRouteService.js`：更接近 HTTP 主路由输入形态的 demo service
- `plannerSchema.js`：plan 结构和允许的 tool 名称
- `plannerPrompts.js`：planner 的 system prompt 与 few-shot 骨架
- `plannerOutputValidator.js`：模型输出的 JSON 提取、校验与 repair prompt 骨架
- `plannerHarness.js`：实际试跑 harness（query -> LLM -> output validator -> summary）
- `plannerTypes.js`：共享常量和约束
- `planValidator.js`：plan 合法性校验
- `evidenceBundleSchema.js`：evidence bundle 结构约束

本阶段不接管现有执行链路，也不直接改动 `rules_line`。

## B1 Known Limits

- `condition` 目前只是预留字段。
- B1 只校验：
  - `condition` 必须是 `null` 或字符串
  - 其中出现的 `$ref:step_id.field` 不能指向未知步骤或未来步骤
- 完整的条件表达式语法、AST 解析和执行语义留到阶段 D 再实现。
