import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildGrpcStreamErrorFromEvent,
  enrichGrpcTransportError
} from '../services/grpcClient.js'

test('buildGrpcStreamErrorFromEvent preserves code/diagnostics and grpc context', () => {
  const error = buildGrpcStreamErrorFromEvent(
    {
      message: 'model_parallel_failed:vlm:vlm_anchor_response_invalid',
      code: 'model_parallel_failed:vlm:vlm_anchor_response_invalid',
      diagnostics: {
        error_code: 'model_parallel_failed:vlm:vlm_anchor_response_invalid',
        python_context: {
          preview_text: 'bad json',
          preview_chars: 8,
          preview_sha1: 'deadbeef'
        }
      }
    },
    {
      endpoint: '127.0.0.1:50051',
      timeout_ms: 90_000,
      last_stage: 'model_parallel_failed',
      event_count: 12
    }
  )

  assert.equal(error.message, 'model_parallel_failed:vlm:vlm_anchor_response_invalid')
  assert.equal(error.code, 'model_parallel_failed:vlm:vlm_anchor_response_invalid')
  assert.equal(error.diagnostics?.error_code, 'model_parallel_failed:vlm:vlm_anchor_response_invalid')
  assert.equal(error.python_context?.preview_sha1, 'deadbeef')
  assert.equal(error.grpc_context?.endpoint, '127.0.0.1:50051')
  assert.equal(error.grpc_context?.last_stage, 'model_parallel_failed')
  assert.equal(error.grpc_context?.event_count, 12)
  assert.equal(error.grpc_context?.source, 'grpc_error_event')
})

test('enrichGrpcTransportError captures grpc status/details/metadata', () => {
  const raw = new Error('14 UNAVAILABLE: upstream disconnected')
  raw.code = 14
  raw.details = 'upstream disconnected'
  raw.metadata = {
    getMap() {
      return { 'x-trace-id': 'trace_test_001' }
    }
  }

  const error = enrichGrpcTransportError(raw, {
    endpoint: '127.0.0.1:50051',
    timeout_ms: 45_000,
    last_stage: 'python_compute',
    event_count: 3
  })

  assert.equal(error.code, 14)
  assert.equal(error.grpc_context?.grpc_status, 14)
  assert.equal(error.grpc_context?.grpc_details, 'upstream disconnected')
  assert.equal(error.grpc_context?.grpc_metadata?.['x-trace-id'], 'trace_test_001')
  assert.equal(error.grpc_context?.last_stage, 'python_compute')
  assert.equal(error.grpc_context?.source, 'grpc_transport_error')
})
