# Python 迁移灰度 10% 报告

- 日期：2026-02-07
- 配置：`SPATIAL_MIGRATE_PERCENT=10`
- Ŀ꣺С֤Ǩ·ȶɻԡ

## 执行项

1. 语法检查
   - `node --check fastify-backend/services/spatialJobRunner.js`：通过
   - `node --check fastify-backend/routes/ai/index.js`：通过
   - `node --check fastify-backend/scripts/rollout_migration_check.js`：通过

2. 对比验证
   - 执行：
     - `node fastify-backend/scripts/rollout_migration_check.js --percent 10 --samples 500 --out fastify-backend/reports/rollout/phase-10.json`
   - 结果：`all_within_expected=true`
   - 输出文件：`fastify-backend/reports/rollout/phase-10.json`

3. ݿ·֤
   - 在 `executeSpatialPlanWithFallback` 路径下，验证 Node 回退与 `region_comparison` 分支均返回 `success=true`。

## 观察结论

- 在当前样本下，Postgres 查询链路与 `/api/ai/chat`、`/api/jobs/*` HTTP 调用表现稳定。
- 灰度阶段满足“可观测 + 可回退 + 可对比”的上线要求。