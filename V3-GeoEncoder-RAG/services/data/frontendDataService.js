import { query } from './database.js'

function toSafeLabel(value) {
  const text = String(value || '').trim()
  return text || '未分类'
}

function sortNodes(nodes = []) {
  nodes.sort((a, b) => {
    if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0)
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hans-CN')
  })

  nodes.forEach((node) => {
    if (Array.isArray(node.children)) {
      sortNodes(node.children)
    }
  })

  return nodes
}

export function buildCategoryTree(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const bigMap = new Map()

  rows.forEach((row) => {
    const big = toSafeLabel(row.big)
    const mid = toSafeLabel(row.mid)
    const small = toSafeLabel(row.small)
    const count = Math.max(0, Number(row.count) || 0)

    let bigNode = bigMap.get(big)
    if (!bigNode) {
      bigNode = {
        value: big,
        label: big,
        count: 0,
        children: [],
        _midMap: new Map()
      }
      bigMap.set(big, bigNode)
    }
    bigNode.count += count

    let midNode = bigNode._midMap.get(mid)
    if (!midNode) {
      midNode = {
        value: mid,
        label: mid,
        count: 0,
        children: [],
        _smallMap: new Map()
      }
      bigNode._midMap.set(mid, midNode)
      bigNode.children.push(midNode)
    }
    midNode.count += count

    const existingSmall = midNode._smallMap.get(small)
    if (existingSmall) {
      existingSmall.count += count
      return
    }

    const smallNode = { value: small, label: small, count }
    midNode._smallMap.set(small, smallNode)
    midNode.children.push(smallNode)
  })

  const tree = Array.from(bigMap.values()).map((bigNode) => ({
    value: bigNode.value,
    label: bigNode.label,
    count: bigNode.count,
    children: bigNode.children.map((midNode) => ({
      value: midNode.value,
      label: midNode.label,
      count: midNode.count,
      children: midNode.children.map((smallNode) => ({
        value: smallNode.value,
        label: smallNode.label,
        count: smallNode.count
      }))
    }))
  }))

  return sortNodes(tree)
}

export async function getCategoryTreeFromPois() {
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(category_main), ''), '未分类') AS big,
      COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类')) AS mid,
      COALESCE(NULLIF(TRIM(brand_category), ''), COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类'))) AS small,
      COUNT(*)::int AS count
    FROM public.pois
    GROUP BY 1, 2, 3
    ORDER BY big, mid, small
  `

  const result = await query(sql)
  return buildCategoryTree(result.rows)
}

export function boundsToWKT(bounds = null) {
  if (!Array.isArray(bounds) || bounds.length < 4) return null

  const [minLon, minLat, maxLon, maxLat] = bounds.map((value) => Number(value))
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null

  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`
}

export function toSpatialPoiFeature(poi = {}) {
  const lon = Number.parseFloat(poi?.lon ?? poi?.longitude)
  const lat = Number.parseFloat(poi?.lat ?? poi?.latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null
  }

  const categoryBig = poi?.category_big ?? poi?.category_main ?? ''
  const categoryMid = poi?.category_mid ?? poi?.category_sub ?? ''
  const categorySmall = poi?.category_small ?? poi?.brand_category ?? poi?.category_sub ?? categoryBig
  const address = poi?.address ?? poi?.location_hint ?? ''
  const type = poi?.type ?? poi?.category_sub ?? categoryBig

  return {
    type: 'Feature',
    id: poi?.id || poi?.poiid,
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    properties: {
      id: poi?.id || poi?.poiid,
      name: poi?.name,
      '名称': poi?.name,
      address,
      '地址': address,
      type,
      category_big: categoryBig,
      category_mid: categoryMid,
      category_small: categorySmall,
      '大类': categoryBig,
      '中类': categoryMid,
      '小类': categorySmall,
      distance_m: poi?.distance_m ?? null
    }
  }
}

export async function findPOIsFiltered({ categories = [], bounds = null, geometry = null, limit = 100, anchor = null, radius = 1000 } = {}) {
  const normalizedGeometry = typeof geometry === 'string' && geometry.trim()
    ? geometry.trim()
    : boundsToWKT(bounds)

  let sql = `
    SELECT
      p.id, p.name,
      p.location_hint AS address,
      p.category_sub AS type,
      p.category_main AS category_big,
      p.category_sub AS category_mid,
      COALESCE(NULLIF(TRIM(p.brand_category), ''), COALESCE(NULLIF(TRIM(p.category_sub), ''), p.category_main)) AS category_small,
      p.longitude AS lon,
      p.latitude AS lat
  `

  const params = []
  let paramIndex = 1
  let geometryParamIndex = null

  if (anchor && Number.isFinite(Number(anchor.lon)) && Number.isFinite(Number(anchor.lat))) {
    sql += `, ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography) AS distance_m`
    params.push(Number(anchor.lon), Number(anchor.lat))
    paramIndex += 2
  } else {
    sql += `, 0 AS distance_m`
  }

  sql += ` FROM public.pois p WHERE 1=1`

  if (normalizedGeometry) {
    geometryParamIndex = paramIndex
    sql += ` AND ST_Within(p.geom, ST_GeomFromText($${geometryParamIndex}, 4326))`
    params.push(normalizedGeometry)
    paramIndex += 1
  } else if (anchor && Number.isFinite(Number(anchor.lon)) && Number.isFinite(Number(anchor.lat))) {
    sql += ` AND ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $${paramIndex})`
    params.push(Number(radius) || 1000)
    paramIndex += 1
  }

  if (Array.isArray(categories) && categories.length > 0) {
    const categoryConditions = categories.map((_, index) => {
      const idx = paramIndex + index
      return `(
        p.name ILIKE $${idx}
        OR p.location_hint ILIKE $${idx}
        OR p.category_main ILIKE $${idx}
        OR p.category_sub ILIKE $${idx}
        OR p.brand_category ILIKE $${idx}
      )`
    })
    sql += ` AND (${categoryConditions.join(' OR ')})`
    categories.forEach((item) => params.push(`%${String(item || '').trim()}%`))
    paramIndex += categories.length
  }

  const orderClause = anchor
    ? 'distance_m ASC'
    : geometryParamIndex !== null
      ? `p.geom <-> ST_Centroid(ST_GeomFromText($${geometryParamIndex}, 4326))`
      : 'p.id'

  sql += ` ORDER BY ${orderClause} LIMIT $${paramIndex}`
  const maxLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || '20000', 10)
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, maxLimit))
  params.push(safeLimit)

  const result = await query(sql, params)
  return result.rows
}

const CATEGORY_SYNONYMS = {
  '咖啡': ['咖啡馆', '咖啡厅', '咖啡店', 'cafe', '星巴克', 'Starbucks', '瑞幸咖啡', 'Luckin'],
  '烧烤': ['撸串', '烤肉', '烤串', 'BBQ'],
  '小吃': ['零食', '小吃店', '特色小吃'],
  '甜点': ['蛋糕', '甜品', '面包', '烘焙', '糕点', '西点'],
  '超市': ['便利店', '商店', '小卖部', '杂货店', '711', '全家', '罗森'],
  '药店': ['药房', '大药房', '医药'],
  '公交': ['公交站', '公共汽车', '公交车站', 'BRT'],
  '停车': ['停车场', '停车位', '车库'],
  '学校': ['小学', '中学', '高中', '初中', '学院', '大学', '校园'],
  '幼儿园': ['托儿所', '早教', '托育'],
  '健身': ['健身房', '运动', '瑜伽', '游泳', '体育馆'],
  '电影': ['电影院', '影城', '影院', 'IMAX'],
  'KTV': ['卡拉OK', 'K歌', '歌厅'],
  '公园': ['广场', '游园', '绿地', '景区', '风景区']
}

const REVERSE_SYNONYMS = {}
Object.entries(CATEGORY_SYNONYMS).forEach(([standard, synonyms]) => {
  REVERSE_SYNONYMS[standard.toLowerCase()] = standard
  synonyms.forEach((synonym) => {
    REVERSE_SYNONYMS[String(synonym || '').toLowerCase()] = standard
  })
})

export function expandSearchTerms(term = '') {
  const normalized = String(term || '').trim().toLowerCase()
  if (!normalized) return []

  const terms = new Set([normalized])
  const standardTerm = REVERSE_SYNONYMS[normalized]
  if (standardTerm) {
    terms.add(standardTerm.toLowerCase())
    const synonyms = CATEGORY_SYNONYMS[standardTerm] || []
    synonyms.forEach((synonym) => terms.add(String(synonym || '').toLowerCase()))
  }

  return Array.from(terms)
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

function scoreQuickSearchCandidate(candidate = {}, placeName = '', queryVariants = [placeName], densityMap = null) {
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

export function isSimpleQuery(query = '') {
  const q = String(query || '').trim()
  if (!q) return false
  if (q.length > 15) return false

  const complexPatterns = [
    /附近/, /周边/, /周围/, /旁边/,
    /有什么/, /有没有/, /哪里有/, /哪有/,
    /推荐/, /建议/, /适合/, /好吃/, /好玩/,
    /最近的/, /最好的/, /便宜/,
    /怎么/, /如何/, /为什么/,
    /帮我/, /请问/, /想要/, /我要/,
    /分析/, /比较/, /选择/
  ]

  return !complexPatterns.some((pattern) => pattern.test(q))
}

function hasExplicitCoordinate(value) {
  if (value === null || value === undefined) return false

  const text = String(value).trim()
  if (!text) return false

  return Number.isFinite(Number(text))
}

async function runQuickSearchQuery({ queryText = '', lat = null, lon = null, radius = 5000, limit = 100, geometry = null, preferPrefix = false } = {}) {
  const rawQueryText = String(queryText || '').trim()
  const terms = expandSearchTerms(queryText)
  if (terms.length === 0) {
    return []
  }

  const center = hasExplicitCoordinate(lat) && hasExplicitCoordinate(lon)
    ? { lat: Number(lat), lon: Number(lon) }
    : null

  let sql = `
    SELECT
      p.id,
      p.name,
      p.location_hint AS address,
      p.category_main AS category_big,
      p.category_sub AS category_mid,
      COALESCE(NULLIF(TRIM(p.brand_category), ''), COALESCE(NULLIF(TRIM(p.category_sub), ''), p.category_main)) AS category_small,
      p.longitude AS lon,
      p.latitude AS lat
  `

  const params = []
  let paramIndex = 1

  if (center) {
    sql += `, ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography) AS distance_m`
    params.push(center.lon, center.lat)
    paramIndex += 2
  } else {
    sql += `, 0 AS distance_m`
  }

  sql += ` FROM public.pois p WHERE `

  const termConditions = terms.map((_, index) => {
    const idx = paramIndex + index
    return `(
      p.name ILIKE $${idx}
      OR p.category_main ILIKE $${idx}
      OR p.category_sub ILIKE $${idx}
      OR p.brand_category ILIKE $${idx}
    )`
  })
  sql += `(${termConditions.join(' OR ')})`
  terms.forEach((term) => params.push(`%${term}%`))
  paramIndex += terms.length

  if (geometry) {
    sql += ` AND ST_Within(p.geom, ST_GeomFromText($${paramIndex}, 4326))`
    params.push(geometry)
    paramIndex += 1
  } else if (center) {
    sql += ` AND ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $${paramIndex})`
    params.push(Number(radius) || 5000)
    paramIndex += 1
  }

  if (preferPrefix && rawQueryText) {
    const exactIndex = paramIndex
    const parenPrefixIndex = paramIndex + 1
    const dashPrefixIndex = paramIndex + 2
    const prefixIndex = paramIndex + 3

    sql += ` ORDER BY CASE
      WHEN p.name = $${exactIndex} THEN 0
      WHEN p.name ILIKE $${parenPrefixIndex} OR p.name ILIKE $${dashPrefixIndex} THEN 1
      WHEN p.name ILIKE $${prefixIndex} THEN 2
      ELSE 9
    END`
    sql += center ? ', distance_m ASC' : ', p.name ASC'

    params.push(
      rawQueryText,
      `${rawQueryText}(%`,
      `${rawQueryText}-%`,
      `${rawQueryText}%`
    )
    paramIndex += 4
  } else {
    sql += center ? ' ORDER BY distance_m ASC' : ' ORDER BY p.name ASC'
  }

  sql += ` LIMIT $${paramIndex}`
  const maxLimit = parseInt(process.env.POI_QUERY_MAX_LIMIT || '20000', 10)
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, maxLimit))
  params.push(safeLimit)

  const result = await query(sql, params)
  return result.rows
}

export async function quickSearchPois({ queryText = '', lat = null, lon = null, radius = 5000, limit = 100, geometry = null, preferPrefix = false } = {}) {
  const rawQueryText = String(queryText || '').trim()
  if (!rawQueryText) return []

  const queryVariants = buildPlaceNameVariants(rawQueryText)
  const perQueryLimit = queryVariants.length > 1 ? Math.max(Number(limit) || 100, 20) : limit
  const allCandidates = []
  const candidateMap = new Map()

  for (const variant of queryVariants) {
    const rows = await runQuickSearchQuery({
      queryText: variant,
      lat,
      lon,
      radius,
      limit: perQueryLimit,
      geometry,
      preferPrefix
    })

    for (const row of rows) {
      allCandidates.push(row)
      const dedupeKey = row?.id ?? `${row?.name || ''}:${row?.lon || ''}:${row?.lat || ''}`
      if (!candidateMap.has(dedupeKey)) {
        candidateMap.set(dedupeKey, row)
      }
    }
  }

  const candidates = [...candidateMap.values()]
  if (candidates.length <= 1 || queryVariants.length === 1) {
    return candidates.slice(0, Math.max(1, Number(limit) || 100))
  }

  const densityMap = buildCandidateDensityMap(allCandidates)
  return candidates
    .sort((a, b) => (
      scoreQuickSearchCandidate(b, rawQueryText, queryVariants, densityMap)
      - scoreQuickSearchCandidate(a, rawQueryText, queryVariants, densityMap)
    ))
    .slice(0, Math.max(1, Number(limit) || 100))
}

export default {
  buildCategoryTree,
  getCategoryTreeFromPois,
  boundsToWKT,
  toSpatialPoiFeature,
  findPOIsFiltered,
  expandSearchTerms,
  isSimpleQuery,
  quickSearchPois
}
