/**
 * Node -> Python gRPC client wrapper.
 */
import path from 'path'
import { fileURLToPath } from 'url'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import telemetry from './telemetry.js'
import { classifySpatialError } from './errorDiagnostics.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROTO_PATH = path.resolve(__dirname, '../proto/spatial_compute.proto')

const GRPC_ENDPOINT = process.env.SPATIAL_GRPC_ENDPOINT || '127.0.0.1:50051'
const GRPC_TIMEOUT_MS = parseInt(process.env.SPATIAL_GRPC_TIMEOUT_MS || '90000', 10)

let client
let enumMap

function loadGrpcClient() {
  if (client) {
    return client
  }

  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  })

  const proto = grpc.loadPackageDefinition(packageDefinition)
  const serviceRoot = proto.spatialcompute

  if (!serviceRoot?.SpatialComputeService) {
    throw new Error('SpatialComputeService definition not found in proto')
  }

  enumMap = serviceRoot.EventType || {}

  client = new serviceRoot.SpatialComputeService(
    GRPC_ENDPOINT,
    grpc.credentials.createInsecure(),
    {
      // 消息大小限制（50MB），匹配 Python 服务端
      'grpc.max_receive_message_length': 50 * 1024 * 1024,
      'grpc.max_send_message_length': 50 * 1024 * 1024,
      // keepalive：每 30 秒 ping 一次（Python 端允许最小 10 秒间隔）
      'grpc.keepalive_time_ms': 30_000,
      'grpc.keepalive_timeout_ms': 10_000,
      // 允许无活跃 RPC 时依然发送 keepalive ping
      'grpc.keepalive_permit_without_calls': 1
    }
  )

  return client
}

function normalizeEventType(typeValue) {
  if (!typeValue) return 'EVENT_TYPE_UNSPECIFIED'
  if (typeof typeValue === 'string') return typeValue

  if (enumMap) {
    for (const [key, value] of Object.entries(enumMap)) {
      if (value === typeValue) {
        return key
      }
    }
  }

  return String(typeValue)
}

function normalizeGrpcMetadata(metadata) {
  if (!metadata || typeof metadata.getMap !== 'function') {
    return {}
  }
  try {
    return metadata.getMap() || {}
  } catch {
    return {}
  }
}

export function buildGrpcStreamErrorFromEvent(payload = {}, context = {}) {
  const message = typeof payload?.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : 'Python compute returned ERROR'
  const diagnostics = payload?.diagnostics && typeof payload.diagnostics === 'object'
    ? payload.diagnostics
    : {}
  const inferred = classifySpatialError(message)
  const errorCode = String(payload?.code || diagnostics?.error_code || inferred.error_code || '')

  const error = new Error(message)
  if (errorCode) {
    error.code = errorCode
  }
  if (Object.keys(diagnostics).length > 0) {
    error.diagnostics = diagnostics
  }
  if (diagnostics?.python_context && typeof diagnostics.python_context === 'object') {
    error.python_context = diagnostics.python_context
  }

  error.grpc_context = {
    endpoint: context.endpoint || GRPC_ENDPOINT,
    timeout_ms: context.timeout_ms ?? null,
    last_stage: context.last_stage || null,
    event_count: Number(context.event_count || 0),
    grpc_status: null,
    source: 'grpc_error_event'
  }

  return error
}

export function enrichGrpcTransportError(rawError, context = {}) {
  const error = rawError instanceof Error ? rawError : new Error(String(rawError))
  const inferred = classifySpatialError(error.message)
  if (!error.code && inferred.error_code) {
    error.code = inferred.error_code
  }

  error.grpc_context = {
    endpoint: context.endpoint || GRPC_ENDPOINT,
    timeout_ms: context.timeout_ms ?? null,
    last_stage: context.last_stage || null,
    event_count: Number(context.event_count || 0),
    grpc_status: Number.isFinite(Number(rawError?.code)) ? Number(rawError.code) : null,
    grpc_details: String(rawError?.details || ''),
    grpc_metadata: normalizeGrpcMetadata(rawError?.metadata),
    source: 'grpc_transport_error'
  }

  return error
}

export function isGrpcComputeEnabled() {
  return process.env.SPATIAL_GRPC_ENABLED !== 'false'
}

function clampTimeout(timeoutMs) {
  const numeric = Number(timeoutMs)
  if (!Number.isFinite(numeric) || numeric <= 0) return 45_000
  return Math.max(5_000, Math.min(Math.floor(numeric), 300_000))
}

function clampIdleTimeout(timeoutMs) {
  const numeric = Number(timeoutMs)
  if (!Number.isFinite(numeric) || numeric <= 0) return 120_000
  return Math.max(15_000, Math.min(Math.floor(numeric), 900_000))
}

function parseHintsOptions(requestPayload = {}) {
  try {
    const rawHints = requestPayload?.hints
    if (!rawHints) return {}
    const hints = typeof rawHints === 'string' ? JSON.parse(rawHints) : rawHints
    if (!hints || typeof hints !== 'object') return {}
    return hints.options && typeof hints.options === 'object' ? hints.options : {}
  } catch {
    return {}
  }
}

export function resolveGrpcTimeoutMs(requestPayload = {}) {
  const options = parseHintsOptions(requestPayload)
  const queryType = String(requestPayload?.query_type || '').trim().toLowerCase()
  const mode = String(requestPayload?.mode || '').trim().toLowerCase()

  const overrideCandidates = [
    options.grpcTimeoutMs,
    options.syncTimeoutMs,
    requestPayload?.timeout_ms,
    requestPayload?.timeoutMs
  ]
  for (const value of overrideCandidates) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return clampTimeout(numeric)
    }
  }

  let timeoutMs = clampTimeout(GRPC_TIMEOUT_MS)

  if (queryType === 'area_analysis') {
    timeoutMs = Math.max(timeoutMs, 45_000)
  }
  if (mode === 'async') {
    timeoutMs = Math.max(timeoutMs, 120_000)
  }

  const heavyFlags = [
    options.visualReviewEnabled,
    options.visualRemoteEnabled,
    options.selfValidationEnabled,
    options.skgEnabled
  ]
  if (heavyFlags.some((flag) => flag === true)) {
    timeoutMs = Math.max(timeoutMs, 120_000)
  }

  return clampTimeout(timeoutMs)
}

export function resolveGrpcIdleTimeoutMs(requestPayload = {}) {
  const options = parseHintsOptions(requestPayload)
  const overrideCandidates = [
    options.grpcIdleTimeoutMs,
    options.idleTimeoutMs,
    requestPayload?.grpc_idle_timeout_ms,
    requestPayload?.grpcIdleTimeoutMs
  ]

  let idleTimeoutMs = 0
  for (const value of overrideCandidates) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      idleTimeoutMs = clampIdleTimeout(numeric)
      break
    }
  }

  const requestTimeoutMs = resolveGrpcTimeoutMs(requestPayload)
  if (idleTimeoutMs <= 0) {
    idleTimeoutMs = Math.max(120_000, requestTimeoutMs)
  }

  return Math.max(clampIdleTimeout(idleTimeoutMs), requestTimeoutMs)
}

export async function computeSpatialStream(requestPayload, onEvent) {
  if (!isGrpcComputeEnabled()) {
    throw new Error('gRPC compute disabled by SPATIAL_GRPC_ENABLED=false')
  }

  const grpcClient = loadGrpcClient()
  const traceId = requestPayload?.request_id || requestPayload?.requestId || 'unknown'
  const startedAt = Date.now()
  const timeoutMs = resolveGrpcTimeoutMs(requestPayload)
  const idleTimeoutMs = resolveGrpcIdleTimeoutMs(requestPayload)

  telemetry.incrementCounter('grpc_compute_requests_total', { endpoint: GRPC_ENDPOINT })
  telemetry.logStructured('info', 'grpc_compute_start', {
    trace_id: traceId,
    endpoint: GRPC_ENDPOINT,
    timeout_ms: timeoutMs,
    idle_timeout_ms: idleTimeoutMs,
    query_type: requestPayload?.query_type || 'unknown'
  })

  return new Promise((resolve, reject) => {
    let finalPayload = null
    let settled = false
    let lastStage = 'grpc_stream_opened'
    let eventCount = 0

    const call = grpcClient.ComputeSpatial(requestPayload)
    let idleTimer = null

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const armIdleTimer = () => {
      clearIdleTimer()
      idleTimer = setTimeout(() => {
        const idleError = new Error(`gRPC stream idle timeout after ${idleTimeoutMs}ms`)
        idleError.code = 'grpc_idle_timeout'
        idleError.grpc_context = {
          endpoint: GRPC_ENDPOINT,
          timeout_ms: timeoutMs,
          idle_timeout_ms: idleTimeoutMs,
          last_stage: lastStage,
          event_count: eventCount,
          grpc_status: null,
          source: 'grpc_idle_timeout'
        }
        settleWithError(idleError)
      }, idleTimeoutMs)
    }
    armIdleTimer()

    const settleWithError = (err) => {
      if (settled) return
      settled = true
      clearIdleTimer()
      try {
        call.cancel()
      } catch {
      }

      const errorCode = String(err?.code || err?.diagnostics?.error_code || '')
      const grpcStatus = Number.isFinite(Number(err?.grpc_context?.grpc_status))
        ? Number(err.grpc_context.grpc_status)
        : null

      telemetry.incrementCounter('grpc_compute_failures_total', { endpoint: GRPC_ENDPOINT })
      telemetry.logStructured('error', 'grpc_compute_error', {
        trace_id: traceId,
        endpoint: GRPC_ENDPOINT,
        timeout_ms: timeoutMs,
        idle_timeout_ms: idleTimeoutMs,
        error: err?.message || String(err),
        error_code: errorCode || undefined,
        last_stage: String(err?.grpc_context?.last_stage || lastStage || ''),
        grpc_status: grpcStatus
      })

      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const settleWithSuccess = () => {
      if (settled) return
      settled = true
      clearIdleTimer()
      const durationMs = Date.now() - startedAt
      telemetry.observeHistogram('stage_duration_ms', durationMs, {
        stage: 'grpc_compute',
        endpoint: GRPC_ENDPOINT
      })
      telemetry.logStructured('info', 'grpc_compute_complete', {
        trace_id: traceId,
        endpoint: GRPC_ENDPOINT,
        timeout_ms: timeoutMs,
        idle_timeout_ms: idleTimeoutMs,
        duration_ms: durationMs
      })
      resolve(finalPayload)
    }

    call.on('data', async (event) => {
      if (settled) return

      try {
        armIdleTimer()
        eventCount += 1
        const eventType = normalizeEventType(event.type)
        let parsedPayload = {}

        if (event.payload) {
          try {
            parsedPayload = JSON.parse(event.payload)
          } catch {
            parsedPayload = { raw: event.payload }
          }
        }

        if (eventType === 'STAGE') {
          const stageName = parsedPayload?.stage || parsedPayload?.name
          if (stageName) {
            lastStage = String(stageName)
          }
        }

        if (typeof onEvent === 'function') {
          await onEvent({
            type: eventType,
            payload: parsedPayload,
            ts: Number(event.ts || Date.now())
          })
        }

        if (eventType === 'ERROR') {
          const streamError = buildGrpcStreamErrorFromEvent(parsedPayload, {
            endpoint: GRPC_ENDPOINT,
            timeout_ms: timeoutMs,
            last_stage: lastStage,
            event_count: eventCount
          })
          settleWithError(streamError)
          return
        }

        if (eventType === 'FINAL') {
          finalPayload = parsedPayload
        }
      } catch (err) {
        settleWithError(err)
      }
    })

    call.on('error', (err) => {
      const transportError = enrichGrpcTransportError(err, {
        endpoint: GRPC_ENDPOINT,
        timeout_ms: timeoutMs,
        last_stage: lastStage,
        event_count: eventCount
      })
      settleWithError(transportError)
    })

    call.on('end', () => {
      settleWithSuccess()
    })
  })
}

export function closeGrpcClient() {
  if (client) {
    client.close()
    client = null
  }
}

/**
 * 空间检索 gRPC 调用
 * 调用 Python 服务的 SpatialSearch RPC
 *
 * @param {Object} params - 检索参数
 * @param {number} params.anchorLon - 锚点经度
 * @param {number} params.anchorLat - 锚点纬度
 * @param {number} params.radius - 检索半径（米）
 * @param {number[]} params.queryEmbedding - 查询向量 (352 维)
 * @param {string[]} params.categories - 类别过滤
 * @param {number} params.targetRegion - 目标区域类型 (0-5)
 * @param {string} params.regionFilterMode - 区域过滤模式
 * @param {number} params.topK - 返回数量
 * @returns {Promise<Object>} - 检索结果
 */
export async function spatialSearch(params) {
  if (!isGrpcComputeEnabled()) {
    throw new Error('gRPC compute disabled by SPATIAL_GRPC_ENABLED=false')
  }

  const grpcClient = loadGrpcClient()

  return new Promise((resolve, reject) => {
    const request = {
      anchor_lon: params.anchorLon || 114.305,
      anchor_lat: params.anchorLat || 30.593,
      radius: params.radius || 1000,
      query_embedding: params.queryEmbedding || [],
      categories: params.categories || [],
      target_region: params.targetRegion ?? -1,
      region_filter_mode: params.regionFilterMode || 'boost',
      top_k: params.topK || 20,
      spatial_weight: params.spatialWeight || 0.6,
      semantic_weight: params.semanticWeight || 0.4,
      region_weight: params.regionWeight || 0.15,
    }

    grpcClient.SpatialSearch(request, (err, response) => {
      if (err) {
        const transportError = enrichGrpcTransportError(err, {
          endpoint: GRPC_ENDPOINT,
          last_stage: 'spatial_search',
        })
        reject(transportError)
        return
      }

      if (!response.success) {
        reject(new Error(response.error || 'SpatialSearch failed'))
        return
      }

      // 转换结果
      const results = response.results.map(r => ({
        id: Number(r.id),
        name: r.name,
        category: r.category,
        regionLabel: r.region_label,
        lon: r.lon,
        lat: r.lat,
        distance_m: r.distance_m,
        semantic_score: r.semantic_score,
        fused_score: r.fused_score,
      }))

      resolve({
        success: true,
        totalCount: response.total_count,
        durationMs: response.duration_ms,
        results,
      })
    })
  })
}

export default {
  isGrpcComputeEnabled,
  computeSpatialStream,
  closeGrpcClient,
  spatialSearch,
}
