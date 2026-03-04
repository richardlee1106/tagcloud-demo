import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createPrefetchOrchestrator,
  PREFETCH_TRIGGER_FIELDS,
  PREFETCH_STREAM_EVENTS
} from '../services/prefetchOrchestrator.js'

function buildQueryPlan() {
  return {
    query_type: 'area_analysis',
    categories: ['餐饮服务'],
    scope: {
      geometry_source: 'viewport',
      viewport: [114.3, 30.5, 114.4, 30.6]
    }
  }
}

test('prefetch orchestrator triggers scope/entities prefetch and marks wasted on DSL failure', async () => {
  const cacheCalls = []
  const cache = {
    async getFromCache(fingerprint) {
      cacheCalls.push(fingerprint)
      if (fingerprint.includes('entities')) {
        return { cached: true, fingerprint }
      }
      return null
    }
  }

  const orchestrator = createPrefetchOrchestrator({
    requestId: 'trace_prefetch_hit',
    queryPlan: buildQueryPlan(),
    queryType: 'area_analysis',
    streamingHints: {
      allow_prefetch: true,
      prefetch_on_fields: [
        PREFETCH_TRIGGER_FIELDS.SCOPE,
        PREFETCH_TRIGGER_FIELDS.ENTITIES_CATEGORIES
      ]
    },
    plannerStreamEvents: [
      { type: PREFETCH_STREAM_EVENTS.SCOPE_READY },
      { type: PREFETCH_STREAM_EVENTS.ENTITIES_READY }
    ],
    buildFingerprint: ({ stage }) => `fp:${stage}`,
    cache
  })

  orchestrator.triggerFromPlannerEvents()
  orchestrator.markExecutionStart(Date.now() + 5)

  const summary = await orchestrator.finalize({
    validationPassed: false,
    dslFailureErrorCode: 'dsl_semantic_invalid'
  })

  assert.equal(cacheCalls.length, 2)
  assert.equal(summary.prefetch_attempted, true)
  assert.equal(summary.prefetch_hit, true)
  assert.equal(summary.prefetch_wasted, true)
  assert.equal(summary.dsl_failure_error_code, 'dsl_semantic_invalid')
  assert.ok(Number.isFinite(summary.prefetch_overlap_delta_ms))
})

test('prefetch orchestrator degrades on cache failure without throwing', async () => {
  const cache = {
    async getFromCache() {
      throw Object.assign(new Error('redis timeout'), { code: 'redis_timeout' })
    }
  }

  const orchestrator = createPrefetchOrchestrator({
    requestId: 'trace_prefetch_degraded',
    queryPlan: buildQueryPlan(),
    queryType: 'area_analysis',
    streamingHints: {
      allow_prefetch: true,
      prefetch_on_fields: [PREFETCH_TRIGGER_FIELDS.SCOPE]
    },
    plannerStreamEvents: [{ type: PREFETCH_STREAM_EVENTS.SCOPE_READY }],
    buildFingerprint: ({ stage }) => `fp:${stage}`,
    cache
  })

  orchestrator.triggerFromPlannerEvents()
  const summary = await orchestrator.finalize()

  assert.equal(summary.prefetch_degraded, true)
  assert.equal(summary.prefetch_hit, false)
  assert.deepEqual(summary.prefetch_error_codes, ['redis_timeout'])
})

test('prefetch orchestrator stays disabled when allow_prefetch is false', async () => {
  let called = false
  const cache = {
    async getFromCache() {
      called = true
      return null
    }
  }

  const orchestrator = createPrefetchOrchestrator({
    requestId: 'trace_prefetch_disabled',
    queryPlan: buildQueryPlan(),
    queryType: 'area_analysis',
    streamingHints: {
      allow_prefetch: false,
      prefetch_on_fields: [PREFETCH_TRIGGER_FIELDS.SCOPE]
    },
    plannerStreamEvents: [{ type: PREFETCH_STREAM_EVENTS.SCOPE_READY }],
    buildFingerprint: ({ stage }) => `fp:${stage}`,
    cache
  })

  orchestrator.triggerFromPlannerEvents()
  const summary = await orchestrator.finalize()

  assert.equal(called, false)
  assert.equal(summary.prefetch_enabled, false)
  assert.equal(summary.prefetch_attempted, false)
  assert.equal(summary.prefetch_degraded, false)
})
