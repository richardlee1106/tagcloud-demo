import { EventEmitter } from 'node:events'

export const AGENT_TOPICS = Object.freeze({
  ROUTING_RESOLVE: 'agent.routing.resolve',
  LEGACY_PLAN_BUILD: 'agent.legacy.plan.build',
  BUFFER_EXPORT_EXECUTE: 'agent.buffer_export.execute',
  GROUNDING_RUN: 'agent.grounding.run',
  SPECIALISTS_RUN: 'agent.specialists.run',
  QUALITY_DECIDE: 'agent.quality.decide',
  QUALITY_REVIEW_DRAFT: 'agent.quality.review_draft',
  NARRATIVE_FAST: 'agent.narrative.fast',
  NARRATIVE_REFINE: 'agent.narrative.refine',
  NARRATIVE_DEEP: 'agent.narrative.deep'
})

export const SPECIALIST_TOPIC_PREFIX = 'agent.specialist.'

export function getSpecialistTopic(specialistId = '') {
  const normalizedId = String(specialistId || '').trim()
  if (!normalizedId) {
    throw new Error('invalid_specialist_topic')
  }

  return `${SPECIALIST_TOPIC_PREFIX}${normalizedId}`
}

export function createAgentEventHub() {
  const eventBus = new EventEmitter()
  const handlersByTopic = new Map()

  function subscribe(topic, handler, { agentId = 'unknown-agent' } = {}) {
    if (typeof topic !== 'string' || !topic.trim()) {
      throw new Error('invalid_event_topic')
    }

    if (typeof handler !== 'function') {
      throw new Error(`invalid_event_handler:${topic}`)
    }

    const normalizedTopic = topic.trim()
    const handlers = handlersByTopic.get(normalizedTopic) ?? []
    handlers.push({
      topic: normalizedTopic,
      agentId,
      handler
    })
    handlersByTopic.set(normalizedTopic, handlers)

    return () => {
      const current = handlersByTopic.get(normalizedTopic) ?? []
      const filtered = current.filter((entry) => entry.handler !== handler)
      if (filtered.length > 0) {
        handlersByTopic.set(normalizedTopic, filtered)
      } else {
        handlersByTopic.delete(normalizedTopic)
      }
    }
  }

  async function request(topic, payload = {}) {
    const handlers = handlersByTopic.get(topic) ?? []
    if (handlers.length === 0) {
      throw new Error(`event_handler_missing:${topic}`)
    }

    if (handlers.length > 1) {
      throw new Error(`event_handler_ambiguous:${topic}`)
    }

    const activeHandler = handlers[0]
    const startedAt = Date.now()

    eventBus.emit('agent.request.start', {
      topic,
      agent_id: activeHandler.agentId,
      started_at: startedAt
    })

    try {
      const result = await activeHandler.handler(payload)
      eventBus.emit('agent.request.done', {
        topic,
        agent_id: activeHandler.agentId,
        duration_ms: Date.now() - startedAt
      })
      return result
    } catch (error) {
      eventBus.emit('agent.request.error', {
        topic,
        agent_id: activeHandler.agentId,
        duration_ms: Date.now() - startedAt,
        error_message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  function listSubscribers() {
    const entries = []
    for (const [topic, handlers] of handlersByTopic.entries()) {
      for (const handler of handlers) {
        entries.push({
          topic,
          agent_id: handler.agentId
        })
      }
    }
    return entries
  }

  return {
    events: eventBus,
    subscribe,
    request,
    listSubscribers
  }
}
