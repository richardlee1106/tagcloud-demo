/**
 * 查询结果缓存（L1 + L2）
 *
 * - L1: 进程内存缓存
 * - L2: Redis 缓存（可选）
 * - 防击穿: 指纹级短锁，避免并发回源重复计算
 */

import { createHash } from 'crypto'
import IORedis from 'ioredis'
import h3 from 'h3-js'
import telemetry from './telemetry.js'

const l1Cache = new Map()
const inFlightLocks = new Map()

let l2Client = null
let l2InitPromise = null

const CACHE_CONFIG = {
  ttl: {
    poi_search: 3 * 60 * 1000,
    area_analysis: 10 * 60 * 1000,
    region_comparison: 10 * 60 * 1000,
    default: 5 * 60 * 1000
  },
  maxEntries: 500,
  maxMemoryBytes: (parseInt(process.env.QUERY_CACHE_MAX_MEMORY_MB || '128', 10)) * 1024 * 1024,
  h3Resolution: 7,
  radiusBucket: 500,
  l2Enabled: String(process.env.QUERY_CACHE_L2_ENABLED || 'true').toLowerCase() !== 'false',
  l2KeyPrefix: process.env.QUERY_CACHE_L2_PREFIX || 'spatial:query-cache:',
  lockTtlMs: Math.max(1000, parseInt(process.env.QUERY_CACHE_LOCK_TTL_MS || '6000', 10)),
  lockWaitTimeoutMs: Math.max(500, parseInt(process.env.QUERY_CACHE_LOCK_WAIT_TIMEOUT_MS || '6500', 10))
}

const stats = {
  l1: {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0
  },
  l2: {
    hits: 0,
    misses: 0,
    sets: 0,
    errors: 0,
    enabled: CACHE_CONFIG.l2Enabled
  },
  locks: {
    acquired: 0,
    waited: 0,
    waitTimeouts: 0,
    released: 0
  },
  serializationErrors: 0,
  l1Fallbacks: 0
}

function getRedisConfig() {
  const redisUrl = process.env.QUERY_CACHE_REDIS_URL || process.env.REDIS_URL
  if (redisUrl) {
    return { url: redisUrl }
  }

  if (process.env.REDIS_HOST) {
    return {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10)
    }
  }

  return null
}

async function getL2Client() {
  if (!CACHE_CONFIG.l2Enabled) return null
  if (l2Client) return l2Client

  if (!l2InitPromise) {
    l2InitPromise = (async () => {
      const redisConfig = getRedisConfig()
      if (!redisConfig) {
        stats.l2.enabled = false
        return null
      }

      try {
        const client = redisConfig.url
          ? new IORedis(redisConfig.url, {
              maxRetriesPerRequest: 2,
              enableReadyCheck: false,
              lazyConnect: true
            })
          : new IORedis({
              ...redisConfig,
              maxRetriesPerRequest: 2,
              enableReadyCheck: false,
              lazyConnect: true
            })

        client.on('error', (err) => {
          stats.l2.errors += 1
          console.warn(`[QueryCache:L2] redis error: ${err.message}`)
        })

        await client.connect()
        l2Client = client
        stats.l2.enabled = true
        console.log('[QueryCache:L2] Redis cache enabled')
        return l2Client
      } catch (error) {
        stats.l2.errors += 1
        stats.l2.enabled = false
        console.warn(`[QueryCache:L2] Redis unavailable, fallback to L1 only: ${error.message}`)
        l2InitPromise = null
        return null
      }
    })()
  }

  return l2InitPromise
}

function ttlForType(queryType = 'default') {
  return CACHE_CONFIG.ttl[queryType] || CACHE_CONFIG.ttl.default
}

function l2Key(fingerprint) {
  return `${CACHE_CONFIG.l2KeyPrefix}${fingerprint}`
}

function serializeCachePayload(payload) {
  try {
    return JSON.stringify(payload)
  } catch {
    stats.serializationErrors += 1
    return null
  }
}

function deserializeCachePayload(payload) {
  if (!payload || typeof payload !== 'string') return null
  try {
    return JSON.parse(payload)
  } catch {
    stats.serializationErrors += 1
    return null
  }
}

class CacheEntry {
  constructor(data, ttlMs, queryType = 'default') {
    this.data = data
    this.queryType = queryType
    this.createdAt = Date.now()
    this.expiresAt = this.createdAt + ttlMs
    this.hitCount = 0
  }

  isExpired() {
    return Date.now() > this.expiresAt
  }

  hit() {
    this.hitCount += 1
    return this.data
  }
}

function clonePayload(payload) {
  if (!payload) return payload
  try {
    return structuredClone(payload)
  } catch {
    return deserializeCachePayload(serializeCachePayload(payload))
  }
}

function getFromL1(fingerprint) {
  const entry = l1Cache.get(fingerprint)
  if (!entry) {
    stats.l1.misses += 1
    return null
  }

  if (entry.isExpired()) {
    l1Cache.delete(fingerprint)
    stats.l1.misses += 1
    stats.l1.evictions += 1
    return null
  }

  stats.l1.hits += 1
  return clonePayload(entry.hit())
}

function setToL1(fingerprint, payload, queryType = 'default') {
  if (l1Cache.size >= CACHE_CONFIG.maxEntries) {
    evictOldestEntries(Math.ceil(CACHE_CONFIG.maxEntries * 0.1))
  }

  const memBytes = estimateMemoryBytes()
  if (memBytes > CACHE_CONFIG.maxMemoryBytes) {
    evictOldestEntries(Math.max(1, Math.ceil(l1Cache.size * 0.2)))
  }

  const entry = new CacheEntry(payload, ttlForType(queryType), queryType)
  l1Cache.set(fingerprint, entry)
  stats.l1.sets += 1
}

async function getFromL2(fingerprint) {
  const client = await getL2Client()
  if (!client) {
    stats.l2.misses += 1
    return null
  }

  try {
    telemetry.recordKpiEvent('cache_l2_op', 1, { op: 'get' })
    const raw = await client.get(l2Key(fingerprint))
    if (!raw) {
      stats.l2.misses += 1
      return null
    }

    const parsed = deserializeCachePayload(raw)
    if (!parsed) {
      stats.l2.misses += 1
      return null
    }

    stats.l2.hits += 1
    return parsed
  } catch (error) {
    stats.l2.errors += 1
    stats.l2.misses += 1
    telemetry.recordKpiEvent('cache_l2_error', 1, { op: 'get', reason: error?.code || 'redis_error' })
    return null
  }
}

async function setToL2(fingerprint, payload, queryType = 'default') {
  const client = await getL2Client()
  if (!client) return

  const serialized = serializeCachePayload(payload)
  if (!serialized) return

  try {
    telemetry.recordKpiEvent('cache_l2_op', 1, { op: 'set', query_type: queryType })
    const ttlSeconds = Math.max(1, Math.ceil(ttlForType(queryType) / 1000))
    await client.set(l2Key(fingerprint), serialized, 'EX', ttlSeconds)
    stats.l2.sets += 1
  } catch {
    stats.l2.errors += 1
    telemetry.recordKpiEvent('cache_l2_error', 1, { op: 'set', query_type: queryType })
  }
}

function evictOldestEntries(count) {
  const entries = Array.from(l1Cache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt)
  for (let i = 0; i < count && i < entries.length; i += 1) {
    l1Cache.delete(entries[i][0])
    stats.l1.evictions += 1
  }
}

function parseHealthThreshold(rawValue, fallback) {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeCacheKeyVersion(rawVersion) {
  const normalized = String(rawVersion || '').trim().toLowerCase()
  if (normalized === 'v1') return 'v1'
  return 'v2'
}

export function resolveCacheKeyVersion(rawVersion = null) {
  if (rawVersion != null) {
    return normalizeCacheKeyVersion(rawVersion)
  }
  return normalizeCacheKeyVersion(process.env.SPATIAL_CACHE_KEY_VERSION || 'v2')
}

function normalizeQuestionForFingerprint(question) {
  return String(question || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function hashFragment(text) {
  if (!text) return null
  return createHash('sha1').update(text).digest('hex').slice(0, 20)
}

function buildBoundarySignature(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) {
    return null
  }

  const normalizedPoints = boundary
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const lon = toFiniteNumber(point[0])
        const lat = toFiniteNumber(point[1])
        if (lon === null || lat === null) return null
        return `${lon.toFixed(5)},${lat.toFixed(5)}`
      }

      if (point && typeof point === 'object') {
        const lon = toFiniteNumber(point.lon ?? point.lng ?? point.longitude)
        const lat = toFiniteNumber(point.lat ?? point.latitude)
        if (lon === null || lat === null) return null
        return `${lon.toFixed(5)},${lat.toFixed(5)}`
      }

      return null
    })
    .filter(Boolean)

  if (normalizedPoints.length < 3) {
    return null
  }

  return {
    point_count: normalizedPoints.length,
    digest: hashFragment(normalizedPoints.join('|'))
  }
}

function normalizeViewportBounds(viewport) {
  if (!Array.isArray(viewport) || viewport.length < 4) return null
  const bounds = viewport.slice(0, 4).map((value) => toFiniteNumber(value))
  if (!bounds.every((value) => value !== null)) return null
  return bounds.map((value) => Number(value).toFixed(4))
}

function normalizeRegionsForDigest(regions = []) {
  if (!Array.isArray(regions) || regions.length === 0) return []
  const normalized = []

  for (const item of regions) {
    if (!item) continue

    if (typeof item === 'string' || typeof item === 'number') {
      normalized.push(String(item))
      continue
    }

    if (typeof item === 'object') {
      const id = item.id ?? item.region_id ?? item.name ?? item.label
      if (id != null) {
        normalized.push(String(id))
        continue
      }
      try {
        normalized.push(JSON.stringify(item))
      } catch {
        // ignore non-serializable region entry
      }
    }
  }

  return normalized.sort()
}

function resolveViewportHash(spatialContext = {}, extra = {}) {
  return String(
    extra?.viewportHash
    || extra?.contextBinding?.viewport_hash
    || spatialContext?.context_binding?.viewport_hash
    || spatialContext?.viewport_hash
    || ''
  ).trim()
}

function resolveMapZoomBucket(spatialContext = {}, extra = {}) {
  const zoomRaw = toFiniteNumber(
    extra?.mapZoom
    ?? extra?.map_zoom
    ?? spatialContext?.map_zoom
    ?? spatialContext?.zoom
  )
  if (zoomRaw === null) return null
  return Math.max(0, Math.round(zoomRaw))
}

function resolveDrawMode(queryPlan = {}, spatialContext = {}, extra = {}) {
  const drawMode = String(
    extra?.drawMode
    || extra?.draw_mode
    || spatialContext?.draw_mode
    || spatialContext?.mode
    || queryPlan?.scope?.geometry_source
    || ''
  ).trim().toLowerCase()
  return drawMode || null
}

function resolveViewportBounds(spatialContext = {}, extra = {}) {
  const fromExtra = normalizeViewportBounds(extra?.viewportBounds || extra?.viewport_bounds)
  if (fromExtra) return fromExtra
  return normalizeViewportBounds(spatialContext?.viewport)
}

function buildFingerprintDataV1(queryPlan, spatialContext = {}, extra = {}) {
  const fingerprintData = {}

  fingerprintData.type = queryPlan.query_type || 'unknown'
  fingerprintData.categories = Array.isArray(queryPlan.categories)
    ? [...queryPlan.categories].sort()
    : []

  if (spatialContext.center || (queryPlan.anchor?.lat && queryPlan.anchor?.lon)) {
    const lat = spatialContext.center?.lat || queryPlan.anchor.lat
    const lon = spatialContext.center?.lon || queryPlan.anchor.lon

    if (typeof lat === 'number' && typeof lon === 'number' && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      try {
        fingerprintData.h3_center = h3.latLngToCell(lat, lon, CACHE_CONFIG.h3Resolution)
      } catch {
        fingerprintData.approx_center = `${lat.toFixed(3)},${lon.toFixed(3)}`
      }
    }
  } else if (spatialContext.viewport) {
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport
    const centerLat = (minLat + maxLat) / 2
    const centerLon = (minLon + maxLon) / 2

    try {
      fingerprintData.h3_center = h3.latLngToCell(centerLat, centerLon, CACHE_CONFIG.h3Resolution)
    } catch {
      fingerprintData.approx_center = `${centerLat.toFixed(3)},${centerLon.toFixed(3)}`
    }

    const viewportBounds = [minLon, minLat, maxLon, maxLat].map((value) => toFiniteNumber(value))
    if (viewportBounds.every((value) => value !== null)) {
      fingerprintData.viewport_bounds = viewportBounds.map((value) => Number(value).toFixed(4))
    }
  }

  const boundarySignature = buildBoundarySignature(spatialContext.boundary)
  if (boundarySignature) {
    fingerprintData.boundary = boundarySignature
  }

  if (queryPlan.radius_m) {
    fingerprintData.radius_bucket = Math.ceil(queryPlan.radius_m / CACHE_CONFIG.radiusBucket) * CACHE_CONFIG.radiusBucket
  }

  if (queryPlan.semantic_query) {
    fingerprintData.semantic = queryPlan.semantic_query.trim().toLowerCase()
  }

  if (queryPlan.aggregation_strategy?.enable) {
    fingerprintData.aggregation = true
    fingerprintData.sampling = queryPlan.sampling_strategy?.method || 'default'
  }

  if (queryPlan.target_regions) {
    fingerprintData.regions = Array.isArray(queryPlan.target_regions)
      ? [...queryPlan.target_regions].sort()
      : []
  }

  const sourcePolicy = extra?.sourcePolicy || {}
  if (sourcePolicy && typeof sourcePolicy === 'object') {
    const selectedCategories = Array.isArray(sourcePolicy.selected_categories)
      ? [...sourcePolicy.selected_categories].sort()
      : []

    fingerprintData.source_policy = {
      category_source: sourcePolicy.category_source || null,
      geometry_source: sourcePolicy.geometry_source || null,
      has_custom_area: Boolean(sourcePolicy.has_custom_area),
      has_category_filter: Boolean(sourcePolicy.has_category_filter),
      selected_categories: selectedCategories
    }
  }

  if (extra?.queryType) {
    fingerprintData.query_type = String(extra.queryType)
  }

  if (extra?.route) {
    fingerprintData.route = String(extra.route)
  }

  const normalizedQuestion = normalizeQuestionForFingerprint(extra?.userQuestion || extra?.query || '')
  if (normalizedQuestion) {
    fingerprintData.user_question_digest = hashFragment(normalizedQuestion)
  }

  return fingerprintData
}

export function generateQueryFingerprint(queryPlan, spatialContext = {}, extra = {}) {
  const cacheKeyVersion = resolveCacheKeyVersion(extra?.cacheKeyVersion)
  const fallbackVersion = resolveCacheKeyVersion(process.env.SPATIAL_CACHE_KEY_VERSION || 'v2')
  const activeVersion = cacheKeyVersion || fallbackVersion

  if (activeVersion === 'v1') {
    const dataString = JSON.stringify(buildFingerprintDataV1(queryPlan, spatialContext, extra))
    return createHash('md5').update(dataString).digest('hex')
  }

  const sourcePolicy = extra?.sourcePolicy || {}
  const selectedCategories = Array.isArray(sourcePolicy?.selected_categories)
    ? [...sourcePolicy.selected_categories].map((item) => String(item || '')).filter(Boolean).sort()
    : []

  const viewportHash = resolveViewportHash(spatialContext, extra)
  const viewportBounds = resolveViewportBounds(spatialContext, extra)
  const boundarySignature = buildBoundarySignature(spatialContext.boundary || extra?.boundary)
  const mapZoomBucket = resolveMapZoomBucket(spatialContext, extra)
  const drawMode = resolveDrawMode(queryPlan, spatialContext, extra)
  const normalizedQuestion = normalizeQuestionForFingerprint(extra?.userQuestion || extra?.query || '')
  const normalizedQueryType = String(extra?.queryType || queryPlan?.query_type || 'unknown').trim().toLowerCase()

  const fingerprintData = {
    cache_key_version: activeVersion,
    query_type: normalizedQueryType,
    type: queryPlan?.query_type || 'unknown',
    categories: Array.isArray(queryPlan?.categories)
      ? [...queryPlan.categories].map((item) => String(item || '')).filter(Boolean).sort()
      : []
  }

  const centerLat = toFiniteNumber(
    spatialContext?.center?.lat
    ?? queryPlan?.anchor?.lat
    ?? extra?.center?.lat
  )
  const centerLon = toFiniteNumber(
    spatialContext?.center?.lon
    ?? queryPlan?.anchor?.lon
    ?? extra?.center?.lon
  )
  if (centerLat !== null && centerLon !== null && centerLat >= -90 && centerLat <= 90 && centerLon >= -180 && centerLon <= 180) {
    try {
      fingerprintData.h3_center = h3.latLngToCell(centerLat, centerLon, CACHE_CONFIG.h3Resolution)
    } catch {
      fingerprintData.approx_center = `${centerLat.toFixed(3)},${centerLon.toFixed(3)}`
    }
  } else if (viewportBounds) {
    const [minLon, minLat, maxLon, maxLat] = viewportBounds.map((value) => Number(value))
    const viewportCenterLat = (minLat + maxLat) / 2
    const viewportCenterLon = (minLon + maxLon) / 2
    try {
      fingerprintData.h3_center = h3.latLngToCell(viewportCenterLat, viewportCenterLon, CACHE_CONFIG.h3Resolution)
    } catch {
      fingerprintData.approx_center = `${viewportCenterLat.toFixed(3)},${viewportCenterLon.toFixed(3)}`
    }
  }

  if (viewportBounds) {
    fingerprintData.viewport_bounds = viewportBounds
  }
  if (viewportHash) {
    fingerprintData.viewport_hash = viewportHash
  }
  if (drawMode) {
    fingerprintData.draw_mode = drawMode
  }
  if (boundarySignature?.digest) {
    fingerprintData.boundary_digest = boundarySignature.digest
  }

  const regionsDigest = hashFragment(
    normalizeRegionsForDigest(
      extra?.regions
      || queryPlan?.target_regions
      || spatialContext?.regions
      || []
    ).join('|')
  )
  if (regionsDigest) {
    fingerprintData.regions_digest = regionsDigest
  }

  if (mapZoomBucket !== null) {
    fingerprintData.map_zoom_bucket = mapZoomBucket
  }

  if (queryPlan?.radius_m) {
    fingerprintData.radius_bucket = Math.ceil(queryPlan.radius_m / CACHE_CONFIG.radiusBucket) * CACHE_CONFIG.radiusBucket
  }

  if (queryPlan?.semantic_query) {
    fingerprintData.semantic = String(queryPlan.semantic_query).trim().toLowerCase()
  }

  if (queryPlan?.aggregation_strategy?.enable) {
    fingerprintData.aggregation = true
    fingerprintData.sampling = queryPlan?.sampling_strategy?.method || 'default'
  }

  fingerprintData.source_policy = {
    category_source: sourcePolicy?.category_source || null,
    geometry_source: sourcePolicy?.geometry_source || null,
    has_custom_area: Boolean(sourcePolicy?.has_custom_area),
    has_category_filter: Boolean(sourcePolicy?.has_category_filter),
    selected_categories: selectedCategories
  }

  if (extra?.route) {
    fingerprintData.route = String(extra.route)
  }

  if (normalizedQuestion) {
    fingerprintData.user_question_digest = hashFragment(normalizedQuestion)
  }

  if (extra?.modelProfile && typeof extra.modelProfile === 'object') {
    const modelProfileDigest = hashFragment(JSON.stringify(extra.modelProfile))
    if (modelProfileDigest) {
      fingerprintData.model_profile_digest = modelProfileDigest
    }
  }

  const dataString = JSON.stringify(fingerprintData)
  return createHash('md5').update(dataString).digest('hex')
}

export async function getFromCache(fingerprint, options = {}) {
  const queryType = options.queryType || 'default'

  const l1 = getFromL1(fingerprint)
  if (l1) return l1

  const l2 = await getFromL2(fingerprint)
  if (l2) {
    setToL1(fingerprint, clonePayload(l2), queryType)
    return clonePayload(l2)
  }

  return null
}

export async function setToCache(fingerprint, payload, queryType = 'default') {
  setToL1(fingerprint, clonePayload(payload), queryType)
  await setToL2(fingerprint, payload, queryType)
}

export function acquireComputationLock(fingerprint, options = {}) {
  const ttlMs = Number(options.ttlMs || CACHE_CONFIG.lockTtlMs)
  const now = Date.now()
  const existing = inFlightLocks.get(fingerprint)

  if (existing && existing.expiresAt > now) {
    stats.locks.waited += 1
    return {
      acquired: false,
      lockPromise: existing.promise,
      release: () => {}
    }
  }

  let resolver = () => {}
  const promise = new Promise((resolve) => {
    resolver = resolve
  })

  inFlightLocks.set(fingerprint, {
    promise,
    release: resolver,
    expiresAt: now + Math.max(1000, ttlMs)
  })

  stats.locks.acquired += 1

  return {
    acquired: true,
    lockPromise: promise,
    release: () => {
      const lock = inFlightLocks.get(fingerprint)
      if (!lock) return
      lock.release(true)
      inFlightLocks.delete(fingerprint)
      stats.locks.released += 1
    }
  }
}

export async function waitForComputationLock(fingerprint, options = {}) {
  const waitTimeoutMs = Number(options.waitTimeoutMs || CACHE_CONFIG.lockWaitTimeoutMs)
  const lock = inFlightLocks.get(fingerprint)
  if (!lock) return true

  stats.locks.waited += 1

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(false), Math.max(200, waitTimeoutMs))
  })

  const resolved = await Promise.race([lock.promise.then(() => true), timeoutPromise])
  if (!resolved) {
    stats.locks.waitTimeouts += 1
  }
  return resolved
}

export function cleanupExpiredCache() {
  let cleaned = 0
  for (const [key, entry] of l1Cache) {
    if (entry.isExpired()) {
      l1Cache.delete(key)
      cleaned += 1
    }
  }
  if (cleaned > 0) {
    stats.l1.evictions += cleaned
  }
  return cleaned
}

export function invalidateByType(queryType) {
  let invalidated = 0
  for (const [key, entry] of l1Cache) {
    if (!queryType || entry.queryType === queryType) {
      l1Cache.delete(key)
      invalidated += 1
    }
  }
  return invalidated
}

export function clearCache() {
  const size = l1Cache.size
  l1Cache.clear()
  return size
}

function estimateMemoryBytes() {
  let totalBytes = 0
  for (const [key, entry] of l1Cache) {
    totalBytes += key.length * 2
    try {
      totalBytes += JSON.stringify(entry.data).length * 2
    } catch {
      totalBytes += 4096
    }
    totalBytes += 200
  }
  return totalBytes
}

function estimateMemoryUsage() {
  const bytes = estimateMemoryBytes()
  if (bytes > 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }
  return `${(bytes / 1024).toFixed(2)} KB`
}

export function getCacheStats() {
  const totalHits = stats.l1.hits + stats.l2.hits
  const totalMisses = stats.l1.misses + stats.l2.misses
  const totalLookups = totalHits + totalMisses

  const hitRate = totalLookups > 0 ? (totalHits / totalLookups) * 100 : 0

  return {
    size: l1Cache.size,
    maxSize: CACHE_CONFIG.maxEntries,
    hits: totalHits,
    misses: totalMisses,
    hitRate: `${hitRate.toFixed(2)}%`,
    sets: stats.l1.sets + stats.l2.sets,
    evictions: stats.l1.evictions,
    memoryEstimate: estimateMemoryUsage(),
    l1: {
      ...stats.l1
    },
    l2: {
      ...stats.l2
    },
    locks: {
      ...stats.locks
    },
    serializationErrors: stats.serializationErrors,
    l1Fallbacks: stats.l1Fallbacks
  }
}

export function getCacheHealthSnapshot(options = {}) {
  const statsSnapshot = getCacheStats()
  const thresholds = {
    l2ErrorRateWarn: Number(options.l2ErrorRateWarn || process.env.CACHE_L2_ERROR_RATE_WARN || 0.01),
    lockTimeoutWarn: parseHealthThreshold(options.lockTimeoutWarn || process.env.CACHE_LOCK_TIMEOUT_WARN, 10)
  }

  const l2Ops = Number(statsSnapshot.l2.hits) + Number(statsSnapshot.l2.misses) + Number(statsSnapshot.l2.sets)
  const l2ErrorRate = l2Ops > 0 ? Number(statsSnapshot.l2.errors) / l2Ops : 0

  const alerts = []

  if (CACHE_CONFIG.l2Enabled && !statsSnapshot.l2.enabled) {
    alerts.push({
      code: 'cache_l2_unavailable',
      severity: 'warning',
      message: 'L2 Redis 未启用或不可用，当前仅使用 L1 内存缓存。'
    })
  }

  if (l2ErrorRate >= thresholds.l2ErrorRateWarn) {
    alerts.push({
      code: 'cache_l2_error_rate_high',
      severity: 'warning',
      message: 'L2 Redis 错误率超过阈值。',
      value: l2ErrorRate,
      threshold: thresholds.l2ErrorRateWarn
    })
  }

  if (Number(statsSnapshot.locks.waitTimeouts) >= thresholds.lockTimeoutWarn) {
    alerts.push({
      code: 'cache_lock_timeout_high',
      severity: 'warning',
      message: '缓存防击穿等待超时次数超过阈值。',
      value: Number(statsSnapshot.locks.waitTimeouts),
      threshold: thresholds.lockTimeoutWarn
    })
  }

  return {
    sampled_at: new Date().toISOString(),
    l2_enabled: CACHE_CONFIG.l2Enabled,
    stats: statsSnapshot,
    metrics: {
      l2_error_rate: l2ErrorRate,
      lock_wait_timeouts: Number(statsSnapshot.locks.waitTimeouts)
    },
    thresholds,
    alerts
  }
}

const cacheMaintenanceTimer = setInterval(() => {
  cleanupExpiredCache()
  const memBytes = estimateMemoryBytes()
  if (memBytes > CACHE_CONFIG.maxMemoryBytes) {
    evictOldestEntries(Math.max(1, Math.ceil(l1Cache.size * 0.15)))
  }

  const now = Date.now()
  for (const [fingerprint, lock] of inFlightLocks.entries()) {
    if (now > lock.expiresAt) {
      lock.release(false)
      inFlightLocks.delete(fingerprint)
      stats.locks.waitTimeouts += 1
    }
  }
}, 2 * 60 * 1000)

if (typeof cacheMaintenanceTimer.unref === 'function') {
  cacheMaintenanceTimer.unref()
}

export default {
  generateQueryFingerprint,
  resolveCacheKeyVersion,
  getFromCache,
  setToCache,
  acquireComputationLock,
  waitForComputationLock,
  cleanupExpiredCache,
  invalidateByType,
  clearCache,
  getCacheStats,
  getCacheHealthSnapshot
}
