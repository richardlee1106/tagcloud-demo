import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRigorousConditionGroups,
  runRigorousBenchmark,
  runSpikeComparison,
  runStateMachineParser,
  runThirdPartyParser
} from '../scripts/spikes/streaming_dsl_parser_spike.mjs'

const COMPLETE_JSON_CHUNKS = [
  '{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]},"entities":{"categories":["coffee"]}}'
]

const TRUNCATED_JSON_CHUNKS = [
  '{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":{"geometry_source":"viewport","viewport":[114.3,30.5'
]

const OUT_OF_ORDER_JSON_CHUNKS = [
  '{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":',
  ',"entities":{"categories":["coffee","bakery"]},"constraints":{"latency_budget_ms":3000},"operators":[]}',
  '{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]}'
]

test('state machine can detect top-level scope close from complete stream', () => {
  const result = runStateMachineParser(COMPLETE_JSON_CHUNKS)
  assert.equal(result.ok, true)
  assert.equal(result.scope_closed, true)
  assert.ok(Number.isInteger(result.scope_closed_chunk_index))
})

test('state machine does not crash on truncated stream', () => {
  const result = runStateMachineParser(TRUNCATED_JSON_CHUNKS)
  assert.equal(result.ok, true)
  assert.equal(result.scope_closed, false)
  assert.equal(result.truncated_detected, true)
})

test('state machine can flag malformed out-of-order stream as parse error', () => {
  const result = runStateMachineParser(OUT_OF_ORDER_JSON_CHUNKS)
  assert.equal(result.ok, false)
  assert.equal(Boolean(result.parse_error), true)
})

test('third-party parser does not crash on truncated stream', async () => {
  const result = await runThirdPartyParser(TRUNCATED_JSON_CHUNKS)
  assert.equal(result.ok, true)
  assert.equal(result.scope_closed, false)
  assert.equal(result.truncated_detected, true)
})

test('comparison report includes two candidate strategies and recommendation', async () => {
  const report = await runSpikeComparison({
    samples: [
      {
        name: 'complete',
        chunks: COMPLETE_JSON_CHUNKS
      },
      {
        name: 'truncated',
        chunks: TRUNCATED_JSON_CHUNKS
      }
    ]
  })

  assert.ok(Array.isArray(report.candidates))
  assert.equal(report.candidates.length, 2)
  assert.ok(report.recommendation)
  assert.ok(report.recommendation.selected)
})

test('rigorous benchmark defines multi-condition groups and returns ranked recommendation', () => {
  const groups = buildRigorousConditionGroups()
  assert.ok(groups.length >= 20)

  const report = runRigorousBenchmark({
    iterations: 3,
    warmup: 1,
    groupIds: groups.slice(0, 4).map((g) => g.id)
  })

  assert.equal(report.mode, 'rigorous')
  assert.equal(report.group_reports.length, 4)
  assert.equal(report.candidate_summary.length, 2)
  assert.ok(['third_party_jsonparse', 'internal_state_machine'].includes(report.recommendation.selected))
})
