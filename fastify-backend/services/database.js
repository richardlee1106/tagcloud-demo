/**
 * PostgreSQL + PostGIS 数据库服务
 * 用于空间数据存储和查询
 */

import pg from "pg";
const { Pool } = pg;

// 数据库连接池
let pool = null;

// rating 字段在部分查询链路缺失，统一返回 NULL 以保证 SQL 列结构稳定
const POI_RATING_SELECT_SQL = "NULL::double precision AS rating";

/**
 * 初始化数据库连接
 */
export async function initDatabase() {
  if (pool) return pool;

  // ӳشСͨƣ䲻ͬ𳡾
  // - 本地/Docker: POSTGRES_POOL_MAX=10~20（默认 10）
  // - Serverless（Vercel）: POSTGRES_POOL_MAX=3~5，建议搭配 PgBouncer
  const poolMax = Math.max(
    1,
    parseInt(process.env.POSTGRES_POOL_MAX || "10", 10),
  );
  const poolMin = Math.max(
    0,
    parseInt(process.env.POSTGRES_POOL_MIN || "2", 10),
  );

  const dbConfig = {
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "123456",
    database: process.env.POSTGRES_DATABASE || "geoloom",
    max: poolMax, // 最大连接数，支持并发查询
    min: poolMin, // 最小保活连接数，减少冷启动延迟
    connectionTimeoutMillis: 10000, // 连接超时 10s
    idleTimeoutMillis: 30000, // 空闲连接 30s 后回收，防止连接泄漏
    query_timeout: 45000, // 单个查询超时 45s
  };

  // Vercel / Remote DB 可能需要 SSL
  if (process.env.SSL_MODE) {
    dbConfig.ssl = {
      rejectUnauthorized: false,
    };
  }

  pool = new Pool(dbConfig);

  // ֹ Pool Ӧùҵ
  pool.on("error", (err, client) => {
    console.error("Unexpected error on idle client", err);
    // don't throw error here to keep the process alive
  });

  // 测试连接
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT PostGIS_Version()");
    console.log(
      `✅ PostgreSQL + PostGIS 连接成功 (PostGIS ${result.rows[0].postgis_version})`,
    );
    client.release();
  } catch (err) {
    // 提供更友好的错误信息
    if (err.code === "3D000") {
      console.error(`\n❌ 数据库 "${dbConfig.database}" 不存在！`);
      console.error(`\n📋 请按以下步骤创建数据库：`);
      console.error(`   1. 打开 pgAdmin`);
      console.error(
        `   2. 连接到 PostgreSQL 服务器 (${dbConfig.host}:${dbConfig.port})`,
      );
      console.error(`   3. 右键点击 "Databases" -> "Create" -> "Database..."`);
      console.error(`   4. 输入数据库名称: tagcloud`);
      console.error(`   5. 点击 "Save" 创建数据库`);
      console.error(
        `   6. 在新建的 tagcloud 数据库上执行: scripts/sql/init_database.sql`,
      );
      console.error(`\n   或者在 pgAdmin 的 SQL 编辑器中执行:`);
      console.error(`   CREATE DATABASE tagcloud;`);
      console.error(``);
    } else if (err.code === "ECONNREFUSED") {
      console.error(`\n❌ 无法连接到 PostgreSQL 服务器！`);
      console.error(`   请确保 PostgreSQL 服务正在运行。`);
      console.error(`   连接地址: ${dbConfig.host}:${dbConfig.port}`);
    } else {
      console.error("❌ 数据库连接失败:", err.message);
    }
    throw err;
  }

  return pool;
}

/**
 * 获取数据库连接池
 */
export function getPool() {
  if (!pool) {
    throw new Error("数据库未初始化，请先调用 initDatabase()");
  }
  return pool;
}

/**
 * 执行查询
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;

  if (duration > 100) {
    console.log(`[DB] 慢查询 (${duration}ms):`, text.substring(0, 100));
  }

  return result;
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("数据库连接已关闭");
  }
}

// =====================================================
// 空间查询函数
// =====================================================

/**
 * 查询某点周围指定半径内的 POI
 * @param {number} lon 经度
 * @param {number} lat 纬度
 * @param {number} radiusMeters 半径（米）
 * @param {Object} filters 过滤条件
 * @returns {Promise<Array>} POI 列表
 */
export async function findPOIsWithinRadius(
  lon,
  lat,
  radiusMeters,
  filters = {},
) {
  const { category, minRating, limit = 100 } = filters;

  let sql = `
    SELECT 
      p.id,
      p.name,
      p.address,
      p.type,
      p.category_big,
      p.category_mid,
      p.category_small,
      ${POI_RATING_SELECT_SQL},
      ST_Distance(
        p.geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) AS distance_meters,
      ST_X(p.geom) AS lon,
      ST_Y(p.geom) AS lat
    FROM pois p
    WHERE ST_DWithin(
      p.geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
  `;

  const params = [lon, lat, radiusMeters];
  let paramIndex = 4;

  // 类别过滤
  if (category) {
    sql += ` AND (p.type ILIKE $${paramIndex} OR p.category_mid ILIKE $${paramIndex} OR p.category_small ILIKE $${paramIndex})`;
    // Ϊģƥǰ󶼼 %ȷѵ "в" ʹݿ "в" Ҳܾƥ䣨֮Ȼ
    params.push(`%${category}%`);
    paramIndex++;
  }

  sql += ` ORDER BY distance_meters LIMIT $${paramIndex}`;
  // ޸ģûҪȫݣǽĬ 50
  // 只要前端敢要，后端就敢给
  const maxLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || "20000", 10);
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isFinite(normalizedLimit)
    ? Math.max(1, Math.min(normalizedLimit, maxLimit))
    : Math.min(100, maxLimit);
  params.push(safeLimit);

  const result = await query(sql, params);
  return result.rows;
}

/**
 * 根据方向过滤 POI
 * @param {number} centerLon 中心点经度
 * @param {number} centerLat 中心点纬度
 * @param {string} direction 方向 (东/西/南/北/东北/东南/西北/西南)
 * @param {number} radiusMeters 半径
 * @param {number} toleranceDegrees 角度容差（默认 60 度）
 */
export async function findPOIsByDirection(
  centerLon,
  centerLat,
  direction,
  radiusMeters,
  toleranceDegrees = 60,
) {
  const directionAngles = {
    东: 90,
    西: 270,
    南: 180,
    北: 0,
    东北: 45,
    东南: 135,
    西南: 225,
    西北: 315,
  };

  const targetAngle = directionAngles[direction];
  if (targetAngle === undefined) {
    // 如果是"对面""附近"等，不做方向过滤
    return findPOIsWithinRadius(centerLon, centerLat, radiusMeters);
  }

  const sql = `
    SELECT 
      p.id,
      p.name,
      p.address,
      p.type,
      p.category_big,
      p.category_mid,
      p.category_small,
      ${POI_RATING_SELECT_SQL},
      ST_Distance(
        p.geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) AS distance_meters,
      ST_X(p.geom) AS lon,
      ST_Y(p.geom) AS lat,
      degrees(ST_Azimuth(
        ST_SetSRID(ST_MakePoint($1, $2), 4326),
        p.geom
      )) AS bearing
    FROM pois p
    WHERE ST_DWithin(
      p.geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
    AND (
      ABS(degrees(ST_Azimuth(
        ST_SetSRID(ST_MakePoint($1, $2), 4326),
        p.geom
      )) - $4) <= $5
      OR 
      ABS(degrees(ST_Azimuth(
        ST_SetSRID(ST_MakePoint($1, $2), 4326),
        p.geom
      )) - $4) >= (360 - $5)
    )
    ORDER BY distance_meters
    LIMIT 100
  `;

  const result = await query(sql, [
    centerLon,
    centerLat,
    radiusMeters,
    targetAngle,
    toleranceDegrees,
  ]);
  return result.rows;
}

/**
 * 解析锚点坐标（从 landmarks 表查询）
 * @param {string} placeName 地名
 * @param {string} gateName 门名（可选）
 * @returns {Promise<{lon: number, lat: number}|null>}
 */
export async function resolveLandmark(placeName, gateName = null) {
  let sql;
  let params;

  if (gateName) {
    // 先尝试匹配门
    sql = `
      SELECT 
        name,
        ST_X(geom) AS lon,
        ST_Y(geom) AS lat
      FROM landmarks
      WHERE parent_name ILIKE $1
        AND name ILIKE $2
      LIMIT 1
    `;
    params = [`%${placeName}%`, `%${gateName}%`];

    const result = await query(sql, params);
    if (result.rows.length > 0) {
      return { lon: result.rows[0].lon, lat: result.rows[0].lat };
    }
  }

  // 模糊匹配地名
  sql = `
    SELECT 
      name,
      ST_X(geom) AS lon,
      ST_Y(geom) AS lat
    FROM landmarks
    WHERE name ILIKE $1
       OR $1 = ANY(alias)
    ORDER BY 
      CASE WHEN name = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `;
  params = [`%${placeName}%`];

  const result = await query(sql, params);
  if (result.rows.length > 0) {
    return { lon: result.rows[0].lon, lat: result.rows[0].lat };
  }

  return null;
}

/**
 * 从 POI 表中查找地点坐标
 * @param {string} placeName 地名
 * @returns {Promise<{lon: number, lat: number}|null>}
 */
export async function resolvePOIAsLandmark(placeName) {
  const sql = `
    SELECT 
      name,
      ST_X(geom) AS lon,
      ST_Y(geom) AS lat
    FROM pois
    WHERE name ILIKE $1
    ORDER BY 
      CASE WHEN name = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `;

  const result = await query(sql, [`%${placeName}%`]);
  if (result.rows.length > 0) {
    return { lon: result.rows[0].lon, lat: result.rows[0].lat };
  }

  return null;
}

/**
 * 综合解析锚点（优先 landmarks，其次 POI）
 */
export async function resolveAnchor(placeName, gateName = null) {
  // 1. 尝试从 landmarks 表解析
  let anchor = await resolveLandmark(placeName, gateName);
  if (anchor) return anchor;

  // 2. 尝试从 POI 表解析
  const searchTerm = gateName ? `${placeName}${gateName}` : placeName;
  anchor = await resolvePOIAsLandmark(searchTerm);
  if (anchor) return anchor;

  // 3. TODO: 可扩展调用外部地理编码 API

  return null;
}

// =====================================================
// 区域画像统计函数（用于三阶段 RAG 架构）
// =====================================================

/**
 * 获取指定区域内的类别统计
 * @param {Object} anchor - 锚点坐标 {lon, lat}
 * @param {number} radiusM - 半径（米）
 * @returns {Promise<Object>} 区域画像
 */
export async function getCategoryStats(anchor, radiusM = 1000) {
  const sql = `
    WITH area AS (
      SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS g
    ),
    filtered AS (
      SELECT 
        COALESCE(p.category_big, p.type, '未分类') AS category,
        p.name,
        p.address,
        p.category_small
      FROM pois p, area a
      WHERE ST_DWithin(p.geom::geography, a.g, $3)
    ),
    stats AS (
      SELECT 
        category,
        COUNT(*) AS cnt,
        array_agg(name ORDER BY name) FILTER (WHERE name IS NOT NULL) AS names,
        array_agg(DISTINCT category_small) FILTER (WHERE category_small IS NOT NULL) AS subcategories
      FROM filtered
      GROUP BY category
    ),
    total AS (
      SELECT SUM(cnt) AS total_count FROM stats
    )
    SELECT 
      s.category,
      s.cnt,
      ROUND((s.cnt::FLOAT / NULLIF(t.total_count, 0) * 100)::NUMERIC, 1) AS percentage,
      s.names[1:3] AS example_names,
      s.subcategories[1:5] AS subcategories
    FROM stats s, total t
    ORDER BY s.cnt DESC
    LIMIT 10;
  `;

  try {
    const result = await query(sql, [anchor.lon, anchor.lat, radiusM]);

    const total = result.rows.reduce((sum, r) => sum + parseInt(r.cnt), 0);
    const dominant = result.rows.slice(0, 5).map((r) => ({
      category: r.category,
      count: parseInt(r.cnt),
      percentage: parseFloat(r.percentage) || 0,
      subcategories: r.subcategories || [],
      examples: r.example_names || [],
    }));

    const rare = result.rows
      .filter((r) => parseInt(r.cnt) <= 2)
      .slice(0, 3)
      .map((r) => ({
        category: r.category,
        count: parseInt(r.cnt),
      }));

    return {
      total_count: total,
      dominant_categories: dominant,
      rare_categories: rare,
    };
  } catch (err) {
    console.error("[DB] 类别统计查询失败:", err.message);
    return {
      total_count: 0,
      dominant_categories: [],
      rare_categories: [],
    };
  }
}

/**
 * 获取指定几何区域内的类别统计
 * @param {string} wkt - WKT 格式的几何区域
 * @returns {Promise<Object>} 区域画像
 */
export async function getCategoryStatsByGeometry(wkt) {
  const sql = `
    WITH area AS (
      SELECT ST_GeomFromText($1, 4326) AS g
    ),
    filtered AS (
      SELECT 
        COALESCE(p.category_big, p.type, '未分类') AS category,
        p.name,
        p.address,
        p.category_small
      FROM pois p, area a
      WHERE ST_Within(p.geom, a.g)
    ),
    stats AS (
      SELECT 
        category,
        COUNT(*) AS cnt,
        array_agg(name ORDER BY name) FILTER (WHERE name IS NOT NULL) AS names,
        array_agg(DISTINCT category_small) FILTER (WHERE category_small IS NOT NULL) AS subcategories
      FROM filtered
      GROUP BY category
    ),
    total AS (
      SELECT SUM(cnt) AS total_count FROM stats
    )
    SELECT 
      s.category,
      s.cnt,
      ROUND((s.cnt::FLOAT / NULLIF(t.total_count, 0) * 100)::NUMERIC, 1) AS percentage,
      s.names[1:3] AS example_names,
      s.subcategories[1:5] AS subcategories
    FROM stats s, total t
    ORDER BY s.cnt DESC
    LIMIT 10;
  `;

  try {
    const result = await query(sql, [wkt]);

    // 复用相同的格式化逻辑
    const total = result.rows.reduce((sum, r) => sum + parseInt(r.cnt), 0);
    const dominant = result.rows.slice(0, 5).map((r) => ({
      category: r.category,
      count: parseInt(r.cnt),
      percentage: parseFloat(r.percentage) || 0,
      subcategories: r.subcategories || [],
      examples: r.example_names || [],
    }));

    const rare = result.rows
      .filter((r) => parseInt(r.cnt) <= 2)
      .slice(0, 3)
      .map((r) => ({
        category: r.category,
        count: parseInt(r.cnt),
      }));

    return {
      total_count: total,
      dominant_categories: dominant,
      rare_categories: rare,
    };
  } catch (err) {
    console.error("[DB] 区域几何类别统计查询失败:", err.message);
    return {
      total_count: 0,
      dominant_categories: [],
      rare_categories: [],
    };
  }
}

/**
 * 获取区域内的代表性地标
 * @param {Object} anchor - 锚点坐标 {lon, lat}
 * @param {number} radiusM - 半径（米）
 * @param {number} topK - 返回数量
 * @returns {Promise<Array>} 地标列表
 */
export async function getRepresentativeLandmarks(
  anchor,
  radiusM = 1000,
  topK = 5,
) {
  const sql = `
    WITH area AS (
      SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS g
    ),
    landmark_types AS (
      SELECT unnest(ARRAY['ѧ', 'ҽԺ', '', 'վ', '', 'ѧУ', '̳', '㳡', '԰', '', '', '´', '', '']) AS ltype
    ),
    candidates AS (
      SELECT 
        p.name,
        CASE 
          WHEN p.category_mid ILIKE '%大学%' OR p.category_small ILIKE '%大学%' THEN '大学'
          WHEN p.category_mid ILIKE '%ҽԺ%' OR (p.category_mid ILIKE '%ҽ%' AND p.name ILIKE '%ҽԺ%') THEN 'ҽԺ'
          WHEN p.category_mid ILIKE '%地铁%' THEN '地铁站'
          WHEN p.category_mid ILIKE '%火车站%' OR p.category_mid ILIKE '%高铁%' THEN '火车站'
          WHEN p.category_mid ILIKE '%机场%' THEN '机场'
          WHEN p.category_mid ILIKE '%学校%' OR p.category_small ILIKE '%学校%' THEN '学校'
          WHEN p.category_mid ILIKE '%商场%' OR p.category_mid ILIKE '%购物%' THEN '大型商场'
          WHEN p.category_mid ILIKE '%广场%' THEN '广场'
          WHEN p.category_mid ILIKE '%公园%' THEN '公园'
          WHEN p.category_mid ILIKE '%博物馆%' OR p.category_mid ILIKE '%展览馆%' THEN '文化地标'
          WHEN p.category_mid ILIKE '%%' AND (p.name ILIKE '%%' OR p.name ILIKE '%ܲ%') THEN 'ڻ'
          WHEN p.category_mid ILIKE '%政府%' OR p.category_mid ILIKE '%机关%' THEN '行政机构'
          ELSE p.category_mid
        END AS landmark_type,
        ST_Distance(p.geom::geography, a.g) AS distance_m,
        CASE 
          WHEN p.category_mid ILIKE '%火车站%' OR p.category_mid ILIKE '%机场%' THEN 15
          WHEN p.category_mid ILIKE '%大学%' OR (p.category_mid ILIKE '%医院%' AND p.name ILIKE '%医院%') THEN 12
          WHEN p.category_mid ILIKE '%地铁%' THEN 10
          WHEN p.category_mid ILIKE '%博物馆%' OR p.category_mid ILIKE '%市政府%' THEN 9
          WHEN p.name ILIKE '%总店%' OR p.name ILIKE '%旗舰店%' THEN 8
          WHEN p.category_mid ILIKE '%学校%' THEN 7
          WHEN p.category_mid ILIKE '%商场%' OR p.category_mid ILIKE '%购物%' THEN 6
          WHEN p.category_mid ILIKE '%广场%' THEN 5
          WHEN p.category_mid ILIKE '%公园%' THEN 4
          ELSE 1
        END AS type_weight
      FROM pois p, area a, landmark_types lt
      WHERE ST_DWithin(p.geom::geography, a.g, $3)
        AND (p.category_mid ILIKE '%' || lt.ltype || '%' OR p.category_big ILIKE '%' || lt.ltype || '%' OR p.name ILIKE '%' || lt.ltype || '%')
        AND p.name NOT ILIKE '%小区%' AND p.name NOT ILIKE '%业主%' -- 过滤住宅区和业主委员会
    ),
    ranked AS (
      SELECT 
        name,
        landmark_type,
        distance_m,
        type_weight * (1.5 - distance_m / $3) AS relevance_score, -- 增强权重影响，减弱距离衰减
        ROW_NUMBER() OVER (PARTITION BY landmark_type ORDER BY type_weight DESC, distance_m ASC) AS rn
      FROM candidates
    )
    SELECT name, landmark_type AS type, ROUND(distance_m::NUMERIC) AS distance_m, ROUND(relevance_score::NUMERIC, 2) AS relevance_score
    FROM ranked
    WHERE rn = 1
    ORDER BY relevance_score DESC
    LIMIT $4;
  `;

  try {
    const result = await query(sql, [anchor.lon, anchor.lat, radiusM, topK]);

    return result.rows.map((r) => ({
      name: r.name,
      type: r.type,
      distance_m: parseInt(r.distance_m),
      relevance_score: parseFloat(r.relevance_score),
    }));
  } catch (err) {
    console.error("[DB] 地标提取查询失败:", err.message);
    return [];
  }
}

/**
 * 高级 POI 过滤查询（支持多条件）
 * @param {Object} options - 查询选项
 * @returns {Promise<Array>} POI 列表
 */
export async function findPOIsFiltered(options) {
  const {
    anchor,
    radius_m = 1000,
    categories = [],
    rating_range = [null, null],
    geometry = null, // WKT format: POLYGON((...))
    limit = 100,
  } = options;

  let sql = `
    SELECT 
      p.id, p.name, p.address, p.type,
      p.category_big, p.category_mid, p.category_small,
      ${POI_RATING_SELECT_SQL},
      ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
  `;

  const params = [];
  let paramIndex = 1;
  let geometryParamIndex = null;

  // עͣêʱʵ룬ڡ󰴾
  if (anchor) {
    sql += `, ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography) AS distance_meters`;
    params.push(anchor.lon, anchor.lat);
    paramIndex += 2;
  } else {
    sql += `, 0 AS distance_meters`;
  }

  sql += ` FROM pois p WHERE 1=1 `;

  // עͣʹüα߽磬ƾ뾶ºѡΧ
  if (geometry) {
    geometryParamIndex = paramIndex;
    sql += ` AND ST_Within(p.geom, ST_GeomFromText($${geometryParamIndex}, 4326))`;
    params.push(geometry);
    paramIndex++;
  } else if (anchor) {
    // 中文注释：未提供几何边界时回退到半径查询，保持历史接口兼容。
    sql += ` AND ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIndex - 2}, $${paramIndex - 1}), 4326)::geography, $${paramIndex})`;
    params.push(radius_m);
    paramIndex++;
  }

  // 中文注释：类别过滤同时覆盖名称/地址/大小类/type，降低“有数据但检索不到”的漏召回。
  if (categories.length > 0) {
    const categoryConditions = categories.map((_, i) => {
      const idx = paramIndex + i;
      return `(
        p.name ILIKE $${idx}
        OR p.address ILIKE $${idx}
        OR p.category_big ILIKE $${idx}
        OR p.category_mid ILIKE $${idx}
        OR p.category_small ILIKE $${idx}
        OR p.type ILIKE $${idx}
      )`;
    });
    sql += ` AND (${categoryConditions.join(" OR ")})`;
    categories.forEach((cat) => params.push(`%${cat}%`));
    paramIndex += categories.length;
  }

  // 评分过滤（数据库暂无 rating 字段，暂时忽略）
  /*
  if (rating_range[0] !== null) {
    sql += ` AND p.rating >= $${paramIndex}`;
    params.push(rating_range[0]);
    paramIndex++;
  }
  if (rating_range[1] !== null) {
    sql += ` AND p.rating <= $${paramIndex}`;
    params.push(rating_range[1]);
    paramIndex++;
  }
  */

  // עͣêʱܰ distance_meters 򣬷 LIMIT ᱻ˳ɵһĿ
  let orderClause = "distance_meters";
  if (!anchor) {
    if (geometryParamIndex !== null) {
      orderClause = `p.geom <-> ST_Centroid(ST_GeomFromText($${geometryParamIndex}, 4326))`;
    } else {
      orderClause = "p.id";
    }
  }

  sql += ` ORDER BY ${orderClause} LIMIT $${paramIndex}`;
  const maxLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || "20000", 10);
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isFinite(normalizedLimit)
    ? Math.max(1, Math.min(normalizedLimit, maxLimit))
    : Math.min(100, maxLimit);
  params.push(safeLimit);

  try {
    console.log("[DB SQL Debug]", sql);
    console.log("[DB Params Debug]", params);
    const result = await query(sql, params);

    if (result.rows.length === 0 && categories.length > 0) {
      console.log(
        `[DB] 警告: 即使经过扩充检索，条件 ${JSON.stringify(categories)} 仍未返回结果。SQL参数:`,
        params,
      );
    }

    return result.rows;
  } catch (err) {
    console.error("[DB] 高级过滤查询失败:", err.message);
    throw err;
  }
}

/**
 * 快速搜索 POI（用于简单名词查询，绕过 LLM）
 * @param {Object} options - 搜索选项
 *   @param {string[]} terms - 搜索词列表（已扩展同义词）
 *   @param {Object} center - 中心点 {lat, lon}（可选）
 *   @param {number} radius - 搜索半径（米）
 *   @param {string} geometryWKT - WKT 几何边界（可选，优先于 center+radius）
 *   @param {number} limit - 返回数量限制
 * @returns {Promise<Array>} POI 列表
 */
export async function quickSearch(options) {
  const { terms, center, radius = 5000, geometryWKT, limit = 100 } = options;

  if (!terms || terms.length === 0) {
    return [];
  }

  let sql = `
    SELECT 
      p.id,
      p.name,
      p.address,
      p.category_big,
      p.category_mid,
      p.category_small,
      ST_X(p.geom) AS lon,
      ST_Y(p.geom) AS lat
  `;

  const params = [];
  let paramIndex = 1;

  // 如果有中心点，计算距离用于排序
  if (center) {
    sql += `, ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography) AS distance_m`;
    params.push(center.lon, center.lat);
    paramIndex += 2;
  } else {
    sql += `, 0 AS distance_m`;
  }

  sql += ` FROM pois p WHERE `;

  // 构建文本匹配条件（名称、类别多字段匹配）
  const termConditions = terms.map((_, i) => {
    const idx = paramIndex + i;
    return `(
      p.name ILIKE $${idx} OR 
      p.category_big ILIKE $${idx} OR 
      p.category_mid ILIKE $${idx} OR 
      p.category_small ILIKE $${idx} OR
      p.type ILIKE $${idx}
    )`;
  });
  sql += `(${termConditions.join(" OR ")})`;
  terms.forEach((t) => params.push(`%${t}%`));
  paramIndex += terms.length;

  // 空间过滤
  if (geometryWKT) {
    sql += ` AND ST_Within(p.geom, ST_GeomFromText($${paramIndex}, 4326))`;
    params.push(geometryWKT);
    paramIndex++;
  } else if (center) {
    sql += ` AND ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $${paramIndex})`;
    params.push(radius);
    paramIndex++;
  }

  // 排序：有中心点时按距离，否则按名称
  if (center) {
    sql += ` ORDER BY distance_m ASC`;
  } else {
    sql += ` ORDER BY p.name ASC`;
  }

  sql += ` LIMIT $${paramIndex}`;
  const maxLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || "20000", 10);
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isFinite(normalizedLimit)
    ? Math.max(1, Math.min(normalizedLimit, maxLimit))
    : Math.min(100, maxLimit);
  params.push(safeLimit);

  try {
    const startTime = Date.now();
    const result = await query(sql, params);
    const duration = Date.now() - startTime;
    console.log(
      `[DB QuickSearch] 耗时 ${duration}ms, 返回 ${result.rows.length} 条`,
    );
    return result.rows;
  } catch (err) {
    console.error("[DB QuickSearch] 查询失败:", err.message);
    return [];
  }
}

/**
 * ׶οռ˲ѯ "XY" Ͳѯ
 *
 * ׶1: ҰΧڰؼ/ɸ
 * 阶段2: 通过地标缓冲区精筛
 *
 * @param {Object} options
 *   @param {string[]} terms - ؼ ( ["", "̹"])
 *   @param {string} viewportWKT - 视野边界 WKT (阶段1使用)
 *   @param {Object} anchor - 地标坐标 {lon, lat} (阶段2使用)
 *   @param {number} bufferRadius - 缓冲区半径（米，默认 2000）
 *   @param {number} limit - 返回数量限制
 * @returns {Promise<Object>} { stage1Count, stage2Count, pois }
 */
export async function findPOIsTwoStageFilter(options) {
  const {
    terms = [],
    viewportWKT,
    anchor,
    bufferRadius = 2000,
    limit = 100,
  } = options;

  if ((!terms || terms.length === 0) && !anchor && !viewportWKT) {
    console.log("[DB TwoStage] 无搜索词且无空间条件，跳过");
    return { stage1Count: 0, stage2Count: 0, pois: [] };
  }

  const startTime = Date.now();

  // =============================================
  // ׶1: ҰΧ + ؼʳɸ
  // =============================================
  let stage1SQL = `
    SELECT 
      p.id, p.name, p.address,
      p.category_big, p.category_mid, p.category_small,
      ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
  `;

  const params = [];
  let paramIndex = 1;

  // 如果有锚点，计算到锚点的距离
  if (anchor) {
    stage1SQL += `, ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography) AS distance_m`;
    params.push(anchor.lon, anchor.lat);
    paramIndex += 2;
  } else {
    stage1SQL += `, 0 AS distance_m`;
  }

  stage1SQL += ` FROM pois p WHERE `;

  // 关键词匹配条件（名称 + 类别）
  if (terms && terms.length > 0) {
    const termConditions = terms.map((_, i) => {
      const idx = paramIndex + i;
      return `(
        p.name ILIKE $${idx} OR 
        p.category_small ILIKE $${idx} OR 
        p.category_mid ILIKE $${idx} OR
        p.type ILIKE $${idx}
      )`;
    });
    stage1SQL += `(${termConditions.join(" OR ")})`;
    terms.forEach((t) => params.push(`%${t}%`));
    paramIndex += terms.length;
  } else {
    stage1SQL += `1=1`; // 无关键词时匹配所有
  }

  // 视野范围过滤（阶段1）
  if (viewportWKT) {
    stage1SQL += ` AND ST_Within(p.geom, ST_GeomFromText($${paramIndex}, 4326))`;
    params.push(viewportWKT);
    paramIndex++;
  }

  // =============================================
  // 阶段2: 地标缓冲区精筛
  // =============================================
  if (anchor) {
    stage1SQL += ` AND ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $${paramIndex})`;
    params.push(bufferRadius);
    paramIndex++;
  }

  // 排序和限制
  if (anchor) {
    stage1SQL += ` ORDER BY distance_m ASC`;
  } else {
    stage1SQL += ` ORDER BY p.name ASC`;
  }
  stage1SQL += ` LIMIT $${paramIndex}`;
  params.push(limit);

  try {
    console.log("[DB TwoStage] 执行两阶段查询...");
    console.log("[DB TwoStage] 关键词:", terms);
    console.log(
      "[DB TwoStage] 锚点:",
      anchor ? `${anchor.lon.toFixed(4)}, ${anchor.lat.toFixed(4)}` : "无",
    );
    console.log("[DB TwoStage] 缓冲区半径:", bufferRadius, "m");

    const result = await query(stage1SQL, params);

    const duration = Date.now() - startTime;
    console.log(
      `[DB TwoStage] 完成: ${result.rows.length} 条结果, 耗时 ${duration}ms`,
    );

    return {
      stage1Count: result.rows.length, // TODO: 可以分开统计
      stage2Count: result.rows.length,
      pois: result.rows,
    };
  } catch (err) {
    console.error("[DB TwoStage] 查询失败:", err.message);
    return { stage1Count: 0, stage2Count: 0, pois: [] };
  }
}

/**
 * Spatial filter by WKT with optional term matching.
 * @param {Object} options
 * @param {string} options.wkt
 * @param {string[]|string|null} options.terms
 * @param {number} options.limit
 * @returns {Promise<Array>}
 */
export async function findPOIsBySpatialFilter(options = {}) {
  const { wkt, terms, limit = 100 } = options;
  if (!wkt) return [];

  const termList = Array.isArray(terms)
    ? terms.filter(Boolean)
    : typeof terms === "string" && terms
      ? [terms]
      : [];

  let sql = `
    SELECT
      p.id,
      p.name,
      p.address,
      p.type,
      p.category_big,
      p.category_mid,
      p.category_small,
      ${POI_RATING_SELECT_SQL},
      ST_X(p.geom) AS lon,
      ST_Y(p.geom) AS lat
    FROM pois p
    WHERE ST_Within(p.geom, ST_GeomFromText($1, 4326))
  `;

  const params = [wkt];
  let paramIndex = 2;

  if (termList.length > 0) {
    const termConditions = termList.map((_, i) => {
      const idx = paramIndex + i;
      return `(
        p.name ILIKE $${idx} OR
        p.category_big ILIKE $${idx} OR
        p.category_mid ILIKE $${idx} OR
        p.category_small ILIKE $${idx} OR
        p.type ILIKE $${idx}
      )`;
    });
    sql += ` AND (${termConditions.join(" OR ")})`;
    termList.forEach((t) => params.push(`%${t}%`));
    paramIndex += termList.length;
  }

  sql += ` LIMIT $${paramIndex}`;
  const maxLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || "20000", 10);
  const normalizedLimit = Number(limit);
  const safeLimit = Number.isFinite(normalizedLimit)
    ? Math.max(1, Math.min(normalizedLimit, maxLimit))
    : Math.min(100, maxLimit);
  params.push(safeLimit);

  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (err) {
    console.error("[DB] Spatial filter query failed:", err.message);
    return [];
  }
}

export default {
  initDatabase,
  getPool,
  query,
  closeDatabase,
  findPOIsWithinRadius,
  findPOIsByDirection,
  resolveLandmark,
  resolveAnchor,
  getCategoryStats,
  getCategoryStatsByGeometry,
  getRepresentativeLandmarks,
  findPOIsFiltered,
  findPOIsBySpatialFilter,
  quickSearch,
  findPOIsTwoStageFilter,
};
