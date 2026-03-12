import { createLlmGateway, resolveLlmEnabled, toBoolean } from '../llm/llm-gateway.js'

const OBJECTIVES = [
  'area_briefing',
  'compare_analysis',
  'hotspot_analysis',
  'opportunity_discovery',
  'coverage_gap_analysis',
  'buffer_export_workflow',
  'legacy_fallback'
]

const SPECIALISTS = [
  'dominant_industries',
  'hotspots',
  'opportunity_points',
  'comparison',
  'coverage_gap'
]

function resolveRouterEnabled() {
  if (process.env.V2_ROUTER_LLM_ENABLED != null) {
    return toBoolean(process.env.V2_ROUTER_LLM_ENABLED, true)
  }
  return resolveLlmEnabled()
}

function parseJsonResponse(text = '') {
  const raw = String(text || '').trim()
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim())
      } catch {
        return null
      }
    }

    const firstBrace = raw.indexOf('{')
    const lastBrace = raw.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1))
      } catch {
        return null
      }
    }

    return null
  }
}

function normalizeDecision(payload = {}) {
  const objective = String(payload?.objective || '').trim()
  const confidence = Number(payload?.confidence)
  const selectedAgents = Array.isArray(payload?.selected_agents)
    ? payload.selected_agents.map((entry) => String(entry || '').trim()).filter(Boolean)
    : []
  const reasoning = String(payload?.reasoning || '').trim()

  return {
    objective,
    confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(2)) : null,
    selected_agents: selectedAgents,
    reasoning
  }
}

function formatConversationHistory(history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return '[]'
  }

  return history
    .slice(-6)
    .map((entry, index) => {
      const role = String(entry?.role || 'unknown').trim() || 'unknown'
      const content = String(entry?.content || '').trim() || '(empty)'
      return `${index + 1}. ${role}: ${content}`
    })
    .join('\n')
}

function buildRoutingPrompt({ query, viewport, history = [], fallbackRouting = null }) {
  const fallbackHint = fallbackRouting
    ? JSON.stringify({
        objective: fallbackRouting.objective,
        confidence: fallbackRouting.confidence,
        legacy_hint: fallbackRouting.legacy_hint,
        matched_keywords: fallbackRouting?.routing_features?.matched_keywords ?? {}
      })
    : '{}'

  return [
    'Task: choose the best routing objective and specialist plan for this spatial query.',
    `Available objectives: ${OBJECTIVES.join(', ')}`,
    `Available specialists: ${SPECIALISTS.join(', ')}`,
    'Rules:',
    '- choose exactly one objective from available objectives',
    '- if objective is buffer_export_workflow, selected_agents should be empty',
    '- otherwise choose the smallest specialist set needed for the objective',
    '- confidence is a number between 0 and 1',
    '- output strictly as JSON object with keys: objective, confidence, selected_agents, reasoning',
    '',
    `Conversation history:\n${formatConversationHistory(history)}`,
    `Query: ${query}`,
    `Viewport: ${JSON.stringify(viewport ?? {})}`,
    `Rule fallback hint: ${fallbackHint}`
  ].join('\n')
}

export function createLlmRouterAgent({
  enabled = resolveRouterEnabled(),
  llmGateway = createLlmGateway({
    enabled,
    localTimeoutMs: Number(process.env.V2_ROUTER_LLM_TIMEOUT_MS || 900),
    cloudTimeoutMs: Number(process.env.V2_ROUTER_CLOUD_TIMEOUT_MS || 1400)
  })
} = {}) {
  return {
    async decide({ query = '', viewport = {}, history = [], fallbackRouting = null } = {}) {
      if (!enabled) {
        return null
      }

      const systemPrompt = [
        'You are a routing planner for a GIS multi-agent system.',
        'Return JSON only.',
        'Never output markdown.',
        'Never invent objective names beyond the provided list.'
      ].join(' ')

      const userPrompt = buildRoutingPrompt({
        query,
        viewport,
        history,
        fallbackRouting
      })

      const response = await llmGateway.chat({
        systemPrompt,
        userPrompt,
        temperature: 0,
        maxTokens: 240
      })

      if (!response?.text) {
        return null
      }

      const parsed = parseJsonResponse(response.text)
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      const decision = normalizeDecision(parsed)
      if (!decision.objective) {
        return null
      }

      return decision
    }
  }
}
