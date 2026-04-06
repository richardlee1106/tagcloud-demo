import { quickSearchPois } from '../data/frontendDataService.js'
import { parseIntent } from './ai/intentService.js'
import { buildSpatialGeometryEvidence } from '../retrieval/spatialEvidenceService.js'
import { faissHybridSearch } from '../retrieval/faissIndex.js'
import {
  buildQueryEmbeddingSearchOptions,
  buildSpatialQueryEmbedding
} from '../retrieval/queryEmbeddingService.js'
import { enrichResultsWithSpatialEncoder, enrichResultsWithCellContext } from '../retrieval/runtimeSpatialAugmenter.js'
import { searchMacroCellsWithTownEncoder } from '../retrieval/runtimeSpatialAugmenter.js'
import { createToolRunner } from './toolRunner.js'

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function hasAnchorCoordinates(anchor = {}) {
  return toFiniteNumber(anchor?.lon) !== null && toFiniteNumber(anchor?.lat) !== null
}

function normalizeSearchText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[()（）[\]【】·\-—_.,，。:：;；\s]/g, '')
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
      variants.add(`${prefix}${ordinal}中`)
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

function buildAnchorOutput(candidate = {}, {
  placeName = '',
  role = 'primary',
  index = 0,
  source = 'quick_search',
  resolvedPlaceName = null
} = {}) {
  const lon = toFiniteNumber(candidate?.lon)
  const lat = toFiniteNumber(candidate?.lat)

  const anchor = {
    place_name: placeName,
    display_name: placeName,
    role,
    index,
    source,
    resolved_place_name: String(resolvedPlaceName || candidate?.name || placeName).trim() || placeName,
    poi_id: candidate?.id ?? null
  }

  if (lon !== null) anchor.lon = lon
  if (lat !== null) anchor.lat = lat

  return { anchor }
}

function buildUnresolvedAnchorOutput({ placeName = '', role = 'primary', index = 0 } = {}) {
  return buildAnchorOutput({}, {
    placeName,
    role,
    index,
    source: 'quick_search_unavailable',
    resolvedPlaceName: placeName
  })
}

function buildSearchIntent({ filter = {}, radiusM = 800 } = {}) {
  const normalizedCategory = normalizePlannerCategory(filter?.category)
  const normalizedSubcategory = normalizePlannerSubcategory(filter?.subcategory)

  return {
    category: normalizedCategory,
    poiSubType: normalizedSubcategory,
    regionLabel: filter?.target_region ?? null,
    radiusM
  }
}

function normalizePlannerCategory(value = '') {
  const category = String(value || '').trim()
  if (!category) return null

  switch (category) {
    case '交通出行':
      return '交通设施服务'
    default:
      return category
  }
}

function normalizePlannerSubcategory(value = '') {
  const subcategory = String(value || '').trim()
  if (!subcategory) return null

  switch (subcategory) {
    case '地铁':
      return '地铁站'
    case '公交':
      return '公交车站'
    default:
      return subcategory
  }
}

function normalizeMacroOutput(payload = {}) {
  return {
    support_buckets: payload?.supportBucketDistribution || [],
    support_bucket_metrics: [],
    population_metrics: null,
    uncertainty: payload?.macroUncertainty || null,
    cells: payload?.cells || [],
    dominant_buckets: payload?.dominantBuckets || [],
    scene_tags: payload?.sceneTags || [],
    cell_mix: payload?.cellMix || []
  }
}

function buildSearchAnchorOptions(input = {}) {
  const searchRadius = Number(input?.search_radius_m || 50000)
  const searchHint = String(input?.search_hint || '').trim()
  const coordinateMatch = searchHint.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/u)

  if (!coordinateMatch) return {}

  const lon = toFiniteNumber(coordinateMatch[1])
  const lat = toFiniteNumber(coordinateMatch[2])
  if (lon === null || lat === null) return {}

  return {
    lon,
    lat,
    radius: searchRadius
  }
}

function buildAnchorContextFromEncoding(queryEmbedding = {}, macroPayload = {}, anchor = {}) {
  return {
    anchor: {
      place_name: anchor?.place_name || null,
      display_name: anchor?.display_name || anchor?.place_name || null,
      lon: toFiniteNumber(anchor?.lon),
      lat: toFiniteNumber(anchor?.lat),
      source: anchor?.source || null
    },
    query_embedding_source: queryEmbedding?.source || null,
    query_embedding_applied: queryEmbedding?.applied === true,
    query_embedding_dim: queryEmbedding?.embeddingDim || 0,
    macro_cell_count: Array.isArray(macroPayload?.cells) ? macroPayload.cells.length : 0,
    model_route: macroPayload?.modelRoute || null,
    models_used: macroPayload?.modelsUsed || queryEmbedding?.modelUsage || []
  }
}

export function createSpatialCoreHandlers({
  quickSearchPois: quickSearchPoisImpl = quickSearchPois,
  parseIntent: parseIntentImpl = parseIntent,
  buildSpatialGeometryEvidence: buildSpatialGeometryEvidenceImpl = buildSpatialGeometryEvidence,
  faissHybridSearch: faissHybridSearchImpl = faissHybridSearch,
  buildSpatialQueryEmbedding: buildSpatialQueryEmbeddingImpl = buildSpatialQueryEmbedding,
  buildQueryEmbeddingSearchOptions: buildQueryEmbeddingSearchOptionsImpl = buildQueryEmbeddingSearchOptions,
  searchMacroCellsWithTownEncoder: searchMacroCellsWithTownEncoderImpl = searchMacroCellsWithTownEncoder,
  enrichResultsWithSpatialEncoder: enrichResultsWithSpatialEncoderImpl = enrichResultsWithSpatialEncoder,
  enrichResultsWithCellContext: enrichResultsWithCellContextImpl = enrichResultsWithCellContext
} = {}) {
  return {
    async resolve_anchor(input = {}, context = {}) {
      const placeName = String(input?.place_name || '').trim()
      const role = String(input?.role || 'primary').trim() || 'primary'
      const queryVariants = buildPlaceNameVariants(placeName)
      const allCandidates = []
      const candidateMap = new Map()
      const searchAnchorOptions = buildSearchAnchorOptions(input)

      try {
        for (const queryText of queryVariants) {
          const rows = await quickSearchPoisImpl({
            queryText,
            limit: 120,
            preferPrefix: true,
            ...searchAnchorOptions
          })

          for (const candidate of Array.isArray(rows) ? rows : []) {
            allCandidates.push(candidate)
            const dedupeKey = candidate?.id ?? `${candidate?.name || ''}:${candidate?.lon || ''}:${candidate?.lat || ''}`
            if (!candidateMap.has(dedupeKey)) {
              candidateMap.set(dedupeKey, candidate)
            }
          }
        }
      } catch (error) {
        console.warn('[SpatialCore] resolve_anchor degraded because quick search is unavailable:', error?.message || error)
        return buildUnresolvedAnchorOutput({
          placeName,
          role,
          index: role === 'secondary' ? 1 : 0
        })
      }

      const candidates = [...candidateMap.values()]
      const densityMap = buildCandidateDensityMap(allCandidates)
      const ranked = candidates.length > 1
        ? candidates.slice().sort((a, b) => (
          scorePlaceAnchorCandidate(b, placeName, queryVariants, densityMap)
          - scorePlaceAnchorCandidate(a, placeName, queryVariants, densityMap)
        ))
        : candidates
      const top = ranked[0] || {}
      return buildAnchorOutput(top, {
        placeName,
        role,
        index: role === 'secondary' ? 1 : 0
      })
    },

    async search_nearby_pois(input = {}, context = {}) {
      const anchor = input?.anchor || {}
      const radiusM = Number(input?.radius_m || 800)
      const filter = input?.filter || {}
      const limit = Number(input?.limit || 20)
      const normalizedCategory = normalizePlannerCategory(filter?.category)
      const normalizedSubcategory = normalizePlannerSubcategory(filter?.subcategory)
      const intent = buildSearchIntent({
        filter: {
          ...filter,
          category: normalizedCategory,
          subcategory: normalizedSubcategory
        },
        radiusM
      })

      if (!hasAnchorCoordinates(anchor)) {
        return {
          pois: [],
          total_count: 0
        }
      }

      let hybridSearchOptions = {}
      if (typeof buildSpatialQueryEmbeddingImpl === 'function' && typeof buildQueryEmbeddingSearchOptionsImpl === 'function') {
        const queryEmbedding = await buildSpatialQueryEmbeddingImpl({
          userQuery: context?.user_query || '',
          intent,
          anchor
        })
        hybridSearchOptions = buildQueryEmbeddingSearchOptionsImpl(queryEmbedding)
      }

      const results = await faissHybridSearchImpl({
        anchor,
        radius: radiusM,
        categories: normalizedCategory ? [normalizedCategory] : [],
        subcategory: normalizedSubcategory || null,
        topK: limit,
        targetRegion: filter?.target_region ?? null,
        regionFilterMode: filter?.region_filter_mode || 'boost',
        ...hybridSearchOptions
      })

      return {
        pois: Array.isArray(results) ? results : [],
        total_count: Array.isArray(results) ? results.length : 0
      }
    },

    async vector_search(input = {}, context = {}) {
      const anchor = input?.anchor || {}
      const limit = Number(input?.limit || 20)
      const filter = input?.filter || {}
      const intent = buildSearchIntent({
        filter,
        radiusM: 2500
      })

      if (!hasAnchorCoordinates(anchor)) {
        return {
          pois: [],
          total_count: 0
        }
      }

      let hybridSearchOptions = {}
      if (typeof buildSpatialQueryEmbeddingImpl === 'function' && typeof buildQueryEmbeddingSearchOptionsImpl === 'function') {
        const queryEmbedding = await buildSpatialQueryEmbeddingImpl({
          userQuery: input?.target || context?.user_query || '',
          intent,
          anchor
        })
        hybridSearchOptions = buildQueryEmbeddingSearchOptionsImpl(queryEmbedding)
      }

      const results = await faissHybridSearchImpl({
        anchor,
        radius: 2500,
        categories: filter?.category ? [filter.category] : [],
        subcategory: filter?.subcategory || null,
        topK: limit,
        targetRegion: filter?.target_region ?? null,
        regionFilterMode: 'boost',
        semanticWeight: hybridSearchOptions.semanticWeight ?? 0.7,
        spatialWeight: hybridSearchOptions.spatialWeight ?? 0.3,
        ...(hybridSearchOptions.queryEmbedding ? { queryEmbedding: hybridSearchOptions.queryEmbedding } : {})
      })

      return {
        pois: Array.isArray(results) ? results : [],
        total_count: Array.isArray(results) ? results.length : 0
      }
    },

    async macro_cell_analysis(input = {}, context = {}) {
      const anchor = input?.anchor || {}
      const taskType = String(input?.focus || 'area_overview').trim() || 'area_overview'
      if (!hasAnchorCoordinates(anchor)) {
        return normalizeMacroOutput({})
      }
      const payload = await searchMacroCellsWithTownEncoderImpl({
        anchor,
        intent: {
          taskType,
          answerType: taskType,
          radiusM: Number(input?.radius_m || 2500)
        },
        userQuery: context?.user_query || ''
      })

      return normalizeMacroOutput(payload || {})
    },

    async spatial_encode(input = {}, context = {}) {
      const anchor = input?.anchor || {}
      if (!hasAnchorCoordinates(anchor)) {
        return {
          anchor_context: buildAnchorContextFromEncoding({ applied: false }, {}, anchor)
        }
      }
      const queryEmbedding = typeof buildSpatialQueryEmbeddingImpl === 'function'
        ? await buildSpatialQueryEmbeddingImpl({
            userQuery: context?.user_query || '',
            intent: {
              taskType: input?.focus || null
            },
            anchor
          })
        : { applied: false }
      const macroPayload = typeof searchMacroCellsWithTownEncoderImpl === 'function'
        ? await searchMacroCellsWithTownEncoderImpl({
            anchor,
            intent: {
              taskType: input?.focus || 'area_overview',
              answerType: input?.focus || 'area_overview',
              radiusM: 1500
            },
            userQuery: context?.user_query || ''
          })
        : {}

      return {
        anchor_context: buildAnchorContextFromEncoding(queryEmbedding, macroPayload, anchor)
      }
    },

    async build_boundary(input = {}, context = {}) {
      const anchor = input?.anchor || {}
      const pois = Array.isArray(input?.pois) ? input.pois : []
      if (!hasAnchorCoordinates(anchor)) {
        const geometryEvidence = buildSpatialGeometryEvidenceImpl({
          filteredResults: pois,
          anchor
        })

        return {
          boundary: geometryEvidence?.boundary || null,
          spatial_clusters: geometryEvidence?.spatialClusters || { hotspots: [] },
          vernacular_regions: geometryEvidence?.vernacularRegions || [],
          fuzzy_regions: geometryEvidence?.fuzzyRegions || []
        }
      }
      const runtimeEnrichment = typeof enrichResultsWithSpatialEncoderImpl === 'function'
        ? await enrichResultsWithSpatialEncoderImpl({
            anchor,
            results: pois
          })
        : { results: pois }
      const enrichedPois = Array.isArray(runtimeEnrichment?.results) ? runtimeEnrichment.results : pois
      const cellContextEnrichment = typeof enrichResultsWithCellContextImpl === 'function'
        ? await enrichResultsWithCellContextImpl({
            anchor,
            results: enrichedPois,
            intent: {},
            userQuery: context?.user_query || ''
          })
        : { results: enrichedPois }
      const finalPois = Array.isArray(cellContextEnrichment?.results) ? cellContextEnrichment.results : enrichedPois
      const geometryEvidence = buildSpatialGeometryEvidenceImpl({
        filteredResults: finalPois,
        anchor
      })

      return {
        boundary: geometryEvidence?.boundary || null,
        spatial_clusters: geometryEvidence?.spatialClusters || { hotspots: [] },
        vernacular_regions: geometryEvidence?.vernacularRegions || [],
        fuzzy_regions: geometryEvidence?.fuzzyRegions || []
      }
    },

    async infer_intent_legacy(input = {}) {
      const intent = await parseIntentImpl(String(input?.user_query || ''))
      return {
        intent
      }
    }
  }
}

export function createSpatialCoreToolRunner(options = {}) {
  return createToolRunner({
    handlers: createSpatialCoreHandlers(options)
  })
}

export default {
  createSpatialCoreHandlers,
  createSpatialCoreToolRunner
}
