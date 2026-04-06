import { resolveEntityIntentFromText } from '../../ai/entityOntology.js'

export const CORE_SUPPORT_BUCKETS = Object.freeze([
  '餐饮配套',
  '零售购物',
  '生活服务',
  '交通出行',
  '医疗健康',
  '休闲娱乐'
])

export const SUPPORT_BUCKET_RULES = Object.freeze([
  { bucket: '餐饮配套', keywords: ['餐', '饮', '餐厅', '餐馆', '饭店', '咖啡', '奶茶', '甜品', '火锅', '烧烤', '小吃', '蛋糕', '茶饮', '中国菜', '中餐', '面馆', '料理', '快餐'] },
  { bucket: '零售购物', keywords: ['超市', '商超', '商场', '百货', '便利店', '服装', '鞋帽', '购物', '零售', '商业街'] },
  { bucket: '生活服务', keywords: ['快递', '物流', '美容', '理发', '洗衣', '维修', '家政', '通讯', '营业厅', '银行'] },
  { bucket: '交通出行', keywords: ['地铁', '公交', '停车', '交通', '道路', '路', '车站', '出入口'] },
  { bucket: '医疗健康', keywords: ['医院', '诊所', '药店', '健康', '卫生', '医疗'] },
  { bucket: '教育服务', keywords: ['学校', '大学', '中学', '小学', '培训', '教育', '成长中心', '学院'] },
  { bucket: '休闲娱乐', keywords: ['公园', '影院', '网咖', '健身', 'KTV', '景区', '景点', '体育', '文娱'] },
  { bucket: '办公商务', keywords: ['写字楼', '商务', '大厦', '园区', '办公', '企业', '科技园'] }
])

const TASK_BUCKET_PRIORS = Object.freeze({
  nearby_lookup: Object.freeze({}),
  support_gap_analysis: Object.freeze({
    零售购物: 6,
    餐饮配套: 6,
    生活服务: 4,
    医疗健康: 3,
    休闲娱乐: 3,
    办公商务: 1,
    交通出行: -2,
    教育服务: -6,
    其他配套: -10
  }),
  area_overview: Object.freeze({
    零售购物: 4,
    餐饮配套: 4,
    生活服务: 2,
    医疗健康: 2,
    休闲娱乐: 2,
    办公商务: 1,
    交通出行: 0,
    教育服务: -1,
    其他配套: -8
  }),
  site_suitability: Object.freeze({
    零售购物: 7,
    餐饮配套: 7,
    生活服务: 4,
    医疗健康: 3,
    休闲娱乐: 4,
    办公商务: 2,
    交通出行: 1,
    教育服务: -4,
    其他配套: -10
  }),
  region_comparison: Object.freeze({
    零售购物: 7,
    餐饮配套: 7,
    生活服务: 4,
    医疗健康: 3,
    休闲娱乐: 4,
    办公商务: 2,
    交通出行: 1,
    教育服务: -5,
    其他配套: -10
  })
})

const GENERIC_MACRO_EXAMPLE_NAMES = new Set([
  '购物消费',
  '餐饮美食',
  '生活服务',
  '交通设施',
  '医疗保健',
  '科教文化',
  '商务住宅',
  '公司企业',
  '汽车相关',
  '酒店住宿',
  '休闲娱乐',
  '旅游景点',
  '金融机构',
  '运动健身',
  '商业活跃',
  '教育片区',
  '高校周边',
  '校园周边',
  '混合业态',
  '教育服务',
  '零售购物',
  '餐饮配套',
  '交通出行',
  '医疗健康',
  '办公商务',
  '其他配套'
])

const GENERIC_INFRA_CATEGORY_RE = /(学校|大学|学院|教学楼|停车场|公交车站|地铁站|交通地名|道路名|道路附属|出入口|通道)/u
const CONCRETE_OPERATIONAL_CATEGORY_RE = /(医院|诊所|药店|咖啡|奶茶|餐馆|中国菜|中餐|面馆|火锅|小吃|便利店|超市|商店|商场|服装|家居|市场|酒店|宾馆|健身|影院|银行|营业厅|美容|理发|快递|物流)/u
const GENERIC_INFRA_NAME_RE = /(大学|学院|学校|教学楼|图书馆|实验楼|办公楼|停车场|公交站|地铁站|出入口|校区|北门|南门|东门|西门|大道|路$|街$|巷$|非机动车停放点)/u

function normalizeTaskType(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || 'nearby_lookup'
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeTextList(value = []) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )]
}

export function normalizeSceneTags(value = []) {
  return normalizeTextList(value).slice(0, 8)
}

export function normalizeCellMix(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const label = String(item?.label || item?.name || item?.region_name || item?.regionName || '').trim()
      if (!label) return null

      const count = Math.max(0, Number(item?.count) || 0)
      const ratio = toFiniteNumber(item?.ratio)

      return {
        label,
        count,
        ratio: ratio === null ? null : Number(ratio.toFixed(4))
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return (right.ratio || 0) - (left.ratio || 0)
    })
}

export function normalizeSupportBucketMetrics(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const bucket = String(item?.bucket || item?.name || '').trim()
      if (!bucket) return null

      const count = Math.max(0, Number(item?.count) || 0)
      const share = toFiniteNumber(item?.share ?? item?.ratio)
      const sharePct = toFiniteNumber(item?.share_pct ?? item?.sharePct)

      return {
        bucket,
        count,
        share: share === null ? null : Number(share.toFixed(4)),
        share_pct: sharePct === null ? (share === null ? null : Math.round(share * 100)) : Math.round(sharePct)
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      if ((right.share ?? -1) !== (left.share ?? -1)) return (right.share ?? -1) - (left.share ?? -1)
      if (right.count !== left.count) return right.count - left.count
      return left.bucket.localeCompare(right.bucket, 'zh-CN')
    })
}

export function buildSupportBucketMetrics(supportBuckets = []) {
  const normalizedBuckets = normalizeSupportBuckets(supportBuckets)
  const totalCount = normalizedBuckets.reduce((sum, item) => sum + Math.max(0, Number(item?.count) || 0), 0)

  return normalizedSupportBucketMetrics(
    normalizedBuckets.map((item) => {
      const count = Math.max(0, Number(item?.count) || 0)
      const share = totalCount > 0 ? count / totalCount : 0
      return {
        bucket: item.bucket,
        count,
        share,
        share_pct: totalCount > 0 ? Math.round(share * 100) : 0
      }
    })
  )
}

function normalizedSupportBucketMetrics(value = []) {
  return normalizeSupportBucketMetrics(value)
}

export function normalizePopulationMetrics(value = null) {
  const source = value && typeof value === 'object' ? value : {}
  const sampleSize = Math.max(0, Number(source?.sample_size ?? source?.sampleSize) || 0)
  const avgDensity = toFiniteNumber(source?.avg_density ?? source?.avgDensity)
  const medianDensity = toFiniteNumber(source?.median_density ?? source?.medianDensity)
  const p75Density = toFiniteNumber(source?.p75_density ?? source?.p75Density)
  const maxDensity = toFiniteNumber(source?.max_density ?? source?.maxDensity)
  const hotspotCellCount = Math.max(0, Number(source?.hotspot_cell_count ?? source?.hotspotCellCount) || 0)
  const highDensityCellRatio = toFiniteNumber(source?.high_density_cell_ratio ?? source?.highDensityCellRatio)
  const densityLevel = String((source?.density_level ?? source?.densityLevel) || '').trim().toLowerCase() || null

  if (
    sampleSize === 0 &&
    avgDensity === null &&
    medianDensity === null &&
    p75Density === null &&
    maxDensity === null &&
    hotspotCellCount === 0 &&
    highDensityCellRatio === null &&
    !densityLevel
  ) {
    return null
  }

  return {
    sample_size: sampleSize,
    avg_density: avgDensity === null ? null : Math.round(avgDensity),
    median_density: medianDensity === null ? null : Math.round(medianDensity),
    p75_density: p75Density === null ? null : Math.round(p75Density),
    max_density: maxDensity === null ? null : Math.round(maxDensity),
    hotspot_cell_count: hotspotCellCount,
    high_density_cell_ratio: highDensityCellRatio === null ? null : Number(highDensityCellRatio.toFixed(4)),
    density_level: densityLevel
  }
}

export function buildPopulationMetricsFromCells(cells = []) {
  const densities = (Array.isArray(cells) ? cells : [])
    .map((item) => toFiniteNumber(item?.population_density ?? item?.populationDensity))
    .filter((item) => item !== null)

  if (densities.length === 0) return null

  const sorted = densities.slice().sort((left, right) => left - right)
  const sampleSize = sorted.length
  const avgDensity = sorted.reduce((sum, item) => sum + item, 0) / sampleSize
  const medianDensity = sorted[Math.floor(sampleSize / 2)]
  const p75Density = sorted[Math.min(sampleSize - 1, Math.floor((sampleSize - 1) * 0.75))]
  const maxDensity = sorted[sampleSize - 1]
  const hotspotCellCount = sorted.filter((item) => item >= 22000).length
  const highDensityCellRatio = hotspotCellCount / sampleSize

  let densityLevel = 'low'
  if (avgDensity >= 20000 || highDensityCellRatio >= 0.5) {
    densityLevel = 'high'
  } else if (avgDensity >= 12000) {
    densityLevel = 'medium'
  }

  return normalizePopulationMetrics({
    sample_size: sampleSize,
    avg_density: avgDensity,
    median_density: medianDensity,
    p75_density: p75Density,
    max_density: maxDensity,
    hotspot_cell_count: hotspotCellCount,
    high_density_cell_ratio: highDensityCellRatio,
    density_level: densityLevel
  })
}

function buildSupportBucketTexts(item = null) {
  if (item && typeof item === 'object') {
    const name = String(item?.name || '').trim()
    const category = String(item?.category || '').trim()
    const semantic = resolveEntityIntentFromText([name, category].filter(Boolean).join(' '))
    return [
      category,
      name,
      semantic.primaryConcept || '',
      ...(Array.isArray(semantic.concepts) ? semantic.concepts : [])
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  }

  return [String(item || '').trim()].filter(Boolean)
}

export function inferSupportBucket(item = null) {
  const bucketTexts = buildSupportBucketTexts(item)
  if (!bucketTexts.length) return '其他配套'

  const matched = SUPPORT_BUCKET_RULES.find(({ keywords }) =>
    keywords.some((keyword) => bucketTexts.some((text) => text.includes(keyword)))
  )

  return matched?.bucket || '其他配套'
}

export function isInfrastructureLikePoi(item = null) {
  const name = String(item?.name || '').trim()
  const category = String(item?.category || '').trim()

  if (CONCRETE_OPERATIONAL_CATEGORY_RE.test(category)) {
    return false
  }

  if (GENERIC_INFRA_CATEGORY_RE.test(category)) {
    return true
  }

  return GENERIC_INFRA_NAME_RE.test(name)
}

export function summarizeSupportBuckets(results = []) {
  const stats = new Map()

  ;(Array.isArray(results) ? results : []).forEach((item) => {
    const bucket = inferSupportBucket(item)
    if (!stats.has(bucket)) {
      stats.set(bucket, {
        bucket,
        count: 0,
        examples: [],
        representative_categories: [],
        min_distance_m: Number.POSITIVE_INFINITY
      })
    }

    const current = stats.get(bucket)
    current.count += 1
    current.min_distance_m = Math.min(
      current.min_distance_m,
      toFiniteNumber(item?.distance_m) ?? Number.POSITIVE_INFINITY
    )

    const name = String(item?.name || '').trim()
    if (name && !current.examples.includes(name) && current.examples.length < 3) {
      current.examples.push(name)
    }

    const category = String(item?.category || '').trim()
    if (category && !current.representative_categories.includes(category) && current.representative_categories.length < 3) {
      current.representative_categories.push(category)
    }
  })

  return [...stats.values()]
    .map((item) => ({
      ...item,
      min_distance_m: Number.isFinite(item.min_distance_m) ? Math.round(item.min_distance_m) : null
    }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return (left.min_distance_m ?? Number.POSITIVE_INFINITY) - (right.min_distance_m ?? Number.POSITIVE_INFINITY)
    })
}

export function enrichSupportBucketsWithResults(supportBuckets = [], results = []) {
  const normalizedBuckets = normalizeSupportBuckets(supportBuckets)
  if (normalizedBuckets.length === 0) return normalizedBuckets

  const resultStatsMap = new Map(
    summarizeSupportBuckets(results).map((item) => [item.bucket, item])
  )

  return normalizedBuckets.map((bucket) => {
    const resultStats = resultStatsMap.get(bucket.bucket)
    if (!resultStats) return bucket

    return {
      ...bucket,
      examples: resultStats.examples.length > 0 ? resultStats.examples : bucket.examples,
      representative_categories: resultStats.representative_categories.length > 0
        ? resultStats.representative_categories
        : bucket.representative_categories,
      min_distance_m: resultStats.min_distance_m ?? bucket.min_distance_m
    }
  })
}

export function normalizeSupportBuckets(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const bucket = String(item?.bucket || item?.name || '').trim()
      if (!bucket) return null

      return {
        bucket,
        count: Math.max(0, Number(item?.count) || 0),
        examples: normalizeTextList(item?.examples),
        representative_categories: normalizeTextList(
          item?.representative_categories || item?.representativeCategories
        ),
        min_distance_m: toFiniteNumber(item?.min_distance_m ?? item?.minDistance)
      }
    })
    .filter(Boolean)
}

function countReadableBucketExamples(bucket = {}, representativePois = []) {
  const exampleNames = normalizeTextList(bucket?.examples)
    .filter((item) => !GENERIC_MACRO_EXAMPLE_NAMES.has(item))
    .filter((item) => !GENERIC_INFRA_NAME_RE.test(item))

  const representativeNames = (Array.isArray(representativePois) ? representativePois : [])
    .filter((item) => String(item?.support_bucket || item?.supportBucket || '').trim() === String(bucket?.bucket || '').trim())
    .filter((item) => !isInfrastructureLikePoi(item))
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean)

  return [...new Set([...exampleNames, ...representativeNames])].length
}

export function hasReadableBucketEvidence(bucket = {}, representativePois = []) {
  return countReadableBucketExamples(bucket, representativePois) > 0
}

export function buildVerifiedSupportBucketMetrics(
  supportBuckets = [],
  representativePois = [],
  { taskType = 'nearby_lookup' } = {}
) {
  const orderedBuckets = sortSupportBucketsForTask(supportBuckets, representativePois, { taskType })
  const verifiedBuckets = orderedBuckets.filter((bucket) => hasReadableBucketEvidence(bucket, representativePois))
  const bucketsForMetrics = verifiedBuckets.length > 0 ? verifiedBuckets : orderedBuckets

  return buildSupportBucketMetrics(bucketsForMetrics)
}

export function scoreSupportBucketForTask(bucket = {}, representativePois = [], { taskType = 'nearby_lookup' } = {}) {
  const normalizedBucket = normalizeSupportBuckets([bucket])[0]
  if (!normalizedBucket) return Number.NEGATIVE_INFINITY

  const normalizedTaskType = normalizeTaskType(taskType)
  const priors = TASK_BUCKET_PRIORS[normalizedTaskType] || TASK_BUCKET_PRIORS.nearby_lookup
  const readableEvidenceCount = countReadableBucketExamples(normalizedBucket, representativePois)
  const genericPenalty = normalizedBucket.bucket === '其他配套' ? 2 : 0

  return (
    normalizedBucket.count +
    (priors[normalizedBucket.bucket] || 0) +
    Math.min(readableEvidenceCount, 3) * 1.5 -
    genericPenalty
  )
}

export function sortSupportBucketsForTask(supportBuckets = [], representativePois = [], { taskType = 'nearby_lookup' } = {}) {
  return normalizeSupportBuckets(supportBuckets)
    .map((bucket) => ({
      ...bucket,
      __task_score: scoreSupportBucketForTask(bucket, representativePois, { taskType })
    }))
    .sort((left, right) => {
      if (right.__task_score !== left.__task_score) {
        return right.__task_score - left.__task_score
      }
      if (right.count !== left.count) return right.count - left.count
      return (left.min_distance_m ?? Number.POSITIVE_INFINITY) - (right.min_distance_m ?? Number.POSITIVE_INFINITY)
    })
    .map((bucket) => {
      const next = { ...bucket }
      delete next.__task_score
      return next
    })
}

export function buildRepresentativePois(results = [], limit = 5) {
  return (Array.isArray(results) ? results : [])
    .filter(Boolean)
    .slice()
    .sort((left, right) => {
      const rightScore = toFiniteNumber(right?.fused_score) ?? Number.NEGATIVE_INFINITY
      const leftScore = toFiniteNumber(left?.fused_score) ?? Number.NEGATIVE_INFINITY
      if (rightScore !== leftScore) return rightScore - leftScore

      const leftDistance = toFiniteNumber(left?.distance_m) ?? Number.POSITIVE_INFINITY
      const rightDistance = toFiniteNumber(right?.distance_m) ?? Number.POSITIVE_INFINITY
      return leftDistance - rightDistance
    })
    .slice(0, Math.max(1, Number(limit) || 5))
    .map((item) => ({
      id: item?.id ?? null,
      name: String(item?.name || '').trim() || '未知地点',
      category: String(item?.category || '').trim() || '未分类',
      distance_m: toFiniteNumber(item?.distance_m),
      region_label: item?.regionLabel ?? item?.region_label ?? item?.spatial_info?.region_idx ?? null,
      support_bucket: inferSupportBucket(item),
      fused_score: toFiniteNumber(item?.fused_score)
    }))
}

export function normalizeRepresentativePois(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const name = String(item?.name || '').trim()
      if (!name) return null

      return {
        id: item?.id ?? null,
        name,
        category: String(item?.category || '').trim() || '未分类',
        distance_m: toFiniteNumber(item?.distance_m ?? item?.distanceM),
        region_label: item?.region_label ?? item?.regionLabel ?? null,
        support_bucket: String(item?.support_bucket || item?.supportBucket || inferSupportBucket(item)).trim() || '其他配套',
        fused_score: toFiniteNumber(item?.fused_score ?? item?.fusedScore)
      }
    })
    .filter(Boolean)
}

function resolveEvidenceDensity(sampleSize = 0) {
  if (sampleSize >= 8) return 'high'
  if (sampleSize >= 3) return 'medium'
  return 'low'
}

export function buildMacroUncertainty({
  sampleSize = 0,
  supportBucketCount = 0,
  representativePoiCount = 0,
  avgBoundaryConfidence = null,
  comparisonMode = null,
  vectorConstraintSource = null,
  modelRouting = null
} = {}) {
  const safeSampleSize = Math.max(0, Number(sampleSize) || 0)

  return {
    boundary_confidence: toFiniteNumber(avgBoundaryConfidence),
    comparison_mode: comparisonMode || null,
    vector_constraint_source: vectorConstraintSource || null,
    support_bucket_count: Math.max(0, Number(supportBucketCount) || 0),
    representative_poi_count: Math.max(0, Number(representativePoiCount) || 0),
    sample_size: safeSampleSize,
    evidence_density: resolveEvidenceDensity(safeSampleSize),
    low_sample_warning: safeSampleSize > 0 && safeSampleSize < 3,
    model_route_primary: modelRouting?.primary || null,
    model_usage: Array.isArray(modelRouting?.usage) ? modelRouting.usage : []
  }
}

export function normalizeMacroUncertainty(value = null, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const sampleSize = Math.max(
    0,
    Number(source?.sample_size ?? source?.sampleSize ?? fallback.sampleSize) || 0
  )
  const supportBucketCount = Math.max(
    0,
    Number(source?.support_bucket_count ?? source?.supportBucketCount ?? fallback.supportBucketCount) || 0
  )
  const representativePoiCount = Math.max(
    0,
    Number(source?.representative_poi_count ?? source?.representativePoiCount ?? fallback.representativePoiCount) || 0
  )

  return {
    boundary_confidence: toFiniteNumber(source?.boundary_confidence ?? source?.boundaryConfidence ?? fallback.boundaryConfidence),
    comparison_mode: String(
      (source?.comparison_mode ?? source?.comparisonMode ?? fallback.comparisonMode) || ''
    ).trim() || null,
    vector_constraint_source: String(
      (source?.vector_constraint_source ??
      source?.vectorConstraintSource ??
      fallback.vectorConstraintSource) ||
      ''
    ).trim() || null,
    support_bucket_count: supportBucketCount,
    representative_poi_count: representativePoiCount,
    sample_size: sampleSize,
    evidence_density: String(
      (source?.evidence_density ?? source?.evidenceDensity ?? resolveEvidenceDensity(sampleSize)) || resolveEvidenceDensity(sampleSize)
    ).trim() || resolveEvidenceDensity(sampleSize),
    low_sample_warning: source?.low_sample_warning === true
      || source?.lowSampleWarning === true
      || (sampleSize > 0 && sampleSize < 3),
    model_route_primary: String(
      (source?.model_route_primary ?? source?.modelRoutePrimary ?? fallback.modelRoutePrimary) || ''
    ).trim() || null,
    model_usage: normalizeTextList(source?.model_usage ?? source?.modelUsage ?? fallback.modelUsage)
  }
}

export function buildMacroCellSummary(value = null, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const supportBuckets = normalizeSupportBuckets(
    source?.support_buckets ||
    source?.supportBucketDistribution ||
    source?.support_bucket_distribution ||
    fallback?.supportBuckets
  )
  const dominantBuckets = normalizeTextList(
    source?.dominant_buckets ||
    source?.dominantBuckets ||
    fallback?.dominantBuckets
  )
  const sceneTags = normalizeSceneTags(
    source?.scene_tags ||
    source?.sceneTags ||
    fallback?.sceneTags
  )
  const cellMix = normalizeCellMix(
    source?.cell_mix ||
    source?.cellMix ||
    fallback?.cellMix
  )
  const supportBucketMetrics = normalizeSupportBucketMetrics(
    source?.support_bucket_metrics ||
    source?.supportBucketMetrics ||
    buildSupportBucketMetrics(supportBuckets)
  )
  const populationMetrics = normalizePopulationMetrics(
    source?.population_metrics ||
    source?.populationMetrics ||
    buildPopulationMetricsFromCells(source?.cells)
  )
  const uncertaintySource = source?.uncertainty ||
    source?.macro_uncertainty ||
    source?.macroUncertainty ||
    fallback?.uncertainty
  const hasUncertaintySource = uncertaintySource
    && typeof uncertaintySource === 'object'
    && Object.keys(uncertaintySource).length > 0
  const uncertainty = hasUncertaintySource
    ? normalizeMacroUncertainty(
      uncertaintySource,
      {
        supportBucketCount: supportBuckets.length,
        representativePoiCount: Number(fallback?.representativePoiCount) || 0,
        sampleSize: Number(
          source?.sample_size ??
          source?.sampleSize ??
          fallback?.sampleSize
        ) || 0,
        comparisonMode: fallback?.comparisonMode || null,
        modelRoutePrimary: fallback?.modelRoutePrimary || null,
        modelUsage: fallback?.modelUsage || []
      }
    )
    : null

  return {
    support_buckets: supportBuckets,
    support_bucket_metrics: supportBucketMetrics,
    dominant_buckets: dominantBuckets,
    scene_tags: sceneTags,
    cell_mix: cellMix,
    population_metrics: populationMetrics,
    uncertainty
  }
}
