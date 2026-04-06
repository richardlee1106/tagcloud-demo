/**
 * 混合检索服务
 *
 * 使用 PostGIS 空间索引进行空间过滤 + JS 向量相似度计算。
 *
 * 架构：
 * - PostGIS: 空间过滤（利用 GiST 索引，~150ms）
 * - JS: 向量相似度计算（~1ms）
 *
 * 优化：支持从预构建缓存文件加载，启动时间从 ~170s 降至 ~5s
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

import { query } from '../data/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  candidateMatchesSemanticSubtype,
  getEntityConceptDefinition,
  inferCandidateEntitySemantics
} from '../ai/entityOntology.js';

// 缓存文件配置
const CACHE_VERSION = 1;
const MAGIC = 'POI4';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveEmbeddingCachePath({
  cwd = process.cwd(),
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  const candidates = [
    env.FAISS_CACHE_FILE,
    path.join(cwd, 'cache', 'embeddings.bin'),
    path.resolve(MODULE_DIR, '..', '..', 'cache', 'embeddings.bin'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || path.join(cwd, 'cache', 'embeddings.bin');
}

// 全局索引状态（用于向量相似度计算）
let indexState = {
  loaded: false,
  embeddings: null,      // Float32Array [N, 352]
  poiIdToIndex: null,     // Map<id, index>
  loadTime: null,
};

// 是否正在加载
let isLoading = false;

/**
 * 从预构建缓存文件加载 embeddings
 * @returns {boolean} 是否成功加载
 */
function loadFromCache() {
  const cacheFile = resolveEmbeddingCachePath();
  if (!fs.existsSync(cacheFile)) {
    return false;
  }

  try {
    const startTime = Date.now();
    const fd = fs.openSync(cacheFile, 'r');
    const stats = fs.fstatSync(fd);

    // 读取 header (24 bytes)
    const header = Buffer.alloc(24);
    fs.readSync(fd, header, 0, 24, 0);

    // 解析 header
    const magic = header.toString('ascii', 0, 4);
    if (magic !== MAGIC) {
      console.log(`[HybridSearch] Cache file magic mismatch, skipping: ${cacheFile}`);
      fs.closeSync(fd);
      return false;
    }

    const version = header.readUInt32LE(4);
    if (version !== CACHE_VERSION) {
      console.log(`[HybridSearch] Cache file version mismatch, skipping: ${cacheFile}`);
      fs.closeSync(fd);
      return false;
    }

    const count = header.readUInt32LE(8);
    const dim = header.readUInt32LE(12);
    const timestamp = header.readBigUInt64LE(16);

    console.log(`[HybridSearch] Cache file: ${count} POIs, ${dim} dims (${cacheFile})`);

    // 计算数据大小
    const idsSize = count * 4;
    const embeddingsSize = count * dim * 4;
    const expectedSize = 24 + idsSize + embeddingsSize;

    if (stats.size !== expectedSize) {
      console.log(`[HybridSearch] Cache file size mismatch: ${stats.size} != ${expectedSize} (${cacheFile})`);
      fs.closeSync(fd);
      return false;
    }

    // 读取 ID 数组
    const idsBuffer = Buffer.alloc(idsSize);
    fs.readSync(fd, idsBuffer, 0, idsSize, 24);
    const ids = new Uint32Array(idsBuffer.buffer, idsBuffer.byteOffset, idsBuffer.byteLength / 4);

    // 读取 embeddings
    const embeddingsBuffer = Buffer.alloc(embeddingsSize);
    fs.readSync(fd, embeddingsBuffer, 0, embeddingsSize, 24 + idsSize);
    const embeddings = new Float32Array(embeddingsBuffer.buffer, embeddingsBuffer.byteOffset, embeddingsBuffer.byteLength / 4);

    fs.closeSync(fd);

    // 构建 id -> index 映射
    const poiIdToIndex = new Map();
    for (let i = 0; i < count; i++) {
      poiIdToIndex.set(ids[i], i);
    }

    indexState = {
      loaded: true,
      embeddings,
      poiIdToIndex,
      embeddingDim: dim,
      loadTime: Date.now() - startTime,
    };

    console.log(`[HybridSearch] Loaded from cache in ${indexState.loadTime}ms (${count} POIs)`);
    return true;

  } catch (err) {
    console.error('[HybridSearch] Cache load error:', err.message);
    return false;
  }
}

/**
 * 从数据库加载 embedding 数据（用于向量相似度计算）
 * 空间过滤由 PostGIS 负责，这里只加载 embedding
 *
 * @param {boolean} force - 强制重新加载
 */
export async function loadEmbeddings(force = false) {
  if (indexState.loaded && !force) {
    console.log('[HybridSearch] Embeddings already loaded');
    return true;
  }

  // 强制重新加载时重置状态
  if (force) {
    console.log('[HybridSearch] Force reload, resetting state...');
    indexState = {
      loaded: false,
      embeddings: null,
      poiIdToIndex: null,
      loadTime: null,
    };
    isLoading = false;
  }

  if (isLoading) {
    console.log('[HybridSearch] Already loading, please wait...');
    return false;
  }

  isLoading = true;
  console.log('[HybridSearch] Loading embeddings for vector similarity...');
  const startTime = Date.now();

  // 尝试从缓存文件加载
  if (!force && loadFromCache()) {
    isLoading = false;
    return true;
  }

  console.log('[HybridSearch] Cache not available, loading from database...');

  try {
    // 只查询 ID 和 embedding，大幅减少数据量
    const countResult = await query('SELECT COUNT(*) as count FROM pois WHERE spatial_embedding IS NOT NULL');
    const totalCount = parseInt(countResult.rows[0].count);

    if (totalCount === 0) {
      console.error('[HybridSearch] No embeddings found in database');
      isLoading = false;
      return false;
    }

    console.log(`[HybridSearch] Loading ${totalCount} embeddings...`);

    const BATCH_SIZE = 100000;
    const embeddingDim = 352;
    const embeddings = new Float32Array(totalCount * embeddingDim);
    const poiIdToIndex = new Map();

    let loadedCount = 0;

    for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
      const sql = `
        SELECT id, spatial_embedding
        FROM pois
        WHERE spatial_embedding IS NOT NULL
        ORDER BY id
        LIMIT $1 OFFSET $2
      `;

      const result = await query(sql, [BATCH_SIZE, offset]);

      for (const row of result.rows) {
        const i = loadedCount;
        poiIdToIndex.set(row.id, i);

        // 解析 embedding
        let emb = row.spatial_embedding;
        if (typeof emb === 'string') {
          try {
            emb = JSON.parse(emb);
          } catch (e) {
            emb = new Array(embeddingDim).fill(0);
          }
        }

        // 复制到数组
        for (let j = 0; j < embeddingDim; j++) {
          embeddings[i * embeddingDim + j] = emb[j] || 0;
        }

        loadedCount++;
      }

      console.log(`[HybridSearch] Loaded ${loadedCount}/${totalCount} embeddings...`);
    }

    indexState = {
      loaded: true,
      embeddings,
      poiIdToIndex,
      embeddingDim,
      loadTime: Date.now() - startTime,
    };

    console.log(`[HybridSearch] Successfully loaded ${loadedCount} embeddings in ${indexState.loadTime}ms`);
      console.log(`[HybridSearch] Tip: Run 'node scripts/cache/build_embedding_cache.js' to speed up future startups`);
    isLoading = false;
    return true;

  } catch (err) {
    console.error('[HybridSearch] Failed to load embeddings:', err.message);
    isLoading = false;
    return false;
  }
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(queryEmb, candidateEmb, embeddingDim) {
  let dot = 0, queryNorm = 0, candNorm = 0;
  for (let i = 0; i < embeddingDim; i++) {
    dot += queryEmb[i] * candidateEmb[i];
    queryNorm += queryEmb[i] ** 2;
    candNorm += candidateEmb[i] ** 2;
  }
  return (queryNorm > 0 && candNorm > 0) ? dot / (Math.sqrt(queryNorm) * Math.sqrt(candNorm)) : 0.5;
}

/**
 * 类别映射表：用户意图类别 → 数据库类别
 *
 * 数据库实际类别：
 * - 餐饮美食 (中国菜, 小吃快餐, 咖啡, 茶座等) - OSM新增
 * - 住宿服务 (宾馆酒店, 旅馆招待所)
 * - 金融保险服务 (银行, ATM)
 * - 风景名胜 (风景名胜, 公园广场)
 * - 体育休闲服务 (娱乐场所, 运动场馆)
 * - 科教文化服务 (学校, 培训机构)
 * - 医疗保健服务 (医药保健销售店)
 */
const CATEGORY_MAPPING = {
  // 餐饮美食（OSM新增）
  '餐饮美食': { dbCategories: ['餐饮美食'], useNameFilter: false },  // 直接匹配数据库类别
  '餐饮': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '餐厅': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '饭店': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '美食': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '小吃': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '火锅': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '烧烤': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '快餐': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '外卖': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '中国菜': { dbCategories: ['餐饮美食'], useNameFilter: false },

  // 咖啡茶饮
  '咖啡': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '奶茶': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '茶饮': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '甜品': { dbCategories: ['餐饮美食'], useNameFilter: false },
  '蛋糕': { dbCategories: ['餐饮美食'], useNameFilter: false },

  // 住宿
  '住宿服务': { dbCategories: ['住宿服务'], useNameFilter: false },  // 直接匹配数据库类别
  '住宿': { dbCategories: ['住宿服务', '酒店住宿'], useNameFilter: false },
  '酒店': { dbCategories: ['住宿服务', '酒店住宿'], useNameFilter: false },
  '宾馆': { dbCategories: ['住宿服务', '酒店住宿'], useNameFilter: false },
  '旅馆': { dbCategories: ['住宿服务', '酒店住宿'], useNameFilter: false },
  '民宿': { dbCategories: ['住宿服务', '酒店住宿'], useNameFilter: false },

  // 金融
  '金融保险服务': { dbCategories: ['金融保险服务'], useNameFilter: false },
  '金融': { dbCategories: ['金融保险服务'], useNameFilter: false },
  '银行': { dbCategories: ['金融保险服务'], useNameFilter: false },
  'ATM': { dbCategories: ['金融保险服务'], useNameFilter: false },

  // 景点
  '风景名胜': { dbCategories: ['风景名胜'], useNameFilter: false },
  '景点': { dbCategories: ['风景名胜', '旅游景点'], useNameFilter: false },
  '公园': { dbCategories: ['风景名胜', '旅游景点'], useNameFilter: false },
  '旅游': { dbCategories: ['风景名胜', '旅游景点'], useNameFilter: false },
  '景区': { dbCategories: ['风景名胜', '旅游景点'], useNameFilter: false },

  // 娱乐
  '体育休闲服务': { dbCategories: ['体育休闲服务'], useNameFilter: false },
  '娱乐': { dbCategories: ['体育休闲服务', '休闲娱乐'], useNameFilter: false },
  'KTV': { dbCategories: ['体育休闲服务', '休闲娱乐'], useNameFilter: false },
  '电影院': { dbCategories: ['体育休闲服务', '休闲娱乐'], useNameFilter: false },
  '网吧': { dbCategories: ['体育休闲服务', '休闲娱乐'], useNameFilter: false },

  // 教育
  '科教文化服务': { dbCategories: ['科教文化服务'], useNameFilter: false },
  '教育': { dbCategories: ['科教文化服务'], useNameFilter: false },
  '学校': { dbCategories: ['科教文化服务'], useNameFilter: false },
  '大学': { dbCategories: ['科教文化服务'], useNameFilter: false },
  '培训': { dbCategories: ['科教文化服务'], useNameFilter: false },

  // 医疗
  '医疗保健服务': { dbCategories: ['医疗保健服务'], useNameFilter: false },
  '医疗': { dbCategories: ['医疗保健服务'], useNameFilter: false },
  '医院': { dbCategories: ['医疗保健服务'], useNameFilter: false },
  '药店': { dbCategories: ['医疗保健服务'], useNameFilter: false },

  // 购物
  '购物服务': { dbCategories: ['购物服务'], useNameFilter: false },
  '购物': { dbCategories: ['购物服务', '购物消费'], useNameFilter: false },
  '超市': { dbCategories: ['购物服务', '购物消费'], useNameFilter: false },
  '商场': { dbCategories: ['购物服务', '购物消费'], useNameFilter: false },
  '便利店': { dbCategories: ['购物服务', '购物消费'], useNameFilter: false },

  // 汽车
  '汽车服务': { dbCategories: ['汽车服务', '汽车相关'], useNameFilter: false },
  '加油站': { dbCategories: ['汽车服务', '汽车相关'], useNameFilter: false },
  '充电站': { dbCategories: ['汽车服务', '汽车相关'], useNameFilter: false },

  // 交通
  '交通设施服务': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '地铁': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '地铁站': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '公交': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '公交站': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '公交车站': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '停车场': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '火车站': { dbCategories: ['交通设施服务'], useNameFilter: false },
  '高铁站': { dbCategories: ['交通设施服务'], useNameFilter: false },

  // 运动
  '运动': { dbCategories: ['体育休闲服务', '运动健身'], useNameFilter: false },
  '健身': { dbCategories: ['体育休闲服务', '运动健身'], useNameFilter: false },
  '体育': { dbCategories: ['体育休闲服务', '运动健身'], useNameFilter: false },
};

/**
 * 餐饮关键词列表 - 用于名称匹配
 */
const FOOD_KEYWORDS = [
  '餐厅', '饭店', '美食', '小吃', '快餐', '面馆',
  '披萨', '汉堡', '寿司', '西餐', '中餐', '湘菜', '川菜',
  '粤菜', '自助餐', '料理', '私房菜', '家常菜', '农家菜', '大排档',
  '小龙虾', '烤鱼', '串串', '冒菜', '麻辣烫', '香锅',
  '饺子', '馄饨', '包子', '粥', '米粉', '面条', '盖浇饭', '便当',
  '肯德基', '麦当劳', '必胜客', '德克士', '华莱士',
];

/**
 * 咖啡茶饮关键词列表
 */
const DRINK_KEYWORDS = [
  '咖啡馆', '咖啡店', '咖啡厅', '奶茶店', '甜品店', '冰淇淋店',
  '星巴克', '瑞幸', '喜茶', '奈雪', '蜜雪冰城', 'CoCo', '一点点',
  '茶百道', '古茗', '书亦烧仙草', '沪上阿姨', '益禾堂',
];

/**
 * 排除关键词 - 这些不是真正的餐厅
 */
const EXCLUDE_KEYWORDS = [
  // 停车场相关
  '停车场', '停车位', '地上停车场', '地下停车场',
  // 公共设施
  '公共厕所', '出入口',
];

/**
 * 充电宝/共享设备关键词 - 需要提取括号内的真实店名
 */
const SHARED_DEVICE_PATTERNS = ['怪兽充电', '街电', '来电', '小电', '充电'];

/**
 * 从名称中提取真实的店铺名（处理充电宝等污染）
 * @param {string} name - POI名称
 * @returns {string} - 清理后的名称
 */
function extractRealName(name) {
  if (!name) return name;

  // 处理 "怪兽充电(xxx店)" 格式
  for (const prefix of SHARED_DEVICE_PATTERNS) {
    if (name.startsWith(prefix + '(')) {
      // 提取括号内的内容
      const match = name.match(/\((.+)\)/);
      if (match) {
        return match[1];
      }
    }
  }

  return name;
}

/**
 * 判断POI是否属于餐饮类（基于名称）
 * @param {string} originalName - POI原始名称
 * @returns {boolean}
 */
function isFoodPOI(originalName) {
  if (!originalName) return false;

  // 提取真实名称
  const name = extractRealName(originalName);

  // 先排除停车场等
  for (const ex of EXCLUDE_KEYWORDS) {
    if (name.includes(ex)) return false;
  }

  // 排除食材超市、原料批发等
  if (name.includes('食材超市') || name.includes('食材店') ||
      name.includes('原料批发') || name.includes('设备批发')) {
    return false;
  }

  // 检查是否包含餐饮关键词
  for (const kw of FOOD_KEYWORDS) {
    if (name.includes(kw)) return true;
  }

  return false;
}

/**
 * 判断POI是否属于咖啡茶饮类（基于名称）
 * @param {string} originalName - POI原始名称
 * @returns {boolean}
 */
function isDrinkPOI(originalName) {
  if (!originalName) return false;

  // 提取真实名称
  const name = extractRealName(originalName);

  // 先排除停车场等
  for (const ex of EXCLUDE_KEYWORDS) {
    if (name.includes(ex)) return false;
  }

  // 排除原料批发
  if (name.includes('原料') || name.includes('批发') || name.includes('设备')) {
    return false;
  }

  // 检查是否包含咖啡茶饮关键词
  for (const kw of DRINK_KEYWORDS) {
    if (name.includes(kw)) return true;
  }

  return false;
}

/**
 * 获取类别配置
 * @param {string} userCategory - 用户意图类别
 * @returns {{ dbCategories: string[], useNameFilter: boolean }}
 */
export function getCategoryConfig(userCategory) {
  if (!userCategory) return { dbCategories: [], useNameFilter: false };

  const semanticDefinition = getEntityConceptDefinition(userCategory)
  if (semanticDefinition?.dbCategory) {
    return {
      dbCategories: [semanticDefinition.dbCategory],
      useNameFilter: false
    }
  }

  // 直接匹配
  if (CATEGORY_MAPPING[userCategory]) {
    return CATEGORY_MAPPING[userCategory];
  }

  // 部分匹配
  for (const [key, config] of Object.entries(CATEGORY_MAPPING)) {
    if (userCategory.includes(key) || key.includes(userCategory)) {
      return config;
    }
  }

  return { dbCategories: [], useNameFilter: false };
}

const SUBCATEGORY_FILTER_CONFIG = {
  '地铁站': { exactValues: ['地铁站'] },
  '公交车站': { exactValues: ['公交车站'] },
  '火车站': { exactValues: ['火车站'] },
  '停车场': { exactValues: ['停车场'] },
  '咖啡': {
    exactValues: ['咖啡'],
    keywords: ['咖啡', 'coffee', 'cafe', 'luckin', '瑞幸', '星巴克', 'manner', 'm stand', 'mstand', 'costa']
  },
  '商超': {
    exactValues: [],
    keywords: ['超市', '便利', '商场', '购物中心', '百货', '生鲜', '副食'],
    excludedKeywords: ['机房', '旗舰店', '专卖', '营业厅', '移动', '联通', '电信', '通讯']
  }
}

function getSubcategoryFilterConfig(subcategory = null) {
  if (!subcategory) {
    return { exactValues: [], keywords: [] }
  }
  const semanticDefinition = getEntityConceptDefinition(subcategory)
  if (semanticDefinition) {
    const explicitConfig = SUBCATEGORY_FILTER_CONFIG[subcategory]
    if (explicitConfig) {
      return explicitConfig
    }
    return {
      exactValues: [],
      keywords: [...new Set([...(semanticDefinition.aliases || []), ...(semanticDefinition.brands || [])])],
      excludedKeywords: []
    }
  }
  return SUBCATEGORY_FILTER_CONFIG[subcategory] || {
    exactValues: [subcategory],
    keywords: []
  }
}

function buildCandidateSearchCorpus(candidate = {}) {
  return [
    candidate?.name,
    candidate?.category,
    candidate?.categoryMain,
    candidate?.categorySub
  ]
    .map((item) => String(item || '').toLowerCase())
    .join(' ')
}

export function applySemanticSubcategoryFilter(candidates = [], subcategory = null) {
  const { keywords = [], excludedKeywords = [] } = getSubcategoryFilterConfig(subcategory)
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return Array.isArray(candidates) ? candidates : []
  }

  const semanticMatches = []
  const fallbackMatches = []

  for (const candidate of candidates) {
    const corpus = buildCandidateSearchCorpus(candidate)
    if (excludedKeywords.some((keyword) => corpus.includes(String(keyword).toLowerCase()))) {
      continue
    }

    const semanticMatch = candidateMatchesSemanticSubtype(candidate, subcategory)
    if (semanticMatch.matched) {
      semanticMatches.push({
        ...candidate,
        semantic_entity_concepts: semanticMatch.concepts,
        semantic_entity_match_source: semanticMatch.source,
        semantic_entity_match_score: semanticMatch.score
      })
      continue
    }

    if (keywords.length === 0) {
      continue
    }

    if (keywords.some((keyword) => corpus.includes(String(keyword).toLowerCase()))) {
      const inferred = inferCandidateEntitySemantics(candidate)
      fallbackMatches.push({
        ...candidate,
        semantic_entity_concepts: inferred.concepts,
        semantic_entity_match_source: 'keyword_fallback',
        semantic_entity_match_score: 0.55
      })
    }
  }

  return [...semanticMatches, ...fallbackMatches]
}

/**
 * 混合检索：PostGIS 空间过滤 + 向量相似度
 *
 * 架构：
 * - PostGIS (GiST 索引): 空间过滤 ~150ms
 * - JS: 向量相似度计算 ~1ms
 *
 * @param {Object} params - 检索参数
 * @returns {Promise<Array>} - 检索结果
 */
export async function faissHybridSearch(params) {
  const {
    anchor,           // {lon, lat}
    radius,           // 半径（米）
    queryEmbedding,   // 查询向量 [352]
    categories = [],  // 用户意图类别
    subcategory = null,
    topK = 20,
    spatialWeight = 0.6,
    semanticWeight = 0.4,
    regionWeight = 0.15,  // 区域加分权重
    targetRegion = null,  // 目标区域类型（0-5）
    regionFilterMode = 'boost',  // 'boost' 加分 | 'strict' 严格过滤
  } = params;

  const startTime = Date.now();

  // 解析类别配置
  let dbCategories = [];
  let useNameFilter = false;
  const subcategoryConfig = getSubcategoryFilterConfig(subcategory)

  for (const cat of categories) {
    const config = getCategoryConfig(cat);
    dbCategories.push(...(config.dbCategories || []));
    if (config.useNameFilter) {
      useNameFilter = true;
    }
  }

  dbCategories = [...new Set(dbCategories)];
  const hasRegionFilter = targetRegion !== null && targetRegion !== undefined;

  console.log(`[HybridSearch] Category: ${categories.join(',')} → db:[${dbCategories.join(',')}] sub:${subcategory || '-'} region:${targetRegion}`);

  try {
    // Step 1: PostGIS 空间过滤（利用 GiST 索引）
    const t1 = Date.now();

    // 构建类别过滤条件
    const queryParams = [anchor.lon, anchor.lat, radius];
    let nextParamIndex = 4;

    let categoryCondition = '';
    if (dbCategories.length > 0) {
      categoryCondition = `AND category_main = ANY($${nextParamIndex})`;
      queryParams.push(dbCategories);
      nextParamIndex += 1;
    }

    let subcategoryCondition = '';
    if (subcategoryConfig.exactValues.length > 0) {
      subcategoryCondition = `AND category_sub = ANY($${nextParamIndex})`;
      queryParams.push(subcategoryConfig.exactValues);
      nextParamIndex += 1;
    }

    // 区域过滤条件
    let regionCondition = '';
    if (hasRegionFilter && regionFilterMode === 'strict') {
      regionCondition = `AND region_label = $${nextParamIndex}`;
      queryParams.push(targetRegion);
      nextParamIndex += 1;
    }

    const sql = `
      SELECT
        id,
        name,
        category_main,
        category_sub,
        COALESCE(category_sub, category_main) as category,
        region_label,
        ST_X(geom) AS lon,
        ST_Y(geom) AS lat,
        ST_Distance(geom::geography, ST_MakePoint($1, $2)::geography) as distance_m,
        spatial_embedding
      FROM pois
      WHERE ST_DWithin(geom::geography, ST_MakePoint($1, $2)::geography, $3)
        ${categoryCondition}
        ${subcategoryCondition}
        ${regionCondition}
      ORDER BY distance_m
      LIMIT 100
    `;

    const result = await query(sql, queryParams);
    let candidates = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      categoryMain: row.category_main,
      categorySub: row.category_sub,
      regionLabel: row.region_label,
      lon: row.lon,
      lat: row.lat,
      distance_m: parseFloat(row.distance_m),
      embedding: row.spatial_embedding,
    }));

    const searchDuration = Date.now() - t1;
    console.log(`[HybridSearch] PostGIS spatial filter: ${candidates.length} candidates in ${searchDuration}ms`);

    // 如果严格过滤结果太少，再查一次不带区域过滤的
    if (hasRegionFilter && regionFilterMode === 'strict' && candidates.length < 5) {
      const fallbackSql = `
        SELECT
          id, name, category_main, category_sub, COALESCE(category_sub, category_main) as category, region_label,
          ST_X(geom) AS lon, ST_Y(geom) AS lat,
          ST_Distance(geom::geography, ST_MakePoint($1, $2)::geography) as distance_m,
          spatial_embedding
        FROM pois
        WHERE ST_DWithin(geom::geography, ST_MakePoint($1, $2)::geography, $3)
          ${categoryCondition}
          ${subcategoryCondition}
        ORDER BY distance_m
        LIMIT 20
      `;
      const fallbackParams = [anchor.lon, anchor.lat, radius];
      if (dbCategories.length > 0) {
        fallbackParams.push(dbCategories);
      }
      if (subcategory) {
        fallbackParams.push(subcategory);
      }
      const fallbackResult = await query(fallbackSql, fallbackParams);

      for (const row of fallbackResult.rows) {
        if (!candidates.find(c => c.id === row.id)) {
          candidates.push({
            id: row.id,
            name: row.name,
            category: row.category_sub || row.category_main,
            categoryMain: row.category_main,
            categorySub: row.category_sub,
            regionLabel: row.region_label,
            lon: row.lon,
            lat: row.lat,
            distance_m: parseFloat(row.distance_m),
            embedding: row.spatial_embedding,
          });
        }
      }
      console.log(`[HybridSearch] Added fallback results, total: ${candidates.length}`);
    }

    if (candidates.length === 0) {
      return [];
    }

    candidates = applySemanticSubcategoryFilter(candidates, subcategory)
    if (candidates.length === 0) {
      return []
    }

    // Step 2: 计算语义相似度（JS 实现）
    const t2 = Date.now();

    // 确保 embedding 已加载
    if (!indexState.loaded) {
      await loadEmbeddings();
    }

    if (queryEmbedding && indexState.loaded) {
      const queryEmb = new Float32Array(queryEmbedding);
      const embeddingDim = indexState.embeddingDim;

      for (const c of candidates) {
        // 从内存获取 embedding，或使用数据库返回的
        let poiEmb;
        const idx = indexState.poiIdToIndex?.get(c.id);
        if (idx !== undefined) {
          // 从内存数组获取
          poiEmb = indexState.embeddings.slice(idx * embeddingDim, (idx + 1) * embeddingDim);
        } else if (c.embedding) {
          // 使用数据库返回的 embedding
          poiEmb = typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding;
        }

        if (poiEmb) {
          c.semantic_score = cosineSimilarity(queryEmb, poiEmb, embeddingDim);
        } else {
          c.semantic_score = 0.5;
        }

        delete c.embedding; // 清理临时字段
      }
    } else {
      for (const c of candidates) {
        c.semantic_score = 0.5;
      }
    }

    const simDuration = Date.now() - t2;

    // Step 3: 计算融合分数
    const t3 = Date.now();
    let maxDist = Math.max(...candidates.map(c => c.distance_m));

    for (const c of candidates) {
      c.spatial_score = maxDist > 0 ? 1 - (c.distance_m / maxDist) : 0.5;

      // 区域加分
      let region_boost = 0;
      if (targetRegion !== null && c.regionLabel === targetRegion) {
        region_boost = regionWeight;
      }

      c.fused_score = spatialWeight * c.spatial_score + semanticWeight * c.semantic_score + region_boost;
    }

    // Step 4: 排序并返回 topK
    candidates.sort((a, b) => b.fused_score - a.fused_score);
    const results = candidates.slice(0, topK);

    const totalDuration = Date.now() - startTime;
    console.log(`[HybridSearch] Total: ${results.length} results in ${totalDuration}ms (PostGIS: ${searchDuration}ms, Sim: ${simDuration}ms)`);

    return results;

  } catch (err) {
    console.error('[HybridSearch] Search failed:', err.message);
    return [];
  }
}

/**
 * 区域名称映射
 */
const REGION_NAMES = ['居住类', '商业类', '工业类', '教育类', '公共类', '自然类'];

/**
 * 语义相似度精排
 * 对候选结果进行基于 embedding 的语义重排
 *
 * @param {Array} candidates - 候选 POI 列表
 * @param {Array} queryEmbedding - 查询向量 [352]
 * @param {Object} options - 选项
 * @returns {Array} - 重排后的结果
 */
export function semanticRerank(candidates, queryEmbedding, options = {}) {
  const {
    spatialWeight = 0.5,
    semanticWeight = 0.5,
    regionBoost = 0.1,  // 同区域额外加分
    anchorRegion = null,
  } = options;

  if (!candidates || candidates.length === 0) {
    return candidates;
  }

  // 如果有查询向量，计算语义相似度
  if (queryEmbedding && indexState.loaded) {
    const queryEmb = new Float32Array(queryEmbedding);
    const embeddingDim = indexState.embeddingDim;
    const embeddings = indexState.embeddings;
    const poiIdToIndex = indexState.poiIdToIndex;

    // 计算查询向量范数
    let queryNorm = 0;
    for (let i = 0; i < embeddingDim; i++) {
      queryNorm += queryEmb[i] ** 2;
    }
    queryNorm = Math.sqrt(queryNorm);

    for (const c of candidates) {
      const idx = poiIdToIndex?.get(c.id);
      if (idx !== undefined) {
        // 计算语义相似度
        let dot = 0, embNorm = 0;
        for (let i = 0; i < embeddingDim; i++) {
          const embVal = embeddings[idx * embeddingDim + i];
          dot += queryEmb[i] * embVal;
          embNorm += embVal ** 2;
        }
        embNorm = Math.sqrt(embNorm);

        c.semantic_similarity = (queryNorm > 0 && embNorm > 0) ? dot / (queryNorm * embNorm) : 0.5;
      } else {
        c.semantic_similarity = 0.5;
      }
    }
  } else {
    // 没有查询向量，使用已有的 semantic_score
    for (const c of candidates) {
      c.semantic_similarity = c.semantic_score || 0.5;
    }
  }

  // 计算综合分数
  for (const c of candidates) {
    const spatialScore = c.spatial_score || 0.5;
    const semanticScore = c.semantic_similarity || 0.5;

    // 区域加分
    let regionBonus = 0;
    if (anchorRegion !== null && c.regionLabel === anchorRegion) {
      regionBonus = regionBoost;
    }

    c.reranked_score = spatialWeight * spatialScore + semanticWeight * semanticScore + regionBonus;
  }

  // 重新排序
  candidates.sort((a, b) => b.reranked_score - a.reranked_score);

  return candidates;
}

/**
 * 区域过滤
 * 筛选指定区域的 POI
 *
 * @param {Array} candidates - 候选 POI 列表
 * @param {number} targetRegion - 目标区域 (0-5)
 * @param {number} minConfidence - 最低置信度（暂不使用）
 * @returns {Array} - 过滤后的结果
 */
export function filterByRegion(candidates, targetRegion, minConfidence = 0) {
  if (targetRegion === null || targetRegion === undefined) {
    return candidates;
  }

  return candidates.filter(c => c.regionLabel === targetRegion);
}

/**
 * 获取索引状态
 */
export function getIndexStatus() {
  return {
    loaded: indexState.loaded,
    poiCount: indexState.poiIdToIndex?.size || 0,
    embeddingDim: indexState.embeddingDim || 0,
    loadTime: indexState.loadTime,
  };
}

export default {
  loadEmbeddings,
  faissHybridSearch,
  getIndexStatus,
  semanticRerank,
  filterByRegion,
  REGION_NAMES,
};
