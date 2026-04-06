/**
 * 空间重排服务
 *
 * 使用训练好的 POI encoder 生成的 spatial_embedding 进行空间相关性重排。
 *
 * 混合检索架构：
 * 1. 语义召回（nomic-embed-text via pgvector）
 * 2. 空间过滤（PostGIS ST_DWithin）
 * 3. 空间重排（POI encoder spatial_embedding）
 *
 * Author: Sisyphus
 * Date: 2026-03-20
 */

import { query } from '../data/database.js';

/**
 * 计算两个向量的余弦相似度
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 空间重排：结合语义相似度和空间距离
 *
 * @param {Array} candidates - 候选 POI 列表（需含 id 或 poi_id）
 * @param {Object} anchor - 锚点坐标 {lon, lat}
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} - 重排后的 POI 列表
 */
export async function spatialRerank(candidates, anchor, options = {}) {
  const {
    spatialWeight = 0.5,
    semanticWeight = 0.5,
    topK = 20,
  } = options;

  if (!candidates || candidates.length === 0) {
    return [];
  }

  // 提取候选 ID
  const candidateIds = candidates
    .map(c => c.id || c.poi_id)
    .filter(id => id != null);

  if (candidateIds.length === 0) {
    return candidates.slice(0, topK);
  }

  // 从数据库获取 spatial_embedding
  const placeholders = candidateIds.map((_, i) => `$${i + 1}`).join(',');
  const sql = `
    SELECT id, spatial_embedding
    FROM pois
    WHERE id IN (${placeholders}) AND spatial_embedding IS NOT NULL
  `;

  let embeddingMap = new Map();

  try {
    const result = await query(sql, candidateIds);

    for (const row of result.rows) {
      if (row.spatial_embedding) {
        // float[] 从 PostgreSQL 返回的是字符串，需要解析
        let embedding = row.spatial_embedding;
        if (typeof embedding === 'string') {
          embedding = JSON.parse(embedding);
        }
        embeddingMap.set(row.id, embedding);
      }
    }
  } catch (err) {
    console.error('[SpatialRerank] Failed to fetch embeddings:', err.message);
    // 回退：不使用 embedding
  }

  // 计算空间距离分数
  let maxDist = 0;
  const spatialScores = candidates.map(c => {
    const dist = c.distance_m || c.distance_meters || 1000;
    maxDist = Math.max(maxDist, dist);
    return dist;
  });

  // 融合分数
  const scored = candidates.map((c, i) => {
    const poiId = c.id || c.poi_id;
    const embedding = embeddingMap.get(poiId);

    // 空间分数：距离越近越高
    const spatialScore = maxDist > 0 ? 1 - (spatialScores[i] / maxDist) : 0.5;

    // 语义分数（如果有 embedding，可以用查询 embedding 计算；这里暂用默认值）
    const semanticScore = 0.5; // TODO: 接入查询 embedding 后计算

    // 融合分数
    const fusedScore = spatialWeight * spatialScore + semanticWeight * semanticScore;

    return {
      ...c,
      spatial_score: spatialScore,
      semantic_score: semanticScore,
      fused_score: fusedScore,
      has_embedding: !!embedding,
    };
  });

  // 按融合分数排序
  scored.sort((a, b) => b.fused_score - a.fused_score);

  return scored.slice(0, topK);
}

/**
 * 空间重排 V2：使用查询 embedding 计算语义相似度
 *
 * @param {Array} candidates - 候选 POI 列表
 * @param {Array} queryEmbedding - 查询 embedding [352]
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} - 重排后的 POI 列表
 */
export async function spatialRerankWithEmbedding(candidates, queryEmbedding, options = {}) {
  const {
    spatialWeight = 0.5,
    semanticWeight = 0.5,
    topK = 20,
  } = options;

  if (!candidates || candidates.length === 0) {
    return [];
  }

  // 提取候选 ID
  const candidateIds = candidates
    .map(c => c.id || c.poi_id)
    .filter(id => id != null);

  if (candidateIds.length === 0) {
    return candidates.slice(0, topK);
  }

  // 从数据库获取 spatial_embedding
  const placeholders = candidateIds.map((_, i) => `$${i + 1}`).join(',');
  const sql = `
    SELECT id, spatial_embedding
    FROM pois
    WHERE id IN (${placeholders}) AND spatial_embedding IS NOT NULL
  `;

  let embeddingMap = new Map();

  try {
    const result = await query(sql, candidateIds);

    for (const row of result.rows) {
      if (row.spatial_embedding) {
        let embedding = row.spatial_embedding;
        if (typeof embedding === 'string') {
          embedding = JSON.parse(embedding);
        }
        embeddingMap.set(row.id, embedding);
      }
    }
  } catch (err) {
    console.error('[SpatialRerank] Failed to fetch embeddings:', err.message);
  }

  // 计算空间距离分数
  let maxDist = 0;
  for (const c of candidates) {
    const dist = c.distance_m || c.distance_meters || 1000;
    maxDist = Math.max(maxDist, dist);
  }

  // 计算语义相似度并融合
  const scored = candidates.map(c => {
    const poiId = c.id || c.poi_id;
    const embedding = embeddingMap.get(poiId);
    const dist = c.distance_m || c.distance_meters || 1000;

    // 空间分数
    const spatialScore = maxDist > 0 ? 1 - (dist / maxDist) : 0.5;

    // 语义分数
    let semanticScore = 0.5;
    if (embedding && queryEmbedding) {
      semanticScore = cosineSimilarity(queryEmbedding, embedding);
    }

    // 融合分数
    const fusedScore = spatialWeight * spatialScore + semanticWeight * semanticScore;

    return {
      ...c,
      spatial_score: spatialScore,
      semantic_score: semanticScore,
      fused_score: fusedScore,
      has_embedding: !!embedding,
    };
  });

  // 按融合分数排序
  scored.sort((a, b) => b.fused_score - a.fused_score);

  return scored.slice(0, topK);
}

/**
 * 混合检索：语义召回 + 空间过滤 + 空间重排
 *
 * @param {Object} params - 检索参数
 * @returns {Promise<Array>} - 检索结果
 */
export async function hybridSearchWithRerank(params) {
  const {
    anchor,          // {lon, lat}
    radius,          // 半径（米）
    semanticQuery,   // 语义查询文本
    queryEmbedding,  // 查询 embedding [352]（可选）
    categories = [], // 类别过滤
    topK = 20,       // 返回数量
    spatialWeight = 0.5,
    semanticWeight = 0.5,
  } = params;

  // Step 1: 空间过滤（PostGIS）
  let spatialSql = `
    SELECT
      id, name,
      category_main, category_sub,
      ST_X(geom) AS lon, ST_Y(geom) AS lat,
      ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
    FROM pois
    WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
  `;

  const sqlParams = [anchor.lon, anchor.lat, radius];
  let paramIdx = 4;

  // 类别过滤
  if (categories.length > 0) {
    const categoryConditions = categories.map(() => {
      const idx = paramIdx++;
      return `(category_main ILIKE $${idx} OR category_sub ILIKE $${idx} OR name ILIKE $${idx})`;
    });
    spatialSql += ` AND (${categoryConditions.join(' OR ')})`;
    categories.forEach(cat => sqlParams.push(`%${cat}%`));
  }

  spatialSql += ` ORDER BY distance_m ASC LIMIT $${paramIdx}`;
  sqlParams.push(topK * 3); // 召回 3 倍候选

  try {
    const result = await query(spatialSql, sqlParams);
    const candidates = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category_sub || row.category_main,
      lon: row.lon,
      lat: row.lat,
      distance_m: parseFloat(row.distance_m),
    }));

    // Step 2: 空间重排
    if (queryEmbedding) {
      return spatialRerankWithEmbedding(candidates, queryEmbedding, {
        spatialWeight,
        semanticWeight,
        topK,
      });
    } else {
      return spatialRerank(candidates, anchor, {
        spatialWeight,
        semanticWeight,
        topK,
      });
    }
  } catch (err) {
    console.error('[HybridSearch] Error:', err.message);
    return [];
  }
}

export default {
  spatialRerank,
  spatialRerankWithEmbedding,
  hybridSearchWithRerank,
};
