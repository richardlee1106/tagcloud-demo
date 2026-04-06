import { buildSpatialGeometryEvidence } from '../retrieval/spatialEvidenceService.js'
import {
  buildSupportBucketMetrics,
  buildVerifiedSupportBucketMetrics,
  buildMacroCellSummary,
  buildMacroUncertainty,
  buildRepresentativePois,
  enrichSupportBucketsWithResults,
  normalizeMacroUncertainty,
  normalizeRepresentativePois,
  normalizeSupportBuckets,
  sortSupportBucketsForTask,
  summarizeSupportBuckets
} from '../spatial_core/ai/supportEvidenceUtils.js'

export const DEFAULT_SPATIAL_ANCHOR = Object.freeze({
  lon: 114.3055,
  lat: 30.5931,
  source: 'default'
})

const SPATIAL_KEYWORDS = [
  '附近',
  '周边',
  '周围',
  '哪里有',
  '在哪',
  '距离',
  '步行',
  '几公里',
  '多少米',
  '片区',
  '范围'
]

const DEICTIC_SPATIAL_REFERENCES = [
  '这里',
  '这儿',
  '这附近',
  '这个区域',
  '这片区域',
  '这片地方',
  '这一带',
  '当前区域',
  '当前视图',
  '选区',
  '图上',
  '地图上'
]

const SPATIAL_INTENT_VERBS = [
  '找',
  '查',
  '搜',
  '推荐',
  '有没有',
  '有什么',
  '哪里有',
  '在哪',
  '去哪',
  '分布',
  '密度',
  '周边',
  '附近',
  '距离'
]

const PURE_GREETING_RE = /^(你好|您好|嗨|hi|hello|hey|早上好|上午好|中午好|下午好|晚上好|在吗|哈喽)[!！？?~\s]*$/i

const ASSISTANT_META_QUERY_RE = /^(你是谁|你是做什么的|你是干嘛的|你叫什么|介绍一下你自己|介绍下你自己|你能做什么|你能干嘛|你能干什么|你都能做什么|你会什么|你会干嘛|你可以做什么|你能帮我什么|你可以帮我什么)(?:呀|啊|呢|嘛|吗)?[!！？?~\s]*$/i
const CATEGORY_HINT_RE = /(餐厅|饭店|美食|吃的|咖啡|奶茶|酒店|宾馆|民宿|景点|景区|公园|医院|学校|银行|超市|商场|健身|火锅|烧烤|酒吧|书店|便利店)/i

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function roundCoord(value, digits = 6) {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  return Number(numeric.toFixed(digits))
}

function toCoordinatePair(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const lon = toFiniteNumber(value[0])
    const lat = toFiniteNumber(value[1])
    if (lon !== null && lat !== null) {
      return [lon, lat]
    }
  }

  if (value && typeof value === 'object') {
    const lon = toFiniteNumber(value.lon ?? value.lng ?? value.longitude ?? value.x)
    const lat = toFiniteNumber(value.lat ?? value.latitude ?? value.y)
    if (lon !== null && lat !== null) {
      return [lon, lat]
    }
  }

  return null
}

function averageCoordinatePairs(pairs = []) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null

  const validPairs = pairs
    .map((item) => toCoordinatePair(item))
    .filter(Boolean)

  if (!validPairs.length) return null

  const totals = validPairs.reduce(
    (acc, [lon, lat]) => {
      acc.lon += lon
      acc.lat += lat
      return acc
    },
    { lon: 0, lat: 0 }
  )

  return {
    lon: roundCoord(totals.lon / validPairs.length),
    lat: roundCoord(totals.lat / validPairs.length)
  }
}

function normalizeBoundaryRing(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) return null

  const ring = boundary
    .map((coord) => toCoordinatePair(coord))
    .filter(Boolean)

  if (ring.length < 3) return null

  const [firstLon, firstLat] = ring[0]
  const [lastLon, lastLat] = ring[ring.length - 1]
  if (firstLon !== lastLon || firstLat !== lastLat) {
    ring.push([firstLon, firstLat])
  }

  return ring
}

function buildPolygonFromRing(ring) {
  if (!ring || ring.length < 4) return null
  return {
    type: 'Polygon',
    coordinates: [ring]
  }
}

function extractPoiCoordinates(poiFeatures = []) {
  return toArray(poiFeatures)
    .map((feature) => {
      const geometry = feature?.geometry
      if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
        return toCoordinatePair(geometry.coordinates)
      }
      return toCoordinatePair(feature)
    })
    .filter(Boolean)
}

function extractResultCoordinates(results = []) {
  return toArray(results)
    .map((item) => toCoordinatePair([item?.lon, item?.lat]))
    .filter(Boolean)
}

function normalizePoiPayload(results = []) {
  return toArray(results).map((item, index) => ({
    id: item?.id ?? `poi-${index + 1}`,
    name: item?.name || '未知地点',
    category: item?.category || '未分类',
    regionLabel: item?.regionLabel ?? null,
    lon: roundCoord(item?.lon),
    lat: roundCoord(item?.lat),
    distance_m: Math.round(toFiniteNumber(item?.distance_m) ?? 0),
    score: Number((toFiniteNumber(item?.fused_score) ?? 0).toFixed(4)),
    relevance_score: Number((toFiniteNumber(item?.semantic_score) ?? 0).toFixed(4)),
    spatial_score: Number((toFiniteNumber(item?.spatial_score) ?? 0).toFixed(4))
  }))
}

function normalizeStructuredAnchors(value = []) {
  if (!Array.isArray(value)) return []

  return value
    .map((item, index) => {
      const placeName = String(
        item?.placeName ||
        item?.place_name ||
        item?.displayName ||
        item?.display_name ||
        item?.name ||
        ''
      ).trim()
      if (!placeName) return null

      const displayName = String(item?.displayName || item?.display_name || placeName).trim() || placeName
      const role = String(
        item?.role ||
        (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
      ).trim() || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)

      return {
        place_name: placeName,
        display_name: displayName,
        role,
        index
      }
    })
    .filter(Boolean)
}

function normalizeComparisonRegions(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => {
      const anchor = item?.anchor && typeof item.anchor === 'object' ? item.anchor : {}
      const placeName = String(anchor?.place_name || anchor?.placeName || anchor?.display_name || anchor?.displayName || '').trim()
      if (!placeName) return null

      const macroCellSummary = buildMacroCellSummary(item, {
        sampleSize: item?.stats?.result_count ?? 0,
        comparisonMode: 'dual_anchor'
      })
      const representativePois = normalizeRepresentativePois(item?.representative_pois || item?.representativePois)
      const supportBuckets = sortSupportBucketsForTask(normalizeSupportBuckets(
        macroCellSummary.support_buckets.length > 0
          ? macroCellSummary.support_buckets
          : (item?.support_buckets || item?.supportBuckets)
      ), representativePois, {
        taskType: 'region_comparison'
      })
      const uncertainty = normalizeMacroUncertainty(item?.uncertainty, {
        supportBucketCount: supportBuckets.length,
        representativePoiCount: representativePois.length,
        sampleSize: item?.stats?.result_count ?? representativePois.length,
        comparisonMode: 'dual_anchor'
      })

      return {
        anchor: {
          place_name: placeName,
          display_name: String(anchor?.display_name || anchor?.displayName || placeName).trim() || placeName,
          role: String(
            anchor?.role ||
            (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
          ).trim() || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`),
          index: Number.isFinite(Number(anchor?.index)) ? Number(anchor.index) : index,
          lon: roundCoord(anchor?.lon),
          lat: roundCoord(anchor?.lat),
          source: anchor?.source || null,
          resolved_place_name: String(anchor?.resolved_place_name || anchor?.resolvedPlaceName || '').trim() || null
        },
        support_buckets: supportBuckets,
        support_bucket_metrics: buildVerifiedSupportBucketMetrics(
          supportBuckets,
          representativePois,
          { taskType: 'region_comparison' }
        ),
        representative_pois: representativePois,
        dominant_buckets: macroCellSummary.dominant_buckets,
        scene_tags: macroCellSummary.scene_tags,
        cell_mix: macroCellSummary.cell_mix,
        population_metrics: macroCellSummary.population_metrics,
        uncertainty,
        stats: {
          candidate_count: Number(item?.stats?.candidate_count) || 0,
          result_count: Number(item?.stats?.result_count) || representativePois.length,
          macro_cell_count: Number(item?.stats?.macro_cell_count) || 0,
          search_radius_m: Number(item?.stats?.search_radius_m) || 0
        }
      }
    })
    .filter(Boolean)
}

function normalizeModelUsageList(value = []) {
  return [...new Set(
    toArray(value)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )]
}

function buildModelRoutingSummary({
  intent = {},
  queryEmbedding = null,
  macroCellSearch = null,
  runtimeEnrichment = null,
  cellContextEnrichment = null
} = {}) {
  const taskType = String(intent?.taskType || intent?.answerType || 'nearby_lookup').trim()
  const macroModels = normalizeModelUsageList(macroCellSearch?.modelsUsed)
  const queryModels = normalizeModelUsageList(queryEmbedding?.modelUsage)
  const runtimeModels = normalizeModelUsageList(runtimeEnrichment?.modelsUsed)
  const cellModels = normalizeModelUsageList(cellContextEnrichment?.modelsUsed)
  const modelUsage = normalizeModelUsageList([...macroModels, ...queryModels, ...runtimeModels, ...cellModels])

  let primary = null
  if (macroCellSearch?.applied && macroModels.includes('town_encoder')) {
    primary = 'town_encoder'
  } else if (taskType !== 'nearby_lookup' && cellModels.includes('town_encoder')) {
    primary = 'town_encoder'
  } else if (queryModels.includes('poi_encoder') || runtimeModels.includes('poi_encoder')) {
    primary = 'poi_encoder'
  } else if (cellModels.includes('town_encoder')) {
    primary = 'town_encoder'
  } else if (modelUsage.length > 0) {
    primary = modelUsage[0]
  }

  const secondary = modelUsage.filter((item) => item !== primary)

  return {
    primary,
    secondary,
    usage: modelUsage
  }
}

function inferIntentMode({ intent = {}, userQuery = '', spatialContext = null, poiFeatures = [] }) {
  if (intent?.placeName) return 'local_search'
  if (poiFeatures.length > 0) return 'local_search'
  if (spatialContext?.center || Array.isArray(spatialContext?.boundary)) return 'local_search'
  if (SPATIAL_KEYWORDS.some((keyword) => userQuery.includes(keyword))) return 'local_search'
  return 'macro_overview'
}

function inferQueryType({ intent = {}, userQuery = '' }) {
  if (intent?.placeName || intent?.category) return 'poi_search'
  if (SPATIAL_KEYWORDS.some((keyword) => userQuery.includes(keyword))) return 'area_analysis'
  return 'general_qa'
}

export function isPureGreetingQuery(userQuery = '') {
  return PURE_GREETING_RE.test(String(userQuery || '').trim())
}

export function isAssistantMetaQuery(userQuery = '') {
  return ASSISTANT_META_QUERY_RE.test(String(userQuery || '').trim())
}

export function buildGeneralReasoningOutline({ userQuery = '', isGreeting = false, isAssistantMeta = false } = {}) {
  if (isGreeting) {
    return '这是一次普通问候。我会直接用简短、友好的方式回应，不进入空间检索。'
  }

  if (isAssistantMeta) {
    return '这是一次助手身份/能力问答。我会直接用确定性的简洁说明回答，不调用空间检索，也不依赖开放式生成。'
  }

  const safeQuery = String(userQuery || '').trim()
  if (!safeQuery) {
    return '这是一次普通对话。我会直接整理回答，不调用空间检索链路。'
  }

  return '这是一次普通对话。我会先理解你的表达重点，再直接给出简洁回答，不额外展开空间证据。'
}

export function buildGreetingReply(userQuery = '') {
  const safeQuery = String(userQuery || '').trim()
  if (!isPureGreetingQuery(safeQuery)) return ''
  return '你好！很高兴见到你，有什么我可以帮你的吗？'
}

export function buildAssistantMetaReply(userQuery = '') {
  const safeQuery = String(userQuery || '').trim()
  if (!isAssistantMetaQuery(safeQuery)) return ''

  if (/^(你是谁|你叫什么|介绍一下你自己|介绍下你自己|你是做什么的|你是干嘛的)(?:呀|啊|呢|嘛|吗)?[!！？?~\s]*$/i.test(safeQuery)) {
    return '你好！我是武汉三镇的地理智能助手，主要帮你查询武汉范围内的地点、交通、周边设施和空间分布信息。'
  }

  return '我可以帮你查武汉范围内的地点、附近有什么、地铁和公交、餐饮和酒店，也可以结合当前地图范围做附近检索、片区观察和空间分析。你可以直接问我，比如“湖北大学附近有哪些地铁站？”。'
}

export function buildSpatialReasoningOutline({ intent = {}, spatialContext = null } = {}) {
  const hasCustomArea = Boolean(
    (Array.isArray(spatialContext?.boundary) && spatialContext.boundary.length >= 3) ||
    (Array.isArray(spatialContext?.regions) && spatialContext.regions.length > 0)
  )
  const requestedCategory = intent?.poiSubType || intent?.category || ''
  const taskType = String(intent?.taskType || intent?.answerType || 'nearby_lookup').trim()
  const analysisFacets = intent?.analysisFacets && typeof intent.analysisFacets === 'object'
    ? intent.analysisFacets
    : {}

  const scopeText = hasCustomArea
    ? '我会优先参考你当前圈定的区域'
    : intent?.placeName
      ? `我会围绕“${intent.placeName}”附近展开检索`
      : intent?.anchorMode === 'context'
        ? '我会优先结合当前地图视图理解你的空间需求'
        : '我会结合当前地图范围理解你的空间需求'

  if (taskType === 'support_gap_analysis') {
    const focusLabels = []
    if (analysisFacets.supportingFacilities !== false) focusLabels.push('配套现状')
    if (analysisFacets.hotCategories !== false) focusLabels.push('热门业态')
    if (analysisFacets.gaps !== false) focusLabels.push('明显缺口')
    return `${scopeText}，我会先梳理${focusLabels.join('、')}，再基于当前命中的空间证据总结结论。`
  }

  if (taskType === 'site_suitability') {
    return `${scopeText}，我会先判断现有业态底色，再推断这里更适合补哪些功能。`
  }

  if (taskType === 'region_comparison') {
    return `${scopeText}，我会尽量提炼各区域的差异点，再整理成可比较的结论。`
  }

  if (taskType === 'area_overview') {
    return `${scopeText}，我会先概括整体空间结构，再总结主要业态和片区特征。`
  }

  const categoryText = requestedCategory
    ? `重点筛选和“${requestedCategory}”相关的地点`
    : '优先保留与你问题最相关的地点'

  return `${scopeText}，${categoryText}，最后再整理成容易理解的回答。`
}

export function isLikelySpatialIntent({
  userQuery = '',
  intent = {},
  poiFeatures = [],
  spatialContext = null
} = {}) {
  const safeQuery = String(userQuery || '').trim()
  if (!safeQuery) return false

  const hasSpatialKeyword = SPATIAL_KEYWORDS.some((keyword) => safeQuery.includes(keyword))
  const hasDeicticSpatialReference = DEICTIC_SPATIAL_REFERENCES.some((keyword) => safeQuery.includes(keyword))
  const hasSpatialIntentVerb = SPATIAL_INTENT_VERBS.some((keyword) => safeQuery.includes(keyword))
  const hasCategoryHint = CATEGORY_HINT_RE.test(safeQuery)
  const hasMapContext = Boolean(
    (spatialContext && typeof spatialContext === 'object' && (
      spatialContext.center ||
      spatialContext.viewport ||
      (Array.isArray(spatialContext.boundary) && spatialContext.boundary.length >= 3) ||
      (Array.isArray(spatialContext.regions) && spatialContext.regions.length > 0)
    )) ||
    (Array.isArray(poiFeatures) && poiFeatures.length > 0)
  )

  if (isPureGreetingQuery(safeQuery) || isAssistantMetaQuery(safeQuery)) {
    return false
  }

  if (hasMapContext && hasDeicticSpatialReference) {
    return true
  }

  if (hasSpatialKeyword) {
    return true
  }

  const queryLooksLikeSearch = hasSpatialIntentVerb || hasDeicticSpatialReference

  if (intent && typeof intent === 'object') {
    if (intent.placeName && queryLooksLikeSearch) return true
    if (intent.regionLabel !== null && intent.regionLabel !== undefined && queryLooksLikeSearch) return true
    if (intent.category && (queryLooksLikeSearch || hasMapContext || hasCategoryHint)) return true
  }

  return false
}

export function deriveSpatialAnchor({
  poiFeatures = [],
  spatialContext = null,
  fallbackAnchor = DEFAULT_SPATIAL_ANCHOR
} = {}) {
  const fallback = {
    lon: roundCoord(fallbackAnchor?.lon ?? DEFAULT_SPATIAL_ANCHOR.lon),
    lat: roundCoord(fallbackAnchor?.lat ?? DEFAULT_SPATIAL_ANCHOR.lat),
    source: fallbackAnchor?.source || DEFAULT_SPATIAL_ANCHOR.source
  }

  const center = toCoordinatePair(spatialContext?.center)
  if (center) {
    return {
      lon: roundCoord(center[0]),
      lat: roundCoord(center[1]),
      source: 'spatial_context.center'
    }
  }

  const boundaryRing = normalizeBoundaryRing(spatialContext?.boundary)
  const boundaryCenter = averageCoordinatePairs(boundaryRing)
  if (boundaryCenter) {
    return {
      ...boundaryCenter,
      source: 'spatial_context.boundary'
    }
  }

  if (Array.isArray(spatialContext?.viewport) && spatialContext.viewport.length >= 4) {
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport
    const viewportCenter = averageCoordinatePairs([
      [minLon, minLat],
      [maxLon, maxLat]
    ])
    if (viewportCenter) {
      return {
        ...viewportCenter,
        source: 'spatial_context.viewport'
      }
    }
  }

  const poiCenter = averageCoordinatePairs(extractPoiCoordinates(poiFeatures))
  if (poiCenter) {
    return {
      ...poiCenter,
      source: 'poi_features.centroid'
    }
  }

  return fallback
}

export function buildSpatialEvidence({
  traceId,
  userQuery,
  intent = {},
  anchor = DEFAULT_SPATIAL_ANCHOR,
  candidateResults = [],
  filteredResults = [],
  spatialContext = null,
  poiFeatures = [],
  queryEmbedding = null,
  macroCellSearch = null,
  runtimeEnrichment = null,
  cellContextEnrichment = null,
  routeExecutor = null,
  comparisonRegions = [],
  surfaceContext = null,
  surfaceConstraint = null
} = {}) {
  const pois = normalizePoiPayload(filteredResults)
  const explicitBoundary = buildPolygonFromRing(normalizeBoundaryRing(spatialContext?.boundary))
  const geometryEvidence = buildSpatialGeometryEvidence({
    filteredResults,
    explicitBoundary,
    anchor,
    surfaceContext,
    surfaceConstraint
  })

  const boundary = geometryEvidence.boundary
  const hotspotCenter =
    averageCoordinatePairs(extractResultCoordinates(filteredResults)) ||
    averageCoordinatePairs(extractPoiCoordinates(poiFeatures)) ||
    { lon: anchor.lon, lat: anchor.lat }

  const spatialClusters = geometryEvidence.spatialClusters || { hotspots: [] }
  if (Array.isArray(spatialClusters.hotspots) && spatialClusters.hotspots.length === 0 && filteredResults.length) {
    spatialClusters.hotspots = [
      {
        id: 'hotspot-1',
        name: intent?.placeName ? `${intent.placeName}周边` : '空间热点',
        poiCount: filteredResults.length,
        center: [hotspotCenter.lon, hotspotCenter.lat],
        dominant_categories: [],
        boundary,
        boundary_confidence: geometryEvidence.avgBoundaryConfidence || 0.64
      }
    ]
  }

  const vernacularRegions = geometryEvidence.vernacularRegions || []
  const fuzzyRegions = geometryEvidence.fuzzyRegions || []
  const queryType = inferQueryType({ intent, userQuery })
  const intentMode = inferIntentMode({ intent, userQuery, spatialContext, poiFeatures })
  const requestedCategory = intent?.poiSubType || intent?.category || null
  const effectiveRadiusM = intent?.searchRadiusM || intent?.radiusM || 500
  const taskType = String(intent?.taskType || intent?.answerType || 'nearby_lookup').trim()
  const answerType = String(intent?.answerType || taskType || 'nearby_lookup').trim()
  const anchorMode = String(intent?.anchorMode || (intent?.placeName ? 'explicit_place' : 'unknown')).trim()
  const analysisFacets = intent?.analysisFacets && typeof intent.analysisFacets === 'object'
    ? intent.analysisFacets
    : {}
  const structuredAnchors = normalizeStructuredAnchors(intent?.anchors || intent?.comparisonAnchors)
  const structuredComparisonRegions = normalizeComparisonRegions(comparisonRegions)
  const comparisonMode = taskType === 'region_comparison'
    ? (structuredAnchors.length >= 2 ? 'dual_anchor' : 'single_anchor')
    : null
  const modelRouting = buildModelRoutingSummary({
    intent,
    queryEmbedding,
    macroCellSearch,
    runtimeEnrichment,
    cellContextEnrichment
  })
  const macroCellSummary = buildMacroCellSummary(macroCellSearch, {
    sampleSize: filteredResults.length,
    comparisonMode,
    modelRoutePrimary: modelRouting.primary,
    modelUsage: modelRouting.usage
  })
  const representativePois = buildRepresentativePois(filteredResults)
  const supportBuckets = macroCellSummary.support_buckets.length > 0
    ? macroCellSummary.support_buckets
    : summarizeSupportBuckets(filteredResults)
  const enrichedSupportBuckets = enrichSupportBucketsWithResults(supportBuckets, filteredResults)
  const evidenceSupportBuckets = sortSupportBucketsForTask(enrichedSupportBuckets, representativePois, {
    taskType
  })
  const supportBucketMetrics = macroCellSummary.support_bucket_metrics.length > 0
    ? macroCellSummary.support_bucket_metrics
    : buildSupportBucketMetrics(evidenceSupportBuckets)
  const populationMetrics = macroCellSummary.population_metrics
  const defaultUncertainty = buildMacroUncertainty({
    sampleSize: filteredResults.length,
    supportBucketCount: evidenceSupportBuckets.length,
    representativePoiCount: representativePois.length,
    avgBoundaryConfidence: geometryEvidence.avgBoundaryConfidence,
    comparisonMode,
    vectorConstraintSource: geometryEvidence.vectorConstraintSummary?.source || null,
    modelRouting
  })
  const uncertainty = normalizeMacroUncertainty(macroCellSummary.uncertainty, {
    boundaryConfidence: defaultUncertainty.boundary_confidence,
    comparisonMode: defaultUncertainty.comparison_mode,
    vectorConstraintSource: defaultUncertainty.vector_constraint_source,
    supportBucketCount: evidenceSupportBuckets.length,
    representativePoiCount: representativePois.length,
    sampleSize: defaultUncertainty.sample_size,
    modelRoutePrimary: defaultUncertainty.model_route_primary,
    modelUsage: defaultUncertainty.model_usage
  })
  const queryPlan = {
    query_type: queryType,
    intent_mode: intentMode,
    anchor: intent?.placeName || structuredAnchors[0]?.place_name || null,
    anchors: structuredAnchors,
    categories: requestedCategory ? [requestedCategory] : [],
    subcategory: intent?.poiSubType || null,
    radius_m: effectiveRadiusM,
    task_type: taskType,
    answer_type: answerType,
    anchor_mode: anchorMode,
    analysis_facets: analysisFacets,
    comparison_mode: comparisonMode
  }

  const stats = {
    trace_id: traceId || null,
    candidate_count: candidateResults.length,
    result_count: filteredResults.length,
    radius_m: effectiveRadiusM,
    anchor_source: anchor?.source || DEFAULT_SPATIAL_ANCHOR.source,
    anchor_lon: roundCoord(anchor?.lon),
    anchor_lat: roundCoord(anchor?.lat),
    query_type: queryType,
    intent_mode: intentMode,
    requested_subcategory: intent?.poiSubType || null,
    task_type: taskType,
    answer_type: answerType,
    anchor_mode: anchorMode,
    analysis_facets: analysisFacets,
    comparison_anchor_count: structuredAnchors.length,
    comparison_mode: comparisonMode,
    comparison_region_count: structuredComparisonRegions.length,
    avg_boundary_confidence: geometryEvidence.avgBoundaryConfidence,
    boundary_confidence_model: geometryEvidence.boundaryConfidenceModel,
    boundary_source: geometryEvidence.boundarySource,
    boundary_generation_method: geometryEvidence.boundaryMethod,
    boundary_generation_point_count: geometryEvidence.boundaryPointCount,
    boundary_signal_model: geometryEvidence.signalModel,
    encoder_dominant_region_label: geometryEvidence.dominantRegionLabel,
    encoder_region_purity: geometryEvidence.encoderRegionPurity,
    encoder_score_mean: geometryEvidence.encoderScoreMean,
    encoder_core_point_count: geometryEvidence.encoderCorePointCount,
    encoder_transition_point_count: geometryEvidence.encoderTransitionPointCount,
    encoder_region_predicted_count: geometryEvidence.encoderRegionPredictedCount,
    encoder_region_high_confidence_count: geometryEvidence.encoderRegionHighConfidenceCount,
    encoder_region_alignment_rate: geometryEvidence.encoderRegionAlignmentRate,
    vector_constraint_source: geometryEvidence.vectorConstraintSummary?.source || null,
    vector_constraint_selected_count: geometryEvidence.vectorConstraintSummary?.selected_count || 0,
    vector_constraint_rejected_count: geometryEvidence.vectorConstraintSummary?.rejected_count || 0,
    query_embedding_applied: queryEmbedding?.applied === true,
    query_embedding_source: queryEmbedding?.source || null,
    query_embedding_feature_source: queryEmbedding?.components?.anchor?.featureSource || null,
    macro_cell_search_applied: macroCellSearch?.applied === true,
    macro_cell_search_reason: macroCellSearch?.reason || null,
    macro_cell_count: Array.isArray(macroCellSearch?.cells) ? macroCellSearch.cells.length : 0,
    macro_dominant_bucket_count: macroCellSummary.dominant_buckets.length,
    macro_scene_tag_count: macroCellSummary.scene_tags.length,
    macro_cell_mix_count: macroCellSummary.cell_mix.length,
    route_executor: routeExecutor?.name || null,
    route_executor_reason: routeExecutor?.reason || null,
    runtime_enrichment_applied: runtimeEnrichment?.applied === true,
    runtime_enrichment_reason: runtimeEnrichment?.reason || null,
    cell_context_applied: cellContextEnrichment?.applied === true,
    cell_context_reason: cellContextEnrichment?.reason || null,
    model_route_primary: modelRouting.primary,
    model_route_secondary: modelRouting.secondary,
    model_usage: modelRouting.usage,
    support_bucket_count: evidenceSupportBuckets.length,
    representative_poi_count: representativePois.length,
    evidence_density: uncertainty.evidence_density,
    low_sample_warning: uncertainty.low_sample_warning,
    hotspot_count: Array.isArray(spatialClusters.hotspots) ? spatialClusters.hotspots.length : 0,
    vernacular_region_count: vernacularRegions.length,
    fuzzy_region_count: fuzzyRegions.length
  }

  const refinedResult = {
    trace_id: traceId || null,
    schema_version: 'v3.1',
    capabilities: ['pois', 'boundary', 'spatial_clusters', 'stats', 'refined_result', 'reasoning'],
    query_plan: queryPlan,
    results: {
      boundary,
      spatial_clusters: spatialClusters,
      vernacular_regions: vernacularRegions,
      fuzzy_regions: fuzzyRegions,
      support_buckets: evidenceSupportBuckets,
      support_bucket_metrics: supportBucketMetrics,
      representative_pois: representativePois,
      population_metrics: populationMetrics,
      comparison_regions: structuredComparisonRegions,
      macro_cell_summary: {
        support_buckets: macroCellSummary.support_buckets,
        support_bucket_metrics: supportBucketMetrics,
        dominant_buckets: macroCellSummary.dominant_buckets,
        scene_tags: macroCellSummary.scene_tags,
        cell_mix: macroCellSummary.cell_mix,
        population_metrics: populationMetrics,
        uncertainty: uncertainty
      },
      uncertainty,
      stats
    }
  }

  return {
    pois,
    boundary,
    spatialClusters,
    vernacularRegions,
    fuzzyRegions,
    supportBuckets: evidenceSupportBuckets,
    supportBucketMetrics,
    representativePois,
    populationMetrics,
    comparisonRegions: structuredComparisonRegions,
    macroCellSummary: {
      support_buckets: macroCellSummary.support_buckets,
      support_bucket_metrics: supportBucketMetrics,
      dominant_buckets: macroCellSummary.dominant_buckets,
      scene_tags: macroCellSummary.scene_tags,
      cell_mix: macroCellSummary.cell_mix,
      population_metrics: populationMetrics,
      uncertainty
    },
    uncertainty,
    stats,
    queryPlan,
    refinedResult
  }
}

export default {
  DEFAULT_SPATIAL_ANCHOR,
  buildSpatialEvidence,
  buildGreetingReply,
  buildAssistantMetaReply,
  buildGeneralReasoningOutline,
  buildSpatialReasoningOutline,
  deriveSpatialAnchor,
  isAssistantMetaQuery,
  isPureGreetingQuery,
  isLikelySpatialIntent
}
