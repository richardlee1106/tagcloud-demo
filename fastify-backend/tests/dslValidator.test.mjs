import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validateDsl,
  assertValidSpatialPlan,
  DslValidationError
} from '../services/dslValidator.js'

function buildValidDsl() {
  return {
    dsl_version: 'spatial_query_v1',
    trace_id: 'trace_test_001',
    task: {
      query_type: 'area_analysis',
      goal: 'Analyze current area',
      need_text_answer: true,
      answer_style: 'brief'
    },
    scope: {
      geometry_source: 'viewport',
      viewport: [114.30, 30.50, 114.40, 30.60]
    },
    entities: {
      categories: ['coffee']
    },
    constraints: {
      result_limit: 120,
      latency_budget_ms: 3000,
      direction: 'none'
    },
    operators: [
      {
        id: 'fetch_1',
        type: 'fetch_candidates',
        enabled: true,
        params: {
          limit: 200,
          order_by_distance: true
        }
      },
      {
        id: 'filter_1',
        type: 'filter_constraints',
        enabled: true,
        depends_on: ['fetch_1'],
        params: {
          rating_min: 3.5,
          distance_max_m: 2000
        }
      }
    ],
    output_contract: {
      required_fields: ['pois', 'stats'],
      max_items: 100,
      include_evidence_refs: true,
      include_writer_text: true
    },
    uncertainty: {
      planner_confidence: 0.85,
      risk_level: 'low',
      clarification: {
        required: false,
        question: null
      }
    },
    policy: {
      cacheable: true,
      cache_key_profile: 'semantic',
      execution_profile: 'advanced',
      budget_tier: 'interactive',
      allow_visual_review: true,
      allow_reasoning: false
    },
    routing: {
      complexity_score: 6,
      critic_enabled: false
    },
    context_binding: {
      viewport_hash: 'sha1:viewport_demo_001',
      client_view_id: 'view_demo_001',
      event_seq: 1,
      map_state_version: 'map_demo_001',
      captured_at_ms: 1760000000000,
      source: 'frontend_injected'
    },
    revision: {
      mode: 'rebuild',
      base_trace_id: null,
      patch_ops: []
    },
    streaming_hints: {
      allow_prefetch: true,
      prefetch_on_fields: ['scope', 'entities.categories']
    }
  }
}

test('validateDsl returns dsl_schema_invalid when operator params include unsupported keys', () => {
  const dsl = buildValidDsl()
  dsl.operators[0].params.unexpected = 1

  const result = validateDsl(dsl, { compatMode: 'strict' })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_schema_invalid')
  assert.ok(Array.isArray(result.errors))
  assert.ok(result.errors.length > 0)
})

test('validateDsl returns dsl_semantic_invalid for region_comparison with invalid scope/operators', () => {
  const dsl = buildValidDsl()
  dsl.task.query_type = 'region_comparison'
  dsl.scope.geometry_source = 'regions'
  dsl.scope.region_ids = ['region_a']
  dsl.operators = dsl.operators.filter((op) => op.type !== 'region_compare')

  const result = validateDsl(dsl, { compatMode: 'strict' })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_semantic_invalid')
  assert.ok(result.fix_hint)
})

test('validateDsl returns dsl_policy_invalid when budget tier and latency budget mismatch', () => {
  const dsl = buildValidDsl()
  dsl.policy.budget_tier = 'realtime'
  dsl.constraints.latency_budget_ms = 4000

  const result = validateDsl(dsl, { compatMode: 'strict' })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_policy_invalid')
  assert.ok(result.fix_hint)
})

test('assertValidSpatialPlan throws DslValidationError for invalid DSL input', () => {
  const dsl = buildValidDsl()
  dsl.operators[0].params.unexpected = 1

  assert.throws(() => {
    assertValidSpatialPlan(dsl, { compatMode: 'strict' })
  }, (err) => {
    assert.ok(err instanceof DslValidationError)
    assert.equal(err.code, 'dsl_schema_invalid')
    return true
  })
})
