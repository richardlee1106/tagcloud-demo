function normalizeText(value) {
  return String(value || '').trim()
}

const BUDGET_TIER_LATENCY_LIMITS = Object.freeze({
  realtime: 1500,
  interactive: 5000,
  deep: 12000
})

function pushError(errors, {
  rule_id,
  path,
  message,
  fix_hint = null
}) {
  errors.push({
    rule_id: normalizeText(rule_id) || 'POLICY_RULE_VIOLATION',
    path: normalizeText(path) || '$',
    message: normalizeText(message) || 'Policy validation failed',
    fix_hint: fix_hint ? normalizeText(fix_hint) : null
  })
}

export function validateDslPolicyRules(dsl = {}) {
  const errors = []
  const constraints = dsl?.constraints && typeof dsl.constraints === 'object' ? dsl.constraints : {}
  const policy = dsl?.policy && typeof dsl.policy === 'object' ? dsl.policy : {}

  const budgetTier = normalizeText(policy?.budget_tier).toLowerCase()
  const latencyBudgetMs = Number(constraints?.latency_budget_ms)
  const expectedMax = BUDGET_TIER_LATENCY_LIMITS[budgetTier]

  if (Number.isFinite(expectedMax) && Number.isFinite(latencyBudgetMs) && latencyBudgetMs > expectedMax) {
    pushError(errors, {
      rule_id: 'POLICY_BUDGET_TIER_MISMATCH',
      path: 'constraints.latency_budget_ms',
      message: `budget_tier=${budgetTier} requires latency_budget_ms <= ${expectedMax}, got ${latencyBudgetMs}.`,
      fix_hint: `Set constraints.latency_budget_ms <= ${expectedMax} or switch policy.budget_tier.`
    })
  }

  return {
    ok: errors.length === 0,
    errors,
    fix_hint: errors.find((item) => item.fix_hint)?.fix_hint || null
  }
}

export default {
  validateDslPolicyRules
}
