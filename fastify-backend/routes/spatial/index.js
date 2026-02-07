/**
 * 空间查询 API 路由
 * 基于 PostgreSQL + PostGIS 的空间检索
 * 基于 Milvus 的语义向量检索
 * 实现真正的 Spatial-RAG 架构
 */

import db from '../../services/database.js';
import milvus from '../../services/vectordb.js';
import { resolveAnchor } from '../../services/geocoder.js';
import { createRAGSession } from '../../services/ragLogger.js';
import { computeSpatialStream, isGrpcComputeEnabled } from '../../services/grpcClient.js';
import { resolveSourcePolicy } from '../../services/sourcePolicy.js';

/**
 * LLM 意图解析 Prompt
 */
const INTENT_PARSE_PROMPT = `你是一个地理查询解析器，将用户的自然语言问题转换为结构化 JSON。

## 输出格式
{
  "place_name": "地名，如"武汉理工大学"",
  "gate": "门/入口，如"南门"，无则为 null",
  "relative_position": "相对位置词，如"对面""旁边""附近"，无则为 null",
  "radius_m": "距离范围（米），如 500，无则默认 500",
  "category": "POI 类别，如"咖啡馆""奶茶店""餐厅"",
  "min_rating": "最低评分，如 4.5，无则为 null",
  "semantic_query": "用于语义搜索的描述，如"环境安静适合学习"，无则为 null",
  "sort_by": "排序方式：distance/rating/relevance",
  "is_spatial_query": "是否涉及空间位置，true/false",
  "needs_coordinates": "回答是否需要输出坐标，true/false"
}

## 规则
1. "武理工"→"武汉理工大学"，"华科"→"华中科技大学" 等常见别名需展开
2. "500米内""500m以内""方圆500米" 都解析为 radius_m: 500
3. "附近""周边""旁边" 如果没有明确距离，默认 radius_m: 500
4. 如果问题包含"附近""周边""多远""在哪"等，is_spatial_query 为 true
5. 只输出 JSON，不要其他解释

## 用户问题
{user_query}`;

/**
 * 调用本地 LLM
 */
async function callLocalLLM(prompt, session = null) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.LLM_MODEL || 'qwen3-4b-instruct-2507';
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[LLM] API 错误:', response.status, errorText);
      throw new Error(`LLM API 返回错误: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('[LLM] 响应格式异常:', JSON.stringify(data));
      throw new Error('LLM 响应格式异常');
    }
    
    const content = data.choices[0].message.content;
    
    if (session) {
      session.log('LLM', 'ChatCompletion', { 
        model, 
        promptLength: prompt.length,
        responseLength: content.length,
        durationMs: Date.now() - startTime
      });
    }
    
    return content;
  } catch (err) {
    console.error('[LLM] 调用失败:', err.message);
    throw err;
  }
}

/**
 * 生成 Embedding
 */
async function generateEmbedding(text, session = null) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';
  
  const startTime = Date.now();
  
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  });
  
  const data = await response.json();
  
  if (session) {
    session.log('Milvus', 'GenerateEmbedding', {
      model,
      inputLength: text.length,
      durationMs: Date.now() - startTime
    });
  }
  
  return data.data[0].embedding;
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseIntentResponse(llmResponse) {
  try {
    let json = llmResponse;
    
    // 移除 <think> 标签（Qwen3 特有）
    json = json.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    
    // 尝试提取 JSON（处理可能的 markdown 代码块）
    const jsonMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      json = jsonMatch[1].trim();
    }
    
    return JSON.parse(json);
  } catch (e) {
    console.error('Intent parse failed:', e.message, llmResponse);
    return null;
  }
}

/**
 * 从 Milvus 进行向量检索
 * @param {string} semanticQuery - 语义搜索词
 * @param {number} limit - 返回数量
 * @param {object} session - RAG 日志会话
 */
async function vectorSearch(semanticQuery, limit = 100, session = null) {
  if (!milvus.isMilvusAvailable()) {
    if (session) session.log('Milvus', 'Unavailable', { reason: 'Milvus not connected' });
    return [];
  }
  
  const startTime = Date.now();
  
  try {
    // 生成查询向量
    const queryEmbedding = await generateEmbedding(semanticQuery, session);
    
    // Milvus 向量检索（使用 semanticSearch 方法）
    const results = await milvus.semanticSearch(queryEmbedding, limit);
    
    if (session) {
      session.log('Milvus', 'VectorSearch', {
        query: semanticQuery,
        limit,
        resultCount: results.length,
        durationMs: Date.now() - startTime
      });
    }
    
    return results;
  } catch (err) {
    console.error('[Milvus] 向量检索失败:', err.message);
    if (session) session.log('Milvus', 'VectorSearchError', { error: err.message });
    return [];
  }
}

/**
 * 从 PostGIS 进行空间过滤
 * @param {number} lon - 锚点经度
 * @param {number} lat - 锚点纬度
 * @param {number} radiusMeters - 半径（米）
 * @param {object} options - 额外过滤条件
 * @param {object} session - RAG 日志会话
 */
async function spatialFilter(lon, lat, radiusMeters, options = {}, session = null) {
  const startTime = Date.now();
  
  try {
    const results = await db.findPOIsWithinRadius(lon, lat, radiusMeters, options);
    
    if (session) {
      session.log('PostGIS', 'SpatialFilter', {
        anchor: [lon, lat],
        radiusMeters,
        category: options.category || 'all',
        resultCount: results.length,
        durationMs: Date.now() - startTime
      });
    }
    
    return results;
  } catch (err) {
    console.error('[PostGIS] 空间过滤失败:', err.message);
    if (session) session.log('PostGIS', 'SpatialFilterError', { error: err.message });
    return [];
  }
}

/**
 * 融合向量检索和空间过滤结果
 * @param {array} vectorResults - Milvus 向量检索结果
 * @param {array} spatialResults - PostGIS 空间过滤结果
 * @param {string} strategy - 融合策略 'intersection' | 'union' | 'spatial_first'
 * @param {object} session - RAG 日志会话
 */
function fuseResults(vectorResults, spatialResults, strategy = 'intersection', session = null) {
  const startTime = Date.now();
  let results = [];
  
  // 创建 ID 映射
  const vectorMap = new Map(vectorResults.map((r, idx) => [r.poi_id || r.id, { ...r, vectorRank: idx }]));
  const spatialMap = new Map(spatialResults.map((r, idx) => [r.id || r.poi_id, { ...r, spatialRank: idx }]));
  
  switch (strategy) {
    case 'intersection':
      // 只返回两者都有的
      for (const [id, vItem] of vectorMap) {
        if (spatialMap.has(id)) {
          const sItem = spatialMap.get(id);
          results.push({
            ...sItem,
            ...vItem,
            fusedScore: (1 / (vItem.vectorRank + 1)) + (1 / (sItem.spatialRank + 1))
          });
        }
      }
      break;
      
    case 'union':
      // 返回两者的并集
      const allIds = new Set([...vectorMap.keys(), ...spatialMap.keys()]);
      for (const id of allIds) {
        const vItem = vectorMap.get(id);
        const sItem = spatialMap.get(id);
        results.push({
          ...(sItem || {}),
          ...(vItem || {}),
          fusedScore: (vItem ? 1 / (vItem.vectorRank + 1) : 0) + (sItem ? 1 / (sItem.spatialRank + 1) : 0)
        });
      }
      break;
      
    case 'spatial_first':
      // 优先空间结果，向量结果补充排序
      results = spatialResults.map((sItem, idx) => {
        const vItem = vectorMap.get(sItem.id || sItem.poi_id);
        return {
          ...sItem,
          vectorScore: vItem ? vItem.score : 0,
          fusedScore: vItem ? (1 / (idx + 1)) + vItem.score : (1 / (idx + 1))
        };
      });
      break;
  }
  
  // 按融合分数排序
  results.sort((a, b) => (b.fusedScore || 0) - (a.fusedScore || 0));
  
  if (session) {
    session.log('Fusion', 'FuseResults', {
      strategy,
      vectorCount: vectorResults.length,
      spatialCount: spatialResults.length,
      fusedCount: results.length,
      durationMs: Date.now() - startTime
    });
  }
  
  return results;
}

/**
 * 构建精简的 POI 上下文（节省 Token）
 * @param {array} pois - POI 列表
 * @param {boolean} includeCoordinates - 是否包含坐标
 */
function buildPOIContext(pois, includeCoordinates = false) {
  const lines = pois.map((p, i) => {
    const name = p.name || p.poi_name || '未知';
    const category = p.category_small || p.category_mid || p.type || '未分类';
    const distance = p.distance_meters ? `距离${Math.round(p.distance_meters)}m` : '';
    const address = p.address || p.poi_address || '';
    
    let line = `${i + 1}. ${name} [${category}]`;
    if (distance) line += ` - ${distance}`;
    if (address) line += ` - ${address}`;
    if (includeCoordinates && p.lon && p.lat) {
      line += ` 坐标:[${p.lon.toFixed(6)}, ${p.lat.toFixed(6)}]`;
    }
    
    return line;
  });
  
  return lines.join('\n');
}

/**
 * 注册空间查询路由
 */
export default async function spatialRoutes(fastify) {
  
  /**
   * POST /api/spatial/query
   * 空间查询 API（返回结构化数据）
   */
  fastify.post('/query', async (request, reply) => {
    const { query: userQuery, bbox, globalAnalysis = false } = request.body;
    
    if (!userQuery) {
      return reply.code(400).send({ error: '缺少 query 参数' });
    }
    
    // 创建 RAG 会话用于日志记录
    const session = createRAGSession();
    session.setUserQuery(userQuery);
    
    console.log(`[Spatial] 收到查询: ${userQuery}`);
    
    try {
      // 1. 调用 LLM 解析意图
      const prompt = INTENT_PARSE_PROMPT.replace('{user_query}', userQuery);
      const intentResponse = await callLocalLLM(prompt, session);
      const intent = parseIntentResponse(intentResponse);
      
      if (!intent) {
        session.log('LLM', 'IntentParseFailed', { raw: intentResponse });
        session.save();
        return reply.code(400).send({ 
          error: '无法解析查询意图',
          raw: intentResponse 
        });
      }
      
      session.setIntent(intent);
      console.log('[Spatial] 解析意图:', intent);
      
      // 2. 确定检索策略
      const isSpatialQuery = intent.is_spatial_query !== false;
      const hasSemanticQuery = intent.semantic_query || intent.category;
      
      let vectorResults = [];
      let spatialResults = [];
      
      // 3. 执行向量检索（如果有语义需求）
      if (hasSemanticQuery && milvus.isMilvusAvailable()) {
        const semanticText = intent.semantic_query || intent.category;
        vectorResults = await vectorSearch(semanticText, 100, session);
        session.addRetrievedPOIs(vectorResults, 'Milvus');
      }
      
      // 4. 执行空间过滤（如果是空间查询）
      if (isSpatialQuery && intent.place_name) {
        // 解析锚点坐标
        session.log('Geocoder', 'ResolveAnchor', { placeName: intent.place_name, gate: intent.gate });
        const anchor = await resolveAnchor(intent.place_name, intent.gate);
        
        if (anchor) {
          session.log('Geocoder', 'AnchorResolved', { lon: anchor.lon, lat: anchor.lat, source: anchor.source });
          
          const radiusMeters = intent.radius_m || 500;
          spatialResults = await spatialFilter(
            anchor.lon, 
            anchor.lat, 
            radiusMeters, 
            { category: intent.category },
            session
          );
          session.addRetrievedPOIs(spatialResults, 'PostGIS');
          
          // 记录锚点信息
          intent._resolvedAnchor = anchor;
        } else {
          session.log('Geocoder', 'AnchorNotFound', { placeName: intent.place_name });
        }
      }
      
      // 5. 融合结果
      let finalResults = [];
      
      if (vectorResults.length > 0 && spatialResults.length > 0) {
        // 两者都有结果，取交集
        finalResults = fuseResults(vectorResults, spatialResults, 'intersection', session);
        
        // 如果交集太少，改用空间优先策略
        if (finalResults.length < 5 && spatialResults.length >= 5) {
          session.log('Fusion', 'FallbackToSpatialFirst', { intersectionCount: finalResults.length });
          finalResults = fuseResults(vectorResults, spatialResults, 'spatial_first', session);
        }
      } else if (spatialResults.length > 0) {
        finalResults = spatialResults;
        session.log('Fusion', 'SpatialOnly', { count: finalResults.length });
      } else if (vectorResults.length > 0) {
        finalResults = vectorResults;
        session.log('Fusion', 'VectorOnly', { count: finalResults.length });
      }
      
      // 6. 取 Top N 精简结果
      const topN = 20;
      const results = finalResults.slice(0, topN);
      
      session.setFinalPOIs(results);
      session.markSuccess();
      
      // 7. 估算 Token
      const contextLength = buildPOIContext(results, intent.needs_coordinates).length;
      session.estimateTokens(contextLength);
      
      // 保存日志
      session.save();
      
      return {
        success: true,
        center: intent._resolvedAnchor || null,
        intent,
        total: finalResults.length,
        results: results.map(p => ({
          id: p.id || p.poi_id,
          name: p.name || p.poi_name,
          address: p.address || p.poi_address,
          type: p.type || p.poi_type,
          category: {
            mid: p.category_mid || p['中类'],
            small: p.category_small || p['小类'],
          },
          distance: p.distance_meters ? Math.round(p.distance_meters) : null,
          coordinates: (p.lon && p.lat) ? [p.lon, p.lat] : null,
          score: p.fusedScore || p.score || null,
        })),
        // 用于可解释性：返回检索来源统计
        _retrieval: {
          vectorCount: vectorResults.length,
          spatialCount: spatialResults.length,
          fusedCount: results.length,
          milvusUsed: vectorResults.length > 0,
          postgisUsed: spatialResults.length > 0,
        }
      };
    } catch (error) {
      session.log('Error', 'QueryFailed', { error: error.message });
      session.save();
      throw error;
    }
  });
  
  /**
   * POST /api/spatial/chat
   * 空间对话 API（含 LLM 回答生成）
   */
  fastify.post('/chat', async (request, reply) => {
    const { query: userQuery, globalAnalysis = false } = request.body;
    
    // 创建 RAG 会话
    const session = createRAGSession();
    session.setUserQuery(userQuery);
    
    try {
      // 1. 执行空间查询
      const spatialResult = await fastify.inject({
        method: 'POST',
        url: '/api/spatial/query',
        payload: { query: userQuery, globalAnalysis },
      });
      
      const result = JSON.parse(spatialResult.body);
      
      if (!result.success) {
        session.log('Query', 'Failed', { error: result.error });
        session.save();
        return result;
      }
      
      // 2. 构造精简的 LLM Context
      const needsCoordinates = result.intent?.needs_coordinates || false;
      const context = buildPOIContext(result.results, needsCoordinates);
      
      session.log('Context', 'Built', { 
        poiCount: result.results.length, 
        contextLength: context.length,
        estimatedTokens: Math.ceil(context.length / 2)
      });
      
      // 3. 生成回答
      const answerPrompt = `用户问：${userQuery}

根据以下搜索结果回答用户问题。要求：
1. 不要虚构不存在的地点
2. 使用 Markdown 表格展示结果
3. 表格包含：名称、类别、距离、简要推荐理由
4. 最后给出 1-2 句总结推荐

## 检索到的 POI 数据 (共 ${result.results.length} 条)
${context}

请给出简洁、友好的回答：`;
      
      const answer = await callLocalLLM(answerPrompt, session);
      
      // 移除思考标签
      const cleanAnswer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      
      session.markSuccess();
      session.save();
      
      return {
        ...result,
        answer: cleanAnswer,
        // 可解释性信息
        _explainability: {
          retrievalSources: result._retrieval,
          contextTokens: Math.ceil(context.length / 2),
          poiUsed: result.results.map(p => ({ name: p.name, category: p.category?.small }))
        }
      };
    } catch (error) {
      session.log('Error', 'ChatFailed', { error: error.message });
      session.save();
      throw error;
    }
  });
  
  /**
   * POST /api/spatial/fetch
   * 根据类别列表获取 POI（源自 PostGIS）
   */
  fastify.post('/fetch', async (request, reply) => {
    const {
      categories = [],
      limit = 100000,
      bounds,
      geometry: geometryInput,
      regions = []
    } = request.body || {};

    if (!Array.isArray(categories)) {
      return reply.code(400).send({ error: 'categories must be an array' });
    }

    if (!Array.isArray(regions) && regions !== undefined) {
      return reply.code(400).send({ error: 'regions must be an array when provided' });
    }

    // 统一清洗类别输入，确保 SQL 与 gRPC 路径过滤条件完全一致。
    const normalizedCategories = categories
      .filter((cat) => typeof cat === 'string' && cat.trim())
      .map((cat) => cat.trim());

    const polygonCoordsToWKT = (coords = []) => {
      if (!Array.isArray(coords) || coords.length < 3) return null;

      const points = coords
        .map((pt) => {
          if (Array.isArray(pt) && pt.length >= 2) {
            return [Number(pt[0]), Number(pt[1])];
          }
          if (pt && typeof pt === 'object') {
            return [Number(pt.lon ?? pt.lng), Number(pt.lat)];
          }
          return null;
        })
        .filter((pt) => Number.isFinite(pt?.[0]) && Number.isFinite(pt?.[1]));

      if (points.length < 3) return null;
      const first = points[0];
      const last = points[points.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        points.push(first);
      }
      return `POLYGON((${points.map(([lon, lat]) => `${lon} ${lat}`).join(', ')}))`;
    };

    const normalizeCircleCenter = (center) => {
      if (Array.isArray(center) && center.length >= 2) {
        const lon = Number(center[0]);
        const lat = Number(center[1]);
        return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
      }
      if (center && typeof center === 'object') {
        const lon = Number(center.lon ?? center.lng ?? center.longitude);
        const lat = Number(center.lat ?? center.latitude);
        return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
      }
      return null;
    };

    const circleToWKT = (center, radiusMeters, segments = 72) => {
      const centerPoint = normalizeCircleCenter(center);
      const radius = Number(radiusMeters);
      if (!centerPoint || !Number.isFinite(radius) || radius <= 0) return null;

      const [centerLon, centerLat] = centerPoint;
      const earthRadius = 6378137;
      const angularDistance = radius / earthRadius;
      const lat1 = (centerLat * Math.PI) / 180;
      const lon1 = (centerLon * Math.PI) / 180;

      const points = [];
      for (let i = 0; i <= segments; i += 1) {
        const bearing = (i / segments) * 2 * Math.PI;
        const sinLat2 = Math.sin(lat1) * Math.cos(angularDistance)
          + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
        const lat2 = Math.asin(sinLat2);
        const lon2 = lon1 + Math.atan2(
          Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
          Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
        );

        const lon = (lon2 * 180) / Math.PI;
        const lat = (lat2 * 180) / Math.PI;
        points.push(`${lon} ${lat}`);
      }

      return `POLYGON((${points.join(', ')}))`;
    };

    const boundsToWKT = (inputBounds) => {
      if (!Array.isArray(inputBounds) || inputBounds.length < 4) return null;
      const [w, s, e, n] = inputBounds.map(Number);
      if (![w, s, e, n].every(Number.isFinite)) return null;
      return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
    };

    const resolveRegionWKT = (region) => {
      if (!region || typeof region !== 'object') return null;

      if (typeof region.boundaryWKT === 'string' && region.boundaryWKT.trim()) {
        return region.boundaryWKT.trim();
      }
      if (typeof region.wkt === 'string' && region.wkt.trim()) {
        return region.wkt.trim();
      }

      const geometry = region.geometry;
      if (geometry && typeof geometry === 'object') {
        const geometryType = String(geometry.type || '').toLowerCase();
        if (geometryType === 'polygon') {
          return polygonCoordsToWKT(geometry.coordinates?.[0]);
        }
        if (geometryType === 'multipolygon') {
          return polygonCoordsToWKT(geometry.coordinates?.[0]?.[0]);
        }
        if (geometryType === 'point') {
          return circleToWKT(geometry.coordinates, geometry.radius ?? region.radius);
        }
      }

      return circleToWKT(region.center, region.radius);
    };

    const mergeRows = (rows = []) => {
      const merged = [];
      const seen = new Set();
      for (const row of rows) {
        const lon = Number(row?.lon);
        const lat = Number(row?.lat);
        const key = [
          row?.id ?? row?.poiid ?? row?.name ?? '',
          Number.isFinite(lon) ? lon.toFixed(6) : '',
          Number.isFinite(lat) ? lat.toFixed(6) : ''
        ].join('|');
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(row);
        }
      }
      return merged;
    };

    try {
      const queryGeometries = [];
      if (Array.isArray(regions) && regions.length > 0) {
        regions
          .map(resolveRegionWKT)
          .filter(Boolean)
          .forEach((wkt) => queryGeometries.push(wkt));
      }

      if (queryGeometries.length === 0) {
        const fallbackGeometry =
          (typeof geometryInput === 'string' && geometryInput.trim())
            ? geometryInput.trim()
            : boundsToWKT(bounds);
        if (fallbackGeometry) {
          queryGeometries.push(fallbackGeometry);
        }
      }

      if (queryGeometries.length === 0) {
        return {
          success: true,
          count: 0,
          features: [],
          diagnostics: {
            engine: 'none',
            reason: 'no_spatial_constraint'
          }
        };
      }

      const maxLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || '20000', 10);
      const normalizedLimit = Number(limit);
      const safeLimit = Number.isFinite(normalizedLimit)
        ? Math.max(1, Math.min(normalizedLimit, maxLimit))
        : Math.min(100, maxLimit);

      const hasCustomArea =
        (Array.isArray(regions) && regions.length > 0) ||
        (typeof geometryInput === 'string' && geometryInput.trim().length > 0);

      // 复用 JobRunner / Executor 的 source-policy 内核，避免三条链路规则漂移。
      const fetchSourcePolicy = resolveSourcePolicy(
        {
          query_type: 'poi_fetch',
          categories: normalizedCategories
        },
        {
          mode: hasCustomArea ? 'Polygon' : 'Viewport',
          viewport: bounds,
          regions: hasCustomArea
            ? queryGeometries.map((wkt, index) => ({ id: index + 1, wkt }))
            : []
        },
        {
          selectedCategories: normalizedCategories,
          regions,
          sourcePolicy: {
            enforceUiConstraints: true,
            hasCategoryFilter: normalizedCategories.length > 0,
            hasCustomArea
          }
        }
      ).policy;

      const toFeature = (poi) => {
        const lon = Number.parseFloat(poi?.lon);
        const lat = Number.parseFloat(poi?.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          return null;
        }

        return {
          type: 'Feature',
          id: poi?.id || poi?.poiid,
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          },
          properties: {
            name: poi?.name,
            address: poi?.address,
            type: poi?.type,
            category_mid: poi?.category_mid,
            category_small: poi?.category_small,
          }
        };
      };

      const preferPythonFetch = process.env.SPATIAL_FETCH_PY_ENABLED !== 'false';
      if (preferPythonFetch && isGrpcComputeEnabled()) {
        try {
          const requestId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const spatialContext = {
            mode: 'Polygon',
            regions: queryGeometries.map((wkt, index) => ({
              id: index + 1,
              kind: 'polygon',
              wkt
            }))
          };

          let finalPayload = null;
          await computeSpatialStream(
            {
              request_id: requestId,
              query_type: 'poi_fetch',
              spatial_context: JSON.stringify(spatialContext),
              categories: normalizedCategories,
              hints: JSON.stringify({
                semantic_query: '',
                options: {
                  limit: safeLimit,
                  maxFetchLimit: maxLimit,
                  sourcePolicy: fetchSourcePolicy,
                  selectedCategories: fetchSourcePolicy.selected_categories,
                }
              }),
              mode: 'sync',
              candidates_json: '',
              execution_profile: 'core',
              dry_run: false
            },
            async (event) => {
              if (event.type === 'ERROR') {
                throw new Error(event.payload?.message || 'Python fetch returned ERROR event');
              }
              if (event.type === 'FINAL') {
                finalPayload = event.payload;
              }
            }
          );

          const pythonRows = Array.isArray(finalPayload?.results?.pois)
            ? finalPayload.results.pois
            : [];
          const results = mergeRows(pythonRows).slice(0, safeLimit);

          return {
            success: true,
            count: results.length,
            features: results.map(toFeature).filter(Boolean),
            diagnostics: {
              engine: 'python_grpc',
              fallback: false,
              request_id: requestId,
              query_geometries: queryGeometries.length,
              source_policy: fetchSourcePolicy
            }
          };
        } catch (pythonError) {
          fastify.log.warn({ err: pythonError }, '[spatial/fetch] Python fetch failed, fallback to Node SQL');
        }
      }

      const batches = await Promise.all(
        queryGeometries.map((wkt) => db.findPOIsFiltered({
          categories: normalizedCategories,
          geometry: wkt,
          limit: safeLimit
        }))
      );

      const rawResults = mergeRows(batches.flat());
      const results = rawResults.slice(0, safeLimit);

      return {
        success: true,
        count: results.length,
        features: results.map(toFeature).filter(Boolean),
        diagnostics: {
          engine: 'node_sql_fallback',
          fallback: true,
          query_geometries: queryGeometries.length,
          source_policy: fetchSourcePolicy
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Fetch failed', details: error.message });
    }
  });

  /**
   * GET /api/spatial/status
   * 服务状态检查
   */
  fastify.get('/status', async () => {
    return {
      postgis: true,
      milvus: milvus.isMilvusAvailable(),
    };
  });
}
