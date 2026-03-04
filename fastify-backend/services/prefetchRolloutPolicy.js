const DEFAULT_ROLLOUT_FIELDS = Object.freeze([
  'scope',
  'entities.categories'
])

const TRUTHY_SET = new Set(['1', 'true', 'yes', 'on'])
const FALSY_SET = new Set(['0', 'false', 'no', 'off'])

function normalizeText(value) {
  return String(value || '').trim()
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return fallback
  if (TRUTHY_SET.has(normalized)) return true
  if (FALSY_SET.has(normalized)) return false
  return fallback
}

function normalizeQueryType(queryType) {
  return normalizeText(queryType).toLowerCase() || 'unknown'
}

function parseCsvList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean)
  }
  const text = normalizeText(value)
  if (!text) return []
  return text
    .split(',')
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean)
}

function normalizePrefetchField(field) {
  const normalized = normalizeText(field).toLowerCase()
  if (!normalized) return ''
  if (normalized === 'scope') return 'scope'
  if (normalized === 'entities' || normalized === 'entities.categories') return 'entities.categories'
  return ''
}

function normalizePrefetchFields(fields = []) {
  if (!Array.isArray(fields)) return []
  const output = []
  const dedupe = new Set()
  for (const field of fields) {
    const normalized = normalizePrefetchField(field)
    if (!normalized || dedupe.has(normalized)) continue
    dedupe.add(normalized)
    output.push(normalized)
  }
  return output
}

export function resolvePrefetchRolloutPolicy({
  streamingHints = {},
  queryType = 'unknown',
  env = process.env
} = {}) {
  const candidate = streamingHints && typeof streamingHints === 'object'
    ? streamingHints
    : {}
  const normalizedQueryType = normalizeQueryType(queryType)
  const currentEnv = normalizeText(env.APP_ENV || env.NODE_ENV || 'development').toLowerCase() || 'development'

  const requestedAllowPrefetch = candidate.allow_prefetch === true
  const requestedFields = normalizePrefetchFields(candidate.prefetch_on_fields)

  const forceDisable = toBoolean(env.SPATIAL_PREFETCH_FORCE_DISABLE, false)
  const rolloutEnabled = toBoolean(env.SPATIAL_PREFETCH_ROLLOUT_ENABLED, false)
  const rolloutEnvs = parseCsvList(env.SPATIAL_PREFETCH_ROLLOUT_ENVS)
  const rolloutQueryTypes = parseCsvList(env.SPATIAL_PREFETCH_ROLLOUT_QUERY_TYPES)
  const configuredRolloutFields = normalizePrefetchFields(parseCsvList(env.SPATIAL_PREFETCH_ROLLOUT_FIELDS))
  const rolloutFields = configuredRolloutFields.length > 0
    ? configuredRolloutFields
    : [...DEFAULT_ROLLOUT_FIELDS]

  const rolloutEnvMatch = rolloutEnvs.length === 0 || rolloutEnvs.includes(currentEnv)
  const rolloutQueryTypeMatch = rolloutQueryTypes.length === 0 || rolloutQueryTypes.includes(normalizedQueryType)
  const rolloutAllowPrefetch = rolloutEnabled && rolloutEnvMatch && rolloutQueryTypeMatch

  let prefetchPolicySource = 'disabled'
  if (forceDisable) {
    prefetchPolicySource = 'force_disabled'
  } else if (requestedAllowPrefetch) {
    prefetchPolicySource = 'request'
  } else if (rolloutAllowPrefetch) {
    prefetchPolicySource = 'rollout'
  }

  const allowPrefetch = !forceDisable && (requestedAllowPrefetch || rolloutAllowPrefetch)
  const fallbackFields = rolloutAllowPrefetch ? rolloutFields : []
  const prefetchOnFields = allowPrefetch
    ? (requestedFields.length > 0 ? requestedFields : fallbackFields)
    : []

  return {
    ...candidate,
    allow_prefetch: allowPrefetch,
    prefetch_on_fields: prefetchOnFields,
    prefetch_policy_source: prefetchPolicySource,
    prefetch_rollout_enabled: rolloutEnabled,
    prefetch_rollout_env: currentEnv,
    prefetch_rollout_env_match: rolloutEnvMatch,
    prefetch_rollout_query_type: normalizedQueryType,
    prefetch_rollout_query_type_match: rolloutQueryTypeMatch
  }
}

export default {
  resolvePrefetchRolloutPolicy
}
