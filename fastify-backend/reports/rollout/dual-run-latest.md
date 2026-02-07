# 双跑一致性检查报告（收口1）

- 生成时间：自动以 `dual-run-latest.json` 的 `checked_at` 为准
- 检查脚本：`node fastify-backend/scripts/dual_run_parity_check.js`
- 覆盖场景：`graph_reasoning`、`region_comparison`
- 双跑策略：同一 queryPlan 分别走 Python 主路径（`forceNodeFallback=false`）与 Node 回退路径（`forceNodeFallback=true`）

## 默认判定规则

1. 两条路径都必须返回 HTTP 200
2. 两条路径都必须满足关键 schema（results/mode/stats/spatial_clusters + 对应场景字段）
3. `graph_reasoning`：两侧图节点不允许同时为 0
4. `region_comparison`：两侧有效选区数都必须 >= 2
5. 若 Python 返回 POI，则 TopK 重叠率需不低于阈值 `min_poi_overlap`（默认 0.1）

## 运行示例

```bash
node fastify-backend/scripts/dual_run_parity_check.js --samples=2 --out=fastify-backend/reports/rollout/dual-run-latest.json
```

## npm 脚本

```bash
npm --prefix fastify-backend run check:dualrun -- --samples=2 --out=reports/rollout/dual-run-latest.json
```

> 说明：建议在 `fastify-backend` 目录下执行 npm 命令，`--out` 使用相对 `fastify-backend` 的路径，避免写入到嵌套目录。
