# Python 迁移灰度 30% 报告

- 日期：2026-02-07
- 配置：`SPATIAL_MIGRATE_PERCENT=30`
- 目标：在中低流量下持续验证迁移稳定性。

## 执行项

1. 语法检查
   - `node --check fastify-backend/services/spatialJobRunner.js`：通过
   - `node --check fastify-backend/routes/ai/index.js`：通过
   - `node --check fastify-backend/scripts/rollout_migration_check.js`：通过

2. 对比验证
   - 执行：
     - `node fastify-backend/scripts/rollout_migration_check.js --percent 30 --samples 500 --out fastify-backend/reports/rollout/phase-30.json`
   - 结果：`all_within_expected=true`
   - 输出文件：`fastify-backend/reports/rollout/phase-30.json`

3. 回退通路验证
   - 在 `executeSpatialPlanWithFallback` 路径下配合 `SPATIAL_FORCE_NODE_FALLBACK=true` 进行回退演练并通过。

## 观察结论

- 当前阶段未出现 Postgres 查询异常，SQL 执行路径稳定。