const auditEvents = []
const MAX_AUDIT_EVENTS = Math.max(200, Number.parseInt(process.env.OPS_AUDIT_MAX_EVENTS || '5000', 10))

function pushBounded(list, value, maxSize) {
  list.push(value)
  if (list.length > maxSize) {
    list.splice(0, list.length - maxSize)
  }
}

function toStringList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

export function recordOpsAuditEvent(event = {}) {
  const ts = Number.isFinite(Number(event?.ts)) ? Number(event.ts) : Date.now()
  const normalized = {
    ts,
    type: String(event?.type || 'unknown'),
    trace_id: String(event?.trace_id || event?.request_id || '').trim() || null,
    request_id: String(event?.request_id || event?.trace_id || '').trim() || null,
    query_type: String(event?.query_type || 'unknown').trim() || 'unknown',
    mode: String(event?.mode || 'sync').trim() || 'sync',
    critic_mode: String(event?.critic_mode || 'off').trim() || 'off',
    critic_pass: event?.critic_pass !== false,
    reasons: toStringList(event?.reasons),
    fix_suggestions: toStringList(event?.fix_suggestions),
    confidence: Number.isFinite(Number(event?.confidence)) ? Number(event.confidence) : null,
    risk_level: String(event?.risk_level || 'unknown').trim() || 'unknown',
    complexity_score: Number.isFinite(Number(event?.complexity_score)) ? Number(event.complexity_score) : null,
    frontier_emulated: event?.frontier_emulated === true,
    planner_model_tier: String(event?.planner_model_tier || 'medium').trim() || 'medium',
    requested_planner_model_tier: String(event?.requested_planner_model_tier || 'medium').trim() || 'medium'
  }

  pushBounded(auditEvents, normalized, MAX_AUDIT_EVENTS)
  return normalized
}

export function listOpsAuditEvents({
  limit = 100,
  type = '',
  traceId = '',
  queryType = ''
} = {}) {
  const normalizedLimit = Math.max(1, Math.min(1000, Number.parseInt(limit, 10) || 100))
  const normalizedType = String(type || '').trim().toLowerCase()
  const normalizedTraceId = String(traceId || '').trim()
  const normalizedQueryType = String(queryType || '').trim().toLowerCase()

  let rows = auditEvents
  if (normalizedType) {
    rows = rows.filter((item) => String(item.type || '').trim().toLowerCase() === normalizedType)
  }
  if (normalizedTraceId) {
    rows = rows.filter((item) => String(item.trace_id || '') === normalizedTraceId)
  }
  if (normalizedQueryType) {
    rows = rows.filter((item) => String(item.query_type || '').trim().toLowerCase() === normalizedQueryType)
  }

  return rows
    .slice(-normalizedLimit)
    .reverse()
}

export function resetOpsAuditStoreForTests() {
  auditEvents.splice(0, auditEvents.length)
}

export default {
  recordOpsAuditEvent,
  listOpsAuditEvents,
  resetOpsAuditStoreForTests
}
