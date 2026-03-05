import test from 'node:test'
import assert from 'node:assert/strict'

import {
  recordOpsAuditEvent,
  listOpsAuditEvents,
  resetOpsAuditStoreForTests
} from '../services/opsAuditStore.js'

test.beforeEach(() => {
  resetOpsAuditStoreForTests()
})

test('ops audit store records and filters critic async events', () => {
  recordOpsAuditEvent({
    type: 'critic_async_review',
    trace_id: 'trace_a',
    query_type: 'area_analysis',
    critic_mode: 'async',
    critic_pass: false,
    reasons: ['coverage_low']
  })
  recordOpsAuditEvent({
    type: 'critic_async_review',
    trace_id: 'trace_b',
    query_type: 'poi_search',
    critic_mode: 'async',
    critic_pass: true,
    reasons: []
  })

  const filtered = listOpsAuditEvents({ traceId: 'trace_a' })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].trace_id, 'trace_a')
  assert.equal(filtered[0].critic_pass, false)
  assert.deepEqual(filtered[0].reasons, ['coverage_low'])
})
