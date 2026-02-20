# Composite V5 路网地块边界 — RAGLOG

> 版本：v5.0  
> 最后更新：2026-02-20  
> 作者：Antigravity Agent

---

## 0. 设计目标

使模糊区域边界**贴合路网**，而非依赖  alpha-shape / 凸包等纯几何方法。
用"路网闭合地块 → ST_Union"替代"POI 点云 → 几何估算"，从根本上提升边界的空间语义准确度。

---

## 1. 数据源层（PostGIS 三层面）

### 1.1 wuhan_road_blocks（路网闭合地块）

| 字段 | 类型 | 说明 |
|------|------|------|
| block_id | serial PK | 地块唯一标识 |
| geom | geometry(Polygon, 4326) | 地块几何面 |
| area_m2 | float | 面积（平方米）|
| source | text | 数据来源标识 |

- **来源**：由 `scripts/import_v5_layers.py` 从 GeoJSON 入库。
- **GIST 索引**：`idx_road_blocks_geom ON geom`
- **查询方法**：`repository.fetch_road_blocks(bbox_wkt)` → `ST_Intersects(geom, bbox)`

### 1.2 wuhan_osm_aoi（OSM 兴趣面）

| 字段 | 类型 | 说明 |
|------|------|------|
| aoi_id | serial PK | AOI 唯一标识 |
| name | text | AOI 名称（如"沙湖"、"光谷广场"） |
| type | text | AOI 类型（如"公园"、"商圈"） |
| geom | geometry(MultiPolygon, 4326) | AOI 几何面 |

- **查询方法**：`repository.fetch_osm_aoi(bbox_wkt)`
- **用途**：为片区提供语义名称（优先级最高的命名来源）

### 1.3 wuhan_euluc（城市用地分类）

| 字段 | 类型 | 说明 |
|------|------|------|
| euluc_id | serial PK | 地块标识 |
| land_type | text | 用地类型（如"商业服务用地"、"教育用地"） |
| geom | geometry(Polygon, 4326) | 用地几何面 |

- **查询方法**：`repository.fetch_euluc(bbox_wkt)`
- **用途**：为片区提供功能属性后缀（如"科教片区"、"商业片区"）

---

## 2. POI 空间连接（Spatial Join）

### 2.1 入口

`repository.spatial_join_pois(poi_list, bbox_wkt)`

### 2.2 SQL 逻辑

```sql
WITH poi_input AS (
  SELECT id, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
  FROM unnest(poi_list)
)
SELECT p.id,
       rb.block_id,
       aoi.name AS aoi_name,
       aoi.type AS aoi_type,
       eu.land_type
FROM poi_input p
LEFT JOIN LATERAL (
  SELECT block_id, geom FROM wuhan_road_blocks rb
  WHERE rb.geom && p.geom AND ST_Contains(rb.geom, p.geom)
  ORDER BY ST_Area(rb.geom) ASC LIMIT 1
) rb ON true
LEFT JOIN LATERAL (
  SELECT name, type FROM wuhan_osm_aoi aoi
  WHERE aoi.geom && p.geom AND ST_Contains(aoi.geom, p.geom)
  ORDER BY ST_Area(aoi.geom) ASC LIMIT 1
) aoi ON true
LEFT JOIN LATERAL (
  SELECT land_type FROM wuhan_euluc eu
  WHERE eu.geom && p.geom AND ST_Contains(eu.geom, p.geom)
  ORDER BY ST_Area(eu.geom) ASC LIMIT 1
) eu ON true
```

### 2.3 输出

每个 POI 被附加以下属性：

- `block_id`：所属路网地块 ID
- `aoi_name`：所属 AOI 面名称
- `aoi_type`：所属 AOI 面类型
- `land_type`：所属 EULUC 用地类型

### 2.4 性能

- 3000 POI × 3 个 LATERAL JOIN：**~110ms**（GIST 索引加速）

---

## 3. HDBSCAN 聚类

### 3.1 入口

`algorithms.hdbscan_cluster.cluster_points(pois)`

### 3.2 参数

自适应参数基于 POI 数量：

- `min_cluster_size`：自动计算（基于总点数的百分比，下限 5）
- `min_samples`：`min_cluster_size * 0.6`
- `metric`：`haversine`（球面距离）

### 3.3 输出

`cluster_labels: List[int]`：每个 POI 的聚类标签，-1 为噪声。

### 3.4 审计要点

- 如果某大型设施（如大学）的 POI 分布跨越多个 road_block，可能被拆分为多个聚类
  → **已知 Issue #4**：需要在后续迭代中引入语义聚合（同一 AOI name 下的多聚类合并）

---

## 4. 地块级边界组装（block_assembler.py）

### 4.1 入口

```python
block_assembler.assemble_block_boundaries(
    cluster_labels=labels,
    pois=pois,            # 带 block_id/aoi_name/aoi_type/land_type 的 POI
    road_blocks=v5_road_blocks,
    osm_aoi_features=v5_osm_aoi,
    euluc_features=v5_euluc,
)
```

### 4.2 边界生成策略（四层回退）

| 优先级 | 策略 | 方法名 | 置信度先验 |
|--------|------|--------|-----------|
| 1 | 路网地块 ST_Union | `road_block_union_v5` | 0.93 |
| 2 | AOI 面包含质心 | `aoi_fallback_v5` | 0.85 |
| 3 | EULUC 面包含质心 | `euluc_fallback_v5` | 0.82 |
| 4 | 凸包兜底 | `convex_hull_last_resort_v5` | 0.70 |

### 4.3 策略 1 详解：路网地块 Union

```
聚类 POI → 提取 block_id 集合 → 查找对应地块 Polygon
           → shapely.unary_union(block_polygons)
           → 若为 MultiPolygon → 取面积最大的连通部分
           → 验证有效性
```

**核心优势**：边界自然贴合道路网络（因为 road_block 本身就是由道路围合形成的闭合面）。

### 4.4 审计要点

- STRtree 空间索引用于 AOI/EULUC 回退查询（O(log N) 替代 O(N) 线性遍历）
- MultiPolygon 聚合时只取最大连通部分，可能丢失离散小块 → 需要监控

---

## 5. 片区命名（_resolve_district_name）

### 5.1 命名优先级

| 优先级 | 来源 | 示例 | 置信度 |
|--------|------|------|--------|
| 1 | AOI.name + EULUC 后缀 | "沙湖生态片区" | 0.75-0.90 |
| 2 | POI 高频子串（语义锚点）| "光谷商业片区" | 0.45-0.85 |
| 3 | EULUC 用地类型 | "教育用地片区" | 0.40 |
| 4 | AOI type 兜底 | "公园片区" | 0.30 |
| 5 | 无信息 | "未命名片区" | 0.10 |

### 5.2 黑名单过滤

#### 低置信度名称关键词

停车场、公厕、配电房、充电桩、公交站……

#### 宏观地名黑名单（v5.1 新增）

省级名称（湖北、湖南、广东……）、市级名称（武汉、汉口、武昌……）、通用名称（中国、有限公司、集团……）

**作用**：避免出现"湖北湖北片区"等语义错误。

### 5.3 语义锚点算法

```python
POI 名称列表 → 提取 CJK 子串（长度 2-6）
             → Counter 统计频次
             → 过滤：出现次数 >= 3 且 support_ratio >= 15%
             → 取最高频子串作为片区名
```

**性能优化**：

- 最多处理 100 个 POI 名称（`max_names=100`）
- 直接 `frozenset` 查找代替 `_is_low_confidence_name()` 调用

---

## 6. 置信度评分（confidence_scorer.py）

### 6.1 V5 置信度公式

```
composite_v5_score = weighted_sum(
    0.25 × method_prior          ← boundary_method_confidence(road_block_union_v5)
    0.20 × membership_score      ← 密度/纯度/规模/紧凑度/中心性
    0.20 × boundary_quality      ← quality_score(路网边界=0.85)
    0.15 × semantic_anchor_conf  ← 命名置信度
    0.10 × visual_morphology     ← VLM 审查分（启发式/远程）
    0.10 × self_validation       ← 自校验一致性
)
```

### 6.2 V5 方法置信度先验

| 方法 | 先验值 | 依据 |
|------|--------|------|
| road_block_union_v5 | 0.93 | 边界天然贴合路网 |
| aoi_fallback_v5 | 0.85 | AOI 面本身是人工标注的高质量数据 |
| euluc_fallback_v5 | 0.82 | 基于遥感影像分类 |
| convex_hull_last_resort_v5 | 0.70 | 数学凸包，不贴合实际边界 |

---

## 7. VLM 视觉形态审查（vlm_reviewer.py）

### 7.1 工作模式

```
Mode A: 启发式评分（默认，0延迟）
  score = 0.30×quality + 0.24×coverage + 0.18×road_fit + 0.16×landuse_fit + 0.12×compactness + poi_bonus

Mode B: VLM 远程评分（可选，需要 LM Studio + qwen3-vl-4b）
  输入：地图截图 data URL + 边界信息 + BBOX
  输出：{ morphology_confidence, road_fit, landuse_fit, summary }
  融合：0.7 × VLM分数 + 0.3 × 启发式分数
```

### 7.2 在 V5 中的优势

由于 `road_block_union_v5` 的边界天然贴合路网，`road_alignment_score` 和 `coverage_ratio` 会自然获得更高分。

### 7.3 VLM 地图 OCR（规划中）

**目标**：截取地图视口，VLM 提取可见地名文字，喂入 writer 环节作为分析依据。
**动机**：地图厂商已针对当前 zoom 级别优先渲染重要地名，这些信息可直接利用。

---

## 8. 前端渲染（MapContainer.vue）

### 8.1 V5 单层渲染优化

V5 的路网地块边界只有一个 polygon（不像 V1-V4 的三层 outer/transition/core），
前端判断 `region.layers` 是否有真正的多层结构：

- **有多层**：渲染 3 层（外层/过渡层/核心层）
- **无多层（V5）**：只渲染 1 层，避免 3x 重复渲染导致拖拽卡顿

### 8.2 渲染样式

| 类型 | 颜色 RGB | 填充透明度 | 描边宽度 |
|------|----------|-----------|---------|
| fuzzyCore | (16, 185, 129) | 0.15 | 2.4 |
| hotspot | (249, 115, 22) | 0.12 | 2.0 |
| vernacular | (244, 114, 182) | 0.10 | 2.0 |

---

## 9. Pipeline 全链路时序

```
Frontend (AiChat.vue)
    ↓ POST /api/ai/chat { confidenceModel: "composite_v5" }
    ↓
Backend (executor.js / spatial_pipeline.py)
    ├─ 1. 解析请求，识别 force_composite_v5 = True
    ├─ 2. 获取候选 POI（DB 查询 + 过滤）
    ├─ 3. 获取三层面数据
    │     ├─ fetch_road_blocks(bbox_wkt)     → 2634 地块
    │     ├─ fetch_osm_aoi(bbox_wkt)         → 1445 AOI
    │     └─ fetch_euluc(bbox_wkt)           → 1152 EULUC
    ├─ 4. spatial_join_pois(pois, bbox_wkt)  → 附加 block_id/aoi/euluc
    ├─ 5. HDBSCAN 聚类
    ├─ 6. block_assembler.assemble_block_boundaries()
    │     ├─ 策略1: road_block union
    │     ├─ 策略2: AOI fallback (STRtree)
    │     ├─ 策略3: EULUC fallback (STRtree)
    │     └─ 策略4: convex hull
    ├─ 7. 命名（_resolve_district_name）
    ├─ 8. 置信度评分（composite_v5）
    ├─ 9. VLM 视觉审查（启发式 or 远程）
    ├─10. 自校验
    └─11. 结果组装 → SSE stream
         ↓
Frontend (MapContainer.vue)
    └─ showAiSpatialEvidence() → 单层渲染
```

---

## 10. 已知缺陷与 TODO

| # | 问题 | 状态 | 优先级 |
|---|------|------|--------|
| 1 | 大型设施跨多个地块时被拆分为多个聚类 | TODO | 中 |
| 2 | MultiPolygon 只取最大连通部分可能丢失离散小块 | 已知 | 低 |
| 3 | 宏观地名黑名单需要针对不同城市动态扩展 | TODO | 低 |
| 4 | VLM 地图 OCR 集成（截图→提取地名→Writer） | 规划中 | 中 |
| 5 | 语义聚合：同一 AOI name 下的多聚类应当合并 | TODO | 高 |
