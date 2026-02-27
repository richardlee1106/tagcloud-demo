/**
 */
import { randomUUID } from 'crypto'

import { createRAGSession } from '../../services/ragLogger.js'
import { getActiveProviderInfo } from '../../services/llm.js'
import {
  enqueueSpatialJob,
  subscribeJobEvents,
  getJobSnapshot,
  buildQueueFailurePayload
} from '../../services/queue.js'
import {
  extractLastUserMessage,
  decideExecutionMode,
  executeSpatialPlanWithFallback,
  runNarrativeSpatialJob,
  toLegacySSEPayload
} from '../../services/spatialJobRunner.js'
import telemetry from '../../services/telemetry.js'
import { buildFailureDiagnostics } from '../../services/errorDiagnostics.js'
import { parseIntent } from './planner.js'
import templateFeedbackRoutes from './templateFeedback.js'
import { validateSSEEventPayload } from '../../../shared/sseEventSchema.js'

const SSE_SCHEMA_VERSION = 'v1.1'
const SSE_CAPABILITIES = Object.freeze([
  'intent_meta',
  'template_learning',
  'l2_cache'
])

const ragSessions = new Map()
const RAG_SESSION_MAX = parseInt(process.env.RAG_SESSION_MAX || '200', 10)

const ragSessionGcTimer = setInterval(() => {
  const now = Date.now()
  const maxAge = 30 * 60 * 1000

  for (const [id, session] of ragSessions.entries()) {
    if (now - session.createdAt > maxAge) {
      ragSessions.delete(id)
    }
  }

  if (ragSessions.size > RAG_SESSION_MAX) {
    const overflow = ragSessions.size - RAG_SESSION_MAX
    const iterator = ragSessions.keys()
    for (let i = 0; i < overflow; i++) {
      const oldestKey = iterator.next().value
      if (oldestKey !== undefined) ragSessions.delete(oldestKey)
    }
    console.warn(`[AI Routes] ragSessions overflow pruned ${overflow}, current size ${ragSessions.size}`)
  }
}, 5 * 60 * 1000)
if (typeof ragSessionGcTimer.unref === 'function') {
  ragSessionGcTimer.unref()
}

/**
 */
/**
 */
function attachSSEMeta(payload, meta = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  return {
    ...payload,
    trace_id: meta.traceId || payload.trace_id || undefined,
    schema_version: meta.schemaVersion || payload.schema_version || SSE_SCHEMA_VERSION,
    capabilities: Array.isArray(meta.capabilities) ? meta.capabilities : payload.capabilities || SSE_CAPABILITIES
  }
}

function writeSSEEvent(reply, eventName, payload, meta = {}) {
  if (reply.raw.destroyed) return
  const payloadWithMeta = attachSSEMeta(payload, meta)
  telemetry.incrementCounter('sse_event_total', { event: String(eventName || 'unknown') })
  telemetry.recordKpiEvent('sse_event', 1, { event: String(eventName || 'unknown') })

  const validation = validateSSEEventPayload(eventName, payloadWithMeta)
  if (!validation.ok) {
    telemetry.incrementCounter('sse_event_error_total', { event: String(eventName || 'unknown'), reason: 'schema' })
    telemetry.recordKpiEvent('sse_event_error', 1, {
      event: String(eventName || 'unknown'),
      reason: 'schema',
      trace_id: meta.traceId || ''
    })
    telemetry.recordKpiEvent('sse_schema_error', 1, {
      event: String(eventName || 'unknown'),
      trace_id: meta.traceId || ''
    })
    console.warn('[AI Routes] SSE schema mismatch', {
      event: eventName,
      errors: validation.errors.slice(0, 5)
    })
    if (eventName !== 'schema_error') {
      const schemaErrorPayload = {
        event: String(eventName || 'unknown'),
        errors: validation.errors,
        trace_id: meta.traceId || undefined,
        schema_version: meta.schemaVersion || SSE_SCHEMA_VERSION,
        capabilities: Array.isArray(meta.capabilities) ? meta.capabilities : SSE_CAPABILITIES
      }
      reply.raw.write('event: schema_error\n')
      reply.raw.write(`data: ${JSON.stringify(schemaErrorPayload)}\n\n`)
    }
    return
  }
  reply.raw.write(`event: ${eventName}\n`)
  reply.raw.write(`data: ${JSON.stringify(payloadWithMeta)}\n\n`)
}

/**
 */
/**
 */
function writeSSEText(reply, content) {
  if (reply.raw.destroyed) return
  reply.raw.write(`data: ${JSON.stringify({ content })}\n\n`)
}

/**
 */
/**
 */
function summarizeForRagLog(value, maxLength = 800) {
  if (value == null) return value
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
  }
  if (typeof value !== 'object') return value

  try {
    const serialized = JSON.stringify(value)
    if (serialized.length <= maxLength) return value
    return { preview: `${serialized.slice(0, maxLength)}...` }
  } catch {
    return { preview: '[unserializable]' }
  }
}

function normalizeStageName(stage) {
  const normalized = String(stage || '').trim()
  return normalized || null
}

function pushStagePath(stagePath, stageName) {
  const normalized = normalizeStageName(stageName)
  if (!normalized) return
  stagePath.push(normalized)
  if (stagePath.length > 120) {
    stagePath.splice(0, stagePath.length - 120)
  }
}

function toDiagnosticError(errorLike, fallbackMessage = 'Job failed') {
  if (errorLike instanceof Error) return errorLike
  const failurePayload = buildQueueFailurePayload(errorLike)
  const error = new Error(failurePayload.error || fallbackMessage)
  if (failurePayload.error_code) error.code = String(failurePayload.error_code)
  if (failurePayload.diagnostics && typeof failurePayload.diagnostics === 'object') {
    error.diagnostics = failurePayload.diagnostics
  }
  return error
}

export function recordPipelineFailure(session, mode, errorMessage, failureDiagnostics) {
  session.log?.('Pipeline', 'Failed', {
    mode,
    error: errorMessage,
    error_code: failureDiagnostics?.error_code || null,
    error_signature: failureDiagnostics?.error_signature || null
  })
  session.log?.('Pipeline', 'FailureDiagnostics', failureDiagnostics || {})
}

function buildSseErrorPayload(errorMessage, failureDiagnostics) {
  return {
    message: String(errorMessage || 'Pipeline failed'),
    error_code: failureDiagnostics?.error_code || null,
    error_signature: failureDiagnostics?.error_signature || null,
    failure_diagnostics: failureDiagnostics || null
  }
}

function logSessionStage(session, stage, payload = {}) {
  if (!session?.log) return
  session.log('Pipeline', 'Stage', {
    stage: String(stage || ''),
    payload: summarizeForRagLog(payload)
  })
}

function applyResultToSession(session, legacyPayload, fullResult = null) {
  if (!session || !legacyPayload) {
    return
  }

  if (fullResult?.query_plan) {
    session.setIntent?.(fullResult.query_plan)
  }

  if (fullResult?.diagnostics) {
    session.log?.('Pipeline', 'Diagnostics', summarizeForRagLog(fullResult.diagnostics))
  }

  if (typeof fullResult?.answer === 'string') {
    session.log?.('Writer', 'AnswerSummary', {
      chars: fullResult.answer.length
    })
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
 */
function emitLegacyEvents(reply, legacyPayload, sseMeta = {}) {
  if (legacyPayload.pois?.length) {
    writeSSEEvent(reply, 'pois', legacyPayload.pois, sseMeta)
  }

  if (legacyPayload.boundary) {
    writeSSEEvent(reply, 'boundary', legacyPayload.boundary, sseMeta)
  }

  if (legacyPayload.spatial_clusters?.hotspots?.length) {
    writeSSEEvent(reply, 'spatial_clusters', legacyPayload.spatial_clusters, sseMeta)
  }

  if (legacyPayload.vernacular_regions?.length) {
    writeSSEEvent(reply, 'vernacular_regions', legacyPayload.vernacular_regions, sseMeta)
  }

  if (legacyPayload.fuzzy_regions?.length) {
    writeSSEEvent(reply, 'fuzzy_regions', legacyPayload.fuzzy_regions, sseMeta)
  }

  if (legacyPayload.stats && typeof legacyPayload.stats === 'object') {
    writeSSEEvent(reply, 'stats', legacyPayload.stats, sseMeta)
  }
}

/**
 */
/**
 */
function beginSSE(reply, providerInfo = {}, traceId = '') {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-AI-Provider': providerInfo.provider || 'unknown',
    'X-AI-Provider-Name': providerInfo.providerName || 'Unknown Provider',
    'X-Trace-Id': traceId,
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
 */
async function aiRoutes(fastify) {
  await fastify.register(templateFeedbackRoutes)

  /**
   */
  fastify.get('/status', async () => {
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
   */
  fastify.post('/chat', async (request, reply) => {
    const { messages = [], poiFeatures = [], options = {} } = request.body || {}
    const spatialContext = options.spatialContext || request.body?.spatialContext || {}
    const requestId = options.requestId || options.request_id || randomUUID()
    const traceId = requestId
    const sseMeta = {
      traceId,
      schemaVersion: SSE_SCHEMA_VERSION,
      capabilities: SSE_CAPABILITIES
    }
    const requestStartedAt = Date.now()
    let firstTokenAt = null
    const stagePath = []
    let inferredQueryType = String(options?.queryPlan?.query_type || options?.query_type || '').trim() || ''

    if (!messages || messages.length === 0) {
      return reply.status(400).send({ error: 'messages is required' })
    }

    const sessionId = options.sessionId || `session_${Date.now()}`
    let session = ragSessions.get(sessionId)
    if (!session) {
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
    session.log?.('Session', 'RequestMeta', {
      trace_id: traceId,
      poi_count: Array.isArray(poiFeatures) ? poiFeatures.length : 0
    })

    const providerInfo = await getActiveProviderInfo()
    const closeSSE = beginSSE(reply, providerInfo, traceId)

    telemetry.incrementCounter('ai_chat_requests_total', { mode: 'incoming' })
    telemetry.logStructured('info', 'ai_chat_start', {
      trace_id: traceId,
      session_id: sessionId,
      user_question: userQuestion,
      poi_count: Array.isArray(poiFeatures) ? poiFeatures.length : 0
    })
    if (options.clientMetrics && typeof options.clientMetrics === 'object') {
      telemetry.logStructured('info', 'ai_chat_client_metrics', {
        trace_id: traceId,
        client_metrics: options.clientMetrics
      })
      session.log?.('Client', 'Metrics', summarizeForRagLog(options.clientMetrics))
    }

    const decision = decideExecutionMode({
      spatialContext,
      queryPlan: options.queryPlan || null,
      options,
      estimatedPoiCount: options.estimatedCandidates ?? poiFeatures.length
    })
    telemetry.incrementCounter('ai_chat_mode_total', { mode: decision.mode })
    session.log?.('Pipeline', 'ModeDecision', summarizeForRagLog(decision))

    writeSSEEvent(reply, 'job', {
      mode: decision.mode,
      decision
    }, sseMeta)

    let shouldCloseImmediately = true

    const writeTextChunk = (textChunk) => {
      if (!firstTokenAt) {
        firstTokenAt = Date.now()
        const firstTokenLatency = firstTokenAt - requestStartedAt
        telemetry.observeHistogram('first_token_latency_ms', firstTokenLatency, { mode: decision.mode })
        telemetry.recordKpiEvent('first_token_latency_ms', firstTokenLatency, {
          mode: decision.mode,
          trace_id: traceId
        })
      }
      writeSSEText(reply, textChunk)
    }

    try {
      // =====================
      // =====================
      if (decision.mode === 'async') {
        const enqueueResult = await enqueueSpatialJob({
          request_id: requestId,
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
        }, sseMeta)

        shouldCloseImmediately = false

        let streamedText = false
        let asyncTextChars = 0

        const unsubscribe = subscribeJobEvents(enqueueResult.jobId, async (event) => {
          try {
            if (reply.raw.destroyed) {
              return
            }

          if (event.type === 'queued' || event.type === 'started') {
            pushStagePath(stagePath, event.payload?.stage || event.type)
            logSessionStage(session, event.payload?.stage || event.type, event.payload || {})
            writeSSEEvent(reply, 'stage', {
              name: event.payload?.stage || event.type
            }, sseMeta)
            return
          }

          if (event.type === 'stage') {
            pushStagePath(stagePath, event.payload?.stage || 'processing')
            logSessionStage(session, event.payload?.stage || 'processing', event.payload || {})
            writeSSEEvent(reply, 'stage', {
              name: event.payload?.stage || 'processing',
              ...event.payload
            }, sseMeta)
            return
          }

          if (event.type === 'progress') {
            if (event.payload?.query_type) {
              inferredQueryType = String(event.payload.query_type)
            }
            writeSSEEvent(reply, 'progress', event.payload, sseMeta)
            return
          }

          if (event.type === 'partial') {
            if (event.payload?.text_chunk) {
              streamedText = true
              asyncTextChars += String(event.payload.text_chunk || '').length
              writeTextChunk(event.payload.text_chunk)
            } else {
              writeSSEEvent(reply, 'partial', event.payload, sseMeta)
            }
            return
          }

          if (event.type === 'completed') {
            const snapshot = await getJobSnapshot(enqueueResult.jobId)
            const result = snapshot?.result || event.payload?.result

            if (result?.query_plan?.query_type) {
              inferredQueryType = String(result.query_plan.query_type)
            }

            if (result?.answer && !streamedText) {
              asyncTextChars += String(result.answer || '').length
              writeTextChunk(result.answer)
            }

            const legacyPayload = toLegacySSEPayload(result)
            applyResultToSession(session, legacyPayload, result)
            session.log?.('Writer', 'StreamSummary', { chars: asyncTextChars, mode: 'async' })

            writeSSEEvent(reply, 'refined_result', result, sseMeta)
            emitLegacyEvents(reply, legacyPayload, sseMeta)
            reply.raw.write('data: [DONE]\n\n')

            const endToEndLatency = Date.now() - requestStartedAt
            telemetry.observeHistogram('end_to_end_latency_ms', endToEndLatency, { mode: 'async' })
            telemetry.recordKpiEvent('end_to_end_latency_ms', endToEndLatency, {
              mode: 'async',
              trace_id: traceId
            })
            telemetry.logStructured('info', 'ai_chat_complete', {
              trace_id: traceId,
              mode: 'async',
              end_to_end_latency_ms: endToEndLatency,
              response_length: result?.answer?.length || 0
            })

            session.markSuccess?.()
            session.log?.('Pipeline', 'Completed', { mode: 'async', responseLength: result?.answer?.length || 0 })
            session.save?.()

            unsubscribe()
            closeSSE()
            return
          }

          if (event.type === 'failed') {
            const asyncError = toDiagnosticError(event.payload, 'Job failed')
            const failureDiagnostics = buildFailureDiagnostics({
              error: asyncError,
              traceId,
              sessionId,
              mode: 'async',
              queryType: inferredQueryType,
              stagePath,
              spatialContext,
              options,
              grpcContext: asyncError?.grpc_context,
              pythonContext: asyncError?.diagnostics?.python_context || asyncError?.python_context,
              stackPreview: asyncError?.stack
            })

            recordPipelineFailure(session, 'async', asyncError.message, failureDiagnostics)
            writeSSEEvent(reply, 'error', buildSseErrorPayload(asyncError.message, failureDiagnostics), sseMeta)
            telemetry.incrementCounter('ai_chat_failures_total', { mode: 'async', reason: 'job_failed' })
            telemetry.recordKpiEvent('sse_event_error', 1, {
              mode: 'async',
              reason: 'job_failed',
              trace_id: traceId
            })
            const failedLatency = Date.now() - requestStartedAt
            telemetry.observeHistogram('end_to_end_latency_ms', failedLatency, { mode: 'async', status: 'failed' })
            telemetry.recordKpiEvent('end_to_end_latency_ms', failedLatency, {
              mode: 'async',
              status: 'failed',
              trace_id: traceId
            })
            telemetry.logStructured('error', 'ai_chat_failed', {
              trace_id: traceId,
              mode: 'async',
              error: asyncError.message,
              error_code: failureDiagnostics.error_code,
              error_signature: failureDiagnostics.error_signature,
              query_type: failureDiagnostics.query_type,
              last_stage: failureDiagnostics.last_stage
            })
            session.save?.()
            unsubscribe()
            closeSSE()
          }
          } catch (eventErr) {
            console.error('[AI Chat] async stream event failed:', eventErr)
            const wrappedEventError = toDiagnosticError(eventErr, 'Async stream event failed')
            const failureDiagnostics = buildFailureDiagnostics({
              error: wrappedEventError,
              traceId,
              sessionId,
              mode: 'async',
              queryType: inferredQueryType,
              stagePath,
              spatialContext,
              options,
              grpcContext: wrappedEventError?.grpc_context,
              pythonContext: wrappedEventError?.diagnostics?.python_context || wrappedEventError?.python_context,
              stackPreview: wrappedEventError?.stack
            })

            recordPipelineFailure(session, 'async', wrappedEventError.message, failureDiagnostics)
            writeSSEEvent(reply, 'error', buildSseErrorPayload(wrappedEventError.message, failureDiagnostics), sseMeta)
            telemetry.incrementCounter('ai_chat_failures_total', { mode: 'async', reason: 'event_exception' })
            telemetry.recordKpiEvent('sse_event_error', 1, {
              mode: 'async',
              reason: 'event_exception',
              trace_id: traceId
            })
            const failedLatency = Date.now() - requestStartedAt
            telemetry.observeHistogram('end_to_end_latency_ms', failedLatency, { mode: 'async', status: 'failed' })
            telemetry.recordKpiEvent('end_to_end_latency_ms', failedLatency, {
              mode: 'async',
              status: 'failed',
              trace_id: traceId
            })
            telemetry.logStructured('error', 'ai_chat_stream_event_exception', {
              trace_id: traceId,
              mode: 'async',
              error: wrappedEventError.message,
              error_code: failureDiagnostics.error_code,
              error_signature: failureDiagnostics.error_signature
            })
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
      let syncTextChars = 0
      let syncFirstTextLogged = false
      const result = await runNarrativeSpatialJob(
        {
          request_id: requestId,
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
            pushStagePath(stagePath, stage)
            logSessionStage(session, stage, payload)
            writeSSEEvent(reply, 'stage', { name: stage, ...payload }, sseMeta)
          },
          reportProgress: async (progress, payload = {}) => {
            if (payload?.query_type) {
              inferredQueryType = String(payload.query_type)
            }
            if (payload?.stage) {
              session.log?.('Pipeline', 'Progress', {
                progress,
                stage: payload.stage
              })
            }
            writeSSEEvent(reply, 'progress', { progress, ...payload }, sseMeta)
          },
          reportPartial: async (payload = {}) => {
            if (payload.text_chunk) {
              syncTextChars += String(payload.text_chunk || '').length
              writeTextChunk(payload.text_chunk)
            } else {
              writeSSEEvent(reply, 'partial', payload, sseMeta)
            }
          },
          reportText: async (textChunk) => {
            const chunkLength = String(textChunk || '').length
            syncTextChars += chunkLength
            if (!syncFirstTextLogged && chunkLength > 0) {
              session.log?.('Writer', 'FirstTextChunk', { chars: chunkLength, mode: 'sync' })
              syncFirstTextLogged = true
            }
            writeTextChunk(textChunk)
          }
        }
      )

      if (result?.query_plan?.query_type) {
        inferredQueryType = String(result.query_plan.query_type)
      }

      const legacyPayload = toLegacySSEPayload(result)
      applyResultToSession(session, legacyPayload, result)
      session.log?.('Writer', 'StreamSummary', { chars: syncTextChars, mode: 'sync' })

      writeSSEEvent(reply, 'refined_result', result, sseMeta)
      emitLegacyEvents(reply, legacyPayload, sseMeta)

      reply.raw.write('data: [DONE]\n\n')
      const endToEndLatency = Date.now() - requestStartedAt
      telemetry.observeHistogram('end_to_end_latency_ms', endToEndLatency, { mode: 'sync' })
      telemetry.recordKpiEvent('end_to_end_latency_ms', endToEndLatency, {
        mode: 'sync',
        trace_id: traceId
      })
      telemetry.logStructured('info', 'ai_chat_complete', {
        trace_id: traceId,
        mode: 'sync',
        end_to_end_latency_ms: endToEndLatency,
        response_length: result?.answer?.length || 0
      })
      session.markSuccess?.()
      session.log?.('Pipeline', 'Completed', { mode: 'sync', responseLength: result?.answer?.length || 0 })
      session.save?.()
    } catch (err) {
      console.error('[AI Chat] pipeline failed:', err)
      const syncError = toDiagnosticError(err, 'Pipeline failed')
      const failureDiagnostics = buildFailureDiagnostics({
        error: syncError,
        traceId,
        sessionId,
        mode: decision.mode,
        queryType: inferredQueryType,
        stagePath,
        spatialContext,
        options,
        grpcContext: syncError?.grpc_context,
        pythonContext: syncError?.diagnostics?.python_context || syncError?.python_context,
        stackPreview: syncError?.stack
      })

      recordPipelineFailure(session, decision.mode, syncError.message, failureDiagnostics)
      writeSSEEvent(reply, 'error', buildSseErrorPayload(syncError.message, failureDiagnostics), sseMeta)
      telemetry.incrementCounter('ai_chat_failures_total', { mode: decision.mode, reason: 'pipeline_error' })
      telemetry.recordKpiEvent('sse_event_error', 1, {
        mode: decision.mode,
        reason: 'pipeline_error',
        trace_id: traceId
      })
      const failedLatency = Date.now() - requestStartedAt
      telemetry.observeHistogram('end_to_end_latency_ms', failedLatency, { mode: decision.mode, status: 'failed' })
      telemetry.recordKpiEvent('end_to_end_latency_ms', failedLatency, {
        mode: decision.mode,
        status: 'failed',
        trace_id: traceId
      })
      telemetry.logStructured('error', 'ai_chat_failed', {
        trace_id: traceId,
        mode: decision.mode,
        error: syncError.message,
        error_code: failureDiagnostics.error_code,
        error_signature: failureDiagnostics.error_signature,
        query_type: failureDiagnostics.query_type,
        last_stage: failureDiagnostics.last_stage
      })
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
