---
name: postgis
description: 处理地理数据、空间查询、几何操作或位置功能时强制使用 PostGIS 3.4.2 最佳实践，包括 pgvector 集成、bigint 拓扑和 KNN 优化
---

# PostGIS 3.4.2 空间数据库

## 环境信息

| 组件 | 版本 | 备注 |
|------|------|------|
| PostgreSQL | 16.2 | Debian 16.2-1.pgdg120+2 |
| PostGIS | 3.4.2 | c19ce56, PGSQL=160 |
| GEOS | 3.11.1 | CAPI-1.17.1 |
| PROJ | 9.1.1 | NETWORK_DISABLED |
| SFCGAL | **不可用** | postgis_sfcgal 扩展存在但未编译进 PostGIS |
| WAGYU | 0.5.0 | Internal |

编译标志：`USE_GEOS=1 USE_PROJ=1 USE_STATS=1`（**无** `USE_SFCGAL`）

**核心理念：** 空间数据是特殊的。通用数据库模式在地理数据上往往失效。

**开头声明：** "I'm applying postgis to ensure PostGIS 3.4.2 spatial best practices."

## 适用场景

满足以下任意条件时**强制**使用此 skill：

| 模式 | 示例文件 |
|------|---------|
| `**/*geo*` | models/geography.ts, geo_utils.py |
| `**/*spatial*` | lib/spatial.ts |
| `**/*location*` | services/locationService.ts |
| `**/*coordinate*` | types/coordinates.ts |
| `**/*polygon*` | db/polygons.sql |
| `**/*geometry*` | migrations/add_geometry.sql |
| `**/*postgis*` | setup/postgis.sql |
| `**/*gis*` | utils/gis.ts |

或文件中包含：

```sql
-- 这些模式会触发此 skill
ST_*
geography
geometry
SRID
```

## PostGIS 3.4 功能特性

### 1. 内置 3D 函数（有限）

PostGIS 3.4 包含**少量**原生 3D 函数（不依赖 SFCGAL）：

```sql
-- 3D 距离
SELECT ST_3DDistance(geom1, geom2);

-- 3D 边界框范围
SELECT ST_3DExtent(geom) FROM features;

-- 3D 长度（用于 LineString Z）
SELECT ST_3DLength(geom);

-- 3D 周长（用于 Polygon Z）
SELECT ST_3DPerimeter(geom);

-- 3D DWithin（在 3D 空间中进行距离判断）
SELECT * FROM features
WHERE ST_3DDWithin(geom, query_geom, tolerance);
```

**以下函数不可用（需 SFCGAL）：** `ST_3DIntersection`、`ST_3DUnion`、`ST_3DArea`、`ST_StraightSkeleton`、`ST_Extrude`、`ST_MinkowskiSum`

### 2. Bigint 拓扑支持

PostGIS 3.4 支持 bigint 拓扑 ID，适用于超大规模数据集：

```sql
-- 创建 bigint ID 的拓扑
SELECT CreateTopology('massive_parcels', 4326, 0.0000001, true);
-- 最后一个参数: use_bigint = true

-- 支持每个拓扑 > 20 亿个要素
-- 旧版限制：约 20 亿（int4 最大值）

-- 添加图层
SELECT AddTopoGeometryColumn('massive_parcels', 'public', 'parcels', 'topogeom', 'POLYGON');

-- TopoGeometry 操作相同
SELECT ST_CreateTopoGeo('massive_parcels', geom);
```

**适用场景：**
- 国家/洲级别数据集
- 高分辨率宗地数据
- OpenStreetMap 导入
- 任何 > 20 亿边的拓扑

### 3. PostgreSQL 16 兼容性

PostGIS 3.4.2 基于 PostgreSQL 16 构建：

```sql
-- PostgreSQL 16 中与 PostGIS 相关的改进：
-- - 改进的查询取消处理
-- - 大规模空间操作更好的内存管理
-- - 空间索引并行查询优化

-- COPY 操作可靠工作
COPY (SELECT id, ST_AsGeoJSON(geom) FROM features) TO '/tmp/export.json';

-- 长耗时空间操作可被干净地取消
SELECT ST_Union(geom)
FROM very_large_table
GROUP BY region;
```

### 4. 几何有效性检验与修复

```sql
-- 检查有效性
SELECT id, ST_IsValid(geom), ST_IsValidReason(geom)
FROM features
WHERE NOT ST_IsValid(geom);

-- 常见问题：
-- "Self-intersection"（自相交）
-- "Ring Self-intersection"（环自相交）
-- "Too few points in geometry component"（几何分量点数不足）
-- "Hole lies outside shell"（空洞超出外壳）

-- 简单修复
UPDATE features
SET geom = ST_MakeValid(geom)
WHERE NOT ST_IsValid(geom);

-- 指定策略修复（PostGIS 3.4+）
UPDATE features
SET geom = ST_MakeValid(geom, 'method=structure')
WHERE NOT ST_IsValid(geom);

-- 网格捕捉修复精度问题
UPDATE features
SET geom = ST_SnapToGrid(geom, 0.000001)
WHERE ST_NPoints(geom) > 1000;
```

**注意：** `ST_CoverageClean` 在 PostGIS 3.6+ 可用。3.4 中使用 `ST_MakeValid` 逐条迭代修复覆盖。

## 数据类型

### Geometry vs Geography

```sql
-- GEOMETRY：平面坐标，支持任意 SRID
-- 计算更快，大距离精度较低
CREATE TABLE places_geometry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location geometry(Point, 4326)  -- WGS84
);

-- GEOGRAPHY：球面坐标，始终 WGS84
-- 距离/面积计算精确，计算较慢
CREATE TABLE places_geography (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location geography(Point, 4326)  -- 始终 WGS84
);

-- 使用 GEOMETRY 的场景：
-- - 本地/城市级应用
-- - 需要复杂操作（并集、交集）
-- - 性能敏感
-- - 非地球数据（游戏地图、楼层平面图）

-- 使用 GEOGRAPHY 的场景：
-- - 全球应用
-- - 距离/面积精度要求高
-- - 简单操作（距离、包含）
-- - 用户可见的距离计算
```

### 选择 SRID

```sql
-- 常用 SRID：
-- 4326: WGS84（GPS 坐标、Web 地图）
-- 3857: Web 墨卡托（瓦片 Web 地图，仅用于展示）
-- 本地投影用于精确测量

-- 始终以 4326（WGS84）存储作为数据源
-- 需要时转换用于计算

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location geography(Point, 4326),  -- 存储
  location_local geometry(Point)     -- NULL，按需计算
);

-- 转换用于本地计算
SELECT ST_Transform(
  location::geometry,
  32610  -- UTM Zone 10N（加州）
) FROM locations WHERE name = 'San Francisco';
```

## 索引策略

### 空间索引

```sql
-- GiST 索引：大多数空间查询的默认选择
CREATE INDEX idx_locations_geom ON locations USING gist(location);

-- BRIN 索引：适用于自然有序的超大数据集
--（例如按时间排序的 GPS 轨迹）
CREATE INDEX idx_tracks_geom ON gps_tracks USING brin(location);

-- SP-GiST：适用于无重叠数据（点、IP 范围）
CREATE INDEX idx_points_spgist ON points USING spgist(location);
```

### 索引最佳实践

```sql
-- 始终创建空间索引
CREATE TABLE features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geom geometry(Polygon, 4326),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_features_geom ON features USING gist(geom);

-- 活跃记录的局部空间索引
CREATE INDEX idx_features_geom_active ON features USING gist(geom)
  WHERE deleted_at IS NULL;

-- 常见查询模式的复合索引
CREATE INDEX idx_features_type_geom ON features USING gist(geom)
  WHERE feature_type = 'building';

-- 并发创建索引（不阻塞读写）
CREATE INDEX CONCURRENTLY idx_features_geom ON features USING gist(geom);
```

### 索引聚类

```sql
-- 按空间索引聚类表，提升范围查询性能
CLUSTER features USING idx_features_geom;

-- 大表定期重新聚类
-- 在维护窗口期间执行
```

## 查询模式

### 距离查询

```sql
-- 查找指定距离内的点（geography，单位：米）
SELECT * FROM locations
WHERE ST_DWithin(
  location,
  ST_MakePoint(-122.4194, 37.7749)::geography,
  1000  -- 1km 半径
);

-- 查找指定距离内的点（geometry，单位：SRID 单位）
SELECT * FROM locations
WHERE ST_DWithin(
  location,
  ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326),
  0.01  -- 此纬度约 1km（度数）
);

-- K 近邻（KNN）—— 利用空间索引
SELECT *, location <-> ST_MakePoint(-122.4194, 37.7749)::geography AS distance
FROM locations
ORDER BY location <-> ST_MakePoint(-122.4194, 37.7749)::geography
LIMIT 10;
-- 使用索引高效实现 KNN
```

### 包含查询

```sql
-- 点在多边形内
SELECT * FROM points
WHERE ST_Within(location, (
  SELECT boundary FROM regions WHERE name = 'California'
));

-- 多边形包含点
SELECT * FROM regions
WHERE ST_Contains(boundary, ST_MakePoint(-122.4194, 37.7749));

-- 相交（任意方式重叠）
SELECT * FROM features
WHERE ST_Intersects(geom, query_polygon);
```

### 聚合查询

```sql
-- 合并所有几何体
SELECT ST_Union(geom) FROM parcels WHERE owner = 'City';

-- 收集但不合并（更快，保留独立几何体）
SELECT ST_Collect(geom) FROM parcels WHERE owner = 'City';

-- 范围（边界框）
SELECT ST_Extent(geom) FROM features;

-- 所有点的质心
SELECT ST_Centroid(ST_Collect(location)) FROM locations;
```

## GeoJSON 集成

### 导入/导出

```sql
-- 几何体转 GeoJSON
SELECT ST_AsGeoJSON(location) FROM locations WHERE id = $1;

-- 几何体带属性转 Feature
SELECT jsonb_build_object(
  'type', 'Feature',
  'geometry', ST_AsGeoJSON(location)::jsonb,
  'properties', jsonb_build_object(
    'id', id,
    'name', name
  )
) FROM locations WHERE id = $1;

-- FeatureCollection
SELECT jsonb_build_object(
  'type', 'FeatureCollection',
  'features', jsonb_agg(
    jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(location)::jsonb,
      'properties', jsonb_build_object('id', id, 'name', name)
    )
  )
) FROM locations;

-- GeoJSON 转几何体
INSERT INTO locations (name, location)
VALUES ('New Place', ST_GeomFromGeoJSON($1));

-- 强制 SRID
INSERT INTO locations (name, location)
VALUES ('New Place', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326));
```

### API 响应模式

```sql
-- API 端点函数
CREATE OR REPLACE FUNCTION get_locations_geojson(
  bounds geometry DEFAULT NULL
)
RETURNS jsonb AS $$
SELECT jsonb_build_object(
  'type', 'FeatureCollection',
  'features', COALESCE(jsonb_agg(
    jsonb_build_object(
      'type', 'Feature',
      'id', id,
      'geometry', ST_AsGeoJSON(location, 6)::jsonb,  -- 6 位小数
      'properties', jsonb_build_object(
        'name', name,
        'created_at', created_at
      )
    )
  ), '[]'::jsonb)
)
FROM locations
WHERE bounds IS NULL OR ST_Intersects(location::geometry, bounds);
$$ LANGUAGE sql STABLE;
```

## 性能优化

### 查询优化

```sql
-- 使用 && 进行边界框预过滤（利用索引）
SELECT * FROM features
WHERE geom && ST_MakeEnvelope(-122.5, 37.7, -122.4, 37.8, 4326)
  AND ST_Intersects(geom, query_polygon);

-- 简化用于展示（减少传输体积）
SELECT id, ST_Simplify(geom, 0.0001) AS geom_display
FROM features;

-- 视口感知简化
SELECT id,
  CASE
    WHEN zoom < 10 THEN ST_Simplify(geom, 0.01)
    WHEN zoom < 14 THEN ST_Simplify(geom, 0.001)
    ELSE geom
  END AS geom
FROM features
WHERE geom && viewport_bounds;
```

### 大表空间设计

```sql
-- 将几何体与属性分离（适用于大表）
CREATE TABLE features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE feature_geometries (
  feature_id uuid PRIMARY KEY REFERENCES features(id) ON DELETE CASCADE,
  geom geometry(Geometry, 4326),
  geom_simplified geometry(Geometry, 4326)  -- 预计算的简化几何体
);

CREATE INDEX idx_feature_geom ON feature_geometries USING gist(geom);
CREATE INDEX idx_feature_geom_simple ON feature_geometries USING gist(geom_simplified);
```

### 物化视图加速复杂查询

```sql
-- 预计算空间连接
CREATE MATERIALIZED VIEW feature_regions AS
SELECT f.id AS feature_id, r.id AS region_id, r.name AS region_name
FROM features f
JOIN regions r ON ST_Within(f.location, r.boundary);

CREATE UNIQUE INDEX idx_feature_regions ON feature_regions(feature_id);

-- 定期刷新
REFRESH MATERIALIZED VIEW CONCURRENTLY feature_regions;
```

## 迁移模式

### 添加空间列

```sql
-- 步骤 1：添加列
ALTER TABLE locations ADD COLUMN geom geometry(Point, 4326);

-- 步骤 2：创建索引
CREATE INDEX CONCURRENTLY idx_locations_geom ON locations USING gist(geom);

-- 步骤 3：从经纬度回填数据
UPDATE locations
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE geom IS NULL AND latitude IS NOT NULL;

-- 步骤 4：按需添加约束
ALTER TABLE locations ADD CONSTRAINT locations_geom_4326
  CHECK (ST_SRID(geom) = 4326);
```

### Geometry 转 Geography

```sql
-- 创建新列
ALTER TABLE locations ADD COLUMN location_geo geography(Point, 4326);

-- 迁移数据
UPDATE locations
SET location_geo = location::geography
WHERE location_geo IS NULL;

-- 在新列上创建索引
CREATE INDEX CONCURRENTLY idx_locations_geo ON locations USING gist(location_geo);

-- 应用更新后删除旧列
ALTER TABLE locations DROP COLUMN location;
ALTER TABLE locations RENAME COLUMN location_geo TO location;
```

## PostGIS 实施清单

实施空间功能时，发布此清单：

```markdown
<!-- POSTGIS_IMPLEMENTATION:START -->
## PostGIS 实施总结

### 环境信息
- PostgreSQL: 16.2
- PostGIS: 3.4.2
- GEOS: 3.11.1

### 空间列

| 表名 | 列名 | 类型 | SRID | 索引 |
|------|------|------|------|------|
| locations | location | geography(Point) | 4326 | gist |
| parcels | boundary | geometry(Polygon) | 4326 | gist |

### 使用的 PostGIS 3.4 特性

- [ ] Bigint 拓扑（如有 > 20 亿边）
- [ ] KNN 操作符（<->）实现最近邻
- [ ] ST_MakeValid 修复几何体
- [ ] ST_3DDWithin / ST_3DDistance 进行 3D 查询（内置，无需 SFCGAL）

### 空间查询

| 查询模式 | 是否使用索引 | 性能 |
|---------|------------|------|
| KNN 距离查询 | 是（gist） | <10ms |
| ST_Within 区域查询 | 是（gist） | <50ms |
| ST_Intersects 相交查询 | 是（gist） | <100ms |

### 验证项

- [ ] 所有几何体通过 ST_IsValid 检验
- [ ] SRID 约束已强制执行
- [ ] 空间索引已创建
- [ ] 查询模式已用 EXPLAIN ANALYZE 验证

**PostGIS 版本：** 3.4.2
**GEOS 版本：** 3.11.1
**SFCGAL：** 不可用
**验证时间：** [时间戳]
<!-- POSTGIS_IMPLEMENTATION:END -->
```

## 检查清单

完成 PostGIS 实施前：

- [ ] 已选择正确数据类型（geometry vs geography）
- [ ] SRID 一致（推荐存储为 4326）
- [ ] 所有几何列已创建空间索引
- [ ] 输入几何体已验证（ST_IsValid）
- [ ] GeoJSON 导入/导出已测试
- [ ] 查询性能已用 EXPLAIN ANALYZE 验证
- [ ] **未使用 SFCGAL 函数**（ST_3DIntersection、ST_3DUnion 等——未编译进）
- [ ] 实施清单已发布

## 关联 Skill

此 skill 与以下 skill 配合使用：
- `database-architecture` - 空间列遵循通用 schema 模式
- `postgres-rls` - RLS 策略可使用空间谓词
- `timescaledb` - 带空间维度的时序数据

## 参考资料

- [PostGIS 3.4 文档](https://postgis.net/docs/manual-3.4/)
- [PostGIS 3.4.2 发行说明](https://postgis.net/docs/release_notes_3_4_2/)
- [GEOS 3.11.1 变更日志](https://libgeos.org/usage/download/)
