import { extractCategoriesFromQuestion, expandCategory, CATEGORY_ONTOLOGY } from '../../services/categoryOntology.js'
import { shouldHardBlockInput } from '../../services/relevanceGate.js'
import { callLLM } from '../../services/llm.js'
import { createDslStreamingParser } from '../../services/dslStreamingParser.js'

export const QUERY_PLAN_DEFAULTS = {
  query_type: null,
  intent_mode: null,
  anchor: {
    type: 'unknown',
    name: null,
    gate: null,
    direction: null,
    lat: null,
    lon: null
  },
  radius_m: 3000,
  categories: [],
  rating_range: [null, null],
  semantic_query: '',
  max_results: 30,
  sort_by: 'distance',
  aggregation_strategy: {
    enable: false,
    method: 'h3',
    resolution: 9,
    max_bins: 60
  },
  sampling_strategy: {
    enable: false,
    method: 'representative',
    count: 50,
    rules: ['diversity']
  },
  need_global_context: false,
  need_landmarks: false,
  need_graph_reasoning: false,
  clarification_question: null,
  confidence: {
    score: 0,
    level: 'unknown',
    reasons: []
  }
}

const QUICK_TOKEN_USAGE = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
const PLANNER_LLM_MAX_TOKENS = 360
const PLANNER_STREAM_FALLBACK_NO_JSON = 'planner_stream_no_json'
const PLANNER_STREAM_FALLBACK_TRANSPORT = 'planner_stream_transport_error'
const PLANNER_ALLOWED_QUERY_TYPES = new Set([
  'poi_search',
  'area_analysis',
  'fuzzy_regions',
  'vernacular_region',
  'graph_reasoning',
  'region_comparison',
  'clarification_needed',
  'general_qa',
  'irrelevant_input'
])
const PLANNER_CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low', 'unknown'])
const PLANNER_LLM_SYSTEM_PROMPT = [
  'You are an intent planner for a geospatial analysis assistant.',
  'Return JSON only. No markdown.',
  'Schema:',
  '{',
  '  "query_type": "poi_search|area_analysis|fuzzy_regions|vernacular_region|graph_reasoning|region_comparison|clarification_needed|general_qa|irrelevant_input",',
  '  "intent_mode": "short_label",',
  '  "categories": ["optional category strings"],',
  '  "semantic_query": "short semantic text",',
  '  "radius_m": 3000,',
  '  "max_results": 30,',
  '  "need_global_context": false,',
  '  "need_landmarks": false,',
  '  "need_graph_reasoning": false,',
  '  "clarification_question": null,',
  '  "confidence": {"score": 0-10, "level": "high|medium|low", "reasons": ["short_reason"]}',
  '}',
  'Only include fields when you are confident.'
].join('\n')

const GRAPH_REASONING_KEYWORDS = [
  'network',
  'accessibility',
  'reachable',
  'topology',
  'path',
  'connection',
  '\u8def\u7f51',
  '\u53ef\u8fbe\u6027',
  '\u8def\u5f84',
  '\u8fde\u63a5',
  '\u62d3\u6251',
  '\u7ed3\u6784',
  '\u5173\u7cfb',
  '\u8f90\u5c04',
  '\u6838\u5fc3\u8282\u70b9',
  '\u7a7a\u95f4\u7ed3\u6784'
]

const LOCAL_HINTS = [
  '\u9644\u8fd1',
  '\u5468\u8fb9',
  '\u5468\u56f4',
  '\u6700\u8fd1',
  '\u627e',
  '\u54ea\u91cc\u6709',
  '\u6709\u6ca1\u6709',
  '\u63a8\u8350',
  '\u4e1c\u4fa7',
  '\u897f\u4fa7',
  '\u5357\u4fa7',
  '\u5317\u4fa7',
  '\u4e1c\u8fb9',
  '\u897f\u8fb9',
  '\u5357\u8fb9',
  '\u5317\u8fb9'
]

const MACRO_HINTS = [
  '\u5206\u6790',
  '\u6982\u51b5',
  '\u7279\u5f81',
  '\u89c4\u5f8b',
  '\u5206\u5e03',
  '\u8bc4\u4f30',
  '\u5982\u4f55',
  '\u7ed3\u6784',
  '\u8d8b\u52bf',
  '\u753b\u50cf'
]

const DIRECTION_HINTS = [
  '\u4e1c\u4fa7',
  '\u897f\u4fa7',
  '\u5357\u4fa7',
  '\u5317\u4fa7',
  '\u4e1c\u8fb9',
  '\u897f\u8fb9',
  '\u5357\u8fb9',
  '\u5317\u8fb9',
  '\u5411\u4e1c',
  '\u5411\u897f',
  '\u5411\u5357',
  '\u5411\u5317'
]

const TRANSPORT_INTENT_HINTS = [
  '\u4ea4\u901a',
  '\u51fa\u884c',
  '\u901a\u52e4',
  '\u53ef\u8fbe\u6027',
  '\u5730\u94c1',
  '\u516c\u4ea4',
  '\u505c\u8f66',
  'transit',
  'traffic',
  'commute',
  'mobility'
]

const MOBILITY_ONLY_CATEGORIES = new Set([
  '\u505c\u8f66\u573a',
  '\u5730\u94c1\u7ad9',
  '\u516c\u4ea4\u7ad9',
  '\u516c\u4ea4\u8f66\u7ad9',
  '\u8f68\u9053\u4ea4\u901a',
  '\u4ea4\u901a\u8bbe\u65bd'
].map((item) => normalizeToken(item)))

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function uniq(items = []) {
  const seen = new Set()
  const output = []
  for (const item of items) {
    const text = String(item || '').trim()
    if (!text) continue
    const key = normalizeToken(text)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(text)
  }
  return output
}

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function shouldEnablePlannerLlm(context = {}) {
  if (typeof context?.plannerLlmEnabled === 'boolean') {
    return context.plannerLlmEnabled
  }
  const envValue = String(process.env.PLANNER_LLM_ENABLED || 'true').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(envValue)
}

function shouldEnablePlannerStreaming(context = {}) {
  if (typeof context?.plannerStreamingEnabled === 'boolean') {
    return context.plannerStreamingEnabled
  }
  const envValue = String(process.env.PLANNER_STREAMING_ENABLED || 'true').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(envValue)
}

function normalizeStreamContentChunk(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        return String(item.text ?? item.content ?? '')
      })
      .join('')
  }
  if (!value || typeof value !== 'object') return ''
  return String(value.text ?? value.content ?? '')
}

function extractPlannerStreamChunk(parsed = {}) {
  const choice = parsed?.choices?.[0] || {}
  const delta = choice?.delta && typeof choice.delta === 'object' ? choice.delta : {}
  return normalizeStreamContentChunk(delta.content)
    || normalizeStreamContentChunk(choice?.message?.content)
    || normalizeStreamContentChunk(choice?.text)
    || normalizeStreamContentChunk(parsed?.output_text)
    || ''
}

function normalizePlannerRawPlan(payload = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (payload.query_plan && typeof payload.query_plan === 'object') {
    return payload.query_plan
  }
  if (payload.queryPlan && typeof payload.queryPlan === 'object') {
    return payload.queryPlan
  }
  return payload
}

function buildPlannerPromptPayload(userQuestion, context = {}, seedPlan = {}) {
  const contextPayload = {
    hasSelectedArea: Boolean(context?.hasSelectedArea),
    poiCount: Number(context?.poiCount || 0),
    viewportCenter: context?.viewportCenter || null,
    selectedCategories: Array.isArray(context?.selectedCategories) ? context.selectedCategories.slice(0, 20) : []
  }

  const userPayload = JSON.stringify({
    question: userQuestion,
    context: contextPayload,
    seed_query_plan: seedPlan
  })

  const promptText = `${PLANNER_LLM_SYSTEM_PROMPT}\n${userPayload}`
  return { userPayload, promptText }
}

function extractFirstJsonObject(content = '') {
  const cleaned = String(content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim()

  if (!cleaned) return null

  try {
    const direct = JSON.parse(cleaned)
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct
    }
  } catch {
  }

  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[0])
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const prompt = Math.max(0, Math.round(toFiniteNumber(usage.prompt_tokens) || 0))
  const completion = Math.max(0, Math.round(toFiniteNumber(usage.completion_tokens) || 0))
  const explicitTotal = Math.max(0, Math.round(toFiniteNumber(usage.total_tokens) || 0))
  const total = explicitTotal > 0 ? explicitTotal : prompt + completion
  if (total <= 0 && prompt <= 0 && completion <= 0) return null
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total
  }
}

function estimateTokenUsage({ promptText = '', completionText = '' } = {}) {
  const promptChars = String(promptText || '').length
  const completionChars = String(completionText || '').length
  if (promptChars <= 0 && completionChars <= 0) {
    return QUICK_TOKEN_USAGE
  }

  const promptTokens = promptChars > 0 ? Math.max(1, Math.round(promptChars / 4)) : 0
  const completionTokens = completionChars > 0 ? Math.max(1, Math.round(completionChars / 4)) : 0
  const totalTokens = promptTokens + completionTokens

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated: true
  }
}

async function callPlannerLlmNonStream(userPayload, promptText) {
  const response = await callLLM({
    messages: [
      { role: 'system', content: PLANNER_LLM_SYSTEM_PROMPT },
      { role: 'user', content: userPayload }
    ],
    temperature: 0.1,
    max_tokens: PLANNER_LLM_MAX_TOKENS,
    stream: false
  })

  const data = await response.json()
  const rawText = data?.choices?.[0]?.message?.content || ''
  const tokenUsage = normalizeTokenUsage(data?.usage)
    || estimateTokenUsage({
      promptText,
      completionText: rawText
    })
  const parsedPayload = extractFirstJsonObject(rawText)

  return {
    parsedPayload,
    rawText,
    tokenUsage
  }
}

async function readPlannerStreamingResponse(response, parser) {
  const reader = response?.body?.getReader?.()
  if (!reader) {
    throw new Error('planner_stream_body_unavailable')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let streamedText = ''
  let streamTokenUsage = null

  const consumeLine = (line) => {
    const trimmed = String(line || '').trim()
    if (!trimmed.startsWith('data:')) return

    const dataText = trimmed.slice(5).trim()
    if (!dataText || dataText === '[DONE]') return

    try {
      const parsed = JSON.parse(dataText)
      const usage = normalizeTokenUsage(parsed?.usage)
      if (usage) {
        streamTokenUsage = usage
      }
      const chunk = extractPlannerStreamChunk(parsed)
      if (!chunk) return

      streamedText += chunk
      parser.push(chunk)
    } catch {
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      consumeLine(line)
    }
  }

  buffer += decoder.decode()

  if (buffer.trim()) {
    consumeLine(buffer)
  }

  const parserResult = parser.finish()
  return {
    streamedText,
    streamTokenUsage,
    parserResult
  }
}

function sanitizePlannerConfidence(rawConfidence = {}, fallback = {}) {
  const source = rawConfidence && typeof rawConfidence === 'object' ? rawConfidence : {}
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {}

  const scoreRaw = toFiniteNumber(source.score)
  const fallbackScore = toFiniteNumber(fallbackSource.score)
  const score = Math.max(0, Math.min(10, Math.round(scoreRaw ?? fallbackScore ?? 0)))

  const levelCandidate = String(source.level || fallbackSource.level || 'medium').trim().toLowerCase()
  const level = PLANNER_CONFIDENCE_LEVELS.has(levelCandidate) ? levelCandidate : 'medium'
  const reasons = uniq(
    Array.isArray(source.reasons)
      ? source.reasons
      : (Array.isArray(fallbackSource.reasons) ? fallbackSource.reasons : [])
  ).slice(0, 6)

  return { score, level, reasons }
}

function sanitizePlannerLlmPlan(rawPlan = {}, fallbackPlan = {}, userQuestion = '') {
  const source = rawPlan && typeof rawPlan === 'object' ? rawPlan : {}
  const plan = {
    ...(fallbackPlan && typeof fallbackPlan === 'object' ? fallbackPlan : QUERY_PLAN_DEFAULTS)
  }

  const rawType = String(source.query_type || source.queryType || '').trim().toLowerCase()
  if (PLANNER_ALLOWED_QUERY_TYPES.has(rawType)) {
    plan.query_type = rawType
  }

  if (typeof source.intent_mode === 'string' && source.intent_mode.trim()) {
    plan.intent_mode = source.intent_mode.trim().slice(0, 64)
  }

  if (Array.isArray(source.categories)) {
    plan.categories = uniq(source.categories.map((item) => String(item || '').trim())).slice(0, 30)
  }

  if (typeof source.semantic_query === 'string') {
    plan.semantic_query = source.semantic_query.trim().slice(0, 240)
  }

  const radius = toFiniteNumber(source.radius_m)
  if (radius != null) {
    plan.radius_m = Math.max(200, Math.min(15000, Math.round(radius)))
  }

  const maxResults = toFiniteNumber(source.max_results)
  if (maxResults != null) {
    plan.max_results = Math.max(5, Math.min(200, Math.round(maxResults)))
  }

  if (typeof source.need_global_context === 'boolean') {
    plan.need_global_context = source.need_global_context
  }
  if (typeof source.need_landmarks === 'boolean') {
    plan.need_landmarks = source.need_landmarks
  }
  if (typeof source.need_graph_reasoning === 'boolean') {
    plan.need_graph_reasoning = source.need_graph_reasoning
  }

  if (Object.prototype.hasOwnProperty.call(source, 'clarification_question')) {
    const text = String(source.clarification_question || '').trim()
    plan.clarification_question = text ? text.slice(0, 280) : null
  }

  const anchor = source.anchor
  if (anchor && typeof anchor === 'object') {
    const lon = toFiniteNumber(anchor.lon ?? anchor.lng ?? anchor.longitude)
    const lat = toFiniteNumber(anchor.lat ?? anchor.latitude)
    if (lon != null && lat != null) {
      plan.anchor = {
        ...QUERY_PLAN_DEFAULTS.anchor,
        ...(plan.anchor && typeof plan.anchor === 'object' ? plan.anchor : {}),
        ...anchor,
        lon,
        lat
      }
    }
  }

  plan.confidence = sanitizePlannerConfidence(source.confidence, plan.confidence)
  return applyAreaAnalysisCategoryGuard(plan, userQuestion)
}

async function callPlannerLlm(userQuestion, context = {}, seedPlan = {}) {
  const injectedCaller = typeof context?.plannerLlmCaller === 'function'
    ? context.plannerLlmCaller
    : null
  const streamingEnabled = shouldEnablePlannerStreaming(context)
  const { userPayload, promptText } = buildPlannerPromptPayload(userQuestion, context, seedPlan)

  const buildStreamingDiagnostics = ({
    mode = 'non_stream',
    fallbackUsed = false,
    fallbackErrorCode = null,
    parserEvents = [],
    finalState = null
  } = {}) => ({
    planner_streaming: {
      mode,
      fallback_used: fallbackUsed,
      fallback_error_code: fallbackUsed ? String(fallbackErrorCode || 'planner_stream_unknown') : null,
      parser_events: Array.isArray(parserEvents) ? parserEvents : [],
      final_state: finalState || null
    }
  })

  if (injectedCaller) {
    if (!streamingEnabled) {
      const callerResult = await injectedCaller({
        question: userQuestion,
        context,
        seedPlan,
        mode: 'non_stream'
      })
      const rawPlan = normalizePlannerRawPlan(callerResult) || seedPlan
      const normalizedPlan = sanitizePlannerLlmPlan(rawPlan, seedPlan, userQuestion)
      const tokenUsage = normalizeTokenUsage(callerResult?.tokenUsage || callerResult?.token_usage)
        || estimateTokenUsage({
          promptText,
          completionText: JSON.stringify(callerResult || {})
        })
      return {
        queryPlan: normalizedPlan,
        tokenUsage,
        diagnostics: buildStreamingDiagnostics({
          mode: 'non_stream',
          fallbackUsed: false
        })
      }
    }

    const streamResult = await injectedCaller({
      question: userQuestion,
      context,
      seedPlan,
      mode: 'stream'
    })

    const streamChunks = Array.isArray(streamResult?.streamChunks)
      ? streamResult.streamChunks.map((chunk) => String(chunk ?? ''))
      : null

    if (streamChunks) {
      const streamEvents = []
      const parser = createDslStreamingParser({
        onEvent: (event) => streamEvents.push(event)
      })

      for (const chunk of streamChunks) {
        parser.push(chunk)
      }
      const parserResult = parser.finish()
      const streamedText = streamChunks.join('')
      const parsedPayload = parserResult.ok
        ? (parserResult.parsed_dsl || extractFirstJsonObject(streamedText))
        : null
      const streamRawPlan = normalizePlannerRawPlan(parsedPayload)
      const streamTokenUsage = normalizeTokenUsage(streamResult?.tokenUsage || streamResult?.token_usage)
        || estimateTokenUsage({
          promptText,
          completionText: streamedText
        })

      if (streamRawPlan) {
        const executingSnapshot = parser.enterExecuting()
        return {
          queryPlan: sanitizePlannerLlmPlan(streamRawPlan, seedPlan, userQuestion),
          tokenUsage: streamTokenUsage,
          diagnostics: buildStreamingDiagnostics({
            mode: 'stream',
            fallbackUsed: false,
            parserEvents: streamEvents,
            finalState: executingSnapshot?.state || parserResult?.state || null
          })
        }
      }

      const fallbackErrorCode = parserResult?.error_code || PLANNER_STREAM_FALLBACK_NO_JSON
      const fallbackResult = await injectedCaller({
        question: userQuestion,
        context,
        seedPlan,
        mode: 'non_stream',
        fallback_error_code: fallbackErrorCode
      })
      const fallbackRawPlan = normalizePlannerRawPlan(fallbackResult) || seedPlan
      const fallbackTokenUsage = normalizeTokenUsage(fallbackResult?.tokenUsage || fallbackResult?.token_usage)
        || estimateTokenUsage({
          promptText,
          completionText: JSON.stringify(fallbackResult || {})
        })

      return {
        queryPlan: sanitizePlannerLlmPlan(fallbackRawPlan, seedPlan, userQuestion),
        tokenUsage: fallbackTokenUsage,
        diagnostics: buildStreamingDiagnostics({
          mode: 'stream',
          fallbackUsed: true,
          fallbackErrorCode,
          parserEvents: streamEvents,
          finalState: parserResult?.state || null
        })
      }
    }

    const directRawPlan = normalizePlannerRawPlan(streamResult) || seedPlan
    const directTokenUsage = normalizeTokenUsage(streamResult?.tokenUsage || streamResult?.token_usage)
      || estimateTokenUsage({
        promptText,
        completionText: JSON.stringify(streamResult || {})
      })
    return {
      queryPlan: sanitizePlannerLlmPlan(directRawPlan, seedPlan, userQuestion),
      tokenUsage: directTokenUsage,
      diagnostics: buildStreamingDiagnostics({
        mode: 'stream',
        fallbackUsed: false
      })
    }
  }

  if (streamingEnabled) {
    const streamEvents = []
    const parser = createDslStreamingParser({
      onEvent: (event) => streamEvents.push(event)
    })

    try {
      const streamResponse = await callLLM({
        messages: [
          { role: 'system', content: PLANNER_LLM_SYSTEM_PROMPT },
          { role: 'user', content: userPayload }
        ],
        temperature: 0.1,
        max_tokens: PLANNER_LLM_MAX_TOKENS,
        stream: true
      })

      const streamResult = await readPlannerStreamingResponse(streamResponse, parser)
      const streamedPayload = streamResult?.parserResult?.ok
        ? (streamResult?.parserResult?.parsed_dsl || extractFirstJsonObject(streamResult?.streamedText || ''))
        : null
      const streamedRawPlan = normalizePlannerRawPlan(streamedPayload)

      if (streamedRawPlan) {
        const executingSnapshot = parser.enterExecuting()
        const tokenUsage = streamResult?.streamTokenUsage
          || estimateTokenUsage({
            promptText,
            completionText: streamResult?.streamedText || ''
          })
        return {
          queryPlan: sanitizePlannerLlmPlan(streamedRawPlan, seedPlan, userQuestion),
          tokenUsage,
          diagnostics: buildStreamingDiagnostics({
            mode: 'stream',
            fallbackUsed: false,
            parserEvents: streamEvents,
            finalState: executingSnapshot?.state || streamResult?.parserResult?.state || null
          })
        }
      }

      const fallbackErrorCode = streamResult?.parserResult?.error_code || PLANNER_STREAM_FALLBACK_NO_JSON
      const fallbackResult = await callPlannerLlmNonStream(userPayload, promptText)
      const fallbackRawPlan = normalizePlannerRawPlan(fallbackResult?.parsedPayload) || seedPlan

      return {
        queryPlan: sanitizePlannerLlmPlan(fallbackRawPlan, seedPlan, userQuestion),
        tokenUsage: fallbackResult?.tokenUsage || QUICK_TOKEN_USAGE,
        diagnostics: buildStreamingDiagnostics({
          mode: 'stream',
          fallbackUsed: true,
          fallbackErrorCode,
          parserEvents: streamEvents,
          finalState: streamResult?.parserResult?.state || null
        })
      }
    } catch {
      const fallbackResult = await callPlannerLlmNonStream(userPayload, promptText)
      const fallbackRawPlan = normalizePlannerRawPlan(fallbackResult?.parsedPayload) || seedPlan
      return {
        queryPlan: sanitizePlannerLlmPlan(fallbackRawPlan, seedPlan, userQuestion),
        tokenUsage: fallbackResult?.tokenUsage || QUICK_TOKEN_USAGE,
        diagnostics: buildStreamingDiagnostics({
          mode: 'stream',
          fallbackUsed: true,
          fallbackErrorCode: PLANNER_STREAM_FALLBACK_TRANSPORT,
          parserEvents: streamEvents,
          finalState: null
        })
      }
    }
  }

  const nonStreamResult = await callPlannerLlmNonStream(userPayload, promptText)
  const rawPlan = normalizePlannerRawPlan(nonStreamResult?.parsedPayload) || seedPlan

  return {
    queryPlan: sanitizePlannerLlmPlan(rawPlan, seedPlan, userQuestion),
    tokenUsage: nonStreamResult?.tokenUsage || QUICK_TOKEN_USAGE,
    diagnostics: buildStreamingDiagnostics({
      mode: 'non_stream',
      fallbackUsed: false
    })
  }
}

function resolveContextAnchor(context = {}) {
  if (!context || typeof context !== 'object') return null

  const raw = context.viewportCenter || context.center || context.anchor
  if (!raw || typeof raw !== 'object') return null

  const lon = toFiniteNumber(raw.lon ?? raw.lng ?? raw.longitude)
  const lat = toFiniteNumber(raw.lat ?? raw.latitude)
  if (lon == null || lat == null) return null

  return {
    type: 'viewport_center',
    name: context.anchorName || null,
    gate: null,
    direction: null,
    lat,
    lon
  }
}

function applyContextAnchor(queryPlan, context = {}) {
  const plan = queryPlan && typeof queryPlan === 'object' ? { ...queryPlan } : { ...QUERY_PLAN_DEFAULTS }
  const resolvedAnchor = resolveContextAnchor(context)
  if (!resolvedAnchor) return plan

  const currentAnchor = plan.anchor && typeof plan.anchor === 'object' ? plan.anchor : {}
  const currentLon = toFiniteNumber(currentAnchor.lon)
  const currentLat = toFiniteNumber(currentAnchor.lat)
  const hasConcreteAnchor = currentLon != null && currentLat != null
  if (hasConcreteAnchor) return plan

  plan.anchor = {
    ...QUERY_PLAN_DEFAULTS.anchor,
    ...currentAnchor,
    ...resolvedAnchor
  }
  return plan
}

function detectGraphReasoningNeed(question) {
  const normalized = String(question || '').toLowerCase()
  if (!normalized) return false
  return GRAPH_REASONING_KEYWORDS.some((kw) => normalized.includes(kw))
}

function detectIntentConflict(question) {
  const normalized = String(question || '').toLowerCase()
  const localScore = LOCAL_HINTS.filter((kw) => normalized.includes(kw)).length
  const macroScore = MACRO_HINTS.filter((kw) => normalized.includes(kw)).length
  return {
    hasConflict: localScore > 0 && macroScore > 0,
    localScore,
    macroScore
  }
}

function isMetaQuestionExamplesRequest(question = '') {
  const normalized = String(question || '').trim().toLowerCase()
  if (!normalized) return false
  const compact = normalized.replace(/\s+/g, '')

  const directPatterns = [
    /(?:\u7ed9\u6211|\u63d0\u4f9b|\u5217\u51fa|\u751f\u6210).{0,12}(?:\u95ee\u9898|\u95ee\u6cd5|\u63d0\u95ee).{0,8}(?:\u793a\u4f8b|\u4f8b\u5b50|\u6a21\u677f)/u,
    /(?:\u600e\u4e48\u63d0\u95ee|\u5982\u4f55\u63d0\u95ee|\u600e\u4e48\u95ee|\u95ee\u6cd5\u5efa\u8bae)/u,
    /(?:question|questions|query).{0,8}(?:example|examples|template|templates|prompt|prompts)/u
  ]
  if (directPatterns.some((pattern) => pattern.test(compact))) {
    return true
  }

  const exampleTokens = [
    '\u793a\u4f8b',
    '\u4f8b\u5b50',
    '\u6a21\u677f',
    '\u63d0\u793a\u8bcd',
    '\u95ee\u6cd5',
    'prompt',
    'template',
    'example'
  ]
  const questionTokens = [
    '\u95ee\u9898',
    '\u63d0\u95ee',
    '\u95ee\u6cd5',
    'question',
    'query',
    'queries'
  ]

  return exampleTokens.some((token) => compact.includes(token)) &&
    questionTokens.some((token) => compact.includes(token))
}

function isGeneralHelpRequest(question = '') {
  const normalized = String(question || '').trim().toLowerCase()
  if (!normalized) return false
  const patterns = [
    /\u4f60\u662f\u8c01/u,
    /\u4f60\u80fd\u505a\u4ec0\u4e48/u,
    /\u600e\u4e48\u7528/u,
    /\u5982\u4f55\u4f7f\u7528/u,
    /\u80fd\u529b/u,
    /\bhelp\b/i,
    /who are you/i,
    /what can you do/i
  ]
  return patterns.some((pattern) => pattern.test(normalized))
}

function inferCategoriesFromQuestion(question, fallbackCategories = []) {
  const detected = extractCategoriesFromQuestion(question)
  if (!Array.isArray(detected) || detected.length === 0) {
    return uniq(fallbackCategories)
  }

  const expanded = []
  for (const category of detected) {
    const canon = String(category || '').trim()
    if (!canon) continue
    expanded.push(canon)
    if (CATEGORY_ONTOLOGY[canon]) {
      const children = expandCategory(canon)
      if (Array.isArray(children) && children.length > 0) {
        expanded.push(...children)
      }
    }
  }

  return uniq(expanded)
}

function shouldUseRuleFastPath(question, context = {}) {
  const normalized = String(question || '').trim().toLowerCase()
  if (!normalized) return { bypass: true, reason: 'empty_question' }
  if (shouldHardBlockInput(question)) return { bypass: true, reason: 'irrelevant_input' }
  if (isMetaQuestionExamplesRequest(question)) return { bypass: true, reason: 'general_qa_meta' }
  if (isGeneralHelpRequest(question)) return { bypass: true, reason: 'general_qa_help' }

  const llmRequiredHints = [
    '关键结论',
    '核心结论',
    '主导业态',
    '活力热点',
    '机会点',
    '机会分析',
    '洞察'
  ]
  if (llmRequiredHints.some((hint) => normalized.includes(hint))) {
    return { bypass: false, reason: 'llm_required_hint_detected' }
  }

  const complexHints = [
    '\u9009\u533a',
    '\u6bd4\u8f83',
    '\u5bf9\u6bd4',
    '\u5dee\u5f02',
    '\u62d3\u6251',
    'fuzzy',
    'vernacular',
    'graph',
    'region_comparison'
  ]
  if (complexHints.some((hint) => normalized.includes(hint))) {
    return { bypass: false, reason: 'complex_hint_detected' }
  }

  const hasIntentHints = LOCAL_HINTS.some((hint) => normalized.includes(hint)) ||
    MACRO_HINTS.some((hint) => normalized.includes(hint))
  const hasDirectionHints = DIRECTION_HINTS.some((hint) => normalized.includes(hint))
  const hasCategoryHints = extractCategoriesFromQuestion(question).length > 0
  const hasAreaContext = Boolean(context?.hasSelectedArea)
  const isShortQuery = normalized.length <= 36

  if (isShortQuery && (hasIntentHints || hasDirectionHints || hasCategoryHints)) {
    return { bypass: true, reason: 'short_query_with_intent_or_direction' }
  }

  if (hasAreaContext && (hasIntentHints || hasDirectionHints || hasCategoryHints) && normalized.length <= 56) {
    return { bypass: true, reason: 'selected_area_with_clear_intent' }
  }

  return { bypass: false, reason: 'router_needed' }
}

function buildQuickPlannerOutput(
  userQuestion,
  { reason = 'rule_fast_path', startTime = Date.now(), context = {} } = {}
) {
  if (reason === 'general_qa_meta' || reason === 'general_qa_help') {
    const quickPlan = applyContextAnchor({
      ...QUERY_PLAN_DEFAULTS,
      query_type: 'general_qa',
      intent_mode: 'llm_chat',
      categories: [],
      semantic_query: '',
      confidence: {
        score: 9,
        level: 'high',
        reasons: reason === 'general_qa_meta'
          ? ['meta_question_examples', 'skip_spatial_compute']
          : ['general_help_request', 'skip_spatial_compute']
      }
    }, context)
    return {
      success: true,
      queryPlan: quickPlan,
      tokenUsage: QUICK_TOKEN_USAGE,
      duration: Date.now() - startTime,
      confidence: 'high',
      fastPath: true,
      routerUsed: false,
      fastPathReason: reason
    }
  }

  if (reason === 'irrelevant_input') {
    const quickPlan = applyContextAnchor({
      ...QUERY_PLAN_DEFAULTS,
      query_type: 'irrelevant_input',
      intent_mode: 'out_of_scope',
      categories: [],
      semantic_query: '',
      confidence: {
        score: 9,
        level: 'high',
        reasons: ['hard_rule_block', 'query_not_geo_related']
      }
    }, context)
    return {
      success: true,
      queryPlan: quickPlan,
      tokenUsage: QUICK_TOKEN_USAGE,
      duration: Date.now() - startTime,
      confidence: 'high',
      fastPath: true,
      routerUsed: false,
      fastPathReason: reason
    }
  }

  const quickPlan = applyContextAnchor(quickIntentClassify(userQuestion), context)
  return {
    success: true,
    queryPlan: quickPlan,
    tokenUsage: QUICK_TOKEN_USAGE,
    duration: Date.now() - startTime,
    confidence: quickPlan?.confidence?.level || 'medium',
    fastPath: true,
    routerUsed: false,
    fastPathReason: reason
  }
}

export function applyAreaAnalysisCategoryGuard(queryPlan, userQuestion = '') {
  const plan = queryPlan && typeof queryPlan === 'object' ? { ...queryPlan } : { ...QUERY_PLAN_DEFAULTS }
  const queryType = String(plan.query_type || '').trim().toLowerCase()

  if (queryType !== 'area_analysis') return plan
  if (!Array.isArray(plan.categories) || plan.categories.length === 0) return plan

  const normalizedQuestion = String(userQuestion || '').toLowerCase()
  const hasExplicitTransportIntent = TRANSPORT_INTENT_HINTS.some((hint) => normalizedQuestion.includes(hint))
  if (hasExplicitTransportIntent) return plan

  plan.categories = plan.categories.filter((category) => !MOBILITY_ONLY_CATEGORIES.has(normalizeToken(category)))
  return plan
}

export function quickIntentClassify(question) {
  const q = String(question || '').toLowerCase()
  const plan = { ...QUERY_PLAN_DEFAULTS }

  if (isMetaQuestionExamplesRequest(question) || isGeneralHelpRequest(question)) {
    plan.query_type = 'general_qa'
    plan.intent_mode = 'llm_chat'
    plan.categories = []
    plan.semantic_query = ''
    plan.confidence = {
      score: 9,
      level: 'high',
      reasons: ['general_qa_shortcut', 'skip_spatial_compute']
    }
    return plan
  }

  if (LOCAL_HINTS.some((kw) => q.includes(kw))) {
    plan.query_type = 'poi_search'
    plan.intent_mode = 'local_search'
    plan.radius_m = 1000
    plan.aggregation_strategy.enable = false
    plan.categories = inferCategoriesFromQuestion(q, [])
    if (plan.categories.length > 0) {
      plan.semantic_query = plan.categories.join(' ')
    }
    plan.confidence = {
      score: 7,
      level: 'high',
      reasons: ['local_keyword_match']
    }
    return plan
  }

  if (MACRO_HINTS.some((kw) => q.includes(kw))) {
    plan.query_type = 'area_analysis'
    plan.intent_mode = 'macro_overview'
    plan.radius_m = 3000
    plan.aggregation_strategy = { enable: true, method: 'h3', resolution: 9, max_bins: 60 }
    plan.sampling_strategy = { enable: true, method: 'representative', count: 50, rules: ['diversity'] }
    plan.need_global_context = true
    plan.need_landmarks = true
    plan.categories = inferCategoriesFromQuestion(q, [])
    plan.confidence = {
      score: 7,
      level: 'high',
      reasons: ['macro_keyword_match']
    }
    return applyAreaAnalysisCategoryGuard(plan, question)
  }

  if (detectGraphReasoningNeed(question)) {
    plan.query_type = 'area_analysis'
    plan.intent_mode = 'macro_overview'
    plan.need_graph_reasoning = true
    plan.need_global_context = true
    plan.need_landmarks = true
    plan.aggregation_strategy = { enable: true, method: 'h3', resolution: 9, max_bins: 60 }
    plan.sampling_strategy = { enable: true, method: 'representative', count: 50, rules: ['diversity'] }
    plan.categories = inferCategoriesFromQuestion(q, [])
    plan.confidence = {
      score: 6,
      level: 'medium',
      reasons: ['graph_reasoning_hint']
    }
    return applyAreaAnalysisCategoryGuard(plan, question)
  }

  plan.query_type = 'area_analysis'
  plan.intent_mode = 'macro_overview'
  plan.need_global_context = true
  plan.need_landmarks = true
  plan.categories = inferCategoriesFromQuestion(q, [])
  plan.confidence = {
    score: 3,
    level: 'low',
    reasons: ['fallback_area_analysis']
  }

  const conflict = detectIntentConflict(question)
  if (conflict.hasConflict) {
    const localHit = LOCAL_HINTS.find((kw) => q.includes(kw)) || '\u5c40\u90e8\u68c0\u7d22'
    const macroHit = MACRO_HINTS.find((kw) => q.includes(kw)) || '\u5b8f\u89c2\u5206\u6790'
    plan.query_type = 'clarification_needed'
    plan.clarification_question = `\u4f60\u7684\u95ee\u9898\u540c\u65f6\u5305\u542b\u201c${localHit}\u201d\u548c\u201c${macroHit}\u201d\u3002\n\u4f60\u66f4\u5e0c\u671b\uff1a\n1. \u67e5\u770b\u533a\u57df\u6574\u4f53\u5206\u5e03\u4e0e\u5206\u6790\n2. \u5bfb\u627e\u5177\u4f53\u5019\u9009\u70b9\u5217\u8868`
  }

  return applyAreaAnalysisCategoryGuard(plan, question)
}

export async function parseIntent(userQuestion, context = {}) {
  const startTime = Date.now()
  const normalizedQuestion = String(userQuestion || '').trim()

  if (!normalizedQuestion) {
    return buildQuickPlannerOutput(normalizedQuestion, {
      reason: 'empty_question',
      startTime
    })
  }

  const fastPathDecision = shouldUseRuleFastPath(normalizedQuestion, context)
  if (fastPathDecision.bypass) {
    return buildQuickPlannerOutput(normalizedQuestion, {
      reason: fastPathDecision.reason,
      startTime,
      context
    })
  }

  let queryPlan = quickIntentClassify(normalizedQuestion)

  if (Array.isArray(context?.selectedCategories) && context.selectedCategories.length > 0) {
    queryPlan = {
      ...queryPlan,
      categories: uniq(context.selectedCategories)
    }
  }

  queryPlan = applyAreaAnalysisCategoryGuard(queryPlan, normalizedQuestion)
  queryPlan = applyContextAnchor(queryPlan, context)

  let tokenUsage = QUICK_TOKEN_USAGE
  let routerUsed = false
  let diagnostics = null

  if (shouldEnablePlannerLlm(context)) {
    try {
      const llmOutput = await callPlannerLlm(normalizedQuestion, context, queryPlan)
      if (llmOutput?.queryPlan && typeof llmOutput.queryPlan === 'object') {
        queryPlan = llmOutput.queryPlan
      }
      if (llmOutput?.tokenUsage && typeof llmOutput.tokenUsage === 'object') {
        tokenUsage = llmOutput.tokenUsage
      }
      if (llmOutput?.diagnostics && typeof llmOutput.diagnostics === 'object') {
        diagnostics = llmOutput.diagnostics
      }
      routerUsed = true
    } catch (err) {
      const reason = String(err?.message || 'planner_llm_error').slice(0, 120)
      const confidence = queryPlan?.confidence && typeof queryPlan.confidence === 'object'
        ? queryPlan.confidence
        : { score: 3, level: 'low', reasons: [] }
      const confidenceReasons = Array.isArray(confidence.reasons) ? confidence.reasons : []
      queryPlan = {
        ...queryPlan,
        confidence: sanitizePlannerConfidence({
          ...confidence,
          reasons: uniq([...confidenceReasons, `planner_llm_fallback:${reason}`])
        }, confidence)
      }
    }
  }

  if (Array.isArray(context?.selectedCategories) && context.selectedCategories.length > 0) {
    queryPlan = {
      ...queryPlan,
      categories: uniq(context.selectedCategories)
    }
  }

  queryPlan = applyAreaAnalysisCategoryGuard(queryPlan, normalizedQuestion)
  queryPlan = applyContextAnchor(queryPlan, context)

  const duration = Date.now() - startTime
  return {
    success: true,
    queryPlan,
    tokenUsage,
    duration,
    confidence: queryPlan?.confidence?.level || 'medium',
    fastPath: false,
    routerUsed,
    diagnostics
  }
}

export default {
  parseIntent,
  quickIntentClassify,
  applyAreaAnalysisCategoryGuard,
  QUERY_PLAN_DEFAULTS
}
