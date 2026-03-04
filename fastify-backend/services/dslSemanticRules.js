function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeQueryType(dsl = {}) {
  return normalizeText(dsl?.task?.query_type || dsl?.query_type).toLowerCase() || 'poi_search'
}

function normalizeRiskLevel(dsl = {}) {
  return normalizeText(dsl?.uncertainty?.risk_level).toLowerCase() || 'low'
}

function pushError(errors, {
  rule_id,
  path,
  message,
  fix_hint = null
}) {
  errors.push({
    rule_id: normalizeText(rule_id) || 'SEMANTIC_RULE_VIOLATION',
    path: normalizeText(path) || '$',
    message: normalizeText(message) || 'Semantic validation failed',
    fix_hint: fix_hint ? normalizeText(fix_hint) : null
  })
}

function hasOperatorByType(operators = [], targetType = '') {
  const expected = normalizeText(targetType).toLowerCase()
  if (!expected) return false
  return operators.some((op) => normalizeText(op?.type).toLowerCase() === expected)
}

function collectDagErrors(operators = [], errors = []) {
  const idSet = new Set()
  const adjacency = new Map()

  for (const op of operators) {
    const id = normalizeText(op?.id)
    if (!id) continue

    if (idSet.has(id)) {
      pushError(errors, {
        rule_id: 'DAG_OPERATOR_ID_DUPLICATE',
        path: 'operators',
        message: `Duplicate operator id detected: ${id}`,
        fix_hint: 'Ensure every operators[i].id is globally unique.'
      })
    }
    idSet.add(id)
    adjacency.set(id, Array.isArray(op?.depends_on) ? op.depends_on.map((dep) => normalizeText(dep)).filter(Boolean) : [])
  }

  for (const [id, deps] of adjacency.entries()) {
    for (const depId of deps) {
      if (!idSet.has(depId)) {
        pushError(errors, {
          rule_id: 'DAG_DEPENDS_ON_MISSING',
          path: 'operators.depends_on',
          message: `Operator "${id}" depends_on missing node "${depId}".`,
          fix_hint: 'Ensure all depends_on references point to existing operators.id values.'
        })
      }
    }
  }

  const visiting = new Set()
  const visited = new Set()

  function detectCycle(nodeId) {
    if (visited.has(nodeId)) return false
    if (visiting.has(nodeId)) return true

    visiting.add(nodeId)
    const deps = adjacency.get(nodeId) || []
    for (const depId of deps) {
      if (!adjacency.has(depId)) continue
      if (detectCycle(depId)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }

  for (const nodeId of adjacency.keys()) {
    if (detectCycle(nodeId)) {
      pushError(errors, {
        rule_id: 'DAG_CYCLE_DETECTED',
        path: 'operators.depends_on',
        message: 'Operators graph contains at least one dependency cycle.',
        fix_hint: 'Break cyclic depends_on references and keep operators as a DAG.'
      })
      break
    }
  }
}

export function validateDslSemanticRules(dsl = {}, runtimeContext = {}) {
  const errors = []
  const operators = Array.isArray(dsl?.operators) ? dsl.operators : []
  const queryType = normalizeQueryType(dsl)
  const scope = dsl?.scope && typeof dsl.scope === 'object' ? dsl.scope : {}
  const uncertainty = dsl?.uncertainty && typeof dsl.uncertainty === 'object' ? dsl.uncertainty : {}
  const routing = dsl?.routing && typeof dsl.routing === 'object' ? dsl.routing : {}
  const outputContract = dsl?.output_contract && typeof dsl.output_contract === 'object' ? dsl.output_contract : {}
  const policy = dsl?.policy && typeof dsl.policy === 'object' ? dsl.policy : {}
  const task = dsl?.task && typeof dsl.task === 'object' ? dsl.task : {}
  const enforceOperatorRules = runtimeContext.enforceOperatorRules !== false

  collectDagErrors(operators, errors)

  if (queryType === 'region_comparison') {
    if (normalizeText(scope?.geometry_source).toLowerCase() !== 'regions') {
      pushError(errors, {
        rule_id: 'REGION_COMPARISON_SCOPE_INVALID',
        path: 'scope.geometry_source',
        message: 'region_comparison requires scope.geometry_source="regions".',
        fix_hint: 'Set scope.geometry_source to "regions".'
      })
    }

    const regionIds = Array.isArray(scope?.region_ids) ? scope.region_ids : []
    if (regionIds.length < 2) {
      pushError(errors, {
        rule_id: 'REGION_COMPARISON_REGION_IDS_MIN_2',
        path: 'scope.region_ids',
        message: 'region_comparison requires at least 2 region_ids.',
        fix_hint: 'Provide two or more region ids in scope.region_ids.'
      })
    }

    if (enforceOperatorRules && !hasOperatorByType(operators, 'region_compare')) {
      pushError(errors, {
        rule_id: 'REGION_COMPARISON_OPERATOR_MISSING',
        path: 'operators',
        message: 'region_comparison requires a region_compare operator.',
        fix_hint: 'Add an enabled operator with type="region_compare".'
      })
    }
  }

  if (queryType === 'graph_reasoning' && enforceOperatorRules && !hasOperatorByType(operators, 'graph_reasoning')) {
    pushError(errors, {
      rule_id: 'GRAPH_REASONING_OPERATOR_MISSING',
      path: 'operators',
      message: 'graph_reasoning query requires a graph_reasoning operator.',
      fix_hint: 'Add an enabled operator with type="graph_reasoning".'
    })
  }

  if (queryType === 'counterfactual' && enforceOperatorRules && !hasOperatorByType(operators, 'counterfactual_eval')) {
    pushError(errors, {
      rule_id: 'COUNTERFACTUAL_OPERATOR_MISSING',
      path: 'operators',
      message: 'counterfactual query requires a counterfactual_eval operator.',
      fix_hint: 'Add an enabled operator with type="counterfactual_eval".'
    })
  }

  if (queryType === 'clarification_needed' && uncertainty?.clarification?.required !== true) {
    pushError(errors, {
      rule_id: 'CLARIFICATION_FLAG_REQUIRED',
      path: 'uncertainty.clarification.required',
      message: 'clarification_needed query requires clarification.required=true.',
      fix_hint: 'Set uncertainty.clarification.required=true for clarification_needed.'
    })
  }

  if (task?.need_text_answer === false && outputContract?.include_writer_text === true) {
    pushError(errors, {
      rule_id: 'WRITER_OUTPUT_CONTRACT_MISMATCH',
      path: 'output_contract.include_writer_text',
      message: 'need_text_answer=false is incompatible with include_writer_text=true.',
      fix_hint: 'Set output_contract.include_writer_text=false when task.need_text_answer=false.'
    })
  }

  const riskLevel = normalizeRiskLevel(dsl)
  if ((riskLevel === 'high' || riskLevel === 'critical') && routing?.critic_enabled !== true) {
    pushError(errors, {
      rule_id: 'RISK_CRITIC_REQUIRED',
      path: 'routing.critic_enabled',
      message: 'high/critical risk requires routing.critic_enabled=true.',
      fix_hint: 'Enable critic for high and critical risk levels.'
    })
  }

  const plannerConfidence = Number(uncertainty?.planner_confidence)
  if (riskLevel === 'critical' && Number.isFinite(plannerConfidence) && plannerConfidence < 0.7) {
    if (uncertainty?.clarification?.required !== true) {
      pushError(errors, {
        rule_id: 'CRITICAL_LOW_CONFIDENCE_NEEDS_CLARIFICATION',
        path: 'uncertainty.clarification.required',
        message: 'critical risk with planner_confidence < 0.7 must require clarification.',
        fix_hint: 'Set uncertainty.clarification.required=true.'
      })
    }
  }

  if (normalizeText(policy?.cache_key_profile).toLowerCase() === 'no_cache' && policy?.cacheable !== false) {
    pushError(errors, {
      rule_id: 'NO_CACHE_PROFILE_REQUIRES_NON_CACHEABLE',
      path: 'policy.cacheable',
      message: 'cache_key_profile=no_cache requires cacheable=false.',
      fix_hint: 'Set policy.cacheable=false when cache_key_profile=no_cache.'
    })
  }

  return {
    ok: errors.length === 0,
    errors,
    fix_hint: errors.find((item) => item.fix_hint)?.fix_hint || null
  }
}

export default {
  validateDslSemanticRules
}
