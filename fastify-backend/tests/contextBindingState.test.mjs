import test from 'node:test'
import assert from 'node:assert/strict'

import {
  loadContextBindingState,
  updateContextBindingState,
  evictContextBindingState,
  resetContextBindingStateForTests
} from '../services/contextBindingState.js'

test.beforeEach(() => {
  resetContextBindingStateForTests()
})

test('contextBindingState stores and isolates by session + view', () => {
  updateContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_1',
    lastEventSeq: 3,
    lastViewportHash: 'sha1:a',
    lastScopeSnapshot: { geometry_source: 'viewport' },
    nowMs: 1000,
    ttlMs: 60000
  })
  updateContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_2',
    lastEventSeq: 2,
    lastViewportHash: 'sha1:b',
    nowMs: 1000,
    ttlMs: 60000
  })

  const state1 = loadContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_1',
    nowMs: 1000
  })
  const state2 = loadContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_2',
    nowMs: 1000
  })

  assert.equal(state1.last_event_seq, 3)
  assert.equal(state2.last_event_seq, 2)
  assert.equal(state1.last_viewport_hash, 'sha1:a')
  assert.equal(state2.last_viewport_hash, 'sha1:b')
})

test('contextBindingState applies TTL eviction on load', () => {
  updateContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_ttl',
    lastEventSeq: 1,
    lastViewportHash: 'sha1:ttl',
    nowMs: 1000,
    ttlMs: 100
  })

  const beforeExpiry = loadContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_ttl',
    nowMs: 1099
  })
  const afterExpiry = loadContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_ttl',
    nowMs: 1101
  })

  assert.ok(beforeExpiry)
  assert.equal(afterExpiry, null)
})

test('contextBindingState can evict a view explicitly', () => {
  updateContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_evict',
    lastEventSeq: 9,
    lastViewportHash: 'sha1:evict',
    nowMs: 1000,
    ttlMs: 60000
  })

  const evicted = evictContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_evict'
  })
  const state = loadContextBindingState({
    sessionId: 'session_a',
    clientViewId: 'view_evict',
    nowMs: 1000
  })

  assert.equal(evicted, true)
  assert.equal(state, null)
})
