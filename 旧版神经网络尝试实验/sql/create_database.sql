-- =====================================================
-- 创建 tagcloud 数据库
-- 在 pgAdmin 中执行此脚本（连接到 postgres 数据库后执行）
-- =====================================================

-- 创建数据库
CREATE DATABASE tagcloud
    WITH 
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'Chinese (Simplified)_China.936'
    LC_CTYPE = 'Chinese (Simplified)_China.936'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1;

COMMENT ON DATABASE tagcloud IS 'TagCloud Spatial-RAG 数据库';
