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

function formatPercent(value, fallback = 'N/A') {
  if (!Number.isFinite(value)) return fallback
  return `${(value * 100).toFixed(2)}%`
}

function formatLatency(value, fallback = 'N/A') {
  if (!Number.isFinite(value)) return fallback
  return `${Math.round(value)} ms`
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const window = typeof args.window === 'string' ? args.window : '14d'
  const baseUrl = process.env.OPS_BASE_URL || 'http://127.0.0.1:3200/api/ops'
  const url = `${baseUrl.replace(/\/$/, '')}/complexity-calibration?window=${encodeURIComponent(window)}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Complexity calibration API request failed: ${response.status} ${response.statusText}`)
  }

  const report = await response.json()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputDir = path.resolve('reports', 'routing')
  await ensureDir(outputDir)

  const jsonPath = path.join(outputDir, `complexity-recalibrate-${timestamp}.json`)
  const mdPath = path.join(outputDir, `complexity-recalibrate-${timestamp}.md`)

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const rows = Array.isArray(report?.by_query_type) ? report.by_query_type : []
  const changedRows = rows.filter((item) => Number(item?.delta || 0) !== 0)
  const markdownRows = (changedRows.length > 0 ? changedRows : rows)
    .slice(0, 20)
    .map((item) => {
      const metrics = item?.metrics || {}
      const reasons = Array.isArray(item?.reasons) && item.reasons.length > 0
        ? item.reasons.join(', ')
        : '-'
      return [
        item?.query_type || 'unknown',
        item?.recommendation || 'keep',
        `${item?.current_complexity_score ?? 'N/A'}`,
        `${item?.suggested_complexity_score ?? 'N/A'}`,
        formatLatency(metrics?.p95_latency_ms),
        formatPercent(metrics?.failure_rate),
        formatPercent(metrics?.critic_hit_rate),
        reasons
      ].join(' | ')
    })

  const markdown = [
    '# Complexity Recalibration Report',
    '',
    `- generated_at: ${report?.generated_at || new Date().toISOString()}`,
    `- window: ${window}`,
    `- query_types: ${report?.summary?.query_types ?? 0}`,
    `- adjusted_query_types: ${report?.summary?.adjusted_query_types ?? 0}`,
    '',
    '| query_type | recommendation | current | suggested | p95_latency | failure_rate | critic_hit_rate | reasons |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...(markdownRows.length > 0 ? markdownRows : ['| - | - | - | - | - | - | - | - |']),
    ''
  ].join('\n')

  await fs.writeFile(mdPath, markdown, 'utf8')

  console.log(`[recalibrate_complexity] JSON saved: ${jsonPath}`)
  console.log(`[recalibrate_complexity] Markdown saved: ${mdPath}`)
  console.log(`[recalibrate_complexity] adjusted query types: ${report?.summary?.adjusted_query_types ?? 0}`)
}

main().catch((error) => {
  console.error('[recalibrate_complexity] failed:', error)
  process.exit(1)
})
