import test from 'node:test'
import assert from 'node:assert/strict'

import { applyAreaAnalysisCategoryGuard } from '../routes/ai/planner.js'

test('removes mobility-only categories for generic area analysis', () => {
  const queryPlan = {
    query_type: 'area_analysis',
    intent_mode: 'macro_overview',
    categories: ['\u5546\u573a', '\u505c\u8f66\u573a', '\u5730\u94c1\u7ad9', '\u5496\u5561\u5385']
  }

  const guarded = applyAreaAnalysisCategoryGuard(
    queryPlan,
    '\u8bf7\u572830\u79d2\u5185\u5206\u6790\u8fd9\u7247\u533a\u57df\u4e3b\u5bfc\u4e1a\u6001\u548c\u6d3b\u529b\u70ed\u70b9'
  )

  assert.deepEqual(guarded.categories, ['\u5546\u573a', '\u5496\u5561\u5385'])
})

test('keeps mobility categories when transport intent is explicit', () => {
  const queryPlan = {
    query_type: 'area_analysis',
    intent_mode: 'macro_overview',
    categories: ['\u5546\u573a', '\u505c\u8f66\u573a', '\u5730\u94c1\u7ad9']
  }

  const guarded = applyAreaAnalysisCategoryGuard(
    queryPlan,
    '\u8bf7\u5206\u6790\u8be5\u533a\u57df\u7684\u4ea4\u901a\u53ef\u8fbe\u6027\u548c\u901a\u52e4\u6548\u7387'
  )

  assert.deepEqual(guarded.categories, ['\u5546\u573a', '\u505c\u8f66\u573a', '\u5730\u94c1\u7ad9'])
})

test('does not alter non-area-analysis query plans', () => {
  const queryPlan = {
    query_type: 'poi_search',
    intent_mode: 'local_search',
    categories: ['\u505c\u8f66\u573a', '\u5730\u94c1\u7ad9']
  }

  const guarded = applyAreaAnalysisCategoryGuard(
    queryPlan,
    '\u9644\u8fd1\u54ea\u91cc\u6709\u505c\u8f66\u573a'
  )

  assert.deepEqual(guarded.categories, ['\u505c\u8f66\u573a', '\u5730\u94c1\u7ad9'])
})
