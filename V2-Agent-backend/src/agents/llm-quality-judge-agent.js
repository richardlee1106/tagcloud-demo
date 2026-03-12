import { createLlmGateway, resolveLlmEnabled, toBoolean } from '../llm/llm-gateway.js'

const ALLOWED_DECISIONS = new Set([
  'pass',
  'conditional',
  'narrow_scope',
  'handoff_legacy',
  'no_data'
])

function resolveJudgeEnabled() {
  if (process.env.V2_QUALITY_JUDGE_LLM_ENABLED != null) {
    return toBoolean(process.env.V2_QUALITY_JUDGE_LLM_ENABLED, true)
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

function summarizeSpecialists(specialistResults = []) {
  return specialistResults.map((result) => ({
    section_type: result?.section_type ?? 'unknown',
    summary_text: result?.summary_text ?? '',
    claims_count: Array.isArray(result?.claims) ? result.claims.length : 0,
    weak_claims_count: Array.isArray(result?.claims)
      ? result.claims.filter((claim) => (claim?.evidence_refs ?? []).length === 0).length
      : 0
  }))
}

function normalizeDecision(payload = {}) {
  const recommendedDecision = String(payload?.recommended_decision || '').trim()
  const judgeReason = String(payload?.judge_reason || '').trim()
  const confidence = Number(payload?.confidence)
  const shouldDowngrade = Boolean(payload?.should_downgrade)
  const canEmitDeep = payload?.can_emit_deep == null ? null : Boolean(payload.can_emit_deep)

  if (!ALLOWED_DECISIONS.has(recommendedDecision)) {
    return null
  }

  return {
    recommended_decision: recommendedDecision,
    judge_reason: judgeReason,
    confidence: Number.isFinite(confidence) ? Number(confidence.toFixed(2)) : null,
    should_downgrade: shouldDowngrade,
    can_emit_deep: canEmitDeep
  }
}

function normalizeDraftReview(payload = {}) {
  const base = normalizeDecision({
    recommended_decision: payload?.recommended_decision,
    judge_reason: payload?.judge_reason,
    confidence: payload?.confidence,
    should_downgrade: payload?.should_downgrade,
    can_emit_deep: payload?.can_emit_deep
  })

  if (!base) {
    return null
  }

  return {
    ...base,
    should_refine: Boolean(payload?.should_refine),
    rewrite_guidance: String(payload?.rewrite_guidance || '').trim()
  }
}

function buildPrompt({
  query = '',
  objectiveContract,
  groundingResult,
  specialistResults = [],
  ruleDecision
} = {}) {
  return [
    'You are a strict quality judge for GIS analysis outputs.',
    'Judge whether the rule-based decision should be downgraded for safety.',
    'Output JSON only with keys: recommended_decision, should_downgrade, can_emit_deep, confidence, judge_reason.',
    '',
    'Allowed recommended_decision values: pass, conditional, narrow_scope, handoff_legacy, no_data',
    '',
    `Query: ${query}`,
    `Objective: ${objectiveContract?.objective ?? 'unknown'}`,
    `Coverage: ${JSON.stringify(groundingResult?.coverage ?? {})}`,
    `Must cover: ${JSON.stringify(objectiveContract?.must_cover ?? [])}`,
    `Rule decision: ${JSON.stringify(ruleDecision ?? {})}`,
    `Specialist summary: ${JSON.stringify(summarizeSpecialists(specialistResults))}`,
    '',
    'Downgrade only when evidence is weak, contradictory, or scope is clearly unsuitable.'
  ].join('\n')
}

function buildDraftReviewPrompt({
  query = '',
  objectiveContract,
  groundingResult,
  specialistResults = [],
  qualityDecision,
  draftAnswer = null
} = {}) {
  return [
    'You are reviewing a draft GIS answer before it reaches the user.',
    'Judge whether the answer is persuasive, grounded, and aligned with the user intent.',
    'Output JSON only with keys: recommended_decision, should_downgrade, can_emit_deep, should_refine, confidence, judge_reason, rewrite_guidance.',
    '',
    'Allowed recommended_decision values: pass, conditional, narrow_scope, handoff_legacy, no_data',
    '',
    `Query: ${query}`,
    `Objective: ${objectiveContract?.objective ?? 'unknown'}`,
    `Coverage: ${JSON.stringify(groundingResult?.coverage ?? {})}`,
    `Current decision: ${JSON.stringify(qualityDecision ?? {})}`,
    `Specialist summary: ${JSON.stringify(summarizeSpecialists(specialistResults))}`,
    `Draft answer: ${JSON.stringify(draftAnswer ?? {})}`,
    '',
    'Set should_refine=true only when the answer can be materially improved without inventing facts.',
    'rewrite_guidance must be one concise instruction sentence when should_refine=true.'
  ].join('\n')
}

export function createLlmQualityJudgeAgent({
  enabled = resolveJudgeEnabled(),
  llmGateway = createLlmGateway({
    enabled,
    localTimeoutMs: Number(process.env.V2_QUALITY_JUDGE_LLM_TIMEOUT_MS || 1100),
    cloudTimeoutMs: Number(process.env.V2_QUALITY_JUDGE_CLOUD_TIMEOUT_MS || 1700)
  })
} = {}) {
  return {
    async judge({
      query = '',
      objectiveContract = null,
      groundingResult = null,
      specialistResults = [],
      ruleDecision = null
    } = {}) {
      if (!enabled) {
        return null
      }

      const response = await llmGateway.chat({
        systemPrompt: [
          'You are a conservative GIS quality judge.',
          'Return strict JSON only.'
        ].join(' '),
        userPrompt: buildPrompt({
          query,
          objectiveContract,
          groundingResult,
          specialistResults,
          ruleDecision
        }),
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

      return normalizeDecision(parsed)
    },
    async reviewDraft({
      query = '',
      objectiveContract = null,
      groundingResult = null,
      specialistResults = [],
      qualityDecision = null,
      draftAnswer = null
    } = {}) {
      if (!enabled) {
        return null
      }

      const response = await llmGateway.chat({
        systemPrompt: [
          'You are a conservative GIS draft reviewer.',
          'Return strict JSON only.'
        ].join(' '),
        userPrompt: buildDraftReviewPrompt({
          query,
          objectiveContract,
          groundingResult,
          specialistResults,
          qualityDecision,
          draftAnswer
        }),
        temperature: 0,
        maxTokens: 280
      })

      if (!response?.text) {
        return null
      }

      const parsed = parseJsonResponse(response.text)
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      return normalizeDraftReview(parsed)
    }
  }
}
