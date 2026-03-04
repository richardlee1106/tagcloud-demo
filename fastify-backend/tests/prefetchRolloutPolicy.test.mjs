import test from 'node:test'
import assert from 'node:assert/strict'

import { resolvePrefetchRolloutPolicy } from '../services/prefetchRolloutPolicy.js'

test('rollout enables allow_prefetch for matched env and query_type', () => {
  const resolved = resolvePrefetchRolloutPolicy({
    streamingHints: {
      allow_prefetch: false,
      prefetch_on_fields: []
    },
    queryType: 'area_analysis',
    env: {
      NODE_ENV: 'production',
      SPATIAL_PREFETCH_ROLLOUT_ENABLED: 'true',
      SPATIAL_PREFETCH_ROLLOUT_ENVS: 'staging,production',
      SPATIAL_PREFETCH_ROLLOUT_QUERY_TYPES: 'area_analysis,poi_search'
    }
  })

  assert.equal(resolved.allow_prefetch, true)
  assert.deepEqual(resolved.prefetch_on_fields, ['scope', 'entities.categories'])
  assert.equal(resolved.prefetch_policy_source, 'rollout')
  assert.equal(resolved.prefetch_rollout_env_match, true)
  assert.equal(resolved.prefetch_rollout_query_type_match, true)
})

test('rollout keeps allow_prefetch disabled when query_type does not match', () => {
  const resolved = resolvePrefetchRolloutPolicy({
    streamingHints: {
      allow_prefetch: false,
      prefetch_on_fields: []
    },
    queryType: 'general_qa',
    env: {
      NODE_ENV: 'production',
      SPATIAL_PREFETCH_ROLLOUT_ENABLED: 'true',
      SPATIAL_PREFETCH_ROLLOUT_QUERY_TYPES: 'area_analysis,poi_search'
    }
  })

  assert.equal(resolved.allow_prefetch, false)
  assert.deepEqual(resolved.prefetch_on_fields, [])
  assert.equal(resolved.prefetch_policy_source, 'disabled')
  assert.equal(resolved.prefetch_rollout_query_type_match, false)
})

test('force disable overrides request-level allow_prefetch', () => {
  const resolved = resolvePrefetchRolloutPolicy({
    streamingHints: {
      allow_prefetch: true,
      prefetch_on_fields: ['scope']
    },
    queryType: 'area_analysis',
    env: {
      NODE_ENV: 'production',
      SPATIAL_PREFETCH_FORCE_DISABLE: 'true',
      SPATIAL_PREFETCH_ROLLOUT_ENABLED: 'true',
      SPATIAL_PREFETCH_ROLLOUT_QUERY_TYPES: 'area_analysis'
    }
  })

  assert.equal(resolved.allow_prefetch, false)
  assert.deepEqual(resolved.prefetch_on_fields, [])
  assert.equal(resolved.prefetch_policy_source, 'force_disabled')
})

test('request-level allow_prefetch keeps explicit fields when rollout is off', () => {
  const resolved = resolvePrefetchRolloutPolicy({
    streamingHints: {
      allow_prefetch: true,
      prefetch_on_fields: ['scope', 'entities.categories']
    },
    queryType: 'area_analysis',
    env: {
      NODE_ENV: 'development',
      SPATIAL_PREFETCH_ROLLOUT_ENABLED: 'false'
    }
  })

  assert.equal(resolved.allow_prefetch, true)
  assert.deepEqual(resolved.prefetch_on_fields, ['scope', 'entities.categories'])
  assert.equal(resolved.prefetch_policy_source, 'request')
})

test('rollout falls back to default fields when env fields are invalid', () => {
  const resolved = resolvePrefetchRolloutPolicy({
    streamingHints: {
      allow_prefetch: false,
      prefetch_on_fields: []
    },
    queryType: 'area_analysis',
    env: {
      NODE_ENV: 'production',
      SPATIAL_PREFETCH_ROLLOUT_ENABLED: 'true',
      SPATIAL_PREFETCH_ROLLOUT_QUERY_TYPES: 'area_analysis',
      SPATIAL_PREFETCH_ROLLOUT_FIELDS: 'invalid_field'
    }
  })

  assert.equal(resolved.allow_prefetch, true)
  assert.deepEqual(resolved.prefetch_on_fields, ['scope', 'entities.categories'])
})
