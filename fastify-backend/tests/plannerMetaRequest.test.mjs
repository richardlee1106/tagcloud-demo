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

test('parseIntent injects viewport anchor for fast-path area query', async () => {
  const result = await parseIntent(
    '\u8bf7\u5206\u6790\u8fd9\u7247\u533a\u57df\u7684\u6559\u80b2\u8bbe\u65bd\u5206\u5e03\u3002',
    {
      plannerLlmEnabled: false,
      hasSelectedArea: true,
      viewportCenter: {
        lon: 114.3123,
        lat: 30.5812
      }
    }
  )

  assert.equal(result.fastPath, true)
  assert.equal(result.queryPlan?.query_type, 'area_analysis')
  assert.equal(result.queryPlan?.anchor?.type, 'viewport_center')
  assert.equal(result.queryPlan?.anchor?.lon, 114.3123)
  assert.equal(result.queryPlan?.anchor?.lat, 30.5812)
})

test('parseIntent uses planner LLM path and keeps non-zero token usage', async () => {
  const result = await parseIntent(
    '\u8bf7\u5bf9\u6bd4\u8fd9\u7247\u533a\u7684\u9910\u996e\u4e0e\u6559\u80b2\u4e1a\u6001\uff0c\u7ed9\u51fa\u53ef\u6267\u884c\u7ed3\u8bba\u3002',
    {
      plannerLlmEnabled: true,
      plannerLlmCaller: async () => ({
        queryPlan: {
          query_type: 'area_analysis',
          intent_mode: 'macro_overview',
          categories: ['\u9910\u996e\u670d\u52a1'],
          confidence: {
            score: 8,
            level: 'high',
            reasons: ['llm_refined']
          }
        },
        tokenUsage: {
          prompt_tokens: 21,
          completion_tokens: 9,
          total_tokens: 30
        }
      })
    }
  )

  assert.equal(result.fastPath, false)
  assert.equal(result.routerUsed, true)
  assert.equal(result.queryPlan?.query_type, 'area_analysis')
  assert.equal(result.tokenUsage?.total_tokens, 30)
})

test('parseIntent falls back to rule plan when planner LLM errors', async () => {
  const result = await parseIntent(
    '\u8bf7\u5bf9\u6bd4\u8fd9\u7247\u533a\u7684\u9910\u996e\u4e0e\u6559\u80b2\u4e1a\u6001\uff0c\u7ed9\u51fa\u53ef\u6267\u884c\u7ed3\u8bba\u3002',
    {
      plannerLlmEnabled: true,
      plannerLlmCaller: async () => {
        throw new Error('mock_planner_llm_down')
      }
    }
  )

  assert.equal(result.fastPath, false)
  assert.equal(result.routerUsed, false)
  assert.equal(result.tokenUsage?.total_tokens, 0)
  assert.equal(result.queryPlan?.query_type, 'area_analysis')
  assert.ok(
    (result.queryPlan?.confidence?.reasons || []).some((item) => String(item).includes('planner_llm_fallback'))
  )
})

test('parseIntent does not use fast path for key-conclusion macro requests', async () => {
  const result = await parseIntent(
    '\u8bf7\u572830\u79d2\u5185\u7ed9\u6211\u8fd9\u7247\u533a\u7684\u5173\u952e\u7ed3\u8bba\uff1a\u4e3b\u5bfc\u4e1a\u6001\u3001\u6d3b\u529b\u70ed\u70b9\u3001\u673a\u4f1a\u70b9\u3002',
    {
      plannerLlmEnabled: false
    }
  )

  assert.equal(result.fastPath, false)
})

test('parseIntent falls back to non-stream planner when streaming payload is truncated', async () => {
  const callModes = []
  const result = await parseIntent(
    '\u8bf7\u5206\u6790\u8fd9\u7247\u533a\u57df\u7684\u9910\u996e\u5206\u5e03\u4e0e\u6d3b\u529b\u70ed\u70b9\u3002',
    {
      plannerLlmEnabled: true,
      plannerStreamingEnabled: true,
      plannerLlmCaller: async ({ mode }) => {
        callModes.push(mode || 'legacy')
        if (mode === 'stream') {
          return {
            streamChunks: [
              '{"query_type":"area_analysis","intent_mode":"macro_overview","scope":{"geometry_source":"viewport"'
            ],
            tokenUsage: {
              prompt_tokens: 10,
              completion_tokens: 3,
              total_tokens: 13
            }
          }
        }

        return {
          queryPlan: {
            query_type: 'area_analysis',
            intent_mode: 'macro_overview',
            categories: ['\u9910\u996e\u670d\u52a1'],
            confidence: {
              score: 8,
              level: 'high',
              reasons: ['llm_non_stream_fallback']
            }
          },
          tokenUsage: {
            prompt_tokens: 20,
            completion_tokens: 8,
            total_tokens: 28
          }
        }
      }
    }
  )

  assert.deepEqual(callModes, ['stream', 'non_stream'])
  assert.equal(result.routerUsed, true)
  assert.equal(result.queryPlan?.query_type, 'area_analysis')
  assert.equal(result.tokenUsage?.total_tokens, 28)
  assert.equal(result.diagnostics?.planner_streaming?.fallback_used, true)
  assert.equal(result.diagnostics?.planner_streaming?.fallback_error_code, 'planner_stream_truncated')
})

test('parseIntent streaming success moves parser state to S4', async () => {
  const result = await parseIntent(
    '\u8bf7\u5bf9\u6bd4\u8fd9\u7247\u533a\u7684\u9910\u996e\u4e0e\u6559\u80b2\u4e1a\u6001\uff0c\u7ed9\u51fa\u53ef\u6267\u884c\u7ed3\u8bba\u3002',
    {
      plannerLlmEnabled: true,
      plannerStreamingEnabled: true,
      plannerLlmCaller: async ({ mode }) => {
        if (mode === 'stream') {
          return {
            streamChunks: [
              '{"query_type":"area_analysis","intent_mode":"macro_overview","scope":{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]},"entities":{"categories":["\u9910\u996e\u670d\u52a1"]}}'
            ],
            tokenUsage: {
              prompt_tokens: 12,
              completion_tokens: 10,
              total_tokens: 22
            }
          }
        }
        throw new Error('non-stream should not be called')
      }
    }
  )

  assert.equal(result.queryPlan?.query_type, 'area_analysis')
  assert.equal(result.diagnostics?.planner_streaming?.fallback_used, false)
  assert.equal(result.diagnostics?.planner_streaming?.final_state, 'S4')
})
