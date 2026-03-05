import test from 'node:test'
import assert from 'node:assert/strict'

import telemetry from '../services/telemetry.js'

test('kpi report exposes prefetch wasted rate and query_type breakdown', () => {
  const sampleTs = Date.now()
  const nowTs = sampleTs + 1_000

  telemetry.recordKpiEvent('prefetch_hit', 1, { query_type: 'area_analysis' }, sampleTs)
  telemetry.recordKpiEvent('prefetch_hit', 1, { query_type: 'area_analysis' }, sampleTs + 1)
  telemetry.recordKpiEvent('prefetch_wasted', 1, { query_type: 'area_analysis' }, sampleTs + 2)
  telemetry.recordKpiEvent('prefetch_degraded', 1, { query_type: 'area_analysis' }, sampleTs + 3)
  telemetry.recordKpiEvent('prefetch_overlap_delta_ms', -120, { query_type: 'area_analysis' }, sampleTs + 4)

  const report = telemetry.getKpiReport({
    window: '10m',
    nowTs
  })

  const currentMetrics = report?.periods?.current?.metrics || {}
  const byQueryType = currentMetrics.prefetch_wasted_rate_by_query_type || {}

  assert.equal(currentMetrics.prefetch_degraded_total, 1)
  assert.equal(currentMetrics.prefetch_wasted_total, 1)
  assert.equal(currentMetrics.prefetch_wasted_rate, 0.5)
  assert.equal(byQueryType.area_analysis, 0.5)
  assert.equal(currentMetrics.prefetch_overlap_delta_ms_p50, -120)
  assert.equal(report?.gate?.prefetch_quality?.pass, false)
  assert.equal(Array.isArray(report?.gate?.prefetch_quality?.flagged_query_types), true)
  assert.equal(report?.gate?.prefetch_quality?.flagged_query_types?.[0]?.query_type, 'area_analysis')
})
