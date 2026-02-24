/**
 * 兼容层 AI 路由。
 * 目标是在不改前端的情况下，打通 Jobs 与 Python 计算链路。
 */
import { randomUUID } from 'crypto'

import { createRAGSession } from '../../services/ragLogger.js'
import { getActiveProviderInfo } from '../../services/llm.js'
import {
  enqueueSpatialJob,
  subscribeJobEvents,
  getJobSnapshot
} from '../../services/queue.js'
import {
  extractLastUserMessage,
  decideExecutionMode,
  executeSpatialPlanWithFallback,
  runNarrativeSpatialJob,
  toLegacySSEPayload
} from '../../services/spatialJobRunner.js'
import { parseIntent } from './planner.js'
import { validateSSEEventPayload } from '../../../shared/sseEventSchema.js'

// 会话内存缓存：保存本次请求的日志上下文与结果。
// LRU Ӳ޷ֹ߲ڴۻ
const ragSessions = new Map()
const RAG_SESSION_MAX = parseInt(process.env.RAG_SESSION_MAX || '200', 10)

// ڻչڻỰֹڴʱۻ
setInterval(() => {
  const now = Date.now()
  const maxAge = 30 * 60 * 1000

  for (const [id, session] of ragSessions.entries()) {
    if (now - session.createdAt > maxAge) {
      ragSessions.delete(id)
    }
  }

  // 即便无过期会话，也检查总量是否超过硬上限
  if (ragSessions.size > RAG_SESSION_MAX) {
    const overflow = ragSessions.size - RAG_SESSION_MAX
    const iterator = ragSessions.keys()
    for (let i = 0; i < overflow; i++) {
      const oldestKey = iterator.next().value
      if (oldestKey !== undefined) ragSessions.delete(oldestKey)
    }
    console.warn(`[AI Routes] ragSessions 超限淘汰 ${overflow} 条，当前 ${ragSessions.size} 条`)
  }
}, 5 * 60 * 1000)

/**
 */
/**
 * 写入具名 SSE 事件（event + data）。
 */
function writeSSEEvent(reply, eventName, payload) {
  if (reply.raw.destroyed) return
  const validation = validateSSEEventPayload(eventName, payload)
  if (!validation.ok) {
    console.warn('[AI Routes] SSE schema mismatch', {
      event: eventName,
      errors: validation.errors.slice(0, 5)
    })
    if (eventName !== 'schema_error') {
      const schemaErrorPayload = {
        event: String(eventName || 'unknown'),
        errors: validation.errors
      }
      reply.raw.write('event: schema_error\n')
      reply.raw.write(`data: ${JSON.stringify(schemaErrorPayload)}\n\n`)
    }
    return
  }
  reply.raw.write(`event: ${eventName}\n`)
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/**
 */
/**
 * 写入默认 SSE 文本分片（仅 data）。
 */
function writeSSEText(reply, content) {
  if (reply.raw.destroyed) return
  reply.raw.write(`data: ${JSON.stringify({ content })}\n\n`)
}

/**
 */
/**
 * 将返回结果同步到 Session，便于日志落盘与复盘。
 */
function applyResultToSession(session, legacyPayload) {
  if (!session || !legacyPayload) {
    return
  }

  if (legacyPayload.pois?.length) {
    session.setFinalPOIs?.(legacyPayload.pois)
  }

  if (legacyPayload.boundary) {
    session.setSpatialBoundary?.(legacyPayload.boundary)
  }

  if (legacyPayload.spatial_clusters?.hotspots?.length) {
    session.setSpatialClusters?.(legacyPayload.spatial_clusters.hotspots)
  }

  if (legacyPayload.vernacular_regions?.length) {
    session.setVernacularRegions?.(legacyPayload.vernacular_regions)
  }

  if (legacyPayload.fuzzy_regions?.length) {
    session.setFuzzyRegions?.(legacyPayload.fuzzy_regions)
  }
}

/**
 */
/**
 * ǰ˷ͼ¼ȷ UI 졣
 */
function emitLegacyEvents(reply, legacyPayload) {
  if (legacyPayload.pois?.length) {
    writeSSEEvent(reply, 'pois', legacyPayload.pois)
  }

  if (legacyPayload.boundary) {
    writeSSEEvent(reply, 'boundary', legacyPayload.boundary)
  }

  if (legacyPayload.spatial_clusters?.hotspots?.length) {
    writeSSEEvent(reply, 'spatial_clusters', legacyPayload.spatial_clusters)
  }

  if (legacyPayload.vernacular_regions?.length) {
    writeSSEEvent(reply, 'vernacular_regions', legacyPayload.vernacular_regions)
  }

  if (legacyPayload.fuzzy_regions?.length) {
    writeSSEEvent(reply, 'fuzzy_regions', legacyPayload.fuzzy_regions)
  }

  if (legacyPayload.stats && typeof legacyPayload.stats === 'object') {
    writeSSEEvent(reply, 'stats', legacyPayload.stats)
  }
}

/**
 */
/**
 * 初始化 SSE 响应头并启动 heartbeat。
 */
function beginSSE(reply, providerInfo = {}) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-AI-Provider': providerInfo.provider || 'unknown',
    'X-AI-Provider-Name': providerInfo.providerName || 'Unknown Provider',
    'X-Accel-Buffering': 'no'
  })

  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed) {
      reply.raw.write(': heartbeat\n\n')
    }
  }, 15_000)

  return () => {
    clearInterval(heartbeat)
    if (!reply.raw.destroyed) {
      reply.raw.end()
    }
  }
}

/**
 */
/**
 * AI 路由注册入口。
 */
async function aiRoutes(fastify) {
  /**
   */
  fastify.get('/status', async () => {
    // 复用 llm.js 的 30s 可用性缓存，避免每次请求独立发 HTTP 探测
    const providerInfo = await getActiveProviderInfo()
    return {
      online: true,
      provider: providerInfo.provider,
      providerName: providerInfo.providerName,
      architecture: 'node-gateway-python-compute'
    }
  })

  /**
   */
  fastify.get('/models', async () => {
    const localApiBase = process.env.LOCAL_LM_API || process.env.LLM_BASE_URL || 'http://localhost:1234/v1'

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(`${localApiBase}/models`, { signal: controller.signal })
      clearTimeout(timeout)

      if (response.ok) {
        const data = await response.json()
        return { provider: 'local', models: data.data || [] }
      }
    } catch {
            // 本地模型端点不可用，继续走兜底模型列表
    }

    return {
      provider: 'mimo',
      models: [
        { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', description: 'Fast response model' },
        { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', description: 'Higher quality model' }
      ]
    }
  })

  /**
   */
  /**
   * 兼容主路由 `/api/ai/chat`。
   * - sync：直接返回流式结果。
   * - async：先返回 job 状态，再渐进推送结果。
   */
  fastify.post('/chat', async (request, reply) => {
    const { messages = [], poiFeatures = [], options = {} } = request.body || {}
    const spatialContext = options.spatialContext || request.body?.spatialContext || {}

    if (!messages || messages.length === 0) {
      return reply.status(400).send({ error: 'messages is required' })
    }

    const sessionId = options.sessionId || `session_${Date.now()}`
    let session = ragSessions.get(sessionId)
    if (!session) {
      // 创建新 session 前检查容量，超限时淘汰最早的
      if (ragSessions.size >= RAG_SESSION_MAX) {
        const oldestKey = ragSessions.keys().next().value
        if (oldestKey !== undefined) ragSessions.delete(oldestKey)
      }
      session = createRAGSession()
      session.createdAt = Date.now()
      ragSessions.set(sessionId, session)
    }

    const userQuestion = extractLastUserMessage(messages)
    if (!userQuestion) {
      return reply.status(400).send({ error: 'No user message provided' })
    }

    session.setUserQuery(userQuestion)

    const providerInfo = await getActiveProviderInfo()
    const closeSSE = beginSSE(reply, providerInfo)

    // 统一分流规则，避免不同入口阈值不一致。
    const decision = decideExecutionMode({
      spatialContext,
      queryPlan: options.queryPlan || null,
      options,
      estimatedPoiCount: options.estimatedCandidates ?? poiFeatures.length
    })

    writeSSEEvent(reply, 'job', {
      mode: decision.mode,
      decision
    })

    let shouldCloseImmediately = true

    try {
      // =====================
      // =====================
      // 异步模式：入队 + 订阅事件流。
      if (decision.mode === 'async') {
        const enqueueResult = await enqueueSpatialJob({
          request_id: options.requestId || randomUUID(),
          query: userQuestion,
          messages,
          poiFeatures,
          spatialContext,
          options: {
            ...options,
            mode: 'async'
          }
        }, {
          attempts: options.attempts
        })

        writeSSEEvent(reply, 'job', {
          job_id: enqueueResult.jobId,
          mode: 'async',
          status: 'queued',
          decision
        })

        shouldCloseImmediately = false

        let streamedText = false

        const unsubscribe = subscribeJobEvents(enqueueResult.jobId, async (event) => {
          try {
            if (reply.raw.destroyed) {
              return
            }

          if (event.type === 'queued' || event.type === 'started') {
            writeSSEEvent(reply, 'stage', {
              name: event.payload?.stage || event.type
            })
            return
          }

          if (event.type === 'stage') {
            writeSSEEvent(reply, 'stage', {
              name: event.payload?.stage || 'processing',
              ...event.payload
            })
            return
          }

          if (event.type === 'progress') {
            writeSSEEvent(reply, 'progress', event.payload)
            return
          }

          if (event.type === 'partial') {
            if (event.payload?.text_chunk) {
              streamedText = true
              writeSSEText(reply, event.payload.text_chunk)
            } else {
              writeSSEEvent(reply, 'partial', event.payload)
            }
            return
          }

          if (event.type === 'completed') {
            const snapshot = await getJobSnapshot(enqueueResult.jobId)
            const result = snapshot?.result || event.payload?.result

            if (result?.answer && !streamedText) {
              writeSSEText(reply, result.answer)
            }

            const legacyPayload = toLegacySSEPayload(result)
            applyResultToSession(session, legacyPayload)

            writeSSEEvent(reply, 'refined_result', result)
            emitLegacyEvents(reply, legacyPayload)
            reply.raw.write('data: [DONE]\n\n')

            session.markSuccess?.()
            session.log?.('Pipeline', 'Completed', { mode: 'async', responseLength: result?.answer?.length || 0 })
            session.save?.()

            unsubscribe()
            closeSSE()
            return
          }

          if (event.type === 'failed') {
            writeSSEEvent(reply, 'error', { message: event.payload?.error || 'Job failed' })
            session.save?.()
            unsubscribe()
            closeSSE()
          }
          } catch (eventErr) {
            console.error('[AI Chat] async stream event failed:', eventErr)
            writeSSEEvent(reply, 'error', { message: eventErr.message })
            session.save?.()
            unsubscribe()
            closeSSE()
          }
        })

        request.raw.on('close', () => {
          unsubscribe()
          session.save?.()
          closeSSE()
        })

        return
      }

      // =====================
      // =====================
      // 同步模式：当次请求内直接执行完整链路。
      const result = await runNarrativeSpatialJob(
        {
          request_id: options.requestId || randomUUID(),
          query: userQuestion,
          messages,
          poiFeatures,
          spatialContext,
          options: {
            ...options,
            mode: 'sync'
          }
        },
        {
          reportStage: async (stage, payload = {}) => {
            writeSSEEvent(reply, 'stage', { name: stage, ...payload })
          },
          reportProgress: async (progress, payload = {}) => {
            writeSSEEvent(reply, 'progress', { progress, ...payload })
          },
          reportPartial: async (payload = {}) => {
            if (payload.text_chunk) {
              writeSSEText(reply, payload.text_chunk)
            } else {
              writeSSEEvent(reply, 'partial', payload)
            }
          },
          reportText: async (textChunk) => {
            writeSSEText(reply, textChunk)
          }
        }
      )

      const legacyPayload = toLegacySSEPayload(result)
      applyResultToSession(session, legacyPayload)

      writeSSEEvent(reply, 'refined_result', result)
      emitLegacyEvents(reply, legacyPayload)

      reply.raw.write('data: [DONE]\n\n')
      session.markSuccess?.()
      session.log?.('Pipeline', 'Completed', { mode: 'sync', responseLength: result?.answer?.length || 0 })
      session.save?.()
    } catch (err) {
      console.error('[AI Chat] pipeline failed:', err)
      writeSSEEvent(reply, 'error', { message: err.message })
      session.save?.()
    } finally {
      if (shouldCloseImmediately) {
        closeSSE()
      }
    }
  })

  /**
   */
  fastify.post('/plan', async (request, reply) => {
    const { question, context = {} } = request.body || {}
    if (!question) {
      return reply.status(400).send({ error: 'question is required' })
    }

    try {
      return await parseIntent(question, context)
    } catch (err) {
      return reply.status(500).send({ error: err.message })
    }
  })

  /**
   */
  fastify.post('/execute', async (request, reply) => {
    const { queryPlan, poiFeatures = [], options = {} } = request.body || {}
    if (!queryPlan) {
      return reply.status(400).send({ error: 'queryPlan is required' })
    }

    try {
      const spatialContext = options.spatialContext || options.context || {}
      return await executeSpatialPlanWithFallback({
        queryPlan,
        poiFeatures,
        spatialContext,
        options,
        requestId: request.body?.request_id
      })
    } catch (err) {
      return reply.status(500).send({ error: err.message })
    }
  })

  /**
   */
  fastify.post('/session/end', async (request) => {
    const { sessionId } = request.body || {}

    if (sessionId && ragSessions.has(sessionId)) {
      const session = ragSessions.get(sessionId)
      session.log?.('Session', 'Ended', { reason: 'user_clear' })
      session.save?.()
      ragSessions.delete(sessionId)
      return { success: true, message: 'Session closed' }
    }

    return { success: false, message: 'Session not found' }
  })

  /**
   */
  fastify.post('/search', async (request, reply) => {
    const { query, poiFeatures = [] } = request.body || {}

    if (!query) {
      return reply.status(400).send({ error: 'query is required' })
    }

    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (keywords.length === 0) {
      return { success: true, query, total: 0, results: [] }
    }

    // ֱһɹ+֣ filter+sort ظƴַ
    const scored = []
    for (let i = 0; i < poiFeatures.length; i++) {
      const props = poiFeatures[i].properties || {}
      const parts = []
      if (props.name) parts.push(props.name)
      if (props.category_big) parts.push(props.category_big)
      if (props.category_mid) parts.push(props.category_mid)
      if (props.category_small) parts.push(props.category_small)
      if (props.address) parts.push(props.address)
      const fullText = parts.join(' ').toLowerCase()

      let matchCount = 0
      for (let k = 0; k < keywords.length; k++) {
        if (fullText.includes(keywords[k])) matchCount++
      }
      if (matchCount > 0) {
        scored.push({ index: i, score: matchCount })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const results = scored.slice(0, 50).map((item) => poiFeatures[item.index])

    return {
      success: true,
      query,
      total: scored.length,
      results
    }
  })

  /**
   */
  fastify.get('/architecture', async () => {
    return {
      name: 'Node Gateway + Python Spatial Compute',
      version: '3.0.0',
      routes: {
        chat: '/api/ai/chat (compat bridge)',
        jobs: '/api/jobs/*'
      },
      stages: [
        { name: 'Planner', runtime: 'Node/LLM', mode: 'sync + async' },
        { name: 'Spatial Compute', runtime: 'Python gRPC', mode: 'sync + async queue' },
        { name: 'Writer', runtime: 'Node/LLM', mode: 'sync + async' }
      ],
      guarantees: [
        'No frontend style/layout changes required',
        'Legacy SSE events preserved',
        'Optional job/progress/refined_result events added'
      ]
    }
  })
}

export default aiRoutes
