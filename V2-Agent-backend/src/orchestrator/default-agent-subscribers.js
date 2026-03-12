import { AGENT_TOPICS, getSpecialistTopic } from './agent-event-hub.js'
import { KNOWN_SPECIALISTS } from './specialist-catalog.js'

export function registerDefaultAgentSubscribers({
  eventHub,
  intentRouterAgent,
  routeObjective,
  plannerAgent,
  executeBufferExportWorkflow,
  groundingAgent,
  parallelAgentExecutor,
  qualityGuardAgent,
  narrativeWriterAgent
} = {}) {
  if (!eventHub) {
    throw new Error('event_hub_required')
  }

  const unsubscribers = []

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.ROUTING_RESOLVE,
    ({ query, viewport, history }) => {
      if (typeof intentRouterAgent?.route === 'function') {
        return intentRouterAgent.route({ query, viewport, history })
      }
      return routeObjective({ query, viewport, history })
    },
    { agentId: 'intent-router-agent' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.LEGACY_PLAN_BUILD,
    ({ traceId, query, route, template, registry }) => plannerAgent.plan({
      traceId,
      query,
      route,
      template,
      registry
    }),
    { agentId: 'planner-agent' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.BUFFER_EXPORT_EXECUTE,
    ({ registry, logger, artifactsDir, viewport, traceId, poiRepository }) => executeBufferExportWorkflow({
      registry,
      logger,
      artifactsDir,
      viewport,
      traceId,
      poiRepository
    }),
    { agentId: 'buffer-coverage-agent' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.GROUNDING_RUN,
    ({ objectiveContract }) => groundingAgent.ground({ objectiveContract }),
    { agentId: 'data-grounding-agent' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.SPECIALISTS_RUN,
    ({ specialistTasks }) => parallelAgentExecutor.runSpecialists(specialistTasks),
    { agentId: 'specialist-executor-agent' }
  ))

  const specialistIds = typeof parallelAgentExecutor?.listKnownSpecialists === 'function'
    ? parallelAgentExecutor.listKnownSpecialists()
    : [...KNOWN_SPECIALISTS]
  for (const specialistId of specialistIds) {
    unsubscribers.push(eventHub.subscribe(
      getSpecialistTopic(specialistId),
      async ({ specialistTask }) => {
        if (typeof parallelAgentExecutor?.runSpecialist === 'function') {
          return parallelAgentExecutor.runSpecialist(specialistTask)
        }

        const results = await parallelAgentExecutor.runSpecialists([specialistTask])
        return results[0]
      },
      { agentId: `specialist-agent.${specialistId}` }
    ))
  }

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.QUALITY_DECIDE,
    ({
      query = '',
      objectiveContract,
      groundingResult,
      specialistResults = [],
      artifact = null
    }) => qualityGuardAgent.decide({
      query,
      objectiveContract,
      groundingResult,
      specialistResults,
      artifact
    }),
    { agentId: 'quality-guard-agent' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.QUALITY_REVIEW_DRAFT,
    ({
      query = '',
      objectiveContract,
      groundingResult,
      specialistResults = [],
      qualityDecision,
      draftAnswer = null
    }) => {
      if (typeof qualityGuardAgent?.reviewDraft === 'function') {
        return qualityGuardAgent.reviewDraft({
          query,
          objectiveContract,
          groundingResult,
          specialistResults,
          qualityDecision,
          draftAnswer
        })
      }

      return {
        qualityDecision,
        should_refine: false,
        rewrite_guidance: '',
        review_confidence: null,
        review_reason: ''
      }
    },
    { agentId: 'quality-guard-agent.review' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.NARRATIVE_FAST,
    ({ query = '', objectiveContract, groundingResult, specialistResults, qualityDecision }) => {
      return narrativeWriterAgent.composeFastNarrativeWithLlm({
        query,
        objectiveContract,
        groundingResult,
        specialistResults,
        qualityDecision
      })
    },
    { agentId: 'narrative-writer-agent.fast' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.NARRATIVE_REFINE,
    ({
      query = '',
      objectiveContract,
      groundingResult,
      specialistResults,
      qualityDecision,
      currentAnswer = null,
      reviewFeedback = ''
    }) => {
      return narrativeWriterAgent.refineFastNarrativeWithLlm({
        query,
        objectiveContract,
        groundingResult,
        specialistResults,
        qualityDecision,
        currentAnswer,
        reviewFeedback
      })
    },
    { agentId: 'narrative-writer-agent.refine' }
  ))

  unsubscribers.push(eventHub.subscribe(
    AGENT_TOPICS.NARRATIVE_DEEP,
    ({ query = '', objectiveContract, groundingResult, specialistResults, qualityDecision }) => {
      return narrativeWriterAgent.composeDeepNarrativeWithLlm({
        query,
        objectiveContract,
        groundingResult,
        specialistResults,
        qualityDecision
      })
    },
    { agentId: 'narrative-writer-agent.deep' }
  ))

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}
