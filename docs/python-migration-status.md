# Spatial-RAG 迁移状态与性能说明

更新时间：2026-02-08

## 1. 结论摘要

- 后端已基本对齐目标架构：**Node 作为网关 + Python 作为空间计算引擎**。
- 性能并非所有查询类型都统一提升：
  - 核心 POI 检索路径 Python 更快；
  - 部分高级分析在 Python 侧仍偏慢，主要因为 Python 当前执行了更完整的分析链路。
- 现阶段主要收益：可维护性提升、输出更稳定、回退策略更可控。

## 1.1 2026-02-08 性能更新

- 图推理已启用 Python fast path（跳过部分高开销区域建模链路）。
- 图算法由全对扫描优化为网格邻域裁剪 + haversine 校验。
- 空间 SQL 在 polygon/viewport/WKT 路由增加 `&&` bbox 预过滤，再执行 `ST_Within`。
- 图查询未显式限量时，通过 `graphMaxNodes` 限制候选规模以降低传输与计算成本。

本地环境（`POST /api/ai/execute`，5 次采样）：

| 场景 | 平均耗时 | P95 |
|---|---:|---:|
| Python 主路径（`graph_reasoning`） | 102.2 ms | 126 ms |
| Node 回退路径（`graph_reasoning`） | 2.0 ms | 3 ms |

说明：Node 回退更轻，但结果语义较简化；Python 输出更完整且诊断信息更稳定。

## 1.2 2026-02-08 一致性与边界建模更新

- `dual_run_parity_check` 对 `graph_reasoning` 改为“图结构优先”校验：
  - 硬告警聚焦 Python 图结构有效性与关键 schema；
  - 在 Node 轻量回退模式下，POI 重叠率偏低降级为 warning。
- Alpha-shape 管线增加确定性降采样与自适应简化：
  - 降低大簇几何开销；
  - 保持输出可复现。
- 边界建模增加小簇凸包捷径与预览边界采样。

## 1.3 2026-02-08 迁移收口更新

- Python 聚类支持自适应参数（`clusterMinClusterSize` / `clusterMinSamples` / `clusterMaxHdbscanPoints`），改善重场景性能。
- Node 回退默认收敛为 SQL 轻量执行器（`node_sql_fallback`）；旧版重逻辑改为显式可选（`SPATIAL_NODE_LEGACY_EXECUTOR=true`）。
- `spatial-rag-pipeline` 中残余直接 `executeQuery` 已迁移至 `spatialJobRunner`，旧路径不再硬依赖 legacy executor。
- 10/30/60/100 分阶段 rollout 校验通过（`all_within_expected=true`）。
- 双跑一致性报告新增 `warning_count`，在保留硬失败条件的同时识别轻量回退差异。

最新回归状态：

- `smoke:jobs` 通过
- `dual_run_parity_check` 通过（`all_passed=true`）
- `drill_node_fallback` 通过（`all_passed=true`）

## 2. 已测性能快照

> 数据采自 2026-02-07 本地环境，绝对值会受机器负载影响。

### 2.1 纯计算基准（`POST /api/ai/execute`，6 次采样）

| 场景 | Python 平均 | Node 平均 | 观察 |
|---|---:|---:|---|
| `poi_search` | 187.83 ms | 498.67 ms | Python 约快 62.3% |
| `graph_reasoning` | 1017.17 ms | 104.50 ms | Python 偏慢（执行链路更完整） |
| `region_comparison` | 2.33 ms | 1.17 ms | 两者都属低延迟 |

### 2.2 端到端基准（`POST /api/jobs/narrative`，4 次采样）

- Python 主路径：`poi_search` 平均 9669.00 ms
- Node 回退路径：`poi_search` 平均 5319.50 ms

说明：此指标包含 planner/writer/LLM 延迟，不属于纯空间计算指标。

### 2.3 回归检查

- `npm --prefix fastify-backend run check:dualrun -- --samples=2 --out=reports/rollout/dual-run-latest.json`
  - 结果：`all_passed = true`
- `npm --prefix fastify-backend run drill:fallback -- --out=reports/rollout/fallback-drill-latest.json`
  - 结果：Python 主路径与 Node 回退均通过

## 3. Python 目录职责（`fastify-backend/python_service`）

### 3.1 入口层

- `fastify-backend/python_service/grpc_server.py`
  - 空间计算 gRPC 入口，接收 Node 请求并输出 STAGE/PROGRESS/PARTIAL/FINAL/ERROR 流事件。

- `fastify-backend/python_service/app.py`
  - 轻量 HTTP 服务（健康检查与指标）。

### 3.2 Pipeline 层

- `fastify-backend/python_service/pipeline/spatial_pipeline.py`
  - Python 主编排管线，负责请求解析、候选加载、方向筛选、聚类、边界建模、模糊归属、H3 聚合、图分析、区域对比。

### 3.3 算法层

- `fastify-backend/python_service/algorithms/hdbscan_cluster.py`
  - HDBSCAN 聚类封装（含 DBSCAN 回退）。
- `fastify-backend/python_service/algorithms/alpha_shape.py`
  - Alpha-shape 边界生成（含凸包回退）。
- `fastify-backend/python_service/algorithms/direction_filter.py`
  - 方位语义归一与方向筛选。
- `fastify-backend/python_service/algorithms/h3_aggregate.py`
  - H3 聚合（缺包时用确定性网格回退）。
- `fastify-backend/python_service/algorithms/membership.py`
  - 多因子归属评分（密度/纯度/中心性/紧致度/尺度）。
- `fastify-backend/python_service/algorithms/graph_reasoning.py`
  - 空间图构建与图指标提取。
- `fastify-backend/python_service/algorithms/region_comparison.py`
  - 区域级聚合与跨区对比。

### 3.4 数据访问层

- `fastify-backend/python_service/db/repository.py`
  - PostGIS 访问抽象，提供视口/边界/多区/分类过滤查询，并与现有 `pois` 表结构保持一致。

### 3.5 协议生成文件

- `fastify-backend/python_service/generated/spatial_compute_pb2.py`
- `fastify-backend/python_service/generated/spatial_compute_pb2_grpc.py`

### 3.6 包标记文件

- `fastify-backend/python_service/__init__.py`
- `fastify-backend/python_service/algorithms/__init__.py`
- `fastify-backend/python_service/db/__init__.py`
- `fastify-backend/python_service/pipeline/__init__.py`

## 4. 本轮 Node 瘦身改动

### 4.1 Legacy 执行器改为懒加载

文件：`fastify-backend/services/spatialJobRunner.js`

- 旧行为：模块加载时就引入 `routes/ai/executor.js`
- 新行为：仅在回退确实发生时再动态引入 legacy 执行器
- 收益：Python 主路径健康时，网关启动与运行时负担更小

### 4.2 高级查询回退策略

文件：`fastify-backend/services/spatialJobRunner.js`

新增环境变量：`SPATIAL_NODE_ADVANCED_FALLBACK`

- `minimal`（默认）：高级查询在 Node 侧返回最小安全结构
- `legacy`：允许旧版 Node 重计算回退
- `disabled`：高级类型仅使用最小回退

说明：`forceNodeFallback=true` 仍可用于 drill/回归场景强制 legacy 回退。

## 5. 下一阶段瘦身计划

1. 将剩余回退逻辑继续收敛到 SQL 轻量包装，移除 Node 侧空间推理分支。
2. 清理旧路由中残余 `executeQuery` 直连，统一经由 `spatialJobRunner`。
3. 保持 Python 作为所有高级查询默认路径，Node 仅作为应急兼容层。
4. 完成 10% -> 30% -> 60% -> 100% 分阶段发布，稳定窗口后下线冗余 Node 计算分支。

## 6. 每日回归命令

```bash
npm --prefix fastify-backend run smoke:jobs
npm --prefix fastify-backend run check:dualrun -- --samples=2 --out=reports/rollout/dual-run-latest.json
npm --prefix fastify-backend run drill:fallback -- --out=reports/rollout/fallback-drill-latest.json
```
