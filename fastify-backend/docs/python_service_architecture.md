# Python 空间计算服务架构文档

> **版本**: 1.0.0  
> **更新日期**: 2026-02-08  
> **作者**: 系统自动生成

---

## 目录

1. [服务概述](#1-服务概述)
2. [目录结构总览](#2-目录结构总览)
3. [根目录文件说明](#3-根目录文件说明)
4. [algorithms/ 算法模块](#4-algorithms-算法模块)
5. [db/ 数据库模块](#5-db-数据库模块)
6. [generated/ 自动生成模块](#6-generated-自动生成模块)
7. [pipeline/ 管道模块](#7-pipeline-管道模块)
8. [模块间调用关系](#8-模块间调用关系)
9. [数据流向](#9-数据流向)

---

## 1. 服务概述

`python_service` 是一个 **Python 空间计算侧车服务**（Sidecar Service），作为 Fastify Node.js 后端的协处理器，提供高性能的空间分析与计算能力。

### 核心职责

| 职责 | 说明 |
|------|------|
| **空间聚类分析** | 基于 HDBSCAN/DBSCAN 对 POI 点进行密度聚类 |
| **边界生成** | 使用 Alpha-Shape 算法生成模糊区域边界 |
| **隶属度计算** | 多因素（密度、纯度、中心性等）隶属度评分 |
| **图结构推理** | 空间邻近图构建与连通分量分析 |
| **区域对比** | 多选区 POI 分布差异与相似性分析 |
| **H3 聚合** | 基于 Uber H3 的六边形网格聚合统计 |

### 通信协议

- **gRPC (50051端口)**: 主要通信通道，提供流式空间计算接口
- **HTTP (8081端口)**: 健康检查与运维指标接口

---

## 2. 目录结构总览

```
python_service/
├── __init__.py              # 包初始化文件
├── app.py                   # HTTP 服务入口（健康检查/指标）
├── grpc_server.py           # gRPC 服务入口
├── requirements.txt         # Python 依赖清单
│
├── algorithms/              # 空间算法模块
│   ├── __init__.py
│   ├── alpha_shape.py       # Alpha-Shape 边界生成
│   ├── direction_filter.py  # 方向感知过滤
│   ├── graph_reasoning.py   # 空间图推理
│   ├── h3_aggregate.py      # H3 六边形聚合
│   ├── hdbscan_cluster.py   # HDBSCAN 聚类
│   ├── membership.py        # 隶属度评分模型
│   └── region_comparison.py # 区域对比分析
│
├── db/                      # 数据库访问层
│   ├── __init__.py
│   └── repository.py        # PostGIS POI 仓储
│
├── generated/               # gRPC 自动生成代码
│   ├── spatial_compute_pb2.py       # Protobuf 消息定义
│   └── spatial_compute_pb2_grpc.py  # gRPC 服务桩
│
└── pipeline/                # 核心计算管道
    ├── __init__.py
    └── spatial_pipeline.py  # 空间计算主流水线
```

---

## 3. 根目录文件说明

### 3.1 `__init__.py`

**用途**: Python 包标识文件

将 `python_service` 目录标记为 Python 包，允许内部模块相互导入。

---

### 3.2 `app.py`

**用途**: HTTP 服务入口

提供轻量级 Flask HTTP 服务，用于容器健康检查和运维监控。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康探针，返回服务状态、时间戳、gRPC 端口信息 |
| `/metrics` | GET | 运行指标，返回服务启动时长、请求计数统计 |

**环境变量**:

- `SPATIAL_HTTP_HOST`: HTTP 监听地址（默认 `0.0.0.0`）
- `SPATIAL_HTTP_PORT`: HTTP 监听端口（默认 `8081`）
- `SPATIAL_GRPC_PORT`: 用于 Health 响应中显示的 gRPC 端口（默认 `50051`）

**注意**: 真正的空间计算通过 gRPC 提供，此服务仅用于运维探活。

---

### 3.3 `grpc_server.py`

**用途**: gRPC 服务入口

加载 Protobuf 定义，暴露 `SpatialComputeService` 服务，实现以下功能：

1. **自动 Proto 编译**: 检测 `proto/spatial_compute.proto` 变更后自动重新生成 Python stub
2. **流式事件返回**: 将 `SpatialPipeline` 的阶段事件流式返回给 Node.js 调用方
3. **错误封装**: 捕获运行时异常并转换为 ERROR 事件，避免连接异常

**gRPC 服务定义**:

```protobuf
service SpatialComputeService {
  rpc ComputeSpatial(ComputeRequest) returns (stream ComputeEvent);
}
```

**事件类型**:

| 类型 | 说明 |
|------|------|
| `STAGE` | 阶段开始通知（如 fetch_candidates, cluster） |
| `PROGRESS` | 进度更新（含阶段、百分比、中间统计） |
| `PARTIAL` | 中间结果（如草图边界，用于渐进式渲染） |
| `FINAL` | 最终结果（完整计算结果 JSON） |
| `ERROR` | 错误事件（包含错误消息） |

**环境变量**:

- `SPATIAL_GRPC_HOST`: gRPC 监听地址（默认 `0.0.0.0`）
- `SPATIAL_GRPC_PORT`: gRPC 监听端口（默认 `50051`）
- `SPATIAL_GRPC_WORKERS`: 线程池工作线程数（默认 `4`）

---

### 3.4 `requirements.txt`

**用途**: Python 依赖清单

列出服务所需的所有 Python 第三方库：

| 依赖包 | 版本要求 | 用途 |
|--------|----------|------|
| `flask` | ≥3.0.0 | HTTP 健康/指标服务 |
| `grpcio` | ≥1.62.0 | gRPC 服务端运行时 |
| `grpcio-tools` | ≥1.62.0 | Protobuf 编译工具 |
| `psycopg2-binary` | ≥2.9.9 | PostgreSQL/PostGIS 数据库连接 |
| `numpy` | ≥1.26.0 | 数值计算基础库 |
| `scikit-learn` | ≥1.4.0 | DBSCAN 聚类（fallback） |
| `hdbscan` | ≥0.8.33 | HDBSCAN 密度聚类（首选） |
| `shapely` | ≥2.0.3 | 几何操作与 GeoJSON 序列化 |
| `alphashape` | ≥1.3.1 | Alpha-Shape 边界算法 |

---

## 4. algorithms/ 算法模块

### 4.1 `__init__.py`

**用途**: 算法包初始化，导出公共接口

---

### 4.2 `alpha_shape.py`

**用途**: Alpha-Shape 边界生成

根据点集通过 Alpha-Shape 算法生成凹多边形边界，用于表示模糊区域的几何范围。

**核心功能**:

| 函数 | 说明 |
|------|------|
| `build_alpha_shape()` | 主入口，构建 Alpha-Shape 边界并返回 GeoJSON |
| `_as_polygon()` | 将复杂几何体（MultiPolygon/GeometryCollection）归一化为单个 Polygon |
| `_downsample_points()` | 确定性降采样，控制输入点数避免计算爆炸 |
| `_simplify_tolerance()` | 根据几何跨度自适应计算简化容差 |

**特性**:

- 降采样后保留首尾点，确保边界闭合
- 支持 Convex Hull fallback：Alpha-Shape 失败时回退到凸包
- 面积过滤：过滤掉面积过小（<800m²）的噪声区域
- 输出包含边界生成元信息（方法、alpha值、采样率等）

---

### 4.3 `direction_filter.py`

**用途**: 方向感知 POI 过滤与排序

解析用户查询中的方向语义（东/西/南/北），并据此过滤或排序 POI 结果。

**核心功能**:

| 函数 | 说明 |
|------|------|
| `normalize_direction()` | 方向别名归一化（支持中英文：东→east, 西侧→west） |
| `resolve_direction_from_query_plan()` | 从结构化查询计划或语义文本中提取方向线索 |
| `filter_pois_by_direction()` | 按方向过滤/排序 POI，返回符合方向要求的子集 |

**方向别名支持**:

- 英文: `east`, `west`, `north`, `south`, `e`, `w`, `n`, `s`
- 中文: `东`, `西`, `南`, `北`, `东侧`, `西边`, `北面` 等

**应用场景**: "武大东边的餐厅" → 提取方向=east，以武大为锚点过滤

---

### 4.4 `graph_reasoning.py`

**用途**: 空间邻近图构建与推理

基于 POI 点位构建空间邻近图，分析连通分量和中心节点，用于空间关系推理。

**核心功能**:

| 函数 | 说明 |
|------|------|
| `analyze_spatial_graph()` | 主入口，构建邻近图并返回图结构统计 |
| `_haversine_m()` | Haversine 距离计算（单位：米） |
| `_grid_steps()` | 计算网格步长用于空间索引加速 |
| `_cell_key()` | 将坐标映射到网格单元 |

**算法亮点**:

- **网格加速**: 避免 O(n²) 暴力距离计算，使用网格索引将复杂度降至 O(n×k)
- **连通分量分析**: BFS 遍历发现独立空间聚落
- **Hub 节点识别**: 按 degree 排序输出核心枢纽节点

**输出结构**:

```json
{
  "node_count": 150,
  "edge_count": 420,
  "component_count": 3,
  "components": [80, 50, 20],
  "top_hubs": [{"id": "...", "name": "...", "degree": 12}],
  "avg_degree": 5.6,
  "distance_threshold_m": 280.0
}
```

---

### 4.5 `h3_aggregate.py`

**用途**: H3 六边形网格聚合

使用 Uber H3 地理索引将 POI 聚合到六边形单元，用于热力图和密度分析。

**核心功能**:

| 函数 | 说明 |
|------|------|
| `aggregate_pois_h3()` | 将 POI 按 H3 单元聚合，统计数量和主导类别 |
| `_fallback_cell_id()` | H3 库不可用时的网格 fallback |

**特性**:

- H3 可选依赖：自动检测 h3 库，不可用时回退到简单网格
- 分辨率自适应：根据查询范围面积动态选择 H3 分辨率（6-10）
- 主导类别统计：每个单元输出占比最高的 POI 类别

---

### 4.6 `hdbscan_cluster.py`

**用途**: HDBSCAN 密度聚类

对 POI 点集进行密度聚类，识别自然形成的空间簇。

**核心功能**:

| 函数 | 说明 |
|------|------|
| `cluster_points()` | 主入口，执行聚类并返回标签、簇数、噪声数 |

**算法策略**:

1. **首选 HDBSCAN**: 自适应密度聚类，无需预设簇数
2. **Fallback DBSCAN**: HDBSCAN 不可用时使用 scikit-learn DBSCAN
3. **结果标准化**: 统一输出 `ClusterResult` 数据类

**输出结构**:

```python
@dataclass
class ClusterResult:
    labels: List[int]      # 每个点的簇标签（-1 表示噪声）
    cluster_count: int     # 有效簇数量
    noise_count: int       # 噪声点数量
    engine: str            # 使用的聚类引擎
```

---

### 4.7 `membership.py`

**用途**: 多因素隶属度评分模型

计算 POI 簇对于"模糊区域"概念的隶属程度得分。

**核心功能**:

| 函数 | 说明 |
|------|------|
| `compute_membership()` | 主入口，按五因素加权计算总分和层级 |
| `clamp()` | 将输入值限制到 [0, 1] 区间 |

**五因素权重**:

| 因素 | 权重 | 说明 |
|------|------|------|
| 密度 (density) | 30% | 单位面积内 POI 数量 |
| 纯度 (purity) | 25% | 主导类别 POI 占比 |
| 中心性 (centrality) | 20% | 相对于整体的重要度 |
| 紧凑度 (compactness) | 15% | 几何分布紧密程度 |
| 规模 (scale) | 10% | 簇内 POI 数量对数归一化 |

**层级划分**:

| 层级 | 分数阈值 | 含义 |
|------|----------|------|
| `core` | ≥0.72 | 核心区域，高度符合模糊区域定义 |
| `transition` | 0.45-0.72 | 过渡区域，部分符合 |
| `periphery` | <0.45 | 边缘区域，关联性较弱 |

---

### 4.8 `region_comparison.py`

**用途**: 多区域 POI 分布对比分析

支持用户选择多个区域进行 POI 类别分布差异与共性分析。

**核心功能**:

| 函数 | 说明 |
|------|------|
| `analyze_single_region()` | 分析单个区域的 POI 统计（类别分布、主导类别等） |
| `analyze_region_set()` | 批量分析目标区域集合 |
| `compute_region_comparison()` | 跨区域对比，输出差异点和相似点 |

**输出结构**:

- `similarities`: 各区域共享的分布模式（差距 <5%）
- `differences`: 各区域显著差异（差距 ≥5%）
- `summary`: 文本摘要

**应用场景**: "对比武大周边和光谷步行街的餐饮业态"

---

## 5. db/ 数据库模块

### 5.1 `__init__.py`

**用途**: 数据库包初始化

---

### 5.2 `repository.py`

**用途**: PostGIS POI 数据仓储

封装 Python 侧访问 PostgreSQL/PostGIS 数据库的查询逻辑。

**核心类**: `POIRepository`

| 方法 | 说明 |
|------|------|
| `fetch_pois()` | 按空间范围 + 类别/关键词过滤查询 POI |
| `fetch_pois_by_wkt()` | 按 WKT 边界查询 POI（用于区域对比） |

**空间过滤策略**:

| 优先级 | 条件 | 说明 |
|--------|------|------|
| 1 | regions (多选区) | 前端绘制的多边形/圆形选区 OR 并集 |
| 2 | boundary (自定义边界) | GeoJSON 边界数组 |
| 3 | viewport (视口) | 地图当前可视范围 bbox |
| 4 | center+radius (圆形) | 中心点 + 半径 |

**几何优化**:

- 使用 `&&` 包围盒预过滤 + `ST_Within` 精确过滤（两阶段）
- 支持 `ST_DWithin` 圆形范围查询（地理坐标系）
- KNN 距离排序 (`<->` 操作符) 用于近邻优先

**环境变量**:

- `POSTGRES_HOST`: 数据库主机（默认 `localhost`）
- `POSTGRES_PORT`: 数据库端口（默认 `5432`）
- `POSTGRES_USER`: 用户名（默认 `postgres`）
- `POSTGRES_PASSWORD`: 密码（默认 `123456`）
- `POSTGRES_DATABASE`: 数据库名（默认 `geoloom`）

---

## 6. generated/ 自动生成模块

> ⚠️ **警告**: 此目录下的文件由 `grpc_tools.protoc` 自动生成，请勿手动编辑！

### 6.1 `spatial_compute_pb2.py`

**用途**: Protobuf 消息定义

包含从 `proto/spatial_compute.proto` 编译的消息类：

| 类 | 说明 |
|------|------|
| `ComputeRequest` | 空间计算请求消息 |
| `ComputeEvent` | 计算事件响应消息 |
| `EventType` | 事件类型枚举 |

---

### 6.2 `spatial_compute_pb2_grpc.py`

**用途**: gRPC 服务桩代码

包含服务端实现基类和客户端桩：

| 类 | 用途 |
|------|------|
| `SpatialComputeServiceStub` | 客户端调用桩 |
| `SpatialComputeServiceServicer` | 服务端实现基类 |
| `add_SpatialComputeServiceServicer_to_server()` | 注册服务到 gRPC Server |

---

## 7. pipeline/ 管道模块

### 7.1 `__init__.py`

**用途**: 管道包初始化

---

### 7.2 `spatial_pipeline.py`

**用途**: 空间计算主流水线

协调调用各算法模块，实现完整的空间计算流程。

**核心类**: `SpatialPipeline`

**主方法**: `run(request) -> Iterator[Dict]`

执行一次空间计算任务，流式产出阶段事件。

---

**支持的查询类型**:

| query_type | 说明 | 特殊处理 |
|------------|------|----------|
| `poi_search` | 常规 POI 搜索 | 完整聚类+边界流程 |
| `poi_fetch` | 仅获取 POI | 跳过聚类，快速返回 |
| `area_analysis` | 区域分析 | H3 单元数增加到 120 |
| `graph_reasoning` | 图结构推理 | 跳过聚类，仅做邻近图分析 |
| `region_comparison` | 区域对比 | 专用分析路径，无聚类 |

---

**计算流程**（以 `poi_search` 为例）:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. fetch_candidates (获取候选 POI)                                │
│    ├── 解析 spatial_context、categories、hints                    │
│    ├── 判断数据源：payload (Node 预取) / db (Python 直查)         │
│    ├── 应用方向过滤 (direction_filter)                           │
│    └── [可选] 图结构分析 (graph_reasoning)                        │
├─────────────────────────────────────────────────────────────────┤
│ 2. PARTIAL: 发送草图边界 (Convex Hull 预览)                       │
├─────────────────────────────────────────────────────────────────┤
│ 3. cluster (聚类)                                                │
│    ├── HDBSCAN/DBSCAN 聚类                                       │
│    └── 按簇 ID 分组点位                                          │
├─────────────────────────────────────────────────────────────────┤
│ 4. region_modeling (区域建模)                                    │
│    ├── 对每个簇：                                                │
│    │   ├── 计算中心点                                           │
│    │   ├── 统计类别分布                                         │
│    │   ├── 计算隶属度 (membership)                              │
│    │   ├── 生成边界 (Alpha-Shape / Convex Hull)                 │
│    │   └── 构造 vernacular_region / fuzzy_region / hotspot      │
│    └── H3 聚合统计                                               │
├─────────────────────────────────────────────────────────────────┤
│ 5. FINAL: 返回完整结果                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

**FINAL 结果结构**:

```json
{
  "success": true,
  "results": {
    "mode": "python-spatial",
    "pois": [...],
    "boundary": {...},
    "spatial_clusters": {
      "hotspots": [...],
      "h3_summary": [...]
    },
    "vernacular_regions": [...],
    "fuzzy_regions": [...],
    "fuzzy_summary": {"core": 2, "transition": 3, "periphery": 1},
    "graph_reasoning": {...},
    "stats": {
      "total_candidates": 1500,
      "cluster_count": 6,
      "cluster_engine": "hdbscan",
      "noise_count": 150,
      "h3_resolution": 8,
      ...
    }
  },
  "diagnostics": {
    "engine": "python-spatial-pipeline",
    "query_type": "poi_search",
    ...
  }
}
```

---

## 8. 模块间调用关系

```
                       ┌─────────────────────┐
                       │   grpc_server.py    │
                       │   (gRPC 入口)        │
                       └──────────┬──────────┘
                                  │ 实例化
                                  ▼
                       ┌─────────────────────┐
                       │   SpatialPipeline   │
                       │   (核心流水线)       │
                       └──────────┬──────────┘
                                  │ 调用
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│ POIRepository │       │  algorithms/  │       │   helpers     │
│ (数据库访问)   │       │  (算法集合)    │       │ (工具函数)    │
└───────────────┘       └───────────────┘       └───────────────┘
                                  │
        ┌───────────┬─────────────┼─────────────┬───────────┐
        │           │             │             │           │
        ▼           ▼             ▼             ▼           ▼
   hdbscan     alpha_shape    graph_      membership   h3_aggregate
   _cluster    (边界生成)     reasoning   (隶属度)     (H3聚合)
   (聚类)                     (图推理)
```

---

## 9. 数据流向

```
Node.js (Fastify)
       │
       │ gRPC: ComputeRequest
       ▼
┌─────────────────────────────────────────┐
│           grpc_server.py                │
│  ┌─────────────────────────────────┐    │
│  │        SpatialPipeline          │    │
│  │                                 │    │
│  │  1. 解析请求参数                │    │
│  │  2. 获取 POI（DB/Payload）      │◄───┼──── PostGIS
│  │  3. 方向过滤                    │    │
│  │  4. 聚类分析                    │    │
│  │  5. 边界生成                    │    │
│  │  6. 隶属度计算                  │    │
│  │  7. H3 聚合                     │    │
│  │  8. 组装结果                    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ← STAGE/PROGRESS/PARTIAL (流式)        │
│  ← FINAL (最终结果)                     │
└─────────────────────────────────────────┘
       │
       │ gRPC: ComputeEvent (stream)
       ▼
Node.js (Fastify) → 前端 WebSocket/SSE
```

---

## 附录 A: 环境变量速查

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SPATIAL_HTTP_HOST` | `0.0.0.0` | HTTP 服务监听地址 |
| `SPATIAL_HTTP_PORT` | `8081` | HTTP 服务监听端口 |
| `SPATIAL_GRPC_HOST` | `0.0.0.0` | gRPC 服务监听地址 |
| `SPATIAL_GRPC_PORT` | `50051` | gRPC 服务监听端口 |
| `SPATIAL_GRPC_WORKERS` | `4` | gRPC 工作线程数 |
| `POSTGRES_HOST` | `localhost` | PostgreSQL 主机 |
| `POSTGRES_PORT` | `5432` | PostgreSQL 端口 |
| `POSTGRES_USER` | `postgres` | 数据库用户名 |
| `POSTGRES_PASSWORD` | `123456` | 数据库密码 |
| `POSTGRES_DATABASE` | `geoloom` | 数据库名称 |

---

## 附录 B: 快速启动

```bash
# 1. 进入 Python 服务目录
cd fastify-backend/python_service

# 2. 创建虚拟环境（推荐）
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac

# 3. 安装依赖
pip install -r requirements.txt

# 4. 启动 gRPC 服务（主服务）
python grpc_server.py

# 5. （可选）启动 HTTP 健康检查服务
python app.py
```

---

*文档结束*
