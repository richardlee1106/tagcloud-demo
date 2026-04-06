-- =====================================================
-- TagCloud Spatial-RAG 数据库初始化脚本
-- 数据库: tagcloud
-- 使用方法: 
--   1. 在 pgAdmin 中执行此脚本
--   2. 或使用命令: psql -U postgres -h localhost -p 5432 -f init_database.sql
-- =====================================================

-- 1. 创建数据库（如果不存在）
-- 注意：此语句需要单独执行，或使用 psql 的 \gexec
-- CREATE DATABASE tagcloud;

-- 2. 连接到 tagcloud 数据库后执行以下内容
-- \c tagcloud

-- 3. 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS postgis;           -- 空间数据支持
CREATE EXTENSION IF NOT EXISTS postgis_topology;  -- 拓扑支持
CREATE EXTENSION IF NOT EXISTS pg_trgm;           -- 模糊搜索支持

-- 4. 创建 POI 主表
CREATE TABLE IF NOT EXISTS pois (
    id              SERIAL PRIMARY KEY,
    poiid           VARCHAR(50) UNIQUE,           -- 高德 POI ID
    name            VARCHAR(255) NOT NULL,        -- 名称
    address         TEXT,                         -- 地址
    type            VARCHAR(255),                 -- 类型字符串（如 "餐饮服务;快餐厅;麦当劳"）
    typecode        VARCHAR(20),                  -- 类型编码
    
    -- 分类字段
    category_big    VARCHAR(100),                 -- 大类
    category_mid    VARCHAR(100),                 -- 中类
    category_small  VARCHAR(100),                 -- 小类
    
    -- 地理信息
    province        VARCHAR(50),                  -- 省份
    city            VARCHAR(50),                  -- 城市
    district        VARCHAR(50),                  -- 区县
    business_area   VARCHAR(100),                 -- 商圈
    
    -- 空间字段（WGS84 坐标系）
    geom            GEOMETRY(POINT, 4326),        -- PostGIS 几何点
    geohash         VARCHAR(12),                  -- GeoHash 编码（精度 7-9）
    
    -- 联系信息
    tel             VARCHAR(255),                 -- 电话
    
    -- 语义搜索字段
    search_text     TEXT,                         -- 拼接的搜索文本
    
    -- 元数据
    fetch_time      TIMESTAMP,                    -- 数据爬取时间
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. 创建空间索引（GIST 索引，用于空间查询）
CREATE INDEX IF NOT EXISTS idx_pois_geom ON pois USING GIST (geom);

-- 6. 创建 GeoHash 索引（B-Tree，用于前缀匹配快速过滤）
CREATE INDEX IF NOT EXISTS idx_pois_geohash ON pois USING BTREE (geohash);

-- 7. 创建分类索引
CREATE INDEX IF NOT EXISTS idx_pois_category_big ON pois (category_big);
CREATE INDEX IF NOT EXISTS idx_pois_category_mid ON pois (category_mid);
CREATE INDEX IF NOT EXISTS idx_pois_category_small ON pois (category_small);

-- 8. 创建商圈索引
CREATE INDEX IF NOT EXISTS idx_pois_business_area ON pois (business_area);

-- 9. 创建全文搜索索引（中文需要 zhparser 扩展，这里用 pg_trgm 做模糊匹配）
CREATE INDEX IF NOT EXISTS idx_pois_name_trgm ON pois USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pois_search_text_trgm ON pois USING GIN (search_text gin_trgm_ops);

-- 10. 创建锚点缓存表（用于缓存外部地理编码结果，提升常用地标查询效率）
-- 注意：这是一个缓存表，主要数据源是 POI 表和外部地理编码 API
CREATE TABLE IF NOT EXISTS landmarks (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,        -- 名称
    alias           VARCHAR(255)[],               -- 别名数组
    type            VARCHAR(50),                  -- 类型: university, metro, landmark, gate, external
    parent_name     VARCHAR(255),                 -- 所属上级（如校门属于某大学）
    geom            GEOMETRY(POINT, 4326),        -- 位置
    geohash         VARCHAR(12),
    metadata        JSONB,                        -- 其他元数据
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_landmarks_geom ON landmarks USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landmarks_name ON landmarks (name);
CREATE INDEX IF NOT EXISTS idx_landmarks_type ON landmarks (type);
CREATE INDEX IF NOT EXISTS idx_landmarks_parent ON landmarks (parent_name);

-- 锚点解析说明：
-- 1. 优先从 POI 表中查找（你已有的十几万 POI 数据）
-- 2. 其次从 landmarks 缓存表查找
-- 3. 最后调用高德地理编码 API，并将结果缓存到 landmarks 表
-- 
-- 这意味着：
-- - 任何 POI 都可以作为锚点（如"麦当劳(武汉未来城餐厅)附近"）
-- - 任何地址都可以通过高德 API 解析（如"武汉理工大学南门"）
-- - 常用查询会被自动缓存，提升后续查询速度

-- 11. 创建空间查询常用函数

-- 函数：查询某点周围指定半径内的 POI
CREATE OR REPLACE FUNCTION find_pois_within_radius(
    center_lon DOUBLE PRECISION,
    center_lat DOUBLE PRECISION,
    radius_meters INTEGER,
    category_filter VARCHAR DEFAULT NULL,
    limit_count INTEGER DEFAULT 100
)
RETURNS TABLE (
    poi_id INTEGER,
    poi_name VARCHAR,
    poi_address TEXT,
    poi_type VARCHAR,
    distance_meters DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    lat DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.name,
        p.address,
        p.type,
        ST_Distance(
            p.geom::geography,
            ST_SetSRID(ST_MakePoint(center_lon, center_lat), 4326)::geography
        ) AS dist,
        ST_X(p.geom),
        ST_Y(p.geom)
    FROM pois p
    WHERE 
        ST_DWithin(
            p.geom::geography,
            ST_SetSRID(ST_MakePoint(center_lon, center_lat), 4326)::geography,
            radius_meters
        )
        AND (category_filter IS NULL OR p.type ILIKE '%' || category_filter || '%')
    ORDER BY dist
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 函数：根据地名和门名查找锚点坐标（从 POI 或 landmarks 表）
CREATE OR REPLACE FUNCTION resolve_landmark(
    place_name VARCHAR,
    gate_name VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    landmark_name VARCHAR,
    lon DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    source VARCHAR
) AS $$
DECLARE
    search_term VARCHAR;
BEGIN
    -- 构造搜索词
    IF gate_name IS NOT NULL THEN
        search_term := place_name || gate_name;
    ELSE
        search_term := place_name;
    END IF;
    
    -- 1. 先从 POI 表查找
    RETURN QUERY
    SELECT 
        p.name,
        ST_X(p.geom),
        ST_Y(p.geom),
        'poi'::VARCHAR
    FROM pois p
    WHERE p.name ILIKE '%' || search_term || '%'
    ORDER BY similarity(p.name, search_term) DESC
    LIMIT 1;
    
    IF FOUND THEN
        RETURN;
    END IF;
    
    -- 2. 再从 landmarks 缓存表查找
    IF gate_name IS NOT NULL THEN
        RETURN QUERY
        SELECT 
            l.name,
            ST_X(l.geom),
            ST_Y(l.geom),
            'landmark'::VARCHAR
        FROM landmarks l
        WHERE l.parent_name ILIKE '%' || place_name || '%'
          AND l.name ILIKE '%' || gate_name || '%'
        LIMIT 1;
        
        IF FOUND THEN
            RETURN;
        END IF;
    END IF;
    
    -- 模糊匹配地名
    RETURN QUERY
    SELECT 
        l.name,
        ST_X(l.geom),
        ST_Y(l.geom),
        'landmark'::VARCHAR
    FROM landmarks l
    WHERE l.name ILIKE '%' || place_name || '%'
       OR place_name = ANY(l.alias)
    ORDER BY 
        CASE WHEN l.name = place_name THEN 0 ELSE 1 END
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- 12. 不预设任何锚点数据
-- landmarks 表的数据会在运行时通过以下方式自动填充：
-- 1. 用户查询时，如果从高德 API 解析成功，会自动缓存到此表
-- 2. 可以手动批量导入常用地标（可选）
--
-- 如果需要手动添加热门地标，可以使用以下格式：
-- INSERT INTO landmarks (name, alias, type, parent_name, geom, geohash) VALUES
-- ('地标名称', ARRAY['别名1', '别名2'], 'landmark', NULL, ST_SetSRID(ST_MakePoint(经度, 纬度), 4326), 'geohash');

-- 13. 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pois_updated_at ON pois;
CREATE TRIGGER trg_pois_updated_at
    BEFORE UPDATE ON pois
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- 完成
SELECT 'TagCloud 数据库初始化完成！' AS status;
