import { inferCandidateEntitySemantics } from '../ai/entityOntology.js'

const TASK_TYPE_TO_STYLE = Object.freeze({
  lookup: 'lookup',
  overview: 'overview',
  comparison: 'comparison',
  gap: 'gap',
  suitability: 'gap'
})

const ANSWER_MODE_TO_STYLE = Object.freeze({
  direct_list: 'lookup',
  area_portrait: 'overview',
  contrast: 'comparison',
  recommendation: 'gap'
})

const OVERVIEW_EXCLUDED_CATEGORY_MAINS = new Set([
  '商务住宅',
  '通行设施',
  '地名地址信息',
  '公共设施'
])

const OVERVIEW_EXCLUDED_CATEGORY_SUBS = new Set([
  '停车场',
  '临街院门',
  '交通地名',
  '生活服务场所',
  '共享设备',
  '自动提款机',
  '物流速递',
  '住宅区',
  '家电电子卖场',
  '服装鞋帽皮具店',
  '专卖店',
  '家居建材市场',
  '金融保险服务机构'
])

const OVERVIEW_NOISE_NAME_PATTERNS = [
  /营业厅/u,
  /食堂/u,
  /充电/u,
  /快递/u,
  /宿舍/u,
  /停车场/u,
  /中国移动/u,
  /中国联通/u,
  /中国电信/u,
  /波司登/u,
  /研究会/u,
  /后勤/u,
  /人力资源/u,
  /装饰/u,
  /建材/u,
  /材料/u,
  /防水/u,
  /有限公司/u
]

const OVERVIEW_BUCKET_MAPPING = new Map([
  ['科教文化服务', '教育科研'],
  ['餐饮美食', '餐饮配套'],
  ['购物服务', '购物零售'],
  ['生活服务', '生活服务'],
  ['交通设施服务', '交通出行'],
  ['商务住宅', '居住生活']
])

const OVERVIEW_BUCKET_PRIORITY = new Map([
  ['教育科研', 1],
  ['餐饮配套', 2],
  ['购物零售', 3],
  ['生活服务', 4],
  ['交通出行', 5],
  ['居住生活', 6]
])

const LOCAL_SHOP_CATEGORY_MAINS = new Set([
  '餐饮美食',
  '购物服务'
])

const LOCAL_SHOP_CONCEPTS = new Set([
  '咖啡',
  '火锅',
  '面馆',
  '小吃',
  '中餐',
  '西餐',
  '商超'
])

const PUBLIC_CIVIC_CATEGORY_MAINS = new Set([
  '科教文化服务',
  '医疗保健服务',
  '政府机构及社会团体',
  '风景名胜',
  '体育休闲服务',
  '交通设施服务'
])

const PUBLIC_CIVIC_CATEGORY_SUBS = new Set([
  '博物馆',
  '图书馆',
  '传媒机构',
  '科研机构',
  '科教文化场所',
  '学校',
  '美术馆',
  '展览馆',
  '纪念馆'
])

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizeLowerText(value = '') {
  return normalizeText(value).toLowerCase()
}

function uniqueStrings(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => normalizeText(item)).filter(Boolean))]
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getPoiCategoryMain(item = {}) {
  return normalizeText(item?.categoryMain || item?.category_main)
}

function getPoiCategorySub(item = {}) {
  return normalizeText(item?.categorySub || item?.category_sub || item?.category)
}

function normalizePoiName(value = '') {
  return normalizeText(value)
}

function buildRepresentativeDedupKey(item = {}) {
  const normalizedName = normalizePoiName(item?.name).toLowerCase()
  const lon = toFiniteNumber(item?.lon)
  const lat = toFiniteNumber(item?.lat)

  if (normalizedName && lon !== null && lat !== null) {
    return `${normalizedName}:${lon.toFixed(6)}:${lat.toFixed(6)}`
  }

  if (normalizedName) return normalizedName
  return item?.id ?? `${item?.lon || ''}:${item?.lat || ''}`
}

function resolveOverviewBucketName(categoryMain = '') {
  return OVERVIEW_BUCKET_MAPPING.get(normalizeText(categoryMain)) || normalizeText(categoryMain) || '其他'
}

function isTransportStationPoi(item = {}) {
  const categoryMain = getPoiCategoryMain(item)
  const categorySub = getPoiCategorySub(item)
  const name = normalizePoiName(item?.name)

  if (categoryMain === '交通设施服务' && ['地铁站', '公交车站', '火车站', '高铁站', '长途汽车站'].includes(categorySub)) {
    return true
  }

  return /(地铁站|公交车站|火车站|高铁站|长途汽车站)/u.test(name)
}

function parseTransportStationName(name = '', categorySub = '') {
  const trimmedName = normalizePoiName(name)
  const trimmedCategorySub = normalizeText(categorySub)
  const stationType = trimmedCategorySub || '地铁站'

  const exitPattern = /^(.*?)(地铁站|公交车站|火车站|高铁站|长途汽车站)(?:[A-Z0-9东南西北]+口)$/u
  const exactParenPattern = /^(.*?)[（(](地铁站|公交车站|火车站|高铁站|长途汽车站)[)）]$/u
  const exactSuffixPattern = /^(.*?)(地铁站|公交车站|火车站|高铁站|长途汽车站)$/u

  let matched = trimmedName.match(exitPattern)
  if (matched) {
    return {
      groupKey: `${matched[1]}::${matched[2]}`,
      canonicalName: `${matched[1]}(${matched[2]})`,
      entityRank: 1
    }
  }

  matched = trimmedName.match(exactParenPattern)
  if (matched) {
    return {
      groupKey: `${matched[1]}::${matched[2]}`,
      canonicalName: trimmedName,
      entityRank: 3
    }
  }

  matched = trimmedName.match(exactSuffixPattern)
  if (matched) {
    return {
      groupKey: `${matched[1]}::${matched[2]}`,
      canonicalName: trimmedName,
      entityRank: 2
    }
  }

  if (trimmedCategorySub && trimmedName) {
    return {
      groupKey: `${trimmedName}::${stationType}`,
      canonicalName: trimmedName,
      entityRank: 2
    }
  }

  return null
}

function buildRepresentativeTransportPoi(group = []) {
  const parsed = group
    .map((item) => ({
      item,
      transportInfo: parseTransportStationName(item?.name, getPoiCategorySub(item))
    }))
    .filter((entry) => entry.transportInfo)

  if (parsed.length === 0) return group[0] || null

  const best = parsed
    .slice()
    .sort((left, right) => {
      if (right.transportInfo.entityRank !== left.transportInfo.entityRank) {
        return right.transportInfo.entityRank - left.transportInfo.entityRank
      }

      const rightScore = toFiniteNumber(right.item?.fused_score) ?? Number.NEGATIVE_INFINITY
      const leftScore = toFiniteNumber(left.item?.fused_score) ?? Number.NEGATIVE_INFINITY
      if (rightScore !== leftScore) return rightScore - leftScore

      const leftDistance = toFiniteNumber(left.item?.distance_m) ?? Number.POSITIVE_INFINITY
      const rightDistance = toFiniteNumber(right.item?.distance_m) ?? Number.POSITIVE_INFINITY
      return leftDistance - rightDistance
    })[0]

  const hasExactStationEntity = parsed.some((entry) => entry.transportInfo.entityRank >= 2)

  return {
    ...best.item,
    name: hasExactStationEntity ? normalizePoiName(best.item?.name) : best.transportInfo.canonicalName,
    grouped_poi_count: group.length
  }
}

function getPlanStyle(plan = {}) {
  return normalizeLowerText(plan?.answer_frame?.style || 'lookup') || 'lookup'
}

function getPlanTaskType(plan = {}) {
  return normalizeLowerText(plan?.task_type_hint || '') || null
}

function extractEntityValues(items = []) {
  return uniqueStrings((Array.isArray(items) ? items : []).map((item) => item?.value))
}

function extractEntityValuesByType(items = [], type = '') {
  const normalizedType = normalizeText(type)
  return uniqueStrings(
    (Array.isArray(items) ? items : [])
      .filter((item) => normalizeText(item?.type) === normalizedType)
      .map((item) => item?.value)
  )
}

function buildEvidenceRequirements({ intentSpec = null, style = 'lookup' } = {}) {
  if (intentSpec) {
    return {
      macro_required: Boolean(intentSpec?.evidence_policy?.macro_required),
      micro_required: intentSpec?.evidence_policy?.micro_required !== false
    }
  }

  return {
    macro_required: ['overview', 'comparison', 'gap'].includes(style),
    micro_required: true
  }
}

function normalizeSupportBuckets(supportBuckets = []) {
  return (Array.isArray(supportBuckets) ? supportBuckets : [])
    .map((entry) => ({
      bucket: normalizeText(entry?.bucket || entry),
      count: Math.max(0, Number(entry?.count) || 0)
    }))
    .filter((entry) => entry.bucket)
}

function resolveStyleFromIntent(intentSpec = null, plan = {}) {
  const taskType = normalizeLowerText(intentSpec?.task_type || '')
  if (taskType && TASK_TYPE_TO_STYLE[taskType]) {
    return TASK_TYPE_TO_STYLE[taskType]
  }

  const answerMode = normalizeLowerText(intentSpec?.answer_mode || '')
  if (answerMode && ANSWER_MODE_TO_STYLE[answerMode]) {
    return ANSWER_MODE_TO_STYLE[answerMode]
  }

  return getPlanStyle(plan)
}

/**
 * Central intent-to-selection context for Phase 2.
 * It keeps the legacy plan fallback, but when intent_spec exists,
 * every downstream selector reads the same normalized view.
 */
export function buildEvidenceSelectionContext({
  intentSpec = null,
  plan = {}
} = {}) {
  const hasIntentSpec = Boolean(intentSpec)
  const style = resolveStyleFromIntent(intentSpec, plan)
  const taskType = hasIntentSpec
    ? normalizeLowerText(intentSpec?.task_type || '') || 'lookup'
    : getPlanTaskType(plan)
  const targetEntities = Array.isArray(intentSpec?.target_entities) ? intentSpec.target_entities : []
  const includeEntities = Array.isArray(intentSpec?.include_entities) ? intentSpec.include_entities : []
  const excludeEntities = Array.isArray(intentSpec?.exclude_entities) ? intentSpec.exclude_entities : []
  const targetTransportModalities = extractEntityValuesByType(targetEntities, 'transport_node')
  const includeTransportModalities = extractEntityValuesByType(includeEntities, 'transport_node')
  const excludeTransportModalities = extractEntityValuesByType(excludeEntities, 'transport_node')
  const transportModalities = uniqueStrings([
    ...targetTransportModalities,
    ...includeTransportModalities
  ])
  const targetPoiConcepts = extractEntityValuesByType(targetEntities, 'poi')
  const includePoiConcepts = extractEntityValuesByType(includeEntities, 'poi')
  const excludePoiConcepts = extractEntityValuesByType(excludeEntities, 'poi')
  const evidenceRequirements = buildEvidenceRequirements({ intentSpec, style })
  const spatialScopeMode = normalizeLowerText(intentSpec?.spatial_scope?.mode || '')
  const aggregationMode = normalizeLowerText(intentSpec?.aggregation_mode || '')
  const answerMode = normalizeLowerText(intentSpec?.answer_mode || '')
  const focusTerms = uniqueStrings(intentSpec?.semantic_focus_terms || [])
  const targetEntityValues = extractEntityValues(targetEntities)
  const includeEntityValues = extractEntityValues(includeEntities)
  const excludeEntityValues = extractEntityValues(excludeEntities)
  const transportFocused = transportModalities.length > 0 || excludeTransportModalities.length > 0
  const representationPolicy = intentSpec?.representation_policy || {}
  const representativeExampleCount = hasIntentSpec
    ? Math.max(1, Number(representationPolicy?.representative_example_count) || (style === 'lookup' ? 5 : 3))
    : 5
  const allowLocalShopAsRegionRepresentative = hasIntentSpec
    ? representationPolicy?.allow_local_shop_as_region_representative !== false
    : false
  const preferPublicCivicExamples = hasIntentSpec
    ? Boolean(representationPolicy?.prefer_public_civic_examples)
    : style === 'overview'
  const preferAggregatedBuckets = evidenceRequirements.macro_required ||
    ['summary', 'distribution', 'comparison'].includes(aggregationMode) ||
    spatialScopeMode === 'geometry' ||
    ['overview', 'comparison', 'gap'].includes(style)
  const prefersAreaPortraitRepresentatives =
    ['overview', 'comparison', 'gap'].includes(style) &&
    !transportFocused &&
    (!allowLocalShopAsRegionRepresentative || preferPublicCivicExamples)

  return {
    has_intent_spec: hasIntentSpec,
    style,
    task_type: taskType,
    spatial_scope_mode: spatialScopeMode || null,
    aggregation_mode: aggregationMode || null,
    answer_mode: answerMode || null,
    focus_terms: focusTerms,
    target_entity_values: targetEntityValues,
    include_entity_values: includeEntityValues,
    exclude_entity_values: excludeEntityValues,
    target_transport_modalities: targetTransportModalities,
    transport_modalities: transportModalities,
    exclude_transport_modalities: excludeTransportModalities,
    target_poi_concepts: uniqueStrings([...targetPoiConcepts, ...includePoiConcepts]),
    exclude_poi_concepts: excludePoiConcepts,
    evidence_requirements: evidenceRequirements,
    representative_example_count: representativeExampleCount,
    allow_local_shop_as_region_representative: allowLocalShopAsRegionRepresentative,
    prefer_public_civic_examples: preferPublicCivicExamples,
    prefer_aggregated_buckets: preferAggregatedBuckets,
    prefers_area_portrait_representatives: prefersAreaPortraitRepresentatives
  }
}

function buildCandidateConceptSet(candidate = {}) {
  return new Set(inferCandidateEntitySemantics(candidate).concepts || [])
}

function isLikelyLocalShop(candidate = {}) {
  const categoryMain = getPoiCategoryMain(candidate)
  if (LOCAL_SHOP_CATEGORY_MAINS.has(categoryMain)) {
    return true
  }

  const candidateConcepts = buildCandidateConceptSet(candidate)
  for (const concept of candidateConcepts) {
    if (LOCAL_SHOP_CONCEPTS.has(concept)) {
      return true
    }
  }

  return false
}

function isPublicCivicPoi(candidate = {}) {
  const categoryMain = getPoiCategoryMain(candidate)
  const categorySub = getPoiCategorySub(candidate)

  if (PUBLIC_CIVIC_CATEGORY_MAINS.has(categoryMain)) {
    return true
  }

  return PUBLIC_CIVIC_CATEGORY_SUBS.has(categorySub)
}

function candidateMatchesConcepts(candidate = {}, concepts = []) {
  const normalizedConcepts = uniqueStrings(concepts)
  if (normalizedConcepts.length === 0) return false

  const candidateConcepts = buildCandidateConceptSet(candidate)
  return normalizedConcepts.some((concept) => candidateConcepts.has(concept))
}

function shouldKeepPoi(candidate = {}, context = {}) {
  if (!candidate || typeof candidate !== 'object') return false

  if (candidateMatchesConcepts(candidate, context.exclude_transport_modalities)) {
    return false
  }

  if (candidateMatchesConcepts(candidate, context.exclude_poi_concepts)) {
    return false
  }

  if (context.target_transport_modalities.length > 0) {
    return candidateMatchesConcepts(candidate, context.target_transport_modalities)
  }

  if (context.target_poi_concepts.length > 0) {
    return candidateMatchesConcepts(candidate, context.target_poi_concepts)
  }

  return true
}

function filterPoisForIntent(nearbyPois = [], context = {}) {
  return (Array.isArray(nearbyPois) ? nearbyPois : []).filter((item) => shouldKeepPoi(item, context))
}

function isOverviewRepresentativeCandidate(item = {}, anchor = null, context = {}) {
  const name = normalizePoiName(item?.name)
  const categoryMain = getPoiCategoryMain(item)
  const categorySub = getPoiCategorySub(item)
  const distance = toFiniteNumber(item?.distance_m)
  const anchorName = normalizePoiName(anchor?.display_name || anchor?.place_name)

  if (!name) return false
  if (anchorName && name === anchorName) return false
  if (distance !== null && distance <= 5) return false
  if (OVERVIEW_EXCLUDED_CATEGORY_MAINS.has(categoryMain)) return false
  if (OVERVIEW_EXCLUDED_CATEGORY_SUBS.has(categorySub)) return false
  if (OVERVIEW_NOISE_NAME_PATTERNS.some((pattern) => pattern.test(name))) return false
  if (context.allow_local_shop_as_region_representative === false && isLikelyLocalShop(item)) return false

  return true
}

function isOverviewBucketCandidate(item = {}, anchor = null) {
  const name = normalizePoiName(item?.name)
  const categoryMain = getPoiCategoryMain(item)
  const categorySub = getPoiCategorySub(item)
  const distance = toFiniteNumber(item?.distance_m)
  const anchorName = normalizePoiName(anchor?.display_name || anchor?.place_name)

  if (!name) return false
  if (anchorName && name === anchorName) return false
  if (distance !== null && distance <= 5) return false
  if (OVERVIEW_EXCLUDED_CATEGORY_MAINS.has(categoryMain)) return false
  if (['停车场', '临街院门', '交通地名', '住宅区'].includes(categorySub)) return false

  return true
}

function buildOverviewRepresentativeScore(item = {}, supportBuckets = [], context = {}) {
  const normalizedBuckets = normalizeSupportBuckets(supportBuckets)
  const totalBucketCount = normalizedBuckets.reduce((sum, entry) => sum + entry.count, 0)
  const candidateBucket = resolveOverviewBucketName(getPoiCategoryMain(item))
  const bucketEntry = normalizedBuckets.find((entry) => entry.bucket === candidateBucket)
  const bucketRatio = totalBucketCount > 0 && bucketEntry
    ? bucketEntry.count / totalBucketCount
    : 0
  const bucketRank = normalizedBuckets.findIndex((entry) => entry.bucket === candidateBucket)

  let bonus = bucketRatio * 1.2
  if (bucketRank === 0) bonus += 0.6
  else if (bucketRank === 1) bonus += 0.3

  if (context.prefer_public_civic_examples && isPublicCivicPoi(item)) {
    bonus += 0.6
  }

  if (!context.prefer_public_civic_examples && isLikelyLocalShop(item)) {
    bonus += 0.15
  }

  return (toFiniteNumber(item?.fused_score) ?? 0) + bonus
}

function buildOverviewBucketQuotaMap(supportBuckets = [], representativeExampleCount = 3) {
  const normalizedBuckets = normalizeSupportBuckets(supportBuckets)
    .filter((entry) => entry.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      const leftPriority = OVERVIEW_BUCKET_PRIORITY.get(left.bucket) || 99
      const rightPriority = OVERVIEW_BUCKET_PRIORITY.get(right.bucket) || 99
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      return left.bucket.localeCompare(right.bucket, 'zh-Hans-CN')
    })

  const totalSlots = Math.max(1, Number(representativeExampleCount) || 3)
  if (normalizedBuckets.length === 0) return new Map()

  const quotaByBucket = new Map()
  let remainingSlots = totalSlots

  for (const entry of normalizedBuckets) {
    if (remainingSlots <= 0) break
    quotaByBucket.set(entry.bucket, 1)
    remainingSlots -= 1
  }

  while (remainingSlots > 0) {
    const nextBucket = normalizedBuckets
      .slice()
      .sort((left, right) => {
        const leftQuota = quotaByBucket.get(left.bucket) || 0
        const rightQuota = quotaByBucket.get(right.bucket) || 0
        const leftDemand = left.count / (leftQuota + 1)
        const rightDemand = right.count / (rightQuota + 1)
        if (rightDemand !== leftDemand) return rightDemand - leftDemand
        return (quotaByBucket.get(left.bucket) || 0) - (quotaByBucket.get(right.bucket) || 0)
      })[0]

    quotaByBucket.set(nextBucket.bucket, (quotaByBucket.get(nextBucket.bucket) || 0) + 1)
    remainingSlots -= 1
  }

  return quotaByBucket
}

function resolveOverviewCategoryQuota(categoryMain = '', supportBuckets = [], context = {}) {
  const bucketName = resolveOverviewBucketName(categoryMain)
  const quotaByBucket = buildOverviewBucketQuotaMap(
    supportBuckets,
    context.representative_example_count
  )

  if (quotaByBucket.has(bucketName)) {
    return quotaByBucket.get(bucketName)
  }

  return 1
}

function buildOverviewRepresentativePois(candidates = [], anchor = null, supportBuckets = [], context = {}) {
  const filtered = (Array.isArray(candidates) ? candidates : []).filter((item) => (
    isOverviewRepresentativeCandidate(item, anchor, context)
  ))
  if (filtered.length === 0) return []

  const selected = []
  const selectedKeys = new Set()
  const categoryCounts = new Map()
  const maxItems = Math.max(1, Number(context.representative_example_count) || 3)
  const ranked = filtered.slice().sort((left, right) => {
    const rightScore = buildOverviewRepresentativeScore(right, supportBuckets, context)
    const leftScore = buildOverviewRepresentativeScore(left, supportBuckets, context)
    if (rightScore !== leftScore) return rightScore - leftScore

    const leftDistance = toFiniteNumber(left?.distance_m) ?? Number.POSITIVE_INFINITY
    const rightDistance = toFiniteNumber(right?.distance_m) ?? Number.POSITIVE_INFINITY
    return leftDistance - rightDistance
  })

  for (const item of ranked) {
    const categoryMain = getPoiCategoryMain(item) || 'unknown'
    const used = categoryCounts.get(categoryMain) || 0
    const quota = resolveOverviewCategoryQuota(categoryMain, supportBuckets, context)
    if (used >= quota) continue
    selected.push(item)
    selectedKeys.add(buildRepresentativeDedupKey(item))
    categoryCounts.set(categoryMain, used + 1)
    if (selected.length >= maxItems) {
      return selected
    }
  }

  for (const item of ranked) {
    if (selected.length >= maxItems) break
    const key = buildRepresentativeDedupKey(item)
    if (selectedKeys.has(key)) continue
    selected.push(item)
    selectedKeys.add(key)
  }

  return selected
}

function dedupeRepresentativePois(nearbyPois = []) {
  const deduped = new Map()
  const transportGroups = new Map()

  for (const item of Array.isArray(nearbyPois) ? nearbyPois : []) {
    if (isTransportStationPoi(item)) {
      const transportInfo = parseTransportStationName(item?.name, getPoiCategorySub(item))
      if (transportInfo?.groupKey) {
        const existingGroup = transportGroups.get(transportInfo.groupKey) || []
        existingGroup.push(item)
        transportGroups.set(transportInfo.groupKey, existingGroup)
        continue
      }
    }

    const key = buildRepresentativeDedupKey(item)
    const currentScore = toFiniteNumber(item?.fused_score) ?? Number.NEGATIVE_INFINITY
    const existing = deduped.get(key)
    const existingScore = toFiniteNumber(existing?.fused_score) ?? Number.NEGATIVE_INFINITY

    if (!existing || currentScore > existingScore) {
      deduped.set(key, item)
    }
  }

  for (const group of transportGroups.values()) {
    const representative = buildRepresentativeTransportPoi(group)
    if (!representative) continue

    const key = buildRepresentativeDedupKey(representative)
    const currentScore = toFiniteNumber(representative?.fused_score) ?? Number.NEGATIVE_INFINITY
    const existing = deduped.get(key)
    const existingScore = toFiniteNumber(existing?.fused_score) ?? Number.NEGATIVE_INFINITY

    if (!existing || currentScore > existingScore) {
      deduped.set(key, representative)
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const rightScore = toFiniteNumber(right?.fused_score) ?? Number.NEGATIVE_INFINITY
    const leftScore = toFiniteNumber(left?.fused_score) ?? Number.NEGATIVE_INFINITY
    if (rightScore !== leftScore) return rightScore - leftScore

    const leftDistance = toFiniteNumber(left?.distance_m) ?? Number.POSITIVE_INFINITY
    const rightDistance = toFiniteNumber(right?.distance_m) ?? Number.POSITIVE_INFINITY
    return leftDistance - rightDistance
  })
}

function inferAggregatedSupportBuckets(nearbyPois = [], anchor = null) {
  const counts = new Map()

  for (const item of Array.isArray(nearbyPois) ? nearbyPois : []) {
    if (!isOverviewBucketCandidate(item, anchor)) continue

    const categoryMain = getPoiCategoryMain(item)
    const bucket = OVERVIEW_BUCKET_MAPPING.get(categoryMain)
    if (!bucket) continue

    counts.set(bucket, (counts.get(bucket) || 0) + 1)
  }

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
  if (!total) {
    return {
      supportBuckets: [],
      supportBucketMetrics: []
    }
  }

  const ranked = [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      const leftPriority = OVERVIEW_BUCKET_PRIORITY.get(left[0]) || 99
      const rightPriority = OVERVIEW_BUCKET_PRIORITY.get(right[0]) || 99
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      return String(left[0]).localeCompare(String(right[0]), 'zh-Hans-CN')
    })
    .slice(0, 3)

  return {
    supportBuckets: ranked.map(([bucket, count]) => ({ bucket, count })),
    supportBucketMetrics: ranked.map(([bucket, count]) => ({
      bucket,
      count,
      ratio: Number((count / total).toFixed(3))
    }))
  }
}

function deriveMetricsFromBuckets(supportBuckets = []) {
  const normalized = (Array.isArray(supportBuckets) ? supportBuckets : [])
    .map((item) => ({
      bucket: normalizeText(item?.bucket || ''),
      count: Math.max(0, Number(item?.count) || 0)
    }))
    .filter((item) => item.bucket && item.count > 0)

  const total = normalized.reduce((sum, item) => sum + item.count, 0)
  if (!total) return []

  return normalized.map((item) => ({
    bucket: item.bucket,
    count: item.count,
    ratio: Number((item.count / total).toFixed(3))
  }))
}

export function selectSupportBuckets({
  explicitSupportBuckets = [],
  nearbyPois = [],
  anchor = null,
  intentSpec = null,
  plan = {}
} = {}) {
  if (Array.isArray(explicitSupportBuckets) && explicitSupportBuckets.length > 0) {
    return explicitSupportBuckets
  }

  const context = buildEvidenceSelectionContext({ intentSpec, plan })
  if (!context.prefer_aggregated_buckets) {
    return []
  }

  const filteredPois = filterPoisForIntent(nearbyPois, context)
  return inferAggregatedSupportBuckets(filteredPois, anchor).supportBuckets
}

export function selectSupportBucketMetrics({
  explicitSupportBucketMetrics = [],
  supportBuckets = [],
  nearbyPois = [],
  anchor = null,
  intentSpec = null,
  plan = {}
} = {}) {
  if (Array.isArray(explicitSupportBucketMetrics) && explicitSupportBucketMetrics.length > 0) {
    return explicitSupportBucketMetrics
  }

  if (Array.isArray(supportBuckets) && supportBuckets.length > 0) {
    return deriveMetricsFromBuckets(supportBuckets)
  }

  const context = buildEvidenceSelectionContext({ intentSpec, plan })
  if (!context.prefer_aggregated_buckets) {
    return []
  }

  const filteredPois = filterPoisForIntent(nearbyPois, context)
  return inferAggregatedSupportBuckets(filteredPois, anchor).supportBucketMetrics
}

export function selectRepresentativePois({
  nearbyPois = [],
  anchor = null,
  supportBuckets = [],
  intentSpec = null,
  plan = {}
} = {}) {
  const context = buildEvidenceSelectionContext({ intentSpec, plan })
  const filteredPois = filterPoisForIntent(nearbyPois, context)
  const dedupedValues = dedupeRepresentativePois(filteredPois)
  const selected = context.prefers_area_portrait_representatives
    ? buildOverviewRepresentativePois(dedupedValues, anchor, supportBuckets, context)
    : dedupedValues

  return selected.slice(0, context.representative_example_count)
}

export default {
  buildEvidenceSelectionContext,
  selectRepresentativePois,
  selectSupportBuckets,
  selectSupportBucketMetrics
}
