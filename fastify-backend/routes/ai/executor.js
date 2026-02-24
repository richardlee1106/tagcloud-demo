/**
 * 阶段 2: Executor (执行器)
 * 
 * 职责：
 * - 完全委托给Python服务进行空间计算
 * - 不再执行任何Node.js空间计算逻辑
 * - 绝不调用 LLM
 * 
 * 重构说明 (2026-02-17):
 * - executorȫռPython߼
 * - 所有空间计算由Python gRPC服务处理
 * - 保留此文件仅作为API入口和结果归一化
 * - Python服务不可用时直接返回错误，不再回退到Node.js
 */

import { computeSpatialStream, isGrpcComputeEnabled } from '../../services/grpcClient.js'
import { normalizeSelectedCategories } from '../../services/sourcePolicy.js'

// ============================================
// 辅助函数
// ============================================

const PYTHON_EXECUTOR_QUERY_TYPES = new Set(['poi_search', 'area_analysis', 'graph_reasoning', 'region_comparison'])
const PYTHON_EXECUTOR_ADVANCED_TYPES = new Set(['area_analysis', 'graph_reasoning', 'region_comparison', 'fuzzy_regions', 'vernacular_region'])

function resolveExecutorExecutionProfile(queryType = 'poi_search') {
  return PYTHON_EXECUTOR_ADVANCED_TYPES.has(queryType) ? 'advanced' : 'core'
}

function normalizeExecutorRegions(rawRegions = []) {
  if (!Array.isArray(rawRegions)) return []
  
  return rawRegions
    .filter((region) => region && typeof region === 'object')
    .map((region) => ({
      ...region,
      id: region.id ?? region.regionId ?? region.name ?? null
    }))
    .filter((region) => region.id !== null && region.id !== undefined && String(region.id).trim())
}

function resolveTargetRegionIds(queryPlan = {}, regions = []) {
  if (Array.isArray(queryPlan?.target_regions) && queryPlan.target_regions.length > 0) {
    return queryPlan.target_regions
  }
  
  return regions
    .map((region) => region.id)
    .filter((id) => id !== null && id !== undefined && String(id).trim())
}

function buildGraphAnalysisFromSummary(graphSummary = null) {
  if (!graphSummary || typeof graphSummary !== 'object') return null

  const edgeCount = Number(graphSummary.edge_count || 0)
  const avgDegree = Number(graphSummary.avg_degree || 0)
  const componentCount = Number(graphSummary.component_count || 0)
  const topHubs = Array.isArray(graphSummary.top_hubs) ? graphSummary.top_hubs : []

  const hubs = topHubs.map((hub, index) => ({
    representativePOI: hub?.name || `Hub-${index + 1}`,
    mainCategory: hub?.category || 'mixed',
    pageRank: Number.isFinite(edgeCount) && edgeCount > 0
      ? Math.min(1, Math.max(0, Number(hub?.degree || 0) / edgeCount))
      : 0,
    degree: Number(hub?.degree || 0)
  }))

  const insights = []
  if (componentCount > 1) {
    insights.push({ text: `Spatial graph has ${componentCount} connected components.` })
  }
  if (avgDegree > 0) {
    insights.push({ text: `Average degree is ${avgDegree.toFixed(2)}.` })
  }

  return {
    global: {
      totalGrids: componentCount,
      totalConnections: edgeCount,
      avgConnectivity: Number(avgDegree.toFixed(2))
    },
    hubs,
    bridges: [],
    communities: [],
    insights
  }
}

function normalizeExecutorCategories(rawCategories = []) {
  return normalizeSelectedCategories(rawCategories)
}

// ============================================
// 核心逻辑
// ============================================

/**
 * 判断是否应该使用Python执行器
 * عĿ꣺executorȫռPython߼
 * 强制使用Python服务，不再有Node.js回退
 */
export function shouldUsePythonExecutor(queryPlan = {}, options = {}) {
  if (options?.skipPythonExecutor === true) return false
  if (options?.forceLocalExecutor === true) return false
  // 保留forceNodeFallback用于测试和调试场景
  if (options?.forceNodeFallback === true) {
    console.log('[Executor] 调试模式：强制使用Node.js回退')
    return false
  }

  // spatialJobRunner 已负责灰度和回退，executor 不重复分流
  if (options?.migrationDecision) return false

  // 检查gRPC服务是否启用
  if (!isGrpcComputeEnabled()) {
    console.warn('[Executor] gRPC计算未启用，请检查SPATIAL_GRPC_ENABLED配置')
    return false
  }

  const queryType = String(queryPlan?.query_type || 'poi_search').toLowerCase()
  // 所有空间计算相关的query_type都强制使用Python
  return PYTHON_EXECUTOR_QUERY_TYPES.has(queryType) || queryType === 'area_analysis'
}

function serializeExecutorCandidates(frontendPOIs = [], options = {}) {
  const pyDataSource = String(options?.pyDataSource || process.env.SPATIAL_PY_DATA_SOURCE || 'python').toLowerCase()

  // Python 直查模式不传 candidates，避免 gRPC 负载过大
  if (pyDataSource === 'python') return ''
  if (!Array.isArray(frontendPOIs) || frontendPOIs.length === 0) return ''
  if (frontendPOIs.length > 2000) return ''

  try {
    return JSON.stringify(frontendPOIs)
  } catch {
    return ''
  }
}

/**
 * 归一化Python执行器返回的结果
 */
export function normalizePythonExecutorResult(rawPayload = {}) {
  const rawResult = (rawPayload?.results && typeof rawPayload.results === 'object')
    ? rawPayload.results
    : (rawPayload && typeof rawPayload === 'object' ? rawPayload : null)

  if (!rawResult || typeof rawResult !== 'object') {
    return null
  }

  const safeStats = rawResult.stats && typeof rawResult.stats === 'object'
    ? { ...rawResult.stats }
    : {}

  const graphReasoning = rawResult.graph_reasoning && typeof rawResult.graph_reasoning === 'object'
    ? rawResult.graph_reasoning
    : null
  const graphAnalysis = rawResult.graph_analysis && typeof rawResult.graph_analysis === 'object'
    ? rawResult.graph_analysis
    : buildGraphAnalysisFromSummary(graphReasoning)

  return {
    ...rawResult,
    mode: rawResult.mode || 'python-spatial',
    anchor: rawResult.anchor ?? null,
    pois: Array.isArray(rawResult.pois) ? rawResult.pois : [],
    boundary: rawResult.boundary ?? null,
    area_profile: rawResult.area_profile ?? null,
    landmarks: Array.isArray(rawResult.landmarks) ? rawResult.landmarks : [],
    spatial_clusters: rawResult.spatial_clusters || { hotspots: [] },
    target_regions: Array.isArray(rawResult.target_regions) ? rawResult.target_regions : [],
    region_analyses: Array.isArray(rawResult.region_analyses) ? rawResult.region_analyses : [],
    comparison: rawResult.comparison ?? null,
    error: rawResult.error ?? null,
    vernacular_regions: Array.isArray(rawResult.vernacular_regions) ? rawResult.vernacular_regions : [],
    fuzzy_regions: Array.isArray(rawResult.fuzzy_regions) ? rawResult.fuzzy_regions : [],
    fuzzy_summary: rawResult.fuzzy_summary || { core: 0, transition: 0, periphery: 0 },
    graph_reasoning: graphReasoning,
    graph_analysis: graphAnalysis,
    stats: safeStats
  }
}

/**
 * 尝试通过Python服务执行查询
 */
export async function tryExecuteQueryViaPython(queryPlan, frontendPOIs, options = {}) {
  if (!shouldUsePythonExecutor(queryPlan, options)) {
    return null
  }

  const queryType = String(queryPlan?.query_type || 'poi_search').toLowerCase()
  const spatialContext = options.spatialContext || options.context || {}
  const categories = normalizeExecutorCategories(queryPlan?.categories)

  const maxFetchLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || '20000', 10)
  const defaultLimit = queryType === 'area_analysis'
    ? Math.min(20000, maxFetchLimit)
    : Math.min(8000, maxFetchLimit)
  const requestedLimit = Number(options?.limit)
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), maxFetchLimit))
    : defaultLimit

  const regions = normalizeExecutorRegions(
    Array.isArray(options?.regions)
      ? options.regions
      : (Array.isArray(spatialContext?.regions) ? spatialContext.regions : [])
  )

  const sourcePolicy = options?.sourcePolicy || {}
  const pyDataSource = String(options?.pyDataSource || process.env.SPATIAL_PY_DATA_SOURCE || 'python').toLowerCase()
  const executionProfile = resolveExecutorExecutionProfile(queryType)
  const requestId = options.requestId || `executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Python 需要 query_plan 包含所有必要信息
  const pythonQueryPlan = { ...(queryPlan || {}) }
  // graph_reasoning 需要标志位让 pipeline 加载图数据
  if (queryType === 'graph_reasoning') {
    pythonQueryPlan.need_graph_reasoning = true
  }
  // region_comparison 需要 planner 传递的 target_regions 参数
  if (queryType === 'region_comparison') {
    pythonQueryPlan.target_regions = resolveTargetRegionIds(pythonQueryPlan, regions)
  }

  try {
    let finalPayload = null

    await computeSpatialStream(
      {
        request_id: requestId,
        query_type: queryType,
        spatial_context: JSON.stringify(spatialContext || {}),
        categories,
        hints: JSON.stringify({
          query_plan: pythonQueryPlan,
          semantic_query: pythonQueryPlan?.semantic_query || queryPlan?.semantic_query || '',
          options: {
            sourcePolicy,
            selectedCategories: options?.selectedCategories || [],
            regions,
            limit: safeLimit,
            maxFetchLimit,
            screenshot_base64: options?.screenshotBase64 || null
          },
          migration: {
            py_data_source: pyDataSource,
            execution_profile: executionProfile
          }
        }),
        mode: options?.mode || 'sync',
        candidates_json: serializeExecutorCandidates(frontendPOIs, { pyDataSource }),
        execution_profile: executionProfile,
        dry_run: false
      },
      async (event) => {
        if (event.type === 'ERROR') {
          throw new Error(event.payload?.message || 'Python executor returned ERROR event')
        }

        if (event.type === 'FINAL') {
          finalPayload = event.payload
        }
      }
    )

    const normalizedResult = normalizePythonExecutorResult(finalPayload)
    if (!normalizedResult) {
      throw new Error('Python executor returned empty FINAL payload')
    }

    const finalDiagnostics = finalPayload?.diagnostics && typeof finalPayload.diagnostics === 'object'
      ? finalPayload.diagnostics
      : null

    normalizedResult.stats = {
      ...normalizedResult.stats,
      executor_engine: 'python_grpc',
      fetch_limit: safeLimit,
      execution_profile: executionProfile,
      source_policy: sourcePolicy,
      python_diagnostics: finalDiagnostics
    }

    console.log(`[Executor] Python 主路径命中: ${queryType}, POI=${normalizedResult.pois.length}`)
    return normalizedResult
  } catch (error) {
    // Python 路径失败不再回退到 Node，直接抛出错误
    console.error(`[Executor] Python 执行失败: ${error.message}`)
    throw error
  }
}

// ============================================
// 主入口
// ============================================

/**
 * Executor 主入口
 * - 完全委托给Python服务进行空间计算
 * - Python不可用时直接返回错误，不再回退到Node.js
 */
export async function executeQuery(queryPlan, frontendPOIs = [], options = {}) {
  const startTime = Date.now()
  
  console.log(`[Executor] 开始执行: ${queryPlan?.query_type || 'unknown'}`)
  
  // 检查是否应该使用Python执行器
  if (!shouldUsePythonExecutor(queryPlan, options)) {
    // 不使用Python执行器的情况（包括调试模式forceNodeFallback）
    // ֱӷشΪexecutorִκοռ߼
    console.warn('[Executor] 不适合使用Python执行器，但executor不再执行Node.js空间计算')
    throw new Error('此查询类型不支持空间计算')
  }

  try {
    // 直接调用Python服务，不再有Node.js回退
    const result = await tryExecuteQueryViaPython(queryPlan, frontendPOIs, {
      ...options,
      spatialContext: options.spatialContext,
      regions: options.regions || (options.spatialContext?.regions || []),
      requestId: options.requestId
    })

    if (!result) {
      throw new Error('Python执行器返回空结果')
    }

    result.stats = {
      ...result.stats,
      execution_time_ms: Date.now() - startTime
    }

    console.log(`[Executor] 执行完成: ${result.pois?.length || 0} POIs, ${result.stats.execution_time_ms}ms`)
    return result
    
  } catch (error) {
    console.error(`[Executor] 执行失败: ${error.message}`)
    // 直接抛出错误，不再回退到Node.js
    throw new Error(`空间计算服务暂时不可用: ${error.message}`)
  }
}

export default {
  executeQuery,
  shouldUsePythonExecutor,
  tryExecuteQueryViaPython,
  normalizePythonExecutorResult
}
