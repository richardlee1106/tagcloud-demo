import { createLlmGateway, resolveLlmEnabled, toBoolean } from '../llm/llm-gateway.js'

const ALLOWED_OPS = new Set([
  'clip',
  'buffer',
  'merge',
  'export_geojson',
  'summarize',
  'hotspot_grid',
  'compare_regions'
])

function resolvePlannerEnabled() {
  if (process.env.V2_PLANNER_LLM_ENABLED != null) {
    return toBoolean(process.env.V2_PLANNER_LLM_ENABLED, true)
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

function normalizePipeline(rawPipeline = []) {
  if (!Array.isArray(rawPipeline)) {
    return null
  }

  const pipeline = []
  for (const step of rawPipeline) {
    const op = String(step?.op || '').trim()
    if (!ALLOWED_OPS.has(op)) {
      return null
    }

    const args = step?.args && typeof step.args === 'object'
      ? step.args
      : {}

    pipeline.push({ op, args })
  }

  if (pipeline.length === 0) {
    return null
  }

  return pipeline
}

function buildPlanningPrompt({ query = '', route = {}, template = {}, toolDescriptors = [] } = {}) {
  const toolsText = toolDescriptors.length > 0
    ? JSON.stringify(toolDescriptors)
    : '[]'

  const routeHint = JSON.stringify({
    query_type: route?.query_type ?? 'area_analysis',
    primary_intent: route?.primary_intent ?? 'micro',
    sub_intent: route?.sub_intent ?? 'summary',
    template_id: template?.id ?? 'fallback-summary'
  })

  return [
    'You are a GIS chain planner.',
    'Generate a valid pipeline for the current query.',
    'Output JSON only with keys: template_id, lane, deadline_ms, max_retries, pipeline.',
    `Allowed ops: ${Array.from(ALLOWED_OPS).join(', ')}`,
    '',
    `Route hint: ${routeHint}`,
    `User query: ${query}`,
    `Tool registry descriptors: ${toolsText}`,
    '',
    'Rules:',
    '- pipeline must be non-empty',
    '- each step has {op, args}',
    '- keep lane as fast unless compare intent needs deep',
    '- do not invent ops beyond allowlist'
  ].join('\n')
}

function normalizeDecision(payload = {}, { route, template } = {}) {
  const pipeline = normalizePipeline(payload?.pipeline)
  if (!pipeline) {
    return null
  }

  const lane = String(payload?.lane || '').trim().toLowerCase()
  const deadlineMs = Number(payload?.deadline_ms)
  const maxRetries = Number(payload?.max_retries)

  return {
    template_id: String(payload?.template_id || template?.id || 'fallback-summary').trim(),
    constraints: {
      lane: lane === 'deep' ? 'deep' : (route?.primary_intent === 'compare' ? 'deep' : 'fast'),
      deadline_ms: Number.isFinite(deadlineMs) && deadlineMs > 0 ? Math.round(deadlineMs) : 10_000,
      max_retries: Number.isFinite(maxRetries) && maxRetries >= 0 ? Math.round(maxRetries) : 2
    },
    pipeline
  }
}

export function createLlmPlannerAgent({
  enabled = resolvePlannerEnabled(),
  llmGateway = createLlmGateway({
    enabled,
    localTimeoutMs: Number(process.env.V2_PLANNER_LLM_TIMEOUT_MS || 1200),
    cloudTimeoutMs: Number(process.env.V2_PLANNER_CLOUD_TIMEOUT_MS || 1800)
  })
} = {}) {
  return {
    async decide({
      query = '',
      route = {},
      template = {},
      toolDescriptors = []
    } = {}) {
      if (!enabled) {
        return null
      }

      const response = await llmGateway.chat({
        systemPrompt: [
          'You are a deterministic GIS planning assistant.',
          'Return strict JSON only, no markdown.'
        ].join(' '),
        userPrompt: buildPlanningPrompt({
          query,
          route,
          template,
          toolDescriptors
        }),
        temperature: 0,
        maxTokens: 360
      })

      if (!response?.text) {
        return null
      }

      const parsed = parseJsonResponse(response.text)
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      return normalizeDecision(parsed, { route, template })
    }
  }
}
