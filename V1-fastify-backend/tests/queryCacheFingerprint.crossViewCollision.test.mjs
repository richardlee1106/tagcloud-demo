import test from 'node:test'
import assert from 'node:assert/strict'

import { generateQueryFingerprint } from '../services/queryCache.js'

function buildPlan() {
  return {
    query_type: 'area_analysis',
    categories: ['中餐厅', '高等院校'],
    semantic_query: '主导业态分析',
    anchor: {
      lat: 30.5601,
      lon: 114.3199
    }
  }
}

function buildExtra(overrides = {}) {
  return {
    queryType: 'area_analysis',
    route: 'spatial_job_runner',
    userQuestion: '这片区域主导业态是什么？',
    sourcePolicy: {
      category_source: 'all_categories',
      geometry_source: 'viewport',
      has_custom_area: false,
      has_category_filter: false,
      selected_categories: []
    },
    ...overrides
  }
}

test('fingerprint isolates different viewport bounds even when anchor is unchanged', () => {
  const queryPlan = buildPlan()

  const first = generateQueryFingerprint(
    queryPlan,
    {
      center: { lat: 30.5601, lon: 114.3199 },
      viewport: [114.2900, 30.5400, 114.3500, 30.6100]
    },
    buildExtra()
  )

  const second = generateQueryFingerprint(
    queryPlan,
    {
      center: { lat: 30.5601, lon: 114.3199 },
      viewport: [114.3010, 30.5510, 114.3320, 30.5920]
    },
    buildExtra()
  )

  assert.notEqual(first, second)
})

test('fingerprint isolates different context_binding.viewport_hash values', () => {
  const queryPlan = buildPlan()
  const spatialContext = {
    viewport: [114.2900, 30.5400, 114.3500, 30.6100],
    context_binding: {
      viewport_hash: 'view_hash_a'
    }
  }

  const first = generateQueryFingerprint(
    queryPlan,
    spatialContext,
    buildExtra({
      contextBinding: { viewport_hash: 'view_hash_a' }
    })
  )

  const second = generateQueryFingerprint(
    queryPlan,
    spatialContext,
    buildExtra({
      contextBinding: { viewport_hash: 'view_hash_b' }
    })
  )

  assert.notEqual(first, second)
})

test('fingerprint isolates different map zoom buckets', () => {
  const queryPlan = buildPlan()
  const spatialContext = {
    viewport: [114.2900, 30.5400, 114.3500, 30.6100]
  }

  const first = generateQueryFingerprint(
    queryPlan,
    spatialContext,
    buildExtra({
      mapZoom: 12.2
    })
  )

  const second = generateQueryFingerprint(
    queryPlan,
    spatialContext,
    buildExtra({
      mapZoom: 16.8
    })
  )

  assert.notEqual(first, second)
})

