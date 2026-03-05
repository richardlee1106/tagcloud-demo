import test from 'node:test'
import assert from 'node:assert/strict'

import { generateQueryFingerprint } from '../services/queryCache.js'

test('fingerprint changes when user question changes', () => {
  const queryPlan = {
    query_type: 'area_analysis',
    categories: [],
    semantic_query: '具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽'
  }
  const spatialContext = {
    viewport: [114.3000, 30.5500, 114.3500, 30.6000]
  }

  const first = generateQueryFingerprint(queryPlan, spatialContext, {
    queryType: 'area_analysis',
    route: 'spatial_job_runner',
    userQuestion: '请分析这片区域的主导业态'
  })

  const second = generateQueryFingerprint(queryPlan, spatialContext, {
    queryType: 'area_analysis',
    route: 'spatial_job_runner',
    userQuestion: '请分析这片区域的教育资源结构'
  })

  assert.notEqual(first, second)
})

test('fingerprint changes when viewport bounds change even if center is close', () => {
  const queryPlan = {
    query_type: 'area_analysis',
    categories: [],
    semantic_query: '具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽'
  }

  const base = generateQueryFingerprint(
    queryPlan,
    { viewport: [114.3000, 30.5500, 114.3500, 30.6000] },
    { queryType: 'area_analysis', route: 'spatial_job_runner', userQuestion: '请给出关键结论' }
  )

  const changed = generateQueryFingerprint(
    queryPlan,
    { viewport: [114.3020, 30.5520, 114.3520, 30.6020] },
    { queryType: 'area_analysis', route: 'spatial_job_runner', userQuestion: '请给出关键结论' }
  )

  assert.notEqual(base, changed)
})

test('fingerprint normalizes user question spacing and casing', () => {
  const queryPlan = {
    query_type: 'poi_search',
    categories: ['咖啡店'],
    semantic_query: '咖啡 店'
  }
  const spatialContext = {
    center: { lon: 114.321, lat: 30.592 }
  }

  const first = generateQueryFingerprint(queryPlan, spatialContext, {
    queryType: 'poi_search',
    route: 'spatial_job_runner',
    userQuestion: '  FIND   COFFEE  '
  })

  const second = generateQueryFingerprint(queryPlan, spatialContext, {
    queryType: 'poi_search',
    route: 'spatial_job_runner',
    userQuestion: 'find coffee'
  })

  assert.equal(first, second)
})
