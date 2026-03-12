# V2 GIS Agent WebGIS 交付手册（2026-03-09）

## 1. 先说结论

这份手册是给“不要逐行看代码，但要完整接手项目”的人看的。

你只需要记住三句话：

1. `V2` 已经是一套能单独运行、能做真实分析、能做 V1/V2 对比、能出报告的系统。
2. `V2` 现在最大的优势不是首响，而是总完成时间和可观测性明显优于 `V1`。
3. 现在剩下的工作已经不是“把系统做出来”，而是“继续把它打磨成更强、更稳、更全的系统”。

---

## 2. 这次交付到底交了什么

### 2.1 后端

交付了一个独立于 `V1` 的后端工程：

- 路径：`V2-Agent-backend/`
- 启动入口：
  - `V2-Agent-backend/src/server.js`
  - `V2-Agent-backend/src/app.js`

### 2.2 Python 工具平面

交付了一个最小但真实可用的 `Python tool plane`：

- 路径：`V2-Agent-backend/tool-plane-py/`
- 启动入口：
  - `V2-Agent-backend/tool-plane-py/app.py`

### 2.3 前端接入

前端已经能切换：

- `V1架构`
- `V2 Agent架构`

并且在 `V2` 模式下，支持：

- `async_deep`
- 轮询 `/api/v2/jobs/:jobId`
- 消费 `deep.patch / deep.final`

### 2.4 运维与报告

交付了完整的脚本体系：

- 冒烟
- 压测
- 联调状态检查
- V1/V2 真实对比
- 综合报告
- 最终核验

---

## 3. V2 当前架构是什么样

### 3.1 一句话架构

现在的 `V2` 是：

- `Node/Fastify` 做控制平面和 API
- `Python/FastAPI` 做工具平面
- `Redis` 做热状态
- `PostgreSQL` 做耐久存储
- 文件落盘做兜底

### 3.2 模块划分

#### 控制平面（Node）

路径：`V2-Agent-backend/src/`

主要模块：

- `chain/`
  - `intent-router.js`
  - `template-ranker.js`
  - `planner.js`
- `runtime/`
  - `analysis-service.js`
  - `lane-state-machine.js`
  - `multi-level-cache.js`
  - `job-state-store.js`
- `routes/`
  - `analysis.js`
  - `tools.js`
  - `ops.js`
- `observability/`
  - `logger.js`
  - `incident-bundle.js`
  - `metrics-store.js`
- `tools/`
  - `tool-registry.js`
  - `vector-tools.js`
  - `python-tool-plane-client.js`

#### 工具平面（Python）

路径：`V2-Agent-backend/tool-plane-py/`

当前工具：

- `vector.count_features`
- `vector.geojson_bounds`
- `clip`
- `buffer`
- `merge`
- `export_geojson`

### 3.3 数据与状态

当前状态分层：

- `Redis`
  - 热状态缓存
  - 优先读取
- `PostgreSQL`
  - 作业状态耐久化
  - `UPSERT` 保存
- `file fallback`
  - 远端不可用时兜底

SQL 文件：

- `V2-Agent-backend/data-plane/sql/001_job_state_store.sql`

---

## 4. 关键接口

### 4.1 V2 后端接口

- `GET /health`
- `POST /api/v2/analysis`
- `GET /api/v2/jobs/:jobId`
- `GET /api/v2/tools`
- `POST /api/v2/tools/health-check`
- `GET /api/v2/ops/persistence-health`
- `GET /api/v2/ops/metrics`

### 4.2 Python tool plane 接口

- `GET /health`
- `GET /tools`
- `POST /execute`

---

## 5. 一条请求在 V2 里怎么走

以这条请求为例：

`当前区域所有 POI 的 50m 圆形缓冲区面，合并后导出 GeoJSON`

执行过程：

1. 前端发到 `POST /api/v2/analysis`
2. `Intent Router v2` 判定主意图和子意图
3. 模板重排选中 `vector-buffer-merge`
4. 生成 `DSL`
5. 跑 `clip -> buffer -> merge -> export_geojson`
6. 先返回：
   - `fast.result`
   - `deep.accepted`
7. 后台继续：
   - `deep.patch`
   - `deep.final`
8. 前端轮询 `GET /api/v2/jobs/:jobId`

---

## 6. 当前真实结果，用白话说

### 6.1 V1 / V2 对比结果

同一条请求下：

- `V1` 首响更快
- `V2` 总完成时间快很多

真实结果（最新可用综合报告）：

- `V1` 初始响应：
  - `P50 ≈ 8.14ms`
  - `P95 ≈ 44.21ms`
- `V2` 初始响应：
  - `P50 ≈ 40.6ms`
  - `P95 ≈ 54.35ms`

- `V1` 完整完成：
  - `P50 ≈ 10033.25ms`
  - `P95 ≈ 38193.41ms`
- `V2` 完整完成：
  - `P50 ≈ 357.63ms`
  - `P95 ≈ 366.17ms`

说人话：

- `V1` 更快地吐出第一点内容
- `V2` 更快地把整件事做完
- 而且快得不是一点点，是大幅领先

### 6.2 持久层表现

真实健康检查里：

- `Redis latency ≈ 0.38ms`
- `PostgreSQL latency ≈ 2.5ms`

这说明：

- Redis 适合做热状态
- PostgreSQL 适合做耐久存储

### 6.3 事件质量

当前 `V2` 的事件质量是稳定的：

- `deep_completion_rate = 1`
- `valid_event_sequence_rate = 1`

说白话：

- 事件顺序是对的
- 异步 deep lane 是通的
- 不是“偶尔成功”

---

## 7. 当前有哪些脚本，分别干什么

### 7.1 V2 自检

- `npm test`
  - 跑 V2 单元测试
- `npm run smoke`
  - 本地最小冒烟
- `npm run smoke:live`
  - 打正在运行的 V2 服务

### 7.2 性能与对比

- `npm run bench:live -- 3`
  - 跑 V2 真实压测
- `npm run compare:live -- 3`
  - 跑 V1/V2 同请求对比
- `npm run report:live -- 3`
  - 生成综合 JSON 报告
- `npm run report:release-md`
  - 把最新 summary 转成 Markdown

### 7.3 环境与依赖

- `npm run live-stack:start`
  - 启动 V1/V2 联调用进程
- `npm run live-stack:status`
  - 检查现在能不能做联调
- `npm run live-stack:stop`
  - 关闭联调用进程
- `npm run stack:check`
  - 检查 Docker 栈是否具备启动条件
- `npm run stack:up`
  - 启动容器化 V2 栈
- `npm run stack:down`
  - 停止容器化 V2 栈

### 7.4 持久层

- `npm run persistence:check`
  - 看 Redis/PostgreSQL/file fallback 当前状态
- `npm run bench:job-store -- 100`
  - 跑持久层基线压测

### 7.5 最终核验

- `npm run verify:final`
  - 一次性串起来跑：
    - 根项目测试
    - 根项目构建
    - V2 测试
    - V2 live smoke
    - live stack status
    - live summary report
    - Markdown release report

---

## 8. 现在怎么操作最省事

### 8.1 只看 V2 是否正常

```bash
cd V2-Agent-backend
npm run live-stack:status
npm run smoke:live
```

### 8.2 要看 V1/V2 对比

```bash
cd V2-Agent-backend
npm run live-stack:start
npm run live-stack:status
npm run compare:live -- 3
npm run report:live -- 3
npm run live-stack:stop
```

### 8.3 要做最终交付核验

```bash
cd V2-Agent-backend
npm run verify:final
```

---

## 9. 当前最重要的文档和报告

### 9.1 运行说明

- `V2-Agent-backend/README.md`
- `V2-Agent-backend/docs/runbooks/2026-03-09-live-compare-runbook.md`

### 9.2 架构复盘与后续建议

- `docs/2026-03-09-v2-gis-agent-architecture-review-and-optimization.md`

### 9.3 最新报告

- `V2-Agent-backend/reports/summary/live-summary-2026-03-09T05-24-16-404Z.json`
- `V2-Agent-backend/reports/summary/live-summary-2026-03-09T05-24-16-404Z.md`
- `V2-Agent-backend/reports/release/final-verification-2026-03-09T05-24-16-906Z.json`

---

## 10. 当前还算不算“没做完”

说白话：

这轮你要的内容，已经算做完了。

因为现在已经具备：

- 能跑
- 能测
- 能看对比
- 能出报告
- 能交付
- 能让别人接手

所以现在不是“没做完”，而是：

- 主体交付完成
- 后续只剩持续优化空间

---

## 11. 现在最值得继续优化什么

这部分我只说最重要的，不铺太开。

### 第一优先级：V2 首响优化

因为现在真实结果很清楚：

- `V2` 总完成非常强
- 但 `V1` 首响还更快

所以最该继续打磨的是：

- 让 `fast.result` 更轻
- 更早给用户一个可靠摘要

### 第二优先级：扩更多 GIS 能力域

现在核心算子已经足够证明架构成立，但能力域还不够宽。

下一步值得补：

- `overlay / intersection`
- `spatial join`
- `nearest / distance matrix`
- `raster sample`

### 第三优先级：长期看板和长期报告

现在已经有脚本和产物了，但还偏“命令式”。

后面如果要更像稳定产品，应该再补：

- 长期趋势看板
- 定时报告
- 更系统的 load / replay / chaos 结果归档

---

## 12. 最后一句话

如果你现在把这个项目交给另一个人：

- 他不需要先读完代码
- 先看这份手册
- 再看 `README`
- 再跑 `live-stack:status`
- 再跑 `report:live`

就能快速知道：

- 系统是什么
- 现在做到哪了
- 怎么验证
- 哪里更强
- 哪里以后还能继续优化
