import {
  buildPopulationMetricsFromCells,
  buildSupportBucketMetrics,
  buildVerifiedSupportBucketMetrics,
  buildMacroCellSummary,
  buildMacroUncertainty,
  buildRepresentativePois,
  enrichSupportBucketsWithResults,
  inferSupportBucket,
  normalizeMacroUncertainty,
  summarizeSupportBuckets
} from '../ai/supportEvidenceUtils.js'

// Deprecated rule-line executor: kept for baseline compatibility while planner_line is built.

const DEDICATED_MACRO_TASKS = new Set([
  'area_overview',
  'site_suitability'
])

const DEDICATED_COMPARISON_TASKS = new Set([
  'region_comparison'
])

const COMPARISON_ROLE_PRIORITY = {
  primary: 0,
  secondary: 1
}

function normalizeTaskType(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || null
}

function ensureArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function hasAnchorCoordinates(anchor = null) {
  return Number.isFinite(Number(anchor?.lon)) && Number.isFinite(Number(anchor?.lat))
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

function computeBucketPriority(bucket = '') {
  switch (bucket) {
    case '医疗健康':
      return 5
    case '零售购物':
      return 4
    case '餐饮配套':
      return 3
    case '交通出行':
      return 2
    case '生活服务':
    case '教育服务':
    case '休闲娱乐':
      return 1
    case '其他配套':
    default:
      return 0
  }
}

function buildRepresentativeMacroResults(results = [], taskType = 'area_overview') {
  const deduped = ensureArray(results)
  if (deduped.length === 0) return []

  const candidates = deduped.map((item) => {
    const bucket = inferSupportBucket(item)
    return {
      ...item,
      __supportBucket: bucket,
      __bucketPriority: computeBucketPriority(bucket),
      __selectionScore: (
        computeBucketPriority(bucket) * 1000 +
        (toFiniteNumber(item?.fused_score) || 0) * 100 +
        (toFiniteNumber(item?.macro_cell_context?.search_score) || 0) * 40 -
        Math.min((toFiniteNumber(item?.distance_m) || 0) / 15, 80)
      )
    }
  })

  const sorted = candidates
    .slice()
    .sort((left, right) => {
      if (right.__selectionScore !== left.__selectionScore) {
        return right.__selectionScore - left.__selectionScore
      }
      return (toFiniteNumber(left?.distance_m) || Number.POSITIVE_INFINITY)
        - (toFiniteNumber(right?.distance_m) || Number.POSITIVE_INFINITY)
    })

  const selected = []
  const selectedNames = new Set()
  const selectedBuckets = new Set()
  const totalLimit = taskType === 'site_suitability' ? 6 : 8

  for (const item of sorted) {
    if (selected.length >= totalLimit) break
    if (selectedNames.has(item.name)) continue
    if (item.__bucketPriority <= 0) continue

    selected.push(item)
    selectedNames.add(item.name)
    selectedBuckets.add(item.__supportBucket)
  }

  for (const item of sorted) {
    if (selected.length >= totalLimit) break
    if (selectedNames.has(item.name)) continue

    if (item.__bucketPriority <= 0) {
      if (selectedBuckets.size >= 3 && selected.length >= 4) continue
    }

    selected.push(item)
    selectedNames.add(item.name)
    selectedBuckets.add(item.__supportBucket)
  }

  return selected.map((item) => {
    const next = { ...item }
    delete next.__supportBucket
    delete next.__bucketPriority
    delete next.__selectionScore
    return next
  })
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
        index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index,
        lon: toFiniteNumber(item?.lon),
        lat: toFiniteNumber(item?.lat),
        source: item?.source || null,
        resolved_place_name: String(item?.resolvedPlaceName || item?.resolved_place_name || '').trim() || null,
        poi_id: item?.poiId ?? item?.poi_id ?? null
      }
    })
    .filter(Boolean)
}

function dedupeAndSortResults(results = []) {
  const deduped = new Map()

  for (const item of ensureArray(results)) {
    const key = item?.id ?? `${item?.comparison_anchor_role || ''}:${item?.name || ''}:${item?.lon || ''}:${item?.lat || ''}`
    const currentScore = toFiniteNumber(item?.fused_score) || Number.NEGATIVE_INFINITY
    const existing = deduped.get(key)
    const existingScore = toFiniteNumber(existing?.fused_score) || Number.NEGATIVE_INFINITY

    if (!existing || currentScore > existingScore) {
      deduped.set(key, item)
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const leftRole = COMPARISON_ROLE_PRIORITY[left?.comparison_anchor_role] ?? 99
    const rightRole = COMPARISON_ROLE_PRIORITY[right?.comparison_anchor_role] ?? 99
    if (leftRole !== rightRole) return leftRole - rightRole

    const rightScore = toFiniteNumber(right?.fused_score) || Number.NEGATIVE_INFINITY
    const leftScore = toFiniteNumber(left?.fused_score) || Number.NEGATIVE_INFINITY
    if (rightScore !== leftScore) return rightScore - leftScore

    return (toFiniteNumber(left?.distance_m) || Number.POSITIVE_INFINITY)
      - (toFiniteNumber(right?.distance_m) || Number.POSITIVE_INFINITY)
  })
}

function annotateComparisonResults(results = [], anchorDescriptor = {}) {
  return ensureArray(results).map((item) => ({
    ...item,
    comparison_anchor_role: anchorDescriptor?.role || null,
    comparison_anchor_name: anchorDescriptor?.display_name || anchorDescriptor?.place_name || null,
    comparison_anchor_place_name: anchorDescriptor?.place_name || null
  }))
}

function buildRegionModelRouting(execution = {}) {
  const usage = new Set(['town_encoder'])

  for (const model of ensureArray(execution?.runtimeEnrichment?.modelsUsed)) {
    usage.add(model)
  }
  for (const model of ensureArray(execution?.cellContextEnrichment?.modelsUsed)) {
    usage.add(model)
  }

  return {
    primary: 'town_encoder',
    usage: [...usage]
  }
}

function mergeMacroSupportBuckets(summaries = []) {
  const bucketMap = new Map()

  for (const summary of ensureArray(summaries)) {
    for (const bucket of ensureArray(summary?.support_buckets)) {
      const name = String(bucket?.bucket || '').trim()
      if (!name) continue

      if (!bucketMap.has(name)) {
        bucketMap.set(name, {
          bucket: name,
          count: 0,
          examples: [],
          representative_categories: [],
          min_distance_m: null
        })
      }

      const current = bucketMap.get(name)
      current.count += Math.max(0, Number(bucket?.count) || 0)

      for (const example of ensureArray(bucket?.examples)) {
        if (!current.examples.includes(example) && current.examples.length < 3) {
          current.examples.push(example)
        }
      }

      for (const category of ensureArray(bucket?.representative_categories)) {
        if (!current.representative_categories.includes(category) && current.representative_categories.length < 3) {
          current.representative_categories.push(category)
        }
      }

      const minDistance = toFiniteNumber(bucket?.min_distance_m)
      if (minDistance !== null) {
        current.min_distance_m = current.min_distance_m === null
          ? minDistance
          : Math.min(current.min_distance_m, minDistance)
      }
    }
  }

  return [...bucketMap.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count
    return (left.min_distance_m ?? Number.POSITIVE_INFINITY)
      - (right.min_distance_m ?? Number.POSITIVE_INFINITY)
  })
}

function mergeMacroCellMix(summaries = []) {
  const mixMap = new Map()

  for (const summary of ensureArray(summaries)) {
    for (const item of ensureArray(summary?.cell_mix)) {
      const label = String(item?.label || '').trim()
      if (!label) continue
      if (!mixMap.has(label)) {
        mixMap.set(label, {
          label,
          count: 0
        })
      }

      const current = mixMap.get(label)
      current.count += Math.max(0, Number(item?.count) || 0)
    }
  }

  const totalCount = [...mixMap.values()].reduce((sum, item) => sum + item.count, 0)
  return [...mixMap.values()]
    .sort((left, right) => right.count - left.count)
    .map((item) => ({
      ...item,
      ratio: totalCount > 0 ? Number((item.count / totalCount).toFixed(4)) : null
    }))
}

function mergeMacroCellSummaries(summaries = [], { comparisonMode = null } = {}) {
  const normalizedSummaries = ensureArray(summaries)
  const supportBuckets = mergeMacroSupportBuckets(normalizedSummaries)
  const dominantBuckets = [...new Set(
    normalizedSummaries.flatMap((summary) => ensureArray(summary?.dominant_buckets))
  )].slice(0, 6)
  const sceneTags = [...new Set(
    normalizedSummaries.flatMap((summary) => ensureArray(summary?.scene_tags))
  )].slice(0, 8)
  const cellMix = mergeMacroCellMix(normalizedSummaries)
  const sampleSize = normalizedSummaries.reduce(
    (sum, summary) => sum + Math.max(0, Number(summary?.uncertainty?.sample_size) || 0),
    0
  ) || cellMix.reduce((sum, item) => sum + Math.max(0, Number(item?.count) || 0), 0)
  const uncertainty = normalizeMacroUncertainty(null, {
    supportBucketCount: supportBuckets.length,
    sampleSize,
    comparisonMode,
    modelRoutePrimary: 'town_encoder',
    modelUsage: ['town_encoder']
  })

  return {
    support_buckets: supportBuckets,
    support_bucket_metrics: buildSupportBucketMetrics(supportBuckets),
    dominant_buckets: dominantBuckets,
    scene_tags: sceneTags,
    cell_mix: cellMix,
    population_metrics: buildPopulationMetricsFromCells(
      normalizedSummaries.flatMap((summary) => ensureArray(summary?.cells))
    ),
    uncertainty
  }
}

function buildComparisonRegionPayload({
  anchorDescriptor = {},
  resolvedAnchor = null,
  execution = {},
  macroCellSearch = null
} = {}) {
  const filteredResults = annotateComparisonResults(execution?.filteredResults, anchorDescriptor)
  const macroCellSummary = buildMacroCellSummary(macroCellSearch, {
    sampleSize: filteredResults.length,
    comparisonMode: 'dual_anchor',
    modelRoutePrimary: 'town_encoder',
    modelUsage: ['town_encoder']
  })
  const supportBuckets = macroCellSummary.support_buckets.length > 0
    ? macroCellSummary.support_buckets
    : summarizeSupportBuckets(filteredResults)
  const evidenceSupportBuckets = enrichSupportBucketsWithResults(supportBuckets, filteredResults)
  const representativePois = buildRepresentativePois(filteredResults, 5).map((item) => ({
    ...item,
    anchor_role: anchorDescriptor?.role || null,
    anchor_name: anchorDescriptor?.display_name || anchorDescriptor?.place_name || null
  }))
  const defaultUncertainty = buildMacroUncertainty({
    sampleSize: filteredResults.length,
    supportBucketCount: evidenceSupportBuckets.length,
    representativePoiCount: representativePois.length,
    comparisonMode: 'dual_anchor',
    modelRouting: buildRegionModelRouting(execution)
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

  return {
    anchor: {
      place_name: anchorDescriptor?.place_name || null,
      display_name: anchorDescriptor?.display_name || anchorDescriptor?.place_name || null,
      role: anchorDescriptor?.role || null,
      index: anchorDescriptor?.index ?? null,
      lon: toFiniteNumber(resolvedAnchor?.lon ?? anchorDescriptor?.lon),
      lat: toFiniteNumber(resolvedAnchor?.lat ?? anchorDescriptor?.lat),
      source: resolvedAnchor?.source || anchorDescriptor?.source || null,
      resolved_place_name: resolvedAnchor?.resolvedPlaceName || anchorDescriptor?.resolved_place_name || null
    },
    support_buckets: evidenceSupportBuckets,
    support_bucket_metrics: buildVerifiedSupportBucketMetrics(
      evidenceSupportBuckets,
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
      candidate_count: ensureArray(execution?.candidateResults).length,
      result_count: filteredResults.length,
      macro_cell_count: ensureArray(macroCellSearch?.cells).length,
      search_radius_m: toFiniteNumber(execution?.searchRadiusM)
    }
  }
}

async function executeMacroRegionSearch({
  taskType = 'area_overview',
  userQuery = '',
  intent = {},
  runtimeAnchor = null,
  macroCellSearch = null,
  deps = {}
} = {}) {
  if (!macroCellSearch?.applied || !Array.isArray(macroCellSearch?.cells) || macroCellSearch.cells.length === 0) {
    return {
      applied: false,
      reason: 'macro_cells_unavailable'
    }
  }

  if (deps.getIndexStatus?.()?.loaded !== true || typeof deps.faissHybridSearch !== 'function') {
    return {
      applied: false,
      reason: 'faiss_unavailable'
    }
  }

  const activeCells = macroCellSearch.cells.slice(0, Math.max(1, Math.min(macroCellSearch.cells.length, 4)))
  const perCellRadiusM = Math.max(300, Number(macroCellSearch.perCellRadiusM) || Number(intent?.radiusM) || 800)
  const perCellTopK = taskType === 'site_suitability' ? 8 : 10
  const resultsByCell = []

  for (let index = 0; index < activeCells.length; index += 1) {
    const cell = activeCells[index]
    const searchAnchor = buildMacroCellSearchAnchor(cell, index)
    if (!hasAnchorCoordinates(searchAnchor)) continue

    const macroCandidates = ensureArray(await deps.faissHybridSearch({
      anchor: searchAnchor,
      radius: perCellRadiusM,
      categories: [],
      subcategory: null,
      topK: perCellTopK,
      targetRegion: intent?.regionLabel
    }))

    resultsByCell.push({
      cell,
      searchAnchor,
      candidates: macroCandidates
    })
  }

  const candidateResults = mergeMacroCellCandidates(resultsByCell)
  const representativeResults = buildRepresentativeMacroResults(candidateResults, taskType)

  const runtimeEnrichment = typeof deps.enrichResultsWithSpatialEncoder === 'function'
    ? await deps.enrichResultsWithSpatialEncoder({
      anchor: runtimeAnchor,
      results: representativeResults
    })
    : {
      applied: false,
      reason: 'runtime_enrichment_unavailable',
      results: representativeResults,
      modelsUsed: []
    }

  const enrichedResults = ensureArray(runtimeEnrichment?.results)
  const cellContextEnrichment = typeof deps.enrichResultsWithCellContext === 'function'
    ? await deps.enrichResultsWithCellContext({
      anchor: runtimeAnchor,
      results: enrichedResults,
      intent,
      userQuery
    })
    : {
      applied: false,
      reason: 'cell_context_unavailable',
      results: enrichedResults,
      modelsUsed: []
    }

  return {
    applied: true,
    reason: 'dedicated_macro_executor',
    taskType,
    searchRadiusM: Math.max(Number(intent?.radiusM) || 0, Number(macroCellSearch.searchRadiusM) || 0) || Number(intent?.radiusM) || 500,
    candidateResults,
    filteredResults: ensureArray(cellContextEnrichment?.results),
    runtimeEnrichment,
    cellContextEnrichment
  }
}

export function isDedicatedMacroTask(intent = {}) {
  return DEDICATED_MACRO_TASKS.has(normalizeTaskType(intent?.taskType || intent?.answerType))
}

export function isDedicatedComparisonTask(intent = {}) {
  const taskType = normalizeTaskType(intent?.taskType || intent?.answerType)
  if (!DEDICATED_COMPARISON_TASKS.has(taskType)) return false
  return normalizeStructuredAnchors(intent?.anchors || intent?.comparisonAnchors).length >= 2
}

export async function executeDedicatedMacroTask({
  userQuery = '',
  intent = {},
  runtimeAnchor = null,
  macroCellSearch = null,
  deps = {}
} = {}) {
  const taskType = normalizeTaskType(intent?.taskType || intent?.answerType)
  if (!DEDICATED_MACRO_TASKS.has(taskType)) {
    return {
      applied: false,
      reason: 'not_dedicated_macro_task'
    }
  }

  const execution = await executeMacroRegionSearch({
    taskType,
    userQuery,
    intent,
    runtimeAnchor,
    macroCellSearch,
    deps
  })

  if (!execution?.applied) {
    return execution
  }

  return {
    ...execution,
    routeExecutor: {
      name: 'macro_overview_executor',
      taskType,
      primaryModel: 'town_encoder',
      reason: 'dedicated_macro_executor'
    }
  }
}

export async function executeDedicatedComparisonTask({
  userQuery = '',
  intent = {},
  comparisonAnchors = [],
  deps = {}
} = {}) {
  const taskType = normalizeTaskType(intent?.taskType || intent?.answerType)
  if (!DEDICATED_COMPARISON_TASKS.has(taskType)) {
    return {
      applied: false,
      reason: 'not_dedicated_comparison_task'
    }
  }

  if (deps.getIndexStatus?.()?.loaded !== true || typeof deps.searchMacroCellsWithTownEncoder !== 'function') {
    return {
      applied: false,
      reason: 'comparison_executor_unavailable'
    }
  }

  const normalizedAnchors = normalizeStructuredAnchors(comparisonAnchors.length > 0 ? comparisonAnchors : intent?.anchors || intent?.comparisonAnchors)
    .filter((item) => hasAnchorCoordinates(item))
    .slice(0, 2)

  if (normalizedAnchors.length < 2) {
    return {
      applied: false,
      reason: 'comparison_anchors_unavailable'
    }
  }

  const regionExecutions = []

  for (const anchorDescriptor of normalizedAnchors) {
    const runtimeAnchor = {
      lon: Number(anchorDescriptor.lon),
      lat: Number(anchorDescriptor.lat),
      source: anchorDescriptor.source || 'intent.place_name'
    }
    const regionIntent = {
      ...intent,
      placeName: anchorDescriptor.place_name,
      searchRadiusM: null
    }
    const macroCellSearch = await deps.searchMacroCellsWithTownEncoder({
      anchor: runtimeAnchor,
      intent: regionIntent,
      userQuery
    })
    const execution = await executeMacroRegionSearch({
      taskType: 'area_overview',
      userQuery,
      intent: regionIntent,
      runtimeAnchor,
      macroCellSearch,
      deps
    })

    if (!execution?.applied) {
      return {
        applied: false,
        reason: execution?.reason || 'comparison_region_unavailable'
      }
    }

    regionExecutions.push({
      anchorDescriptor,
      runtimeAnchor,
      macroCellSearch,
      execution: {
        ...execution,
        candidateResults: annotateComparisonResults(execution.candidateResults, anchorDescriptor),
        filteredResults: annotateComparisonResults(execution.filteredResults, anchorDescriptor)
      }
    })
  }

  if (regionExecutions.length < 2) {
    return {
      applied: false,
      reason: 'comparison_regions_unavailable'
    }
  }

  const comparisonRegions = regionExecutions.map((item) => buildComparisonRegionPayload({
    anchorDescriptor: item.anchorDescriptor,
    resolvedAnchor: item.runtimeAnchor,
    execution: item.execution,
    macroCellSearch: item.macroCellSearch
  }))

  const mergedCandidateResults = dedupeAndSortResults(
    regionExecutions.flatMap((item) => ensureArray(item.execution?.candidateResults))
  )
  const mergedFilteredResults = dedupeAndSortResults(
    regionExecutions.flatMap((item) => ensureArray(item.execution?.filteredResults))
  )
  const runtimeModelsUsed = [...new Set(
    regionExecutions.flatMap((item) => ensureArray(item.execution?.runtimeEnrichment?.modelsUsed))
  )]
  const cellModelsUsed = [...new Set(
    regionExecutions.flatMap((item) => ensureArray(item.execution?.cellContextEnrichment?.modelsUsed))
  )]
  const mergedMacroSummary = mergeMacroCellSummaries(
    regionExecutions.map((item) => buildMacroCellSummary(item.macroCellSearch, {
      comparisonMode: 'dual_anchor',
      modelRoutePrimary: 'town_encoder',
      modelUsage: ['town_encoder']
    })),
    { comparisonMode: 'dual_anchor' }
  )
  const combinedCells = regionExecutions.flatMap((item) =>
    ensureArray(item.macroCellSearch?.cells).map((cell) => ({
      ...cell,
      comparison_anchor_role: item.anchorDescriptor.role || null,
      comparison_anchor_name: item.anchorDescriptor.display_name || item.anchorDescriptor.place_name || null
    }))
  )

  return {
    applied: true,
    reason: 'dedicated_comparison_executor',
    taskType,
    searchRadiusM: Math.max(...regionExecutions.map((item) => Number(item.execution?.searchRadiusM) || 0), Number(intent?.radiusM) || 0),
    candidateResults: mergedCandidateResults,
    filteredResults: mergedFilteredResults,
    runtimeEnrichment: {
      applied: regionExecutions.some((item) => item.execution?.runtimeEnrichment?.applied === true),
      reason: 'comparison_region_merged',
      results: mergedFilteredResults,
      modelsUsed: runtimeModelsUsed
    },
    cellContextEnrichment: {
      applied: regionExecutions.some((item) => item.execution?.cellContextEnrichment?.applied === true),
      reason: 'comparison_region_merged',
      results: mergedFilteredResults,
      modelsUsed: cellModelsUsed
    },
    macroCellSearch: {
      applied: true,
      reason: 'town_encoder_comparison_cells',
      cells: combinedCells,
      modelRoute: 'town_encoder',
      modelsUsed: ['town_encoder'],
      searchRadiusM: Math.max(...regionExecutions.map((item) => Number(item.macroCellSearch?.searchRadiusM) || 0)),
      perCellRadiusM: Math.max(...regionExecutions.map((item) => Number(item.macroCellSearch?.perCellRadiusM) || 0)),
      supportBucketDistribution: mergedMacroSummary.support_buckets,
      dominantBuckets: mergedMacroSummary.dominant_buckets,
      sceneTags: mergedMacroSummary.scene_tags,
      cellMix: mergedMacroSummary.cell_mix,
      macroUncertainty: mergedMacroSummary.uncertainty
    },
    comparisonRegions,
    routeExecutor: {
      name: 'macro_comparison_executor',
      taskType,
      primaryModel: 'town_encoder',
      reason: 'dedicated_comparison_executor'
    }
  }
}

export default {
  executeDedicatedMacroTask,
  executeDedicatedComparisonTask,
  isDedicatedComparisonTask,
  isDedicatedMacroTask
}
