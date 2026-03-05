-- =============================================================
-- Spatial-RAG 性能优化脚本（MVP 版）
--
-- 目标：
-- 1) 不改表结构前提下，提高主路由查询与文本匹配性能。
-- 2) 提供最小可观测任务表，辅助 jobs 状态追踪。
-- 3) 预计算物化视图，为后续热点聚合和统计查询做缓存层。
--
-- 说明：可重复执行（均使用 IF NOT EXISTS）。
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------------------------------------
-- pois 基础索引
-- -------------------------------------------------------------

-- 空间过滤主索引（ST_Within / ST_DWithin 的基础）。
CREATE INDEX IF NOT EXISTS idx_pois_geom_gist ON pois USING GIST (geom);

-- 类别三元组索引，优化 category_big/mid/small 组合过滤。
CREATE INDEX IF NOT EXISTS idx_pois_category_triplet ON pois (category_big, category_mid, category_small);

-- 名称模糊检索索引，配合 ILIKE/相似搜索。
CREATE INDEX IF NOT EXISTS idx_pois_name_trgm ON pois USING GIN (name gin_trgm_ops);

-- 导入幂等唯一键：同名同坐标视为同一 POI。
CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_name_lon_lat_unique ON pois (name, lon, lat);

-- -------------------------------------------------------------
-- jobs 状态表（可选）
-- -------------------------------------------------------------

-- 该表用于存储任务状态快照，便于后续做审计与报表。
CREATE TABLE IF NOT EXISTS spatial_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  stage TEXT,
  progress NUMERIC,
  error TEXT,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 状态和时间索引用于后台任务列表/按状态筛选。
CREATE INDEX IF NOT EXISTS idx_spatial_jobs_status ON spatial_jobs (status);
CREATE INDEX IF NOT EXISTS idx_spatial_jobs_created_at ON spatial_jobs (created_at DESC);

-- -------------------------------------------------------------
-- 物化视图（统计缓存）
-- -------------------------------------------------------------
-- 命名保持与规划一致：mv_poi_h3_r7_stats / mv_poi_h3_r9_stats。
-- 当前实现先采用“经纬度网格桶”近似，后续可切换真 H3 编码。

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_poi_h3_r7_stats AS
SELECT
  floor(lon * 100.0) / 100.0 AS grid_lon,
  floor(lat * 100.0) / 100.0 AS grid_lat,
  count(*) AS poi_count,
  avg(rating) AS avg_rating
FROM pois
GROUP BY 1, 2;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_poi_h3_r9_stats AS
SELECT
  floor(lon * 500.0) / 500.0 AS grid_lon,
  floor(lat * 500.0) / 500.0 AS grid_lat,
  count(*) AS poi_count,
  avg(rating) AS avg_rating
FROM pois
GROUP BY 1, 2;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_category_density AS
SELECT
  category_big,
  category_mid,
  category_small,
  count(*) AS poi_count,
  avg(rating) AS avg_rating
FROM pois
GROUP BY category_big, category_mid, category_small;

-- -------------------------------------------------------------
-- 刷新建议
-- -------------------------------------------------------------
-- 建议以 5 分钟调度刷新，并使用 CONCURRENTLY 降低读阻塞：
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_poi_h3_r7_stats;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_poi_h3_r9_stats;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_category_density;
