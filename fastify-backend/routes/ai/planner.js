import { extractCategoriesFromQuestion, expandCategory, CATEGORY_ONTOLOGY } from '../../services/categoryOntology.js'
import { shouldHardBlockInput } from '../../services/relevanceGate.js'

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

function buildQuickPlannerOutput(userQuestion, { reason = 'rule_fast_path', startTime = Date.now() } = {}) {
  if (reason === 'general_qa_meta' || reason === 'general_qa_help') {
    return {
      success: true,
      queryPlan: {
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
      },
      tokenUsage: QUICK_TOKEN_USAGE,
      duration: Date.now() - startTime,
      confidence: 'high',
      fastPath: true,
      routerUsed: false,
      fastPathReason: reason
    }
  }

  if (reason === 'irrelevant_input') {
    return {
      success: true,
      queryPlan: {
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
      },
      tokenUsage: QUICK_TOKEN_USAGE,
      duration: Date.now() - startTime,
      confidence: 'high',
      fastPath: true,
      routerUsed: false,
      fastPathReason: reason
    }
  }

  const quickPlan = quickIntentClassify(userQuestion)
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
      startTime
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

  const duration = Date.now() - startTime
  return {
    success: true,
    queryPlan,
    tokenUsage: QUICK_TOKEN_USAGE,
    duration,
    confidence: queryPlan?.confidence?.level || 'medium',
    fastPath: false,
    routerUsed: false
  }
}

export default {
  parseIntent,
  quickIntentClassify,
  applyAreaAnalysisCategoryGuard,
  QUERY_PLAN_DEFAULTS
}
