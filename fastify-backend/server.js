/**
 * Fastify 主入口（Node 网关）
 *
 * 角色定位：
 * 1) 对外暴露统一 HTTP API。
 * 2) 管理基础依赖生命周期（DB / 向量库 / 队列 / gRPC 客户端）。
 * 3) 根据配置决定是否在 API 进程内联启动 worker（开发态方便，生产通常独立进程）。
 */
import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

// 业务路由：AI 聊天兼容层、Jobs 主协议、空间与检索辅助接口。
import aiRoutes from './routes/ai/index.js'
import jobRoutes from './routes/jobs/index.js'
import spatialRoutes from './routes/spatial/index.js'
import searchRoutes from './routes/search.js'
import categoryRoutes from './routes/category.js'

// 基础服务：数据库、向量库、任务队列、gRPC 客户端、worker。
import { initDatabase, closeDatabase } from './services/database.js'
import { initVectorDB, closeVectorDB } from './services/vectordb.js'
import { initQueueServices, closeQueueServices, getQueueMode } from './services/queue.js'
import { closeGrpcClient } from './services/grpcClient.js'
import { startSpatialWorker } from './workers/spatialWorker.js'

// 开启 logger 便于排障；生产可按需要切换为 pino transport。
const fastify = Fastify({ logger: true })

// CORS 放开给前端开发环境和网关反代环境使用。
await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
})

// 统一 API 路由前缀，避免误走根目录 mock。
fastify.register(aiRoutes, { prefix: '/api/ai' })
fastify.register(jobRoutes, { prefix: '/api/jobs' })
fastify.register(spatialRoutes, { prefix: '/api/spatial' })
fastify.register(searchRoutes, { prefix: '/api/search' })
fastify.register(categoryRoutes, { prefix: '/api/category' })

// 最小健康探针：用于 docker healthcheck / k8s 探活。
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

/**
 * 优雅关闭：保证进程退出前尽量释放外部连接。
 * 注意：这里按依赖方向逆序关闭，减少“已关闭资源仍被调用”的概率。
 */
const gracefulShutdown = async (signal) => {
  console.log(`\nReceived ${signal}, shutting down...`)
  await fastify.close()
  await closeDatabase()
  await closeVectorDB()
  await closeQueueServices()
  closeGrpcClient()
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

/**
 * 启动流程：
 * 1) 连接 PostGIS。
 * 2) 初始化 pgvector（可选能力）。
 * 3) 初始化 Jobs 队列。
 * 4) 按需启动内联 worker。
 * 5) 监听 HTTP 端口。
 */
const start = async () => {
  try {
    console.log('Connecting PostgreSQL + PostGIS...')
    await initDatabase()

    console.log('Initializing pgvector support...')
    await initVectorDB()
    console.log('Initializing job queue...')
    await initQueueServices()

    // ?????memory ????????????????? API ???????
    const queueMode = getQueueMode()
    const inlineWorkerEnabledByConfig = process.env.ENABLE_INLINE_SPATIAL_WORKER !== 'false'
    const mustUseInlineWorker = queueMode === 'memory'

    if (mustUseInlineWorker || inlineWorkerEnabledByConfig) {
      if (mustUseInlineWorker && !inlineWorkerEnabledByConfig) {
        console.warn('[Server] ENABLE_INLINE_SPATIAL_WORKER=false ignored: memory queue requires inline worker')
      }
      console.log('Starting inline spatial worker...')
      await startSpatialWorker()
    }

    const port = parseInt(process.env.PORT || '3200', 10)
    const host = '0.0.0.0'
    await fastify.listen({ port, host })

    console.log(`\nGeoLoom-RAG backend: http://${host}:${port}`)
    console.log(`Spatial query API: http://${host}:${port}/api/spatial/query`)
    console.log(`Jobs API: http://${host}:${port}/api/jobs/narrative`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
