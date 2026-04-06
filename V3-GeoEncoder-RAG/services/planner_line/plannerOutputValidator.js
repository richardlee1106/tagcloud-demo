import { validatePlannerPlan } from './planValidator.js'
import { PLANNER_OUTPUT_CONTRACT } from './plannerPrompts.js'

function stripNoise(raw = '') {
  return String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json/gi, '```')
    .trim()
}

function collectFencedCandidates(cleaned = '') {
  const matches = [...cleaned.matchAll(/```([\s\S]*?)```/g)]
  return matches
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
}

function collectBalancedObjectCandidates(cleaned = '') {
  const candidates = []

  for (let start = 0; start < cleaned.length; start += 1) {
    if (cleaned[start] !== '{') continue

    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index]

      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (inString) continue

      if (char === '{') depth += 1
      if (char === '}') {
        depth -= 1
        if (depth === 0) {
          candidates.push(cleaned.slice(start, index + 1).trim())
          break
        }
      }
    }
  }

  return candidates
}

export function extractPlannerPlanCandidates(rawOutput = '') {
  const cleaned = stripNoise(rawOutput)
  const deduped = new Set()

  for (const candidate of [
    ...collectBalancedObjectCandidates(cleaned),
    ...collectFencedCandidates(cleaned)
  ]) {
    if (!candidate) continue
    deduped.add(candidate)
  }

  return [...deduped]
}

export function extractPlannerPlanJson(rawOutput = '') {
  const candidates = extractPlannerPlanCandidates(rawOutput)
  if (candidates.length === 0) {
    const cleaned = stripNoise(rawOutput)
    if (!cleaned.includes('{')) {
      throw new Error('No JSON object start found in planner output')
    }
    throw new Error('No complete JSON object found in planner output')
  }
  return candidates[0]
}

export function validatePlannerModelOutput(rawOutput = '') {
  const candidates = extractPlannerPlanCandidates(rawOutput)
  const parseErrors = []
  const parsedCandidates = []

  for (const jsonText of candidates) {
    try {
      const plan = JSON.parse(jsonText)
      const validation = validatePlannerPlan(plan)
      parsedCandidates.push({
        jsonText,
        plan,
        validation
      })
    } catch (error) {
      parseErrors.push(error.message)
    }
  }

  const validCandidate = parsedCandidates.find((candidate) => candidate.validation.ok)
  if (validCandidate) {
    return {
      ok: true,
      plan: validCandidate.plan,
      raw_json: validCandidate.jsonText,
      parse_error: null,
      validation_errors: [],
      errors: []
    }
  }

  if (parsedCandidates.length > 0) {
    const bestCandidate = [...parsedCandidates]
      .sort((left, right) => left.validation.errors.length - right.validation.errors.length)[0]

    return {
      ok: false,
      plan: bestCandidate.plan,
      raw_json: bestCandidate.jsonText,
      parse_error: null,
      validation_errors: bestCandidate.validation.errors,
      errors: bestCandidate.validation.errors
    }
  }

  try {
    extractPlannerPlanJson(rawOutput)
  } catch (error) {
    return {
      ok: false,
      plan: null,
      raw_json: null,
      parse_error: error.message,
      validation_errors: [],
      errors: [error.message]
    }
  }

  const fallbackError = parseErrors[0] || 'Unable to parse planner output as JSON'
  return {
    ok: false,
    plan: null,
    raw_json: null,
    parse_error: fallbackError,
    validation_errors: [],
    errors: [fallbackError]
  }
}

export function buildPlannerRepairPrompt({
  user_query: userQuery,
  errors = []
} = {}) {
  return [
    '上一次 planner 输出没有通过校验，请根据下面的错误重新生成完整 JSON。',
    PLANNER_OUTPUT_CONTRACT,
    '不要复述或修补上一次的输出，直接重新生成。',
    `用户问题：${String(userQuery || '').trim()}`,
    '校验错误：',
    ...(errors.length > 0 ? errors.map((item) => `- ${item}`) : ['- 未知错误']),
    '请输出修正后的完整 JSON 对象。'
  ].join('\n')
}

export default {
  buildPlannerRepairPrompt,
  extractPlannerPlanCandidates,
  extractPlannerPlanJson,
  validatePlannerModelOutput
}
