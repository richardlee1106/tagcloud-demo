import { buildEvidenceProfile } from './evidenceProfile.js'

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizeStringArray(values = [], limit = 3) {
  const normalized = []
  const seen = new Set()

  for (const value of Array.isArray(values) ? values : []) {
    const text = normalizeText(value)
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
    if (normalized.length >= limit) break
  }

  return normalized
}

function uniqueNames(items = [], limit = 5) {
  const names = []
  const seen = new Set()

  for (const item of Array.isArray(items) ? items : []) {
    const name = normalizeText(item?.name)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= limit) break
  }

  return names
}

function getPrimaryAnchorName(evidenceBundle = {}) {
  const firstAnchor = Array.isArray(evidenceBundle?.anchors) ? evidenceBundle.anchors[0] : null
  return normalizeText(firstAnchor?.display_name || firstAnchor?.place_name)
}

function formatDistance(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  if (numeric < 1000) return `${Math.round(numeric)}米`
  return `${(numeric / 1000).toFixed(1)}公里`
}

function getNearestDistance(evidenceBundle = {}) {
  const candidates = [
    ...(Array.isArray(evidenceBundle?.representative_pois) ? evidenceBundle.representative_pois : []),
    ...(Array.isArray(evidenceBundle?.nearby_pois) ? evidenceBundle.nearby_pois : [])
  ]

  let nearest = null
  for (const item of candidates) {
    const distance = Number(item?.distance_m)
    if (!Number.isFinite(distance)) continue
    if (nearest === null || distance < nearest) nearest = distance
  }

  return formatDistance(nearest)
}

function getHotspotCount(evidenceBundle = {}) {
  const spatialSummary = evidenceBundle?.spatial_summary || {}
  const clusters = spatialSummary?.spatial_clusters
  if (Array.isArray(clusters)) return clusters.length
  if (Array.isArray(clusters?.hotspots)) return clusters.hotspots.length
  return 0
}

function getSupportBucketNames(evidenceBundle = {}, limit = 3) {
  const preferredBuckets = Array.isArray(evidenceBundle?.dominant_buckets) && evidenceBundle.dominant_buckets.length > 0
    ? evidenceBundle.dominant_buckets
    : evidenceBundle?.support_buckets

  const names = []
  const seen = new Set()

  for (const item of Array.isArray(preferredBuckets) ? preferredBuckets : []) {
    const name = typeof item === 'string'
      ? normalizeText(item)
      : normalizeText(item?.bucket || item?.label)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= limit) break
  }

  return names
}

function getEvidenceProfile({ plan = {}, evidenceBundle = {} } = {}) {
  return evidenceBundle?.evidence_profile || buildEvidenceProfile({
    plan,
    evidenceBundle
  })
}

function pickRepresentativeExamples(evidenceBundle = {}, limit = 3) {
  const representative = uniqueNames(evidenceBundle?.representative_pois, limit)
  if (representative.length > 0) return representative
  return uniqueNames(evidenceBundle?.nearby_pois, limit)
}

function determineStyle({ plan = {}, profile = {} } = {}) {
  return normalizeText(profile?.style || plan?.answer_frame?.style || 'lookup').toLowerCase() || 'lookup'
}

function determineCoreAxes({ style = 'lookup', profile = {}, evidenceBundle = {} } = {}) {
  const supportBuckets = getSupportBucketNames(evidenceBundle, 3)
  const transportModalities = normalizeStringArray(profile?.transport_modalities, 3)
  const targetEntities = normalizeStringArray(profile?.target_entities, 3)
  const focusTerms = normalizeStringArray(profile?.focus_terms, 3)

  if (style === 'overview' || style === 'gap' || style === 'comparison') {
    if (supportBuckets.length > 0) return supportBuckets
  }

  if (transportModalities.length > 0) return transportModalities
  if (targetEntities.length > 0) return targetEntities
  if (supportBuckets.length > 0) return supportBuckets
  return focusTerms
}

function buildConstraints({ style = 'lookup', spatialScopeMode = '' } = {}) {
  const constraints = [
    '只引用 brief 中明确存在的证据，不要补写未验证事实。'
  ]

  switch (style) {
    case 'overview':
      constraints.push('先概括区域主轴，再补代表点，不要把局部门店写成区域主轴。')
      break
    case 'comparison':
      constraints.push('先说共同背景，再说关键差异，证据不足时要保留边界。')
      break
    case 'gap':
      constraints.push('先说当前较突出的配套，再谨慎表达可能缺口，不要把证据不足写成确定短板。')
      break
    case 'lookup':
    default:
      constraints.push('先直接给结果，再补数量或距离，不要展开成宏观概览。')
      break
  }

  if (spatialScopeMode === 'geometry') {
    constraints.push('如果范围来自圈选几何，只讨论圈内证据，不要擅自外扩边界。')
  }

  return constraints
}

function buildUncertaintyNote({
  style = 'lookup',
  evidenceBundle = {},
  representativeExamples = [],
  coreAxes = []
} = {}) {
  if (evidenceBundle?.uncertainty?.low_sample_warning) {
    return '当前证据样本偏少，表述需要保守一些。'
  }

  if (representativeExamples.length === 0 && coreAxes.length === 0) {
    return '当前证据不足，必要时应直接说明无法完整回答。'
  }

  if ((style === 'comparison' || style === 'gap') && coreAxes.length < 2) {
    return '当前可比较证据仍然有限，差异判断应保持克制。'
  }

  return null
}

export function buildSynthesisBrief({
  userQuery = '',
  plan = {},
  evidenceBundle = {}
} = {}) {
  const profile = getEvidenceProfile({ plan, evidenceBundle })
  const style = determineStyle({ plan, profile })
  const representativeLimit = style === 'lookup' ? 5 : 3
  const representativeExamples = pickRepresentativeExamples(evidenceBundle, representativeLimit)
  const spatialScopeMode = normalizeText(profile?.spatial_scope_mode)
  const coreAxes = determineCoreAxes({
    style,
    profile,
    evidenceBundle
  })
  const nearbyCount = Array.isArray(evidenceBundle?.nearby_pois) ? evidenceBundle.nearby_pois.length : 0
  const resultCount = nearbyCount > 0 ? nearbyCount : representativeExamples.length

  return {
    query: normalizeText(userQuery) || null,
    anchor: getPrimaryAnchorName(evidenceBundle) || null,
    style,
    task_type: normalizeText(profile?.task_type || style).toLowerCase() || style,
    spatial_scope_mode: spatialScopeMode || null,
    aggregation_mode: normalizeText(profile?.aggregation_mode) || null,
    answer_mode: normalizeText(profile?.answer_mode) || null,
    focus_terms: normalizeStringArray(profile?.focus_terms, 3),
    target_entities: normalizeStringArray(profile?.target_entities, 3),
    transport_modalities: normalizeStringArray(profile?.transport_modalities, 3),
    core_axes: coreAxes,
    scene_tags: normalizeStringArray(profile?.scene_tags, 3),
    spatial_mix: normalizeStringArray(profile?.cell_mix, 2),
    representative_examples: representativeExamples,
    result_count: resultCount,
    nearest_distance: getNearestDistance(evidenceBundle),
    hotspot_count: getHotspotCount(evidenceBundle),
    constraints: buildConstraints({
      style,
      spatialScopeMode
    }),
    uncertainty: buildUncertaintyNote({
      style,
      evidenceBundle,
      representativeExamples,
      coreAxes
    })
  }
}

function summarizeLookupBrief(brief = {}) {
  const representativeExamples = normalizeStringArray(brief?.representative_examples, 5)
  if (representativeExamples.length === 0) {
    return ''
  }

  const summary = [`根据当前空间检索，先给你一版就近结果：${representativeExamples.join('、')}。`]
  const details = []

  const resultCount = Number(brief?.result_count)
  if (Number.isFinite(resultCount) && resultCount > 0) {
    details.push(`共找到 ${resultCount} 个相关点位`)
  }

  const nearestDistance = normalizeText(brief?.nearest_distance)
  if (nearestDistance) {
    details.push(`最近的一处约 ${nearestDistance}`)
  }

  if (details.length > 0) {
    summary.push(`${details.join('，')}。`)
  }

  if (brief?.uncertainty) {
    summary.push(brief.uncertainty)
  }

  return summary.join('')
}

function summarizeOverviewBrief(brief = {}) {
  const anchorName = normalizeText(brief?.anchor) || '该区域'
  const coreAxes = normalizeStringArray(brief?.core_axes, 3)
  const sceneTags = normalizeStringArray(brief?.scene_tags, 2)
  const spatialMix = normalizeStringArray(brief?.spatial_mix, 2)
  const representativeExamples = normalizeStringArray(brief?.representative_examples, 3)
  const hotspotCount = Number(brief?.hotspot_count)

  const sentences = []
  if (coreAxes.length > 0) {
    sentences.push(`从当前证据看，${anchorName}周边的业态重心主要落在${coreAxes.join('、')}。`)
  } else {
    sentences.push(`从当前证据看，${anchorName}周边呈现出较明显的多元配套特征。`)
  }

  if (sceneTags.length > 0 || spatialMix.length > 0) {
    const parts = []
    if (sceneTags.length > 0) parts.push(`整体更像${sceneTags.join('、')}场景`)
    if (spatialMix.length > 0) parts.push(`空间结构上以${spatialMix.join('、')}为主`)
    sentences.push(`${parts.join('，')}。`)
  }

  if (representativeExamples.length > 0) {
    sentences.push(`代表性点位可以先看${representativeExamples.join('、')}。`)
  }

  if (Number.isFinite(hotspotCount) && hotspotCount > 0) {
    sentences.push(`空间上大致可识别出 ${hotspotCount} 处相对活跃的聚集片段。`)
  }

  if (brief?.uncertainty) {
    sentences.push(brief.uncertainty)
  }

  return sentences.join('')
}

function summarizeGapBrief(brief = {}) {
  const anchorName = normalizeText(brief?.anchor) || '该区域'
  const coreAxes = normalizeStringArray(brief?.core_axes, 3)
  if (coreAxes.length === 0) {
    return `当前关于${anchorName}的配套证据还不够充分，暂时更适合先补充检索再判断明显缺口。`
  }

  const summary = `当前证据显示，${anchorName}周边较突出的配套方向包括${coreAxes.join('、')}；至于明显缺口，还需要结合更完整的同口径证据再下结论。`
  return brief?.uncertainty ? `${summary}${brief.uncertainty}` : summary
}

function summarizeComparisonBrief(brief = {}) {
  const coreAxes = normalizeStringArray(brief?.core_axes, 3)
  const representativeExamples = normalizeStringArray(brief?.representative_examples, 4)
  if (coreAxes.length === 0 && representativeExamples.length === 0) {
    return ''
  }

  const pieces = []
  if (coreAxes.length > 0) {
    pieces.push(`当前证据里最值得先比较的维度是${coreAxes.join('、')}`)
  }
  if (representativeExamples.length > 0) {
    pieces.push(`代表性点位包括${representativeExamples.join('、')}`)
  }

  const summary = `${pieces.join('，')}。`
  return brief?.uncertainty ? `${summary}${brief.uncertainty}` : summary
}

export function summarizeSynthesisBrief({
  userQuery = '',
  brief = {}
} = {}) {
  const style = normalizeText(brief?.style).toLowerCase() || 'lookup'

  if (style === 'overview') {
    const overviewSummary = summarizeOverviewBrief(brief)
    if (overviewSummary) return overviewSummary
  }

  if (style === 'comparison') {
    const comparisonSummary = summarizeComparisonBrief(brief)
    if (comparisonSummary) return comparisonSummary
  }

  if (style === 'gap') {
    const gapSummary = summarizeGapBrief(brief)
    if (gapSummary) return gapSummary
  }

  const lookupSummary = summarizeLookupBrief(brief)
  if (lookupSummary) return lookupSummary

  const coreAxes = normalizeStringArray(brief?.core_axes, 3)
  if (coreAxes.length > 0) {
    return `当前证据显示，较突出的业态/配套方向包括：${coreAxes.join('、')}。`
  }

  if (brief?.uncertainty) return brief.uncertainty

  const normalizedQuery = normalizeText(userQuery)
  if (normalizedQuery) {
    return '当前还没有足够的空间证据可供生成完整回答。'
  }

  return '当前还没有足够的空间证据可供生成完整回答。'
}

export default {
  buildSynthesisBrief,
  summarizeSynthesisBrief
}
