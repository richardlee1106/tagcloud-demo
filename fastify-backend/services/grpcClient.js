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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROTO_PATH = path.resolve(__dirname, '../proto/spatial_compute.proto')

const GRPC_ENDPOINT = process.env.SPATIAL_GRPC_ENDPOINT || '127.0.0.1:50051'
const GRPC_TIMEOUT_MS = parseInt(process.env.SPATIAL_GRPC_TIMEOUT_MS || '25000', 10)

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
      // 限制消息大小与 keepalive，降低长流断开概率。
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

  return new Promise((resolve, reject) => {
    let finalPayload = null
    let settled = false

    const deadline = new Date(Date.now() + GRPC_TIMEOUT_MS)
    const call = grpcClient.ComputeSpatial(requestPayload, { deadline })

    const settleWithError = (err) => {
      if (settled) return
      settled = true
      try {
        call.cancel()
      } catch {
        // ???????????
      }
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const settleWithSuccess = () => {
      if (settled) return
      settled = true
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
            // payload ?? JSON ????????????????
            parsedPayload = { raw: event.payload }
          }
        }

        if (typeof onEvent === 'function') {
          // ?? async ?????????????? Promise ??????
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
 * ????????? client????? channel?
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
