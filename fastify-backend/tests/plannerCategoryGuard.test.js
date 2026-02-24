import test from 'node:test'
import assert from 'node:assert/strict'

import { applyAreaAnalysisCategoryGuard } from '../routes/ai/planner.js'

test('removes mobility-only categories for generic area analysis', () => {
  const queryPlan = {
    query_type: 'area_analysis',
    intent_mode: 'macro_overview',
    categories: ['商场', '停车场', '地铁站', '咖啡厅']
  }

  const guarded = applyAreaAnalysisCategoryGuard(
    queryPlan,
    '请在30秒内分析这片区主导业态和活力热点'
  )

  assert.deepEqual(guarded.categories, ['商场', '咖啡厅'])
})

test('keeps mobility categories when transport intent is explicit', () => {
  const queryPlan = {
    query_type: 'area_analysis',
    intent_mode: 'macro_overview',
    categories: ['商场', '停车场', '地铁站']
  }

  const guarded = applyAreaAnalysisCategoryGuard(
    queryPlan,
    '请评估这片区15分钟交通可达性和地铁换乘便利度'
  )

  assert.deepEqual(guarded.categories, ['商场', '停车场', '地铁站'])
})

test('does not alter non-area-analysis query plans', () => {
  const queryPlan = {
    query_type: 'poi_search',
    intent_mode: 'local_search',
    categories: ['停车场', '地铁站']
  }

  const guarded = applyAreaAnalysisCategoryGuard(
    queryPlan,
    '附近哪里有停车场'
  )

  assert.deepEqual(guarded.categories, ['停车场', '地铁站'])
})
