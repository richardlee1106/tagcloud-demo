import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseEnv } from 'dotenv'

const DEFAULT_CONTENT_TYPE = 'application/json; charset=utf-8'
const DEFAULT_HEADERS = {
  'Content-Type': DEFAULT_CONTENT_TYPE,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

const DEFAULT_ROUTE_TIMEOUT_MS = 4000

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toPositiveInt(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizeArrayPoint(value) {
  if (!Array.isArray(value) || value.length < 2) return null
  const lon = toFiniteNumber(value[0], null)
  const lat = toFiniteNumber(value[1], null)
  if (lon === null || lat === null) return null
  return [lon, lat]
}

function readEnvFile(filepath) {
  if (!filepath || !existsSync(filepath)) {
    return {}
  }

  return parseEnv(readFileSync(filepath, 'utf8'))
}

export function resolveVectorCacheFile({
  rootDir = process.cwd(),
  exists = existsSync,
} = {}) {
  const candidates = [
    join(rootDir, 'cache', 'embeddings.bin'),
    join(rootDir, 'V3-GeoEncoder-RAG', 'cache', 'embeddings.bin'),
  ]

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

function applyEnvToProcess(env = {}) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null || value === '') continue
    if (!process.env[key]) {
      process.env[key] = String(value)
    }
  }
}

function stripDecorators(text = '') {
  return String(text || '')
    .replace(/^(请问|请帮我|帮我|想知道|我想知道|请直接|麻烦你)\s*/u, '')
    .replace(/[？?！!。.\s]+$/u, '')
    .trim()
}

function sanitizeAnchor(rawAnchor = '') {
  const cleaned = stripDecorators(
    String(rawAnchor || '')
      .replace(/^(离|从)\s*/u, '')
      .replace(/(有哪些|有什么|都有什么|最近的?|是什么|气质相似.*|附近.*|周边.*|站口.*|出口.*|并说明.*).*$/u, '')
      .trim(),
  )

  if (!cleaned) return null
  if (['这里', '这里附近', '这附近', '这片区', '当前区域', '当前片区', '此处'].includes(cleaned)) {
    return null
  }

  return cleaned
}

function extractAnchorCandidates(text = '') {
  const normalized = stripDecorators(text)
  const candidates = []
  const pushCandidate = (value) => {
    const cleaned = sanitizeAnchor(value)
    if (cleaned && !candidates.includes(cleaned)) {
      candidates.push(cleaned)
    }
  }

  const nearbyIndex = normalized.search(/附近|周边/u)
  if (nearbyIndex > 0) {
    pushCandidate(normalized.slice(0, nearbyIndex))
  }

  const nearestIndex = normalized.search(/最近/u)
  if (nearestIndex > 0) {
    pushCandidate(normalized.slice(0, nearestIndex))
  }

  const similarMatch = normalized.match(/和(.+?)(?:附近|周边)?(?:气质)?相似/u)
  if (similarMatch) {
    pushCandidate(similarMatch[1])
  }

  const compareMatch = normalized.match(/(?:比较|对比)(.+?)和(.+?)(?:附近|周边)?的/u)
  if (compareMatch) {
    pushCandidate(compareMatch[1])
    pushCandidate(compareMatch[2])
  }

  const namedEntityMatches = normalized.matchAll(
    /([A-Za-z0-9\u4e00-\u9fa5]{2,40}?(?:大学|学院|学校|校区|中学|小学|幼儿园|地铁站|车站|站|公园|广场|医院|商场|商圈|中心|大厦|社区|园区))/gu,
  )
  for (const match of namedEntityMatches) {
    pushCandidate(match[1])
  }

  pushCandidate(normalized)
  return candidates
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))]
}

function inferPlaceKind(placeName = '') {
  if (/(大学|学院|学校|校区|中学|小学|幼儿园|附中|高中|初中)/u.test(placeName)) return 'education'
  if (/(地铁站|地铁口|火车站|高铁站|站)/u.test(placeName)) return 'transport'
  if (/(公园|景区|广场)/u.test(placeName)) return 'scenic'
  return 'generic'
}

function buildAnchorClusterKey(row = {}) {
  const lon = toFiniteNumber(row.lon ?? row.longitude, null)
  const lat = toFiniteNumber(row.lat ?? row.latitude, null)
  if (lon === null || lat === null) return 'unknown'
  return `${lon.toFixed(5)},${lat.toFixed(5)}`
}

function getAnchorNeighborhoodRadiusMeters(placeKind = 'generic') {
  if (placeKind === 'education') return 1200
  if (placeKind === 'transport') return 450
  if (placeKind === 'scenic') return 900
  return 700
}

function computeAnchorCategoryBonus({ safeName = '', safeCategorySub = '', placeKind = 'generic' } = {}) {
  if (placeKind === 'education') {
    if (['学校', '高等院校', '中学', '小学', '幼儿园'].includes(safeCategorySub)) {
      return 80
    }
    if (safeName.includes('校区') || safeName.includes('学院') || safeName.includes('图书馆')) {
      return 30
    }
    return 0
  }

  if (placeKind === 'transport') {
    if (['地铁站', '公交车站', '火车站', '高铁站'].includes(safeCategorySub)) {
      return 80
    }
    if (safeName.includes('站')) {
      return 24
    }
    return 0
  }

  if (placeKind === 'scenic') {
    if (['公园广场', '风景名胜'].includes(safeCategorySub)) {
      return 60
    }
  }

  return 0
}

function describeAnchorNameMatch(safeName = '', candidateText = '') {
  const exactMatch = safeName === candidateText
  const prefixMatch = !exactMatch && safeName.startsWith(candidateText)
  const containsMatch = !exactMatch && !prefixMatch && safeName.includes(candidateText)

  return {
    exactMatch,
    prefixMatch,
    containsMatch,
    matchScore: exactMatch ? 300 : prefixMatch ? 180 : containsMatch ? 120 : 100,
  }
}

function computeAnchorSupportWeight(row = {}, candidateText = '', placeKind = inferPlaceKind(candidateText)) {
  const safeName = normalizeText(row.name)
  const safeCategorySub = normalizeText(row.category_sub || row.categorySub)
  const match = describeAnchorNameMatch(safeName, candidateText)

  let weight = match.exactMatch ? 140 : match.prefixMatch ? 92 : match.containsMatch ? 48 : 24
  weight += Math.max(0, computeAnchorCategoryBonus({ safeName, safeCategorySub, placeKind }) * 0.35)

  return weight
}

function computeAnchorCandidateScore(row = {}, candidateText = '', placeKind = inferPlaceKind(candidateText)) {
  const safeName = normalizeText(row.name)
  const safeCategorySub = normalizeText(row.category_sub || row.categorySub)
  const match = describeAnchorNameMatch(safeName, candidateText)

  let score = match.matchScore
  score += Math.max(0, Number(row.clusterCount || 0) - 1) * 24
  score += Number(row.supportScore || 0)
  score -= safeName.length
  score += computeAnchorCategoryBonus({ safeName, safeCategorySub, placeKind })

  return score
}

export function selectBestAnchorCandidate(rows = [], candidateText = '') {
  const safeRows = Array.isArray(rows) ? rows : []
  if (safeRows.length === 0) {
    return null
  }

  const clusterCounts = new Map()
  for (const row of safeRows) {
    const clusterKey = buildAnchorClusterKey(row)
    clusterCounts.set(clusterKey, (clusterCounts.get(clusterKey) || 0) + 1)
  }

  const placeKind = inferPlaceKind(candidateText)
  const neighborhoodRadiusMeters = getAnchorNeighborhoodRadiusMeters(placeKind)
  const rowsWithClusters = safeRows.map((row, index) => ({
    ...row,
    _sourceIndex: index,
    _lon: toFiniteNumber(row.lon ?? row.longitude, null),
    _lat: toFiniteNumber(row.lat ?? row.latitude, null),
    clusterCount: clusterCounts.get(buildAnchorClusterKey(row)) || 1,
  }))

  return rowsWithClusters
    .map((row) => {
      let supportScore = 0
      for (const peer of rowsWithClusters) {
        if (peer._sourceIndex === row._sourceIndex) continue
        if (row._lon === null || row._lat === null || peer._lon === null || peer._lat === null) continue

        const distanceMeters = haversineDistanceMeters([row._lon, row._lat], [peer._lon, peer._lat])
        if (distanceMeters > neighborhoodRadiusMeters) continue

        const distanceFactor = 1 - Math.min(0.35, (distanceMeters / neighborhoodRadiusMeters) * 0.35)
        supportScore += computeAnchorSupportWeight(peer, candidateText, placeKind) * distanceFactor
      }

      const match = describeAnchorNameMatch(normalizeText(row.name), candidateText)
      const augmentedRow = {
        ...row,
        supportScore: Number(supportScore.toFixed(2)),
      }

      return {
        ...augmentedRow,
        ...match,
        candidateScore: computeAnchorCandidateScore(augmentedRow, candidateText, placeKind),
      }
    })
    .sort((left, right) => (
      right.candidateScore - left.candidateScore
      || right.clusterCount - left.clusterCount
      || Number(right.exactMatch) - Number(left.exactMatch)
      || Number(right.prefixMatch) - Number(left.prefixMatch)
      || left._sourceIndex - right._sourceIndex
    ))
    .map(({ _sourceIndex, _lon, _lat, ...row }) => ({
      ...row,
    }))[0] || null
}

function inferSearchRadius(text = '') {
  if (/最近/u.test(text)) return 1200
  if (/相似|像/u.test(text)) return 1800
  return 1000
}

function inferSimilarRegionTask(text = '') {
  if (/配套|缺口/u.test(text)) return 'support_gap_analysis'
  if (/适合|选址/u.test(text)) return 'site_suitability'
  if (/比较|对比/u.test(text)) return 'region_comparison'
  return 'area_overview'
}

function buildRegionSummary(cell = {}) {
  const parts = [
    cell.region_name,
    cell.dominant_category ? `${cell.dominant_category}占优` : null,
    Array.isArray(cell.scene_tags) && cell.scene_tags.length > 0
      ? cell.scene_tags.slice(0, 2).join('、')
      : null,
  ].filter(Boolean)

  return parts.join('，') || '空间结构与功能氛围相近'
}

function toScore(value, fallback = 0.5) {
  const numeric = toFiniteNumber(value, fallback)
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(4))
}

function toRouteProfile(mode = 'walking') {
  const normalized = String(mode || 'walking').trim().toLowerCase()
  if (normalized === 'driving') {
    return {
      osrm: 'driving',
      amap: 'driving',
    }
  }

  if (normalized === 'cycling' || normalized === 'bicycling') {
    return {
      osrm: 'cycling',
      amap: 'bicycling',
    }
  }

  return {
    osrm: 'foot',
    amap: 'walking',
  }
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function haversineDistanceMeters(origin, destination) {
  const earthRadiusMeters = 6371000
  const deltaLat = toRadians(destination[1] - origin[1])
  const deltaLon = toRadians(destination[0] - origin[0])
  const lat1 = toRadians(origin[1])
  const lat2 = toRadians(destination[1])
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMeters * c
}

function buildFallbackRoute(origin, destination, mode = 'walking', degradedReason = 'routing_service_unavailable') {
  const directDistance = haversineDistanceMeters(origin, destination)
  const distance = directDistance * 1.22
  const speedMetersPerMinute = mode === 'driving' ? 650 : mode === 'cycling' ? 220 : 75

  return {
    distance_m: Number(distance.toFixed(1)),
    duration_min: Math.max(1, Math.round(distance / speedMetersPerMinute)),
    degraded: true,
    degraded_reason: degradedReason,
  }
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, DEFAULT_HEADERS)
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch {
        const error = new Error('invalid_json')
        error.code = 'invalid_json'
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

export function createJsonRequestHandler(handler) {
  return async (request, response) => {
    try {
      const payload = await readJsonBody(request)
      const result = await handler(payload, request)
      if (!response.writableEnded) {
        writeJson(response, 200, result)
      }
    } catch (error) {
      if (error?.code === 'invalid_json') {
        writeJson(response, 400, { error: 'invalid_json' })
        return
      }

      const statusCode = toPositiveInt(error?.statusCode, 500)
      writeJson(response, statusCode, {
        error: error?.code || 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function createDefaultServices() {
  return {
    async getHealth() {
      return {
        status: 'partial',
        dependencies: {
          vector: { ready: false, provider: 'unconfigured' },
          spatial_encoder: { ready: false, provider: 'unconfigured' },
          routing: { ready: true, provider: 'haversine_fallback' },
        },
      }
    },
    async searchSemanticPois() {
      return []
    },
    async searchSimilarRegions() {
      return []
    },
    async getRouteEstimate({ origin, destination, mode }) {
      return buildFallbackRoute(origin, destination, mode)
    },
    async warmup() {
      return null
    },
    async close() {
      return null
    },
  }
}

export function createDependencyAdapterServer({ services = createDefaultServices() } = {}) {
  const resolvedServices = {
    ...createDefaultServices(),
    ...services,
  }

  const semanticPoisHandler = createJsonRequestHandler(async (payload) => ({
    candidates: await resolvedServices.searchSemanticPois({
      text: normalizeText(payload?.text),
      topK: toPositiveInt(payload?.top_k, 5),
    }),
  }))

  const similarRegionsHandler = createJsonRequestHandler(async (payload) => ({
    regions: await resolvedServices.searchSimilarRegions({
      text: normalizeText(payload?.text),
      topK: toPositiveInt(payload?.top_k, 5),
    }),
  }))

  const routeHandler = createJsonRequestHandler(async (payload) => {
    const origin = normalizeArrayPoint(payload?.origin)
    const destination = normalizeArrayPoint(payload?.destination)
    if (!origin || !destination) {
      const error = new Error('origin/destination must be [lon, lat]')
      error.code = 'invalid_route_payload'
      error.statusCode = 400
      throw error
    }

    return resolvedServices.getRouteEstimate({
      origin,
      destination,
      mode: normalizeText(payload?.mode) || 'walking',
    })
  })

  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, DEFAULT_HEADERS)
      response.end()
      return
    }

    if (request.method === 'GET' && request.url === '/health') {
      try {
        const payload = await resolvedServices.getHealth()
        writeJson(response, 200, payload)
      } catch (error) {
        writeJson(response, 500, {
          error: 'healthcheck_failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    if (request.method === 'POST' && request.url === '/search/semantic-pois') {
      await semanticPoisHandler(request, response)
      return
    }

    if (request.method === 'POST' && request.url === '/search/similar-regions') {
      await similarRegionsHandler(request, response)
      return
    }

    if (request.method === 'POST' && request.url === '/route') {
      await routeHandler(request, response)
      return
    }

    writeJson(response, 404, { error: 'not_found' })
  })
}

export function loadDependencyAdapterEnv({
  rootDir = process.cwd(),
  env = process.env,
} = {}) {
  return {
    ...readEnvFile(join(rootDir, '.env')),
    ...readEnvFile(join(rootDir, '.env.v4')),
    ...readEnvFile(join(rootDir, 'V4-GeoLoom-beta', '.env')),
    ...env,
  }
}

export async function createRuntimeServices({
  env = process.env,
  logger = console,
} = {}) {
  applyEnvToProcess(env)
  const vectorCacheFile = resolveVectorCacheFile()
  const vectorCachePresent = existsSync(vectorCacheFile)
  const runtimeHealth = {
    vector: {
      state: 'idle',
      lastError: null,
    },
    spatialEncoder: {
      state: 'idle',
      lastError: null,
    },
  }

  let runtimePromise = null
  let vectorWarmupTimer = null

  const getRuntime = async () => {
    if (!runtimePromise) {
      runtimePromise = Promise.all([
        import('../../V3-GeoEncoder-RAG/services/data/database.js'),
        import('../../V3-GeoEncoder-RAG/services/ai/entityOntology.js'),
        import('../../V3-GeoEncoder-RAG/services/retrieval/queryEmbeddingService.js'),
        import('../../V3-GeoEncoder-RAG/services/retrieval/faissIndex.js'),
        import('../../V3-GeoEncoder-RAG/services/infra/spatialEncoderClient.js'),
      ]).then(([
        databaseModule,
        entityModule,
        queryEmbeddingModule,
        faissModule,
        spatialClientModule,
      ]) => ({
        database: databaseModule,
        entity: entityModule,
        queryEmbedding: queryEmbeddingModule,
        faiss: faissModule,
        spatialClient: spatialClientModule,
      }))
    }

    return runtimePromise
  }

  const ensureSpatialEncoderReady = async ({
    timeoutMs = 20000,
    intervalMs = 1000,
  } = {}) => {
    const runtime = await getRuntime()
    runtimeHealth.spatialEncoder.state = 'probing'
    runtimeHealth.spatialEncoder.lastError = null
    let status = await runtime.spatialClient.getSpatialEncoderStatus()
    if (status.ready) {
      runtimeHealth.spatialEncoder.state = 'ready'
      return true
    }

    try {
      runtimeHealth.spatialEncoder.state = 'starting'
      const started = await runtime.spatialClient.startSpatialEncoder()
      if (started) {
        runtimeHealth.spatialEncoder.state = 'ready'
        return true
      }
    } catch (error) {
      runtimeHealth.spatialEncoder.state = 'error'
      runtimeHealth.spatialEncoder.lastError = error instanceof Error ? error.message : String(error)
      logger.warn?.(`[v4-dependency-adapter] encoder bootstrap failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    runtimeHealth.spatialEncoder.state = 'warming'
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      status = await runtime.spatialClient.getSpatialEncoderStatus()
      if (status.ready) {
        runtimeHealth.spatialEncoder.state = 'ready'
        return true
      }
    }

    runtimeHealth.spatialEncoder.state = 'timeout'
    return false
  }

  const resolveAnchor = async (text) => {
    const runtime = await getRuntime()
    const candidates = extractAnchorCandidates(text)
    if (!candidates.length) {
      return null
    }

    for (const candidateText of candidates) {
      const searchTerms = dedupeStrings([
        candidateText,
        candidateText.replace(/(地铁站|站口|出口)$/u, ''),
        candidateText.replace(/(附近|周边|最近)$/u, ''),
      ]).filter((item) => item.length >= 2)

      if (!searchTerms.length) continue

      const exactClauses = searchTerms.map((_, index) => `name = $${index + 1}`).join(' OR ')
      const fuzzyOffset = searchTerms.length
      const fuzzyClauses = searchTerms.map((_, index) => `name ILIKE $${fuzzyOffset + index + 1}`).join(' OR ')
      const prefixOffset = searchTerms.length * 2
      const prefixClauses = searchTerms.map((_, index) => `name ILIKE $${prefixOffset + index + 1}`).join(' OR ')
      const params = [
        ...searchTerms,
        ...searchTerms.map((term) => `%${term}%`),
        ...searchTerms.map((term) => `${term}%`),
      ]

      const result = await runtime.database.query(
        `
          SELECT id, name, ST_X(geom) AS lon, ST_Y(geom) AS lat, category_main, category_sub
          FROM pois
          WHERE (${exactClauses}) OR (${prefixClauses}) OR (${fuzzyClauses})
          ORDER BY CASE
            WHEN ${exactClauses} THEN 0
            WHEN ${prefixClauses} THEN 1
            ELSE 2
          END ASC,
          LENGTH(name) ASC
          LIMIT 50
        `,
        params,
      )

      const row = selectBestAnchorCandidate(result.rows, candidateText)
      if (row) {
        return {
          id: row.id,
          name: candidateText,
          matchedName: row.name,
          lon: toFiniteNumber(row.lon, null),
          lat: toFiniteNumber(row.lat, null),
          categoryMain: row.category_main || null,
          categorySub: row.category_sub || null,
          requestedName: candidateText,
        }
      }
    }

    return null
  }

  const searchSemanticPoisByTemplate = async ({ text, topK, anchor, intent }) => {
    const runtime = await getRuntime()
    const dbCategory = intent?.dbCategory ? [intent.dbCategory] : []
    const params = [anchor.lon, anchor.lat, inferSearchRadius(text)]
    let nextParamIndex = 4
    let categoryCondition = ''

    if (dbCategory.length > 0) {
      categoryCondition = `AND category_main = ANY($${nextParamIndex})`
      params.push(dbCategory)
      nextParamIndex += 1
    }

    const result = await runtime.database.query(
      `
        SELECT
          id,
          name,
          COALESCE(category_sub, category_main) AS category,
          category_main,
          category_sub,
          ST_X(geom) AS lon,
          ST_Y(geom) AS lat,
          ST_Distance(geom::geography, ST_MakePoint($1, $2)::geography) AS distance_m
        FROM pois
        WHERE ST_DWithin(geom::geography, ST_MakePoint($1, $2)::geography, $3)
          ${categoryCondition}
        ORDER BY distance_m ASC
        LIMIT ${Math.max(topK * 3, 12)}
      `,
      params,
    )

    return (result.rows || [])
      .filter((row) => !intent?.poiSubType || String(row.category || '').includes(intent.poiSubType) || String(row.name || '').includes(intent.poiSubType))
      .slice(0, topK)
      .map((row, index) => ({
        id: String(row.id),
        name: row.name,
        category: row.category || row.category_sub || row.category_main || '',
        score: Number((1 - Math.min(index, topK) * 0.08).toFixed(4)),
        lon: toFiniteNumber(row.lon, null),
        lat: toFiniteNumber(row.lat, null),
        distance_m: toFiniteNumber(row.distance_m, null),
      }))
  }

  const searchSemanticPois = async ({ text, topK = 5 }) => {
    const safeText = normalizeText(text)
    if (!safeText) return []

    const runtime = await getRuntime()
    const anchor = await resolveAnchor(safeText)
    if (!anchor || anchor.lon === null || anchor.lat === null) {
      return []
    }

    const intent = runtime.entity.resolveEntityIntentFromText(safeText)
    await ensureSpatialEncoderReady({
      timeoutMs: 12000,
      intervalMs: 1000,
    })
    const queryEmbedding = await runtime.queryEmbedding.buildSpatialQueryEmbedding({
      userQuery: safeText,
      intent: {
        placeName: anchor.name,
        category: intent.dbCategory,
        poiSubType: intent.poiSubType,
        radiusM: inferSearchRadius(safeText),
      },
      anchor: {
        lon: anchor.lon,
        lat: anchor.lat,
        poiId: anchor.id,
      },
    })

    const faissParams = {
      anchor: {
        lon: anchor.lon,
        lat: anchor.lat,
      },
      radius: inferSearchRadius(safeText),
      categories: intent.dbCategory ? [intent.dbCategory] : [],
      subcategory: intent.poiSubType || null,
      topK,
      ...runtime.queryEmbedding.buildQueryEmbeddingSearchOptions(queryEmbedding),
    }

    const indexStatus = runtime.faiss.getIndexStatus()
    if (!indexStatus.loaded && ['scheduled', 'warming'].includes(runtimeHealth.vector.state)) {
      return searchSemanticPoisByTemplate({
        text: safeText,
        topK,
        anchor,
        intent,
      })
    }

    try {
      const results = await runtime.faiss.faissHybridSearch(faissParams)
      if (Array.isArray(results) && results.length > 0) {
        return results.map((item) => ({
          id: String(item.id),
          name: item.name,
          category: item.category || item.categorySub || item.categoryMain || '',
          score: toScore(item.fused_score ?? item.semantic_similarity ?? item.semantic_score ?? 0.5),
          lon: toFiniteNumber(item.lon, null),
          lat: toFiniteNumber(item.lat, null),
          distance_m: toFiniteNumber(item.distance_m, null),
        }))
      }
    } catch (error) {
      logger.warn?.(`[v4-dependency-adapter] FAISS search failed, switching to template fallback: ${error instanceof Error ? error.message : String(error)}`)
    }

    return searchSemanticPoisByTemplate({
      text: safeText,
      topK,
      anchor,
      intent,
    })
  }

  const searchSimilarRegions = async ({ text, topK = 5 }) => {
    const safeText = normalizeText(text)
    if (!safeText) return []

    const runtime = await getRuntime()
    const anchor = await resolveAnchor(safeText)
    if (!anchor || anchor.lon === null || anchor.lat === null) {
      return []
    }

    const ready = await ensureSpatialEncoderReady()
    if (!ready) {
      return []
    }

    const response = await runtime.spatialClient.searchCells(anchor.lon, anchor.lat, {
      userQuery: safeText,
      taskType: inferSimilarRegionTask(safeText),
      topK,
    })

    return (response?.cells || []).slice(0, topK).map((cell) => ({
      id: String(cell.cell_id || cell.id || ''),
      name: cell.region_name || cell.cell_id || '相似片区',
      summary: buildRegionSummary(cell),
      score: toScore(cell.search_score ?? cell.similarity ?? 0.5),
      tags: Array.isArray(response?.scene_tags) ? response.scene_tags.slice(0, 3) : [],
    }))
  }

  const getRouteEstimate = async ({ origin, destination, mode = 'walking' }) => {
    const routeProfile = toRouteProfile(mode)
    const amapKey = normalizeText(env.AMAP_API_KEY || env.V4_AMAP_API_KEY)

    if (amapKey) {
      try {
        const url = new URL(`https://restapi.amap.com/v3/direction/${routeProfile.amap}`)
        url.searchParams.set('key', amapKey)
        url.searchParams.set('origin', `${origin[0]},${origin[1]}`)
        url.searchParams.set('destination', `${destination[0]},${destination[1]}`)
        url.searchParams.set('output', 'json')

        const response = await fetch(url, {
          signal: AbortSignal.timeout(DEFAULT_ROUTE_TIMEOUT_MS),
        })
        if (!response.ok) {
          throw new Error(`amap_route_failed:${response.status}`)
        }

        const payload = await response.json()
        const firstPath = payload?.route?.paths?.[0]
        const distance = toFiniteNumber(firstPath?.distance, null)
        const durationSeconds = toFiniteNumber(firstPath?.duration, null)
        if (payload?.status === '1' && distance !== null && durationSeconds !== null) {
          return {
            distance_m: Number(distance.toFixed(1)),
            duration_min: Math.max(1, Math.round(durationSeconds / 60)),
            degraded: false,
            degraded_reason: null,
          }
        }
      } catch (error) {
        logger.warn?.(`[v4-dependency-adapter] AMap route failed, fallback to OSRM: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    try {
      const url = new URL(`https://router.project-osrm.org/route/v1/${routeProfile.osrm}/${origin[0]},${origin[1]};${destination[0]},${destination[1]}`)
      url.searchParams.set('overview', 'false')
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DEFAULT_ROUTE_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`osrm_route_failed:${response.status}`)
      }

      const payload = await response.json()
      const route = payload?.routes?.[0]
      const distance = toFiniteNumber(route?.distance, null)
      const durationSeconds = toFiniteNumber(route?.duration, null)
      if (distance !== null && durationSeconds !== null) {
        return {
          distance_m: Number(distance.toFixed(1)),
          duration_min: Math.max(1, Math.round(durationSeconds / 60)),
          degraded: true,
          degraded_reason: 'public_demo_provider',
        }
      }
    } catch {
      return buildFallbackRoute(origin, destination, mode)
    }

    return buildFallbackRoute(origin, destination, mode, 'public_demo_provider')
  }

  const getHealth = async () => {
    const runtime = await getRuntime()
    const indexStatus = runtime.faiss.getIndexStatus()
    const encoderStatus = await runtime.spatialClient.getSpatialEncoderStatus()
    const routingProvider = normalizeText(env.AMAP_API_KEY || env.V4_AMAP_API_KEY)
      ? 'amap'
      : 'osrm_public'

    const dependencies = {
      vector: {
        ready: indexStatus.loaded === true,
        provider: 'v3_hybrid_faiss',
        poi_count: indexStatus.poiCount || 0,
        embedding_dim: indexStatus.embeddingDim || 0,
        state: runtimeHealth.vector.state,
        cache_present: vectorCachePresent,
        hint: indexStatus.loaded
          ? null
          : runtimeHealth.vector.state === 'scheduled'
            ? 'vector_warmup_deferred_to_protect_startup_queries'
            : runtimeHealth.vector.state === 'warming' && vectorCachePresent
              ? 'warming_up_from_cache'
              : runtimeHealth.vector.state === 'warming'
                ? 'warming_up_from_database_without_cache'
                : 'vector_not_ready'
        ,
        error: runtimeHealth.vector.lastError,
      },
      spatial_encoder: {
        ready: encoderStatus.ready === true,
        provider: 'v3_dual_encoder',
        status: encoderStatus.status,
        state: runtimeHealth.spatialEncoder.state,
        error: runtimeHealth.spatialEncoder.lastError,
      },
      routing: {
        ready: true,
        provider: routingProvider,
      },
    }

    const readyCount = Object.values(dependencies).filter((item) => item.ready).length

    return {
      status: readyCount === Object.keys(dependencies).length ? 'ok' : readyCount > 0 ? 'partial' : 'degraded',
      dependencies,
    }
  }

  const runVectorWarmup = async () => {
    const runtime = await getRuntime()
    runtimeHealth.vector.state = 'warming'
    runtimeHealth.vector.lastError = null
    try {
      const loaded = await runtime.faiss.loadEmbeddings()
      runtimeHealth.vector.state = loaded ? 'ready' : 'partial'
      return loaded
    } catch (error) {
      runtimeHealth.vector.state = 'error'
      runtimeHealth.vector.lastError = error instanceof Error ? error.message : String(error)
      logger.warn?.(`[v4-dependency-adapter] vector warmup failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const warmup = async ({
    vectorDelayMs = Number(env.V4_VECTOR_WARMUP_DELAY_MS || '60000'),
  } = {}) => {
    const runtime = await getRuntime()

    const tasks = [
      ensureSpatialEncoderReady({
        timeoutMs: 20000,
        intervalMs: 1000,
      })
        .catch((error) => {
          logger.warn?.(`[v4-dependency-adapter] encoder warmup failed: ${error instanceof Error ? error.message : String(error)}`)
          return false
        }),
    ]

    if (vectorDelayMs <= 0) {
      tasks.push(runVectorWarmup())
    } else {
      runtimeHealth.vector.state = 'scheduled'
      vectorWarmupTimer = setTimeout(() => {
        void runVectorWarmup()
      }, vectorDelayMs)
    }

    await Promise.all(tasks)
  }

  const close = async () => {
    if (vectorWarmupTimer) {
      clearTimeout(vectorWarmupTimer)
      vectorWarmupTimer = null
    }
    if (!runtimePromise) return
    const runtime = await runtimePromise
    if (typeof runtime.database.close === 'function') {
      await runtime.database.close()
    }
  }

  return {
    getHealth,
    searchSemanticPois,
    searchSimilarRegions,
    getRouteEstimate,
    warmup,
    close,
  }
}
