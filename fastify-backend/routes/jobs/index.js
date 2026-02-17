/**
 * Jobs 主协议路由
 *
 * 设计目标：
 * - 提供与前端解耦的异步任务生命周期 API。
 * - 支持同步/异步两种执行模式，便于“快查询直返 + 重查询排队”。
 * - 对外暴露统一状态查询、SSE 订阅和结果拉取接口。
 */
import { randomUUID } from 'crypto'

import {
  initQueueServices,
  enqueueSpatialJob,
  getJobSnapshot,
  getJobResult,
  awaitJobCompletion,
  subscribeJobEvents,
  getQueueMode,
  getQueueHealthSnapshot
} from '../../services/queue.js'
import {
  decideExecutionMode,
  extractLastUserMessage
} from '../../services/spatialJobRunner.js'
import { getSpatialMigrationConfig } from '../../services/migrationPolicy.js'

/**
 * SSE 事件写入工具。
 * 统一处理格式，避免各路由重复拼接 event/data。
 */
function writeSSEEvent(reply, eventName, payload) {
  if (reply.raw.destroyed) {
    return
  }

  reply.raw.write(`event: ${eventName}\n`)
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function jobsRoutes(fastify) {
  // 路由注册时确保队列就绪（Redis 不可用时自动降级内存模式）。
  await initQueueServices()

  /**
   * 创建 narrative 任务。
   * - mode=sync：创建后等待完成再返回。
   * - mode=async：立即返回 job_id，客户端后续自行轮询/SSE。
   */
  fastify.post('/narrative', async (request, reply) => {
    const body = request.body || {}
    const messages = Array.isArray(body.messages) ? body.messages : []
    const options = body.options || {}
    const spatialContext = body.spatialContext || options.spatialContext || {}
    const poiFeatures = Array.isArray(body.poiFeatures) ? body.poiFeatures : []

    // query 优先，缺失时从会话消息中提取最后一条 user 文本。
    const question = body.query || extractLastUserMessage(messages)

    if (!question) {
      return reply.status(400).send({
        error: 'Missing query or messages'
      })
    }

    const requestId = body.request_id || randomUUID()

    // 统一走分流规则，避免“拍脑袋”判断同步异步。
    const modeDecision = decideExecutionMode({
      spatialContext,
      queryPlan: body.queryPlan || options.queryPlan || null,
      options,
      estimatedPoiCount: options.estimatedCandidates ?? poiFeatures.length
    })

    // 入队 payload 保持最小闭环字段，兼容后续扩展。
    const payload = {
      request_id: requestId,
      query: question,
      messages,
      spatialContext,
      poiFeatures,
      options: {
        ...options,
        mode: modeDecision.mode
      }
    }

    const enqueueResult = await enqueueSpatialJob(payload, {
      attempts: options.attempts
    })

    // 同步模式：为兼容旧交互，服务端阻塞等待结果并直接返回。
    if (modeDecision.mode === 'sync') {
      try {
        const completed = await awaitJobCompletion(enqueueResult.jobId, {
          timeoutMs: parseInt(options.syncTimeoutMs || '120000', 10)
        })

        return {
          job_id: enqueueResult.jobId,
          mode: 'sync',
          status: completed?.status || 'completed',
          queue_mode: getQueueMode(),
          decision: modeDecision,
          result: completed?.result || null
        }
      } catch (err) {
        return reply.status(504).send({
          job_id: enqueueResult.jobId,
          mode: 'sync',
          status: 'timeout',
          queue_mode: getQueueMode(),
          decision: modeDecision,
          error: err.message
        })
      }
    }

    // 异步模式：仅返回任务元信息，前端自行跟踪。
    return {
      job_id: enqueueResult.jobId,
      mode: 'async',
      status: 'queued',
      queue_mode: getQueueMode(),
      decision: modeDecision
    }
  })

  /**
   * 查询任务状态。
   * 返回字段尽量稳定，方便前端做进度条和失败重试提示。
   */
  /**
   * Jobs 健康检查：统一暴露队列状态 + 迁移开关快照 + 告警。
   * 该接口用于发布前巡检、灰度期监控与故障自检。
   */
  fastify.get('/health', async () => {
    const queueHealth = await getQueueHealthSnapshot()
    const migrationConfig = getSpatialMigrationConfig()

    const migration = {
      migrate_enabled: migrationConfig.migrateEnabled,
      migrate_percent: migrationConfig.migratePercent,
      migrate_query_types: [...migrationConfig.migrateQueryTypes],
      dual_run_enabled: migrationConfig.dualRunEnabled,
      dual_run_sample: migrationConfig.dualRunSample,
      py_data_source: migrationConfig.pyDataSource
    }

    const alerts = [...(queueHealth.alerts || [])]

    if (!migration.migrate_enabled) {
      alerts.push({
        code: 'migration_disabled',
        severity: 'warning',
        message: '空间迁移总开关已关闭，服务可能不可用。'
      })
    }

    // force_node_fallback已被废弃，不再显示相关告警
    // 所有空间计算强制使用Python服务

    const status = alerts.some((item) => item.severity === 'error') ? 'degraded' : 'ok'

    return {
      status,
      checked_at: new Date().toISOString(),
      queue: queueHealth,
      migration,
      alerts
    }
  })

  fastify.get('/:job_id', async (request, reply) => {
    const { job_id: jobId } = request.params
    const snapshot = await getJobSnapshot(jobId)

    if (!snapshot) {
      return reply.status(404).send({
        error: 'Job not found',
        job_id: jobId
      })
    }

    return {
      job_id: snapshot.job_id,
      status: snapshot.status,
      stage: snapshot.stage,
      progress: snapshot.progress,
      eta_ms: snapshot.eta_ms,
      error: snapshot.error
    }
  })

  /**
   * 拉取任务结果。
   * 只有 completed 才返回 result，避免客户端误用中间态结果。
   */
  fastify.get('/:job_id/result', async (request, reply) => {
    const { job_id: jobId } = request.params
    const snapshot = await getJobSnapshot(jobId)

    if (!snapshot) {
      return reply.status(404).send({
        error: 'Job not found',
        job_id: jobId
      })
    }

    if (snapshot.status !== 'completed') {
      return reply.status(409).send({
        error: 'Job not completed',
        job_id: jobId,
        status: snapshot.status
      })
    }

    const result = await getJobResult(jobId)
    return {
      job_id: jobId,
      status: 'completed',
      result
    }
  })

  /**
   * SSE 订阅任务实时事件。
   * - 入流时先推一条 started，确保前端立即有状态。
   * - 开启 heartbeat，防止代理层超时断开。
   */
  fastify.get('/:job_id/stream', async (request, reply) => {
    const { job_id: jobId } = request.params

    const snapshot = await getJobSnapshot(jobId)
    if (!snapshot) {
      return reply.status(404).send({
        error: 'Job not found',
        job_id: jobId
      })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    })

    writeSSEEvent(reply, 'started', {
      job_id: jobId,
      status: snapshot.status,
      stage: snapshot.stage,
      progress: snapshot.progress,
      queue_mode: getQueueMode()
    })

    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(': heartbeat\n\n')
      }
    }, 15000)

    const unsubscribe = subscribeJobEvents(
      jobId,
      (event) => {
        writeSSEEvent(reply, event.type, event.payload)

        // 任务结束后立即终止 SSE，避免连接泄漏。
        if (event.type === 'completed' || event.type === 'failed') {
          writeSSEEvent(reply, 'done', {
            job_id: jobId,
            status: event.type === 'completed' ? 'completed' : 'failed'
          })
          clearInterval(heartbeat)
          unsubscribe()
          if (!reply.raw.destroyed) {
            reply.raw.end()
          }
        }
      },
      { replay: true }
    )

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}

export default jobsRoutes
