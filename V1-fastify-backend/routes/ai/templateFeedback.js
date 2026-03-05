import {
  insertTemplateFeedbackEvent
} from '../../services/database.js'
import telemetry from '../../services/telemetry.js'
import {
  loadTemplateWeights,
  getCachedTemplateWeights
} from '../../services/templateLearning.js'

const ALLOWED_EVENT_TYPES = new Set([
  'template_impression',
  'template_click',
  'locate_click',
  'followup_click',
  'session_outcome'
])

function normalizeEventPayload(body = {}) {
  const traceId = String(body.trace_id || body.traceId || '').trim()
  const eventType = String(body.event_type || body.eventType || '').trim()
  const templateId = body.template_id || body.templateId || null
  const intentMeta = body.intent_meta || body.intentMeta || null
  const ts = body.ts || Date.now()
  const extra = body.extra || body.clientMetrics || null

  return {
    trace_id: traceId,
    event_type: eventType,
    template_id: templateId,
    intent_meta: intentMeta,
    ts,
    extra
  }
}

async function templateFeedbackRoutes(fastify) {
  fastify.post('/template-feedback', async (request, reply) => {
    const payload = normalizeEventPayload(request.body || {})
    if (!payload.trace_id || !payload.event_type) {
      return reply.status(400).send({
        ok: false,
        error: 'trace_id and event_type are required'
      })
    }

    if (!ALLOWED_EVENT_TYPES.has(payload.event_type)) {
      return reply.status(400).send({
        ok: false,
        error: `unsupported event_type: ${payload.event_type}`
      })
    }

    try {
      await insertTemplateFeedbackEvent(payload)
      telemetry.incrementCounter('template_feedback_events_total', {
        event_type: payload.event_type,
        template_id: payload.template_id || 'none'
      })
      telemetry.recordKpiEvent(payload.event_type, 1, {
        trace_id: payload.trace_id,
        template_id: payload.template_id || 'none',
        query_type: payload.intent_meta?.queryType || payload.intent_meta?.query_type || 'unknown'
      }, Number(payload.ts || Date.now()))

      return { ok: true }
    } catch (error) {
      telemetry.incrementCounter('template_feedback_errors_total', {
        event_type: payload.event_type || 'unknown'
      })
      telemetry.logStructured('error', 'template_feedback_write_failed', {
        trace_id: payload.trace_id,
        event_type: payload.event_type,
        error: error.message
      })
      return reply.status(500).send({
        ok: false,
        error: error.message
      })
    }
  })

  fastify.get('/template-feedback/weights', async () => {
    await loadTemplateWeights({ force: false })
    const snapshot = getCachedTemplateWeights()

    return {
      ok: true,
      version: snapshot.version,
      loaded_at: snapshot.loadedAt,
      weights: snapshot.weights
    }
  })
}

export default templateFeedbackRoutes
