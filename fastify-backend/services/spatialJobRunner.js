/**
 * 空间任务运行编排器（Job Runner）。
 * 统一实现分流、调用 gRPC 计算、回退策略与写作结果生成。
 */
import { randomUUID } from 'crypto'

import { parseIntent, quickIntentClassify } from '../routes/ai/planner.js'
import { generateAnswer, buildQuickReply } from '../routes/ai/writer.js'
import { computeSpatialStream, isGrpcComputeEnabled } from './grpcClient.js'
import { resolveSpatialMigrationDecision } from './migrationPolicy.js'
import { resolveSourcePolicy } from './sourcePolicy.js'
import * as queryCache from './queryCache.js'
import {
  classifyGeoRelevance,
  IRRELEVANT_FRIENDLY_REPLY
} from './relevanceGate.js'

// MVP 固定分流阈值，后续可根据压测结果调参。
const ASYNC_RULES = {
  maxSyncCandidates: 8000,
  maxSyncAreaKm2WithRefine: 20
}

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


// 缓存前深拷贝，避免后续写流程污染缓存对象。
function cloneForCache(payload) {
  if (!payload) return payload

  try {
    return structuredClone(payload)
  } catch {
    return JSON.parse(JSON.stringify(payload))
  }
}

// 仅在稳定查询类型启用缓存，澄清类请求直接跳过。
function shouldUseSpatialResultCache(queryPlan = {}, options = {}) {
  if (options?.skipCache || options?.forceRefresh) return false

  const cacheInDev = String(process.env.SPATIAL_CACHE_IN_DEV || 'false').trim().toLowerCase()
  const allowCacheInDev = ['1', 'true', 'yes', 'on'].includes(cacheInDev)
  if (process.env.NODE_ENV !== 'production' && !allowCacheInDev) {
    return false
  }

  const queryType = normalizeQueryType(queryPlan)
  if (queryType === 'clarification_needed') return false

  return true
}

// 缓存指纹包含 source_policy，确保 UI 约束变化不会误命中。
function buildSpatialCacheFingerprint(queryPlan = {}, spatialContext = {}, options = {}) {
  return queryCache.generateQueryFingerprint(queryPlan, spatialContext, {
    sourcePolicy: options?.sourcePolicy || null,
    queryType: normalizeQueryType(queryPlan),
    route: 'spatial_job_runner'
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
 */
/**
 * 安全数字转换，防止 NaN 传染后续计算。
 */
function toNumeric(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/**
 */
/**
 * 将点坐标统一成 {lon, lat}。
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
 */
/**
 * Haversine 球面距离（km）。
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
 */
/**
 * 估算 viewport 面积（km²）。
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
 */
/**
 * 估算 polygon 面积（km²），仅用于分流判断。
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
 */
/**
 * 从 spatialContext 提取或估算查询面积。
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
 */
/**
 * 检查是否有效空间约束。
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
 * 获取视口中心点，供 Planner 作为辅助上下文。
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

/**
 */
/**
 * 检测重计算功能标记（fuzzy/vernacular/高精命名）。
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
 */
/**
 * 取 messages 中最后一条 user 提问。
 */
export function extractLastUserMessage(messages = []) {
  const last = messages.filter((item) => item?.role === 'user').pop()
  return last?.content || ''
}

/**
 */
/**
 * 快/重分流策略。
 * 返回 mode + reasons + metrics，便于解释。
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
 */
/**
 * 构造 gRPC 请求体。
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
  
  // Debug: log what's being sent to Python
  console.log('[GRPC_DEBUG] buildGrpcRequest spatialContext keys:', Object.keys(spatialContext || {}))
  console.log('[GRPC_DEBUG] spatialContext.viewport:', spatialContext?.viewport)
  console.log('[GRPC_DEBUG] spatialContext.boundary:', spatialContext?.boundary ? 'present' : 'missing')
  console.log('[GRPC_DEBUG] spatialContext.regions:', spatialContext?.regions?.length || 0)
  console.log('[GRPC_DEBUG] py_data_source:', migrationDecision?.py_data_source || 'python')
  console.log('[GRPC_DEBUG] candidates_json length:', candidatesJson.length)

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
        sourcePolicy: options?.sourcePolicy,
        selectedCategories: options?.selectedCategories,
        regions: Array.isArray(options?.regions) ? options.regions : []
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
 * 将不同形式的 executor 结果归一化。
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

  if (!stats.source_policy && diagnostics?.source_policy) {
    stats.source_policy = diagnostics.source_policy
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
 * 空间计算策略：
 * 1) 优先 Python gRPC
 * 2) 异常时回退 Node executor
 */
function runShadowPythonCompute({ requestId, queryPlan, spatialContext, options, poiFeatures, migrationDecision }) {
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
            throw new Error(event.payload?.message || 'Python compute returned ERROR')
          }
        }
      )

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
      // 重构目标：Python失败时不再回退到Node.js，直接抛出错误
      // 这样可以确保空间计算始终由Python处理，符合"Python见长"的设计原则
      fallbackReasons.push(`python_error:${err.message}`)
      await reporter.reportStage('python_fallback_error', {
        reason: err.message
      })
      console.error(`[SpatialJobRunner] Python执行失败，不再回退到Node.js: ${err.message}`)
      throw new Error(`空间计算服务暂时不可用: ${err.message}`)
    }
  }

  // 重构目标：不再使用Node.js执行器作为回退
  // 如果Python路径没有被选择（不应该发生），则抛出错误
  if (!usePythonPrimary) {
    console.error('[SpatialJobRunner] Python未被选为主路径，但系统配置要求仅使用Python计算')
    throw new Error('配置错误：空间计算仅支持Python服务')
  }

  // 正常情况下不会执行到这里，因为Python失败会直接抛出错误
  // 保留此检查以防止意外情况
  console.error('[SpatialJobRunner] 意外到达代码末尾，应该已返回Python计算结果')
  throw new Error('空间计算服务异常：未返回有效结果')
}

// 以下Node.js执行器代码已全部删除（2026-02-17）
// 所有空间计算现在由Python服务处理
// 保留函数定义以便其他代码引用，但不执行任何逻辑
/**
 * @deprecated 此函数已废弃，空间计算现在完全由Python服务处理
 */
async function executeLegacyNodeExecutor(queryPlan, poiFeatures, options, reporter) {
  throw new Error('Node.js执行器已废弃，所有空间计算由Python服务处理')
}

/**
 * Narrative 任务主执行函数。
 * 可被 sync 路由直接调用，也可被 worker 消费。
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

  const report = {
    reportStage: reporter.reportStage || (async () => {}),
    reportProgress: reporter.reportProgress || (async () => {}),
    reportPartial: reporter.reportPartial || (async () => {}),
    reportText: reporter.reportText || (async () => {})
  }

  const migrationDecision = resolveSpatialMigrationDecision({
    requestId,
    queryPlan,
    options
  })

  await report.reportStage('executor', {
    route: migrationDecision.use_python_primary ? 'python_primary' : 'node_primary',
    migration: migrationDecision
  })

  const envelope = await computeSpatialWithFallback({
    requestId,
    queryPlan,
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
      migration: migrationDecision
    }
  }
}

export async function runNarrativeSpatialJob(payload, reporter = {}) {
  // reporter 全部允许空实现，便于多种调用场景。
  const report = {
    reportStage: reporter.reportStage || (async () => {}),
    reportProgress: reporter.reportProgress || (async () => {}),
    reportPartial: reporter.reportPartial || (async () => {}),
    reportText: reporter.reportText || (async () => {})
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  const poiFeatures = Array.isArray(payload?.poiFeatures) ? payload.poiFeatures : []
  const spatialContext = payload?.spatialContext || payload?.options?.spatialContext || {}
  const options = payload?.options || {}
  const requestId = payload?.request_id || randomUUID()

  const userQuestion = payload?.query || extractLastUserMessage(messages)
  if (!userQuestion) {
    throw new Error('Missing user question for spatial job')
  }

  // Greeting-only shortcut to keep chat panel responsive.
  if (isSmallTalkQuestion(userQuestion)) {
    const answer = '\u4f60\u597d\uff01\u6211\u5df2\u5728\u7ebf\u3002\u4f60\u53ef\u4ee5\u76f4\u63a5\u63d0\u95ee\u7a7a\u95f4\u95ee\u9898\uff0c\u4f8b\u5982\uff1a"\u4e1c\u4fa7\u5496\u5561\u5e97"\u3001"\u8fd9\u7247\u533a\u57df\u9910\u996e\u5206\u5e03"\u3002'

    await report.reportStage('smalltalk')
    await report.reportText(answer)
    await report.reportProgress(1, { stage: 'completed', mode: 'smalltalk' })

    return {
      success: true,
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
          cluster_count: 0
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
    poiCount: poiFeatures.length
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
      poiCount: poiFeatures.length,
      viewportCenter: getViewportCenter(spatialContext)
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

  const effectiveOptions = {
    ...options,
    selectedCategories: enforced.policy.selected_categories,
    sourcePolicy: {
      ...(options.sourcePolicy || {}),
      ...enforced.policy
    }
  }

  await report.reportProgress(0.12, {
    stage: 'planner_done',
    query_type: queryPlan.query_type,
    categories: queryPlan.categories || [],
    source_policy: enforced.policy
  })

  const shouldUseCache = shouldUseSpatialResultCache(queryPlan, effectiveOptions)
  const spatialCacheFingerprint = shouldUseCache
    ? buildSpatialCacheFingerprint(queryPlan, spatialContext, effectiveOptions)
    : null

  let normalizedExecutor = null
  let migrationDecision = null

  // 先尝试命中空间结果缓存，命中后跳过重计算阶段。
  if (shouldUseCache && spatialCacheFingerprint) {
    const cachedEnvelope = queryCache.getFromCache(spatialCacheFingerprint)
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
    }
  }

  // 缓存未命中时再走 Python 主路径 + Node 回退链路。
  if (!normalizedExecutor) {
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
      poiFeatures,
      reporter: report,
      migrationDecision
    })

    normalizedExecutor = normalizeExecutorEnvelope(executorEnvelope)

    if (shouldUseCache && spatialCacheFingerprint && normalizedExecutor.success !== false) {
      queryCache.setToCache(
        spatialCacheFingerprint,
        cloneForCache(normalizedExecutor),
        normalizeQueryType(queryPlan)
      )
    }
  }

  await report.reportProgress(0.72, {
    stage: 'executor_done',
    poi_count: Array.isArray(normalizedExecutor?.results?.pois)
      ? normalizedExecutor.results.pois.length
      : 0
  })

  // 阶段 3：Writer 组装回答
  await report.reportStage('writer')

  let answer = ''
  let textBuffer = ''

  const writerRuntimeOptions = {
    ...effectiveOptions,
    onWriterDiagnostics: (diagnostics) => {
      report.reportStage('writer_validation', diagnostics).catch(() => {})
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
    answer = buildQuickReply(normalizedExecutor)
    await report.reportText(answer)
  }

  await report.reportProgress(1, {
    stage: 'completed'
  })

  const finalResults = normalizedExecutor?.results || {}

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
        fast_path: plannerOutput?.fastPath || false
      },
      compute_mode: normalizedExecutor?.results?.stats?.cache_hit
        ? 'cache_hit'
        : resolveComputeMode(normalizedExecutor, migrationDecision),
      fallback_reasons: normalizedExecutor?._fallback_reasons || [],
      source_policy: effectiveOptions.sourcePolicy || null,
      migration: migrationDecision,
      cache_hit: Boolean(normalizedExecutor?.results?.stats?.cache_hit)
    }
  }
}

/**
 */
/**
 * 新 Jobs 结果 -> 旧 SSE 载荷映射。
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
  decideExecutionMode,
  executeSpatialPlanWithFallback,
  runNarrativeSpatialJob,
  toLegacySSEPayload
}
