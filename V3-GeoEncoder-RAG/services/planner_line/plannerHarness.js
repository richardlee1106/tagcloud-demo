import { callLLM, getLLMConfig } from '../ai/llmService.js'
import { buildPlannerPromptBundle } from './plannerPrompts.js'
import {
  buildPlannerRepairPrompt,
  validatePlannerModelOutput
} from './plannerOutputValidator.js'

function buildPlannerLlmOptions(llmOptions = {}) {
  const configuredPlannerModel = String(
    process.env.PLANNER_MODEL
    || process.env.OLLAMA_REASONING_MODEL
    || process.env.OLLAMA_MODEL
    || ''
  ).trim()
  const configuredPlannerBaseUrl = String(process.env.PLANNER_BASE_URL || '').trim()

  return {
    temperature: 0,
    maxTokens: 4096,
    ...(configuredPlannerBaseUrl ? { baseUrl: configuredPlannerBaseUrl } : {}),
    ...(configuredPlannerModel ? { model: configuredPlannerModel } : {}),
    ...(llmOptions || {})
  }
}

export const PLANNER_EVAL_QUERIES = Object.freeze([
  '武汉大学附近有哪些咖啡店？',
  '湖北大学附近有哪些地铁站？',
  '武汉大学附近有哪些医院？',
  '武汉大学附近有哪些商超？',
  '光谷附近有哪些咖啡店？',
  '请分析武汉大学附近的配套、热门业态和明显缺口。',
  '请分析湖北大学附近的配套、热门业态和明显缺口。',
  '请概览武汉大学附近的空间结构和业态分布。',
  '武汉大学附近适合布局什么业态？',
  '比较武汉大学和湖北大学附近的业态差异。'
])

function buildRepairMessages(promptBundle, repairPrompt) {
  return [
    { role: 'system', content: promptBundle.system_prompt },
    ...promptBundle.messages.slice(1, -1),
    { role: 'user', content: repairPrompt }
  ]
}

export async function generatePlannerPlanForQuery(userQuery, {
  llmCall = callLLM,
  max_repairs: maxRepairs = 1,
  llm_options: llmOptions = {},
  prompt_profile: promptProfile = 'full'
} = {}) {
  const promptBundle = buildPlannerPromptBundle({
    user_query: userQuery,
    prompt_profile: promptProfile
  })
  const attempts = []
  let activeMessages = promptBundle.messages
  const effectiveLlmOptions = buildPlannerLlmOptions(llmOptions)

  for (let attemptIndex = 0; attemptIndex <= maxRepairs; attemptIndex += 1) {
    const rawOutput = await llmCall(activeMessages, effectiveLlmOptions)
    const validation = validatePlannerModelOutput(rawOutput)

    attempts.push({
      attempt_index: attemptIndex,
      kind: attemptIndex === 0 ? 'initial' : 'repair',
      raw_output: rawOutput,
      validation
    })

    if (validation.ok) {
      return {
        user_query: userQuery,
        ok: true,
        plan: validation.plan,
        prompt_bundle: promptBundle,
        attempts
      }
    }

    if (attemptIndex < maxRepairs) {
      const repairPrompt = buildPlannerRepairPrompt({
        user_query: userQuery,
        raw_output: rawOutput,
        errors: validation.errors
      })
      activeMessages = buildRepairMessages(promptBundle, repairPrompt)
    }
  }

  return {
    user_query: userQuery,
    ok: false,
    plan: null,
    prompt_bundle: promptBundle,
    attempts
  }
}

export function summarizePlannerEvaluation(results = []) {
  const normalizedResults = Array.isArray(results) ? results : []
  const failedResults = normalizedResults.filter((item) => !item?.ok)

  const parseFailures = failedResults.filter((item) => {
    const finalAttempt = item?.attempts?.[item.attempts.length - 1]
    return Boolean(finalAttempt?.validation?.parse_error)
  }).length

  const validationFailures = failedResults.filter((item) => {
    const finalAttempt = item?.attempts?.[item.attempts.length - 1]
    return !finalAttempt?.validation?.parse_error
  }).length

  return {
    total_queries: normalizedResults.length,
    passed_queries: normalizedResults.filter((item) => item?.ok).length,
    failed_queries: failedResults.length,
    parse_failures: parseFailures,
    validation_failures: validationFailures,
    first_pass_successes: normalizedResults.filter((item) => item?.ok && item?.attempts?.length === 1).length,
    repaired_successes: normalizedResults.filter((item) => item?.ok && item?.attempts?.length > 1).length
  }
}

export async function evaluatePlannerQueries(queries = PLANNER_EVAL_QUERIES, options = {}) {
  const results = []

  for (const query of queries) {
    const startAt = Date.now()
    const result = await generatePlannerPlanForQuery(query, options)
    results.push({
      ...result,
      wall_ms: Date.now() - startAt
    })
  }

  return {
    generated_at: new Date().toISOString(),
    results,
    summary: summarizePlannerEvaluation(results)
  }
}

export async function getPlannerRuntimeInfo() {
  const llmConfig = await getLLMConfig()
  return {
    provider: llmConfig.provider,
    model: llmConfig.model,
    base_url: llmConfig.baseUrl
  }
}

export default {
  evaluatePlannerQueries,
  generatePlannerPlanForQuery,
  getPlannerRuntimeInfo,
  PLANNER_EVAL_QUERIES,
  summarizePlannerEvaluation
}
