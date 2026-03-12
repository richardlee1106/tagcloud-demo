export function buildSpecialistTaskPlan({
  routingOutput,
  objectiveContract,
  fallbackSpecialistsByObjective = {},
  groundingResult
} = {}) {
  const objective = String(routingOutput?.objective || '').trim()
  const fallbackPlan = fallbackSpecialistsByObjective?.[objective] ?? []
  const routedSpecialists = Array.isArray(routingOutput?.selected_agents) ? routingOutput.selected_agents : []
  const mustCover = Array.isArray(objectiveContract?.must_cover) ? objectiveContract.must_cover : []

  const selected = routedSpecialists.length > 0 ? [...routedSpecialists] : [...fallbackPlan]
  for (const section of mustCover) {
    if (!selected.includes(section)) {
      selected.push(section)
    }
  }

  return selected.map((specialistId) => ({
    specialist_id: specialistId,
    objectiveContract,
    groundingResult
  }))
}

export function computeMissingMustCoverSections({
  objectiveContract,
  specialistResults
} = {}) {
  const mustCover = new Set(Array.isArray(objectiveContract?.must_cover) ? objectiveContract.must_cover : [])
  if (mustCover.size === 0) {
    return []
  }

  const covered = new Set(
    (Array.isArray(specialistResults) ? specialistResults : [])
      .map((result) => result?.section_type)
      .filter(Boolean)
  )

  return Array.from(mustCover).filter((section) => !covered.has(section))
}

export function applyLatencyGate({
  qualityDecision = {},
  objectiveContract,
  elapsedMs
} = {}) {
  const latencyBudgetMs = Number(objectiveContract?.latency_budget_ms || 0) || 0
  if (latencyBudgetMs <= 0 || Number.isNaN(elapsedMs) || elapsedMs <= latencyBudgetMs) {
    return qualityDecision
  }

  const nextDecision = {
    ...qualityDecision,
    reason_codes: Array.isArray(qualityDecision.reason_codes) ? [...qualityDecision.reason_codes] : [],
    required_disclaimers: Array.isArray(qualityDecision.required_disclaimers)
      ? [...qualityDecision.required_disclaimers]
      : [],
    allowed_output: {
      can_emit_fast: qualityDecision?.allowed_output?.can_emit_fast !== false,
      can_emit_deep: false,
      can_claim_artifact: qualityDecision?.allowed_output?.can_claim_artifact === true
    }
  }

  if (!nextDecision.reason_codes.includes('latency_budget_exceeded')) {
    nextDecision.reason_codes.push('latency_budget_exceeded')
  }

  if (!nextDecision.required_disclaimers.some((entry) => String(entry).includes('Latency budget'))) {
    nextDecision.required_disclaimers.push('Latency budget exceeded; deep lane is skipped for this run.')
  }

  if (!nextDecision.next_action || nextDecision.next_action === 'continue') {
    nextDecision.next_action = 'continue_with_constraints'
  }

  return nextDecision
}

export function applyArtifactPolicy({
  payload,
  objectiveContract
} = {}) {
  if (!payload || typeof payload !== 'object') {
    return payload
  }

  const requiresArtifact = objectiveContract?.artifact_policy?.artifact_required === true
  if (requiresArtifact) {
    return payload
  }

  if ('artifact' in payload) {
    const { artifact, ...rest } = payload
    return rest
  }

  return payload
}
