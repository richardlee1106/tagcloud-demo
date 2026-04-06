import { buildEvidenceSelectionContext } from './evidenceSelectors.js'

function normalizeText(value = '') {
  return String(value || '').trim()
}

function extractSearchFilters(plan = {}) {
  const filters = []
  for (const step of Array.isArray(plan?.steps) ? plan.steps : []) {
    if (step?.tool !== 'spatial_core.search_nearby_pois') continue
    const filter = step?.input?.filter
    if (!filter || typeof filter !== 'object') continue
    filters.push({
      category: normalizeText(filter.category),
      subcategory: normalizeText(filter.subcategory),
      target_region: filter.target_region ?? null
    })
  }
  return filters
}

function pickFocusTerms(filters = []) {
  const terms = []
  const seen = new Set()
  for (const filter of Array.isArray(filters) ? filters : []) {
    for (const term of [filter?.subcategory, filter?.category]) {
      const normalized = normalizeText(term)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      terms.push(normalized)
    }
  }
  return terms
}

function resolveTransportModalities(filters = []) {
  const categories = new Set((Array.isArray(filters) ? filters : []).map((item) => normalizeText(item?.category)).filter(Boolean))
  const subcategories = new Set((Array.isArray(filters) ? filters : []).map((item) => normalizeText(item?.subcategory)).filter(Boolean))

  if (subcategories.size > 0) {
    return [...subcategories]
  }

  if (categories.has('交通设施服务') || categories.has('交通出行') || categories.has('公共交通')) {
    return ['地铁站', '公交车站', '火车站', '长途汽车站']
  }

  return []
}

function topBucketNames(evidenceBundle = {}, limit = 3) {
  return (Array.isArray(evidenceBundle?.support_buckets) ? evidenceBundle.support_buckets : [])
    .map((item) => normalizeText(item?.bucket || item))
    .filter(Boolean)
    .slice(0, limit)
}

function topSceneTags(evidenceBundle = {}, limit = 3) {
  return (Array.isArray(evidenceBundle?.scene_tags) ? evidenceBundle.scene_tags : [])
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, limit)
}

function topCellMixLabels(evidenceBundle = {}, limit = 2) {
  return (Array.isArray(evidenceBundle?.cell_mix) ? evidenceBundle.cell_mix : [])
    .map((item) => normalizeText(item?.label))
    .filter(Boolean)
    .slice(0, limit)
}

function buildLegacyEvidenceProfile({
  plan = {},
  evidenceBundle = {}
} = {}) {
  const searchFilters = extractSearchFilters(plan)

  return {
    style: normalizeText(plan?.answer_frame?.style || 'lookup').toLowerCase() || 'lookup',
    task_type: normalizeText(plan?.task_type_hint || '').toLowerCase() || null,
    search_filters: searchFilters,
    focus_terms: pickFocusTerms(searchFilters),
    transport_modalities: resolveTransportModalities(searchFilters),
    dominant_buckets: Array.isArray(evidenceBundle?.dominant_buckets) ? evidenceBundle.dominant_buckets : topBucketNames(evidenceBundle),
    scene_tags: topSceneTags(evidenceBundle),
    cell_mix: topCellMixLabels(evidenceBundle)
  }
}

export function buildEvidenceProfile({
  plan = {},
  evidenceBundle = {},
  intentSpec = null
} = {}) {
  const legacyProfile = buildLegacyEvidenceProfile({
    plan,
    evidenceBundle
  })

  if (!intentSpec) {
    return legacyProfile
  }

  const selectionContext = buildEvidenceSelectionContext({
    intentSpec,
    plan
  })

  return {
    ...legacyProfile,
    style: selectionContext.style,
    task_type: selectionContext.task_type,
    focus_terms: selectionContext.focus_terms.length > 0 ? selectionContext.focus_terms : legacyProfile.focus_terms,
    transport_modalities: selectionContext.transport_modalities.length > 0
      ? selectionContext.transport_modalities
      : legacyProfile.transport_modalities,
    target_entities: selectionContext.target_entity_values,
    include_entities: selectionContext.include_entity_values,
    exclude_entities: selectionContext.exclude_entity_values,
    spatial_scope_mode: selectionContext.spatial_scope_mode,
    aggregation_mode: selectionContext.aggregation_mode,
    answer_mode: selectionContext.answer_mode,
    evidence_requirements: selectionContext.evidence_requirements,
    dominant_buckets: Array.isArray(evidenceBundle?.dominant_buckets) && evidenceBundle.dominant_buckets.length > 0
      ? evidenceBundle.dominant_buckets
      : topBucketNames(evidenceBundle),
    scene_tags: topSceneTags(evidenceBundle),
    cell_mix: topCellMixLabels(evidenceBundle)
  }
}

export default {
  buildEvidenceProfile
}
