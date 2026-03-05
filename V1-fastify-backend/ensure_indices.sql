-- =====================================================
-- GeoLoom-RAG 数据库索引优化脚本
-- 目标：确保空间查询、类别过滤、文本搜索均命中索引
-- =====================================================
-- 1. 确保 PostGIS 和 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
-- 2. 确保 pg_trgm 扩展（用于中文/英文模糊匹配加速）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- =====================================================
-- 空间索引（GIST）
-- =====================================================
-- 3. 为 pois 表创建空间索引
-- 80w+ 条数据在无索引状态下查询极慢，GIST 索引是必须的
CREATE INDEX IF NOT EXISTS pois_geom_idx ON pois USING GIST (geom);
-- 4. geography 类型空间索引（消除 ::geography 转型开销）
-- 多个核心查询函数使用 ST_DWithin(geom::geography, ...)，强制转型会绕过 GIST 索引
-- 创建基于表达式的函数索引，让 PostGIS 可以直接利用索引
CREATE INDEX IF NOT EXISTS pois_geom_geography_idx ON pois USING GIST ((geom::geography));
-- =====================================================
-- 类别字段索引（B-tree + Trigram）
-- =====================================================
-- 5. B-tree 精确匹配索引
CREATE INDEX IF NOT EXISTS pois_category_mid_idx ON pois (category_mid);
CREATE INDEX IF NOT EXISTS pois_category_small_idx ON pois (category_small);
CREATE INDEX IF NOT EXISTS pois_type_idx ON pois (type);
CREATE INDEX IF NOT EXISTS pois_category_big_idx ON pois (category_big);
-- 6. GIN Trigram 模糊匹配索引
-- 核心查询 findPOIsFiltered / quickSearch 大量使用 ILIKE '%xxx%'
-- 无 trigram 索引的列会退化为全表扫描，严重影响性能
CREATE INDEX IF NOT EXISTS pois_name_trgm_idx ON pois USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pois_category_big_trgm_idx ON pois USING gin (category_big gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pois_category_mid_trgm_idx ON pois USING gin (category_mid gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pois_category_small_trgm_idx ON pois USING gin (category_small gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pois_type_trgm_idx ON pois USING gin (type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pois_address_trgm_idx ON pois USING gin (address gin_trgm_ops);
-- =====================================================
-- 向量检索索引
-- =====================================================
-- 7. 确保向量表的 HNSW 索引存在
CREATE INDEX IF NOT EXISTS poi_embeddings_vector_idx ON poi_embeddings USING hnsw (embedding vector_cosine_ops);
-- =====================================================
-- 统计信息更新
-- =====================================================
-- 8. 分析表以更新统计信息，让查询优化器选择最优执行计划
ANALYZE pois;
ANALYZE landmarks;
ANALYZE poi_embeddings;