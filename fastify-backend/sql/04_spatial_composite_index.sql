-- =====================================================
-- 空间数据库复合索引优化脚本
-- 目标：优化"类别+空间"组合查询性能
-- =====================================================

-- 1. 复合空间索引 - category_big + geom
-- 用途：WHERE category_big = '餐饮' AND geom && ...
CREATE INDEX IF NOT EXISTS idx_pois_cat_big_geom 
    ON pois (category_big) USING GIST (geom);

-- 2. 复合空间索引 - category_mid + geom  
-- 用途：WHERE category_mid = '中餐' AND geom && ...
CREATE INDEX IF NOT EXISTS idx_pois_cat_mid_geom 
    ON pois (category_mid) USING GIST (geom);

-- 3. 复合空间索引 - type + geom
-- 用途：WHERE type = 'POI' AND geom && ...
CREATE INDEX IF NOT EXISTS idx_pois_type_geom 
    ON pois (type) USING GIST (geom);

-- 4. 刷新统计信息（让优化器选择最优执行计划）
ANALYZE pois;

-- 5. 查看索引是否被使用
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename = 'pois'
ORDER BY idx_scan DESC;

-- 6. 查看慢查询（需要开启 pg_stat_statements）
-- SELECT query, calls, mean_time, total_time
-- FROM pg_stat_statements
-- ORDER BY mean_time DESC
-- LIMIT 10;
