import os from 'os'

const counterStore = new Map()
const gaugeStore = new Map()
const histogramStore = new Map()
const kpiEvents = []
const operatorSamples = []

const MAX_KPI_EVENTS = Math.max(1_000, Number.parseInt(process.env.TELEMETRY_MAX_KPI_EVENTS || '60000', 10))
const MAX_OPERATOR_SAMPLES = Math.max(500, Number.parseInt(process.env.TELEMETRY_MAX_OPERATOR_SAMPLES || '30000', 10))
const DEFAULT_RETENTION_DAYS = Math.max(7, Number.parseInt(process.env.TELEMETRY_RETENTION_DAYS || '30', 10))

const HISTOGRAM_BUCKETS = Object.freeze({
  first_token_latency_ms: [100, 250, 500, 800, 1200, 2000, 3000, 5000, 8000, 12000],
  end_to_end_latency_ms: [200, 500, 1000, 2000, 4000, 8000, 12000, 20000, 35000, 60000],
  stage_duration_ms: [20, 50, 100, 200, 500, 800, 1200, 2000, 4000, 8000, 16000],
  cache_lookup_ms: [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000]
})

function sanitizeMetricName(name) {
  return String(name || 'unnamed_metric')
    .trim()
    .replace(/[^a-zA-Z0-9_:]/g, '_')
}

function normalizeLabels(labels = {}) {
  const normalized = {}
  Object.keys(labels || {})
    .sort()
    .forEach((key) => {
      const value = labels[key]
      if (value === undefined || value === null) return
      normalized[String(key)] = String(value)
    })
  return normalized
}

function labelKey(labels = {}) {
  const entries = Object.entries(labels)
  if (!entries.length) return ''
  return entries.map(([key, value]) => `${key}=${value}`).join('|')
}

function buildMetricKey(name, labels = {}) {
  return `${sanitizeMetricName(name)}::${labelKey(normalizeLabels(labels))}`
}

function pushBounded(list, item, maxSize) {
  list.push(item)
  if (list.length > maxSize) {
    list.splice(0, list.length - maxSize)
  }
}

function pruneByAge(list, retentionDays = DEFAULT_RETENTION_DAYS) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  while (list.length > 0 && Number(list[0]?.ts || 0) < cutoff) {
    list.shift()
  }
}

function percentile(values = [], p = 95) {
  if (!Array.isArray(values) || values.length === 0) return null
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const rank = Math.ceil((Math.max(0, Math.min(100, p)) / 100) * sorted.length)
  return sorted[Math.max(0, rank - 1)]
}

function parseWindowToMs(window = '7d') {
  if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
    return window
  }
  const raw = String(window || '7d').trim().toLowerCase()
  const match = raw.match(/^(\d+)([dhm])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000

  const count = Number.parseInt(match[1], 10)
  const unit = match[2]
  if (!Number.isFinite(count) || count <= 0) return 7 * 24 * 60 * 60 * 1000

  if (unit === 'm') return count * 60 * 1000
  if (unit === 'h') return count * 60 * 60 * 1000
  return count * 24 * 60 * 60 * 1000
}

function formatPrometheusLabels(labels = {}) {
  const entries = Object.entries(normalizeLabels(labels))
  if (!entries.length) return ''
  const escaped = entries.map(([key, value]) => {
    const safeValue = String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/"/g, '\\"')
    return `${key}="${safeValue}"`
  })
  return `{${escaped.join(',')}}`
}

function getHistogramBuckets(name) {
  const metricName = sanitizeMetricName(name)
  return HISTOGRAM_BUCKETS[metricName] || [1, 5, 10, 25, 50, 100, 250, 500, 1000]
}

export function incrementCounter(name, labels = {}, amount = 1) {
  const metricName = sanitizeMetricName(name)
  const normalizedLabels = normalizeLabels(labels)
  const key = buildMetricKey(metricName, normalizedLabels)
  const delta = Number(amount)
  if (!Number.isFinite(delta)) return

  const current = counterStore.get(key)
  if (current) {
    current.value += delta
    return
  }

  counterStore.set(key, {
    name: metricName,
    labels: normalizedLabels,
    value: delta
  })
}

export function setGauge(name, value, labels = {}) {
  const metricName = sanitizeMetricName(name)
  const normalizedLabels = normalizeLabels(labels)
  const key = buildMetricKey(metricName, normalizedLabels)
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return

  gaugeStore.set(key, {
    name: metricName,
    labels: normalizedLabels,
    value: numericValue
  })
}

export function observeHistogram(name, value, labels = {}) {
  const metricName = sanitizeMetricName(name)
  const normalizedLabels = normalizeLabels(labels)
  const key = buildMetricKey(metricName, normalizedLabels)
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) return

  const buckets = getHistogramBuckets(metricName)
  const existing = histogramStore.get(key)
  if (!existing) {
    histogramStore.set(key, {
      name: metricName,
      labels: normalizedLabels,
      buckets,
      counts: Array(buckets.length).fill(0),
      sum: numericValue,
      count: 1
    })
  } else {
    existing.sum += numericValue
    existing.count += 1
  }

  const target = histogramStore.get(key)
  for (let i = 0; i < target.buckets.length; i += 1) {
    if (numericValue <= target.buckets[i]) {
      target.counts[i] += 1
    }
  }
}

export function startTimer(metricName, labels = {}) {
  const startedAt = Date.now()
  return (extraLabels = {}) => {
    const endedAt = Date.now()
    observeHistogram(metricName, endedAt - startedAt, {
      ...labels,
      ...extraLabels
    })
    return endedAt - startedAt
  }
}

export function recordKpiEvent(type, value, labels = {}, ts = Date.now()) {
  const numericValue = Number(value)
  const entry = {
    type: String(type || 'unknown'),
    value: Number.isFinite(numericValue) ? numericValue : 0,
    labels: normalizeLabels(labels),
    ts: Number.isFinite(ts) ? ts : Date.now()
  }

  pushBounded(kpiEvents, entry, MAX_KPI_EVENTS)
  pruneByAge(kpiEvents)
}

export function recordOperatorTimings(traceId, operatorTimingsMs = {}, meta = {}) {
  if (!operatorTimingsMs || typeof operatorTimingsMs !== 'object') return

  const now = Date.now()
  const normalizedMeta = normalizeLabels(meta)

  Object.entries(operatorTimingsMs).forEach(([operatorName, rawValue]) => {
    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue) || numericValue < 0) return

    const sample = {
      trace_id: traceId ? String(traceId) : null,
      operator: String(operatorName),
      total_time_ms: numericValue,
      ts: now,
      ...normalizedMeta
    }

    pushBounded(operatorSamples, sample, MAX_OPERATOR_SAMPLES)
  })

  pruneByAge(operatorSamples)
}

export function logStructured(level, event, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: String(level || 'info').toLowerCase(),
    event: String(event || 'event'),
    hostname: os.hostname(),
    ...payload
  }

  const line = JSON.stringify(entry)
  if (entry.level === 'error') {
    console.error(line)
    return
  }

  if (entry.level === 'warn' || entry.level === 'warning') {
    console.warn(line)
    return
  }

  console.log(line)
}

function buildWindowStats(fromTs, toTs) {
  const filtered = kpiEvents.filter((event) => event.ts >= fromTs && event.ts < toTs)

  const firstTokenValues = filtered
    .filter((event) => event.type === 'first_token_latency_ms')
    .map((event) => event.value)
  const endToEndValues = filtered
    .filter((event) => event.type === 'end_to_end_latency_ms')
    .map((event) => event.value)

  const templateImpressions = filtered.filter((event) => event.type === 'template_impression').length
  const templateActions = filtered.filter((event) => {
    return event.type === 'template_click' || event.type === 'locate_click' || event.type === 'followup_click'
  }).length

  const sseEvents = filtered.filter((event) => event.type === 'sse_event').length
  const sseSchemaErrors = filtered.filter((event) => event.type === 'sse_schema_error').length
  const sseEventErrors = filtered.filter((event) => event.type === 'sse_event_error' || event.type === 'sse_schema_error').length

  const cacheL2Ops = filtered.filter((event) => event.type === 'cache_l2_op').length
  const cacheL2Errors = filtered.filter((event) => event.type === 'cache_l2_error').length

  const prefetchAttempts = filtered.filter((event) => event.type === 'prefetch_attempt')
  const prefetchHits = filtered.filter((event) => event.type === 'prefetch_hit')
  const prefetchDegraded = filtered.filter((event) => event.type === 'prefetch_degraded')
  const prefetchWasted = filtered.filter((event) => event.type === 'prefetch_wasted')
  const prefetchOverlapValues = filtered
    .filter((event) => event.type === 'prefetch_overlap_delta_ms')
    .map((event) => Number(event.value))
    .filter(Number.isFinite)

  const prefetchHitByQueryType = new Map()
  const prefetchWastedByQueryType = new Map()
  const readQueryType = (event) => String(event?.labels?.query_type || 'unknown')

  prefetchHits.forEach((event) => {
    const queryType = readQueryType(event)
    prefetchHitByQueryType.set(queryType, Number(prefetchHitByQueryType.get(queryType) || 0) + 1)
  })
  prefetchWasted.forEach((event) => {
    const queryType = readQueryType(event)
    prefetchWastedByQueryType.set(queryType, Number(prefetchWastedByQueryType.get(queryType) || 0) + 1)
  })

  const prefetchWastedRateByQueryType = {}
  const allPrefetchQueryTypes = new Set([
    ...prefetchHitByQueryType.keys(),
    ...prefetchWastedByQueryType.keys()
  ])
  for (const queryType of allPrefetchQueryTypes) {
    const hits = Number(prefetchHitByQueryType.get(queryType) || 0)
    const wasted = Number(prefetchWastedByQueryType.get(queryType) || 0)
    prefetchWastedRateByQueryType[queryType] = hits > 0 ? wasted / hits : 0
  }

  const incidents = filtered.filter((event) => event.type === 'incident')
  const sev12Count = incidents.filter((event) => {
    const severity = String(event.labels.severity || '').toLowerCase()
    return severity === 'sev1' || severity === 'sev2'
  }).length

  const result = {
    first_token_latency_ms_p95: percentile(firstTokenValues, 95),
    end_to_end_latency_ms_p95: percentile(endToEndValues, 95),
    template_action_ctr: templateImpressions > 0 ? templateActions / templateImpressions : 0,
    sse_schema_error_rate: sseEvents > 0 ? sseSchemaErrors / sseEvents : 0,
    sse_event_error_rate: sseEvents > 0 ? sseEventErrors / sseEvents : 0,
    cache_l2_error_rate: cacheL2Ops > 0 ? cacheL2Errors / cacheL2Ops : 0,
    prefetch_degraded_total: prefetchDegraded.length,
    prefetch_wasted_total: prefetchWasted.length,
    prefetch_overlap_delta_ms_p50: percentile(prefetchOverlapValues, 50),
    prefetch_overlap_delta_ms_p95: percentile(prefetchOverlapValues, 95),
    prefetch_wasted_rate: prefetchHits.length > 0 ? prefetchWasted.length / prefetchHits.length : 0,
    prefetch_wasted_rate_by_query_type: prefetchWastedRateByQueryType,
    sev1_sev2_incidents: sev12Count,
    raw: {
      events: filtered.length,
      first_token_samples: firstTokenValues.length,
      end_to_end_samples: endToEndValues.length,
      template_impressions: templateImpressions,
      template_actions: templateActions,
      sse_events: sseEvents,
      sse_schema_errors: sseSchemaErrors,
      sse_event_errors: sseEventErrors,
      cache_l2_ops: cacheL2Ops,
      cache_l2_errors: cacheL2Errors,
      prefetch_attempts: prefetchAttempts.length,
      prefetch_hits: prefetchHits.length,
      prefetch_degraded: prefetchDegraded.length,
      prefetch_wasted: prefetchWasted.length,
      prefetch_overlap_samples: prefetchOverlapValues.length,
      incidents: incidents.length
    }
  }

  return result
}

function ratioImprovement(oldValue, newValue, options = {}) {
  const lowerIsBetter = options.lowerIsBetter !== false
  if (!Number.isFinite(oldValue) || oldValue <= 0 || !Number.isFinite(newValue)) return null
  if (lowerIsBetter) {
    return (oldValue - newValue) / oldValue
  }
  return (newValue - oldValue) / oldValue
}

function buildDailyStats(days = 14) {
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000
  const output = []

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = new Date(now - i * oneDayMs)
    dayStart.setHours(0, 0, 0, 0)
    const fromTs = dayStart.getTime()
    const toTs = fromTs + oneDayMs
    output.push({
      date: new Date(fromTs).toISOString().slice(0, 10),
      ...buildWindowStats(fromTs, toTs)
    })
  }

  return output
}

export function getKpiReport({ window = '7d', nowTs = Date.now() } = {}) {
  const windowMs = parseWindowToMs(window)
  const currentFrom = nowTs - windowMs
  const baselineFrom = currentFrom - windowMs

  const current = buildWindowStats(currentFrom, nowTs)
  const baseline = buildWindowStats(baselineFrom, currentFrom)

  const firstTokenImprovement = ratioImprovement(
    baseline.first_token_latency_ms_p95,
    current.first_token_latency_ms_p95,
    { lowerIsBetter: true }
  )

  const ctrUplift = ratioImprovement(
    baseline.template_action_ctr,
    current.template_action_ctr,
    { lowerIsBetter: false }
  )

  const schemaErrorReduction = ratioImprovement(
    baseline.sse_schema_error_rate,
    current.sse_schema_error_rate,
    { lowerIsBetter: true }
  )

  const m1Gate = {
    first_token_latency_ms: {
      target: 0.25,
      actual: firstTokenImprovement,
      pass: firstTokenImprovement !== null && firstTokenImprovement >= 0.25
    },
    template_action_ctr: {
      target: 0.15,
      actual: ctrUplift,
      pass: ctrUplift !== null && ctrUplift >= 0.15
    },
    sse_schema_error_rate: {
      target: 0.4,
      actual: schemaErrorReduction,
      pass: schemaErrorReduction !== null && schemaErrorReduction >= 0.4
    }
  }

  const dailyStats = buildDailyStats(14)
  const qualifiedStabilityDays = dailyStats.filter((day) => {
    const hasTraffic = Number(day?.raw?.sse_events || 0) > 0
    return hasTraffic && day.sse_event_error_rate < 0.005 && day.cache_l2_error_rate < 0.01 && day.sev1_sev2_incidents === 0
  }).length

  const stabilityGate = {
    required_days: 14,
    qualified_days: qualifiedStabilityDays,
    sse_event_error_rate: {
      target: '<0.5%',
      current: current.sse_event_error_rate,
      pass: current.sse_event_error_rate < 0.005
    },
    cache_l2_error_rate: {
      target: '<1%',
      current: current.cache_l2_error_rate,
      pass: current.cache_l2_error_rate < 0.01
    },
    sev1_sev2_incidents: {
      target: 0,
      current: current.sev1_sev2_incidents,
      pass: current.sev1_sev2_incidents === 0
    },
    pass: qualifiedStabilityDays >= 14
  }

  const m1Pass = Object.values(m1Gate).every((item) => item.pass)
  const prefetchWastedRate = Number(current?.prefetch_wasted_rate || 0)
  const prefetchReviewThreshold = 0.05
  const prefetchWastedRateByQueryType = current?.prefetch_wasted_rate_by_query_type || {}
  const prefetchFlaggedQueryTypes = Object.entries(prefetchWastedRateByQueryType)
    .filter(([, rate]) => Number(rate) > prefetchReviewThreshold)
    .map(([queryType, rate]) => ({
      query_type: queryType,
      wasted_rate: Number(rate)
    }))
    .sort((a, b) => b.wasted_rate - a.wasted_rate)

  return {
    generated_at: new Date(nowTs).toISOString(),
    window,
    periods: {
      current: {
        from: new Date(currentFrom).toISOString(),
        to: new Date(nowTs).toISOString(),
        metrics: current
      },
      baseline: {
        from: new Date(baselineFrom).toISOString(),
        to: new Date(currentFrom).toISOString(),
        metrics: baseline
      }
    },
    gate: {
      m1: {
        pass: m1Pass,
        metrics: m1Gate
      },
      stability: stabilityGate,
      prefetch_quality: {
        threshold: prefetchReviewThreshold,
        current: prefetchWastedRate,
        pass: prefetchWastedRate <= prefetchReviewThreshold,
        flagged_query_types: prefetchFlaggedQueryTypes
      },
      route_b_ready: m1Pass && stabilityGate.pass
    },
    daily_stability: dailyStats
  }
}

export function getOperatorHotspots({ window = '7d', minCallCount = 200, minTimeShare = 0.1, topK = 2 } = {}) {
  const windowMs = parseWindowToMs(window)
  const cutoff = Date.now() - windowMs
  const filtered = operatorSamples.filter((sample) => Number(sample.ts || 0) >= cutoff)

  const grouped = new Map()
  for (const sample of filtered) {
    const key = String(sample.operator || 'unknown')
    if (!grouped.has(key)) {
      grouped.set(key, {
        operator: key,
        call_count: 0,
        total_time_ms: 0,
        max_time_ms: 0,
        avg_time_ms: 0
      })
    }
    const entry = grouped.get(key)
    entry.call_count += 1
    entry.total_time_ms += Number(sample.total_time_ms || 0)
    entry.max_time_ms = Math.max(entry.max_time_ms, Number(sample.total_time_ms || 0))
  }

  const rows = [...grouped.values()]
  const totalTime = rows.reduce((sum, row) => sum + row.total_time_ms, 0)

  rows.forEach((row) => {
    row.avg_time_ms = row.call_count > 0 ? row.total_time_ms / row.call_count : 0
    row.time_share = totalTime > 0 ? row.total_time_ms / totalTime : 0
  })

  const eligible = rows
    .filter((row) => row.call_count >= minCallCount && row.time_share >= minTimeShare)
    .sort((a, b) => b.total_time_ms - a.total_time_ms)

  return {
    generated_at: new Date().toISOString(),
    window,
    rule: {
      min_call_count: minCallCount,
      min_time_share: minTimeShare,
      top_k: topK
    },
    totals: {
      samples: filtered.length,
      operators: rows.length,
      total_time_ms: totalTime
    },
    hotspots: eligible.slice(0, Math.max(1, topK)),
    candidates: rows.sort((a, b) => b.total_time_ms - a.total_time_ms)
  }
}

export function collectRuntimeStats() {
  return {
    counters: [...counterStore.values()],
    gauges: [...gaugeStore.values()],
    histograms: [...histogramStore.values()],
    kpi_event_count: kpiEvents.length,
    operator_sample_count: operatorSamples.length
  }
}

export function renderPrometheusMetrics() {
  const lines = []

  for (const counter of counterStore.values()) {
    lines.push(`${counter.name}${formatPrometheusLabels(counter.labels)} ${counter.value}`)
  }

  for (const gauge of gaugeStore.values()) {
    lines.push(`${gauge.name}${formatPrometheusLabels(gauge.labels)} ${gauge.value}`)
  }

  for (const histogram of histogramStore.values()) {
    const labels = histogram.labels || {}
    let cumulative = 0
    for (let i = 0; i < histogram.buckets.length; i += 1) {
      cumulative += histogram.counts[i]
      lines.push(
        `${histogram.name}_bucket${formatPrometheusLabels({ ...labels, le: histogram.buckets[i] })} ${cumulative}`
      )
    }
    lines.push(`${histogram.name}_bucket${formatPrometheusLabels({ ...labels, le: '+Inf' })} ${histogram.count}`)
    lines.push(`${histogram.name}_sum${formatPrometheusLabels(labels)} ${histogram.sum}`)
    lines.push(`${histogram.name}_count${formatPrometheusLabels(labels)} ${histogram.count}`)
  }

  return `${lines.join('\n')}\n`
}

export default {
  incrementCounter,
  setGauge,
  observeHistogram,
  startTimer,
  recordKpiEvent,
  recordOperatorTimings,
  logStructured,
  getKpiReport,
  getOperatorHotspots,
  collectRuntimeStats,
  renderPrometheusMetrics
}
