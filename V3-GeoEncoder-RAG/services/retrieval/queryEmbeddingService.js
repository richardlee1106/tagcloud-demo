import {
  encodeCoords,
  isSpatialEncoderRunning,
  startSpatialEncoder
} from '../infra/spatialEncoderClient.js'

const QUERY_EMBEDDING_SEMANTIC_WEIGHT = 0.52
const QUERY_EMBEDDING_SPATIAL_WEIGHT = 0.48
const INTENT_ADAPTER_SLOT_COUNT = 4
const QUERY_INTENT_PATTERNS = Object.freeze([
  { match: '安静', signal: 'quiet', weight: 0.58 },
  { match: '学习', signal: 'study', weight: 0.54 },
  { match: '办公', signal: 'work', weight: 0.52 },
  { match: '热闹', signal: 'lively', weight: 0.58 },
  { match: '夜生活', signal: 'nightlife', weight: 0.6 },
  { match: '酒吧', signal: 'bar', weight: 0.56 },
  { match: '咖啡', signal: 'coffee', weight: 0.5 },
  { match: '约会', signal: 'date', weight: 0.54 },
  { match: '亲子', signal: 'family', weight: 0.56 },
  { match: '散步', signal: 'walk', weight: 0.48 },
  { match: '拍照', signal: 'photo', weight: 0.48 },
  { match: 'quiet', signal: 'quiet', weight: 0.58 },
  { match: 'study', signal: 'study', weight: 0.54 },
  { match: 'lively', signal: 'lively', weight: 0.58 },
  { match: 'nightlife', signal: 'nightlife', weight: 0.6 }
])

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function roundNumber(value, digits = 6) {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  return Number(numeric.toFixed(digits))
}

function normalizeEmbeddingPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  }

  if (payload && Array.isArray(payload.embedding)) {
    return payload.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  }

  return []
}

function normalizeFeatureMetadata(payload = null) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const featureSource = String(safePayload.feature_source || '').trim() || null
  const featureStats = safePayload.feature_stats && typeof safePayload.feature_stats === 'object'
    ? safePayload.feature_stats
    : null

  return {
    featureSource,
    featureStats
  }
}

function buildResult({
  applied = false,
  reason = 'unavailable',
  source = null,
  modelName = null,
  modelUsage = null,
  queryEmbedding = null,
  embeddingDim = 0,
  error = null,
  components = null
} = {}) {
  const normalizedModelUsage = Array.isArray(modelUsage) ? modelUsage.filter(Boolean) : (modelName ? [modelName] : [])
  return {
    applied,
    reason,
    source,
    embeddingDim,
    queryEmbedding,
    ...(modelName ? { modelName } : {}),
    ...(normalizedModelUsage.length > 0 ? { modelUsage: normalizedModelUsage } : {}),
    ...(components ? { components } : {}),
    ...(error ? { error } : {})
  }
}

function normalizeL2(vector = []) {
  if (!Array.isArray(vector) || vector.length === 0) return []
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(norm) || norm <= 1e-12) {
    return vector.map(() => 0)
  }
  return vector.map((value) => value / norm)
}

function stableHash(value = '') {
  let hash = 2166136261
  const input = String(value)

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function normalizeSemanticTags(semanticTags = []) {
  if (!Array.isArray(semanticTags)) return []
  return [...new Set(
    semanticTags
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
  )]
}

function bucketizeRadius(radiusM) {
  const numeric = toFiniteNumber(radiusM)
  if (numeric === null) return null
  if (numeric <= 300) return 'radius:micro'
  if (numeric <= 800) return 'radius:local'
  if (numeric <= 2000) return 'radius:district'
  return 'radius:city'
}

function collectQueryIntentSignals(userQuery = '', placeName = null) {
  const normalizedQuery = String(userQuery || '').trim().toLowerCase()
  if (!normalizedQuery) return []

  const sanitizedQuery = placeName
    ? normalizedQuery.replaceAll(String(placeName).trim().toLowerCase(), ' ')
    : normalizedQuery

  const matchedSignals = []
  for (const pattern of QUERY_INTENT_PATTERNS) {
    if (sanitizedQuery.includes(pattern.match)) {
      matchedSignals.push({
        key: `query:${pattern.signal}`,
        label: pattern.signal,
        weight: pattern.weight,
        kind: 'query'
      })
    }
  }

  return matchedSignals
}

function collectIntentSignals({ userQuery = '', intent = {} } = {}) {
  const signals = []
  const seen = new Set()

  const pushSignal = (key, label, weight, kind) => {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey || seen.has(normalizedKey)) return
    seen.add(normalizedKey)
    signals.push({
      key: normalizedKey,
      label: String(label || normalizedKey),
      weight: Number(weight),
      kind
    })
  }

  const category = String(intent?.category || '').trim().toLowerCase()
  if (category) {
    pushSignal(`category:${category}`, category, 1.0, 'category')
  }

  for (const tag of normalizeSemanticTags(intent?.semanticTags)) {
    pushSignal(`semantic:${tag}`, tag, 0.82, 'semantic_tag')
  }

  const regionLabel = toFiniteNumber(intent?.regionLabel)
  if (regionLabel !== null) {
    pushSignal(`region:${regionLabel}`, `region_${regionLabel}`, 0.58, 'region')
  }

  const radiusBucket = bucketizeRadius(intent?.radiusM)
  if (radiusBucket) {
    pushSignal(radiusBucket, radiusBucket, 0.34, 'radius')
  }

  for (const signal of collectQueryIntentSignals(userQuery, intent?.placeName)) {
    pushSignal(signal.key, signal.label, signal.weight, signal.kind)
  }

  return signals
}

function buildIntentAdapterEmbedding(signals = [], dimension = 0) {
  if (!Array.isArray(signals) || signals.length === 0 || !Number.isInteger(dimension) || dimension <= 0) {
    return {
      applied: false,
      signalCount: 0,
      adapterEmbedding: null,
      signals: []
    }
  }

  const adapter = new Array(dimension).fill(0)

  for (const signal of signals) {
    for (let slot = 0; slot < INTENT_ADAPTER_SLOT_COUNT; slot += 1) {
      const hash = stableHash(`${signal.key}#${slot}`)
      const index = hash % dimension
      const sign = ((hash >> 7) & 1) === 0 ? 1 : -1
      const slotWeight = slot === 0
        ? 1
        : slot === 1
          ? 0.72
          : slot === 2
            ? 0.46
            : 0.31
      adapter[index] += sign * signal.weight * slotWeight
    }
  }

  return {
    applied: true,
    signalCount: signals.length,
    adapterEmbedding: normalizeL2(adapter),
    signals: signals.map((signal) => ({
      kind: signal.kind,
      label: signal.label,
      weight: roundNumber(signal.weight, 4)
    }))
  }
}

function computeIntentWeight(signalCount = 0) {
  if (!signalCount) return 0
  return Math.min(0.32, 0.16 + Math.max(0, signalCount - 1) * 0.035)
}

function buildAnchorComponent(weight = 1, anchorMetadata = {}) {
  return {
    applied: true,
    weight,
    ...(anchorMetadata?.featureSource ? { featureSource: anchorMetadata.featureSource } : {}),
    ...(anchorMetadata?.featureStats ? { featureStats: anchorMetadata.featureStats } : {})
  }
}

function fuseAnchorAndIntentEmbeddings(anchorEmbedding = [], intentAdapter = null, anchorMetadata = {}) {
  if (!Array.isArray(anchorEmbedding) || anchorEmbedding.length === 0) {
    return {
      source: null,
      queryEmbedding: null,
      components: null
    }
  }

  if (!intentAdapter?.applied || !Array.isArray(intentAdapter.adapterEmbedding) || intentAdapter.adapterEmbedding.length !== anchorEmbedding.length) {
    return {
      source: 'anchor_encoder_v1',
      queryEmbedding: anchorEmbedding,
      components: {
        anchor: buildAnchorComponent(1, anchorMetadata),
        intentAdapter: {
          applied: false,
          weight: 0,
          signalCount: 0,
          signals: []
        }
      }
    }
  }

  const intentWeight = computeIntentWeight(intentAdapter.signalCount)
  if (intentWeight <= 0) {
    return {
      source: 'anchor_encoder_v1',
      queryEmbedding: anchorEmbedding,
      components: {
        anchor: buildAnchorComponent(1, anchorMetadata),
        intentAdapter: {
          applied: false,
          weight: 0,
          signalCount: 0,
          signals: []
        }
      }
    }
  }

  const anchorWeight = 1 - intentWeight
  const normalizedAnchor = normalizeL2(anchorEmbedding)
  const fused = normalizeL2(
    normalizedAnchor.map((value, index) => (
      value * anchorWeight + intentAdapter.adapterEmbedding[index] * intentWeight
    ))
  )

  return {
    source: 'anchor_encoder_intent_adapter_v2',
    queryEmbedding: fused,
    components: {
      anchor: buildAnchorComponent(roundNumber(anchorWeight, 4), anchorMetadata),
      intentAdapter: {
        applied: true,
        weight: roundNumber(intentWeight, 4),
        signalCount: intentAdapter.signalCount,
        signals: intentAdapter.signals,
        source: 'structured_intent_adapter_v1'
      }
    }
  }
}

export async function buildSpatialQueryEmbedding({
  userQuery = '',
  intent = {},
  anchor = null,
  client = {
    isSpatialEncoderRunning,
    startSpatialEncoder,
    encodeCoords
  }
} = {}) {
  const lon = toFiniteNumber(anchor?.lon)
  const lat = toFiniteNumber(anchor?.lat)
  const poiId = toFiniteNumber(anchor?.poiId)
  if (lon === null || lat === null) {
    return buildResult({
      applied: false,
      reason: 'invalid_anchor'
    })
  }

  try {
    let running = await client.isSpatialEncoderRunning()
    if (!running) {
      running = await client.startSpatialEncoder()
    }

    if (!running) {
      return buildResult({
        applied: false,
        reason: 'encoder_unavailable'
      })
    }

    const payload = poiId === null
      ? await client.encodeCoords(lon, lat)
      : await client.encodeCoords(lon, lat, { poiId })
    const normalizedEmbedding = normalizeEmbeddingPayload(payload)
    const anchorMetadata = normalizeFeatureMetadata(payload)
    if (!normalizedEmbedding.length) {
      return buildResult({
        applied: false,
        reason: 'no_embedding'
      })
    }

    const intentSignals = collectIntentSignals({
      userQuery,
      intent
    })
    const intentAdapter = buildIntentAdapterEmbedding(intentSignals, normalizedEmbedding.length)
    const fused = fuseAnchorAndIntentEmbeddings(normalizedEmbedding, intentAdapter, anchorMetadata)

    return buildResult({
      applied: true,
      reason: 'encoded',
      source: fused.source,
      modelName: 'poi_encoder',
      modelUsage: ['poi_encoder'],
      embeddingDim: normalizedEmbedding.length,
      queryEmbedding: fused.queryEmbedding,
      components: fused.components
    })
  } catch (error) {
    return buildResult({
      applied: false,
      reason: 'encode_failed',
      error: error instanceof Error ? error.message : String(error || '')
    })
  }
}

export function buildQueryEmbeddingSearchOptions(queryEmbedding = null) {
  if (!queryEmbedding?.applied || !Array.isArray(queryEmbedding?.queryEmbedding) || !queryEmbedding.queryEmbedding.length) {
    return {}
  }

  return {
    queryEmbedding: queryEmbedding.queryEmbedding,
    semanticWeight: QUERY_EMBEDDING_SEMANTIC_WEIGHT,
    spatialWeight: QUERY_EMBEDDING_SPATIAL_WEIGHT
  }
}

export default {
  buildSpatialQueryEmbedding,
  buildQueryEmbeddingSearchOptions
}
