# 收口2：上线硬化报告（队列健康 + 回退演练）

## 1. 本次收口目标

- 补齐 Jobs 维度的健康可观测能力。
- 提供“Python 主路径 / Node 回退”的一键演练脚本。
- ϲ䵽 READMEںŶӽ֡

## 2. 交付内容

### 2.1 健康检查接口

- 新增 `GET /api/jobs/health`
- 返回内容包含：
  - 队列模式（bullmq / memory）
  - 队列积压与失败任务指标
  - 队列阈值与告警列表
  - ռǨÿգҶȱ˫ܿءǿƻ˿أ

### 2.2 队列健康快照能力

- `services/queue.js` 新增 `getQueueHealthSnapshot()`
- 对 memory/bullmq 两种模式统一输出健康结构
- 内置阈值（可由环境变量覆盖）：
  - `SPATIAL_QUEUE_BACKLOG_WARN`（默认 200）
  - `SPATIAL_QUEUE_FAILED_WARN`（默认 20）

### 2.3 回退演练脚本

- 新增 `scripts/drill_node_fallback.js`
- 新增 npm 命令：`npm run drill:fallback`
- 脚本流程：
  1. 先执行 Python 主路径（`forceNodeFallback=false`）
  2. 再执行 Node 回退路径（`forceNodeFallback=true`）
  3. 校验 `compute_mode` 与结果结构完整性
  4. 输出 JSON/Markdown 报告

## 3. 使用方式

在 `fastify-backend` 目录执行：

```bash
npm run check:dualrun -- --samples=2 --out=reports/rollout/dual-run-latest.json
npm run drill:fallback -- --out=reports/rollout/fallback-drill-latest.json
```

健康检查：

```bash
curl http://127.0.0.1:3200/api/jobs/health
```

## 4. 验收标准（收口2）

- `/api/jobs/health` 可稳定返回，并包含 queue + migration + alerts。
- `drill:fallback` 报告中 Python 主路径与 Node 回退两条 case 均通过。
- 现有 `/api/jobs/*`、`/api/ai/chat` 兼容链路无回归。

## 5. 后续建议

- 将 `check:dualrun` 和 `drill:fallback` 接入 CI（发布前必跑）。
- 将 `/api/jobs/health` 接到监控系统，做 backlog/failure 的告警联动。
- 灰度全量后保留 Node 回退开关 1~2 周，再决定是否清理冗余分支。
