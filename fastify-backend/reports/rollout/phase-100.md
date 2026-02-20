# Python 迁移灰度 100% 报告

- 日期：2026-02-07
- 配置：`SPATIAL_MIGRATE_PERCENT=100`
- 目标：全量由 Python 主链路承载，Node 路径仅保留回退能力。

## 执行项

1. 语法检查
   - `node --check fastify-backend/services/spatialJobRunner.js`：通过
   - `node --check fastify-backend/routes/ai/index.js`：通过
   - `node --check fastify-backend/scripts/rollout_migration_check.js`：通过

2. 对比验证
   - 执行：
     - `node fastify-backend/scripts/rollout_migration_check.js --percent 100 --samples 500 --out fastify-backend/reports/rollout/phase-100.json`
   - 结果：`all_within_expected=true`
   - 输出文件：`fastify-backend/reports/rollout/phase-100.json`

3. 强制回退演练
   - 设置 `SPATIAL_FORCE_NODE_FALLBACK=true`，验证仅启用 Node executor 的兜底流程可用。

## 观察结论

- 全量迁移后，主链路与回退链路均可用，满足上线切换与故障兜底要求。