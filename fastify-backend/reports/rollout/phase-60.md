# Python 迁移灰度 60% 报告

- 日期：2026-02-07
- 配置：`SPATIAL_MIGRATE_PERCENT=60`
- 目标：在主流 query_type 流量上验证 Python 侧承载能力与稳定性。

## 执行项

1. 语法检查
   - `node --check fastify-backend/services/spatialJobRunner.js`：通过
   - `node --check fastify-backend/routes/ai/index.js`：通过
   - `node --check fastify-backend/scripts/rollout_migration_check.js`：通过

2. 对比验证
   - 执行：
     - `node fastify-backend/scripts/rollout_migration_check.js --percent 60 --samples 500 --out fastify-backend/reports/rollout/phase-60.json`
   - 结果：`all_within_expected=true`
   - 输出文件：`fastify-backend/reports/rollout/phase-60.json`

3. 端到端调用验证
   - `/api/ai/execute` 通过 `executeSpatialPlanWithFallback` 路径完成 Python 主执行 + Node 回退兜底验证。

## 观察结论

- 任务链路在 `/api/jobs/*` 场景下保持稳定，无明显异常抖动。