import test from 'node:test'
import assert from 'node:assert/strict'

import { createRAGSession } from '../services/ragLogger.js'
import { buildFailureDiagnostics } from '../services/errorDiagnostics.js'

test('pipeline failure writes FailureDiagnostics entry and readable summary fields', () => {
  const session = createRAGSession()
  const failureDiagnostics = buildFailureDiagnostics({
    error: Object.assign(new Error('Spatial compute service unavailable'), {
      code: 'model_parallel_failed:vlm:vlm_anchor_response_invalid',
      diagnostics: {
        python_context: {
          preview_text: '{"choices":[{"message":{"content":"not-json"}}]}',
          preview_chars: 46,
          preview_sha1: 'deadbeef',
          parse_stage: 'response_parse'
        }
      }
    }),
    traceId: 'trace_test_001',
    sessionId: 'session_test_001',
    mode: 'sync',
    queryType: 'area_analysis',
    stagePath: ['planner', 'python_compute', 'model_parallel_failed'],
    spatialContext: {
      mode: 'Viewport',
      viewport: [114.3214, 30.5745, 114.3362, 30.5858],
      mapZoom: 16.44
    },
    options: {
      visualModel: 'qwen3.5-4b',
      reasoningModel: 'qwen3.5-4b',
      reasoningEnabled: true,
      modelBudgetMs: 5000
    }
  })

  session.log('Pipeline', 'Failed', {
    mode: 'sync',
    error: failureDiagnostics.error_message,
    error_code: failureDiagnostics.error_code,
    error_signature: failureDiagnostics.error_signature
  })
  session.log('Pipeline', 'FailureDiagnostics', failureDiagnostics)

  const failedLog = session.logs.find(
    (entry) => entry.component === 'Pipeline' && entry.action === 'Failed'
  )
  const diagnosticsLog = session.logs.find(
    (entry) => entry.component === 'Pipeline' && entry.action === 'FailureDiagnostics'
  )

  assert.ok(failedLog, 'expected Pipeline/Failed log')
  assert.ok(diagnosticsLog, 'expected Pipeline/FailureDiagnostics log')
  assert.equal(failedLog.details?.error_code, 'model_parallel_failed:vlm:vlm_anchor_response_invalid')
  assert.equal(diagnosticsLog.details?.python_context?.parse_stage, 'response_parse')

  const readableSummary = session.generateReadableSummary()
  assert.ok(readableSummary.includes('FailureCode: model_parallel_failed:vlm:vlm_anchor_response_invalid'))
  assert.ok(readableSummary.includes('LastStage: model_parallel_failed'))
  assert.ok(readableSummary.includes('FailureSignature:'))
  assert.ok(readableSummary.includes('FailureHint:'))
})
