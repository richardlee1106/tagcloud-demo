import test from 'node:test'
import assert from 'node:assert/strict'

import {
  runNarrativeSpatialJob,
  detectGeneralQaPresetType,
  buildGeneralQaPresetReply
} from '../services/spatialJobRunner.js'

test('detectGeneralQaPresetType identifies capability/help requests', () => {
  const presetType = detectGeneralQaPresetType('\u4f60\u662f\u8c01\uff1f\u4f60\u80fd\u505a\u4ec0\u4e48\uff1f')
  assert.equal(presetType, 'capability')
})

test('buildGeneralQaPresetReply returns system-scoped examples', () => {
  const text = buildGeneralQaPresetReply('\u8bf7\u7ed9\u6211 6 \u4e2a\u9ad8\u8d28\u91cf\u5730\u7406\u7a7a\u95f4\u95ee\u9898\u793a\u4f8b')
  assert.ok(text.includes('\u57fa\u4e8e\u5f53\u524d\u5730\u56fe\u89c6\u7a97'))
  assert.ok(text.includes('\u53ef\u6267\u884c\u7ed3\u8bba'))
})

test('runNarrativeSpatialJob emits general_qa stage before text for preset path', async () => {
  const callOrder = []
  const reporter = {
    reportStage: async (stage) => {
      callOrder.push(`stage:${stage}`)
    },
    reportText: async (chunk) => {
      callOrder.push(`text:${String(chunk || '').slice(0, 12)}`)
    },
    reportProgress: async () => {},
    reportPartial: async () => {}
  }

  const result = await runNarrativeSpatialJob(
    {
      request_id: 'test_general_qa_1',
      query: '\u8bf7\u7ed9\u6211 6 \u4e2a\u9ad8\u8d28\u91cf\u5730\u7406\u7a7a\u95f4\u95ee\u9898\u793a\u4f8b\uff0c\u6bcf\u4e2a\u95ee\u9898\u90fd\u8981\u80fd\u5f97\u5230\u53ef\u6267\u884c\u7ed3\u8bba\u3002',
      messages: [{ role: 'user', content: '\u8bf7\u7ed9\u6211 6 \u4e2a\u9ad8\u8d28\u91cf\u5730\u7406\u7a7a\u95f4\u95ee\u9898\u793a\u4f8b\uff0c\u6bcf\u4e2a\u95ee\u9898\u90fd\u8981\u80fd\u5f97\u5230\u53ef\u6267\u884c\u7ed3\u8bba\u3002' }],
      poiFeatures: [],
      spatialContext: {},
      options: { mode: 'sync' }
    },
    reporter
  )

  const stageIndex = callOrder.findIndex((entry) => entry.startsWith('stage:general_qa'))
  const textIndex = callOrder.findIndex((entry) => entry.startsWith('text:'))

  assert.ok(stageIndex >= 0, 'expected general_qa stage event')
  assert.ok(textIndex >= 0, 'expected text event')
  assert.ok(stageIndex < textIndex, 'stage should be emitted before text')
  assert.equal(result?.query_plan?.query_type, 'general_qa')
  assert.equal(result?.diagnostics?.general_qa_source?.startsWith('preset_'), true)
})
