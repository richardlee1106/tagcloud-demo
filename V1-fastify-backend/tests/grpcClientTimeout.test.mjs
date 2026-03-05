import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveGrpcTimeoutMs } from '../services/grpcClient.js'

test('resolveGrpcTimeoutMs uses higher default for area_analysis', () => {
  const timeout = resolveGrpcTimeoutMs({
    query_type: 'area_analysis',
    mode: 'sync',
    hints: JSON.stringify({ options: {} })
  })
  assert.ok(timeout >= 45_000)
})

test('resolveGrpcTimeoutMs respects explicit override from hints options', () => {
  const timeout = resolveGrpcTimeoutMs({
    query_type: 'area_analysis',
    mode: 'sync',
    hints: JSON.stringify({ options: { grpcTimeoutMs: 12_345 } })
  })
  assert.equal(timeout, 12_345)
})

test('resolveGrpcTimeoutMs increases timeout for heavy visual/self-validation options', () => {
  const timeout = resolveGrpcTimeoutMs({
    query_type: 'area_analysis',
    mode: 'sync',
    hints: JSON.stringify({
      options: {
        visualReviewEnabled: true,
        selfValidationEnabled: true
      }
    })
  })
  assert.ok(timeout >= 90_000)
})
