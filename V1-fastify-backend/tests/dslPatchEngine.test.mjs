import test from 'node:test'
import assert from 'node:assert/strict'

import { validateDsl } from '../services/dslValidator.js'
import { evaluateContextBindingConsistency } from '../services/dslSemanticRules.js'

function buildValidDsl() {
  return {
    dsl_version: 'spatial_query_v1',
    trace_id: 'trace_patch_test_001',
    session_id: 'session_patch_test_001',
    task: {
      query_type: 'area_analysis',
      goal: 'Analyze current area',
      need_text_answer: true
    },
    scope: {
      geometry_source: 'viewport',
      viewport: [114.3, 30.5, 114.4, 30.6]
    },
    entities: {
      categories: ['coffee'],
      keywords: ['specialty']
    },
    constraints: {
      result_limit: 120,
      latency_budget_ms: 1200,
      token_budget: 2400
    },
    operators: [],
    output_contract: {
      required_fields: ['pois', 'stats'],
      max_items: 100,
      include_evidence_refs: true,
      include_writer_text: true
    },
    uncertainty: {
      planner_confidence: 0.9,
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
      budget_tier: 'realtime',
      allow_visual_review: true,
      allow_reasoning: false
    },
    routing: {
      complexity_score: 3,
      critic_enabled: false
    },
    context_binding: {
      viewport_hash: 'sha1:view_hash_001',
      client_view_id: 'view_001',
      event_seq: 1
    },
    revision: {
      mode: 'rebuild',
      base_trace_id: null,
      patch_ops: []
    },
    streaming_hints: {
      allow_prefetch: false,
      prefetch_on_fields: []
    }
  }
}

function buildPatchDsl(patchOps = []) {
  const dsl = buildValidDsl()
  dsl.trace_id = 'trace_patch_test_002'
  dsl.revision = {
    mode: 'patch',
    base_trace_id: 'trace_patch_test_001',
    patch_ops: patchOps
  }
  return dsl
}

test('validateDsl rejects unsupported patch op', () => {
  const baseDsl = buildValidDsl()
  const patchDsl = buildPatchDsl([
    { op: 'copy', from: '/entities/categories/0', path: '/entities/categories/1' }
  ])

  const result = validateDsl(patchDsl, { compatMode: 'strict', baseDsl })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_semantic_invalid')
  assert.match(String(result.fix_hint || ''), /add\/remove\/replace/i)
})

test('validateDsl rejects blacklisted patch path', () => {
  const baseDsl = buildValidDsl()
  const patchDsl = buildPatchDsl([
    { op: 'replace', path: '/policy/budget_tier', value: 'deep' }
  ])

  const result = validateDsl(patchDsl, { compatMode: 'strict', baseDsl })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_semantic_invalid')
  assert.match(String(result.fix_hint || ''), /blacklist|forbidden|禁止|拒绝/i)
})

test('validateDsl rejects rebuild-only patch path', () => {
  const baseDsl = buildValidDsl()
  const patchDsl = buildPatchDsl([
    { op: 'replace', path: '/task/query_type', value: 'poi_search' }
  ])

  const result = validateDsl(patchDsl, { compatMode: 'strict', baseDsl })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_semantic_invalid')
  assert.match(String(result.fix_hint || ''), /rebuild|重建/i)
})

test('validateDsl rejects constraints latency patch when budget tier becomes inconsistent', () => {
  const baseDsl = buildValidDsl()
  const patchDsl = buildPatchDsl([
    { op: 'replace', path: '/constraints/latency_budget_ms', value: 5000 }
  ])

  const result = validateDsl(patchDsl, { compatMode: 'strict', baseDsl })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_semantic_invalid')
  assert.match(String(result.fix_hint || ''), /budget_tier|latency_budget_ms|重建|rebuild/i)
})

test('validateDsl rejects broad constraints root patch path', () => {
  const baseDsl = buildValidDsl()
  const patchDsl = buildPatchDsl([
    { op: 'replace', path: '/constraints', value: {} }
  ])

  const result = validateDsl(patchDsl, { compatMode: 'strict', baseDsl })

  assert.equal(result.ok, false)
  assert.equal(result.error_code, 'dsl_semantic_invalid')
  assert.match(String(result.fix_hint || ''), /constraints|specific field|whitelist/i)
})

test('validateDsl applies replace patch on allowed path and returns patched DSL', () => {
  const baseDsl = buildValidDsl()
  const patchDsl = buildPatchDsl([
    { op: 'replace', path: '/entities/categories', value: ['bakery'] }
  ])

  const result = validateDsl(patchDsl, { compatMode: 'strict', baseDsl })

  assert.equal(result.ok, true)
  assert.deepEqual(result.normalized_dsl.entities.categories, ['bakery'])
  assert.equal(result.normalized_dsl.revision.mode, 'patch')
})

test('evaluateContextBindingConsistency marks stale request when event_seq goes backwards', () => {
  const decision = evaluateContextBindingConsistency({
    currentBinding: {
      client_view_id: 'view_01',
      event_seq: 6,
      viewport_hash: 'sha1:new'
    },
    previousState: {
      last_event_seq: 7,
      last_viewport_hash: 'sha1:old'
    },
    riskLevel: 'low'
  })

  assert.equal(decision.context_stale, true)
  assert.equal(decision.requires_clarification, true)
})

test('evaluateContextBindingConsistency auto-refreshes on low risk hash mismatch', () => {
  const decision = evaluateContextBindingConsistency({
    currentBinding: {
      client_view_id: 'view_01',
      event_seq: 8,
      viewport_hash: 'sha1:new'
    },
    previousState: {
      last_event_seq: 7,
      last_viewport_hash: 'sha1:old'
    },
    riskLevel: 'low'
  })

  assert.equal(decision.context_refreshed, true)
  assert.equal(decision.requires_clarification, false)
})

test('evaluateContextBindingConsistency requires clarification on high risk hash mismatch', () => {
  const decision = evaluateContextBindingConsistency({
    currentBinding: {
      client_view_id: 'view_01',
      event_seq: 8,
      viewport_hash: 'sha1:new'
    },
    previousState: {
      last_event_seq: 7,
      last_viewport_hash: 'sha1:old'
    },
    riskLevel: 'critical'
  })

  assert.equal(decision.context_refreshed, false)
  assert.equal(decision.requires_clarification, true)
})
