import test from 'node:test'
import assert from 'node:assert/strict'

import telemetry from '../services/telemetry.js'

test.beforeEach(() => {
  telemetry.resetTelemetryForTests?.()
})

test('complexity calibration recommends raising score for slow/high-failure query type', () => {
  const baseTs = Date.now()
  const nowTs = baseTs + 2_000

  for (let i = 0; i < 12; i += 1) {
    telemetry.recordKpiEvent('routing_complexity_score', 5, { query_type: 'area_analysis' }, baseTs + i)
    telemetry.recordKpiEvent('end_to_end_latency_ms', 9_200 + i * 50, { query_type: 'area_analysis' }, baseTs + i)
  }
  telemetry.recordKpiEvent('sse_event_error', 1, { query_type: 'area_analysis', reason: 'pipeline_error' }, baseTs + 20)
  telemetry.recordKpiEvent('critic_async_review', 1, { query_type: 'area_analysis', pass: 'false' }, baseTs + 21)

  const report = telemetry.getComplexityCalibrationReport({
    window: '10m',
    nowTs
  })

  const row = (report?.by_query_type || []).find((item) => item.query_type === 'area_analysis')
  assert.ok(row)
  assert.equal(row.current_complexity_score, 5)
  assert.equal(row.suggested_complexity_score, 6)
  assert.equal(row.recommendation, 'raise')
  assert.equal(row.metrics?.sample_count, 12)
})

test('complexity calibration recommends lowering score for stable low-latency query type', () => {
  const baseTs = Date.now()
  const nowTs = baseTs + 2_000

  for (let i = 0; i < 12; i += 1) {
    telemetry.recordKpiEvent('routing_complexity_score', 6, { query_type: 'poi_search' }, baseTs + i)
    telemetry.recordKpiEvent('end_to_end_latency_ms', 1_200 + i * 5, { query_type: 'poi_search' }, baseTs + i)
  }
  telemetry.recordKpiEvent('critic_async_review', 1, { query_type: 'poi_search', pass: 'true' }, baseTs + 20)

  const report = telemetry.getComplexityCalibrationReport({
    window: '10m',
    nowTs
  })

  const row = (report?.by_query_type || []).find((item) => item.query_type === 'poi_search')
  assert.ok(row)
  assert.equal(row.current_complexity_score, 6)
  assert.equal(row.suggested_complexity_score, 5)
  assert.equal(row.recommendation, 'lower')
})
