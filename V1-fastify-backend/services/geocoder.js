/**
 * 地理编码服务
 * 将地名转换为坐标，支持多种解析策略
 * 
 * 解析优先级：
 * 1. POI 库精确匹配
 * 2. POI 库模糊匹配
 * 3. landmarks 缓存表
 * 4. 高德地理编码 API（外部服务）
 */

import { query } from './database.js';
import * as vectordb from './vectordb.js';

/**
 * 计算两点间距离（米）- Haversine 公式
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * 综合锚点解析
 * @param {string} placeName 地名
 * @param {string} gateName 门/入口名（可选）
 * @param {Object} viewportCenter Ұģѡƥ俿ҰĽ
 * @returns {Promise<{lon: number, lat: number, source: string, name: string}|null>}
 */
export async function resolveAnchor(placeName, gateName = null, viewportCenter = null) {
  // 组合搜索词
  const searchTerm = gateName ? `${placeName}${gateName}` : placeName;
  const searchTermWithSpace = gateName ? `${placeName} ${gateName}` : placeName;
  
  console.log(`[Geocoder] ê: "${searchTerm}"${viewportCenter ? ` (ƫҰ: ${viewportCenter.lon.toFixed(4)}, ${viewportCenter.lat.toFixed(4)})` : ''}`);
  
  // 1. 尝试从 POI 库精确匹配（支持视野偏好）
  let result = await findInPOI(searchTerm, 'exact', viewportCenter);
  if (result) {
    // ƥǷҰԶǴݣ
    const distanceToViewport = viewportCenter ? 
      calculateDistance(viewportCenter.lat, viewportCenter.lon, result.lat, result.lon) : 0;
    
    if (viewportCenter && distanceToViewport > 5000) {
      console.log(`[Geocoder] ⚠️ POI 匹配距离视野过远 (${(distanceToViewport/1000).toFixed(1)}km)，尝试聚类定位...`);
      
      // 策略A：反向聚类定位 - 搜索所有包含该名称的 POI，计算聚类中心
      const clusterResult = await findByClusterCentroid(searchTerm, viewportCenter);
      if (clusterResult) {
        const clusterDist = calculateDistance(viewportCenter.lat, viewportCenter.lon, clusterResult.lat, clusterResult.lon);
        if (clusterDist < distanceToViewport) {
          console.log(`[Geocoder] ✅ 使用聚类中心 (${clusterResult.count}个相关POI, 更近: ${(clusterDist/1000).toFixed(1)}km)`);
          return { ...clusterResult, source: 'cluster_centroid' };
        }
      }
      
      // 策略B：外部 API 验证
      const externalResult = await geocodeExternal(searchTerm);
      if (externalResult) {
        const externalDist = calculateDistance(viewportCenter.lat, viewportCenter.lon, externalResult.lat, externalResult.lon);
        if (externalDist < distanceToViewport) {
          console.log(`[Geocoder] ✅ 使用外部 API 结果 (更近: ${(externalDist/1000).toFixed(1)}km)`);
          return { ...externalResult, source: 'external_api_verified' };
        }
      }
    }
    
    console.log(`[Geocoder] POI 精确匹配成功: ${result.name} (${result.lon.toFixed(4)}, ${result.lat.toFixed(4)})`);
    return { ...result, source: 'poi_exact' };
  }
  
  // 2. 尝试 POI 库模糊匹配（支持视野偏好）
  result = await findInPOI(searchTerm, 'fuzzy', viewportCenter);
  if (result) {
    console.log(`[Geocoder] POI 模糊匹配成功: ${result.name} (${result.lon.toFixed(4)}, ${result.lat.toFixed(4)})`);
    return { ...result, source: 'poi_fuzzy' };
  }
  
  // 3. 如果有门名，尝试只搜索地名
  if (gateName) {
    result = await findInPOI(placeName, 'fuzzy', viewportCenter);
    if (result) {
      console.log(`[Geocoder] POI 地名匹配成功: ${result.name}`);
      return { ...result, source: 'poi_place' };
    }
  }
  
  // 4. 尝试从 landmarks 缓存表
  result = await findInLandmarks(placeName, gateName);
  if (result) {
    console.log(`[Geocoder] Landmarks 缓存命中: ${result.name}`);
    return { ...result, source: 'landmarks' };
  }
  
  // 5. (新增) 尝试利用向量数据库进行语义匹配
  // ȷƥģƥ䶼ʧʱ Embedding Ƶ POI
  // 磺"ѧվ" -> ƥ"7ߺѧվ"
  result = await findInVectorDB(placeName);
  if (result) {
    console.log(`[Geocoder] S-RAG 向量语义匹配成功: ${result.name} (Score: ${result.score.toFixed(4)})`);
    return { ...result, source: 'vector_semantic' };
  }
  
  // 6. 调用外部地理编码 API
  result = await geocodeExternal(searchTerm);
  if (result) {
    console.log(`[Geocoder] 外部 API 解析成功: ${result.name}`);
    // 可选：将结果缓存到 landmarks 表
    await cacheLandmark(result);
    return { ...result, source: 'external_api' };
  }
  
  console.log(`[Geocoder] 无法解析: "${searchTerm}"`);
  return null;
}

/**
 * 从向量数据库查找语义最相似的 POI
 */
async function findInVectorDB(text) {
  // 1. 检查向量库是否可用
  if (!vectordb.isVectorDBAvailable()) {
    return null;
  }
  
  try {
    // 2. 生成 Embedding
    const embedding = await generateEmbedding(text);
    if (!embedding) return null;
    
    // 3. 向量检索 (Top 1)
    const results = await vectordb.semanticSearch(embedding, 1);
    if (!results || results.length === 0) return null;
    
    const bestMatch = results[0];
    
    // 4. ֻеƶ㹻ʱŲ (ֵɵ 0.6)
    // 注意：Cosine Distance 范围 -1 到 1，越接近 1 越相似
    // 如果是 L2 距离，越小越好。milvus.js 里配置的是 COSINE。
    if (bestMatch.score < 0.65) {
      console.log(`[Geocoder] 向量匹配置信度过低 (${bestMatch.score.toFixed(4)} < 0.65): ${bestMatch.name}`);
      return null;
    }
    
    // 5. 根据 POI ID 回查数据库获取完整坐标信息
    const sql = `
      SELECT 
        name,
        ST_X(geom) AS lon,
        ST_Y(geom) AS lat
      FROM pois
      WHERE id = $1
    `;
    const dbRes = await query(sql, [bestMatch.poi_id]);
    
    if (dbRes.rows.length > 0) {
      const row = dbRes.rows[0];
      return { 
        name: row.name, 
        lon: row.lon, 
        lat: row.lat,
        score: bestMatch.score
      };
    }
    
    return null;
  } catch (err) {
    console.error('[Geocoder] 向量检索失败:', err.message);
    return null;
  }
}

/**
 * 生成文本 Embedding (复用 LLM API)
 */
async function generateEmbedding(text) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';
  
  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return data.data?.[0]?.embedding;
  } catch (err) {
    // 仅warn不报错，避免刷屏
    // console.warn('[Geocoder] Embedding 生成失败:', err.message);
    return null;
  }
}

/**
 * 从 POI 表查找
 * @param {string} term 搜索词
 * @param {string} mode 'exact' | 'fuzzy'
 * @param {Object} viewportCenter 视野中心（可选，用于距离排序）
 */
async function findInPOI(term, mode = 'fuzzy', viewportCenter = null) {
  let sql;
  let params;

  if (mode === 'exact') {
    if (viewportCenter) {
      // 精确匹配 + 按离视野中心距离排序
      sql = `
        SELECT
          name,
          ST_X(geom) AS lon,
          ST_Y(geom) AS lat,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
          ) AS dist
        FROM pois
        WHERE name = $1
        ORDER BY dist ASC
        LIMIT 1
      `;
      params = [term, viewportCenter.lon, viewportCenter.lat];
    } else {
      sql = `
        SELECT
          name,
          ST_X(geom) AS lon,
          ST_Y(geom) AS lat
        FROM pois
        WHERE name = $1
        LIMIT 1
      `;
      params = [term];
    }
  } else {
    // 模糊匹配（只匹配name列，pois表没有address列）
    if (viewportCenter) {
      // 模糊匹配 + 视野偏好：优先相似度，其次距离
      sql = `
        SELECT
          name,
          ST_X(geom) AS lon,
          ST_Y(geom) AS lat,
          similarity(name, $1) AS sim,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
          ) AS dist
        FROM pois
        WHERE name ILIKE $2
        ORDER BY sim DESC, dist ASC, length(name) ASC
        LIMIT 1
      `;
      params = [term, `%${term}%`, viewportCenter.lon, viewportCenter.lat];
    } else {
      sql = `
        SELECT
          name,
          ST_X(geom) AS lon,
          ST_Y(geom) AS lat,
          similarity(name, $1) AS sim
        FROM pois
        WHERE name ILIKE $2
        ORDER BY sim DESC, length(name) ASC
        LIMIT 1
      `;
      params = [term, `%${term}%`];
    }
  }

  try {
    const result = await query(sql, params);
    if (result.rows.length > 0) {
      const row = result.rows[0];
      if (row.dist !== undefined) {
        console.log(`[Geocoder] 匹配结果距离视野中心: ${(row.dist/1000).toFixed(2)}km`);
      }
      return { name: row.name, lon: row.lon, lat: row.lat };
    }
  } catch (err) {
    console.error('[Geocoder] POI 查询失败:', err.message);
  }

  return null;
}

/**
 * 反向聚类定位：搜索所有包含关键词的 POI，计算聚类中心
 * 例如：搜索 "湖北大学" → 找到 "湖北大学店"、"湖北大学站" 等 → 计算中心点
 * @param {string} term 关键词
 * @param {Object} viewportCenter 视野中心（用于过滤距离过远的异常点）
 */
async function findByClusterCentroid(term, viewportCenter) {
  try {
    // аùؼʵ POIҰ 20km ڣ
    let sql = `
      SELECT 
        ST_X(geom) AS lon,
        ST_Y(geom) AS lat
      FROM pois
      WHERE name ILIKE $1
    `;
    let params = [`%${term}%`];
    
    // 如果有视野中心，只取 20km 内的 POI（过滤异常数据）
    if (viewportCenter) {
      sql += ` AND ST_DWithin(
        geom::geography, 
        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 
        20000
      )`;
      params.push(viewportCenter.lon, viewportCenter.lat);
    }
    
    sql += ` LIMIT 100`; // 最多取 100 个点
    
    const result = await query(sql, params);
    
    if (result.rows.length < 3) {
      // 至少需要 3 个点才能形成有意义的聚类
      return null;
    }
    
    // 计算中心点（简单平均，可以升级为加权平均或 DBSCAN）
    let sumLon = 0, sumLat = 0;
    for (const row of result.rows) {
      sumLon += row.lon;
      sumLat += row.lat;
    }
    
    const centroid = {
      lon: sumLon / result.rows.length,
      lat: sumLat / result.rows.length,
      name: `${term} (聚类中心)`,
      count: result.rows.length
    };
    
    console.log(`[Geocoder] 聚类定位: ${result.rows.length} 个相关 POI → 中心 (${centroid.lon.toFixed(4)}, ${centroid.lat.toFixed(4)})`);
    
    return centroid;
  } catch (err) {
    console.error('[Geocoder] 聚类定位失败:', err.message);
    return null;
  }
}

/**
 * 从 landmarks 缓存表查找
 */
async function findInLandmarks(placeName, gateName = null) {
  try {
    if (gateName) {
      // 先匹配门
      const sql = `
        SELECT 
          name,
          ST_X(geom) AS lon,
          ST_Y(geom) AS lat
        FROM landmarks
        WHERE (parent_name ILIKE $1 OR name ILIKE $1)
          AND name ILIKE $2
        LIMIT 1
      `;
      const result = await query(sql, [`%${placeName}%`, `%${gateName}%`]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return { name: row.name, lon: row.lon, lat: row.lat };
      }
    }
    
    // 匹配地名或别名
    const sql = `
      SELECT 
        name,
        ST_X(geom) AS lon,
        ST_Y(geom) AS lat
      FROM landmarks
      WHERE name ILIKE $1
         OR $2 = ANY(alias)
      ORDER BY 
        CASE WHEN name ILIKE $1 THEN 0 ELSE 1 END
      LIMIT 1
    `;
    const result = await query(sql, [`%${placeName}%`, placeName]);
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return { name: row.name, lon: row.lon, lat: row.lat };
    }
  } catch (err) {
    console.error('[Geocoder] Landmarks 查询失败:', err.message);
  }
  
  return null;
}

/**
 * 调用外部地理编码 API（高德地图）
 * @param {string} address 地址/地名
 * @returns {Promise<{name: string, lon: number, lat: number}|null>}
 */
async function geocodeExternal(address) {
  const apiKey = process.env.AMAP_API_KEY;
  
  if (!apiKey || apiKey === '2b42a2f72ef6751f2cd7c7bd24139e72') {
    console.log('[Geocoder] ߵ API Key δãⲿ');
    return null;
  }
  
  try {
    // 高德地理编码 API
    const url = `https://restapi.amap.com/v3/geocode/geo?key=${apiKey}&address=${encodeURIComponent(address)}&city=武汉`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
      const geo = data.geocodes[0];
      const [lon, lat] = geo.location.split(',').map(Number);
      
      // 高德返回的是 GCJ-02 坐标，需要转换为 WGS-84
      const wgs84 = gcj02ToWgs84(lon, lat);
      
      return {
        name: geo.formatted_address,
        lon: wgs84.lon,
        lat: wgs84.lat
      };
    }
  } catch (err) {
    console.error('[Geocoder] 高德 API 调用失败:', err.message);
  }
  
  return null;
}

/**
 * 将外部解析结果缓存到 landmarks 表
 */
async function cacheLandmark(result) {
  try {
    const sql = `
      INSERT INTO landmarks (name, type, geom, geohash)
      VALUES ($1, 'external', ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)
      ON CONFLICT DO NOTHING
    `;
    
    // 简单 geohash 计算（7 位精度）
    const geohash = computeSimpleGeohash(result.lat, result.lon);
    
    await query(sql, [result.name, result.lon, result.lat, geohash]);
  } catch (err) {
    // 缓存失败不影响主流程
    console.warn('[Geocoder] 缓存 landmark 失败:', err.message);
  }
}

/**
 * GCJ-02 转 WGS-84
 * 高德地图使用 GCJ-02 坐标系，需要转换
 */
function gcj02ToWgs84(lon, lat) {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  
  return {
    lon: lon - dLon,
    lat: lat - dLat
  };
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

/**
 * 简易 GeoHash 计算
 */
function computeSimpleGeohash(lat, lon, precision = 7) {
  const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90, maxLat = 90;
  let minLon = -180, maxLon = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let isLon = true;
  
  while (hash.length < precision) {
    if (isLon) {
      const mid = (minLon + maxLon) / 2;
      if (lon >= mid) {
        ch |= (1 << (4 - bit));
        minLon = mid;
      } else {
        maxLon = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= (1 << (4 - bit));
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }
    
    isLon = !isLon;
    bit++;
    
    if (bit === 5) {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }
  
  return hash;
}

export default {
  resolveAnchor
};
