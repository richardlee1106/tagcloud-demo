-- =============================================================
-- pois_v2 分区迁移脚手架（可选阶段）
--
-- 目标：
-- 1) 为大规模 POI 数据提供更稳定的范围裁剪能力。
-- 2) 通过 lon 一级分区 + lat 二级分区减少单分区扫描量。
-- 3) 保持与现有 pois 字段一致，降低上层改造成本。
-- =============================================================

-- 1) 创建分区根表。
CREATE TABLE IF NOT EXISTS pois_v2 (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  name TEXT,
  address TEXT,
  type TEXT,
  category_big TEXT,
  category_mid TEXT,
  category_small TEXT,
  rating NUMERIC,
  lon DOUBLE PRECISION NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  PRIMARY KEY (id, lon)
) PARTITION BY RANGE (lon);

-- 2) 一级经度分区。
CREATE TABLE IF NOT EXISTS pois_v2_lon_west PARTITION OF pois_v2 FOR VALUES FROM (-180) TO (100) PARTITION BY RANGE (lat);
CREATE TABLE IF NOT EXISTS pois_v2_lon_central PARTITION OF pois_v2 FOR VALUES FROM (100) TO (112) PARTITION BY RANGE (lat);
CREATE TABLE IF NOT EXISTS pois_v2_lon_east PARTITION OF pois_v2 FOR VALUES FROM (112) TO (124) PARTITION BY RANGE (lat);
CREATE TABLE IF NOT EXISTS pois_v2_lon_far_east PARTITION OF pois_v2 FOR VALUES FROM (124) TO (180) PARTITION BY RANGE (lat);

-- 3) 二级纬度分区（示例，可按业务热点继续细分）。
CREATE TABLE IF NOT EXISTS pois_v2_lon_central_lat_south PARTITION OF pois_v2_lon_central FOR VALUES FROM (-90) TO (30);
CREATE TABLE IF NOT EXISTS pois_v2_lon_central_lat_north PARTITION OF pois_v2_lon_central FOR VALUES FROM (30) TO (90);

CREATE TABLE IF NOT EXISTS pois_v2_lon_east_lat_south PARTITION OF pois_v2_lon_east FOR VALUES FROM (-90) TO (30);
CREATE TABLE IF NOT EXISTS pois_v2_lon_east_lat_north PARTITION OF pois_v2_lon_east FOR VALUES FROM (30) TO (90);

-- 4) 分区局部索引（空间 + 类别）。
CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_central_lat_south_geom ON pois_v2_lon_central_lat_south USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_central_lat_north_geom ON pois_v2_lon_central_lat_north USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_east_lat_south_geom ON pois_v2_lon_east_lat_south USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_east_lat_north_geom ON pois_v2_lon_east_lat_north USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_central_lat_south_cat ON pois_v2_lon_central_lat_south (category_big, category_mid, category_small);
CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_central_lat_north_cat ON pois_v2_lon_central_lat_north (category_big, category_mid, category_small);
CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_east_lat_south_cat ON pois_v2_lon_east_lat_south (category_big, category_mid, category_small);
CREATE INDEX IF NOT EXISTS idx_pois_v2_lon_east_lat_north_cat ON pois_v2_lon_east_lat_north (category_big, category_mid, category_small);

-- 5) 回填/灰度示例（默认注释，按实际切换窗口执行）。
-- INSERT INTO pois_v2 (name, address, type, category_big, category_mid, category_small, rating, lon, lat, geom)
-- SELECT name, address, type, category_big, category_mid, category_small, rating, lon, lat, geom FROM pois;

-- 可选兼容视图（读侧替换时减少改 SQL 成本）：
-- CREATE OR REPLACE VIEW pois_compat AS
-- SELECT id, name, address, type, category_big, category_mid, category_small, rating, lon, lat, geom
-- FROM pois_v2;
