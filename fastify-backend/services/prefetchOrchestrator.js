import * as queryCache from './queryCache.js'

export const PREFETCH_STREAM_EVENTS = Object.freeze({
  SCOPE_READY: 'scope-ready',
  ENTITIES_READY: 'entities-ready'
})

export const PREFETCH_TRIGGER_FIELDS = Object.freeze({
  SCOPE: 'scope',
  ENTITIES_CATEGORIES: 'entities.categories'
})

const PREFETCH_EVENT_FIELD_MAP = Object.freeze({
  [PREFETCH_STREAM_EVENTS.SCOPE_READY]: PREFETCH_TRIGGER_FIELDS.SCOPE,
  [PREFETCH_STREAM_EVENTS.ENTITIES_READY]: PREFETCH_TRIGGER_FIELDS.ENTITIES_CATEGORIES
})

function safeClone(value) {
  if (!value || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

function toErrorCode(error) {
  const value = error?.code || error?.error_code || error?.name || 'prefetch_error'
  return String(value || 'prefetch_error')
}

function normalizePrefetchField(field) {
  const normalized = String(field || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'scope') return PREFETCH_TRIGGER_FIELDS.SCOPE
  if (normalized === 'entities' || normalized === 'entities.categories') {
    return PREFETCH_TRIGGER_FIELDS.ENTITIES_CATEGORIES
  }
  return ''
}

function normalizePrefetchFields(fields = []) {
  if (!Array.isArray(fields)) return new Set()
  const normalized = new Set()
  for (const field of fields) {
    const key = normalizePrefetchField(field)
    if (key) normalized.add(key)
  }
  return normalized
}

function normalizeEventType(event) {
  if (typeof event === 'string') return event
  if (event && typeof event === 'object') return String(event.type || '').trim()
  return ''
}

function normalizePlannerEvents(events = []) {
  if (!Array.isArray(events)) return []
  return events
    .map((event) => normalizeEventType(event))
    .filter(Boolean)
}

function defaultBuildFingerprint({
  plan = {},
  stage = 'unknown',
  queryType = 'default',
  spatialContext = {},
  sourcePolicy = null,
  userQuestion = ''
} = {}) {
  return queryCache.generateQueryFingerprint(plan, spatialContext, {
    queryType,
    route: `prefetch_${stage}`,
    sourcePolicy,
    userQuestion
  })
}

function buildStageQueryPlan(basePlan = {}, stage = 'scope') {
  const cloned = safeClone(basePlan && typeof basePlan === 'object' ? basePlan : {}) || {}
  if (stage !== 'scope') return cloned

  if (Array.isArray(cloned.categories) && cloned.categories.length > 0) {
    cloned.categories = []
  }
  if (cloned.entities && typeof cloned.entities === 'object') {
    cloned.entities = {
      ...cloned.entities,
      categories: []
    }
  }
  return cloned
}

export function createPrefetchOrchestrator(options = {}) {
  const allowPrefetch = options?.streamingHints?.allow_prefetch === true
  const prefetchOnFieldsSet = normalizePrefetchFields(options?.streamingHints?.prefetch_on_fields || [])
  const prefetchOnFields = [...prefetchOnFieldsSet]
  const enabled = allowPrefetch && prefetchOnFieldsSet.size > 0

  const plannerEvents = normalizePlannerEvents(options?.plannerStreamEvents || [])
  const buildFingerprint = typeof options?.buildFingerprint === 'function'
    ? options.buildFingerprint
    : defaultBuildFingerprint
  const cache = options?.cache && typeof options.cache.getFromCache === 'function'
    ? options.cache
    : queryCache
  const now = typeof options?.now === 'function' ? options.now : () => Date.now()
  const finalizeTimeoutMs = Number.isFinite(Number(options?.finalizeTimeoutMs))
    ? Math.max(0, Math.round(Number(options.finalizeTimeoutMs)))
    : 120

  const baseQueryPlan = options?.queryPlan && typeof options.queryPlan === 'object'
    ? options.queryPlan
    : {}
  const spatialContext = options?.spatialContext || {}
  const queryType = String(options?.queryType || baseQueryPlan?.query_type || 'default')
  const sourcePolicy = options?.sourcePolicy || null
  const userQuestion = String(options?.userQuestion || '')

  const inFlight = []
  const triggeredEventSet = new Set()
  const errorCodes = new Set()
  let hitCount = 0
  let startedTotal = 0
  let completedTotal = 0
  let firstCompletedAt = null
  let executionStartAt = null
  let finalizedSummary = null

  function markExecutionStart(ts = null) {
    if (executionStartAt != null) return executionStartAt
    const numericTs = Number(ts)
    executionStartAt = Number.isFinite(numericTs) ? numericTs : now()
    return executionStartAt
  }

  function triggerSingleEvent(eventType) {
    if (!enabled) return false
    if (!eventType) return false
    if (triggeredEventSet.has(eventType)) return false

    const fieldKey = PREFETCH_EVENT_FIELD_MAP[eventType]
    if (!fieldKey || !prefetchOnFieldsSet.has(fieldKey)) return false

    const stage = fieldKey === PREFETCH_TRIGGER_FIELDS.SCOPE ? 'scope' : 'entities'
    const stagePlan = buildStageQueryPlan(baseQueryPlan, stage)

    let fingerprint = null
    try {
      fingerprint = buildFingerprint({
        plan: stagePlan,
        stage,
        eventType,
        queryType,
        spatialContext,
        sourcePolicy,
        userQuestion
      })
    } catch (error) {
      errorCodes.add(toErrorCode(error))
      return false
    }

    if (fingerprint && typeof fingerprint.then === 'function') {
      errorCodes.add('prefetch_fingerprint_async_unsupported')
      return false
    }
    if (typeof fingerprint !== 'string') {
      errorCodes.add('prefetch_fingerprint_invalid')
      return false
    }
    const normalizedFingerprint = fingerprint.trim()
    if (!normalizedFingerprint) return false

    triggeredEventSet.add(eventType)
    startedTotal += 1

    const task = Promise.resolve()
      .then(() => cache.getFromCache(normalizedFingerprint, { queryType }))
      .then((cachedPayload) => {
        if (cachedPayload) {
          hitCount += 1
        }
      })
      .catch((error) => {
        errorCodes.add(toErrorCode(error))
      })
      .finally(() => {
        completedTotal += 1
        const finishedAt = now()
        if (firstCompletedAt == null || finishedAt < firstCompletedAt) {
          firstCompletedAt = finishedAt
        }
      })

    inFlight.push(task)
    return true
  }

  function triggerFromPlannerEvents(events = null) {
    const source = events == null ? plannerEvents : normalizePlannerEvents(events)
    for (const eventType of source) {
      triggerSingleEvent(eventType)
    }
  }

  function snapshot({
    validationPassed = true,
    dslFailureErrorCode = null
  } = {}) {
    const attempted = startedTotal > 0
    const prefetchHit = hitCount > 0
    const overlapDelta = (executionStartAt != null && firstCompletedAt != null)
      ? Math.min(0, Math.round(firstCompletedAt - executionStartAt))
      : 0
    const prefetchWasted = attempted && prefetchHit && !validationPassed

    return {
      prefetch_enabled: enabled,
      allow_prefetch: allowPrefetch,
      prefetch_on_fields: prefetchOnFields,
      prefetch_triggered_events: [...triggeredEventSet],
      prefetch_attempted: attempted,
      prefetch_hit: prefetchHit,
      prefetch_hit_count: hitCount,
      prefetch_degraded: errorCodes.size > 0,
      prefetch_wasted: prefetchWasted,
      prefetch_overlap_delta_ms: overlapDelta,
      prefetch_error_codes: [...errorCodes],
      prefetch_started_total: startedTotal,
      prefetch_completed_total: completedTotal,
      dsl_failure_error_code: prefetchWasted ? String(dslFailureErrorCode || 'dsl_validation_failed') : null
    }
  }

  async function finalize({
    validationPassed = true,
    dslFailureErrorCode = null
  } = {}) {
    if (finalizedSummary) {
      return finalizedSummary
    }

    if (inFlight.length > 0) {
      const settlePromise = Promise.allSettled(inFlight).then(() => true)
      if (finalizeTimeoutMs > 0) {
        const timedOut = await Promise.race([
          settlePromise,
          new Promise((resolve) => {
            setTimeout(() => resolve(false), finalizeTimeoutMs)
          })
        ])
        if (timedOut === false) {
          errorCodes.add('prefetch_finalize_timeout')
        }
      } else {
        await settlePromise
      }
    }

    finalizedSummary = snapshot({
      validationPassed,
      dslFailureErrorCode
    })
    return finalizedSummary
  }

  return {
    enabled,
    allowPrefetch,
    prefetchOnFields,
    plannerEvents,
    markExecutionStart,
    triggerSingleEvent,
    triggerFromPlannerEvents,
    snapshot,
    finalize
  }
}

export default {
  PREFETCH_STREAM_EVENTS,
  PREFETCH_TRIGGER_FIELDS,
  createPrefetchOrchestrator
}
