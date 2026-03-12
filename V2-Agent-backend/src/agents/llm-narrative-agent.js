import { createLlmGateway, resolveLlmEnabled, toBoolean } from '../llm/llm-gateway.js'

function summarizeMetrics(metrics = {}) {
  const summary = {}
  if (!metrics || typeof metrics !== 'object') {
    return summary
  }

  if (metrics.category_counts && typeof metrics.category_counts === 'object') {
    const topCategories = Object.entries(metrics.category_counts)
      .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }))
    summary.top_categories = topCategories
  }

  if (metrics.quadrant_counts && typeof metrics.quadrant_counts === 'object') {
    summary.quadrant_counts = metrics.quadrant_counts
  }

  const scalarKeys = ['total_poi', 'delta', 'winner', 'target_quadrant', 'top_quadrant']
  for (const key of scalarKeys) {
    if (metrics[key] != null) {
      summary[key] = metrics[key]
    }
  }

  return summary
}

function collectTopPois(groundingResult = {}, limit = 8) {
  const features = groundingResult?.working_set?.poi_features ?? []
  const seen = new Set()
  const picks = []

  for (const feature of features) {
    const name = String(feature?.properties?.name || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    picks.push({
      name,
      category: feature?.properties?.category ?? 'unknown',
      district: feature?.properties?.district ?? null
    })
    if (picks.length >= limit) break
  }

  return picks
}

function buildPayload({
  query = '',
  objectiveContract,
  groundingResult,
  specialistResults = [],
  qualityDecision,
  deterministicText = '',
  priorAnswer = '',
  reviewFeedback = ''
} = {}) {
  return {
    query,
    objective: objectiveContract?.objective ?? 'unknown',
    response_mode: objectiveContract?.response_mode ?? 'brief_30s',
    must_cover: objectiveContract?.must_cover ?? [],
    coverage: groundingResult?.coverage ?? {},
    no_data_ladder: groundingResult?.no_data_ladder ?? [],
    quality_decision: qualityDecision?.decision ?? 'unknown',
    required_disclaimers: qualityDecision?.required_disclaimers ?? [],
    specialist_sections: specialistResults.map((result) => ({
      section_type: result?.section_type ?? 'unknown',
      summary_text: result?.summary_text ?? '',
      claims: (result?.claims ?? []).slice(0, 2).map((claim) => ({
        statement: claim?.statement ?? '',
        confidence: claim?.confidence ?? null
      })),
      metrics: summarizeMetrics(result?.metrics ?? {})
    })),
    top_pois: collectTopPois(groundingResult),
    deterministic_summary: deterministicText,
    prior_answer: priorAnswer,
    review_feedback: reviewFeedback
  }
}

function resolveNarrativeEnabled() {
  if (process.env.V2_NARRATIVE_LLM_ENABLED != null) {
    return toBoolean(process.env.V2_NARRATIVE_LLM_ENABLED, true)
  }
  return resolveLlmEnabled()
}

export function createLlmNarrativeAgent({
  enabled = resolveNarrativeEnabled(),
  llmGateway = createLlmGateway({
    enabled
  })
} = {}) {
  return {
    async generate({
      query = '',
      objectiveContract = null,
      groundingResult = null,
      specialistResults = [],
      qualityDecision = null,
      deterministicText = '',
      priorAnswer = '',
      reviewFeedback = ''
    } = {}) {
      if (!enabled) {
        return ''
      }

      const payload = buildPayload({
        query,
        objectiveContract,
        groundingResult,
        specialistResults,
        qualityDecision,
        deterministicText,
        priorAnswer,
        reviewFeedback
      })

      const systemPrompt = [
        'You are a GIS analysis agent writing the final user-facing narrative.',
        'Use only provided evidence and specialist outputs.',
        'Do not invent POI names, counts, metrics, or claims.',
        'Prefer concise Chinese output unless the user query is clearly English.',
        'Output 2-4 sentences, no markdown headings, no bullet list.',
        'If evidence is sparse or partial, include one explicit uncertainty sentence.'
      ].join(' ')

      const userPrompt = [
        'Generate a concise analyst answer directly from the structured JSON evidence.',
        'You may use deterministic_summary as a fallback hint only.',
        'If prior_answer and review_feedback are present, revise the answer to satisfy the review feedback while staying grounded.',
        'Input JSON evidence:',
        JSON.stringify(payload)
      ].join('\n')

      const response = await llmGateway.chat({
        systemPrompt,
        userPrompt,
        temperature: 0.2,
        maxTokens: 320
      })

      return response?.text ?? ''
    },
    async rewrite(input = {}) {
      return this.generate(input)
    }
  }
}
