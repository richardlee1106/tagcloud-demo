import {
  DEFAULT_SPATIAL_ANCHOR,
  buildSpatialEvidence,
  deriveSpatialAnchor
} from '../../ai/chatPipeline.js'
import { getIndexStatus, faissHybridSearch } from '../../retrieval/faissIndex.js'
import {
  filterCandidatesWithSmallLLM,
  inferPoiSubTypeFromQueryText,
  parseIntent
} from '../ai/intentService.js'
import {
  enrichResultsWithCellContext,
  enrichResultsWithSpatialEncoder,
  searchMacroCellsWithTownEncoder
} from '../../retrieval/runtimeSpatialAugmenter.js'
import {
  executeDedicatedComparisonTask,
  executeDedicatedMacroTask,
  isDedicatedComparisonTask,
  isDedicatedMacroTask
} from './macroTaskExecutor.js'
import { selectVectorConstraintContext } from '../../retrieval/spatialEvidenceService.js'
import { buildSurfaceQueryWkt, fetchSurfaceContext, refineSurfaceConstraintGeometry } from '../../data/surfaceDataService.js'
import { buildSpatialQueryEmbedding, buildQueryEmbeddingSearchOptions } from '../../retrieval/queryEmbeddingService.js'
import { quickSearchPois } from '../../data/frontendDataService.js'

// Deprecated rule-line orchestrator: kept as the old spatial route while planner_line is introduced.

function normalizeSearchText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[()（）[\]【】·\-—_.,，。:：;；\s]/g, '')
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasFiniteCoordinate(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function hasAnchorCoordinates(anchor = null) {
  return hasFiniteCoordinate(anchor?.lon) && hasFiniteCoordinate(anchor?.lat)
}

function hasExplicitRadiusConstraint(userQuery = '') {
  return /(?:\d+(?:\.\d+)?)\s*(?:公里|千米|km|米|m)\b/i.test(String(userQuery || ''))
}

function buildAdaptiveRadiusPlan(userQuery = '', intent = {}) {
  if (hasExplicitRadiusConstraint(userQuery)) return []

  const baseRadius = Math.max(300, Number(intent?.radiusM) || 500)
  const plan = []

  if (baseRadius < 800) plan.push(800)
  if (baseRadius < 1200) plan.push(1200)

  return [...new Set(plan.filter((radius) => radius > baseRadius))]
}

const MIN_ADAPTIVE_RESULT_COUNT = 8

function ensureArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function buildMacroCellSearchAnchor(cell = {}, index = 0) {
  return {
    lon: Number(cell?.lon),
    lat: Number(cell?.lat),
    source: cell?.cell_id
      ? `town_cell_search:${cell.cell_id}`
      : `town_cell_search:${index + 1}`
  }
}

function buildMacroCellBoostedCandidate(candidate = {}, cell = {}, searchAnchor = null) {
  const cellScore = Math.max(0, Math.min(1, Number(cell?.search_score ?? cell?.similarity ?? 0)))
  const baseFusedScore = toFiniteNumber(candidate?.fused_score) || 0

  return {
    ...candidate,
    fused_score: Number((baseFusedScore + cellScore * 0.18).toFixed(6)),
    macro_cell_context: {
      cell_id: cell?.cell_id || null,
      search_score: cellScore,
      similarity: toFiniteNumber(cell?.similarity),
      distance_m: toFiniteNumber(cell?.distance_m),
      region_idx: cell?.region_idx ?? null,
      region_name: cell?.region_name || null,
      anchor_source: searchAnchor?.source || null
    }
  }
}

function mergeMacroCellCandidates(resultsByCell = []) {
  const mergedById = new Map()

  for (const { cell, searchAnchor, candidates } of resultsByCell) {
    for (const candidate of ensureArray(candidates)) {
      const mergedCandidate = buildMacroCellBoostedCandidate(candidate, cell, searchAnchor)
      const dedupeKey = mergedCandidate?.id ?? `${mergedCandidate?.name || ''}:${mergedCandidate?.lon || ''}:${mergedCandidate?.lat || ''}`
      const existing = mergedById.get(dedupeKey)
      const existingScore = toFiniteNumber(existing?.fused_score) || Number.NEGATIVE_INFINITY
      const nextScore = toFiniteNumber(mergedCandidate?.fused_score) || Number.NEGATIVE_INFINITY

      if (!existing || nextScore > existingScore) {
        mergedById.set(dedupeKey, mergedCandidate)
      }
    }
  }

  return [...mergedById.values()]
    .sort((left, right) => (toFiniteNumber(right?.fused_score) || 0) - (toFiniteNumber(left?.fused_score) || 0))
}

const SCHOOL_ORDINAL_MAP = {
  '1': '一',
  '2': '二',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
  '7': '七',
  '8': '八',
  '9': '九',
  '10': '十',
  '两': '二'
}

function toChineseSchoolOrdinal(value = '') {
  const text = String(value || '').trim()
  return SCHOOL_ORDINAL_MAP[text] || text
}

function buildPlaceNameVariants(placeName = '') {
  const baseName = String(placeName || '').trim()
  const variants = new Set(baseName ? [baseName] : [])
  const schoolMatch = baseName.match(/^(.*?)([一二三四五六七八九十两0-9]+)中$/)

  if (schoolMatch) {
    const [, rawPrefix, rawOrdinal] = schoolMatch
    const prefix = String(rawPrefix || '').trim()
    const ordinal = toChineseSchoolOrdinal(rawOrdinal)

    if (prefix && ordinal) {
      variants.add(`${prefix}第${ordinal}中学`)
      if (!/[市区县]$/.test(prefix)) {
        variants.add(`${prefix}市第${ordinal}中学`)
      }
    }
  }

  return [...variants]
}

function inferPlaceKind(placeName = '') {
  if (/(大学|学院|学校|校区|中学|小学|幼儿园|附中|高中|初中|[一二三四五六七八九十两0-9]+中)/.test(placeName)) return 'education'
  if (/(医院|诊所|门诊)/.test(placeName)) return 'medical'
  if (/(公园|景区|风景|广场)/.test(placeName)) return 'scenic'
  if (/(地铁站|地铁口|火车站|高铁站|站)/.test(placeName)) return 'transport'
  return 'generic'
}

const PLACE_KIND_CATEGORY_HINTS = {
  education: new Set(['科教文化服务', '学校']),
  medical: new Set(['医疗保健服务', '综合医院', '专科医院', '诊所']),
  scenic: new Set(['风景名胜', '公园广场', '旅游景点']),
  transport: new Set(['交通设施服务', '地铁站', '火车站', '公交车站'])
}

const PLACE_KIND_STRONG_HINTS = {
  education: new Set(['学校']),
  medical: new Set(['综合医院', '专科医院', '诊所']),
  scenic: new Set(['旅游景点', '公园广场']),
  transport: new Set(['地铁站', '火车站', '公交车站'])
}

function buildCandidateDensityMap(candidates = []) {
  const densityMap = new Map()
  for (const candidate of candidates) {
    const lon = Number(candidate?.lon)
    const lat = Number(candidate?.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const key = `${lon.toFixed(6)},${lat.toFixed(6)}`
    densityMap.set(key, (densityMap.get(key) || 0) + 1)
  }
  return densityMap
}

const EDUCATION_SAME_ENTITY_SUFFIX_RE = /^(?:[（(][^()（）]*(?:校区|分校区|东校区|西校区|南校区|北校区)[^()（）]*[)）]|[-·]?(?:东门|西门|南门|北门|正门|后门|校区|东区|西区|南区|北区|图书馆|体育馆|礼堂|教学楼|行政楼|实验楼|办公楼|附属楼|宿舍楼|北门口|南门口|东门口|西门口))$/

const EDUCATION_DERIVATIVE_SUFFIX_RE = /(?:大学|学院|学校|中学|小学|幼儿园|附中|高中|初中|实验|国际|联合|合作|附属|分校|广雅|外国语)/

function classifyEducationAnchorName(name = '', variant = '') {
  const trimmedName = String(name || '').trim()
  const trimmedVariant = String(variant || '').trim()
  if (!trimmedName || !trimmedVariant || !trimmedName.startsWith(trimmedVariant)) return 'none'

  const suffix = trimmedName.slice(trimmedVariant.length).trim()
  if (!suffix) return 'exact'
  if (EDUCATION_SAME_ENTITY_SUFFIX_RE.test(suffix)) return 'same_entity_extension'
  if (EDUCATION_DERIVATIVE_SUFFIX_RE.test(suffix)) return 'different_school'
  return 'related_poi'
}

function scorePlaceAnchorCandidate(candidate = {}, placeName = '', queryVariants = [placeName], densityMap = null) {
  const name = String(candidate?.name || '').trim()
  if (!name) return Number.NEGATIVE_INFINITY

  const normalizedName = normalizeSearchText(name)
  if (!normalizedName) return Number.NEGATIVE_INFINITY

  const kind = inferPlaceKind(placeName)
  const kindHints = PLACE_KIND_CATEGORY_HINTS[kind] || new Set()
  const strongKindHints = PLACE_KIND_STRONG_HINTS[kind] || new Set()
  const categoryTokens = [
    candidate?.category_big,
    candidate?.category_mid,
    candidate?.category_small
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)

  const matchesKind = categoryTokens.some((token) => kindHints.has(token))
  const matchesStrongKind = categoryTokens.some((token) => strongKindHints.has(token))
  const variants = [...new Set([placeName, ...queryVariants].map((item) => String(item || '').trim()).filter(Boolean))]
  const normalizedCanonicalEducationVariants = kind === 'education'
    ? new Set(
        variants
          .filter((variant) => variant.length > String(placeName || '').trim().length)
          .map((variant) => normalizeSearchText(variant))
          .filter(Boolean)
      )
    : new Set()
  const preferredCanonicalEducationVariant = kind === 'education'
    ? variants
        .filter((variant) => variant.length > String(placeName || '').trim().length)
        .sort((a, b) => b.length - a.length)[0] || ''
    : ''
  const normalizedPreferredCanonicalEducationVariant = preferredCanonicalEducationVariant
    ? normalizeSearchText(preferredCanonicalEducationVariant)
    : ''
  let bestScore = Number.NEGATIVE_INFINITY

  for (const variant of variants) {
    const normalizedVariant = normalizeSearchText(variant)
    if (!normalizedVariant) continue

    const isCanonicalCampusName = kind === 'education'
      && new RegExp(`^${escapeRegExp(variant)}(?:[（(][^()（）]*校区[^()（）]*[)）])?$`).test(name)
    const educationNameRelation = kind === 'education'
      ? classifyEducationAnchorName(name, variant)
      : 'none'

    let score = 0

    if (normalizedName === normalizedVariant) score += matchesStrongKind ? 2200 : 900
    if (normalizedName.startsWith(normalizedVariant)) score += matchesStrongKind ? 1300 : 900
    if (normalizedName.includes(normalizedVariant)) score += 600
    if (name.startsWith(variant)) score += 120

    if (matchesKind) score += 420
    if (matchesStrongKind) score += 620

    if (kind === 'education') {
      if (normalizedCanonicalEducationVariants.has(normalizedName)) score += 1800
      if (normalizedPreferredCanonicalEducationVariant && normalizedName === normalizedPreferredCanonicalEducationVariant) score += 260
      if (educationNameRelation === 'same_entity_extension') score += 1050
      if (educationNameRelation === 'different_school') score -= 1700
      if (isCanonicalCampusName && (matchesStrongKind || /校区/.test(name))) score += 1400
      if (/[（(].*校区.*[)）]/.test(name)) score += 260
      if (/(大学|学院|学校|中学|小学)/.test(name)) score += 180
      if (new RegExp(`^${escapeRegExp(variant)}[-·]`).test(name)) score -= 180
      if (/(继续教育|函授|培训|考研|驾校|教学区|成人)/.test(name)) score -= 460
      if (/(店|酒店|宾馆|营业厅|停车场|公交站|地铁站|超市|便利店|专卖店|门市部|委员会|快递|宿舍|公寓|楼|教学楼|教\d|服务中心)/.test(name)) {
        score -= 420
      }
    }

    if (kind === 'transport' && /(店|酒店|宾馆|营业厅|分公司|委员会)/.test(name)) {
      score -= 280
    }

    if (/^[A-Za-z0-9]/.test(name)) {
      score -= 60
    }

    score -= Math.min(Math.abs(name.length - variant.length), 40) * 3

    if (Number.isFinite(Number(candidate?.distance_m))) {
      score -= Math.min(Number(candidate.distance_m) / 40, 220)
    }

    if (score > bestScore) {
      bestScore = score
    }
  }

  if (!Number.isFinite(bestScore)) return Number.NEGATIVE_INFINITY

  const lon = Number(candidate?.lon)
  const lat = Number(candidate?.lat)
  if (densityMap && Number.isFinite(lon) && Number.isFinite(lat)) {
    const key = `${lon.toFixed(6)},${lat.toFixed(6)}`
    const duplicateCount = densityMap.get(key) || 1
    bestScore += Math.min(Math.max(duplicateCount - 1, 0), 6) * 320
  }

  return bestScore
}

async function resolveAnchorFromIntent(intent = {}, deps = buildDefaultDeps(), { searchAnchor = null } = {}) {
  const placeName = String(intent?.placeName || '').trim()
  if (!placeName || typeof deps.quickSearchPois !== 'function') return null

  try {
    const queryVariants = buildPlaceNameVariants(placeName)
    const allCandidates = []
    const candidateMap = new Map()

    for (const queryText of queryVariants) {
      const quickSearchOptions = {
        queryText,
        limit: 120,
        preferPrefix: true
      }

      if (hasAnchorCoordinates(searchAnchor)) {
        quickSearchOptions.lon = Number(searchAnchor.lon)
        quickSearchOptions.lat = Number(searchAnchor.lat)
        quickSearchOptions.radius = 50000
      }

      const variantCandidates = await deps.quickSearchPois(quickSearchOptions)
      for (const candidate of variantCandidates || []) {
        allCandidates.push(candidate)
        const dedupeKey = candidate?.id ?? `${candidate?.name || ''}:${candidate?.lon || ''}:${candidate?.lat || ''}`
        if (!candidateMap.has(dedupeKey)) {
          candidateMap.set(dedupeKey, candidate)
        }
      }
    }

    const candidates = [...candidateMap.values()]

    if (!Array.isArray(candidates) || candidates.length === 0) return null
    const densityMap = buildCandidateDensityMap(allCandidates)

    const ranked = [...candidates].sort((a, b) => (
      scorePlaceAnchorCandidate(b, placeName, queryVariants, densityMap)
      - scorePlaceAnchorCandidate(a, placeName, queryVariants, densityMap)
    ))

    const top = ranked[0]
    const lon = Number(top?.lon)
    const lat = Number(top?.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null

    return {
      lon,
      lat,
      poiId: top?.id ?? top?.poiid ?? null,
      source: 'intent.place_name',
      resolvedPlaceName: top?.name || placeName
    }
  } catch (error) {
    console.warn('[SpatialOrchestrator] Failed to resolve place anchor:', error.message)
    return null
  }
}

function normalizeStructuredAnchors(value = []) {
  return ensureArray(value)
    .map((item, index) => {
      const placeName = String(item?.placeName || item?.place_name || '').trim()
      if (!placeName) return null

      return {
        place_name: placeName,
        display_name: String(item?.displayName || item?.display_name || placeName).trim() || placeName,
        role: String(
          item?.role ||
          (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
        ).trim() || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`),
        index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index
      }
    })
    .filter(Boolean)
}

async function resolveComparisonAnchorsFromIntent(intent = {}, deps = buildDefaultDeps(), {
  searchAnchor = null,
  primaryAnchor = null
} = {}) {
  const anchors = normalizeStructuredAnchors(intent?.anchors || intent?.comparisonAnchors)
  if (anchors.length === 0) return []

  const primaryPlaceName = String(intent?.placeName || '').trim()
  const resolvedAnchors = []

  for (const anchorDescriptor of anchors) {
    const isPrimary = anchorDescriptor.role === 'primary' || anchorDescriptor.index === 0
    if (isPrimary && hasAnchorCoordinates(primaryAnchor)) {
      resolvedAnchors.push({
        ...anchorDescriptor,
        lon: Number(primaryAnchor.lon),
        lat: Number(primaryAnchor.lat),
        source: primaryAnchor.source || 'intent.place_name',
        resolvedPlaceName: primaryAnchor.resolvedPlaceName || anchorDescriptor.display_name || primaryPlaceName,
        poiId: primaryAnchor.poiId ?? null
      })
      continue
    }

    const resolvedAnchor = await resolveAnchorFromIntent({
      placeName: anchorDescriptor.place_name
    }, deps, { searchAnchor })

    if (!resolvedAnchor) continue

    resolvedAnchors.push({
      ...anchorDescriptor,
      lon: Number(resolvedAnchor.lon),
      lat: Number(resolvedAnchor.lat),
      source: resolvedAnchor.source || 'intent.place_name',
      resolvedPlaceName: resolvedAnchor.resolvedPlaceName || anchorDescriptor.display_name,
      poiId: resolvedAnchor.poiId ?? null
    })
  }

  return resolvedAnchors
}

function buildDefaultDeps() {
  return {
    parseIntent,
    deriveSpatialAnchor,
    getIndexStatus,
    buildSpatialQueryEmbedding,
    buildQueryEmbeddingSearchOptions,
    faissHybridSearch,
    filterCandidatesWithSmallLLM,
    enrichResultsWithSpatialEncoder,
    enrichResultsWithCellContext,
    searchMacroCellsWithTownEncoder,
    executeDedicatedComparisonTask,
    executeDedicatedMacroTask,
    isDedicatedComparisonTask,
    isDedicatedMacroTask,
    buildSurfaceQueryWkt,
    fetchSurfaceContext,
    selectVectorConstraintContext,
    refineSurfaceConstraintGeometry,
    buildSpatialEvidence,
    quickSearchPois,
    defaultSpatialAnchor: DEFAULT_SPATIAL_ANCHOR
  }
}

export async function handleSpatialQuery(userQuery, {
  poiFeatures = [],
  spatialContext = null,
  intent = null,
  traceId = null
} = {}, deps = buildDefaultDeps()) {
  const effectiveDeps = {
    ...buildDefaultDeps(),
    ...(deps || {})
  }
  const resolvedIntent = intent || await effectiveDeps.parseIntent(userQuery) || {}
  const effectiveIntent = resolvedIntent.poiSubType
    ? resolvedIntent
    : {
        ...resolvedIntent,
        poiSubType: inferPoiSubTypeFromQueryText(userQuery)
      }

  const fallbackAnchor = effectiveDeps.deriveSpatialAnchor({
    poiFeatures,
    spatialContext,
    fallbackAnchor: effectiveDeps.defaultSpatialAnchor
  })
  const anchor = await resolveAnchorFromIntent(effectiveIntent, effectiveDeps, {
    searchAnchor: fallbackAnchor
  }) || fallbackAnchor
  const runtimeAnchor = hasAnchorCoordinates(anchor)
    ? {
        lon: Number(anchor.lon),
        lat: Number(anchor.lat),
        source: anchor.source || null
      }
    : anchor
  const comparisonAnchors = await resolveComparisonAnchorsFromIntent(effectiveIntent, effectiveDeps, {
    searchAnchor: fallbackAnchor,
    primaryAnchor: anchor
  })

  const faissStatus = effectiveDeps.getIndexStatus()
  const shouldUseDedicatedComparisonExecutor = typeof effectiveDeps.isDedicatedComparisonTask === 'function'
    ? effectiveDeps.isDedicatedComparisonTask({
      ...effectiveIntent,
      anchors: comparisonAnchors.length > 0 ? comparisonAnchors : effectiveIntent.anchors
    })
    : false
  const shouldUseDedicatedMacroExecutor = typeof effectiveDeps.isDedicatedMacroTask === 'function'
    ? effectiveDeps.isDedicatedMacroTask(effectiveIntent)
    : false
  let macroCellSearch = shouldUseDedicatedComparisonExecutor
    ? {
        applied: false,
        reason: 'comparison_executor_handles_macro_cells',
        cells: [],
        modelsUsed: ['town_encoder']
      }
    : (typeof effectiveDeps.searchMacroCellsWithTownEncoder === 'function'
      ? await effectiveDeps.searchMacroCellsWithTownEncoder({
        anchor: runtimeAnchor,
        intent: effectiveIntent,
        userQuery
      })
      : {
        applied: false,
        reason: 'macro_cell_search_unavailable',
        cells: [],
        modelsUsed: []
      })
  const queryEmbedding = shouldUseDedicatedComparisonExecutor
    ? {
        applied: false,
        reason: 'comparison_task_bypass',
        source: 'town_encoder_comparison_route',
        embeddingDim: 0,
        queryEmbedding: null,
        modelUsage: ['town_encoder']
      }
    : shouldUseDedicatedMacroExecutor
    ? {
        applied: false,
        reason: 'macro_task_bypass',
        source: 'town_encoder_macro_route',
        embeddingDim: 0,
        queryEmbedding: null,
        modelUsage: ['town_encoder']
      }
    : await effectiveDeps.buildSpatialQueryEmbedding({
        userQuery,
        intent: effectiveIntent,
        anchor
      })
  const hybridSearchOptions = (shouldUseDedicatedComparisonExecutor || shouldUseDedicatedMacroExecutor)
    ? {}
    : effectiveDeps.buildQueryEmbeddingSearchOptions(queryEmbedding)
  const baseRadius = effectiveIntent.radiusM || 500
  let searchRadiusM = baseRadius

  let candidateResults = []
  let filteredResults = []
  let runtimeEnrichment = {
    applied: false,
    reason: 'not_run',
    results: []
  }
  let cellContextEnrichment = {
    applied: false,
    reason: 'not_run',
    results: [],
    modelsUsed: []
  }
  let routeExecutor = null
  let comparisonRegions = []

  const dedicatedComparisonExecution = shouldUseDedicatedComparisonExecutor && typeof effectiveDeps.executeDedicatedComparisonTask === 'function'
    ? await effectiveDeps.executeDedicatedComparisonTask({
      userQuery,
      intent: effectiveIntent,
      comparisonAnchors,
      deps: effectiveDeps
    })
    : {
      applied: false,
      reason: 'not_requested'
    }

  const dedicatedMacroExecution = shouldUseDedicatedMacroExecutor && typeof effectiveDeps.executeDedicatedMacroTask === 'function'
    ? await effectiveDeps.executeDedicatedMacroTask({
        userQuery,
        intent: effectiveIntent,
        runtimeAnchor,
        macroCellSearch,
        deps: effectiveDeps
      })
    : {
        applied: false,
        reason: 'not_requested'
      }

  if (dedicatedComparisonExecution?.applied) {
    candidateResults = ensureArray(dedicatedComparisonExecution.candidateResults)
    filteredResults = ensureArray(dedicatedComparisonExecution.filteredResults)
    runtimeEnrichment = dedicatedComparisonExecution.runtimeEnrichment || runtimeEnrichment
    cellContextEnrichment = dedicatedComparisonExecution.cellContextEnrichment || cellContextEnrichment
    routeExecutor = dedicatedComparisonExecution.routeExecutor || null
    searchRadiusM = Math.max(baseRadius, Number(dedicatedComparisonExecution.searchRadiusM) || baseRadius)
    macroCellSearch = dedicatedComparisonExecution.macroCellSearch || macroCellSearch
    comparisonRegions = ensureArray(dedicatedComparisonExecution.comparisonRegions)
  } else if (dedicatedMacroExecution?.applied) {
    candidateResults = ensureArray(dedicatedMacroExecution.candidateResults)
    filteredResults = ensureArray(dedicatedMacroExecution.filteredResults)
    runtimeEnrichment = dedicatedMacroExecution.runtimeEnrichment || runtimeEnrichment
    cellContextEnrichment = dedicatedMacroExecution.cellContextEnrichment || cellContextEnrichment
    routeExecutor = dedicatedMacroExecution.routeExecutor || null
    searchRadiusM = Math.max(baseRadius, Number(dedicatedMacroExecution.searchRadiusM) || baseRadius)
  } else if (faissStatus.loaded) {
    const runHybridSearch = (searchAnchor, radius, topK) => effectiveDeps.faissHybridSearch({
      anchor: searchAnchor,
      radius,
      categories: effectiveIntent.category ? [effectiveIntent.category] : [],
      subcategory: effectiveIntent.poiSubType || null,
      topK,
      targetRegion: effectiveIntent.regionLabel,
      ...hybridSearchOptions
    })

    if (macroCellSearch?.applied && Array.isArray(macroCellSearch.cells) && macroCellSearch.cells.length > 0) {
      const activeCells = macroCellSearch.cells.slice(0, Math.max(1, Math.min(macroCellSearch.cells.length, 4)))
      const perCellRadiusM = Math.max(300, Number(macroCellSearch.perCellRadiusM) || baseRadius)
      const perCellTopK = Math.max(20, Math.ceil(90 / activeCells.length))
      const resultsByCell = []

      searchRadiusM = Math.max(baseRadius, Number(macroCellSearch.searchRadiusM) || baseRadius)

      for (let index = 0; index < activeCells.length; index += 1) {
        const cell = activeCells[index]
        const searchAnchor = buildMacroCellSearchAnchor(cell, index)
        if (!hasAnchorCoordinates(searchAnchor)) continue

        const macroCandidates = ensureArray(await runHybridSearch(searchAnchor, perCellRadiusM, perCellTopK))
        resultsByCell.push({
          cell,
          searchAnchor,
          candidates: macroCandidates
        })
      }

      candidateResults = mergeMacroCellCandidates(resultsByCell)
    }

    if (candidateResults.length === 0) {
      candidateResults = ensureArray(await runHybridSearch(anchor, baseRadius, 50))
    }

    const shouldRunAdaptiveFallback = !(macroCellSearch?.applied && candidateResults.length > 0)
    if (shouldRunAdaptiveFallback) {
      for (const expandedRadius of buildAdaptiveRadiusPlan(userQuery, effectiveIntent)) {
        if (candidateResults.length >= MIN_ADAPTIVE_RESULT_COUNT) break

        const expandedResults = ensureArray(await runHybridSearch(anchor, expandedRadius, 80))
        if (expandedResults.length > candidateResults.length) {
          candidateResults = expandedResults
          searchRadiusM = expandedRadius
        }
      }
    }
  }

  if (!dedicatedComparisonExecution?.applied && !dedicatedMacroExecution?.applied) {
      filteredResults = candidateResults.length > 0
      ? ensureArray(await effectiveDeps.filterCandidatesWithSmallLLM(userQuery, effectiveIntent, candidateResults))
      : []

    runtimeEnrichment = await effectiveDeps.enrichResultsWithSpatialEncoder({
      anchor,
      results: filteredResults
    })
    const poiEnrichedResults = ensureArray(runtimeEnrichment?.results)
    cellContextEnrichment = typeof effectiveDeps.enrichResultsWithCellContext === 'function'
      ? await effectiveDeps.enrichResultsWithCellContext({
          anchor: runtimeAnchor,
          results: poiEnrichedResults,
          intent: effectiveIntent,
          userQuery
        })
      : {
          applied: false,
          reason: 'cell_context_unavailable',
          results: poiEnrichedResults,
          modelsUsed: []
        }
  }
  const enrichedResults = ensureArray(cellContextEnrichment?.results)

  const surfaceQueryWkt = effectiveDeps.buildSurfaceQueryWkt({
    spatialContext,
    filteredResults: enrichedResults
  })
  const surfaceContextData = surfaceQueryWkt
    ? await effectiveDeps.fetchSurfaceContext({ queryWkt: surfaceQueryWkt })
    : null
  const selectedSurfaceConstraint = surfaceContextData
    ? effectiveDeps.selectVectorConstraintContext(enrichedResults, surfaceContextData)
    : null
  const refinedSurfaceConstraint = (surfaceQueryWkt && selectedSurfaceConstraint)
    ? await effectiveDeps.refineSurfaceConstraintGeometry({
        queryWkt: surfaceQueryWkt,
        constraint: selectedSurfaceConstraint
      })
    : null

  const evidenceIntent = searchRadiusM === baseRadius
    ? effectiveIntent
    : {
        ...effectiveIntent,
        searchRadiusM
      }

  const evidence = effectiveDeps.buildSpatialEvidence({
    traceId,
    userQuery,
    intent: evidenceIntent,
    anchor,
    candidateResults,
    filteredResults: enrichedResults,
    spatialContext,
    poiFeatures,
    queryEmbedding,
    macroCellSearch,
    runtimeEnrichment,
    cellContextEnrichment,
    routeExecutor,
    comparisonRegions,
    surfaceContext: surfaceContextData,
    surfaceConstraint: refinedSurfaceConstraint || selectedSurfaceConstraint
  })

  return {
    intent: evidenceIntent,
    anchor,
    queryEmbedding,
    candidateResults,
    results: enrichedResults,
    macroCellSearch,
    runtimeEnrichment,
    cellContextEnrichment,
    routeExecutor,
    comparisonRegions,
    surfaceContext: surfaceContextData,
    surfaceConstraint: refinedSurfaceConstraint || selectedSurfaceConstraint,
    evidence
  }
}

export default {
  handleSpatialQuery
}
