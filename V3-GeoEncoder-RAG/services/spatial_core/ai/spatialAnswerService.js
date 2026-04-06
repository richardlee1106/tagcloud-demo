import { callLLMStream } from '../../ai/llmService.js'
import {
  buildSupportBucketMetrics,
  buildVerifiedSupportBucketMetrics,
  CORE_SUPPORT_BUCKETS,
  isInfrastructureLikePoi,
  normalizeMacroUncertainty,
  normalizePopulationMetrics,
  normalizeRepresentativePois,
  normalizeSupportBuckets,
  normalizeSupportBucketMetrics,
  sortSupportBucketsForTask,
  summarizeSupportBuckets
} from './supportEvidenceUtils.js'

const ANSWER_REFERENCE_LIMIT = 10
const COMPARISON_SIGNAL_RE = /(对比|比较|差异|区别|哪个更|谁更|vs|VS|Vs|相比|相较)/u
const COMPARISON_BACKGROUND_BUCKETS = new Set(['教育服务', '其他配套'])
const SUPPORT_GAP_BACKGROUND_BUCKETS = new Set(['教育服务', '其他配套', '交通出行'])
const SUPPORT_GAP_PRIORITY_BUCKETS = Object.freeze([
  '零售购物',
  '餐饮配套',
  '生活服务',
  '休闲娱乐',
  '医疗健康'
])
const SUPPORT_GAP_PRIORITY_BASE_SCORES = Object.freeze({
  零售购物: 10,
  餐饮配套: 10,
  生活服务: 8,
  休闲娱乐: 7,
  医疗健康: 6
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

function stripThinkBlocks(content = '') {
  return String(content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}

function normalizeAnswerType(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'nearby_lookup'

  switch (normalized) {
    case 'support_gap_analysis':
    case 'site_suitability':
    case 'region_comparison':
    case 'area_overview':
    case 'nearby_lookup':
      return normalized
    default:
      return 'nearby_lookup'
  }
}

function normalizeResults(results = []) {
  return Array.isArray(results)
    ? results.filter(Boolean).slice(0, ANSWER_REFERENCE_LIMIT)
    : []
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

      return {
        placeName,
        displayName: String(item?.displayName || item?.display_name || placeName).trim() || placeName,
        role: String(
          item?.role ||
          (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
        ).trim() || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
      }
    })
    .filter(Boolean)
}

function shouldUseDeterministicNearbyAnswer(query, results = [], options = {}) {
  if (!Array.isArray(results) || results.length === 0) return false
  if (options.anchorMode !== 'explicit_place') return false

  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return false
  const answerType = normalizeAnswerType(options.answerType)

  if (answerType === 'nearby_lookup') {
    if (!String(options.requestedCategory || '').trim()) return false
    if (!/(附近|周边|周围|旁边|最近|有哪些|有什么|哪里有)/.test(normalizedQuery)) return false
    if (/(配套|缺口|适合|比较|对比|概况|概览|画像|趋势|主导业态|热门业态)/.test(normalizedQuery)) return false
    return true
  }

  if (answerType === 'support_gap_analysis') {
    if (!/(配套|热门业态|主导业态|缺口|短板|不足|空白)/.test(normalizedQuery)) return false
    return true
  }

  if (answerType === 'area_overview') {
    if (!/(概况|概览|画像|整体|总体|分布|结构|趋势|片区分析|区域分析|空间结构|业态分布)/.test(normalizedQuery)) return false
    return true
  }

  if (answerType === 'site_suitability') {
    if (!/(适合开什么店|适合开|适不适合开|开店|选址|做什么生意|开什么店|适合做什么|适合布局|布局什么业态|布局哪些业态|布局哪类业态)/.test(normalizedQuery)) return false
    return true
  }

  if (answerType === 'region_comparison') {
    if (!COMPARISON_SIGNAL_RE.test(normalizedQuery)) return false
    return normalizeStructuredAnchors(options.anchors).length >= 2
  }

  return false
}

function formatDistance(value) {
  return Number.isFinite(Number(value))
    ? `约${Math.round(Number(value))}米`
    : '距离待确认'
}

function resolveAnchorLabel(query, options = {}) {
  const directLabel = [
    options.anchorLabel,
    options.placeName,
    options.displayAnchor
  ].find((value) => String(value || '').trim())

  if (directLabel) return String(directLabel).trim()
  if (options.anchorMode === 'context') {
    return options.hasCustomArea ? '当前圈定区域' : '当前视图'
  }
  if (/(这里|这边|这附近|这一带|当前区域|当前视图|地图上|图上)/.test(String(query || ''))) {
    return '当前视图'
  }
  return '当前范围'
}

function summarizeCategoryStats(results = []) {
  const stats = new Map()

  results.forEach((item) => {
    const category = String(item?.category || '未分类').trim() || '未分类'
    if (!stats.has(category)) {
      stats.set(category, {
        category,
        count: 0,
        examples: [],
        minDistance: Number.POSITIVE_INFINITY
      })
    }

    const current = stats.get(category)
    current.count += 1
    current.minDistance = Math.min(current.minDistance, Number(item?.distance_m) || Number.POSITIVE_INFINITY)

    const name = String(item?.name || '').trim()
    if (name && !current.examples.includes(name) && current.examples.length < 2) {
      current.examples.push(name)
    }
  })

  return [...stats.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count
    return left.minDistance - right.minDistance
  })
}

function resolveStructuredMacroEvidence(results = [], options = {}) {
  const supportBuckets = normalizeSupportBuckets(
    options.supportBuckets ||
    options.support_buckets ||
    options?.evidence?.supportBuckets ||
    options?.evidence?.support_buckets
  )
  const supportBucketMetrics = normalizeSupportBucketMetrics(
    options.supportBucketMetrics ||
    options.support_bucket_metrics ||
    options?.evidence?.supportBucketMetrics ||
    options?.evidence?.support_bucket_metrics ||
    buildSupportBucketMetrics(supportBuckets)
  )
  const representativePois = normalizeRepresentativePois(
    options.representativePois ||
    options.representative_pois ||
    options?.evidence?.representativePois ||
    options?.evidence?.representative_pois
  )
  const populationMetrics = normalizePopulationMetrics(
    options.populationMetrics ||
    options.population_metrics ||
    options?.evidence?.populationMetrics ||
    options?.evidence?.population_metrics
  )
  const uncertainty = normalizeMacroUncertainty(
    options.uncertainty || options?.evidence?.uncertainty,
    {
      supportBucketCount: supportBuckets.length,
      representativePoiCount: representativePois.length,
      sampleSize: Array.isArray(results) ? results.length : 0
    }
  )

  return {
    supportBuckets,
    supportBucketMetrics,
    representativePois,
    populationMetrics,
    uncertainty
  }
}

function normalizeComparisonRegions(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => {
      const anchor = item?.anchor && typeof item.anchor === 'object' ? item.anchor : {}
      const placeName = String(anchor?.place_name || anchor?.placeName || anchor?.display_name || anchor?.displayName || '').trim()
      if (!placeName) return null

      const supportBuckets = normalizeSupportBuckets(item?.support_buckets || item?.supportBuckets)
      const supportBucketMetrics = normalizeSupportBucketMetrics(
        item?.support_bucket_metrics ||
        item?.supportBucketMetrics ||
        buildSupportBucketMetrics(supportBuckets)
      )
      const representativePois = normalizeRepresentativePois(item?.representative_pois || item?.representativePois)
      const populationMetrics = normalizePopulationMetrics(
        item?.population_metrics ||
        item?.populationMetrics
      )
      const uncertainty = normalizeMacroUncertainty(item?.uncertainty, {
        supportBucketCount: supportBuckets.length,
        representativePoiCount: representativePois.length,
        sampleSize: item?.stats?.result_count ?? representativePois.length,
        comparisonMode: 'dual_anchor'
      })

      return {
        anchor: {
          placeName,
          displayName: String(anchor?.display_name || anchor?.displayName || placeName).trim() || placeName,
          role: String(
            anchor?.role ||
            (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
          ).trim() || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
        },
        supportBuckets,
        supportBucketMetrics,
        representativePois,
        populationMetrics,
        uncertainty
      }
    })
    .filter(Boolean)
}

function resolveStructuredComparisonRegions(options = {}) {
  return normalizeComparisonRegions(
    options.comparisonRegions ||
    options.comparison_regions ||
    options?.evidence?.comparisonRegions ||
    options?.evidence?.comparison_regions
  )
}

function isGenericMacroExampleName(value = '') {
  const normalized = String(value || '').trim()
  if (!normalized) return true
  if (GENERIC_MACRO_EXAMPLE_NAMES.has(normalized)) return true
  return /^[\u4e00-\u9fa5]{2,6}(?:服务|业态|配套|片区|用地|社区|商业|住宅|学校)$/.test(normalized)
}

function resolveReadableBucketExamples(bucket = {}, representativePois = []) {
  const matchedRepresentativeNames = (Array.isArray(representativePois) ? representativePois : [])
    .filter((item) => String(item?.support_bucket || '').trim() === String(bucket?.bucket || '').trim())
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean)

  if (matchedRepresentativeNames.length > 0) {
    return [...new Set(matchedRepresentativeNames)].slice(0, 3)
  }

  return (Array.isArray(bucket?.examples) ? bucket.examples : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && !isGenericMacroExampleName(item))
    .slice(0, 3)
}

function formatBucketNames(buckets = []) {
  const normalized = (Array.isArray(buckets) ? buckets : [])
    .map((item) => `**${item?.bucket || item}**`)
    .filter(Boolean)

  if (normalized.length === 0) return ''
  if (normalized.length === 1) return normalized[0]
  if (normalized.length === 2) return `${normalized[0]}、${normalized[1]}`
  return `${normalized[0]}、${normalized[1]}、${normalized[2]}`
}

function sortBucketsForAnswer(bucketStats = [], representativePois = [], taskType = 'nearby_lookup') {
  return sortSupportBucketsForTask(bucketStats, representativePois, { taskType })
}

function pickReadableRepresentativePois(region = {}, limit = 2) {
  const representativePois = Array.isArray(region?.representativePois) ? region.representativePois : []
  const rankedBuckets = sortBucketsForAnswer(region?.supportBuckets || [], representativePois, 'region_comparison')
  const preferredBuckets = new Set(rankedBuckets.slice(0, 2).map((item) => item.bucket))

  const prioritized = representativePois
    .filter((item) => !isInfrastructureLikePoi(item))
    .sort((left, right) => {
      const leftPreferred = preferredBuckets.has(String(left?.support_bucket || '').trim()) ? 0 : 1
      const rightPreferred = preferredBuckets.has(String(right?.support_bucket || '').trim()) ? 0 : 1
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred
      return (Number(left?.distance_m) || Number.POSITIVE_INFINITY) - (Number(right?.distance_m) || Number.POSITIVE_INFINITY)
    })
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean)

  return [...new Set(prioritized)].slice(0, limit)
}

function formatComparisonBucketSummary(region = {}) {
  const buckets = sortBucketsForAnswer(region?.supportBuckets || [], region?.representativePois || [], 'region_comparison')
    .slice(0, 2)
  if (buckets.length === 0) return '当前证据仍偏少'
  return buckets.map((item) => `**${item.bucket}**(${item.count})`).join('、')
}

function formatComparisonRepresentativePois(region = {}) {
  const names = pickReadableRepresentativePois(region, 2)

  return names.length > 0 ? `，代表点有 **${names.join('**、**')}**` : ''
}

function recalculateMetricShares(metrics = []) {
  const totalCount = metrics.reduce((sum, item) => sum + Math.max(0, Number(item?.count) || 0), 0)
  if (totalCount <= 0) return metrics

  return metrics.map((item) => {
    const count = Math.max(0, Number(item?.count) || 0)
    const share = count / totalCount
    return {
      ...item,
      share: Number(share.toFixed(4)),
      share_pct: Math.round(share * 100)
    }
  })
}

function resolveMacroBucketMetrics(macroEvidence = {}, taskType = 'support_gap_analysis') {
  const orderedBuckets = sortBucketsForAnswer(
    macroEvidence?.supportBuckets || macroEvidence?.support_buckets || [],
    macroEvidence?.representativePois || macroEvidence?.representative_pois || [],
    taskType
  )

  if (orderedBuckets.length > 0) {
    const derivedMetricMap = new Map(
      buildSupportBucketMetrics(orderedBuckets).map((item) => [item.bucket, item])
    )

    const orderedMetrics = orderedBuckets
      .map((item) => derivedMetricMap.get(item.bucket) || {
        bucket: item.bucket,
        count: item.count,
        share: null,
        share_pct: null
      })
      .filter(Boolean)

    const backgroundBuckets = taskType === 'support_gap_analysis'
      ? SUPPORT_GAP_BACKGROUND_BUCKETS
      : COMPARISON_BACKGROUND_BUCKETS
    const actionableMetrics = orderedMetrics.filter((item) => !backgroundBuckets.has(item.bucket))
    if (actionableMetrics.length > 0) return recalculateMetricShares(actionableMetrics)
    return recalculateMetricShares(orderedMetrics)
  }

  const metrics = normalizeSupportBucketMetrics(
    macroEvidence?.supportBucketMetrics ||
    macroEvidence?.support_bucket_metrics
  )
  if (metrics.length > 0) return metrics
  return buildSupportBucketMetrics(macroEvidence?.supportBuckets || macroEvidence?.support_buckets || [])
}

function describeBucketNeed(bucket = '') {
  switch (String(bucket || '').trim()) {
    case '零售购物':
      return '顺手买东西和即时消费'
    case '餐饮配套':
      return '日常吃饭和短暂停留'
    case '生活服务':
      return '办日常小事和补基础刚需'
    case '交通出行':
      return '出入和换乘'
    case '医疗健康':
      return '看病买药和应急医疗'
    case '休闲娱乐':
      return '停留放松和消磨时间'
    case '教育服务':
      return '校园学习活动'
    default:
      return `${bucket} 需求`
  }
}

function describeBucketTone(metric = null) {
  const sharePct = Number(metric?.share_pct)
  if (!Number.isFinite(sharePct)) return '已经能看到一些信号'
  if (sharePct >= 34) return '已经比较成型'
  if (sharePct >= 22) return '不弱'
  if (sharePct >= 14) return '有存在感'
  return '信号还不算强'
}

function describePopulationActivity(populationMetrics = null, { subject = '这里' } = {}) {
  const metrics = normalizePopulationMetrics(populationMetrics)
  if (!metrics) return ''

  const avgDensity = Number(metrics.avg_density)
  const highRatio = Number(metrics.high_density_cell_ratio)
  const densityLevel = String(metrics.density_level || '').trim().toLowerCase()

  if (densityLevel === 'high' || (Number.isFinite(highRatio) && highRatio >= 0.45) || avgDensity >= 22000) {
    return `${subject}人流比较活跃，说明日常消费基础不弱。`
  }
  if (densityLevel === 'medium' || avgDensity >= 12000) {
    return `${subject}平时有人流支撑，做高频刚需会比做太重的目的性业态更稳。`
  }
  return `${subject}人流相对平一些，更适合做目的性更明确、依赖专门到访的业态。`
}

function hasHighPopulationActivity(populationMetrics = null) {
  const metrics = normalizePopulationMetrics(populationMetrics)
  if (!metrics) return false

  const avgDensity = Number(metrics.avg_density)
  const highRatio = Number(metrics.high_density_cell_ratio)
  const densityLevel = String(metrics.density_level || '').trim().toLowerCase()

  return densityLevel === 'high'
    || (Number.isFinite(highRatio) && highRatio >= 0.45)
    || avgDensity >= 22000
}

function hasMediumPopulationActivity(populationMetrics = null) {
  const metrics = normalizePopulationMetrics(populationMetrics)
  if (!metrics) return false

  const avgDensity = Number(metrics.avg_density)
  const densityLevel = String(metrics.density_level || '').trim().toLowerCase()

  return densityLevel === 'medium' || avgDensity >= 12000
}

function buildPopulationContrast(primaryRegion = {}, secondaryRegion = {}) {
  const primaryMetrics = resolveRegionPopulationMetrics(primaryRegion)
  const secondaryMetrics = resolveRegionPopulationMetrics(secondaryRegion)
  const primaryName = primaryRegion?.anchor?.displayName || primaryRegion?.anchor?.placeName || '区域A'
  const secondaryName = secondaryRegion?.anchor?.displayName || secondaryRegion?.anchor?.placeName || '区域B'

  if (!primaryMetrics && !secondaryMetrics) return ''
  if (primaryMetrics && secondaryMetrics) {
    const primaryAvg = Number(primaryMetrics.avg_density)
    const secondaryAvg = Number(secondaryMetrics.avg_density)
    if (Number.isFinite(primaryAvg) && Number.isFinite(secondaryAvg)) {
      const maxDensity = Math.max(primaryAvg, secondaryAvg)
      const diffRatio = maxDensity > 0 ? Math.abs(primaryAvg - secondaryAvg) / maxDensity : 0
      if (diffRatio < 0.12) {
        return '两边的人流活跃度都不低。'
      }

      return primaryAvg > secondaryAvg
        ? `两边人流都不弱，但 **${primaryName}** 这一侧整体还要更热闹一些。`
        : `两边人流都不弱，但 **${secondaryName}** 这一侧整体还要更热闹一些。`
    }
  }

  if (primaryMetrics) {
    return describePopulationActivity(primaryMetrics, { subject: `**${primaryName}** 这边` })
  }
  return describePopulationActivity(secondaryMetrics, { subject: `**${secondaryName}** 这边` })
}

function describeComparisonScene(bucket = '') {
  switch (String(bucket || '').trim()) {
    case '零售购物':
      return '顺手买东西更方便'
    case '餐饮配套':
      return '吃饭更方便'
    case '生活服务':
      return '办日常琐事更顺手'
    case '交通出行':
      return '出入换乘更方便'
    case '医疗健康':
      return '看病买药更方便'
    case '休闲娱乐':
      return '停留放松更容易'
    case '教育服务':
      return '校园属性更强'
    default:
      return `${bucket} 更显眼`
  }
}

function buildSupportExampleLine(metric = null, representativePois = []) {
  if (!metric) return ''
  const examples = resolveReadableBucketExamples(metric, representativePois)
  return examples.length > 0 ? `，像 **${examples.join('**、**')}** 这类点就比较典型` : ''
}

function buildSupportGapPriorityContext(metrics = [], supportBuckets = [], representativePois = [], populationMetrics = null) {
  const metricMap = new Map(
    (Array.isArray(metrics) ? metrics : [])
      .map((item) => [String(item?.bucket || '').trim(), item])
      .filter(([bucket]) => bucket)
  )
  const rawPresentBuckets = new Set(
    (Array.isArray(supportBuckets) ? supportBuckets : [])
      .map((item) => String(item?.bucket || '').trim())
      .filter(Boolean)
  )
  const verifiedPresentBuckets = new Set(
    (Array.isArray(supportBuckets) ? supportBuckets : [])
      .filter((item) => resolveReadableBucketExamples(item, representativePois).length > 0)
      .map((item) => String(item?.bucket || '').trim())
      .filter(Boolean)
  )
  const resolveSharePct = (bucket) => Number(metricMap.get(bucket)?.share_pct) || 0
  const highDensity = hasHighPopulationActivity(populationMetrics)
  const mediumDensity = hasMediumPopulationActivity(populationMetrics)
  const strongRetail = resolveSharePct('零售购物') >= 18
  const strongDining = resolveSharePct('餐饮配套') >= 18

  return {
    metricMap,
    rawPresentBuckets,
    verifiedPresentBuckets,
    highDensity,
    mediumDensity,
    strongBasics: strongRetail && strongDining,
    weakRetail: resolveSharePct('零售购物') < 14,
    weakDining: resolveSharePct('餐饮配套') < 14,
    weakLiving: resolveSharePct('生活服务') < 12,
    resolveSharePct
  }
}

function rankSupportGapPriorityBuckets(metrics = [], supportBuckets = [], representativePois = [], populationMetrics = null) {
  const context = buildSupportGapPriorityContext(metrics, supportBuckets, representativePois, populationMetrics)

  const ranked = SUPPORT_GAP_PRIORITY_BUCKETS
    .map((bucket) => {
      const sharePct = context.resolveSharePct(bucket)
      const present = context.verifiedPresentBuckets.has(bucket)
      const softlyPresent = context.rawPresentBuckets.has(bucket)
      let score = SUPPORT_GAP_PRIORITY_BASE_SCORES[bucket] || 0

      if (!present) {
        score += softlyPresent ? 3 : 5
      } else if (sharePct < 12) {
        score += 2
      } else {
        score -= Math.min(6, Math.round(sharePct / 7))
      }

      if (context.strongBasics) {
        if (bucket === '休闲娱乐') score += 4
        if (bucket === '生活服务') score += 3
        if (bucket === '医疗健康') score += 2
        if (bucket === '零售购物' || bucket === '餐饮配套') score -= 4
      } else {
        if (context.weakRetail && bucket === '零售购物') score += present ? 1 : 4
        if (context.weakDining && bucket === '餐饮配套') score += present ? 1 : 4
        if (context.weakLiving && bucket === '生活服务') score += present ? 1 : 3
      }

      if (context.highDensity) {
        if (bucket === '休闲娱乐') score += 1.5
        if (bucket === '生活服务') score += 1
        if (bucket === '医疗健康') score += 0.5
      } else if (!context.mediumDensity) {
        if (bucket === '医疗健康') score += 1
        if (bucket === '休闲娱乐') score -= 1.5
      }

      if (present && sharePct >= 18) {
        score -= 2
      }

      return {
        bucket,
        score,
        present,
        sharePct,
        context
      }
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (left.present !== right.present) return Number(left.present) - Number(right.present)
      if (left.sharePct !== right.sharePct) return left.sharePct - right.sharePct
      return left.bucket.localeCompare(right.bucket, 'zh-CN')
    })

  const missingCandidates = ranked.filter((item) => !item.present)
  if (missingCandidates.length >= 2) {
    return missingCandidates.slice(0, 2)
  }
  if (missingCandidates.length === 1) {
    return [
      missingCandidates[0],
      ...ranked
        .filter((item) => item.bucket !== missingCandidates[0].bucket)
        .slice(0, 1)
    ]
  }

  return ranked.slice(0, 2)
}

function describeSupportGapPriorityReason(bucket = '', context = {}) {
  switch (String(bucket || '').trim()) {
    case '零售购物':
      return context.strongBasics
        ? '现在吃饭和停留信号已经不弱，但“顺手买东西 / 即时补给”这一层还不够连续。'
        : '当前“顺手买东西 / 即时补给”的证据还偏弱，容易让高频刚需断一截。'
    case '餐饮配套':
      return context.strongBasics
        ? '日常消费已经不弱，但“坐下吃饭 / 短暂停留”的承接还可以再补。'
        : '现在能看到的吃饭信号还不够连续，短暂停留和日常餐饮承接还有提升空间。'
    case '生活服务':
      return (context.strongBasics || context.highDensity)
        ? '当前吃喝买已经有底，但办小事、补刚需的配套还不够顺手。'
        : '日常刚需里最容易被忽略的就是这层，补上后体验会更完整。'
    case '休闲娱乐':
      return (context.strongBasics || context.highDensity)
        ? '基础吃喝买已经有了，但“延长停留时间 / 提升晚间活力”的内容还偏弱。'
        : '如果想把停留时间和片区活跃度再往上拉，这类内容更值得优先排查。'
    case '医疗健康':
      return (context.highDensity || context.mediumDensity)
        ? '人流和日常消费不算弱，但看病买药、应急便利的承接还不够稳。'
        : '即使不是高频消费，这类应急能力也更适合尽早确认有没有短板。'
    default:
      return `${bucket} 这类能力目前仍值得继续确认。`
  }
}

function buildSupportGapPriorityLines(
  metrics = [],
  supportBuckets = [],
  { representativePois = [], representative_pois = [], populationMetrics = null, uncertainty = null } = {}
) {
  const normalizedUncertainty = normalizeMacroUncertainty(uncertainty, {
    sampleSize: 0,
    supportBucketCount: Array.isArray(supportBuckets) ? supportBuckets.length : 0,
    representativePoiCount: 0
  })
  const lowConfidence = normalizedUncertainty.low_sample_warning || normalizedUncertainty.evidence_density === 'low'
  const rankedBuckets = rankSupportGapPriorityBuckets(
    metrics,
    supportBuckets,
    representativePois || representative_pois || [],
    populationMetrics
  )

  return rankedBuckets.map((item, index) => {
    const lead = index === 0
      ? (lowConfidence ? '第一优先先补查' : '第一优先可补')
      : (lowConfidence ? '第二优先再补查' : '第二优先可补')
    const reason = describeSupportGapPriorityReason(item.bucket, item.context)
    const caution = lowConfidence
      ? ' 但当前样本偏少，暂时不建议直接把它当成明确缺口，最好扩大步行圈再确认。'
      : ''

    return `- ${lead} **${item.bucket}**：${reason}${caution}`
  })
}

function buildSupportGapHeadline(anchorLabel, metrics = [], populationMetrics = null) {
  const primaryMetric = metrics[0] || null
  const secondaryMetric = metrics[1] || null
  const populationLine = describePopulationActivity(populationMetrics, { subject: '这里' })

  let headline = `- 围绕 **${anchorLabel}** 看，这里更像一个已经有基本配套支撑的片区。`

  const pairKey = [primaryMetric?.bucket, secondaryMetric?.bucket].filter(Boolean).join('|')
  switch (pairKey) {
    case '零售购物|餐饮配套':
    case '餐饮配套|零售购物':
      headline = `- 围绕 **${anchorLabel}** 看，这里不像“什么都缺”的地方，更像一个学生日常吃喝买已经成型的校园生活圈。`
      break
    case '零售购物|生活服务':
    case '生活服务|零售购物':
      headline = `- 围绕 **${anchorLabel}** 看，这里更像一个日常刚需已经铺开的生活圈，顺手买东西和办小事都不算难。`
      break
    case '餐饮配套|生活服务':
    case '生活服务|餐饮配套':
      headline = `- 围绕 **${anchorLabel}** 看，这里更像一个“吃饭 + 日常办事”都比较顺手的片区。`
      break
    default:
      if (primaryMetric) {
        headline = `- 围绕 **${anchorLabel}** 看，这里更像一个 **${describeBucketNeed(primaryMetric.bucket)}** 比较突出的片区。`
      }
      break
  }

  return [headline, populationLine ? `- ${populationLine}` : null].filter(Boolean)
}

function buildSupportGapPresentLines(metrics = [], representativePois = []) {
  return metrics.slice(0, 3).map((metric) => {
    const tone = describeBucketTone(metric)
    const exampleLine = buildSupportExampleLine(metric, representativePois)
    return `- **${metric.bucket}** ${tone}，说明这里的 **${describeBucketNeed(metric.bucket)}** 已经有基础${exampleLine}。`
  })
}

function buildSupportGapHotLines(categoryStats = [], representativePois = [], bucketMetrics = []) {
  const actionableRepresentativePois = (Array.isArray(representativePois) ? representativePois : [])
    .filter((item) => !isInfrastructureLikePoi(item))

  const actionableCategories = [...new Set(
    actionableRepresentativePois
      .map((item) => String(item?.category || '').trim())
      .filter(Boolean)
  )].slice(0, 3)

  const actionableExamples = [...new Set(
    actionableRepresentativePois
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean)
  )].slice(0, 3)

  if (actionableCategories.length > 0) {
    const preferredBucketLabels = bucketMetrics
      .filter((item) => !['教育服务', '其他配套', '交通出行'].includes(item.bucket))
      .slice(0, 2)
    const bucketLabels = (preferredBucketLabels.length > 0 ? preferredBucketLabels : bucketMetrics.slice(0, 2))
      .map((item) => `**${item.bucket}**`)
      .join('、')
    return [
      `- 真正能拿来做经营判断的，还是 ${bucketLabels || actionableCategories.map((item) => `**${item}**`).join('、')} 这类消费/服务信号。`,
      ...(actionableExamples.length > 0 ? [`- 比较有代表性的点包括 **${actionableExamples.join('**、**')}**。`] : [])
    ]
  }

  if (categoryStats.length === 0) {
    return ['- 当前结果还不够稳，暂时更适合把热门业态理解成方向性信号。']
  }

  const topCategories = categoryStats.slice(0, 3)
  const labels = topCategories.map((item) => `**${item.category}**`).join('、')
  const examples = topCategories
    .flatMap((item) => item.examples || [])
    .filter(Boolean)
    .slice(0, 3)

  return [
    `- 当前更容易看到的是 ${labels} 这类点，说明片区里的高频刚需比较靠前。`,
    ...(examples.length > 0 ? [`- 代表性的样本点有 **${examples.join('**、**')}**。`] : [])
  ]
}

function buildSupportGapGapLines(metrics = [], supportBuckets = [], options = {}) {
  const priorityLines = buildSupportGapPriorityLines(metrics, supportBuckets, options)
  if (priorityLines.length > 0) {
    return priorityLines
  }

  const presentBuckets = new Set((supportBuckets || []).map((item) => item.bucket))
  const strongConsumerBuckets = metrics.slice(0, 2).map((item) => item.bucket)

  if (strongConsumerBuckets.includes('零售购物') && strongConsumerBuckets.includes('餐饮配套')) {
    const missingEnhancers = ['休闲娱乐', '医疗健康', '生活服务'].filter((bucket) => !presentBuckets.has(bucket)).slice(0, 2)
    if (missingEnhancers.length > 0) {
      return [`- 真要说缺口，更像是 **${missingEnhancers.join('**、**')}** 这类“延长停留时间 / 提升便利性”的配套还没那么成型，不是基础吃喝买不够。`]
    }
    return ['- 真要说缺口，更像是特色和层次还不够，而不是基础配套完全空白。']
  }

  const consumerGaps = ['零售购物', '餐饮配套', '生活服务'].filter((bucket) => !presentBuckets.has(bucket)).slice(0, 2)
  if (consumerGaps.length > 0) {
    return [`- 当前更像“能到、能用”，但 **${consumerGaps.join('**、**')}** 这类直接面向日常消费的配套还没有完全成型。`]
  }

  const softerGap = ['休闲娱乐', '医疗健康'].filter((bucket) => !presentBuckets.has(bucket)).slice(0, 2)
  if (softerGap.length > 0) {
    return [`- 真要说缺口，更像是 **${softerGap.join('**、**')}** 这类补体验、补便利的能力还不够强。`]
  }

  return ['- 当前看不太像“基础配套明显空白”，更像需要继续往品牌层、细分人群和步行圈深挖。']
}

function resolveRegionBucketMetrics(region = {}) {
  const normalizedMetrics = normalizeSupportBucketMetrics(
    region?.supportBucketMetrics ||
    region?.support_bucket_metrics
  )
  if (normalizedMetrics.length > 0) {
    const actionableMetrics = normalizedMetrics.filter((item) => !COMPARISON_BACKGROUND_BUCKETS.has(item.bucket))
    if (actionableMetrics.length > 0) return recalculateMetricShares(actionableMetrics)
    return recalculateMetricShares(normalizedMetrics)
  }

  const orderedBuckets = sortBucketsForAnswer(
    region?.supportBuckets || region?.support_buckets || [],
    region?.representativePois || region?.representative_pois || [],
    'region_comparison'
  )
  if (orderedBuckets.length > 0) {
    const verifiedMetrics = buildVerifiedSupportBucketMetrics(
      orderedBuckets,
      region?.representativePois || region?.representative_pois || [],
      { taskType: 'region_comparison' }
    )
    const derivedMetricMap = new Map(verifiedMetrics.map((item) => [item.bucket, item]))
    const orderedMetrics = orderedBuckets
      .map((item) => derivedMetricMap.get(item.bucket))
      .filter(Boolean)

    if (orderedMetrics.length > 0) {
      const actionableMetrics = orderedMetrics.filter((item) => !COMPARISON_BACKGROUND_BUCKETS.has(item.bucket))
      if (actionableMetrics.length >= 1) return recalculateMetricShares(actionableMetrics)
      return recalculateMetricShares(orderedMetrics)
    }

    const rawMetricMap = new Map(
      buildSupportBucketMetrics(orderedBuckets).map((item) => [item.bucket, item])
    )
    const rawMetrics = orderedBuckets
      .map((item) => rawMetricMap.get(item.bucket))
      .filter(Boolean)
    const actionableMetrics = rawMetrics.filter((item) => !COMPARISON_BACKGROUND_BUCKETS.has(item.bucket))
    if (actionableMetrics.length >= 2) return recalculateMetricShares(actionableMetrics)
    return recalculateMetricShares(rawMetrics)
  }
  return buildSupportBucketMetrics(region?.supportBuckets || region?.support_buckets || [])
}

function resolveRegionPopulationMetrics(region = {}) {
  return normalizePopulationMetrics(
    region?.populationMetrics ||
    region?.population_metrics
  )
}

function formatPercent(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${Math.round(numeric)}%` : null
}

function describeDensityLevel(value = '') {
  switch (String(value || '').trim().toLowerCase()) {
    case 'high':
      return '偏高'
    case 'medium':
      return '中等'
    case 'low':
      return '偏低'
    default:
      return '待确认'
  }
}

function formatRegionMetricSummary(region = {}) {
  const bucketMetrics = resolveRegionBucketMetrics(region).slice(0, 2)
  const populationMetrics = resolveRegionPopulationMetrics(region)
  const bucketLine = bucketMetrics.length > 0
    ? bucketMetrics.map((item) => `**${item.bucket}** ${describeBucketTone(item)}，更像在承接 **${describeBucketNeed(item.bucket)}**`).join('；')
    : `当前更显眼的是 ${formatComparisonBucketSummary(region)}`

  const populationLine = describePopulationActivity(populationMetrics, { subject: '这边' })
  const representativeNames = pickReadableRepresentativePois(region, 2)

  return [
    bucketLine ? `${bucketLine}。` : null,
    populationLine || null,
    representativeNames.length > 0 ? `像 **${representativeNames.join('**、**')}** 这类点就比较典型。` : null
  ].filter(Boolean).join(' ')
}

function buildQuantitativeComparisonConclusion(primaryRegion = {}, secondaryRegion = {}) {
  const primaryName = primaryRegion?.anchor?.displayName || primaryRegion?.anchor?.placeName || '区域A'
  const secondaryName = secondaryRegion?.anchor?.displayName || secondaryRegion?.anchor?.placeName || '区域B'
  const primaryMetric = resolveRegionBucketMetrics(primaryRegion)[0] || null
  const secondaryMetric = resolveRegionBucketMetrics(secondaryRegion)[0] || null
  const populationContrast = buildPopulationContrast(primaryRegion, secondaryRegion)

  if (primaryMetric && secondaryMetric) {
    if (primaryMetric.bucket === secondaryMetric.bucket) {
      return `- 从这轮同口径样本看，**${primaryName}** 和 **${secondaryName}** 都不属于完全相反的片区，头部信号都落在 **${primaryMetric.bucket}**，只是侧重点还在继续分化。${populationContrast ? ` ${populationContrast}` : ''}`
    }

    return `- 从这轮同口径样本看，**${primaryName}** 更像“${describeComparisonScene(primaryMetric.bucket)}”的校园生活圈，**${secondaryName}** 更像“${describeComparisonScene(secondaryMetric.bucket)}”的片区。${populationContrast ? ` ${populationContrast}` : ''}`
  }

  const primaryDominant = primaryRegion?.supportBuckets?.[0]?.bucket || '混合业态'
  const secondaryDominant = secondaryRegion?.supportBuckets?.[0]?.bucket || '混合业态'
  return `- 基于当前双区域命中证据，**${primaryName}** 更偏 **${primaryDominant}**，而 **${secondaryName}** 更偏 **${secondaryDominant}**。`
}

function buildComparisonSuggestion(primaryRegion = {}, secondaryRegion = {}) {
  const primaryName = primaryRegion?.anchor?.displayName || primaryRegion?.anchor?.placeName || '区域A'
  const secondaryName = secondaryRegion?.anchor?.displayName || secondaryRegion?.anchor?.placeName || '区域B'
  const primaryMetric = resolveRegionBucketMetrics(primaryRegion)[0] || null
  const secondaryMetric = resolveRegionBucketMetrics(secondaryRegion)[0] || null
  const primaryBucket = primaryMetric?.bucket
    || sortBucketsForAnswer(primaryRegion?.supportBuckets || [], primaryRegion?.representativePois || [], 'region_comparison')[0]?.bucket
    || null
  const secondaryBucket = secondaryMetric?.bucket
    || sortBucketsForAnswer(secondaryRegion?.supportBuckets || [], secondaryRegion?.representativePois || [], 'region_comparison')[0]?.bucket
    || null

  if (primaryBucket && secondaryBucket && primaryBucket !== secondaryBucket) {
    return `- 如果你更看重 **${describeBucketNeed(primaryBucket)}** 这类高频场景，可优先关注 **${primaryName}**；如果你更想接住 **${describeBucketNeed(secondaryBucket)}**，可优先关注 **${secondaryName}**。`
  }

  if (primaryBucket) {
    return `- 两边当前都不像完全相反的片区，更适合结合 **${primaryBucket}** 之外的次级配套和步行圈细节再做选择。`
  }

  return '- 当前双区域证据已经成型，但还需要再补一轮更细的步行圈与品牌密度，才能把差异判断收得更稳。'
}

function buildNearbyLookupFallback(query, results = [], options = {}) {
  const requestedCategory = options.requestedCategory || '地点'
  const anchorLabel = resolveAnchorLabel(query, options)

  const lines = results.map((item, index) => {
    const name = item?.name || `结果${index + 1}`
    const category = item?.category || '未分类'
    const note = index === 0
      ? '离参考点最近，适合先看'
      : Number(item?.distance_m) <= 300
        ? '步行可快速到达'
        : '可以作为顺路备选'

    return `${index + 1}. **${name}** · ${category} · ${formatDistance(item?.distance_m)} · ${note}`
  })

  return [
    '### 先看结论',
    `- 我先围绕 **${anchorLabel}** 做了就近检索，当前能明确命中的 **${requestedCategory}** 一共有 **${results.length}** 个。`,
    '- 下面这批结果已经按就近和相关度整理过，适合先从前几项看起。',
    '',
    '### 附近可选地点',
    ...lines,
    '',
    '### 还可以继续',
    '- 如果你愿意，我还可以继续按 **步行范围 / 更安静 / 更适合聊天 / 更适合学习** 再帮你缩一轮。'
  ].join('\n')
}

function buildSupportGapFallback(query, results = [], options = {}) {
  const anchorLabel = resolveAnchorLabel(query, options)
  const macroEvidence = resolveStructuredMacroEvidence(results, options)
  const rawBucketStats = macroEvidence.supportBuckets.length > 0
    ? macroEvidence.supportBuckets
    : summarizeSupportBuckets(results)
  const bucketStats = sortBucketsForAnswer(rawBucketStats, macroEvidence.representativePois, 'support_gap_analysis')
  const bucketMetrics = resolveMacroBucketMetrics({
    supportBuckets: rawBucketStats,
    supportBucketMetrics: macroEvidence.supportBucketMetrics,
    representativePois: macroEvidence.representativePois
  }, 'support_gap_analysis')
  const categoryStats = summarizeCategoryStats(
    macroEvidence.representativePois.length > 0 ? macroEvidence.representativePois : results
  )
  const supportLines = bucketMetrics.length > 0
    ? buildSupportGapPresentLines(bucketMetrics, macroEvidence.representativePois)
    : ['- 当前命中结果还比较少，暂时只能确认这里已经出现了少量配套信号。']

  const hotLines = buildSupportGapHotLines(categoryStats, macroEvidence.representativePois, bucketMetrics)
  const gapLines = buildSupportGapGapLines(bucketMetrics, bucketStats, {
    representativePois: macroEvidence.representativePois,
    populationMetrics: macroEvidence.populationMetrics,
    uncertainty: macroEvidence.uncertainty
  })

  return [
    '### 配套现状',
    ...buildSupportGapHeadline(anchorLabel, bucketMetrics, macroEvidence.populationMetrics),
    ...(macroEvidence.uncertainty.low_sample_warning
      ? ['- 当前证据样本仍然偏少，下面的判断更适合看作方向性提示。']
      : []),
    ...supportLines,
    '',
    '### 热门业态',
    ...hotLines,
    '',
    '### 明显缺口',
    '- 下面说的“缺口”仅基于当前命中结果，不代表这个片区绝对没有，只代表目前证据还不够强。',
    ...gapLines,
    '',
    '### 还可以继续',
    '- 如果你愿意，我可以继续按 **500米步行圈 / 只看生活配套 / 只看消费业态 / 缺口优先级** 再细化一轮。'
  ].join('\n')
}

function buildAreaOverviewFallback(query, results = [], options = {}) {
  const anchorLabel = resolveAnchorLabel(query, options)
  const macroEvidence = resolveStructuredMacroEvidence(results, options)
  const rawBucketStats = macroEvidence.supportBuckets.length > 0
    ? macroEvidence.supportBuckets
    : summarizeSupportBuckets(results)
  const bucketStats = sortBucketsForAnswer(rawBucketStats, macroEvidence.representativePois, 'area_overview')
  const categoryStats = summarizeCategoryStats(
    macroEvidence.representativePois.length > 0 ? macroEvidence.representativePois : results
  )
  const representativePoiLine = macroEvidence.representativePois.length > 0
    ? `- 代表点可先看 **${macroEvidence.representativePois.slice(0, 3).map((item) => item.name).join('**、**')}**。`
    : null
  const areaHeadline = rawBucketStats[0]?.bucket === '教育服务' && bucketStats[0]?.bucket && bucketStats[0]?.bucket !== '教育服务'
    ? `- 以 **${anchorLabel}** 为中心看，这里带有明显的 **高校/教育场景** 背景，但更能体现街区活跃度的仍是 **${bucketStats[0].bucket}**。`
    : `- 以 **${anchorLabel}** 为中心看，当前命中结果呈现出 **${bucketStats[0]?.bucket || '混合业态'}** 为主的片区特征。`

  return [
    '### 区域概览',
    areaHeadline,
    '',
    '### 主要业态',
    ...(categoryStats.slice(0, 4).map((item) => `- **${item.category}**：出现 ${item.count} 次。`) || ['- 当前样本不足，暂时无法稳定归纳。']),
    ...(representativePoiLine ? [representativePoiLine] : []),
    '',
    '### 空间提示',
    '- 如果你要继续做选址或缺口判断，我可以在这个基础上继续下钻。'
  ].join('\n')
}

function buildSiteSuitabilityFallback(query, results = [], options = {}) {
  const anchorLabel = resolveAnchorLabel(query, options)
  const macroEvidence = resolveStructuredMacroEvidence(results, options)
  const rawBucketStats = macroEvidence.supportBuckets.length > 0
    ? macroEvidence.supportBuckets
    : summarizeSupportBuckets(results)
  const bucketStats = sortBucketsForAnswer(rawBucketStats, macroEvidence.representativePois, 'site_suitability')
  const actionBuckets = bucketStats
    .filter((item) => !['教育服务', '交通出行', '其他配套'].includes(item.bucket))
    .slice(0, 3)
  const areaTone = rawBucketStats[0]?.bucket === '教育服务' && actionBuckets.length > 0
    ? `- 这里带有明显的 **高校/教育场景** 背景，但如果从可经营业态看，更值得优先关注 ${formatBucketNames(actionBuckets.slice(0, 2))}。`
    : `- 目前围绕 **${anchorLabel}** 的命中结果里，更值得优先关注的是 ${formatBucketNames(actionBuckets.slice(0, 2)) || `**${bucketStats[0]?.bucket || '混合型'}**`}。`
  const layoutLine = actionBuckets.length >= 2
    ? `- 可以优先考虑补 **${actionBuckets[0].bucket}**、**${actionBuckets[1].bucket}**；如果想做更稳的日常刚需，再补一类 **${actionBuckets[2]?.bucket || '生活服务'}** 会更顺。`
    : '- 这类区域更适合继续围绕已成型需求做同类补充，或者寻找与现有配套互补的轻量业态。'
  const cautionLine = rawBucketStats[0]?.bucket === '教育服务' && actionBuckets.length > 0
    ? '- 需要注意，**教育服务** 更像片区底色，不宜直接把它当成唯一赛道结论；最好再补一轮步行圈和竞品密度分析。'
    : '- 仅凭当前命中结果，还不足以直接下结论到具体品牌或租金层级，最好再补一轮步行圈和竞品密度分析。'

  return [
    '### 场地画像',
    areaTone,
    '',
    '### 适合布局',
    layoutLine,
    '',
    '### 谨慎点',
    cautionLine
  ].join('\n')
}

function buildRegionComparisonFallback(query, results = [], options = {}) {
  const anchorLabel = resolveAnchorLabel(query, options)
  const anchors = normalizeStructuredAnchors(options.anchors)
  const comparisonRegions = resolveStructuredComparisonRegions(options).map((region) => ({
    ...region,
    supportBuckets: sortBucketsForAnswer(region.supportBuckets || [], region.representativePois || [], 'region_comparison')
  }))
  const categoryStats = summarizeCategoryStats(results)
  const primaryAnchor = anchors[0]?.displayName || anchorLabel
  const secondaryAnchor = anchors[1]?.displayName || null

  if (comparisonRegions.length >= 2) {
    const primaryRegion = comparisonRegions[0]
    const secondaryRegion = comparisonRegions[1]
    const primaryName = primaryRegion?.anchor?.displayName || primaryAnchor
    const secondaryName = secondaryRegion?.anchor?.displayName || secondaryAnchor || '另一区域'

    return [
      '### 对比结论',
      buildQuantitativeComparisonConclusion(primaryRegion, secondaryRegion),
      '',
      '### 各自特点',
      `- **${primaryName}**：${formatRegionMetricSummary(primaryRegion)}`,
      `- **${secondaryName}**：${formatRegionMetricSummary(secondaryRegion)}`,
      '',
      '### 选择建议',
      buildComparisonSuggestion(primaryRegion, secondaryRegion)
    ].join('\n')
  }

  if (secondaryAnchor) {
    return [
      '### 对比结论',
      `- 当前已经稳定识别出 **${primaryAnchor}** 和 **${secondaryAnchor}** 这两个对比锚点，但这轮还没有形成“双区域分别取证、再并列比较”的完整证据。`,
      '',
      '### 当前进展',
      `- 现在的控制平面已经能把这题识别成比较任务，不再把它当成普通 nearby 问答。`,
      `- 下一步会分别为 **${primaryAnchor}** 和 **${secondaryAnchor}** 拉取同口径证据，再做真正的差异对比。`,
      '',
      '### 建议下一步',
      '- 在专用 comparison pipeline 完成前，这类题先不强行生成“谁更偏什么业态”的结论，避免把单区域证据误写成双区域差异。'
    ].join('\n')
  }

  return [
    '### 对比结论',
    `- 当前这轮结果更像是围绕 **${anchorLabel}** 的单区域画像，暂时缺少第二个可对比区域。`,
    '',
    '### 当前区域特点',
    ...(categoryStats.slice(0, 3).map((item) => `- **${item.category}**：出现 ${item.count} 次。`) || ['- 当前命中结果偏少，暂时无法稳定概括。']),
    '',
    '### 建议下一步',
    '- 如果你给我另一个明确区域，我可以按同样口径做并列对比。'
  ].join('\n')
}

function buildEmptyFallback(query, options = {}) {
  const answerType = normalizeAnswerType(options.answerType)
  const anchorLabel = resolveAnchorLabel(query, options)

  if (answerType === 'support_gap_analysis') {
    return [
      '### 配套现状',
      `- 围绕 **${anchorLabel}** 的这一轮检索里，暂时还没有拿到足够稳定的空间命中。`,
      '',
      '### 热门业态',
      '- 当前证据不足，暂时没法可靠判断主导业态。',
      '',
      '### 明显缺口',
      '- 这更像是一次“证据缺口”，建议扩大范围或补充地图上下文后再判断真实缺口。'
    ].join('\n')
  }

  return '抱歉，当前空间检索结果里还没有找到能直接回答这个问题的地点。您可以试着扩大范围，或换一个更具体的地点再问我。'
}

function buildSpatialAnswerContract(query, results = [], options = {}) {
  const answerType = normalizeAnswerType(options.answerType)
  const anchorLabel = resolveAnchorLabel(query, options)
  const requestedCategory = options.requestedCategory || '未限定'
  const intentDesc = options.intentDesc || '空间邻近查询'
  const macroEvidence = resolveStructuredMacroEvidence(results, options)
  const comparisonRegions = resolveStructuredComparisonRegions(options)

  const referenceResults = normalizeResults(results)
  const poiContext = referenceResults.map((item, index) =>
    `${index + 1}. ${item.name}｜${item.category || '未分类'}｜${formatDistance(item?.distance_m)}`
  ).join('\n') || '无相关数据'
  const structuredEvidenceLines = macroEvidence.supportBuckets.length > 0 || macroEvidence.representativePois.length > 0
    ? [
      '',
      '结构化证据（优先使用）：',
      `support_buckets: ${macroEvidence.supportBuckets.length > 0
        ? macroEvidence.supportBuckets.map((item) => `${item.bucket}(${item.count})`).join(' | ')
        : '无'}`,
      `representative_pois: ${macroEvidence.representativePois.length > 0
        ? macroEvidence.representativePois.map((item) => `${item.name}/${item.category}`).join(' | ')
        : '无'}`,
      `uncertainty: ${JSON.stringify(macroEvidence.uncertainty)}`
    ]
    : []
  const structuredComparisonLines = comparisonRegions.length > 0
    ? [
      '',
      '对比证据（优先使用）：',
      ...comparisonRegions.map((item) => {
        const anchorName = item?.anchor?.displayName || item?.anchor?.placeName || '未知区域'
        const buckets = item?.supportBuckets?.length > 0
          ? item.supportBuckets.map((bucket) => `${bucket.bucket}(${bucket.count})`).join(' | ')
          : '无'
        const pois = item?.representativePois?.length > 0
          ? item.representativePois.map((poi) => `${poi.name}/${poi.category}`).join(' | ')
          : '无'
        return `${anchorName}: support_buckets=${buckets}; representative_pois=${pois}; uncertainty=${JSON.stringify(item?.uncertainty || {})}`
      })
    ]
    : []

  const commonPrefix = [
    '你是熟悉武汉空间信息的地理助手，请基于参考数据回答，语气自然、友好，稍微有一点个性，但绝对不要编造。',
    '',
    `用户问题：${query}`,
    `检索意图：${intentDesc}`,
    `回答类型：${answerType}`,
    `空间锚点：${anchorLabel}`,
    `目标类别：${requestedCategory}`,
    '',
    `参考数据（按优先级排序，最多 ${referenceResults.length} 条）：`,
    poiContext,
    ...structuredEvidenceLines,
    ...structuredComparisonLines,
    '',
    '回答硬约束：',
    '1. 只允许使用参考数据里出现过的地点、类别和距离。',
    '2. 如果证据不足，要明确写“当前命中结果不足以判断”，不要硬凑。',
    '3. 请使用 Markdown，不要输出表格，不要出现未在参考数据中出现的地点。',
    '4. 可以做归纳和判断，但必须写成“基于当前命中结果/当前证据”，不要写成绝对事实。',
    '5. 数据是依据，不是报表；除非用户明确要数字，否则请把 bucket / pop / density 翻译成人话，不要生硬堆指标。'
  ]

  if (answerType === 'support_gap_analysis') {
    return [
      ...commonPrefix,
      '5. 这是一次空间推理型回答，不要退化成“附近可选地点”清单。',
      '6. 请严格使用下面结构：',
      '### 配套现状',
      '- 概括当前命中的配套构成，优先说明已经看到什么。',
      '### 热门业态',
      '- 提炼当前结果里最集中、最显眼的 2-4 类业态，可点名示例。',
      '### 明显缺口',
      '- 只能写“在当前命中结果中尚未明确看到/证据偏弱的配套”，不能写成绝对不存在。',
      '- 请按优先级给出 1-2 类更值得先补查或继续验证的缺口方向；如果样本偏少，要明确写成“先补查”，不要直接下绝对结论。',
      '### 还可以继续',
      '- 给出 1 句可继续追问的分析方向。',
      '7. 不要使用“附近可选地点”这类查点式标题。'
    ].join('\n')
  }

  if (answerType === 'area_overview') {
    return [
      ...commonPrefix,
      '5. 请严格使用下面结构：',
      '### 区域概览',
      '### 主要业态',
      '### 空间提示'
    ].join('\n')
  }

  if (answerType === 'site_suitability') {
    return [
      ...commonPrefix,
      '5. 请严格使用下面结构：',
      '### 场地画像',
      '### 适合布局',
      '### 谨慎点'
    ].join('\n')
  }

  if (answerType === 'region_comparison') {
    return [
      ...commonPrefix,
      '5. 请严格使用下面结构：',
      '### 对比结论',
      '### 各自特点',
      '### 选择建议'
    ].join('\n')
  }

  return [
    ...commonPrefix,
    '5. 请尽量遵循下面结构：',
    '### 先看结论',
    '- 用 1-2 句概括检索锚点、结果数量和整体判断。',
    '### 附近可选地点',
    '1. **地点名** · 类别 · 约xx米 · 一句简短点评',
    '2. ...',
    '### 还可以继续',
    '- 给出 1 句可继续追问的方向。',
    '6. 优先列出 4-8 个结果；如果实际不足，就如实列出。'
  ].join('\n')
}

export function buildSpatialAnswerFallback(query, results = [], options = {}) {
  const normalizedResults = normalizeResults(results)

  if (normalizedResults.length === 0) {
    return buildEmptyFallback(query, options)
  }

  switch (normalizeAnswerType(options.answerType)) {
    case 'support_gap_analysis':
      return buildSupportGapFallback(query, normalizedResults, options)
    case 'area_overview':
      return buildAreaOverviewFallback(query, normalizedResults, options)
    case 'site_suitability':
      return buildSiteSuitabilityFallback(query, normalizedResults, options)
    case 'region_comparison':
      return buildRegionComparisonFallback(query, normalizedResults, options)
    default:
      return buildNearbyLookupFallback(query, normalizedResults, options)
  }
}

export async function generateAnswerStream(query, results, onChunk, options = {}) {
  const {
    temperature = 0.7,
    maxTokens = 1024,
    streamImpl = callLLMStream
  } = options

  const normalizedResults = normalizeResults(results)

  if (shouldUseDeterministicNearbyAnswer(query, normalizedResults, options)) {
    const fallbackText = buildSpatialAnswerFallback(query, normalizedResults, options)
    if (typeof fallbackText === 'string' && fallbackText) {
      onChunk(fallbackText)
      return fallbackText
    }
  }

  const prompt = buildSpatialAnswerContract(query, normalizedResults, options)

  const finalText = await streamImpl([
    {
      role: 'system',
      content: '你是武汉空间问答助手。请用可信、简洁、有温度的中文回答，并严格基于给定参考数据作答。'
    },
    { role: 'user', content: prompt }
  ], (stage, content) => {
    if (typeof content === 'string' && content) {
      onChunk(content)
      return
    }

    if (typeof stage === 'string' && content === undefined) {
      onChunk(stage)
    }
  }, { temperature, maxTokens })

  return typeof finalText === 'string' ? stripThinkBlocks(finalText) : ''
}

export default {
  buildSpatialAnswerFallback,
  generateAnswerStream
}
