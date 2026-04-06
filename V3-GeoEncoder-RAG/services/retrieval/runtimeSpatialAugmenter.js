import {
  enrichPOIs,
  fetchBatchCellContext,
  isSpatialEncoderRunning,
  searchCells,
  startSpatialEncoder
} from '../infra/spatialEncoderClient.js'
import { buildMacroCellSummary } from '../spatial_core/ai/supportEvidenceUtils.js'

const MACRO_TASK_TYPES = new Set([
  'support_gap_analysis',
  'site_suitability',
  'region_comparison',
  'area_overview'
])

function hasUsableSpatialInfo(item = {}) {
  const regionLabel = item?.regionLabel
  if (regionLabel !== null && regionLabel !== undefined && regionLabel !== '') return true

  const predicted = item?.spatial_info?.region_idx
  const confidence = Number(item?.spatial_info?.region_confidence)
  return predicted !== null
    && predicted !== undefined
    && Number.isFinite(confidence)
    && confidence >= 0.55
}

function hasValidCoords(item = {}) {
  return Number.isFinite(Number(item?.lon ?? item?.longitude))
    && Number.isFinite(Number(item?.lat ?? item?.latitude))
}

function normalizeTaskType(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || null
}

function toPositiveNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function resolveMacroCellSearchConfig(intent = {}) {
  const taskType = normalizeTaskType(intent?.taskType || intent?.answerType) || 'nearby_lookup'

  switch (taskType) {
    case 'support_gap_analysis':
      return { taskType, topK: 4, maxDistanceM: 1800, perCellRadiusM: 700 }
    case 'site_suitability':
      return { taskType, topK: 4, maxDistanceM: 2200, perCellRadiusM: 850 }
    case 'region_comparison':
      return { taskType, topK: 6, maxDistanceM: 3200, perCellRadiusM: 1100 }
    case 'area_overview':
      return { taskType, topK: 5, maxDistanceM: 2500, perCellRadiusM: 900 }
    default:
      return { taskType, topK: 0, maxDistanceM: null, perCellRadiusM: null }
  }
}

export function isMacroSpatialTask(intent = {}) {
  return MACRO_TASK_TYPES.has(normalizeTaskType(intent?.taskType || intent?.answerType))
}

export function shouldEnrichResultsWithSpatialEncoder(results = []) {
  if (!Array.isArray(results) || results.length === 0) return false
  return results.some((item) => hasValidCoords(item) && !hasUsableSpatialInfo(item))
}

function mergeEnrichedResults(original = [], enriched = []) {
  if (!Array.isArray(enriched) || enriched.length === 0) return original

  const enrichedById = new Map()
  for (const item of enriched) {
    if (item?.id !== null && item?.id !== undefined) {
      enrichedById.set(item.id, item)
    }
  }

  return original.map((item, index) => {
    const enrichedMatch = enrichedById.get(item?.id) || enriched[index]
    if (!enrichedMatch || typeof enrichedMatch !== 'object') return item
    return {
      ...item,
      ...enrichedMatch,
      spatial_info: enrichedMatch.spatial_info || item?.spatial_info || null
    }
  })
}

function mergeCellContextResults(original = [], enriched = []) {
  if (!Array.isArray(enriched) || enriched.length === 0) return original

  const enrichedById = new Map()
  for (const item of enriched) {
    if (item?.id !== null && item?.id !== undefined) {
      enrichedById.set(item.id, item)
    }
  }

  return original.map((item, index) => {
    const enrichedMatch = enrichedById.get(item?.id) || enriched[index]
    if (!enrichedMatch || typeof enrichedMatch !== 'object') return item

    const similarity = Number(enrichedMatch?.cell_context?.similarity)
    const townContextScore = Number.isFinite(similarity)
      ? Math.max(0, Math.min(1, similarity))
      : null
    const baseFusedScore = Number(item?.fused_score)
    const fusedScore = Number.isFinite(baseFusedScore) && townContextScore !== null
      ? Number((baseFusedScore + townContextScore * 0.12).toFixed(6))
      : item?.fused_score

    return {
      ...item,
      ...enrichedMatch,
      fused_score: fusedScore,
      town_context_score: townContextScore,
      cell_context: enrichedMatch.cell_context || item?.cell_context || null
    }
  }).sort((left, right) => Number(right?.fused_score || 0) - Number(left?.fused_score || 0))
}

export async function enrichResultsWithSpatialEncoder({
  anchor = null,
  results = [],
  client = {
    isSpatialEncoderRunning,
    startSpatialEncoder,
    enrichPOIs
  }
} = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    return { applied: false, reason: 'no_results', results: [] }
  }

  const lon = Number(anchor?.lon)
  const lat = Number(anchor?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { applied: false, reason: 'invalid_anchor', results }
  }

  if (!shouldEnrichResultsWithSpatialEncoder(results)) {
    return { applied: false, reason: 'already_enriched', results }
  }

  try {
    let running = await client.isSpatialEncoderRunning()
    if (!running) {
      running = await client.startSpatialEncoder()
    }
    if (!running) {
      return { applied: false, reason: 'encoder_unavailable', results }
    }

    const enriched = await client.enrichPOIs(lon, lat, results)
    const merged = mergeEnrichedResults(results, enriched)
    return {
      applied: true,
      reason: 'enriched',
      results: merged
    }
  } catch (error) {
    return {
      applied: false,
      reason: 'enrichment_failed',
      error: error instanceof Error ? error.message : String(error || ''),
      results
    }
  }
}

export function shouldEnrichResultsWithCellContext(results = []) {
  if (!Array.isArray(results) || results.length === 0) return false
  return results.some((item) => hasValidCoords(item) && !item?.cell_context)
}

export async function searchMacroCellsWithTownEncoder({
  anchor = null,
  intent = {},
  userQuery = '',
  client = {
    isSpatialEncoderRunning,
    startSpatialEncoder,
    searchCells
  }
} = {}) {
  const config = resolveMacroCellSearchConfig(intent)
  if (!MACRO_TASK_TYPES.has(config.taskType)) {
    return {
      applied: false,
      reason: 'not_macro_task',
      cells: [],
      modelsUsed: []
    }
  }

  const lon = Number(anchor?.lon)
  const lat = Number(anchor?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return {
      applied: false,
      reason: 'invalid_anchor',
      cells: [],
      modelsUsed: []
    }
  }

  if (typeof client.searchCells !== 'function') {
    return {
      applied: false,
      reason: 'cell_search_unavailable',
      cells: [],
      modelsUsed: []
    }
  }

  try {
    let running = await client.isSpatialEncoderRunning()
    if (!running) {
      running = await client.startSpatialEncoder()
    }
    if (!running) {
      return {
        applied: false,
        reason: 'encoder_unavailable',
        cells: [],
        modelsUsed: []
      }
    }

    const payload = await client.searchCells(lon, lat, {
      userQuery,
      taskType: config.taskType,
      topK: config.topK,
      maxDistanceM: config.maxDistanceM
    })
    const macroCellSummary = buildMacroCellSummary(payload, {
      sampleSize: Array.isArray(payload?.cells) ? payload.cells.length : 0,
      modelRoutePrimary: 'town_encoder',
      modelUsage: Array.isArray(payload?.models_used) ? payload.models_used : ['town_encoder']
    })

    return {
      applied: true,
      reason: 'town_encoder_macro_cells',
      cells: Array.isArray(payload?.cells) ? payload.cells : [],
      anchorCellContext: payload?.anchor_cell_context || null,
      modelRoute: payload?.model_route || 'town_encoder',
      modelsUsed: Array.isArray(payload?.models_used) ? payload.models_used : ['town_encoder'],
      searchRadiusM: toPositiveNumberOrNull(payload?.search_radius_m) || config.maxDistanceM,
      perCellRadiusM: toPositiveNumberOrNull(payload?.per_cell_radius_m) || config.perCellRadiusM,
      supportBucketDistribution: macroCellSummary.support_buckets,
      dominantBuckets: macroCellSummary.dominant_buckets,
      sceneTags: macroCellSummary.scene_tags,
      cellMix: macroCellSummary.cell_mix,
      macroUncertainty: macroCellSummary.uncertainty
    }
  } catch (error) {
    return {
      applied: false,
      reason: 'cell_search_failed',
      error: error instanceof Error ? error.message : String(error || ''),
      cells: [],
      modelsUsed: []
    }
  }
}

export async function enrichResultsWithCellContext({
  anchor = null,
  results = [],
  intent = {},
  userQuery = '',
  client = {
    isSpatialEncoderRunning,
    startSpatialEncoder,
    fetchBatchCellContext
  }
} = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    return { applied: false, reason: 'no_results', results: [] }
  }

  const lon = Number(anchor?.lon)
  const lat = Number(anchor?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { applied: false, reason: 'invalid_anchor', results }
  }

  if (!shouldEnrichResultsWithCellContext(results)) {
    return {
      applied: false,
      reason: 'already_enriched',
      results,
      modelsUsed: []
    }
  }

  if (typeof client.fetchBatchCellContext !== 'function') {
    return {
      applied: false,
      reason: 'cell_context_unavailable',
      results,
      modelsUsed: []
    }
  }

  try {
    let running = await client.isSpatialEncoderRunning()
    if (!running) {
      running = await client.startSpatialEncoder()
    }
    if (!running) {
      return {
        applied: false,
        reason: 'encoder_unavailable',
        results,
        modelsUsed: []
      }
    }

    const payload = await client.fetchBatchCellContext(lon, lat, results, {
      intent,
      userQuery
    })
    const merged = mergeCellContextResults(results, payload?.results)

    return {
      applied: true,
      reason: 'town_encoder_context',
      results: merged,
      anchorCellContext: payload?.anchor_cell_context || null,
      modelRoute: payload?.model_route || 'town_encoder',
      modelsUsed: Array.isArray(payload?.models_used) ? payload.models_used : ['town_encoder']
    }
  } catch (error) {
    return {
      applied: false,
      reason: 'cell_context_failed',
      error: error instanceof Error ? error.message : String(error || ''),
      results,
      modelsUsed: []
    }
  }
}

export default {
  enrichResultsWithSpatialEncoder,
  enrichResultsWithCellContext,
  isMacroSpatialTask,
  searchMacroCellsWithTownEncoder,
  shouldEnrichResultsWithCellContext,
  shouldEnrichResultsWithSpatialEncoder
}
