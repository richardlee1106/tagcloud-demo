import {
  getQueueHealthSnapshot
} from '../../services/queue.js'
import * as queryCache from '../../services/queryCache.js'
import telemetry from '../../services/telemetry.js'
import { listOpsAuditEvents } from '../../services/opsAuditStore.js'
import { getOperatorTimingRows } from '../../services/database.js'

function parseWindow(rawWindow) {
  const raw = String(rawWindow || '7d').trim().toLowerCase()
  if (/^\d+[dhm]$/.test(raw)) return raw
  return '7d'
}

function windowToMs(window = '7d') {
  const match = String(window || '7d').trim().toLowerCase().match(/^(\d+)([dhm])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000
  const count = Number.parseInt(match[1], 10)
  if (!Number.isFinite(count) || count <= 0) return 7 * 24 * 60 * 60 * 1000
  const unit = match[2]
  if (unit === 'm') return count * 60 * 1000
  if (unit === 'h') return count * 60 * 60 * 1000
  return count * 24 * 60 * 60 * 1000
}

function aggregateOperatorRows(rows = [], { window = '7d', minCallCount = 200, minTimeShare = 0.1, topK = 2 } = {}) {
  const grouped = new Map()

  rows.forEach((row) => {
    const operator = String(row.operator_name || row.operator || 'unknown')
    const totalMs = Number(row.total_time_ms || 0)
    if (!Number.isFinite(totalMs) || totalMs < 0) return

    if (!grouped.has(operator)) {
      grouped.set(operator, {
        operator,
        call_count: 0,
        total_time_ms: 0,
        max_time_ms: 0,
        avg_time_ms: 0,
        time_share: 0
      })
    }

    const item = grouped.get(operator)
    item.call_count += 1
    item.total_time_ms += totalMs
    item.max_time_ms = Math.max(item.max_time_ms, totalMs)
  })

  const candidates = [...grouped.values()]
  const totalTime = candidates.reduce((sum, item) => sum + item.total_time_ms, 0)

  candidates.forEach((item) => {
    item.avg_time_ms = item.call_count > 0 ? item.total_time_ms / item.call_count : 0
    item.time_share = totalTime > 0 ? item.total_time_ms / totalTime : 0
  })

  const hotspots = candidates
    .filter((item) => item.call_count >= minCallCount && item.time_share >= minTimeShare)
    .sort((a, b) => b.total_time_ms - a.total_time_ms)
    .slice(0, Math.max(1, topK))

  return {
    generated_at: new Date().toISOString(),
    window,
    source: 'database',
    rule: {
      min_call_count: minCallCount,
      min_time_share: minTimeShare,
      top_k: topK
    },
    totals: {
      samples: rows.length,
      operators: candidates.length,
      total_time_ms: totalTime
    },
    hotspots,
    candidates: candidates.sort((a, b) => b.total_time_ms - a.total_time_ms)
  }
}

async function opsRoutes(fastify) {
  fastify.get('/metrics', async (request, reply) => {
    const queueHealth = await getQueueHealthSnapshot()
    const cacheStats = queryCache.getCacheStats()

    telemetry.setGauge('queue_backlog', queueHealth.metrics?.backlog || 0, {
      mode: queueHealth.mode || 'unknown'
    })
    telemetry.setGauge('queue_failed', queueHealth.metrics?.failed || 0, {
      mode: queueHealth.mode || 'unknown'
    })

    const l1Hits = Number(cacheStats.l1?.hits || 0)
    const l1Misses = Number(cacheStats.l1?.misses || 0)
    const l2Hits = Number(cacheStats.l2?.hits || 0)
    const l2Misses = Number(cacheStats.l2?.misses || 0)

    telemetry.setGauge('query_cache_entries', Number(cacheStats.size || 0), { level: 'l1' })
    telemetry.setGauge('query_cache_hits', l1Hits, { level: 'l1' })
    telemetry.setGauge('query_cache_misses', l1Misses, { level: 'l1' })
    telemetry.setGauge('query_cache_hits', l2Hits, { level: 'l2' })
    telemetry.setGauge('query_cache_misses', l2Misses, { level: 'l2' })

    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    return telemetry.renderPrometheusMetrics()
  })

  fastify.get('/kpi-report', async (request) => {
    const window = parseWindow(request.query?.window)
    const report = telemetry.getKpiReport({ window })
    const queueHealth = await getQueueHealthSnapshot()
    const cacheStats = queryCache.getCacheStats()

    return {
      ...report,
      runtime: {
        queue: {
          mode: queueHealth.mode,
          backlog: queueHealth.metrics?.backlog || 0,
          failed: queueHealth.metrics?.failed || 0
        },
        cache: cacheStats
      }
    }
  })

  fastify.get('/audit', async (request) => {
    const limit = Number.parseInt(request.query?.limit || '100', 10)
    const type = String(request.query?.type || '').trim()
    const traceId = String(request.query?.trace_id || request.query?.traceId || '').trim()
    const queryType = String(request.query?.query_type || '').trim()

    const events = listOpsAuditEvents({
      limit,
      type,
      traceId,
      queryType
    })

    return {
      generated_at: new Date().toISOString(),
      total: events.length,
      filters: {
        limit: Number.isFinite(limit) ? limit : 100,
        type: type || null,
        trace_id: traceId || null,
        query_type: queryType || null
      },
      events
    }
  })

  fastify.get('/complexity-calibration', async (request) => {
    const window = parseWindow(request.query?.window || '14d')
    return telemetry.getComplexityCalibrationReport({ window })
  })

  fastify.get('/operator-hotspots', async (request) => {
    const window = parseWindow(request.query?.window)
    const minCallCount = Number.parseInt(request.query?.min_call_count || '200', 10)
    const minTimeShare = Number.parseFloat(request.query?.min_time_share || '0.1')
    const topK = Number.parseInt(request.query?.top_k || '2', 10)

    const normalizedMinCallCount = Number.isFinite(minCallCount) ? minCallCount : 200
    const normalizedMinTimeShare = Number.isFinite(minTimeShare) ? minTimeShare : 0.1
    const normalizedTopK = Number.isFinite(topK) ? topK : 2

    const toTs = Date.now()
    const fromTs = toTs - windowToMs(window)
    const dbRows = await getOperatorTimingRows({ fromTs, toTs })

    if (dbRows.length > 0) {
      return aggregateOperatorRows(dbRows, {
        window,
        minCallCount: normalizedMinCallCount,
        minTimeShare: normalizedMinTimeShare,
        topK: normalizedTopK
      })
    }

    return {
      ...telemetry.getOperatorHotspots({
        window,
        minCallCount: normalizedMinCallCount,
        minTimeShare: normalizedMinTimeShare,
        topK: normalizedTopK
      }),
      source: 'memory'
    }
  })
}

export default opsRoutes
