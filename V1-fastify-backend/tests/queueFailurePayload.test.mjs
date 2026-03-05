import test from 'node:test'
import assert from 'node:assert/strict'

import { buildQueueFailurePayload } from '../services/queue.js'

test('buildQueueFailurePayload normalizes Error instance', () => {
  const err = new Error('pipeline failed')
  err.code = 'model_parallel_failed:vlm:vlm_anchor_response_invalid'
  err.diagnostics = {
    error_code: 'model_parallel_failed:vlm:vlm_anchor_response_invalid',
    error_signature: 'fd_deadbeef'
  }

  const payload = buildQueueFailurePayload(err)
  assert.equal(payload.error, 'pipeline failed')
  assert.equal(payload.error_code, 'model_parallel_failed:vlm:vlm_anchor_response_invalid')
  assert.equal(payload.diagnostics?.error_signature, 'fd_deadbeef')
})

test('buildQueueFailurePayload normalizes plain object payload', () => {
  const payload = buildQueueFailurePayload({
    message: 'grpc compute failed',
    code: 'grpc_compute_error',
    diagnostics: {
      error_code: 'grpc_compute_error',
      last_stage: 'python_compute'
    }
  })

  assert.equal(payload.error, 'grpc compute failed')
  assert.equal(payload.error_code, 'grpc_compute_error')
  assert.equal(payload.diagnostics?.last_stage, 'python_compute')
})

test('buildQueueFailurePayload falls back for string input', () => {
  const payload = buildQueueFailurePayload('plain failure message')
  assert.equal(payload.error, 'plain failure message')
  assert.equal(payload.error_code, null)
  assert.equal(payload.diagnostics, null)
})
