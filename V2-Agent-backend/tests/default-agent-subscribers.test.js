import test from 'node:test'
import assert from 'node:assert/strict'

import { AGENT_TOPICS, createAgentEventHub, getSpecialistTopic } from '../src/orchestrator/agent-event-hub.js'
import { registerDefaultAgentSubscribers } from '../src/orchestrator/default-agent-subscribers.js'

test('registers default agent subscribers and dispatches to each agent', async () => {
  const hub = createAgentEventHub()
  const calls = []

  const unsubscribe = registerDefaultAgentSubscribers({
    eventHub: hub,
    intentRouterAgent: {
      async route({ query }) {
        calls.push(`route:${query}`)
        return { objective: 'area_briefing' }
      }
    },
    routeObjective() {
      throw new Error('should_not_hit_routeObjective_fallback')
    },
    plannerAgent: {
      async plan({ query }) {
        calls.push(`plan:${query}`)
        return { pipeline: [{ op: 'summarize', args: {} }] }
      }
    },
    executeBufferExportWorkflow: async ({ traceId }) => {
      calls.push(`buffer:${traceId}`)
      return { output: { features: [] }, artifact: null, diagnostics: { duration_ms: 1 } }
    },
    groundingAgent: {
      async ground() {
        calls.push('ground')
        return { coverage: { status: 'sufficient' } }
      }
    },
    parallelAgentExecutor: {
      listKnownSpecialists() {
        return ['hotspots']
      },
      async runSpecialist({ specialist_id: specialistId }) {
        calls.push(`specialist:${specialistId}`)
        return { section_type: specialistId }
      },
      async runSpecialists() {
        calls.push('specialists')
        return []
      }
    },
    qualityGuardAgent: {
      async decide() {
        calls.push('quality')
        return { decision: 'pass', allowed_output: { can_emit_deep: true } }
      },
      async reviewDraft() {
        calls.push('quality_review')
        return { qualityDecision: { decision: 'pass', allowed_output: { can_emit_deep: true } }, should_refine: false }
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm() {
        calls.push('narrative_fast')
        return { answer: { text: 'fast' }, evidence: [], warnings: [], narrative_meta: { mode: 'deterministic' } }
      },
      async refineFastNarrativeWithLlm() {
        calls.push('narrative_refine')
        return { answer: { text: 'refined' }, evidence: [], warnings: [], narrative_meta: { mode: 'llm_refine' } }
      },
      async composeDeepNarrativeWithLlm() {
        calls.push('narrative_deep')
        return { answer: { text: 'deep' }, evidence: [], warnings: [] }
      }
    }
  })

  await hub.request(AGENT_TOPICS.ROUTING_RESOLVE, { query: 'q1', viewport: {}, history: [] })
  await hub.request(AGENT_TOPICS.LEGACY_PLAN_BUILD, { query: 'q2', route: {}, template: {}, traceId: 't1', registry: null })
  await hub.request(AGENT_TOPICS.BUFFER_EXPORT_EXECUTE, { traceId: 't2', registry: {}, logger: null, artifactsDir: process.cwd(), viewport: {}, poiRepository: null })
  await hub.request(AGENT_TOPICS.GROUNDING_RUN, { objectiveContract: {} })
  await hub.request(AGENT_TOPICS.SPECIALISTS_RUN, { specialistTasks: [] })
  await hub.request(getSpecialistTopic('hotspots'), { specialistTask: { specialist_id: 'hotspots' } })
  await hub.request(AGENT_TOPICS.QUALITY_DECIDE, { query: 'q3', objectiveContract: {}, groundingResult: {}, specialistResults: [] })
  await hub.request(AGENT_TOPICS.QUALITY_REVIEW_DRAFT, { query: 'q3b', objectiveContract: {}, groundingResult: {}, specialistResults: [], qualityDecision: {}, draftAnswer: { text: 'draft' } })
  await hub.request(AGENT_TOPICS.NARRATIVE_FAST, { query: 'q4', objectiveContract: {}, groundingResult: {}, specialistResults: [], qualityDecision: {} })
  await hub.request(AGENT_TOPICS.NARRATIVE_REFINE, { query: 'q4b', objectiveContract: {}, groundingResult: {}, specialistResults: [], qualityDecision: {}, currentAnswer: { text: 'draft' }, reviewFeedback: 'be sharper' })
  await hub.request(AGENT_TOPICS.NARRATIVE_DEEP, { query: 'q5', objectiveContract: {}, groundingResult: {}, specialistResults: [], qualityDecision: {} })

  assert.deepEqual(calls, [
    'route:q1',
    'plan:q2',
    'buffer:t2',
    'ground',
    'specialists',
    'specialist:hotspots',
    'quality',
    'quality_review',
    'narrative_fast',
    'narrative_refine',
    'narrative_deep'
  ])

  const subscribers = hub.listSubscribers()
  assert.equal(subscribers.length, 11)

  unsubscribe()
  assert.equal(hub.listSubscribers().length, 0)
})
