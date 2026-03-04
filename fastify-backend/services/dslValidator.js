import { readFileSync } from 'fs'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { validateDslSemanticRules } from './dslSemanticRules.js'
import { validateDslPolicyRules } from './dslPolicyRules.js'

const SPATIAL_DSL_SCHEMA = JSON.parse(
  readFileSync(new URL('../schemas/spatial_query_v1.schema.json', import.meta.url), 'utf8')
)

function buildSchemaValidator({ removeAdditional = false } = {}) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    removeAdditional
  })
  addFormats(ajv)
  return ajv.compile(SPATIAL_DSL_SCHEMA)
}

const strictSchemaValidator = buildSchemaValidator({ removeAdditional: false })
const compatSchemaValidator = buildSchemaValidator({ removeAdditional: 'all' })

function normalizeText(value) {
  return String(value || '').trim()
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function deepClone(value) {
  if (value == null) return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

function normalizeCompatMode(runtimeContext = {}) {
  const explicit = normalizeText(runtimeContext.compatMode).toLowerCase()
  if (explicit === 'strict') return 'strict'
  if (explicit === 'compat') return 'compat'

  const strictEnabled = toBoolean(
    process.env.DSL_V1_COMPAT_MODE
    ?? process.env.V1_COMPAT_MODE
    ?? 'false',
    false
  )
  return strictEnabled ? 'strict' : 'compat'
}

function isSpatialDslObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (normalizeText(value.dsl_version).toLowerCase() !== 'spatial_query_v1') return false
  const requiredKeys = [
    'task',
    'scope',
    'entities',
    'constraints',
    'operators',
    'output_contract',
    'uncertainty',
    'policy'
  ]
  return requiredKeys.every((key) => key in value)
}

function normalizePlannerConfidence(confidence) {
  const score = Number(confidence?.score)
  if (Number.isFinite(score)) {
    if (score >= 0 && score <= 1) return score
    if (score >= 0 && score <= 10) return Math.max(0, Math.min(1, score / 10))
  }

  const level = normalizeText(confidence?.level).toLowerCase()
  if (level === 'high') return 0.85
  if (level === 'low') return 0.45
  return 0.65
}

function inferScopeFromLegacyPlan(queryPlan = {}, spatialContext = {}) {
  const explicitScope = queryPlan?.scope
  if (explicitScope && typeof explicitScope === 'object' && !Array.isArray(explicitScope)) {
    return { ...explicitScope }
  }

  const regionIdsFromQuery = Array.isArray(queryPlan?.region_ids) ? queryPlan.region_ids : []
  const regionIdsFromContext = Array.isArray(spatialContext?.regions)
    ? spatialContext.regions
      .map((region) => normalizeText(region?.id || region?.name))
      .filter(Boolean)
    : []

  const regionIds = [...new Set([...regionIdsFromQuery, ...regionIdsFromContext])]
  if (regionIds.length > 0) {
    return {
      geometry_source: 'regions',
      region_ids: regionIds.slice(0, 50)
    }
  }

  if (Array.isArray(spatialContext?.boundary) && spatialContext.boundary.length >= 3) {
    return {
      geometry_source: 'polygon',
      polygon: spatialContext.boundary
    }
  }

  if (spatialContext?.center && Number.isFinite(Number(spatialContext?.radius))) {
    return {
      geometry_source: 'circle',
      circle: {
        center: {
          lon: Number(spatialContext.center.lon ?? spatialContext.center[0]),
          lat: Number(spatialContext.center.lat ?? spatialContext.center[1])
        },
        radius_m: Number(spatialContext.radius)
      }
    }
  }

  if (Array.isArray(spatialContext?.viewport) && spatialContext.viewport.length >= 4) {
    return {
      geometry_source: 'viewport',
      viewport: spatialContext.viewport.slice(0, 4).map((value) => Number(value))
    }
  }

  return {
    geometry_source: 'global'
  }
}

function normalizeLegacyOperators(queryPlan = {}) {
  if (!Array.isArray(queryPlan?.operators)) return []
  return queryPlan.operators
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const type = normalizeText(item.type)
      return {
        id: normalizeText(item.id) || `op_${index + 1}`,
        type,
        depends_on: Array.isArray(item.depends_on)
          ? item.depends_on.map((dep) => normalizeText(dep)).filter(Boolean)
          : [],
        params: item.params && typeof item.params === 'object' ? { ...item.params } : {},
        enabled: item.enabled !== false
      }
    })
}

function toLegacyDslEnvelope(queryPlan = {}, runtimeContext = {}) {
  const spatialContext = runtimeContext?.spatialContext || {}
  const options = runtimeContext?.options || {}
  const queryType = normalizeText(queryPlan?.query_type || queryPlan?.queryType).toLowerCase() || 'poi_search'

  const operators = normalizeLegacyOperators(queryPlan)
  const categories = Array.isArray(queryPlan?.categories) ? queryPlan.categories : []
  const selectedCategories = Array.isArray(options?.selectedCategories) ? options.selectedCategories : []
  const mergedCategories = [...new Set([...categories, ...selectedCategories].map((item) => normalizeText(item)).filter(Boolean))]

  const needTextAnswer = queryPlan?.need_text_answer !== false
  const plannerConfidence = normalizePlannerConfidence(queryPlan?.confidence || {})
  const rawRiskLevel = normalizeText(queryPlan?.risk_level || queryPlan?.uncertainty?.risk_level || queryPlan?.confidence?.level).toLowerCase()
  const riskLevel = rawRiskLevel === 'critical'
    ? 'critical'
    : rawRiskLevel === 'high'
      ? 'high'
      : rawRiskLevel === 'low'
        ? 'low'
        : 'medium'
  const clarificationRequired = queryType === 'clarification_needed' || queryPlan?.clarification_required === true
  const clarificationQuestion = normalizeText(queryPlan?.clarification_question || queryPlan?.clarification || '')

  const budgetTier = normalizeText(
    queryPlan?.policy?.budget_tier
    || queryPlan?.budget_tier
    || options?.budgetTier
    || options?.budget_tier
    || 'interactive'
  ).toLowerCase()
  const latencyBudgetMs = Number(
    queryPlan?.constraints?.latency_budget_ms
    ?? queryPlan?.latency_budget_ms
    ?? options?.latency_budget_ms
    ?? 3000
  )
  const resultLimit = Number(queryPlan?.constraints?.result_limit ?? queryPlan?.result_limit ?? options?.limit ?? 200)
  const criticEnabled = queryPlan?.routing?.critic_enabled === true || options?.criticEnabled === true

  return {
    dsl_version: 'spatial_query_v1',
    trace_id: normalizeText(runtimeContext?.requestId || queryPlan?.trace_id || '') || 'legacy_plan',
    task: {
      query_type: queryType,
      goal: normalizeText(queryPlan?.goal || runtimeContext?.userQuestion || queryType),
      need_text_answer: needTextAnswer
    },
    scope: inferScopeFromLegacyPlan(queryPlan, spatialContext),
    entities: {
      categories: mergedCategories
    },
    constraints: {
      result_limit: Number.isFinite(resultLimit) ? Math.max(1, Math.min(5000, resultLimit)) : 200,
      latency_budget_ms: Number.isFinite(latencyBudgetMs) ? Math.max(300, Math.min(120000, latencyBudgetMs)) : 3000
    },
    operators,
    output_contract: {
      required_fields: ['pois', 'stats'],
      max_items: 200,
      include_evidence_refs: true,
      include_writer_text: needTextAnswer
    },
    uncertainty: {
      planner_confidence: plannerConfidence,
      risk_level: riskLevel,
      clarification: {
        required: clarificationRequired,
        question: clarificationQuestion || null
      }
    },
    policy: {
      cacheable: true,
      cache_key_profile: 'semantic',
      execution_profile: 'advanced',
      budget_tier: ['realtime', 'interactive', 'deep'].includes(budgetTier) ? budgetTier : 'interactive',
      allow_visual_review: true,
      allow_reasoning: true
    },
    routing: {
      complexity_score: 5,
      critic_enabled: criticEnabled
    }
  }
}

function normalizeSchemaErrorPath(item = {}) {
  if (!item || typeof item !== 'object') return '$'
  if (item.keyword === 'required' && item.params?.missingProperty) {
    const base = item.instancePath || '$'
    return `${base}.${item.params.missingProperty}`.replace(/\.$/, '')
  }
  return item.instancePath || '$'
}

function buildFailure({
  stage,
  error_code,
  errors = [],
  fix_hint = null,
  diagnostics = {}
}) {
  return {
    ok: false,
    stage,
    error_code,
    errors,
    fix_hint: fix_hint || null,
    diagnostics: {
      validation_stage: stage,
      error_code,
      ...diagnostics
    }
  }
}

function runSchemaValidation(dslInput, runtimeContext = {}) {
  const compatMode = normalizeCompatMode(runtimeContext)
  const validator = compatMode === 'strict' ? strictSchemaValidator : compatSchemaValidator
  const candidate = deepClone(dslInput)
  const before = JSON.stringify(candidate)
  const ok = validator(candidate)
  const after = JSON.stringify(candidate)
  const degraded = compatMode === 'compat' && before !== after

  if (!ok) {
    const errors = (validator.errors || []).map((item) => ({
      path: normalizeSchemaErrorPath(item),
      message: normalizeText(item.message) || 'Schema validation failed',
      keyword: normalizeText(item.keyword),
      params: item.params || {}
    }))

    return buildFailure({
      stage: 'schema',
      error_code: 'dsl_schema_invalid',
      errors,
      fix_hint: 'Adjust DSL fields to match spatial_query_v1 schema.',
      diagnostics: {
        compat_mode: compatMode,
        dsl_schema_degraded: degraded
      }
    })
  }

  return {
    ok: true,
    normalized_dsl: candidate,
    diagnostics: {
      validation_stage: 'schema',
      compat_mode: compatMode,
      dsl_schema_degraded: degraded
    }
  }
}

function runSemanticValidation(dsl, runtimeContext = {}) {
  const result = validateDslSemanticRules(dsl, runtimeContext)
  if (result.ok) {
    return {
      ok: true,
      diagnostics: {
        validation_stage: 'semantic'
      }
    }
  }
  return buildFailure({
    stage: 'semantic',
    error_code: 'dsl_semantic_invalid',
    errors: result.errors,
    fix_hint: result.fix_hint || 'Fix semantic constraints in query_type, DAG, and risk/writer rules.'
  })
}

function runPolicyValidation(dsl) {
  const result = validateDslPolicyRules(dsl)
  if (result.ok) {
    return {
      ok: true,
      diagnostics: {
        validation_stage: 'policy'
      }
    }
  }
  return buildFailure({
    stage: 'policy',
    error_code: 'dsl_policy_invalid',
    errors: result.errors,
    fix_hint: result.fix_hint || 'Align policy.budget_tier with constraints.latency_budget_ms.'
  })
}

export class DslValidationError extends Error {
  constructor(validationResult) {
    const payload = validationResult || {}
    super(payload.message || payload.fix_hint || 'DSL validation failed')
    this.name = 'DslValidationError'
    this.code = payload.error_code || 'dsl_validation_failed'
    this.stage = payload.stage || null
    this.details = Array.isArray(payload.errors) ? payload.errors : []
    this.fix_hint = payload.fix_hint || null
    this.diagnostics = {
      ...(payload.diagnostics && typeof payload.diagnostics === 'object' ? payload.diagnostics : {}),
      error_code: payload.error_code || this.code,
      details: this.details,
      fix_hint: this.fix_hint
    }
  }
}

export function validateDsl(dsl, runtimeContext = {}) {
  const schemaResult = runSchemaValidation(dsl, runtimeContext)
  if (!schemaResult.ok) return schemaResult

  const semanticResult = runSemanticValidation(schemaResult.normalized_dsl, {
    ...runtimeContext,
    enforceOperatorRules: runtimeContext.enforceOperatorRules !== false
  })
  if (!semanticResult.ok) {
    return {
      ...semanticResult,
      diagnostics: {
        ...semanticResult.diagnostics,
        ...schemaResult.diagnostics
      }
    }
  }

  const policyResult = runPolicyValidation(schemaResult.normalized_dsl)
  if (!policyResult.ok) {
    return {
      ...policyResult,
      diagnostics: {
        ...policyResult.diagnostics,
        ...schemaResult.diagnostics
      }
    }
  }

  return {
    ok: true,
    stage: 'policy',
    normalized_dsl: schemaResult.normalized_dsl,
    diagnostics: {
      ...schemaResult.diagnostics,
      semantic_pass: true,
      policy_pass: true
    }
  }
}

export function validateSpatialPlan(queryPlan, runtimeContext = {}) {
  if (isSpatialDslObject(queryPlan)) {
    return validateDsl(queryPlan, runtimeContext)
  }

  const legacyDsl = toLegacyDslEnvelope(queryPlan, runtimeContext)
  const semanticResult = runSemanticValidation(legacyDsl, {
    ...runtimeContext,
    enforceOperatorRules: Array.isArray(queryPlan?.operators) && queryPlan.operators.length > 0
  })
  if (!semanticResult.ok) {
    return {
      ...semanticResult,
      diagnostics: {
        ...(semanticResult.diagnostics || {}),
        legacy_mode: true
      }
    }
  }

  const policyResult = runPolicyValidation(legacyDsl)
  if (!policyResult.ok) {
    return {
      ...policyResult,
      diagnostics: {
        ...(policyResult.diagnostics || {}),
        legacy_mode: true
      }
    }
  }

  return {
    ok: true,
    stage: 'policy',
    normalized_dsl: legacyDsl,
    diagnostics: {
      legacy_mode: true,
      semantic_pass: true,
      policy_pass: true
    }
  }
}

export function assertValidDsl(dsl, runtimeContext = {}) {
  const result = validateDsl(dsl, runtimeContext)
  if (!result.ok) {
    throw new DslValidationError(result)
  }
  return result
}

export function assertValidSpatialPlan(queryPlan, runtimeContext = {}) {
  const result = validateSpatialPlan(queryPlan, runtimeContext)
  if (!result.ok) {
    throw new DslValidationError(result)
  }
  return result
}

export default {
  validateDsl,
  validateSpatialPlan,
  assertValidDsl,
  assertValidSpatialPlan,
  DslValidationError
}
