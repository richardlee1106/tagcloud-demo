/**
 * 空间任务运行器 (Spatial Job Runner)
 * 职责：协调规划、数据检索、分析反馈。
 */
import { randomUUID } from 'crypto'

import { parseIntent, quickIntentClassify } from '../routes/ai/planner.js'
import { generateAnswer, buildQuickReply } from '../routes/ai/writer.js'
import { computeSpatialStream, isGrpcComputeEnabled } from './grpcClient.js'
import { resolveSpatialMigrationDecision } from './migrationPolicy.js'
import { resolveSourcePolicy } from './sourcePolicy.js'
import * as queryCache from './queryCache.js'
import telemetry from './telemetry.js'
import { insertOperatorTimingEvents } from './database.js'
import { callLLM, generateEmbedding } from './llm.js'
import { buildFailureDiagnostics } from './errorDiagnostics.js'
import { assertValidSpatialPlan } from './dslValidator.js'
import { isVectorDBAvailable, parallelHybridSearch } from './vectordb.js'
import {
  classifyGeoRelevance,
  IRRELEVANT_FRIENDLY_REPLY
} from './relevanceGate.js'

// MVP 异步分流规则。
const ASYNC_RULES = {
  maxSyncCandidates: 8000,
  maxSyncAreaKm2WithRefine: 20
}

const VECTOR_SUPPORTED_QUERY_TYPES = new Set([
  'poi_search',
  'area_analysis',
  'fuzzy_regions',
  'vernacular_region',
  'graph_reasoning',
  'region_comparison'
])

// Lazy-load legacy Node executor only when fallback is required.
// This keeps gateway startup lean when Python is the primary compute path.
let cachedLegacyExecuteQuery = null

async function getLegacyExecuteQuery() {
  if (typeof cachedLegacyExecuteQuery === 'function') {
    return cachedLegacyExecuteQuery
  }

  const legacyModule = await import('../routes/ai/executor.js')
  if (typeof legacyModule.executeQuery !== 'function') {
    throw new Error('legacy Node executor is unavailable')
  }

  cachedLegacyExecuteQuery = legacyModule.executeQuery
  return cachedLegacyExecuteQuery
}

const ADVANCED_QUERY_TYPES = new Set([
  'area_analysis',
  'fuzzy_regions',
  'vernacular_region',
  'graph_reasoning',
  'region_comparison'
])

function normalizeQueryType(queryPlan = {}) {
  const rawType = queryPlan?.query_type || queryPlan?.queryType || 'poi_search'
  return String(rawType).trim().toLowerCase() || 'poi_search'
}

function isSpatialDslQueryPlan(queryPlan = {}) {
  return String(queryPlan?.dsl_version || '').trim().toLowerCase() === 'spatial_query_v1'
    && queryPlan?.task
    && queryPlan?.scope
}

function toExecutableQueryPlan(queryPlan = {}) {
  if (!isSpatialDslQueryPlan(queryPlan)) {
    return queryPlan
  }

  return {
    ...queryPlan,
    query_type: queryPlan?.task?.query_type || 'poi_search',
    categories: Array.isArray(queryPlan?.entities?.categories) ? queryPlan.entities.categories : [],
    semantic_query: queryPlan?.entities?.semantic_query || '',
    region_ids: Array.isArray(queryPlan?.scope?.region_ids) ? queryPlan.scope.region_ids : [],
    need_text_answer: queryPlan?.task?.need_text_answer !== false,
    latency_budget_ms: queryPlan?.constraints?.latency_budget_ms,
    operators: Array.isArray(queryPlan?.operators) ? queryPlan.operators : []
  }
}

const LEGACY_VISUAL_MODEL_ALIASES = new Map([
  ['qwen3.5-4b', 'qwen3.5-4b']
])

function upgradeLegacyVisualModelAlias(modelName = '') {
  const normalized = String(modelName || '').trim()
  if (!normalized) return ''
  return LEGACY_VISUAL_MODEL_ALIASES.get(normalized.toLowerCase()) || normalized
}

export function normalizeVisualModelName(modelName, { fallback = 'qwen3.5-4b' } = {}) {
  const explicitModel = upgradeLegacyVisualModelAlias(modelName)
  if (explicitModel) {
    return explicitModel
  }

  const envModel = upgradeLegacyVisualModelAlias(
    process.env.LOCAL_VISUAL_MODEL
    || process.env.LOCAL_VLM_MODEL
    || process.env.LOCAL_LLM_MODEL
    || process.env.LLM_MODEL
  )

  if (envModel) {
    return envModel
  }

  return upgradeLegacyVisualModelAlias(fallback) || 'qwen3.5-4b'
}


// 为缓存创建结果副本，防止后续内存对象被意外修改。

function cloneForCache(payload) {
  if (!payload) return payload

  try {
    return structuredClone(payload)
  } catch {
    return JSON.parse(JSON.stringify(payload))
  }
}

// 判断是否应使用空间查询结果缓存。
function shouldUseSpatialResultCache(queryPlan = {}, options = {}) {
  if (options?.skipCache || options?.forceRefresh) return false

  const cacheInDev = String(process.env.SPATIAL_CACHE_IN_DEV || 'true').trim().toLowerCase()
  const allowCacheInDev = ['1', 'true', 'yes', 'on'].includes(cacheInDev)
  if (process.env.NODE_ENV !== 'production' && !allowCacheInDev) {
    return false
  }

  const queryType = normalizeQueryType(queryPlan)
  if (queryType === 'clarification_needed') return false

  return true
}

// Cache fingerprint includes source_policy + userQuestion to avoid stale cross-query reuse.
function buildSpatialCacheFingerprint(queryPlan = {}, spatialContext = {}, options = {}, userQuestion = '') {
  return queryCache.generateQueryFingerprint(queryPlan, spatialContext, {
    sourcePolicy: options?.sourcePolicy || null,
    modelProfile: {
      visualModel: normalizeVisualModelName(options?.visualModel),
      ocrModel: options?.ocrModel || null,
      overviewModel: options?.overviewModel || null,
      overviewEnabled: options?.overviewEnabled ?? null,
      overviewMediumEnabled: options?.overviewMediumEnabled ?? null,
      reasoningModel: options?.reasoningModel || null,
      reasoningEnabled: options?.reasoningEnabled ?? null
    },
    queryType: normalizeQueryType(queryPlan),
    route: 'spatial_job_runner',
    userQuestion
  })
}

// Migration closeout rule: advanced spatial queries should stay on Python.
// Legacy Node executor is allowed only for explicit forceNodeFallback or legacy policy.
function shouldUseMinimalNodeFallback(queryPlan = {}, options = {}) {
  if (options.forceNodeFallback === true || options.forceLocalExecutor === true) {
    return false
  }

  const policy = String(process.env.SPATIAL_NODE_ADVANCED_FALLBACK || 'minimal').trim().toLowerCase()
  if (policy === 'legacy' || policy === 'always') {
    return false
  }

  if (policy === 'disabled') {
    return true
  }

  return ADVANCED_QUERY_TYPES.has(normalizeQueryType(queryPlan))
}


function shouldUseLegacyNodeExecutor(options = {}) {
  if (options.forceLegacyNodeExecutor === true) {
    return true
  }

  const envFlag = String(process.env.SPATIAL_NODE_LEGACY_EXECUTOR || 'false').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(envFlag)
}

function emptyGraphReasoningSummary() {
  return {
    node_count: 0,
    edge_count: 0,
    component_count: 0,
    components: [],
    top_hubs: [],
    avg_degree: 0,
    distance_threshold_m: 280
  }
}

function buildMinimalNodeFallbackEnvelope(queryPlan = {}, fallbackReasons = []) {
  const queryType = normalizeQueryType(queryPlan)
  const fallbackPolicy = String(process.env.SPATIAL_NODE_ADVANCED_FALLBACK || 'minimal').trim().toLowerCase()

  return {
    success: true,
    results: {
      mode: 'node-minimal-fallback',
      pois: [],
      boundary: null,
      spatial_clusters: { hotspots: [] },
      target_regions: [],
      region_analyses: [],
      comparison: null,
      vernacular_regions: [],
      fuzzy_regions: [],
      graph_reasoning: emptyGraphReasoningSummary(),
      stats: {
        total_candidates: 0,
        cluster_count: 0,
        query_type: queryType,
        executor_engine: 'node_minimal_fallback',
        fallback_policy: fallbackPolicy,
        degraded: true
      }
    },
    diagnostics: {
      engine: 'node-minimal-fallback',
      query_type: queryType,
      fallback_reasons: fallbackReasons
    }
  }
}

/**
 * 将值转换为数字类型，如果无法转换则使用回退值。
 */
function toNumeric(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return null

  const prompt = Math.max(0, Math.round(toNumeric(usage.prompt_tokens, 0)))
  const completion = Math.max(0, Math.round(toNumeric(usage.completion_tokens, 0)))
  const explicitTotal = Math.max(0, Math.round(toNumeric(usage.total_tokens, 0)))
  const total = explicitTotal > 0 ? explicitTotal : (prompt + completion)

  if (prompt === 0 && completion === 0 && total === 0) return null

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total
  }
}

function buildTokenUsageSummary(plannerUsage = null, writerUsage = null) {
  const planner = normalizeTokenUsage(plannerUsage)
  const writer = normalizeTokenUsage(writerUsage)
  const totalTokens = (planner?.total_tokens || 0) + (writer?.total_tokens || 0)

  if (!planner && !writer && totalTokens <= 0) {
    return null
  }

  return {
    planner,
    writer,
    total_tokens: totalTokens
  }
}

function normalizeShortText(value, maxLen = 120) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function normalizeTextArray(value, { limit = 12, maxLen = 64 } = {}) {
  if (!Array.isArray(value)) return []
  const normalized = []
  for (const item of value) {
    const text = normalizeShortText(item, maxLen)
    if (!text) continue
    if (!normalized.includes(text)) normalized.push(text)
    if (normalized.length >= limit) break
  }
  return normalized
}

function buildPipelineStageChecklist(stats = {}, writerMeta = {}) {
  const normalizedStats = stats && typeof stats === 'object' ? stats : {}
  const ocrTexts = normalizeTextArray(normalizedStats.vlm_extracted_texts, { limit: 6, maxLen: 40 })
  const ocrEnabled = normalizedStats.ocr_enabled === true
  const overviewEnabled = normalizedStats.overview_enabled === true
  const overviewMediumEnabled = normalizedStats.overview_medium_enabled === true
  const visualReviewEnabled = String(normalizedStats.visual_review_mode || '').toLowerCase() !== 'disabled'
    && Boolean(normalizedStats.visual_review_model)
  const reasoningEnabled = normalizedStats.reasoning_enabled === true
  const writerFallbackUsed = writerMeta.used_fallback === true
  const writerOutputReady = writerMeta.output_ready === true
  const writerStatus = writerFallbackUsed
    ? (writerOutputReady ? 'WARN' : 'FAIL')
    : 'PASS'

  return [
    {
      key: 'ocr',
      label: 'OCR 文本提取',
      ok: ocrEnabled,
      model: normalizedStats.ocr_model || null,
      extracted_count: ocrTexts.length,
      extracted_texts: ocrTexts
    },
    {
      key: 'overview_light_vlm',
      label: '轻量 VLM 总览',
      ok: overviewEnabled,
      model: normalizedStats.overview_model || null,
      summary: normalizeShortText(normalizedStats.overview_light_summary || '')
    },
    {
      key: 'overview_medium_vlm',
      label: '中级 VLM 视觉评审',
      ok: overviewMediumEnabled || visualReviewEnabled,
      model: normalizedStats.overview_medium_model || normalizedStats.visual_review_model || null,
      summary: normalizeShortText(normalizedStats.overview_medium_summary || '')
    },
    {
      key: 'reasoning',
      label: '推理模型',
      ok: reasoningEnabled,
      model: normalizedStats.reasoning_model || null,
      mode: reasoningEnabled ? 'enabled' : 'disabled'
    },
    {
      key: 'writer',
      label: 'Writer 结果整合',
      ok: writerStatus !== 'FAIL',
      status: writerStatus,
      fallback_used: writerFallbackUsed,
      fallback_reason: writerMeta.fallback_reason || null
    }
  ]
}

/**
 * 标准化点坐标，支持数组 [lon, lat] 或对象 {lon, lat}。
 */
function normalizePoint(input) {
  if (!input) return null

  if (Array.isArray(input) && input.length >= 2) {
    const lon = toNumeric(input[0], NaN)
    const lat = toNumeric(input[1], NaN)
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat }
    }
    return null
  }

  const lon = toNumeric(input.lon ?? input.lng ?? input.longitude, NaN)
  const lat = toNumeric(input.lat ?? input.latitude, NaN)
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return { lon, lat }
  }

  return null
}

/**
 * 计算两点间的球面距离 (Haversine 公式)。
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * 计算 Viewport 覆盖的近似面积。
 */
function viewportAreaKm2(viewport) {
  if (!Array.isArray(viewport) || viewport.length < 4) {
    return 0
  }

  const minLon = toNumeric(viewport[0], NaN)
  const minLat = toNumeric(viewport[1], NaN)
  const maxLon = toNumeric(viewport[2], NaN)
  const maxLat = toNumeric(viewport[3], NaN)

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return 0
  }

  const midLat = (minLat + maxLat) / 2
  const midLon = (minLon + maxLon) / 2

  const widthKm = haversineKm(midLat, minLon, midLat, maxLon)
  const heightKm = haversineKm(minLat, midLon, maxLat, midLon)

  return Math.max(0, widthKm * heightKm)
}

/**
 * 计算多边形边界的地理面积。
 */
function polygonAreaKm2(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) {
    return 0
  }

  const points = boundary
    .map(normalizePoint)
    .filter(Boolean)

  if (points.length < 3) {
    return 0
  }

  const refLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const metersPerDegreeLat = 111_320
  const metersPerDegreeLon = 111_320 * Math.cos((refLat * Math.PI) / 180)

  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length]
    const current = points[i]

    const x1 = current.lon * metersPerDegreeLon
    const y1 = current.lat * metersPerDegreeLat
    const x2 = next.lon * metersPerDegreeLon
    const y2 = next.lat * metersPerDegreeLat

    area += x1 * y2 - x2 * y1
  }

  return Math.abs(area / 2) / 1_000_000
}

/**
 * 从空间上下文中推算出面积（平方公里）。
 */
function deriveSpatialAreaKm2(spatialContext = {}) {
  if (!spatialContext || typeof spatialContext !== 'object') {
    return 0
  }

  if (spatialContext.mode?.toLowerCase() === 'circle' && spatialContext.radius) {
    const radiusKm = toNumeric(spatialContext.radius, 0) / 1000
    if (radiusKm > 0) {
      return Math.PI * radiusKm * radiusKm
    }
  }

  if (Array.isArray(spatialContext.boundary) && spatialContext.boundary.length >= 3) {
    return polygonAreaKm2(spatialContext.boundary)
  }

  if (Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) {
    return viewportAreaKm2(spatialContext.viewport)
  }

  return 0
}

/**
 * 检查是否具有有效的空间范围信息。
 */
function hasSpatialContext(spatialContext = {}) {
  if (!spatialContext || typeof spatialContext !== 'object') {
    return false
  }

  return (
    (Array.isArray(spatialContext.boundary) && spatialContext.boundary.length >= 3) ||
    (Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) ||
    (spatialContext.center && spatialContext.radius)
  )
}

/**
 */
/**
 * 通过输入解析坐标点特征，支持经纬度对象或经纬度数组。
 */

function getViewportCenter(spatialContext = {}) {
  if (Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) {
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport
    return {
      lon: (toNumeric(minLon, 0) + toNumeric(maxLon, 0)) / 2,
      lat: (toNumeric(minLat, 0) + toNumeric(maxLat, 0)) / 2
    }
  }

  if (spatialContext.center) {
    return normalizePoint(spatialContext.center)
  }

  return null
}

function resolveVectorSemanticQuery(queryPlan = {}, userQuestion = '') {
  const semanticFromPlan = String(queryPlan?.semantic_query || '').trim()
  if (semanticFromPlan) return semanticFromPlan

  const categories = Array.isArray(queryPlan?.categories)
    ? queryPlan.categories.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (categories.length > 0) return categories.join(' ')

  return String(userQuestion || '').trim()
}

function resolveVectorAnchorPoint(queryPlan = {}, spatialContext = {}) {
  const planAnchor = normalizePoint(queryPlan?.anchor)
  if (planAnchor) return planAnchor

  const contextCenter = normalizePoint(spatialContext?.center)
  if (contextCenter) return contextCenter

  const viewportCenter = getViewportCenter(spatialContext)
  return normalizePoint(viewportCenter)
}

function resolveVectorRadiusMeters(queryPlan = {}, spatialContext = {}) {
  const planRadius = toNumeric(queryPlan?.radius_m, NaN)
  if (Number.isFinite(planRadius) && planRadius > 0) {
    return Math.max(300, Math.min(15000, Math.round(planRadius)))
  }

  const contextRadius = toNumeric(spatialContext?.radius, NaN)
  if (Number.isFinite(contextRadius) && contextRadius > 0) {
    return Math.max(300, Math.min(15000, Math.round(contextRadius)))
  }

  return 3000
}

function toVectorCategoryText(poi = {}, keys = []) {
  for (const key of keys) {
    const direct = poi?.[key]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    const nested = poi?.properties?.[key]
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  return ''
}

function normalizeVectorCandidate(poi = {}, index = 0) {
  const lon = toNumeric(
    poi?.lon ?? poi?.lng ?? poi?.longitude ?? poi?.properties?.lon ?? poi?.properties?.lng,
    NaN
  )
  const lat = toNumeric(
    poi?.lat ?? poi?.latitude ?? poi?.properties?.lat ?? poi?.properties?.latitude,
    NaN
  )
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null

  const id = poi?.id ?? poi?.poi_id ?? `vector_${index + 1}`
  const name = normalizeShortText(
    poi?.name || poi?.properties?.name || poi?.properties?.['名称'] || `POI-${index + 1}`,
    160
  )
  const address = normalizeShortText(
    poi?.address || poi?.properties?.address || poi?.properties?.['地址'] || '',
    240
  )

  const categorySmall = toVectorCategoryText(poi, [
    'category_small',
    'categorySmall',
    '小类',
    'category',
    'type'
  ])
  const categoryMid = toVectorCategoryText(poi, [
    'category_mid',
    'categoryMid',
    '中类',
    'category'
  ])
  const categoryBig = toVectorCategoryText(poi, [
    'category_big',
    'categoryBig',
    '大类'
  ])
  const type = toVectorCategoryText(poi, ['type', 'category']) || categorySmall || categoryMid || categoryBig

  const semanticScore = toNumeric(poi?.semantic_score, 0)
  const hybridScore = toNumeric(poi?.hybrid_score, 0)
  const distanceMeters = toNumeric(poi?.distance_m ?? poi?.distance, NaN)

  return {
    id,
    name,
    address,
    type,
    category_big: categoryBig,
    category_mid: categoryMid,
    category_small: categorySmall,
    lon,
    lat,
    distance_m: Number.isFinite(distanceMeters) ? distanceMeters : null,
    semantic_score: Number.isFinite(semanticScore) ? semanticScore : 0,
    hybrid_score: Number.isFinite(hybridScore) ? hybridScore : 0,
    properties: {
      id,
      name,
      address,
      type,
      category_big: categoryBig,
      category_mid: categoryMid,
      category_small: categorySmall
    },
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    }
  }
}

function buildVectorRetrievalMeta(partial = {}) {
  return {
    attempted: partial?.attempted === true,
    used: partial?.used === true,
    reason: String(partial?.reason || '').trim() || null,
    semantic_query: partial?.semantic_query ? String(partial.semantic_query).slice(0, 120) : null,
    candidate_count: Math.max(0, Math.round(toNumeric(partial?.candidate_count, 0))),
    py_data_source: partial?.py_data_source || null
  }
}

async function prepareVectorCandidates({
  queryPlan = {},
  spatialContext = {},
  userQuestion = '',
  options = {},
  reportStage = async () => {}
} = {}) {
  const queryType = normalizeQueryType(queryPlan)
  if (!VECTOR_SUPPORTED_QUERY_TYPES.has(queryType)) {
    return {
      candidates: [],
      meta: buildVectorRetrievalMeta({
        attempted: false,
        used: false,
        reason: `query_type_unsupported:${queryType}`,
        py_data_source: 'python'
      })
    }
  }

  const semanticQuery = resolveVectorSemanticQuery(queryPlan, userQuestion)
  if (!semanticQuery || semanticQuery.length < 2) {
    return {
      candidates: [],
      meta: buildVectorRetrievalMeta({
        attempted: false,
        used: false,
        reason: 'semantic_query_empty',
        py_data_source: 'python'
      })
    }
  }

  const anchor = resolveVectorAnchorPoint(queryPlan, spatialContext)
  if (!anchor) {
    return {
      candidates: [],
      meta: buildVectorRetrievalMeta({
        attempted: false,
        used: false,
        reason: 'anchor_missing',
        semantic_query: semanticQuery,
        py_data_source: 'python'
      })
    }
  }

  if (!isVectorDBAvailable()) {
    return {
      candidates: [],
      meta: buildVectorRetrievalMeta({
        attempted: false,
        used: false,
        reason: 'vector_db_unavailable',
        semantic_query: semanticQuery,
        py_data_source: 'python'
      })
    }
  }

  const radius = resolveVectorRadiusMeters(queryPlan, spatialContext)
  const desiredTopK = Math.round(toNumeric(options?.limit, 600))
  const topK = Math.max(60, Math.min(1200, desiredTopK))
  const categories = Array.isArray(queryPlan?.categories) ? queryPlan.categories.slice(0, 30) : []

  await reportStage('vector_retrieval_start', {
    query_type: queryType,
    semantic_query: normalizeShortText(semanticQuery, 80),
    anchor,
    radius_m: radius,
    top_k: topK
  })

  try {
    const embedding = await generateEmbedding(semanticQuery)
    if (!Array.isArray(embedding) || embedding.length === 0) {
      await reportStage('vector_retrieval_skip', {
        reason: 'embedding_unavailable',
        query_type: queryType
      })
      return {
        candidates: [],
        meta: buildVectorRetrievalMeta({
          attempted: true,
          used: false,
          reason: 'embedding_unavailable',
          semantic_query: semanticQuery,
          py_data_source: 'python'
        })
      }
    }

    const vectorResults = await parallelHybridSearch({
      queryEmbedding: embedding,
      anchor,
      radius,
      topK,
      categories
    })

    const normalizedCandidates = Array.isArray(vectorResults)
      ? vectorResults.map((item, index) => normalizeVectorCandidate(item, index)).filter(Boolean)
      : []

    const dedupedCandidates = []
    const dedupe = new Set()
    for (const candidate of normalizedCandidates) {
      const key = `${candidate.id}|${candidate.lon.toFixed(6)}|${candidate.lat.toFixed(6)}`
      if (dedupe.has(key)) continue
      dedupe.add(key)
      dedupedCandidates.push(candidate)
      if (dedupedCandidates.length >= 1500) break
    }

    const used = dedupedCandidates.length > 0
    const reason = used ? 'ok' : 'vector_result_empty'
    const pyDataSource = used ? 'hybrid' : 'python'

    await reportStage('vector_retrieval_done', {
      query_type: queryType,
      candidate_count: dedupedCandidates.length,
      used,
      py_data_source: pyDataSource
    })

    return {
      candidates: dedupedCandidates,
      meta: buildVectorRetrievalMeta({
        attempted: true,
        used,
        reason,
        semantic_query: semanticQuery,
        candidate_count: dedupedCandidates.length,
        py_data_source: pyDataSource
      })
    }
  } catch (err) {
    const errorReason = String(err?.message || 'vector_retrieval_error').slice(0, 140)
    await reportStage('vector_retrieval_error', {
      reason: errorReason,
      query_type: queryType
    })
    return {
      candidates: [],
      meta: buildVectorRetrievalMeta({
        attempted: true,
        used: false,
        reason: errorReason,
        semantic_query: semanticQuery,
        py_data_source: 'python'
      })
    }
  }
}

/**
 */
/**
 * 提交空间查询任务到内部队列，支持同步/异步模式切换。
 */
function detectHeavyFeatureFlags(options = {}, queryPlan = {}) {
  const wantsFuzzy =
    options.enableFuzzyRegion === true ||
    options.enable_fuzzy_region === true ||
    queryPlan.need_fuzzy_region === true

  const wantsVernacular =
    options.enableVernacularRegion === true ||
    options.enable_vernacular_region === true ||
    queryPlan.need_vernacular_region === true

  const needHighPrecisionNaming =
    options.highPrecisionNaming === true || options.needHighPrecisionNaming === true

  return {
    wantsFuzzy,
    wantsVernacular,
    needHighPrecisionNaming
  }
}

/**
 * 提取最后一条用户消息。
 */
export function extractLastUserMessage(messages = []) {
  const last = messages.filter((item) => item?.role === 'user').pop()
  return last?.content || ''
}

/**
 */
/**
 * 判断传入的计划是否符合 Spatial DSL 标准格式。
 */
 */
/**
 * Detect greeting-only messages to avoid unnecessary spatial compute + long LLM latency.
 */
function isSmallTalkQuestion(question = '') {
  const normalized = String(question).trim().toLowerCase()
  if (!normalized) return false

  const compact = normalized.replace(/[\s,.!?]/g, '')
  const smallTalkSet = new Set([
    '\u4f60\u597d',     // nihao
    '\u60a8\u597d',     // ninhao
    '\u55e8',             // ?
    '\u54c8\u55bd',     // halou
    '\u5728\u5417',     // zaima
    '\u5728\u4e0d\u5728', // zaibuzai
    'hi',
    'hello',
    'hey'
  ])

  return smallTalkSet.has(compact)
}

const GENERAL_QA_PROMPT_VERSION = '2026-02-26.general_qa.v3'

const GENERAL_QA_SYSTEM_PROMPT = [
  'You are GeoLoom assistant for this product only.',
  'Use plain Chinese and keep answers practical, concise, and system-specific.',
  'Important constraints:',
  '- Do not trigger or assume spatial operators in this mode.',
  '- Do not claim unsupported capabilities (global encyclopedic lookup, real-time internet facts, external DB access).',
  '- Focus on this system: viewport/boundary based POI analysis, clustering hotspots, category structure, region comparison, and actionable conclusions.',
  '- If user asks for question templates/examples, provide exactly 6 high-quality examples and each with an executable conclusion.',
  '- Avoid generic marketing copy.'
].join('\n')

function normalizeGeneralQaText(question = '') {
  return String(question || '').trim().toLowerCase()
}

export function detectGeneralQaPresetType(question = '') {
  const normalized = normalizeGeneralQaText(question)
  if (!normalized) return null
  const compact = normalized.replace(/\s+/g, '')

  const asksExamples = (
    /(\u793a\u4f8b|\u4f8b\u5b50|\u6a21\u677f|prompt|template)/i.test(compact) &&
    /(\u95ee\u9898|\u95ee\u6cd5|question|query)/i.test(compact)
  ) || /(\u600e\u4e48\u63d0\u95ee|\u5982\u4f55\u63d0\u95ee|\u95ee\u6cd5\u5efa\u8bae)/i.test(compact)
  if (asksExamples) return 'examples'

  const asksCapability = /(\u4f60\u662f\u8c01|\u4f60\u80fd\u505a\u4ec0\u4e48|\u80fd\u529b|\u652f\u6301\u4ec0\u4e48|whoareyou|whatcanyoudo|help)/i.test(compact)
  if (asksCapability) return 'capability'

  const asksUsage = /(\u600e\u4e48\u7528|\u5982\u4f55\u4f7f\u7528|\u4f7f\u7528\u65b9\u6cd5|\u64cd\u4f5c\u6b65\u9aa4|\u4e0a\u624b)/i.test(compact)
  if (asksUsage) return 'usage'

  return null
}

export function buildGeneralQaPresetReply(question = '') {
  const presetType = detectGeneralQaPresetType(question)

  if (presetType === 'examples') {
    return [
      '\u4e0b\u9762\u662f\u57fa\u4e8e\u5f53\u524d\u5730\u56fe\u89c6\u7a97/\u7cfb\u7edf\u80fd\u529b\u7684 6 \u4e2a\u9ad8\u8d28\u91cf\u5730\u7406\u7a7a\u95f4\u63d0\u95ee\u793a\u4f8b\uff08\u6bcf\u4e2a\u90fd\u5bf9\u5e94\u53ef\u6267\u884c\u7ed3\u8bba\uff09\uff1a',
      '',
      '1. \u95ee\u9898\uff1a\u5728\u5f53\u524d\u5730\u56fe\u89c6\u7a97\u5185\uff0c\u54ea\u4e9b\u8857\u533a\u7684\u9910\u996e\u4f9b\u7ed9\u8fc7\u5bc6\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u8f93\u51fa\u201c\u8fc7\u5ea6\u7ade\u4e89\u7247\u533a\u201d\u6e05\u5355\uff0c\u4f5c\u4e3a\u9009\u5740\u907f\u5751\u533a\u57df\u3002',
      '',
      '2. \u95ee\u9898\uff1a\u5728\u81ea\u5b9a\u4e49\u8fb9\u754c\u5185\uff0c\u54ea\u4e9b\u7f51\u683c\u751f\u6d3b\u670d\u52a1\u4f9b\u7ed9\u7f3a\u53e3\u6700\u5927\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u751f\u6210\u201c\u4f18\u5148\u8865\u4f4d\u7247\u533a\u201d\u6392\u5e8f\u4e0e\u5efa\u8bae\u4e1a\u6001\u3002',
      '',
      '3. \u95ee\u9898\uff1a\u4e24\u4e2a\u5df2\u9009\u533a\u57df\u5728\u4e3b\u5bfc\u4e1a\u6001\u7ed3\u6784\u4e0a\u7684\u6838\u5fc3\u5dee\u5f02\u662f\u4ec0\u4e48\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u5f62\u6210\u201cA \u533a vs B \u533a\u201d\u62db\u5546\u7b56\u7565\u5dee\u5f02\u8868\u3002',
      '',
      '4. \u95ee\u9898\uff1a\u5f53\u524d\u53ef\u89c1\u8303\u56f4\u5185\uff0c\u54ea\u4e9b\u70ed\u70b9\u805a\u7c7b\u7247\u533a\u5177\u5907\u589e\u91cf\u5e97\u94fa\u6761\u4ef6\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u7ed9\u51fa Top N \u5019\u9009\u533a\u57df\u53ca\u5bf9\u5e94\u5f00\u5e97\u7c7b\u76ee\u5efa\u8bae\u3002',
      '',
      '5. \u95ee\u9898\uff1a\u6309\u7167\u6307\u5b9a\u7c7b\u522b\u7b5b\u9009\u540e\uff0c\u54ea\u4e9b\u7247\u533a\u7684\u4e1a\u6001\u7ec4\u5408\u6700\u5931\u8861\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u8f93\u51fa\u201c\u8c03\u6574\u4f18\u5148\u7ea7\u201d\u4e0e\u7c7b\u76ee\u8865\u9f50\u6e05\u5355\u3002',
      '',
      '6. \u95ee\u9898\uff1a\u5728\u5f53\u524d\u57ce\u533a\u4e2d\uff0c\u54ea\u4e9b\u7247\u533a\u9002\u5408\u505a\u4e3a\u201c\u793e\u533a\u4fbf\u6c11\u670d\u52a1\u201d\u8bd5\u70b9\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u7ed9\u51fa 2-3 \u4e2a\u8bd5\u70b9\u7247\u533a\u4e0e\u843d\u5730\u5148\u540e\u987a\u5e8f\u3002'
    ].join('\n')
  }

  if (presetType === 'usage') {
    return [
      '\u8fd9\u4e2a\u7cfb\u7edf\u7684\u6700\u4f73\u4f7f\u7528\u65b9\u5f0f\u662f\uff1a\u5148\u6846\u5b9a\u5730\u56fe\u8303\u56f4\uff08\u89c6\u7a97\u6216\u81ea\u5b9a\u4e49\u8fb9\u754c\uff09\uff0c\u518d\u95ee\u4e1a\u52a1\u95ee\u9898\u3002',
      '',
      '\u5efa\u8bae\u63d0\u95ee\u6a21\u677f\uff1a',
      '1. \u201c\u5728[\u5f53\u524d\u89c6\u7a97/\u6307\u5b9a\u533a\u57df]\u5185\uff0c[\u54ea\u7c7b POI/\u54ea\u79cd\u4e1a\u6001]\u7684\u7a7a\u95f4\u5206\u5e03\u6709\u4ec0\u4e48\u7279\u70b9\uff1f\u201d',
      '2. \u201c\u5bf9\u6bd4[\u533a\u57dfA]\u548c[\u533a\u57dfB]\u7684[\u4e1a\u6001/\u6d3b\u529b/\u4f9b\u7ed9\u7ed3\u6784]\uff0c\u4e3b\u8981\u5dee\u5f02\u662f\u4ec0\u4e48\uff1f\u201d',
      '3. \u201c\u57fa\u4e8e\u5f53\u524d\u8303\u56f4\uff0c\u7ed9\u6211[\u9009\u5740/\u8865\u70b9/\u62db\u5546]\u7684\u53ef\u6267\u884c\u5efa\u8bae\u6e05\u5355\u3002\u201d'
    ].join('\n')
  }

  return [
    '\u6211\u662f GeoLoom \u7684\u5bf9\u8bdd\u5206\u6790\u52a9\u624b\uff0c\u53ea\u56de\u7b54\u4e0e\u5f53\u524d\u7cfb\u7edf\u80fd\u529b\u5339\u914d\u7684\u95ee\u9898\u3002',
    '',
    '\u6211\u80fd\u5e2e\u4f60\uff1a',
    '- \u89e3\u8bfb\u5f53\u524d\u89c6\u7a97/\u81ea\u5b9a\u4e49\u8fb9\u754c\u5185\u7684 POI \u5206\u5e03\u4e0e\u4e1a\u6001\u7ed3\u6784\uff1b',
    '- \u8f93\u51fa\u70ed\u70b9\u805a\u7c7b\u3001\u533a\u57df\u5bf9\u6bd4\u548c\u53ef\u6267\u884c\u5efa\u8bae\uff1b',
    '- \u7ed9\u51fa\u9762\u5411\u9009\u5740/\u8fd0\u8425/\u62db\u5546\u7684\u9ad8\u8d28\u91cf\u63d0\u95ee\u6a21\u677f\u3002',
    '',
    '\u4e0d\u652f\u6301\uff1a\u8131\u79bb\u5f53\u524d\u7cfb\u7edf\u6570\u636e\u7684\u767e\u79d1\u7c7b\u95ee\u7b54\u3001\u5b9e\u65f6\u4e92\u8054\u7f51\u67e5\u8be2\u3002',
    '\u4e3a\u4e86\u7ed3\u679c\u66f4\u51c6\uff0c\u8bf7\u5c3d\u91cf\u6307\u5b9a\u5730\u56fe\u8303\u56f4\uff08\u89c6\u7a97/\u8fb9\u754c\uff09\u3001\u5173\u6ce8\u7c7b\u522b\u548c\u5206\u6790\u76ee\u6807\u3002'
  ].join('\n')
}

function buildGeneralQaFallback(question = '') {
  return buildGeneralQaPresetReply(question)
}

async function generateGeneralQaAnswer({ userQuestion, messages = [] } = {}) {
  const presetType = detectGeneralQaPresetType(userQuestion)
  if (presetType) {
    return {
      text: buildGeneralQaPresetReply(userQuestion),
      source: `preset_${presetType}`,
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  }

  const allowGeneralQaLlm = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.GENERAL_QA_ALLOW_LLM || 'false').trim().toLowerCase()
  )
  if (!allowGeneralQaLlm) {
    return {
      text: buildGeneralQaFallback(userQuestion),
      source: 'preset_default',
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  }

  const history = Array.isArray(messages)
    ? messages
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content || '').trim()
      }))
      .filter((item) => item.content.length > 0)
      .slice(-8)
    : []

  const hasLatestUserQuestion = history.length > 0 && history[history.length - 1].role === 'user'
  const llmMessages = [
    { role: 'system', content: GENERAL_QA_SYSTEM_PROMPT },
    ...history,
    ...(hasLatestUserQuestion ? [] : [{ role: 'user', content: String(userQuestion || '').trim() }])
  ]

  try {
    const response = await callLLM({
      messages: llmMessages,
      temperature: 0.35,
      max_tokens: 820,
      stream: false
    })
    const data = await response.json()
    const rawText = data?.choices?.[0]?.message?.content || ''
    const text = normalizeLLMTextReply(rawText)
    return {
      text: text || buildGeneralQaFallback(userQuestion),
      source: 'llm_general_qa',
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  } catch (err) {
    console.warn(`[SpatialJobRunner] general_qa LLM failed, fallback used: ${err.message}`)
    return {
      text: buildGeneralQaFallback(userQuestion),
      source: 'fallback_general_qa',
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  }
}

function isGeneralQaQueryPlan(queryPlan = {}) {
  return String(queryPlan?.query_type || '').trim().toLowerCase() === 'general_qa'
}

function isIrrelevantQueryPlan(queryPlan = {}) {
  return String(queryPlan?.query_type || '').trim().toLowerCase() === 'irrelevant_input'
}

/**
 */
export function decideExecutionMode({
  spatialContext = {},
  queryPlan = null,
  options = {},
  estimatedPoiCount = 0
} = {}) {
  if (options.forceSync === true) {
    return {
      mode: 'sync',
      reasons: ['forceSync enabled'],
      metrics: {
        area_km2: deriveSpatialAreaKm2(spatialContext),
        estimated_candidates: estimatedPoiCount
      }
    }
  }

  if (options.forceAsync === true) {
    return {
      mode: 'async',
      reasons: ['forceAsync enabled'],
      metrics: {
        area_km2: deriveSpatialAreaKm2(spatialContext),
        estimated_candidates: estimatedPoiCount
      }
    }
  }

  const reasons = []
  const areaKm2 = deriveSpatialAreaKm2(spatialContext)
  const estimate = toNumeric(estimatedPoiCount, 0)
  const flags = detectHeavyFeatureFlags(options, queryPlan || {})

  const queryType = queryPlan?.query_type || options.queryType || null
  const needsGlobal = queryPlan?.need_global_context === true || options.need_global_context === true
  const needBoundaryRefine =
    options.needBoundaryRefine === true ||
    options.needBoundaryRefine === true ||
    options.enableBoundaryRefine === true ||
    queryType === 'area_analysis'

  if (estimate > ASYNC_RULES.maxSyncCandidates) {
    reasons.push(`candidate_poi>${ASYNC_RULES.maxSyncCandidates}`)
  }

  if (areaKm2 > ASYNC_RULES.maxSyncAreaKm2WithRefine && needBoundaryRefine) {
    reasons.push(`area>${ASYNC_RULES.maxSyncAreaKm2WithRefine}km2_with_refine`)
  }

  if (flags.wantsFuzzy && flags.wantsVernacular) {
    reasons.push('fuzzy_plus_vernacular_enabled')
  }

  if (queryType === 'area_analysis' && needsGlobal) {
    reasons.push('area_analysis_with_global_context')
  }

  if (flags.needHighPrecisionNaming) {
    reasons.push('high_precision_naming')
  }

  return {
    mode: reasons.length > 0 ? 'async' : 'sync',
    reasons,
    metrics: {
      area_km2: Number(areaKm2.toFixed(3)),
      estimated_candidates: estimate,
      query_type: queryType,
      needs_global: needsGlobal,
      needs_boundary_refine: needBoundaryRefine,
      fuzzy: flags.wantsFuzzy,
      vernacular: flags.wantsVernacular
    }
  }
}

/**
 * 为 gRPC 序列化候选点。
 */
function serializeCandidatesForGrpc(options = {}, poiFeatures = [], migrationDecision = null) {
  // In python data-source mode, keep candidates empty so Python reads from PostGIS directly.
  const pyDataSource = String(options?.pyDataSource || migrationDecision?.py_data_source || '').toLowerCase()
  if (pyDataSource === 'python') {
    return ''
  }

  // In hybrid mode we may forward candidates, but skip oversized payloads.
  if (typeof options?.candidatesJson === 'string') {
    return options.candidatesJson
  }

  if (!Array.isArray(poiFeatures) || poiFeatures.length === 0) {
    return ''
  }

  if (poiFeatures.length > 2000) {
    return ''
  }

  try {
    return JSON.stringify(poiFeatures)
  } catch {
    return ''
  }
}

function buildGrpcRequest({ requestId, queryPlan, spatialContext, options, migrationDecision, poiFeatures }) {
  const executionProfile = migrationDecision?.execution_profile || 'core'
  const dryRun = migrationDecision?.dry_run === true
  const candidatesJson = serializeCandidatesForGrpc(options, poiFeatures, migrationDecision)
  const resolvedVisualModel = normalizeVisualModelName(options?.visualModel)
  
  // Debug: log what's being sent to Python
  console.log('[GRPC_DEBUG] buildGrpcRequest spatialContext keys:', Object.keys(spatialContext || {}))
  console.log('[GRPC_DEBUG] spatialContext.viewport:', spatialContext?.viewport)
  console.log('[GRPC_DEBUG] spatialContext.boundary:', spatialContext?.boundary ? 'present' : 'missing')
  console.log('[GRPC_DEBUG] spatialContext.regions:', spatialContext?.regions?.length || 0)
  console.log('[GRPC_DEBUG] py_data_source:', migrationDecision?.py_data_source || 'python')
  console.log('[GRPC_DEBUG] candidates_json length:', candidatesJson.length)
  console.log('[GRPC_DEBUG] options.limit/maxFetchLimit:', options?.limit, options?.maxFetchLimit)
  console.log('[GRPC_DEBUG] options.clusterMaxHdbscanPoints/maxRegionOutputs:', options?.clusterMaxHdbscanPoints, options?.maxRegionOutputs)
  console.log('[GRPC_DEBUG] options.visualModel/resolvedVisualModel:', options?.visualModel, resolvedVisualModel)

  return {
    request_id: requestId,
    query_type: queryPlan?.query_type || 'poi_search',
    spatial_context: JSON.stringify(spatialContext || {}),
    categories: Array.isArray(queryPlan?.categories) ? queryPlan.categories : [],
    hints: JSON.stringify({
      query_plan: queryPlan,
      semantic_query: queryPlan?.semantic_query || '',
      options: {
        enableFuzzyRegion: options?.enableFuzzyRegion,
        enableVernacularRegion: options?.enableVernacularRegion,
        needBoundaryRefine: options?.needBoundaryRefine,
        confidenceModel: options?.confidenceModel,
        visualReviewEnabled: options?.visualReviewEnabled,
        visualRemoteEnabled: options?.visualRemoteEnabled,
        selfValidationEnabled: options?.selfValidationEnabled,
        skgEnabled: options?.skgEnabled,
        visualModel: resolvedVisualModel,
        ocrModel: options?.ocrModel,
        overviewEnabled: options?.overviewEnabled,
        overviewModel: options?.overviewModel,
        overviewMediumEnabled: options?.overviewMediumEnabled,
        overviewTimeoutMs: options?.overviewTimeoutMs,
        visualEndpoint: options?.visualEndpoint,
        visualTimeoutMs: options?.visualTimeoutMs,
        vlmFailureMode: options?.vlmFailureMode,
        reasoningEnabled: options?.reasoningEnabled,
        reasoningModel: options?.reasoningModel,
        reasoningEndpoint: options?.reasoningEndpoint,
        reasoningTimeoutMs: options?.reasoningTimeoutMs,
        modelBudgetMs: options?.modelBudgetMs,
        syncTimeoutMs: options?.syncTimeoutMs,
        grpcTimeoutMs: options?.grpcTimeoutMs,
        visualSnapshotDataUrl: options?.visualSnapshotDataUrl || options?.mapSnapshotDataUrl || options?.screenshotBase64,
        sourcePolicy: options?.sourcePolicy,
        selectedCategories: options?.selectedCategories,
        regions: Array.isArray(options?.regions) ? options.regions : [],
        context_binding: options?.context_binding || queryPlan?.context_binding || null,
        revision: options?.revision || queryPlan?.revision || null,
        streaming_hints: options?.streaming_hints || queryPlan?.streaming_hints || null,
        limit: options?.limit,
        maxFetchLimit: options?.maxFetchLimit,
        clusterMaxHdbscanPoints: options?.clusterMaxHdbscanPoints,
        maxRegionOutputs: options?.maxRegionOutputs,
        analysisDepth: options?.analysisDepth
      },
      migration: migrationDecision || null
    }),
    mode: options?.mode || 'sync',
    candidates_json: candidatesJson,
    execution_profile: executionProfile,
    dry_run: dryRun
  }
}

/**
 */
/**
 * 将结果信封标准化为前端可识别的 GeoJSON 增强格式。
 */
function buildGraphAnalysisFromReasoning(graphReasoning = null) {
  if (!graphReasoning || typeof graphReasoning !== 'object') return null

  const edgeCount = Number(graphReasoning.edge_count || 0)
  const avgDegree = Number(graphReasoning.avg_degree || 0)
  const componentCount = Number(graphReasoning.component_count || 0)
  const topHubs = Array.isArray(graphReasoning.top_hubs) ? graphReasoning.top_hubs : []

  const hubs = topHubs.map((hub, index) => ({
    representativePOI: hub?.name || `Hub-${index + 1}`,
    mainCategory: hub?.category || hub?.category_small || hub?.type || 'mixed',
    pageRank: Number.isFinite(edgeCount) && edgeCount > 0
      ? Math.min(1, Math.max(0, Number(hub?.degree || 0) / edgeCount))
      : 0,
    degree: Number(hub?.degree || 0)
  }))

  return {
    global: {
      totalGrids: componentCount,
      totalConnections: edgeCount,
      avgConnectivity: Number(avgDegree.toFixed(2))
    },
    hubs,
    bridges: [],
    communities: [],
    insights: []
  }
}

function normalizeExecutorResults(rawResults, diagnostics = null) {
  const results = rawResults && typeof rawResults === 'object'
    ? { ...rawResults }
    : {}

  const stats = results.stats && typeof results.stats === 'object'
    ? { ...results.stats }
    : {}

  const graphReasoning = results.graph_reasoning && typeof results.graph_reasoning === 'object'
    ? results.graph_reasoning
    : null

  if (!results.graph_analysis && graphReasoning) {
    results.graph_analysis = buildGraphAnalysisFromReasoning(graphReasoning)
  }

  if (!stats.executor_engine && typeof diagnostics?.engine === 'string' && diagnostics.engine.includes('python')) {
    stats.executor_engine = 'python_grpc'
  }

  return {
    ...results,
    mode: results.mode || 'unknown',
    pois: Array.isArray(results.pois) ? results.pois : [],
    boundary: results.boundary ?? null,
    spatial_clusters: results.spatial_clusters || { hotspots: [] },
    target_regions: Array.isArray(results.target_regions) ? results.target_regions : [],
    region_analyses: Array.isArray(results.region_analyses) ? results.region_analyses : [],
    comparison: results.comparison ?? null,
    vernacular_regions: Array.isArray(results.vernacular_regions) ? results.vernacular_regions : [],
    fuzzy_regions: Array.isArray(results.fuzzy_regions) ? results.fuzzy_regions : [],
    graph_reasoning: graphReasoning,
    stats
  }
}

function normalizeExecutorEnvelope(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      success: false,
      results: normalizeExecutorResults({
        mode: 'empty',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: []
      }),
      error: 'Empty compute payload'
    }
  }

  const envelope = (Object.prototype.hasOwnProperty.call(rawPayload, 'success') && rawPayload.results)
    ? { ...rawPayload }
    : {
        success: true,
        results: rawPayload.results || rawPayload
      }

  const diagnostics = envelope.diagnostics && typeof envelope.diagnostics === 'object'
    ? envelope.diagnostics
    : null

  envelope.results = normalizeExecutorResults(envelope.results, diagnostics)
  return envelope
}


function resolveComputeMode(executorEnvelope, migrationDecision) {
  const computePath = executorEnvelope?._compute_path
  if (computePath === 'python_primary' || computePath === 'node_primary' || computePath === 'node_fallback') {
    return computePath
  }

  return migrationDecision?.use_python_primary ? 'python_primary' : 'node_primary'
}


/**
 */
/**
 * 1) 首先尝试从 L1/L2 缓存中通过 WKT 和提示词哈希进行匹配；
 * 1) 濠电姷鏁搁崑鐐差焽濞嗘挸瑙﹂悗锝庡枟閺咁亪姊?Python gRPC
 * 2) 缓存失效后，调用 Python 微服务进行流式计算，并监听进度上报。
 */
 */
  // Shadow run is best-effort and must never break the primary request.
  computeSpatialStream(
    buildGrpcRequest({
      requestId,
      queryPlan,
      spatialContext,
      options: { ...options, mode: 'sync' },
      migrationDecision: { ...migrationDecision, dry_run: true },
      poiFeatures
    }),
    () => Promise.resolve()
  ).catch((err) => {
    console.warn(`[SpatialJobRunner] shadow python compute failed: ${err.message}`)
  })
}

/**
 * Spatial compute strategy:
 * 1) Prefer Python gRPC when migration policy allows
 * 2) Fallback to Node executor when Python compute fails
 * 3) Optional shadow run for dual-run diagnostics
 */
async function computeSpatialWithFallback({
  requestId,
  queryPlan,
  spatialContext,
  options,
  poiFeatures,
  reporter,
  migrationDecision
}) {
  const grpcEnabled = isGrpcComputeEnabled() && options.forceLocalExecutor !== true
  const fallbackReasons = Array.isArray(migrationDecision?.reasons) ? [...migrationDecision.reasons] : []
  if (!grpcEnabled) fallbackReasons.push('grpc_disabled')

  const usePythonPrimary = grpcEnabled && migrationDecision?.use_python_primary === true

  if (usePythonPrimary) {
    try {
      await reporter.reportStage('python_compute', {
        engine: 'grpc',
        endpoint: process.env.SPATIAL_GRPC_ENDPOINT || '127.0.0.1:50051',
        migration: migrationDecision
      })

      let finalPayload = null
      let attempt = 0
      const maxAttempts = 4
      let lastErr = null

      while (attempt < maxAttempts) {
        attempt += 1
        try {
          await computeSpatialStream(
            buildGrpcRequest({
              requestId,
              queryPlan,
              spatialContext,
              options,
              migrationDecision,
              poiFeatures
            }),
            async (event) => {
              if (event.type === 'STAGE') {
                await reporter.reportStage(event.payload?.stage || 'python_stage', event.payload)
              } else if (event.type === 'PROGRESS') {
                await reporter.reportProgress(event.payload?.progress ?? 0, event.payload)
              } else if (event.type === 'PARTIAL') {
                await reporter.reportPartial(event.payload)
              } else if (event.type === 'FINAL') {
                finalPayload = event.payload
              } else if (event.type === 'ERROR') {
                const streamError = new Error(event.payload?.message || 'Python compute returned ERROR')
                if (event.payload?.code) {
                  streamError.code = String(event.payload.code)
                }
                if (event.payload?.diagnostics && typeof event.payload.diagnostics === 'object') {
                  streamError.diagnostics = event.payload.diagnostics
                }
                throw streamError
              }
            }
          )
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          const errCode = String(err?.code || err?.diagnostics?.error_code || err?.grpc_context?.grpc_status || '')
          if (errCode === '14' && attempt < maxAttempts) {
            console.warn(`[SpatialJobRunner] gRPC unavailable (14). Retrying attempt ${attempt}/${maxAttempts}...`)
            await new Promise((resolve) => setTimeout(resolve, 2000))
            continue
          }
          throw err
        }
      }

      if (lastErr) {
        throw lastErr
      }

      if (finalPayload) {
        const normalizedPython = normalizeExecutorEnvelope(finalPayload)
        return {
          ...normalizedPython,
          _compute_path: 'python_primary',
          _fallback_reasons: fallbackReasons
        }
      }

      throw new Error('Python compute stream ended without FINAL payload')
    } catch (err) {
      const failureDiagnostics = buildFailureDiagnostics({
        error: err,
        traceId: requestId,
        mode: options?.mode || 'sync',
        queryType: queryPlan?.query_type || queryPlan?.queryType || '',
        stagePath: [err?.grpc_context?.last_stage].filter(Boolean),
        spatialContext,
        options,
        grpcContext: err?.grpc_context,
        pythonContext: err?.diagnostics?.python_context || err?.python_context,
        stackPreview: err?.stack
      })

      fallbackReasons.push(`python_error:${failureDiagnostics.error_code || err.message}`)
      await reporter.reportStage('python_fallback_error', {
        reason: err.message,
        error_code: failureDiagnostics.error_code,
        error_signature: failureDiagnostics.error_signature,
        failure_diagnostics: failureDiagnostics
      })

      console.error(
        `[SpatialJobRunner] Python execution failed and Node fallback is disabled: ${failureDiagnostics.error_code || err.message}`
      )

      const wrappedError = new Error(`Spatial compute service unavailable: ${err.message}`)
      wrappedError.code = failureDiagnostics.error_code
      wrappedError.diagnostics = failureDiagnostics
      wrappedError.grpc_context = failureDiagnostics.grpc_context
      throw wrappedError
    }
  }

  if (!usePythonPrimary) {
    console.error('[SpatialJobRunner] Python primary path is required, but migration decision disabled it.')
    throw new Error('Spatial compute requires Python primary path.')
  }

  // Should be unreachable: all paths above either return a result or throw.
  console.error('[SpatialJobRunner] Reached unexpected terminal branch without spatial result.')
  throw new Error('Spatial compute failed: no valid result returned.')
}
// Legacy node executor is intentionally disabled.
/**
 * @deprecated This function is no longer used; Python handles all spatial compute.
 */
async function executeLegacyNodeExecutor(queryPlan, poiFeatures, options, reporter) {
  throw new Error('Legacy Node executor is disabled; Python handles spatial compute.')
}

/**
 * Narrative 模式下的空间计算执行器，负责协调检索、分析和渲染阶段。
 * 支持 Python 主路（同步）与 Node 回退路径，确保服务的高可用性。
 */
/**
 * Execute a pre-built queryPlan through Python-primary policy with Node fallback.
 * This keeps /api/ai/execute aligned with the migrated runtime path.
 */
export async function executeSpatialPlanWithFallback({
  queryPlan,
  poiFeatures = [],
  spatialContext = {},
  options = {},
  requestId = randomUUID(),
  reporter = {}
} = {}) {
  if (!queryPlan || typeof queryPlan !== 'object') {
    throw new Error('queryPlan is required')
  }

  const validation = assertValidSpatialPlan(queryPlan, {
    requestId,
    spatialContext,
    options
  })
  if (validation?.diagnostics?.dsl_schema_degraded === true) {
    telemetry.incrementCounter('dsl_schema_degraded_total', {
      mode: String(options?.mode || 'execute')
    })
  }
  const normalizedInputPlan = isSpatialDslQueryPlan(queryPlan)
    ? (validation?.normalized_dsl || queryPlan)
    : queryPlan
  const executableQueryPlan = toExecutableQueryPlan(normalizedInputPlan)

  const report = {
    reportStage: reporter.reportStage || (async () => {}),
    reportProgress: reporter.reportProgress || (async () => {}),
    reportPartial: reporter.reportPartial || (async () => {}),
    reportText: reporter.reportText || (async () => {})
  }

  const migrationDecision = resolveSpatialMigrationDecision({
    requestId,
    queryPlan: executableQueryPlan,
    options
  })

  await report.reportStage('executor', {
    route: migrationDecision.use_python_primary ? 'python_primary' : 'node_primary',
    migration: migrationDecision
  })

  const envelope = await computeSpatialWithFallback({
    requestId,
    queryPlan: executableQueryPlan,
    spatialContext,
    options,
    poiFeatures,
    reporter: report,
    migrationDecision
  })

  const normalized = normalizeExecutorEnvelope(envelope)
  return {
    success: normalized.success !== false,
    results: normalized.results || {},
    diagnostics: {
      compute_mode: resolveComputeMode(normalized, migrationDecision),
      fallback_reasons: normalized?._fallback_reasons || [],
      migration: migrationDecision,
      dsl_validation: validation?.diagnostics || null
    }
  }
}

/**
 * 处理叙事（Narrative）长任务，通过 SSE 或 WebSocket 上报详细的执行足迹。
 */
    reportStage: reporter.reportStage || (async () => {}),
    reportProgress: reporter.reportProgress || (async () => {}),
    reportPartial: reporter.reportPartial || (async () => {}),
    reportText: reporter.reportText || (async () => {})
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  const inputPoiFeatures = Array.isArray(payload?.poiFeatures) ? payload.poiFeatures : []
  let effectivePoiFeatures = inputPoiFeatures
  const spatialContext = payload?.spatialContext || payload?.options?.spatialContext || {}
  const options = payload?.options || {}
  const requestId = payload?.request_id || randomUUID()

  const userQuestion = payload?.query || extractLastUserMessage(messages)
  if (!userQuestion) {
    throw new Error('Missing user question for spatial job')
  }

  const generalQaPresetType = detectGeneralQaPresetType(userQuestion)
  if (generalQaPresetType) {
    const generalQaReason = `preset_${generalQaPresetType}`
    await report.reportStage('general_qa', {
      reason: generalQaReason
    })

    const generalQaResult = await generateGeneralQaAnswer({
      userQuestion,
      messages
    })
    await report.reportText(generalQaResult.text)
    await report.reportProgress(1, { stage: 'completed', mode: 'general_qa' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: {
        query_type: 'general_qa',
        intent_mode: 'llm_chat',
        categories: [],
        confidence: {
          score: 9,
          level: 'high',
          reasons: [generalQaReason]
        }
      },
      answer: generalQaResult.text,
      results: {
        mode: 'general_qa',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa',
          general_qa_source: generalQaResult.source
        }
      },
      diagnostics: {
        engine: 'general-qa-shortcut',
        request_id: requestId,
        general_qa_reason: generalQaReason,
        general_qa_source: generalQaResult.source,
        general_qa_prompt_version: generalQaResult.promptVersion
      }
    }
  }

  const quickPlan = quickIntentClassify(userQuestion)
  if (isGeneralQaQueryPlan(quickPlan)) {
    const generalQaReason = quickPlan?.confidence?.reasons?.[0] || 'general_qa_shortcut'
    await report.reportStage('general_qa', {
      reason: generalQaReason
    })

    const generalQaResult = await generateGeneralQaAnswer({
      userQuestion,
      messages
    })
    await report.reportText(generalQaResult.text)
    await report.reportProgress(1, { stage: 'completed', mode: 'general_qa' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: quickPlan,
      answer: generalQaResult.text,
      results: {
        mode: 'general_qa',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa',
          general_qa_source: generalQaResult.source
        }
      },
      diagnostics: {
        engine: 'general-qa-shortcut',
        request_id: requestId,
        general_qa_reason: generalQaReason,
        general_qa_source: generalQaResult.source,
        general_qa_prompt_version: generalQaResult.promptVersion
      }
    }
  }

  // Greeting-only shortcut to keep chat panel responsive.
  if (isSmallTalkQuestion(userQuestion)) {
    const answer = '\u4f60\u597d\uff01\u6211\u5df2\u5728\u7ebf\u3002\u4f60\u53ef\u4ee5\u76f4\u63a5\u63d0\u95ee\u7a7a\u95f4\u95ee\u9898\uff0c\u4f8b\u5982\uff1a"\u4e1c\u4fa7\u5496\u5561\u5e97"\u3001"\u8fd9\u7247\u533a\u57df\u9910\u996e\u5206\u5e03"\u3002'

    await report.reportStage('smalltalk')
    await report.reportText(answer)
    await report.reportProgress(1, { stage: 'completed', mode: 'smalltalk' })

    return {
      success: true,
      query_plan: {
        query_type: 'general_qa',
        intent_mode: 'llm_chat',
        confidence: { score: 9, level: 'high', reasons: ['smalltalk_shortcut'] }
      },
      answer,
      results: {
        mode: 'smalltalk',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa'
        }
      },
      diagnostics: {
        engine: 'smalltalk-shortcut',
        request_id: requestId
      }
    }
  }

  const relevance = await classifyGeoRelevance(userQuestion, {
    hasSelectedArea: hasSpatialContext(spatialContext),
    poiCount: effectivePoiFeatures.length
  })

  if (!relevance.isGeoRelated) {
    const answer = IRRELEVANT_FRIENDLY_REPLY
    const irrelevantQueryPlan = {
      query_type: 'irrelevant_input',
      intent_mode: 'out_of_scope',
      categories: [],
      confidence: {
        score: relevance.confidence === 'high' ? 9 : relevance.confidence === 'low' ? 5 : 7,
        level: relevance.confidence || 'medium',
        reasons: [
          'query_not_geo_related',
          relevance.source ? `source:${relevance.source}` : null,
          relevance.reason || null
        ].filter(Boolean)
      }
    }

    await report.reportStage('irrelevant_input', {
      reason: relevance.reason || 'query_not_geo_related',
      source: relevance.source || 'rule'
    })
    await report.reportText(answer)
    await report.reportProgress(1, { stage: 'completed', mode: 'irrelevant_input' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: irrelevantQueryPlan,
      answer,
      results: {
        mode: 'irrelevant_input',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'irrelevant_input'
        }
      },
      diagnostics: {
        engine: 'relevance-gate',
        request_id: requestId,
        gate_reason: relevance.reason || 'query_not_geo_related',
        gate_source: relevance.source || 'rule'
      }
    }
  }

  // Stage 1: planner intent parsing
  await report.reportStage('planner', { request_id: requestId })

  let plannerOutput
  let queryPlan

  try {
    plannerOutput = await parseIntent(userQuestion, {
      hasSelectedArea: hasSpatialContext(spatialContext),
      poiCount: effectivePoiFeatures.length,
      viewportCenter: getViewportCenter(spatialContext),
      selectedCategories: Array.isArray(options?.selectedCategories) ? options.selectedCategories : []
    })

    queryPlan = plannerOutput?.queryPlan
  } catch (err) {
    await report.reportStage('planner_fallback', { reason: err.message })
    queryPlan = quickIntentClassify(userQuestion)
  }

  queryPlan = queryPlan || {
    query_type: 'poi_search',
    categories: [],
    radius_m: 1200
  }

  if (isGeneralQaQueryPlan(queryPlan)) {
    const generalQaReason = queryPlan?.confidence?.reasons?.[0] || 'general_qa_from_planner'
    await report.reportStage('general_qa', {
      reason: generalQaReason
    })

    const generalQaResult = await generateGeneralQaAnswer({
      userQuestion,
      messages
    })
    await report.reportText(generalQaResult.text)
    await report.reportProgress(1, { stage: 'completed', mode: 'general_qa' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: queryPlan,
      answer: generalQaResult.text,
      results: {
        mode: 'general_qa',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa',
          general_qa_source: generalQaResult.source
        }
      },
      diagnostics: {
        engine: 'general-qa-shortcut',
        request_id: requestId,
        general_qa_reason: generalQaReason,
        general_qa_source: generalQaResult.source,
        general_qa_prompt_version: generalQaResult.promptVersion
      }
    }
  }

  if (isIrrelevantQueryPlan(queryPlan)) {
    const answer = IRRELEVANT_FRIENDLY_REPLY

    await report.reportStage('irrelevant_input', {
      reason: queryPlan?.confidence?.reasons?.[0] || 'query_not_geo_related'
    })
    await report.reportText(answer)
    await report.reportProgress(1, { stage: 'completed', mode: 'irrelevant_input' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: queryPlan,
      answer,
      results: {
        mode: 'irrelevant_input',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'irrelevant_input'
        }
      },
      diagnostics: {
        engine: 'relevance-gate',
        request_id: requestId
      }
    }
  }

  const enforced = resolveSourcePolicy(queryPlan, spatialContext, options)
  queryPlan = enforced.queryPlan

  let effectiveOptions = {
    ...options,
    selectedCategories: enforced.policy.selected_categories,
    sourcePolicy: {
      ...(options.sourcePolicy || {}),
      ...enforced.policy
    }
  }
  let vectorRetrievalMeta = buildVectorRetrievalMeta({
    attempted: false,
    used: false,
    reason: 'not_started',
    py_data_source: String(effectiveOptions?.pyDataSource || 'python').toLowerCase()
  })

  const validation = assertValidSpatialPlan(queryPlan, {
    requestId,
    userQuestion,
    spatialContext,
    options: effectiveOptions
  })
  if (validation?.diagnostics?.dsl_schema_degraded === true) {
    telemetry.incrementCounter('dsl_schema_degraded_total', {
      mode: String(effectiveOptions?.mode || 'sync')
    })
  }

  await report.reportStage('dsl_validated', {
    stage: validation?.stage || 'unknown',
    legacy_mode: validation?.diagnostics?.legacy_mode === true,
    dsl_schema_degraded: validation?.diagnostics?.dsl_schema_degraded === true
  })

  if (isSpatialDslQueryPlan(queryPlan)) {
    queryPlan = toExecutableQueryPlan(validation?.normalized_dsl || queryPlan)
  }

  effectiveOptions = {
    ...effectiveOptions,
    dsl_validation: validation?.diagnostics || null
  }

  const vectorPrepared = await prepareVectorCandidates({
    queryPlan,
    spatialContext,
    userQuestion,
    options: effectiveOptions,
    reportStage: report.reportStage
  })
  vectorRetrievalMeta = vectorPrepared?.meta || vectorRetrievalMeta
  if (Array.isArray(vectorPrepared?.candidates) && vectorPrepared.candidates.length > 0) {
    effectivePoiFeatures = vectorPrepared.candidates
    effectiveOptions = {
      ...effectiveOptions,
      pyDataSource: 'hybrid',
      vectorRetrieval: vectorRetrievalMeta,
      sourcePolicy: {
        ...(effectiveOptions.sourcePolicy || {}),
        vector_used: true,
        vector_candidate_count: vectorPrepared.candidates.length
      }
    }
  } else {
    effectiveOptions = {
      ...effectiveOptions,
      vectorRetrieval: vectorRetrievalMeta,
      sourcePolicy: {
        ...(effectiveOptions.sourcePolicy || {}),
        vector_used: false,
        vector_candidate_count: 0
      }
    }
  }

  await report.reportProgress(0.12, {
    stage: 'planner_done',
    query_type: queryPlan.query_type,
    categories: queryPlan.categories || [],
    vector_used: vectorRetrievalMeta.used === true
  })

  const shouldUseCache = shouldUseSpatialResultCache(queryPlan, effectiveOptions)
  const spatialCacheFingerprint = shouldUseCache
    ? buildSpatialCacheFingerprint(queryPlan, spatialContext, effectiveOptions, userQuestion)
    : null
  const normalizedQueryType = normalizeQueryType(queryPlan)

  let normalizedExecutor = null
  let migrationDecision = null
  let cacheLock = null
  // Cache lookup path: reuse cached executor envelope when available.
  if (shouldUseCache && spatialCacheFingerprint) {
    const cachedEnvelope = await queryCache.getFromCache(spatialCacheFingerprint, {
      queryType: normalizedQueryType
    })
    if (cachedEnvelope) {
      normalizedExecutor = normalizeExecutorEnvelope(cloneForCache(cachedEnvelope))
      normalizedExecutor.results = normalizedExecutor.results || {}
      normalizedExecutor.results.stats = {
        ...(normalizedExecutor.results.stats || {}),
        cache_hit: true,
        executor_engine: normalizedExecutor.results.stats?.executor_engine || 'cached_spatial_result'
      }

      await report.reportStage('executor_cache_hit', {
        fingerprint: spatialCacheFingerprint.slice(0, 12),
        query_type: normalizeQueryType(queryPlan)
      })
    } else {
      cacheLock = queryCache.acquireComputationLock(spatialCacheFingerprint)
      if (!cacheLock.acquired) {
        await report.reportStage('executor_cache_wait', {
          fingerprint: spatialCacheFingerprint.slice(0, 12),
          query_type: normalizedQueryType
        })

        const lockResolved = await queryCache.waitForComputationLock(spatialCacheFingerprint)
        if (lockResolved) {
          const waitedEnvelope = await queryCache.getFromCache(spatialCacheFingerprint, {
            queryType: normalizedQueryType
          })
          if (waitedEnvelope) {
            normalizedExecutor = normalizeExecutorEnvelope(cloneForCache(waitedEnvelope))
            normalizedExecutor.results = normalizedExecutor.results || {}
            normalizedExecutor.results.stats = {
              ...(normalizedExecutor.results.stats || {}),
              cache_hit: true,
              executor_engine: normalizedExecutor.results.stats?.executor_engine || 'cached_spatial_result_wait'
            }
          }
        }

        if (!normalizedExecutor) {
          const reAcquire = queryCache.acquireComputationLock(spatialCacheFingerprint)
          cacheLock = reAcquire.acquired ? reAcquire : null
        } else {
          cacheLock = null
        }
      }
    }
  }
  // Cache miss path: execute spatial compute and optionally persist cache entry.
  if (!normalizedExecutor) {
    try {
      // Stage 2: spatial execution
      migrationDecision = resolveSpatialMigrationDecision({
        requestId,
        queryPlan,
        options: effectiveOptions
      })

      await report.reportStage('executor', {
        route: migrationDecision.use_python_primary ? 'python_primary' : 'node_primary',
        migration: migrationDecision
      })

      const executorEnvelope = await computeSpatialWithFallback({
        requestId,
        queryPlan,
        spatialContext,
        options: effectiveOptions,
        poiFeatures: effectivePoiFeatures,
        reporter: report,
        migrationDecision
      })

      normalizedExecutor = normalizeExecutorEnvelope(executorEnvelope)

      if (shouldUseCache && spatialCacheFingerprint && normalizedExecutor.success !== false) {
        await queryCache.setToCache(
          spatialCacheFingerprint,
          cloneForCache(normalizedExecutor),
          normalizedQueryType
        )
      }
    } finally {
      if (cacheLock?.acquired) {
        cacheLock.release()
      }
    }
  }

  await report.reportProgress(0.72, {
    stage: 'executor_done',
    poi_count: Array.isArray(normalizedExecutor?.results?.pois)
      ? normalizedExecutor.results.pois.length
      : 0
  })
  // 尝试在本地 L1 缓存中查找匹配，减少外部依赖 IO。
  // 闂傚倸鍊搁崐鎼佸磹閹间礁鐤柟鎯版閺勩儵鏌″搴″季闁?3闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟鐑橆殕閸嬨倖淇婇悙顒傚矗ter 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗ù锝堛€€閸嬫挸顫濋悡搴ｄ桓闁芥鍠庨埞鎴︽偐閸欏鎮欓梺缁樺姇閿曨亪寮婚敐澶婄疀妞ゆ棁濮ゅВ鍕⒑?
  await report.reportStage('writer')

  let answer = ''
  let textBuffer = ''
  let writerFallbackUsed = false
  let writerFallbackReason = null
  let writerTokenUsage = null

  const writerRuntimeOptions = {
    ...effectiveOptions,
    onWriterDiagnostics: (diagnostics) => {
      report.reportStage('writer_validation', diagnostics).catch(() => {})
    },
    onTokenUsage: (usage) => {
      writerTokenUsage = normalizeTokenUsage(usage)
    }
  }

  try {
    for await (const chunk of generateAnswer(userQuestion, normalizedExecutor, writerRuntimeOptions)) {
      answer += chunk
      textBuffer += chunk

      if (textBuffer.length >= 12) {
        await report.reportText(textBuffer)
        textBuffer = ''
      }
    }

    if (textBuffer.length > 0) {
      await report.reportText(textBuffer)
    }
  } catch (err) {
    console.warn(`[SpatialJobRunner] Writer failed, fallback to quick reply: ${err.message}`)
    await report.reportStage('writer_fallback_error', {
      reason: 'writer_error',
      message: String(err?.message || 'unknown')
    })
    writerFallbackUsed = true
    writerFallbackReason = `writer_error: ${String(err?.message || 'unknown')}`
    answer = buildQuickReply(normalizedExecutor)
    await report.reportText(answer)
  }

  if (!String(answer || '').trim()) {
    await report.reportStage('writer_fallback_empty', {
      reason: 'empty_writer_output'
    })
    writerFallbackUsed = true
    writerFallbackReason = 'empty_writer_output'
    answer = buildQuickReply(normalizedExecutor)
    await report.reportText(answer)
  }

  const finalResults = normalizedExecutor?.results || {}
  const baseStats = finalResults?.stats && typeof finalResults.stats === 'object'
    ? { ...finalResults.stats }
    : {}
  const plannerTokenUsage = normalizeTokenUsage(plannerOutput?.tokenUsage)
  const pipelineTokenUsage = buildTokenUsageSummary(plannerTokenUsage, writerTokenUsage)
  const pipelineStageChecklist = buildPipelineStageChecklist(baseStats, {
    used_fallback: writerFallbackUsed,
    fallback_reason: writerFallbackReason,
    output_ready: String(answer || '').trim().length > 0
  })
  const vectorStats = {
    vector_used: vectorRetrievalMeta?.used === true,
    vector_candidate_count: Math.max(0, Math.round(toNumeric(vectorRetrievalMeta?.candidate_count, 0))),
    vector_retrieval_reason: vectorRetrievalMeta?.reason || null,
    vector_retrieval_attempted: vectorRetrievalMeta?.attempted === true,
    py_data_source: vectorRetrievalMeta?.py_data_source || baseStats.py_data_source || null
  }
  if (vectorStats.vector_used && !baseStats.candidate_source) {
    vectorStats.candidate_source = 'payload'
  }

  finalResults.stats = {
    ...baseStats,
    ...vectorStats,
    token_usage: pipelineTokenUsage,
    planner_token_usage: plannerTokenUsage,
    writer_token_usage: writerTokenUsage,
    pipeline_stage_checklist: pipelineStageChecklist,
    writer_fallback_used: writerFallbackUsed,
    writer_fallback_reason: writerFallbackReason || null
  }

  await report.reportStage('pipeline_stage_checklist', {
    items: pipelineStageChecklist
  })

  await report.reportProgress(1, {
    stage: 'completed'
  })

  const operatorTimingsMs = finalResults?.stats?.operator_timings_ms
  if (operatorTimingsMs && typeof operatorTimingsMs === 'object') {
    telemetry.recordOperatorTimings(requestId, operatorTimingsMs, {
      query_type: queryPlan?.query_type || 'unknown'
    })
    const rows = Object.entries(operatorTimingsMs).map(([operatorName, totalTimeMs]) => ({
      trace_id: requestId,
      operator_name: operatorName,
      total_time_ms: Number(totalTimeMs || 0),
      query_type: queryPlan?.query_type || 'unknown',
      recorded_at: Date.now()
    }))
    insertOperatorTimingEvents(rows).catch(() => {})
  }

  return {
    success: normalizedExecutor.success !== false,
    request_id: requestId,
    query: userQuestion,
    query_plan: queryPlan,
    answer,
    results: {
      ...finalResults,
      query_executed: queryPlan
    },
    diagnostics: {
      planner: {
        confidence: plannerOutput?.confidence || plannerOutput?.queryPlan?.confidence || null,
        fast_path: plannerOutput?.fastPath || false,
        token_usage: plannerTokenUsage
      },
      writer: {
        token_usage: writerTokenUsage,
        fallback_used: writerFallbackUsed,
        fallback_reason: writerFallbackReason || null
      },
      compute_mode: normalizedExecutor?.results?.stats?.cache_hit
        ? 'cache_hit'
        : resolveComputeMode(normalizedExecutor, migrationDecision),
      fallback_reasons: normalizedExecutor?._fallback_reasons || [],
      migration: migrationDecision,
      vector_retrieval: vectorRetrievalMeta,
      cache_hit: Boolean(normalizedExecutor?.results?.stats?.cache_hit),
      pipeline_stage_checklist: pipelineStageChecklist,
      dsl_validation: validation?.diagnostics || null
    }
  }
}

/**
 */
/**
 * 叙事任务的状态与进度实时订阅与推送服务。
 */
export function toLegacySSEPayload(jobResult) {
  const result = jobResult?.results || {}

  return {
    text: jobResult?.answer || '',
    pois: Array.isArray(result.pois) ? result.pois : [],
    boundary: result.boundary || null,
    spatial_clusters: result.spatial_clusters || { hotspots: [] },
    vernacular_regions: Array.isArray(result.vernacular_regions) ? result.vernacular_regions : [],
    fuzzy_regions: Array.isArray(result.fuzzy_regions) ? result.fuzzy_regions : [],
    stats: result.stats && typeof result.stats === 'object' ? result.stats : null
  }
}

export default {
  extractLastUserMessage,
  normalizeVisualModelName,
  decideExecutionMode,
  executeSpatialPlanWithFallback,
  runNarrativeSpatialJob,
  toLegacySSEPayload
}
