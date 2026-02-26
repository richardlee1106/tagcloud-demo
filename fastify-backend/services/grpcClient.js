/**
 * Node -> Python gRPC 客户端封装。
 *
 * 目标：
 * - 对上层隐藏 proto 加载与事件解析细节。
 * - 提供“流式事件 + 最终结果”统一接口。
 */
import path from 'path'
import { fileURLToPath } from 'url'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import telemetry from './telemetry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROTO_PATH = path.resolve(__dirname, '../proto/spatial_compute.proto')

const GRPC_ENDPOINT = process.env.SPATIAL_GRPC_ENDPOINT || '127.0.0.1:50051'
const GRPC_TIMEOUT_MS = parseInt(process.env.SPATIAL_GRPC_TIMEOUT_MS || '45000', 10)

let client
let enumMap

/**
 * 按需创建 gRPC client（懒加载）。
 * 避免模块 import 阶段因 proto/网络异常直接崩溃。
 */
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
      // ϢС keepaliveͳϿʡ
      'grpc.max_receive_message_length': 10 * 1024 * 1024,
      'grpc.keepalive_time_ms': 20_000,
      'grpc.keepalive_timeout_ms': 5_000
    }
  )

  return client
}

/**
 * 将 proto 的 enum 值统一转为字符串，方便上层 switch 判断。
 */
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

export function isGrpcComputeEnabled() {
  return process.env.SPATIAL_GRPC_ENABLED !== 'false'
}

function clampTimeout(timeoutMs) {
  const numeric = Number(timeoutMs)
  if (!Number.isFinite(numeric) || numeric <= 0) return 45_000
  return Math.max(5_000, Math.min(Math.floor(numeric), 300_000))
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
    timeoutMs = Math.max(timeoutMs, 90_000)
  }

  return clampTimeout(timeoutMs)
}

/**
 * 执行流式计算。
 * - onEvent：逐条消费 STAGE/PROGRESS/PARTIAL/FINAL/ERROR。
 * - 返回值：最终 FINAL payload（若存在）。
 */
export async function computeSpatialStream(requestPayload, onEvent) {
  if (!isGrpcComputeEnabled()) {
    throw new Error('gRPC compute disabled by SPATIAL_GRPC_ENABLED=false')
  }

  const grpcClient = loadGrpcClient()
  const traceId = requestPayload?.request_id || requestPayload?.requestId || 'unknown'
  const startedAt = Date.now()
  const timeoutMs = resolveGrpcTimeoutMs(requestPayload)

  telemetry.incrementCounter('grpc_compute_requests_total', { endpoint: GRPC_ENDPOINT })
  telemetry.logStructured('info', 'grpc_compute_start', {
    trace_id: traceId,
    endpoint: GRPC_ENDPOINT,
    timeout_ms: timeoutMs,
    query_type: requestPayload?.query_type || 'unknown'
  })

  return new Promise((resolve, reject) => {
    let finalPayload = null
    let settled = false

    const deadline = new Date(Date.now() + timeoutMs)
    const call = grpcClient.ComputeSpatial(requestPayload, { deadline })

    const settleWithError = (err) => {
      if (settled) return
      settled = true
      try {
        call.cancel()
      } catch {
        // 取消调用时的二次异常直接忽略
      }
      telemetry.incrementCounter('grpc_compute_failures_total', { endpoint: GRPC_ENDPOINT })
      telemetry.logStructured('error', 'grpc_compute_error', {
        trace_id: traceId,
        endpoint: GRPC_ENDPOINT,
        timeout_ms: timeoutMs,
        error: err?.message || String(err)
      })
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const settleWithSuccess = () => {
      if (settled) return
      settled = true
      const durationMs = Date.now() - startedAt
      telemetry.observeHistogram('stage_duration_ms', durationMs, {
        stage: 'grpc_compute',
        endpoint: GRPC_ENDPOINT
      })
      telemetry.logStructured('info', 'grpc_compute_complete', {
        trace_id: traceId,
        endpoint: GRPC_ENDPOINT,
        timeout_ms: timeoutMs,
        duration_ms: durationMs
      })
      resolve(finalPayload)
    }

    call.on('data', async (event) => {
      if (settled) return

      try {
        const eventType = normalizeEventType(event.type)
        let parsedPayload = {}

        if (event.payload) {
          try {
            parsedPayload = JSON.parse(event.payload)
          } catch {
            // payload 不是 JSON 时，按原始字符串透传
            parsedPayload = { raw: event.payload }
          }
        }

        if (typeof onEvent === 'function') {
          // 允许 async 回调，串行等待 Promise 完成
          await onEvent({
            type: eventType,
            payload: parsedPayload,
            ts: Number(event.ts || Date.now())
          })
        }

        if (eventType === 'FINAL') {
          finalPayload = parsedPayload
        }
      } catch (err) {
        settleWithError(err)
      }
    })

    call.on('error', (err) => {
      settleWithError(err)
    })

    call.on('end', () => {
      settleWithSuccess()
    })
  })
}

/**
 * 主动关闭 gRPC client，释放底层 channel 连接
 */
export function closeGrpcClient() {
  if (client) {
    client.close()
    client = null
  }
}

export default {
  isGrpcComputeEnabled,
  computeSpatialStream,
  closeGrpcClient
}
