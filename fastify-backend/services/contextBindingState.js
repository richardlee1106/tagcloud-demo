const DEFAULT_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.CONTEXT_BINDING_STATE_TTL_MS || '1800000', 10) || 1_800_000
)
const DEFAULT_MAX_ENTRIES = Math.max(
  200,
  Number.parseInt(process.env.CONTEXT_BINDING_STATE_MAX_ENTRIES || '5000', 10) || 5000
)

const stateStore = new Map()

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeNow(nowMs) {
  const value = Number(nowMs)
  return Number.isFinite(value) ? value : Date.now()
}

function normalizeTtl(ttlMs) {
  const value = Number(ttlMs)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TTL_MS
  return Math.max(1, Math.min(value, 24 * 60 * 60 * 1000))
}

function buildStateKey(sessionId, clientViewId) {
  const normalizedSessionId = normalizeText(sessionId)
  const normalizedClientViewId = normalizeText(clientViewId)
  if (!normalizedSessionId || !normalizedClientViewId) return null
  return `${normalizedSessionId}::${normalizedClientViewId}`
}

function pruneExpired(nowMs) {
  for (const [key, value] of stateStore.entries()) {
    if (!value || Number(value.expires_at_ms) <= nowMs) {
      stateStore.delete(key)
    }
  }
}

function enforceCapacity() {
  const overflow = stateStore.size - DEFAULT_MAX_ENTRIES
  if (overflow <= 0) return
  const entries = [...stateStore.entries()]
    .sort((a, b) => Number(a[1]?.updated_at_ms || 0) - Number(b[1]?.updated_at_ms || 0))
  for (let i = 0; i < overflow; i += 1) {
    const key = entries[i]?.[0]
    if (key) stateStore.delete(key)
  }
}

export function loadContextBindingState({
  sessionId,
  clientViewId,
  nowMs
} = {}) {
  const key = buildStateKey(sessionId, clientViewId)
  if (!key) return null

  const now = normalizeNow(nowMs)
  pruneExpired(now)

  const state = stateStore.get(key)
  if (!state) return null
  if (Number(state.expires_at_ms) <= now) {
    stateStore.delete(key)
    return null
  }
  return { ...state }
}

export function updateContextBindingState({
  sessionId,
  clientViewId,
  lastEventSeq,
  lastViewportHash,
  lastScopeSnapshot = null,
  lastDslSnapshot = null,
  nowMs,
  ttlMs
} = {}) {
  const key = buildStateKey(sessionId, clientViewId)
  if (!key) return null

  const normalizedEventSeq = Number(lastEventSeq)
  if (!Number.isFinite(normalizedEventSeq)) return null
  const normalizedViewportHash = normalizeText(lastViewportHash)
  if (!normalizedViewportHash) return null

  const now = normalizeNow(nowMs)
  const ttl = normalizeTtl(ttlMs)

  const nextState = {
    session_id: normalizeText(sessionId),
    client_view_id: normalizeText(clientViewId),
    last_event_seq: Math.max(0, Math.trunc(normalizedEventSeq)),
    last_viewport_hash: normalizedViewportHash,
    last_scope_snapshot: lastScopeSnapshot && typeof lastScopeSnapshot === 'object'
      ? structuredClone(lastScopeSnapshot)
      : null,
    last_dsl_snapshot: lastDslSnapshot && typeof lastDslSnapshot === 'object'
      ? structuredClone(lastDslSnapshot)
      : null,
    updated_at_ms: now,
    expires_at_ms: now + ttl
  }

  stateStore.set(key, nextState)
  pruneExpired(now)
  enforceCapacity()
  return { ...nextState }
}

export function evictContextBindingState({
  sessionId,
  clientViewId
} = {}) {
  const key = buildStateKey(sessionId, clientViewId)
  if (!key) return false
  return stateStore.delete(key)
}

export function resetContextBindingStateForTests() {
  stateStore.clear()
}

export default {
  loadContextBindingState,
  updateContextBindingState,
  evictContextBindingState,
  resetContextBindingStateForTests
}
