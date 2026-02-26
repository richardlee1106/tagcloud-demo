import test from 'node:test'
import assert from 'node:assert/strict'

import { parseIntent, quickIntentClassify } from '../routes/ai/planner.js'

test('quickIntentClassify routes question-example request to general_qa', () => {
  const plan = quickIntentClassify('\u8bf7\u7ed9\u6211 6 \u4e2a\u9ad8\u8d28\u91cf\u5730\u7406\u7a7a\u95f4\u95ee\u9898\u793a\u4f8b\uff0c\u6bcf\u4e2a\u95ee\u9898\u90fd\u8981\u80fd\u5f97\u5230\u53ef\u6267\u884c\u7ed3\u8bba\u3002')
  assert.equal(plan.query_type, 'general_qa')
  assert.equal(plan.intent_mode, 'llm_chat')
})

test('quickIntentClassify routes capability/help request to general_qa', () => {
  const plan = quickIntentClassify('\u4f60\u662f\u8c01\uff1f\u4f60\u80fd\u505a\u4ec0\u4e48\uff1f')
  assert.equal(plan.query_type, 'general_qa')
  assert.equal(plan.intent_mode, 'llm_chat')
})

test('quickIntentClassify keeps normal analysis requests as area_analysis', () => {
  const plan = quickIntentClassify('\u8bf7\u5206\u6790\u8fd9\u7247\u533a\u57df\u7684\u9910\u996e\u5206\u5e03\u548c\u6d3b\u529b\u70ed\u70b9\u3002')
  assert.equal(plan.query_type, 'area_analysis')
  assert.equal(plan.intent_mode, 'macro_overview')
})

test('parseIntent routes question-example request via fast general_qa path', async () => {
  const result = await parseIntent('\u8bf7\u7ed9\u6211 6 \u4e2a\u9ad8\u8d28\u91cf\u5730\u7406\u7a7a\u95f4\u95ee\u9898\u793a\u4f8b\uff0c\u6bcf\u4e2a\u95ee\u9898\u90fd\u8981\u80fd\u5f97\u5230\u53ef\u6267\u884c\u7ed3\u8bba\u3002')
  assert.equal(result.fastPath, true)
  assert.equal(result.fastPathReason, 'general_qa_meta')
  assert.equal(result.queryPlan?.query_type, 'general_qa')
  assert.equal(result.queryPlan?.intent_mode, 'llm_chat')
})
