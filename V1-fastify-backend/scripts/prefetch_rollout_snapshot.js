import fs from 'fs/promises'
import path from 'path'

function parseArgs(argv = []) {
  const parsed = {}
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return
    const [key, value] = arg.slice(2).split('=')
    parsed[key] = value === undefined ? true : value
  })
  return parsed
}

function normalizeUrl(baseUrl = '') {
  return String(baseUrl || process.env.OPS_BASE_URL || 'http://127.0.0.1:3200/api/ops').replace(/\/$/, '')
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return 'N/A'
  return `${(Number(value) * 100).toFixed(2)}%`
}

function formatLatency(value) {
  if (!Number.isFinite(Number(value))) return 'N/A'
  const numeric = Math.round(Number(value))
  return `${numeric >= 0 ? '+' : ''}${numeric}ms`
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const window = String(args.window || '1h')
  const baseUrl = normalizeUrl(args.base_url)

  const response = await fetch(`${baseUrl}/kpi-report?window=${encodeURIComponent(window)}`)
  if (!response.ok) {
    throw new Error(`GET /kpi-report failed: ${response.status} ${response.statusText}`)
  }

  const report = await response.json()
  const current = report?.periods?.current?.metrics || {}
  const prefetchGate = report?.gate?.prefetch_quality || {}
  const byQueryType = current?.prefetch_wasted_rate_by_query_type || {}

  const snapshot = {
    generated_at: new Date().toISOString(),
    window,
    prefetch_degraded_total: Number(current.prefetch_degraded_total || 0),
    prefetch_wasted_total: Number(current.prefetch_wasted_total || 0),
    prefetch_wasted_rate: Number(current.prefetch_wasted_rate || 0),
    prefetch_overlap_delta_ms_p50: Number(current.prefetch_overlap_delta_ms_p50 || 0),
    prefetch_overlap_delta_ms_p95: Number(current.prefetch_overlap_delta_ms_p95 || 0),
    prefetch_quality_gate: {
      threshold: Number(prefetchGate.threshold || 0.05),
      current: Number(prefetchGate.current || 0),
      pass: prefetchGate.pass === true,
      flagged_query_types: Array.isArray(prefetchGate.flagged_query_types)
        ? prefetchGate.flagged_query_types
        : []
    },
    prefetch_wasted_rate_by_query_type: byQueryType
  }

  const lines = [
    '# Prefetch Rollout Snapshot',
    '',
    `- generated_at: ${snapshot.generated_at}`,
    `- window: ${window}`,
    `- prefetch_degraded_total: ${snapshot.prefetch_degraded_total}`,
    `- prefetch_wasted_total: ${snapshot.prefetch_wasted_total}`,
    `- prefetch_wasted_rate: ${formatPercent(snapshot.prefetch_wasted_rate)}`,
    `- overlap_delta_p50: ${formatLatency(snapshot.prefetch_overlap_delta_ms_p50)}`,
    `- overlap_delta_p95: ${formatLatency(snapshot.prefetch_overlap_delta_ms_p95)}`,
    `- gate_pass: ${snapshot.prefetch_quality_gate.pass ? 'PASS' : 'FAIL'}`,
    ''
  ]

  lines.push('## Wasted Rate By Query Type')
  lines.push('')
  const entries = Object.entries(snapshot.prefetch_wasted_rate_by_query_type)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
  if (entries.length === 0) {
    lines.push('- none')
  } else {
    entries.forEach(([queryType, rate]) => {
      lines.push(`- ${queryType}: ${formatPercent(rate)}`)
    })
  }
  lines.push('')

  const outputDir = path.resolve('reports', 'prefetch-e2e')
  await ensureDir(outputDir)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(outputDir, `prefetch-rollout-snapshot-${timestamp}.json`)
  const mdPath = path.join(outputDir, `prefetch-rollout-snapshot-${timestamp}.md`)

  await fs.writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await fs.writeFile(mdPath, `${lines.join('\n')}\n`, 'utf8')

  console.log(`[prefetch_snapshot] json: ${jsonPath}`)
  console.log(`[prefetch_snapshot] markdown: ${mdPath}`)
}

main().catch((error) => {
  console.error('[prefetch_snapshot] failed:', error)
  process.exit(1)
})
