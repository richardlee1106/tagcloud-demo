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

function formatLatency(value) {
  if (!Number.isFinite(value)) return 'N/A'
  return `${Math.round(value)} ms`
}

function boolMark(value) {
  return value ? 'PASS' : 'FAIL'
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const window = typeof args.window === 'string' ? args.window : '7d'
  const baseUrl = process.env.OPS_BASE_URL || 'http://127.0.0.1:3200/api/ops'

  const url = `${baseUrl.replace(/\/$/, '')}/kpi-report?window=${encodeURIComponent(window)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`KPI API request failed: ${response.status} ${response.statusText}`)
  }

  const report = await response.json()

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = path.resolve('reports', 'kpi')
  await ensureDir(reportDir)

  const jsonPath = path.join(reportDir, `kpi-${timestamp}.json`)
  const mdPath = path.join(reportDir, `kpi-${timestamp}.md`)

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const currentMetrics = report?.periods?.current?.metrics || {}
  const baselineMetrics = report?.periods?.baseline?.metrics || {}
  const m1 = report?.gate?.m1 || {}
  const stability = report?.gate?.stability || {}

  const markdown = [
    '# KPI 门禁评估结果',
    '',
    `- 生成时间: ${report.generated_at || new Date().toISOString()}`,
    `- 窗口: ${window}`,
    `- M1 判定: ${boolMark(Boolean(m1.pass))}`,
    `- 稳定期判定: ${boolMark(Boolean(stability.pass))}`,
    `- 路线B准入: ${boolMark(Boolean(report?.gate?.route_b_ready))}`,
    '',
    '## 当前窗口指标',
    '',
    `- P95 first_token_latency_ms: ${formatLatency(currentMetrics.first_token_latency_ms_p95)}`,
    `- P95 end_to_end_latency_ms: ${formatLatency(currentMetrics.end_to_end_latency_ms_p95)}`,
    `- template_action_ctr: ${formatPercent(currentMetrics.template_action_ctr)}`,
    `- sse_schema_error_rate: ${formatPercent(currentMetrics.sse_schema_error_rate)}`,
    `- sse_event_error_rate: ${formatPercent(currentMetrics.sse_event_error_rate)}`,
    `- cache_l2_error_rate: ${formatPercent(currentMetrics.cache_l2_error_rate)}`,
    `- sev1/sev2 incidents: ${currentMetrics.sev1_sev2_incidents ?? 'N/A'}`,
    '',
    '## 基线窗口指标',
    '',
    `- P95 first_token_latency_ms: ${formatLatency(baselineMetrics.first_token_latency_ms_p95)}`,
    `- template_action_ctr: ${formatPercent(baselineMetrics.template_action_ctr)}`,
    `- sse_schema_error_rate: ${formatPercent(baselineMetrics.sse_schema_error_rate)}`,
    '',
    '## M1 明细',
    '',
    `- first_token_latency_ms (>=25%): ${boolMark(Boolean(m1.metrics?.first_token_latency_ms?.pass))} (actual=${formatPercent(m1.metrics?.first_token_latency_ms?.actual)})`,
    `- template_action_ctr (>=15%): ${boolMark(Boolean(m1.metrics?.template_action_ctr?.pass))} (actual=${formatPercent(m1.metrics?.template_action_ctr?.actual)})`,
    `- sse_schema_error_rate (>=40%): ${boolMark(Boolean(m1.metrics?.sse_schema_error_rate?.pass))} (actual=${formatPercent(m1.metrics?.sse_schema_error_rate?.actual)})`,
    '',
    '## 稳定期明细',
    '',
    `- qualified_days: ${stability.qualified_days ?? 'N/A'} / ${stability.required_days ?? 'N/A'}`,
    `- sse_event_error_rate < 0.5%: ${boolMark(Boolean(stability.sse_event_error_rate?.pass))}`,
    `- cache_l2_error_rate < 1%: ${boolMark(Boolean(stability.cache_l2_error_rate?.pass))}`,
    `- 无 Sev1/Sev2: ${boolMark(Boolean(stability.sev1_sev2_incidents?.pass))}`,
    ''
  ].join('\n')

  await fs.writeFile(mdPath, markdown, 'utf8')

  console.log(`[kpi_report] JSON saved: ${jsonPath}`)
  console.log(`[kpi_report] Markdown saved: ${mdPath}`)
  console.log(`[kpi_report] M1=${boolMark(Boolean(m1.pass))}, Stability=${boolMark(Boolean(stability.pass))}, RouteB=${boolMark(Boolean(report?.gate?.route_b_ready))}`)
}

main().catch((error) => {
  console.error('[kpi_report] failed:', error)
  process.exit(1)
})
