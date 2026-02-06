-- GeoLoom-RAG 数据库初始化
-- 创建必要的扩展和表结构

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- POI 主表（如果不存在）
CREATE TABLE IF NOT EXISTS pois (
    id SERIAL PRIMARY KEY,
    name VARCHAR(500),
    lon DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    address VARCHAR(1000),
    category_big VARCHAR(100),
    category_mid VARCHAR(100),
    category_small VARCHAR(100),
    type VARCHAR(200),
    rating NUMERIC(3,1),
    geom geometry(Point, 4326),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 空间索引
CREATE INDEX IF NOT EXISTS pois_geom_idx ON pois USING GIST(geom);
CREATE INDEX IF NOT EXISTS pois_category_idx ON pois(category_big, category_mid);
CREATE UNIQUE INDEX IF NOT EXISTS pois_name_lon_lat_uniq ON pois(name, lon, lat);

-- 向量表
CREATE TABLE IF NOT EXISTS poi_embeddings (
    id SERIAL PRIMARY KEY,
    poi_id INTEGER REFERENCES pois(id) ON DELETE CASCADE,
    name VARCHAR(500),
    embedding vector(768),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(poi_id)
);

-- 向量索引 (HNSW)
CREATE INDEX IF NOT EXISTS poi_embeddings_vector_idx 
ON poi_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 提示
DO $$
BEGIN
    RAISE NOTICE '✅ GeoLoom-RAG 数据库初始化完成';
    RAISE NOTICE '📊 请使用 pg_dump 导入 POI 数据';
END $$;
