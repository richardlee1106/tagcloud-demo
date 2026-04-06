/**
 * 意图理解服务
 *
 * 使用 Ollama 本地模型进行语义意图理解。
 * 硬编码映射作为兜底。
 *
 * 正确流程：
 * 1. 小模型解析意图（类别 + 语义标签）
 * 2. FAISS 召回候选
 * 3. 小模型筛选排序
 * 4. 硬编码兜底（仅当小模型不可用时）
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

import { getOllamaNativeBaseUrl, getOllamaOpenAIBaseUrl } from '../../infra/ollamaRuntimeConfig.js'
import { resolveEntityIntentFromText } from '../../ai/entityOntology.js'

// 意图解析模型配置：
// - 优先使用更稳的推理模型做“结构化拆解”
// - 若本地未安装目标模型，则自动回退到可用模型
const INTENT_PARSER_CONFIG = {
  ollama: {
    preferredModels: [
      process.env.INTENT_REASONING_MODEL || 'qwen3.5-4b-claude-4.6-opus-reasoning-distilled-v2',
      process.env.INTENT_REASONING_FALLBACK_MODEL || 'qwen3.5-4b-reasoning',
      'qwen3.5-2b-nothink',
      'qwen3.5-2b',
      'lfm2.5-1.2b'
    ]
  },
  lmstudio: {
    baseUrl: process.env.INTENT_LMSTUDIO_BASE_URL || process.env.SMALL_LLM_BASE_URL || 'http://127.0.0.1:1234/v1',
    model: process.env.INTENT_LMSTUDIO_MODEL || process.env.SMALL_LLM_MODEL || 'qwen3.5-4b-reasoning'
  },
  timeout: Math.max(10000, Number(process.env.INTENT_REASONING_TIMEOUT_MS) || 18000),
  useOllama: process.env.INTENT_USE_OLLAMA !== 'false'
}

const OLLAMA_MODEL_CACHE_TTL_MS = 30_000
let ollamaModelCache = {
  expiresAt: 0,
  models: []
}

export function resetIntentParserCache() {
  ollamaModelCache = {
    expiresAt: 0,
    models: []
  }
}

function normalizeModelId(value = '') {
  return String(value || '').trim().replace(/:latest$/i, '')
}

function choosePreferredModel(availableModels = [], preferredModels = []) {
  const normalizedAvailable = new Map()
  availableModels.forEach((modelName) => {
    const trimmed = String(modelName || '').trim()
    if (!trimmed) return
    normalizedAvailable.set(trimmed, trimmed)
    normalizedAvailable.set(normalizeModelId(trimmed), trimmed)
  })

  for (const preferred of preferredModels) {
    const trimmedPreferred = String(preferred || '').trim()
    if (!trimmedPreferred) continue
    const directHit = normalizedAvailable.get(trimmedPreferred)
    if (directHit) return directHit
    const normalizedHit = normalizedAvailable.get(normalizeModelId(trimmedPreferred))
    if (normalizedHit) return normalizedHit
  }

  return String(availableModels[0] || preferredModels[0] || '').trim()
}

async function getOllamaModelNames(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && ollamaModelCache.expiresAt > now && Array.isArray(ollamaModelCache.models)) {
    return ollamaModelCache.models.slice()
  }

  try {
    const response = await fetch(`${getOllamaNativeBaseUrl()}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2500)
    })
    if (!response.ok) return []

    const data = await response.json()
    const models = Array.isArray(data?.models)
      ? data.models
        .map((item) => String(item?.name || item?.model || '').trim())
        .filter(Boolean)
      : []

    ollamaModelCache = {
      expiresAt: now + OLLAMA_MODEL_CACHE_TTL_MS,
      models
    }

    return models.slice()
  } catch {
    return null
  }
}

/**
 * 检查 Ollama 是否可用
 */
async function checkOllamaAvailable() {
  try {
    const modelNames = await getOllamaModelNames()
    return Array.isArray(modelNames)
  } catch {
    return false
  }
}

/**
 * 获取 LLM 配置（自动选择 Ollama 或 LM Studio）
 */
async function getLLMEndpoint() {
  if (INTENT_PARSER_CONFIG.useOllama) {
    const available = await checkOllamaAvailable()
    if (available) {
      const availableModels = await getOllamaModelNames()
      const selectedModel = choosePreferredModel(
        availableModels,
        INTENT_PARSER_CONFIG.ollama.preferredModels
      )
      return {
        ...INTENT_PARSER_CONFIG.ollama,
        baseUrl: process.env.OLLAMA_BASE_URL || getOllamaOpenAIBaseUrl(),
        provider: 'ollama',
        model: selectedModel,
        availableModels
      }
    }
  }
  return {
    ...INTENT_PARSER_CONFIG.lmstudio,
    provider: 'lmstudio'
  }
}

/**
 * 区域类型映射（用于区域过滤）
 */
const REGION_MAPPING = {
  '商业区': 1, '商业': 1, '商圈': 1, '购物区': 1,
  '居住区': 0, '居住': 0, '住宅区': 0, '住宅': 0, '居民区': 0,
  '工业区': 2, '工业': 2, '产业园': 2, '工厂': 2,
  '教育区': 3, '教育': 3, '校区': 3,
  '公共区': 4, '公共': 4, '政务': 4, '行政': 4,
  '自然区': 5, '自然': 5, '公园': 5, '景区': 5, '风景': 5,
};

/**
 * 从查询中提取区域过滤条件
 * @param {string} userQuery - 用户查询
 * @returns {number|null} - 区域标签 (0-5) 或 null
 */
export function extractRegionFilter(userQuery) {
  if (!userQuery) return null;

  // 匹配 "商业区的餐厅" 这类模式
  const regionPatterns = [
    /(.{2,4}区)的?(?:餐厅|饭店|美食|咖啡|酒店|景点)/,
    /在(.{2,4}区)(?:里|内|中|附近)/,
    /(.{2,4})区域的/,
  ];

  for (const pattern of regionPatterns) {
    const match = userQuery.match(pattern);
    if (match) {
      const regionText = match[1];
      for (const [keyword, label] of Object.entries(REGION_MAPPING)) {
        if (regionText.includes(keyword)) {
          console.log(`[IntentParser] Extracted region filter: ${keyword} → ${label}`);
          return label;
        }
      }
    }
  }

  // 直接关键词匹配
  for (const [keyword, label] of Object.entries(REGION_MAPPING)) {
    if (userQuery.includes(keyword)) {
      // 检查是否是指向性用法（"在商业区" vs "商业区餐厅"）
      const beforeKeyword = userQuery.split(keyword)[0];
      if (beforeKeyword.length < 5 || beforeKeyword.endsWith('在') || beforeKeyword.endsWith('找')) {
        console.log(`[IntentParser] Direct region filter: ${keyword} → ${label}`);
        return label;
      }
    }
  }

  return null;
}

/**
 * 数据库类别映射（用于将用户意图映射到数据库类别）
 */
const DB_CATEGORY_MAPPING = {
  // 餐饮
  '餐厅': '餐饮美食',
  '饭店': '餐饮美食',
  '美食': '餐饮美食',
  '吃的': '餐饮美食',
  '火锅': '餐饮美食',
  '烧烤': '餐饮美食',
  '咖啡': '餐饮美食',
  '咖啡店': '餐饮美食',
  '咖啡馆': '餐饮美食',
  '咖啡厅': '餐饮美食',
  '奶茶': '餐饮美食',
  '茶饮': '餐饮美食',
  '甜品': '餐饮美食',
  '餐厅/咖啡': '餐饮美食',  // 小模型可能返回的组合
  '餐厅/饭店': '餐饮美食',
  '餐饮': '餐饮美食',

  // 住宿
  '酒店': '住宿服务',
  '宾馆': '住宿服务',
  '住宿': '住宿服务',
  '民宿': '住宿服务',

  // 景点
  '景点': '风景名胜',
  '公园': '风景名胜',
  '景区': '风景名胜',
  '旅游': '风景名胜',

  // 其他
  '医院': '医疗保健服务',
  '学校': '科教文化服务',
  '银行': '金融保险服务',
  '商超': '购物服务',
  '超市': '购物服务',
  '商场': '购物服务',
  '便利店': '购物服务',
  '百货': '购物服务',
  '地铁': '交通设施服务',
  '地铁站': '交通设施服务',
  '地铁口': '交通设施服务',
  '轨道交通': '交通设施服务',
  '轻轨': '交通设施服务',
  '公交': '交通设施服务',
  '公交站': '交通设施服务',
  '公交车站': '交通设施服务',
  '火车站': '交通设施服务',
  '高铁站': '交通设施服务',
  '站台': '交通设施服务',
  '停车场': '交通设施服务',
  '健身房': '体育休闲服务',
};

const QUERY_CATEGORY_HINTS = [
  { keywords: ['咖啡店', '咖啡馆', '咖啡厅', '咖啡', 'coffee', 'cafe'], category: '餐饮美食' },
  { keywords: ['商超', '超市', '便利店', '商场', '购物中心', '百货'], category: '购物服务' },
  { keywords: ['地铁站', '地铁口', '地铁', '轨道交通', '轻轨', '地铁出入口'], category: '交通设施服务' },
  { keywords: ['公交站', '公交车站', '公交', '巴士站', 'BRT'], category: '交通设施服务' },
  { keywords: ['火车站', '高铁站', '铁路站', '动车站'], category: '交通设施服务' },
  { keywords: ['停车场', '停车位', '车库'], category: '交通设施服务' }
];

const QUERY_SUBTYPE_HINTS = [
  { keywords: ['咖啡店', '咖啡馆', '咖啡厅', '咖啡', 'coffee', 'cafe'], subType: '咖啡' },
  { keywords: ['商超', '超市', '便利店', '商场', '购物中心', '百货'], subType: '商超' },
  { keywords: ['地铁站', '地铁口', '地铁', '轨道交通', '轻轨'], subType: '地铁站' },
  { keywords: ['公交车站', '公交站', '公交', '巴士站', 'BRT'], subType: '公交车站' },
  { keywords: ['高铁站', '火车站', '动车站', '铁路站'], subType: '火车站' },
  { keywords: ['停车场', '停车位', '车库'], subType: '停车场' }
];

const PLACE_STOPWORDS = new Set([
  '附近', '周边', '周围', '旁边', '一带', '这里', '这边', '周遭',
  '这附近', '这一带', '当前区域', '当前视图', '这个区域', '这片区域', '这片区', '图上', '地图上'
]);
const PLACE_NEARBY_SUFFIX_RE = /(附近|周边|周围|旁边|一带|这里|这边|周遭).*$/
const PLACE_INTENT_TAIL_RE = /(有哪些|有什么|哪里有|在哪|多少|最近|推荐|帮我找|帮我查|查一下|看一下|怎么去).*$/
const PLACE_LEAD_IN_PATTERNS = [
  /^(?:请问|请|麻烦你|麻烦您|麻烦帮我|麻烦帮忙|能不能|可以不可以)?(?:帮我|给我|替我)?(?:看看|看下|看一下|查查|查下|查一下|分析|分析下|分析一下|解析|解析下|解析一下|判断|判断下|判断一下|说说|概览|概况|概述|概括|盘点|比较|对比)\s*/u,
  /^(?:我想|想|请问|麻烦你|麻烦您)\s*/u
]
const GENERIC_NON_PLACE_PATTERNS = [
  /^(?:请问)?(?:帮我|给我|替我)?(?:看看|看下|看一下|查查|查下|查一下|分析下|分析一下|判断下|判断一下|说说)$/u,
  /^请帮我看看$/u,
  /^帮我看看$/u,
  /^请帮我查查$/u,
  /^帮我查查$/u,
  /^看一下$/u,
  /^查一下$/u
]
const DEICTIC_ANCHOR_TOKENS = ['这里', '这边', '这附近', '这一带', '当前区域', '当前视图', '这片区域', '这片区', '图上', '地图上', '选区']
const TASK_TYPE_VALUES = new Set([
  'nearby_lookup',
  'support_gap_analysis',
  'site_suitability',
  'region_comparison',
  'area_overview'
])
const KNOWN_STABLE_PLACE_ALIASES = new Set([
  '光谷',
  '光谷广场',
  '江汉路',
  '楚河汉街',
  '街道口',
  '徐东',
  '王家湾',
  '汉口火车站',
  '武昌火车站',
  '武汉站',
  '东湖',
  '南湖'
])

const COMPARISON_SIGNAL_RE = /(对比|比较|差异|区别|哪个更|谁更|vs|VS|Vs|相比|相较)/u
const COMPARISON_CONNECTOR_RE = /\s*(?:和|与|跟|及|以及|vs|VS|Vs)\s*/u

function normalizeNullableText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.toLowerCase() === 'null' || text === '无') return null;
  return text;
}

function stripQueryLeadIn(text = '') {
  let normalized = String(text || '').trim()
  if (!normalized) return ''

  let changed = true
  while (changed && normalized) {
    changed = false
    for (const pattern of PLACE_LEAD_IN_PATTERNS) {
      const next = normalized.replace(pattern, '').trim()
      if (next !== normalized) {
        normalized = next
        changed = true
      }
    }
  }

  return normalized.trim()
}

function buildStructuredAnchor(placeName = '', index = 0, role = null) {
  const normalizedPlaceName = sanitizeExtractedPlaceName(placeName)
  if (!normalizedPlaceName) return null

  return {
    placeName: normalizedPlaceName,
    displayName: normalizedPlaceName,
    role: String(
      role ||
      (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
    ).trim() || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`),
    index
  }
}

function normalizeStructuredAnchors(value = []) {
  if (!Array.isArray(value)) return []

  const deduped = new Map()

  value.forEach((item, index) => {
    const rawPlaceName = typeof item === 'string'
      ? item
      : item?.placeName || item?.place_name || item?.displayName || item?.display_name || item?.name || ''
    const role = typeof item === 'object' ? item?.role : null
    const structured = buildStructuredAnchor(rawPlaceName, index, role)
    if (!structured) return
    if (!deduped.has(structured.placeName)) {
      deduped.set(structured.placeName, structured)
    }
  })

  return [...deduped.values()].map((item, index) => ({
    ...item,
    role: item.role || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`),
    index
  }))
}

function buildComparisonAnchorDisplayLabel(anchors = []) {
  const labels = normalizeStructuredAnchors(anchors)
    .map((item) => item.displayName)
    .filter(Boolean)

  if (labels.length >= 2) {
    return `${labels[0]} vs ${labels[1]}`
  }

  return labels[0] || null
}

function isDeicticContextQuery(userQuery = '') {
  const query = String(userQuery || '').trim()
  if (!query) return false
  return DEICTIC_ANCHOR_TOKENS.some((token) => query.includes(token))
}

function normalizeTaskType(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  return TASK_TYPE_VALUES.has(normalized) ? normalized : null
}

function inferTaskTypeFromQueryText(userQuery = '', context = {}) {
  const query = stripQueryLeadIn(String(userQuery || '').trim()).toLowerCase()
  if (!query) return 'nearby_lookup'

  const hasComparisonSignals = /(对比|比较|差异|哪个更|谁更|vs|相比|相较)/.test(query)
  const hasSiteSignals = /(适合开什么店|适合开|适不适合开|开店|选址|做什么生意|开什么店|适合做什么|适合布局|布局什么业态|布局哪些业态|布局哪类业态)/.test(query)
  const hasSupportSignals = /(配套|生活配套|周边配套)/.test(query)
  const hasHotSignals = /(热门业态|主导业态|什么店多|哪些店多|什么最多)/.test(query)
  const hasGapSignals = /(缺口|短板|不足|空白|缺什么|还缺|明显缺)/.test(query)
  const hasOverviewSignals = /(概况|概览|画像|整体|总体|分布|结构|趋势|片区分析|区域分析|空间结构|业态分布)/.test(query)

  if (hasComparisonSignals) return 'region_comparison'
  if (hasSiteSignals) return 'site_suitability'
  if (hasOverviewSignals && !(hasSupportSignals || hasGapSignals)) return 'area_overview'
  if (hasSupportSignals || hasHotSignals || hasGapSignals) return 'support_gap_analysis'
  if (hasOverviewSignals) return 'area_overview'

  if (context?.placeName || context?.category || context?.poiSubType || /(附近|周边|周围|旁边|最近|有哪些|有什么|哪里有)/.test(query)) {
    return 'nearby_lookup'
  }

  return 'nearby_lookup'
}

function inferAnswerTypeFromTaskType(taskType = '') {
  return normalizeTaskType(taskType) || 'nearby_lookup'
}

function inferAnchorModeFromQuery(userQuery = '', { placeName = null } = {}) {
  if (placeName) return 'explicit_place'
  if (isDeicticContextQuery(userQuery)) return 'context'
  if (/(附近|周边|周围|旁边|最近)/.test(String(userQuery || ''))) return 'implicit_anchor'
  return 'unknown'
}

function inferAnalysisFacets(userQuery = '', { taskType = '', poiSubType = null, category = null } = {}) {
  const query = String(userQuery || '').trim().toLowerCase()
  const resolvedTaskType = normalizeTaskType(taskType) || 'nearby_lookup'

  return {
    ranking: /排序|优先|相关性/.test(query) || resolvedTaskType === 'nearby_lookup',
    supportingFacilities: /(配套|周边配套|生活配套)/.test(query) || resolvedTaskType === 'support_gap_analysis',
    hotCategories: /(热门业态|主导业态|业态|什么店多|哪些店多)/.test(query) || resolvedTaskType === 'support_gap_analysis',
    gaps: /(缺口|短板|不足|空白|缺什么|明显缺)/.test(query) || resolvedTaskType === 'support_gap_analysis',
    comparison: resolvedTaskType === 'region_comparison',
    suitability: resolvedTaskType === 'site_suitability',
    requestedCategory: poiSubType || category || null
  }
}

function buildDefaultIntentDesc(userQuery = '', result = {}) {
  const placeName = String(result?.placeName || '').trim()
  const anchorLabel = placeName || (result?.anchorMode === 'context' ? '当前区域' : '当前范围')
  const requestedCategory = result?.poiSubType || result?.category || '相关地点'
  const taskType = normalizeTaskType(result?.taskType) || 'nearby_lookup'
  const comparisonAnchorLabel = buildComparisonAnchorDisplayLabel(result?.anchors || result?.comparisonAnchors || [])

  if (taskType === 'support_gap_analysis') {
    return `分析${anchorLabel}附近的配套现状、热门业态和明显缺口`
  }
  if (taskType === 'site_suitability') {
    return `判断${anchorLabel}更适合布局哪些业态`
  }
  if (taskType === 'region_comparison') {
    return `比较${comparisonAnchorLabel || anchorLabel}附近的空间/业态差异`
  }
  if (taskType === 'area_overview') {
    return `概览${anchorLabel}附近的空间结构与业态分布`
  }
  return `查询${anchorLabel}${result?.spatialRelation && result.spatialRelation !== '无' ? result.spatialRelation : '附近'}的${requestedCategory}`
}

function applyStructuredIntentFields(result = {}, userQuery = '') {
  const structured = { ...(result || {}) }
  const taskType = inferTaskTypeFromQueryText(userQuery, structured)
  structured.taskType = normalizeTaskType(structured.taskType) || taskType
  structured.answerType = inferAnswerTypeFromTaskType(structured.answerType || structured.taskType)
  const extractedComparisonAnchors = structured.taskType === 'region_comparison'
    ? extractComparisonAnchorsFromQuery(userQuery)
    : []
  const declaredAnchors = normalizeStructuredAnchors(
    structured.anchors || structured.comparisonAnchors || structured.raw?.anchors || structured.raw?.comparison_anchors
  )
  const comparisonAnchors = declaredAnchors.length >= 2 ? declaredAnchors : extractedComparisonAnchors

  if (structured.taskType === 'region_comparison' && comparisonAnchors.length >= 2) {
    structured.anchors = comparisonAnchors
    structured.comparisonAnchors = comparisonAnchors

    const currentPlaceName = sanitizeExtractedPlaceName(structured.placeName || '')
    if (!currentPlaceName || currentPlaceName.includes('和') || !comparisonAnchors.some((item) => item.placeName === currentPlaceName)) {
      structured.placeName = comparisonAnchors[0].placeName
    } else {
      structured.placeName = currentPlaceName
    }

    const comparisonAnchorLabel = comparisonAnchors
      .map((item) => item.displayName)
      .join('和')
    structured.rawAnchor = sanitizeExtractedPlaceName(structured.rawAnchor || comparisonAnchorLabel) || comparisonAnchorLabel
    structured.normalizedAnchor = sanitizeExtractedPlaceName(structured.normalizedAnchor || comparisonAnchorLabel) || comparisonAnchorLabel
  } else {
    structured.anchors = []
    structured.comparisonAnchors = []
  }

  structured.anchorMode = inferAnchorModeFromQuery(userQuery, { placeName: structured.placeName })
  structured.analysisFacets = inferAnalysisFacets(userQuery, {
    taskType: structured.taskType,
    poiSubType: structured.poiSubType,
    category: structured.category
  })

  if (!String(structured.intentDesc || '').trim()) {
    structured.intentDesc = buildDefaultIntentDesc(userQuery, structured)
  }

  return structured
}

export function inferCategoryFromQueryText(userQuery = '') {
  const query = String(userQuery || '').trim().toLowerCase();
  if (!query) return null;

  const semanticIntent = resolveEntityIntentFromText(userQuery)
  if (semanticIntent.dbCategory) {
    return semanticIntent.dbCategory
  }

  for (const { keywords, category } of QUERY_CATEGORY_HINTS) {
    if (keywords.some((keyword) => query.includes(String(keyword).toLowerCase()))) {
      return category;
    }
  }

  for (const [keyword, category] of Object.entries(DB_CATEGORY_MAPPING)) {
    if (query.includes(String(keyword).toLowerCase())) {
      return category;
    }
  }

  return null;
}

export function inferPoiSubTypeFromQueryText(userQuery = '') {
  const query = String(userQuery || '').trim().toLowerCase();
  if (!query) return null;

  const semanticIntent = resolveEntityIntentFromText(userQuery)
  if (semanticIntent.poiSubType) {
    return semanticIntent.poiSubType
  }

  for (const { keywords, subType } of QUERY_SUBTYPE_HINTS) {
    if (keywords.some((keyword) => query.includes(String(keyword).toLowerCase()))) {
      return subType;
    }
  }

  return null;
}

export function sanitizeExtractedPlaceName(value = '') {
  let text = stripQueryLeadIn(String(value || ''))
    .replace(/[？?！!。，“”"'‘’、,]/g, ' ')
    .replace(/\b(有哪些|有什么|哪里有|在哪|多少|最近|推荐|帮我找|帮我查|查一下|看一下)\b/g, ' ')
    .trim();

  text = text.replace(/\s+/g, '');
  text = text.replace(PLACE_NEARBY_SUFFIX_RE, '');
  text = text.replace(PLACE_INTENT_TAIL_RE, '');
  if (GENERIC_NON_PLACE_PATTERNS.some((pattern) => pattern.test(text))) return null;
  if (!text || PLACE_STOPWORDS.has(text)) return null;
  if (text.length > 24) return null;
  return text;
}

export function extractComparisonAnchorsFromQuery(userQuery = '') {
  const originalQuery = String(userQuery || '').trim()
  if (!originalQuery || !COMPARISON_SIGNAL_RE.test(originalQuery)) return []

  const query = stripQueryLeadIn(originalQuery)
  if (!query) return []

  const patterns = [
    /^(.+?)\s*(?:和|与|跟|及|以及|vs|VS|Vs)\s*(.+?)(?:附近|周边|周围|旁边|一带)(?:的)?(?:.*)?$/u,
    /^(?:比较|对比|相比|相较)\s*(.+?)\s*(?:和|与|跟|及|以及|vs|VS|Vs)\s*(.+?)(?:附近|周边|周围|旁边|一带)?(?:的)?(?:.*)?$/u
  ]

  for (const pattern of patterns) {
    const match = query.match(pattern)
    if (!match || !match[1] || !match[2]) continue

    const primaryAnchor = sanitizeExtractedPlaceName(match[1])
    const secondaryAnchor = sanitizeExtractedPlaceName(match[2])
    if (!primaryAnchor || !secondaryAnchor || primaryAnchor === secondaryAnchor) continue

    return [
      buildStructuredAnchor(primaryAnchor, 0, 'primary'),
      buildStructuredAnchor(secondaryAnchor, 1, 'secondary')
    ].filter(Boolean)
  }

  const nearbyMatch = query.match(/^(.+?)(?:附近|周边|周围|旁边|一带)(?:的)?(?:.*)?$/u)
  if (!nearbyMatch?.[1]) return []

  const parts = nearbyMatch[1]
    .split(COMPARISON_CONNECTOR_RE)
    .map((item) => sanitizeExtractedPlaceName(item))
    .filter(Boolean)

  if (parts.length < 2) return []

  return normalizeStructuredAnchors(parts.slice(0, 2))
}

export function extractPlaceNameFromQuery(userQuery = '') {
  const query = stripQueryLeadIn(String(userQuery || '').trim());
  if (!query) return null;

  const comparisonAnchors = extractComparisonAnchorsFromQuery(query)
  if (comparisonAnchors.length >= 2) {
    return comparisonAnchors[0].placeName
  }

  const patterns = [
    /^(.+?)(?:附近|周边|周围|旁边|一带)/,
    /(?:离|距)(.+?)(?:最近|较近|附近|周边)/,
    /(?:在|去)(.+?)(?:附近|周边|周围)/,
    /^(.+?)(?:有哪些|有什么|哪里有|有什么好|怎么去)/
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (!match || !match[1]) continue;
    const placeName = sanitizeExtractedPlaceName(match[1]);
    if (placeName) return placeName;
  }

  return null;
}

function looksLikeSpecificPlaceName(value = '') {
  return /(大学|学院|学校|校区|中学|小学|幼儿园|附中|高中|初中|[一二三四五六七八九十两0-9]+中|医院|诊所|公园|景区|广场|火车站|高铁站|地铁站|地铁口|商场|购物中心|大厦|园区|社区|小区|体育馆|博物馆|图书馆|酒店|宾馆|市场|服务中心)/.test(value)
}

function looksLikeStableCampusAnchor(value = '') {
  return /(大学|学院|校区)/.test(String(value || ''))
}

function looksLikeKnownStablePlaceAlias(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  if (KNOWN_STABLE_PLACE_ALIASES.has(text)) return true
  return [...KNOWN_STABLE_PLACE_ALIASES].some((alias) => text.includes(alias))
}

function shouldBypassSmallLLM(userQuery = '', fallbackResult = null) {
  if (!userQuery || typeof userQuery !== 'string' || !fallbackResult) return false
  if (fallbackResult.method !== 'fallback') return false
  if (fallbackResult.anchorMode !== 'explicit_place') return false
  const comparisonAnchors = normalizeStructuredAnchors(
    fallbackResult.anchors || fallbackResult.comparisonAnchors
  )
  if (!fallbackResult.placeName && comparisonAnchors.length < 2) return false
  const hasDeterministicAnchor = comparisonAnchors.length >= 2
    ? comparisonAnchors.every((anchor) => (
        looksLikeStableCampusAnchor(anchor.placeName)
        || looksLikeKnownStablePlaceAlias(anchor.placeName)
      ))
    : (
        looksLikeStableCampusAnchor(fallbackResult.placeName)
        || looksLikeKnownStablePlaceAlias(fallbackResult.placeName)
      )
  if (!hasDeterministicAnchor) return false
  const normalizedQuery = String(userQuery || '')

  if (fallbackResult.taskType === 'nearby_lookup') {
    if (!fallbackResult.category || !fallbackResult.poiSubType) return false
    if (!/(附近|周边|周围|旁边|最近|有哪些|有什么|哪里有)/.test(normalizedQuery)) return false
    return true
  }

  if (fallbackResult.taskType === 'support_gap_analysis') {
    if (!/(配套|热门业态|主导业态|缺口|短板|不足|空白)/.test(normalizedQuery)) return false
    return true
  }

  if (fallbackResult.taskType === 'area_overview') {
    if (!/(概况|概览|画像|整体|总体|分布|结构|趋势|片区分析|区域分析|空间结构|业态分布)/.test(normalizedQuery)) return false
    return true
  }

  if (fallbackResult.taskType === 'site_suitability') {
    if (!/(适合开什么店|适合开|适不适合开|开店|选址|做什么生意|开什么店|适合做什么|适合布局|布局什么业态|布局哪些业态|布局哪类业态)/.test(normalizedQuery)) return false
    return true
  }

  if (fallbackResult.taskType === 'region_comparison') {
    if (comparisonAnchors.length < 2) return false
    if (!COMPARISON_SIGNAL_RE.test(normalizedQuery)) return false
    return true
  }

  return false
}

function resolvePlaceNameCandidate(parsedPlaceName = '', extractedPlaceName = '') {
  const parsed = sanitizeExtractedPlaceName(parsedPlaceName)
  const extracted = sanitizeExtractedPlaceName(extractedPlaceName)

  if (!parsed) return extracted
  if (!extracted || parsed === extracted) return parsed

  if (extracted.length > parsed.length && extracted.startsWith(parsed)) {
    return extracted
  }

  if (looksLikeSpecificPlaceName(extracted) && !looksLikeSpecificPlaceName(parsed)) {
    return extracted
  }

  return parsed
}

function inferSpatialRelationFromQuery(userQuery = '') {
  const query = String(userQuery || '').trim()
  if (!query) return '无'
  if (/(附近|周边|周围|旁边|一带|周遭)/.test(query)) return '附近'
  if (/最近/.test(query)) return '最近'
  if (/经过/.test(query)) return '经过'
  if (/到/.test(query)) return '到'
  if (/在/.test(query)) return '在'
  return '无'
}

function toConfidenceValue(value, fallback = 0.5) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric <= 1 && numeric >= 0) return numeric
  if (numeric > 1 && numeric <= 100) return numeric / 100
  return fallback
}

function toBooleanValue(value, fallback = false) {
  if (value === true || value === false) return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return fallback
}

function buildIntentPreview(result = {}, fallbackPreview = {}) {
  const structuredAnchors = normalizeStructuredAnchors(
    result?.anchors ||
    result?.comparisonAnchors ||
    fallbackPreview.anchors ||
    fallbackPreview.comparisonAnchors
  )
  const rawAnchor = sanitizeExtractedPlaceName(
    normalizeNullableText(result?.rawAnchor || result?.raw?.raw_anchor || fallbackPreview.rawAnchor || '')
    || ''
  ) || null
  const normalizedAnchor = sanitizeExtractedPlaceName(
    normalizeNullableText(result?.normalizedAnchor || result?.raw?.normalized_anchor || fallbackPreview.normalizedAnchor || '')
    || ''
  ) || null
  const targetCategory = String(
    result?.poiSubType ||
    result?.raw?.target_category ||
    fallbackPreview.targetCategory ||
    ''
  ).trim() || null
  const confidence = toConfidenceValue(
    result?.confidence ??
    result?.raw?.confidence ??
    fallbackPreview.confidence,
    targetCategory || normalizedAnchor || rawAnchor ? 0.85 : 0.5
  )
  const needsClarification = toBooleanValue(
    result?.needsClarification ??
    result?.raw?.needs_clarification ??
    fallbackPreview.needsClarification,
    false
  )
  const clarificationHint = String(
    result?.clarificationHint ||
    result?.raw?.clarification_hint ||
    fallbackPreview.clarificationHint ||
    ''
  ).trim()
  const spatialRelation = String(
    result?.spatialRelation ||
    result?.raw?.spatial_relation ||
    fallbackPreview.spatialRelation ||
    '无'
  ).trim() || '无'
  const isAbbreviation = toBooleanValue(
    result?.isAbbreviation ??
    result?.raw?.is_abbreviation ??
    fallbackPreview.isAbbreviation,
    Boolean(rawAnchor && normalizedAnchor && rawAnchor !== normalizedAnchor)
  )
  const displayAnchor = String(
    (structuredAnchors.length >= 2 ? buildComparisonAnchorDisplayLabel(structuredAnchors) : '') ||
    result?.placeName ||
    (needsClarification ? rawAnchor : normalizedAnchor) ||
    rawAnchor ||
    fallbackPreview.displayAnchor ||
    ''
  ).trim() || null

  if (!rawAnchor && !normalizedAnchor && !displayAnchor && !targetCategory) {
    return null
  }

  return {
    rawAnchor,
    normalizedAnchor,
    displayAnchor,
    targetCategory,
    spatialRelation,
    confidence,
    needsClarification,
    clarificationHint,
    isAbbreviation,
    taskType: normalizeTaskType(result?.taskType || fallbackPreview.taskType || '') || null,
    answerType: normalizeTaskType(result?.answerType || fallbackPreview.answerType || '') || null,
    anchorMode: String(result?.anchorMode || fallbackPreview.anchorMode || '').trim() || null,
    parserModel: String(result?.parserModel || fallbackPreview.parserModel || '').trim() || null,
    parserProvider: String(result?.parserProvider || fallbackPreview.parserProvider || '').trim() || null,
    anchors: structuredAnchors
  }
}

/**
 * 智能类别映射：处理小模型返回的各种格式
 */
function mapToDbCategory(rawCategory) {
  if (!rawCategory) return null;

  // 1. 直接匹配
  if (DB_CATEGORY_MAPPING[rawCategory]) {
    return DB_CATEGORY_MAPPING[rawCategory];
  }

  // 2. 模糊匹配：检查是否包含关键词
  const lowerCat = rawCategory.toLowerCase();
  for (const [key, value] of Object.entries(DB_CATEGORY_MAPPING)) {
    if (lowerCat.includes(key) || key.includes(rawCategory)) {
      return value;
    }
  }

  // 3. 处理斜杠分隔的组合类别，取第一个
  if (rawCategory.includes('/')) {
    const parts = rawCategory.split('/');
    for (const part of parts) {
      const mapped = DB_CATEGORY_MAPPING[part.trim()];
      if (mapped) return mapped;
    }
  }

  // 4. 检查是否是数据库中的实际类别
  const actualDbCategories = [
    '餐饮美食', '住宿服务', '风景名胜', '科教文化服务',
    '医疗保健服务', '金融保险服务', '购物服务', '体育休闲服务',
    '公司企业', '生活服务', '交通设施服务', '政府机构及社会团体'
  ];
  if (actualDbCategories.includes(rawCategory)) {
    return rawCategory;
  }

  // 5. 无法映射，返回 null（后续检索时不做类别过滤）
  console.warn(`[IntentParser] Unknown category: ${rawCategory}, skipping category filter`);
  return null;
}

/**
 * 使用小参数模型解析用户意图
 *
 * @param {string} userQuery - 用户查询
 * @returns {Promise<{ category: string|null, semanticTags: string[], intentDesc: string, raw: Object }>}
 */
export async function parseIntentWithSmallLLM(userQuery) {
  if (!userQuery || typeof userQuery !== 'string') {
    return { category: null, semanticTags: [], intentDesc: '', raw: {} };
  }

  const startTime = Date.now()

  try {
    // 获取 LLM 端点（自动选择 Ollama 或 LM Studio）
    const llmEndpoint = await getLLMEndpoint()
    console.log(
      `[IntentParser] Using ${llmEndpoint.provider === 'ollama' ? 'Ollama' : 'LM Studio'} model=${llmEndpoint.model}`
    )

    const systemPrompt = `/no_think
你是“武汉空间锚点解析器”。
你的任务不是回答用户问题，而是将用户输入拆解为结构化 JSON。

你必须遵守：
1. 只输出一个合法 JSON 对象，不要输出解释，不要输出 markdown，不要输出思考过程。
2. 只做地点锚点、目标类别、空间关系、置信度与澄清需求的拆解。
3. 如果地点是简称，只有在高置信度时才规范化展开；如果不确定，就保留原简称。
4. 如果一个简称可能指主实体，也可能指分校、附属校、实验校、广雅校、国际部等派生实体，优先理解为主实体；若仍不确定，needs_clarification=true。
5. 不要为了显得聪明而乱补全。
6. target_category 必须直接来自用户原问题，例如：咖啡店、地铁站、商超、超市、商场、便利店。

输出字段固定为：
- category
- target_category
- semantic_tags
- intent_desc
- raw_anchor
- normalized_anchor
- is_abbreviation
- place_name
- spatial_relation
- radius_m
- region_type
- confidence
- needs_clarification
- clarification_hint`

    const prompt = `请解析下面这句用户输入，并只返回 JSON：

用户输入：${userQuery}

示例 1：
输入：武大附近有哪些咖啡店？
输出：
{
  "category": "咖啡店",
  "target_category": "咖啡店",
  "semantic_tags": [],
  "intent_desc": "查询武大附近的咖啡店",
  "raw_anchor": "武大",
  "normalized_anchor": "武汉大学",
  "is_abbreviation": true,
  "place_name": "武汉大学",
  "spatial_relation": "附近",
  "radius_m": 500,
  "region_type": null,
  "confidence": 0.88,
  "needs_clarification": false,
  "clarification_hint": ""
}

示例 2：
输入：湖北大学附近有哪些地铁站？
输出：
{
  "category": "地铁站",
  "target_category": "地铁站",
  "semantic_tags": [],
  "intent_desc": "查询湖北大学附近的地铁站",
  "raw_anchor": "湖北大学",
  "normalized_anchor": "湖北大学",
  "is_abbreviation": false,
  "place_name": "湖北大学",
  "spatial_relation": "附近",
  "radius_m": 500,
  "region_type": null,
  "confidence": 0.97,
  "needs_clarification": false,
  "clarification_hint": ""
}

示例 3：
输入：湖大附近有哪些地铁站？
输出：
{
  "category": "地铁站",
  "target_category": "地铁站",
  "semantic_tags": [],
  "intent_desc": "查询湖大附近的地铁站",
  "raw_anchor": "湖大",
  "normalized_anchor": "湖大",
  "is_abbreviation": true,
  "place_name": "湖大",
  "spatial_relation": "附近",
  "radius_m": 500,
  "region_type": null,
  "confidence": 0.55,
  "needs_clarification": true,
  "clarification_hint": "请确认你说的“湖大”具体指哪所学校。"
}`

    const response = await fetch(`${llmEndpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llmEndpoint.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 320
      }),
      signal: AbortSignal.timeout(INTENT_PARSER_CONFIG.timeout)
    })

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`)
    }

    const data = await response.json()
    let content = data.choices?.[0]?.message?.content || ''

    // 移除 markdown 代码块
    content = content
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()

    // 解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[IntentParser] No JSON found in:', content.substring(0, 200))
      throw new Error('No valid JSON in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    // 映射类别到数据库类别（智能映射）
    const rawAnchor = sanitizeExtractedPlaceName(normalizeNullableText(parsed.raw_anchor) || '')
    const normalizedAnchor = sanitizeExtractedPlaceName(normalizeNullableText(parsed.normalized_anchor) || '')
    const parsedPlaceName = sanitizeExtractedPlaceName(normalizeNullableText(parsed.place_name) || '')
    const extractedPlaceName = extractPlaceNameFromQuery(userQuery)
    const targetCategory = String(parsed.target_category || parsed.category || '').trim()
    const dbCategory = mapToDbCategory(targetCategory) || inferCategoryFromQueryText(userQuery)
    const poiSubType = inferPoiSubTypeFromQueryText(targetCategory) || inferPoiSubTypeFromQueryText(userQuery)
    const confidence = toConfidenceValue(parsed.confidence, 0.5)
    const needsClarification = toBooleanValue(parsed.needs_clarification, false)
    const clarificationHint = String(parsed.clarification_hint || '').trim()
    const isAbbreviation = toBooleanValue(parsed.is_abbreviation, Boolean(rawAnchor && normalizedAnchor && rawAnchor !== normalizedAnchor))
    const spatialRelation = String(parsed.spatial_relation || inferSpatialRelationFromQuery(userQuery)).trim() || '无'

    const primaryParsedPlaceName = (
      needsClarification
        ? (rawAnchor || parsedPlaceName || normalizedAnchor)
        : (normalizedAnchor || rawAnchor || parsedPlaceName)
    ) || ''

    const placeName = resolvePlaceNameCandidate(primaryParsedPlaceName, extractedPlaceName)

    // 映射区域类型
    let regionLabel = null
    if (parsed.region_type) {
      for (const [keyword, label] of Object.entries(REGION_MAPPING)) {
        if (parsed.region_type.includes(keyword)) {
          regionLabel = label
          break
        }
      }
    }
    // 如果小模型没识别出区域，用硬编码补充
    if (regionLabel === null) {
      regionLabel = extractRegionFilter(userQuery)
    }

    const duration = Date.now() - startTime
    console.log(
      `[IntentParser] Parsed in ${duration}ms: place=${placeName || '-'}, target=${targetCategory || '-'}, confidence=${confidence.toFixed(2)}, model=${llmEndpoint.model}`
    )

    const parserModel = llmEndpoint.model
    const parserProvider = llmEndpoint.provider

    const structuredResult = applyStructuredIntentFields({
      category: dbCategory,
      semanticTags: parsed.semantic_tags || [],
      intentDesc: parsed.intent_desc || `查询${placeName || '指定地点'}${spatialRelation === '无' ? '' : spatialRelation}的${targetCategory || '相关地点'}`,
      placeName,
      poiSubType,
      radiusM: parsed.radius_m || 500,
      regionLabel,  // 区域标签 (0-5)
      raw: parsed,
      method: 'small_llm',
      rawAnchor: rawAnchor || parsedPlaceName || extractedPlaceName || null,
      normalizedAnchor: normalizedAnchor || placeName || null,
      isAbbreviation,
      confidence,
      needsClarification,
      clarificationHint,
      spatialRelation,
      parserModel,
      parserProvider
    }, userQuery)

    structuredResult.intentPreview = buildIntentPreview({
      ...structuredResult,
      raw: parsed,
      rawAnchor: rawAnchor || parsedPlaceName || extractedPlaceName || null,
      normalizedAnchor: normalizedAnchor || placeName || null,
      placeName,
      poiSubType: poiSubType || targetCategory || null,
      confidence,
      needsClarification,
      clarificationHint,
      isAbbreviation,
      spatialRelation,
      parserModel,
      parserProvider
    }, {
      rawAnchor: extractedPlaceName || null,
      normalizedAnchor: null,
      targetCategory: poiSubType || targetCategory || null,
      confidence,
      needsClarification,
      clarificationHint,
      spatialRelation,
      isAbbreviation,
      parserModel,
      parserProvider,
      taskType: structuredResult.taskType,
      answerType: structuredResult.answerType,
      anchorMode: structuredResult.anchorMode
    })

    return structuredResult

  } catch (error) {
    console.warn('[IntentParser] Small LLM failed:', error.message)
    return null;  // 返回 null 表示失败，需要兜底
  }
}

/**
 * 硬编码兜底：当小模型不可用时使用
 */
export function fallbackIntentParsing(userQuery) {
  if (!userQuery) {
    return { category: null, semanticTags: [], intentDesc: '', placeName: null, regionLabel: null, method: 'fallback' };
  }

  const query = userQuery.toLowerCase();
  const semanticTags = [];
  const category = inferCategoryFromQueryText(userQuery);
  const placeName = extractPlaceNameFromQuery(userQuery);
  const poiSubType = inferPoiSubTypeFromQueryText(userQuery);

  // 区域识别
  const regionLabel = extractRegionFilter(userQuery);

  // 场景关键词识别
  const sceneKeywords = {
    '约会': ['约会', '浪漫'],
    '亲子': ['亲子', '儿童'],
    '遛娃': ['亲子', '户外', '儿童'],
    '带娃': ['亲子', '儿童'],
    '遛狗': ['宠物'],
    '撸猫': ['宠物', '猫咖'],
    '打卡': ['拍照', '网红'],
    '网红': ['拍照', '网红'],
    '拍照': ['拍照'],
    '聚餐': ['聚餐', '热闹'],
    '团建': ['聚餐', '热闹'],
    '商务': ['商务', '高档'],
    '休息': ['安静', '休闲'],
    '办公': ['办公', '安静'],
    '学习': ['办公', '安静'],
    '健身': ['运动', '健身'],
    '散步': ['休闲', '户外'],
  };

  for (const [keyword, tags] of Object.entries(sceneKeywords)) {
    if (query.includes(keyword)) {
      for (const tag of tags) {
        if (!semanticTags.includes(tag)) {
          semanticTags.push(tag);
        }
      }
    }
  }

  console.log(`[IntentParser] Fallback parsing: category=${category}, tags=${semanticTags.join(',')}, region=${regionLabel}`);

  const fallbackResult = applyStructuredIntentFields({
    category,
    semanticTags,
    intentDesc: semanticTags.length > 0 ? `用户想要${semanticTags.join('、')}的场所` : '',
    placeName,
    poiSubType,
    regionLabel,
    rawAnchor: placeName,
    normalizedAnchor: placeName,
    isAbbreviation: false,
    confidence: placeName || poiSubType ? 0.9 : 0.5,
    needsClarification: false,
    clarificationHint: '',
    spatialRelation: inferSpatialRelationFromQuery(userQuery),
    method: 'fallback',
    parserModel: null,
    parserProvider: 'fallback'
  }, userQuery)

  fallbackResult.intentPreview = buildIntentPreview(fallbackResult, {
    rawAnchor: placeName,
    normalizedAnchor: placeName,
    targetCategory: poiSubType,
    confidence: fallbackResult.confidence,
    needsClarification: false,
    clarificationHint: '',
    spatialRelation: fallbackResult.spatialRelation,
    isAbbreviation: false,
    taskType: fallbackResult.taskType,
    answerType: fallbackResult.answerType,
    anchorMode: fallbackResult.anchorMode,
    parserProvider: 'fallback'
  })

  return fallbackResult
}

/**
 * 主入口：解析用户意图
 * 优先使用小模型，失败时回退到硬编码
 *
 * @param {string} userQuery - 用户查询
 * @returns {Promise<{ category: string|null, semanticTags: string[], intentDesc: string, method: string }>}
 */
function stabilizeIntentResult(userQuery, llmResult, fallbackResult = null) {
  const resolvedFallbackResult = fallbackResult || fallbackIntentParsing(userQuery);
  if (!llmResult) return resolvedFallbackResult;

  const stabilized = { ...llmResult };
  let appliedGuardrails = false;
  const fallbackAnchors = normalizeStructuredAnchors(
    resolvedFallbackResult.anchors || resolvedFallbackResult.comparisonAnchors
  )
  const llmAnchors = normalizeStructuredAnchors(stabilized.anchors || stabilized.comparisonAnchors)

  if (fallbackAnchors.length >= 2 && llmAnchors.length < 2) {
    stabilized.anchors = fallbackAnchors
    stabilized.comparisonAnchors = fallbackAnchors
    appliedGuardrails = true
  }

  if (resolvedFallbackResult.placeName && !stabilized.placeName) {
    stabilized.placeName = resolvedFallbackResult.placeName;
    appliedGuardrails = true;
  }

  if (resolvedFallbackResult.poiSubType && stabilized.poiSubType !== resolvedFallbackResult.poiSubType) {
    stabilized.poiSubType = resolvedFallbackResult.poiSubType;
    appliedGuardrails = true;
  }

  if (
    resolvedFallbackResult.category &&
    (!stabilized.category || (resolvedFallbackResult.poiSubType && stabilized.category !== resolvedFallbackResult.category))
  ) {
    stabilized.category = resolvedFallbackResult.category;
    appliedGuardrails = true;
  }

  if (
    resolvedFallbackResult.placeName &&
    resolvedFallbackResult.poiSubType &&
    resolvedFallbackResult.regionLabel === null &&
    stabilized.regionLabel !== null
  ) {
    stabilized.regionLabel = null;
    appliedGuardrails = true;
  }

  if (appliedGuardrails) {
    stabilized.semanticTags = resolvedFallbackResult.semanticTags || [];
    stabilized.intentDesc = resolvedFallbackResult.intentDesc || '';
    stabilized.guardrailsApplied = true;
    console.log(
      `[IntentParser] Applied fallback guardrails: category=${stabilized.category}, subtype=${stabilized.poiSubType}, region=${stabilized.regionLabel}`
    );
  }

  stabilized.rawAnchor = stabilized.rawAnchor || fallbackResult.rawAnchor || fallbackResult.placeName || null
  stabilized.normalizedAnchor = stabilized.normalizedAnchor || stabilized.placeName || fallbackResult.normalizedAnchor || null
  stabilized.spatialRelation = stabilized.spatialRelation || fallbackResult.spatialRelation || inferSpatialRelationFromQuery(userQuery)
  stabilized.confidence = toConfidenceValue(
    stabilized.confidence,
    stabilized.placeName || stabilized.poiSubType ? 0.85 : 0.5
  )
  stabilized.needsClarification = toBooleanValue(stabilized.needsClarification, false)
  stabilized.clarificationHint = String(stabilized.clarificationHint || '').trim()
  stabilized.isAbbreviation = toBooleanValue(
    stabilized.isAbbreviation,
    Boolean(stabilized.rawAnchor && stabilized.normalizedAnchor && stabilized.rawAnchor !== stabilized.normalizedAnchor)
  )
  const structuredIntent = applyStructuredIntentFields(stabilized, userQuery)
  structuredIntent.intentPreview = buildIntentPreview(structuredIntent, {
    rawAnchor: resolvedFallbackResult.rawAnchor || resolvedFallbackResult.placeName || null,
    normalizedAnchor: resolvedFallbackResult.normalizedAnchor || resolvedFallbackResult.placeName || null,
    targetCategory: resolvedFallbackResult.poiSubType || null,
    confidence: structuredIntent.confidence,
    needsClarification: structuredIntent.needsClarification,
    clarificationHint: structuredIntent.clarificationHint,
    spatialRelation: structuredIntent.spatialRelation,
    isAbbreviation: structuredIntent.isAbbreviation,
    taskType: structuredIntent.taskType,
    answerType: structuredIntent.answerType,
    anchorMode: structuredIntent.anchorMode,
    parserModel: structuredIntent.parserModel || null,
    parserProvider: structuredIntent.parserProvider || 'fallback'
  })

  return structuredIntent;
}

export async function parseIntent(userQuery) {
  const fallbackResult = fallbackIntentParsing(userQuery)

  if (shouldBypassSmallLLM(userQuery, fallbackResult)) {
    console.log(
      `[IntentParser] Fast-path fallback: place=${fallbackResult.placeName}, subtype=${fallbackResult.poiSubType}, category=${fallbackResult.category}`
    )
    return fallbackResult
  }

  // 优先使用小模型
  const llmResult = await parseIntentWithSmallLLM(userQuery);

  if (llmResult) {
    return stabilizeIntentResult(userQuery, llmResult, fallbackResult);
  }

  // 小模型失败，使用硬编码兜底
  return fallbackResult;
}

/**
 * 使用小模型筛选候选POI
 *
 * @param {string} userQuery - 用户原始查询
 * @param {Object} intent - 解析后的意图
 * @param {Array} candidates - 候选POI列表
 * @returns {Promise<Array>} - 筛选后的POI列表
 */
export async function filterCandidatesWithSmallLLM(userQuery, intent, candidates) {
  if (!candidates || candidates.length === 0) {
    return [];
  }

  // 候选数 <= 5，直接返回
  if (candidates.length <= 5) {
    return candidates;
  }

  const startTime = Date.now();

  try {
    // 获取 LLM 端点
    const llmEndpoint = await getLLMEndpoint();

    // 构建候选列表
    const candidateText = candidates.slice(0, 30).map((p, i) => {
      const name = p.name || '未知';
      const category = p.category || '未分类';
      const distance = p.distance_m ? `${Math.round(p.distance_m)}m` : '';
      return `${i + 1}. ${name} [${category}] ${distance}`;
    }).join('\n');

    const intentDesc = intent.intentDesc || userQuery;

    const prompt = `你是POI筛选助手。

用户查询："${userQuery}"
用户意图：${intentDesc}
语义标签：${intent.semanticTags?.join('、') || '无'}

候选列表（共${candidates.length}个）：
${candidateText}

请选出最符合用户意图的10个，按相关度降序排列。

输出格式：JSON数组，包含序号
示例：[3, 7, 1, 12, 5, 8, 2, 15, 9, 4]

只输出JSON数组，不要其他内容：`;

    const response = await fetch(`${llmEndpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llmEndpoint.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(SMALL_LLM_CONFIG.timeout),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 解析 JSON 数组
    const jsonMatch = content.match(/\[[\d\s,]+\]/);
    if (!jsonMatch) {
      console.warn('[IntentParser] No valid JSON array in filter response');
      return candidates.slice(0, 10);
    }

    const selectedIndices = JSON.parse(jsonMatch[0]);
    const filtered = selectedIndices
      .map(idx => candidates[idx - 1])
      .filter(Boolean);

    const duration = Date.now() - startTime;
    console.log(`[IntentParser] Filtered ${filtered.length} from ${candidates.length} in ${duration}ms`);

    // 如果结果太少，补充
    if (filtered.length < 5) {
      const remaining = candidates.filter(p => !filtered.includes(p));
      return [...filtered, ...remaining.slice(0, 10 - filtered.length)];
    }

    return filtered;

  } catch (error) {
    console.error('[IntentParser] Filter failed:', error.message);
    return candidates.slice(0, 10);
  }
}

/**
 * 检查小参数模型是否可用
 */
export async function checkSmallLLMAvailability() {
  try {
    const llmEndpoint = await getLLMEndpoint();
    const response = await fetch(`${llmEndpoint.baseUrl}/models`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { available: false, reason: `API error: ${response.status}` };
    }

    const data = await response.json();
    const models = data.data || [];

    return {
      available: true,
      model: llmEndpoint.model,
      models: models.map(m => m.id).slice(0, 10),
    };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

export default {
  parseIntent,
  parseIntentWithSmallLLM,
  fallbackIntentParsing,
  extractComparisonAnchorsFromQuery,
  filterCandidatesWithSmallLLM,
  checkSmallLLMAvailability,
  resetIntentParserCache,
  inferPoiSubTypeFromQueryText,
  DB_CATEGORY_MAPPING,
};
