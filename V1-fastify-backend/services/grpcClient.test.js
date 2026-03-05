import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveGrpcIdleTimeoutMs, resolveGrpcTimeoutMs } from './grpcClient.js'

test('resolveGrpcIdleTimeoutMs respects explicit override in hints options', () => {
  const payload = {
    hints: {
      options: {
        grpcIdleTimeoutMs: 180000
      }
    }
  }

  assert.equal(resolveGrpcIdleTimeoutMs(payload), 180000)
})

test('resolveGrpcIdleTimeoutMs is always >= request timeout', () => {
  const payload = {
    timeout_ms: 120000,
    hints: {
      options: {
        grpcIdleTimeoutMs: 1000
      }
    }
  }

  const timeoutMs = resolveGrpcTimeoutMs(payload)
  const idleTimeoutMs = resolveGrpcIdleTimeoutMs(payload)

  assert.ok(idleTimeoutMs >= timeoutMs)
})
