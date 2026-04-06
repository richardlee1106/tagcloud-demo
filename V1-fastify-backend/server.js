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
import opsRoutes from './routes/ops/index.js'

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
fastify.register(opsRoutes, { prefix: '/api/ops' })

// 健康检查端点：返回详细服务状态
fastify.get('/health', async () => {
  // 获取 FAISS 索引状态
  let faissStatus = { loaded: false, poiCount: 0, embeddingDim: 0 }
  try {
    const { getIndexStatus } = await import('../V3-GeoEncoder-RAG/services/retrieval/faissIndex.js')
    faissStatus = getIndexStatus()
  } catch (e) {
    // FAISS 模块不可用
  }

  // 获取数据库状态
  let dbStatus = 'connected'
  try {
    const { query } = await import('./services/database.js')
    await query('SELECT 1')
  } catch (e) {
    dbStatus = 'disconnected'
  }

  // 获取 LLM 状态
  let llmStatus = 'unknown'
  try {
    const response = await fetch(process.env.LLM_BASE_URL || 'http://127.0.0.1:1234/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    })
    llmStatus = response.ok ? 'available' : 'unavailable'
  } catch (e) {
    llmStatus = 'unavailable'
  }

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      llm: llmStatus,
      faiss: faissStatus.loaded ? `loaded (${faissStatus.poiCount} POIs)` : 'not_loaded',
    },
    faiss: faissStatus,
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  }
})

/**
 * Źرգ֤˳ǰͷⲿӡ
 * ע⣺ﰴرգ١ѹرԴԱáĸʡ
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

    // 使用 memory 队列时必须启用内联 worker，否则 API 侧无法完成消费
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

    // 启动时预加载 FAISS 索引（异步，不阻塞启动）
    if (process.env.AUTO_LOAD_FAISS !== 'false') {
      console.log('Pre-loading FAISS index...')
      import('../V3-GeoEncoder-RAG/services/retrieval/faissIndex.js')
        .then(async (module) => {
          const start = Date.now()
          const success = await module.loadEmbeddings()
          if (success) {
            console.log(`[Server] FAISS index loaded in ${Date.now() - start}ms`)
          } else {
            console.warn('[Server] FAISS index load failed, will use PostGIS fallback')
          }
        })
        .catch(err => console.warn('[Server] FAISS module not available:', err.message))
    }

    const port = parseInt(process.env.PORT || '3200', 10)
    const host = process.env.HOST || '127.0.0.1'
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
