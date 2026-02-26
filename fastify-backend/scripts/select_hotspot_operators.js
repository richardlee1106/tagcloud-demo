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

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'N/A'
  return `${(value * 100).toFixed(2)}%`
}

function formatMs(value) {
  if (!Number.isFinite(value)) return 'N/A'
  return `${Math.round(value)} ms`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const window = typeof args.window === 'string' ? args.window : '7d'
  const minCallCount = Number.parseInt(args.min_call_count || '200', 10)
  const minTimeShare = Number.parseFloat(args.min_time_share || '0.1')
  const topK = Number.parseInt(args.top_k || '2', 10)

  const baseUrl = process.env.OPS_BASE_URL || 'http://127.0.0.1:3200/api/ops'
  const url = `${baseUrl.replace(/\/$/, '')}/operator-hotspots?window=${encodeURIComponent(window)}&min_call_count=${minCallCount}&min_time_share=${minTimeShare}&top_k=${topK}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`operator-hotspots request failed: ${response.status}`)
  }

  const payload = await response.json()
  const reportDir = path.resolve('reports', 'operator-hotspots')
  await fs.mkdir(reportDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(reportDir, `hotspots-${stamp}.json`)
  const mdPath = path.join(reportDir, `hotspots-${stamp}.md`)

  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const hotspots = Array.isArray(payload.hotspots) ? payload.hotspots : []

  const markdownLines = [
    '# 热点算子识别结果',
    '',
    `- 生成时间: ${payload.generated_at || new Date().toISOString()}`,
    `- 窗口: ${payload.window || window}`,
    `- 规则: call_count >= ${payload.rule?.min_call_count ?? minCallCount}, time_share >= ${formatPercent(payload.rule?.min_time_share ?? minTimeShare)}, Top ${payload.rule?.top_k ?? topK}`,
    '',
    '## Top2 热点算子',
    ''
  ]

  if (hotspots.length === 0) {
    markdownLines.push('- 当前窗口无满足门槛的热点算子。')
  } else {
    hotspots.forEach((row, index) => {
      markdownLines.push(`${index + 1}. ${row.operator}`)
      markdownLines.push(`- call_count: ${row.call_count}`)
      markdownLines.push(`- total_time_ms: ${formatMs(row.total_time_ms)}`)
      markdownLines.push(`- avg_time_ms: ${formatMs(row.avg_time_ms)}`)
      markdownLines.push(`- time_share: ${formatPercent(row.time_share)}`)
      markdownLines.push('')
    })
  }

  await fs.writeFile(mdPath, `${markdownLines.join('\n')}\n`, 'utf8')

  console.log(`[select_hotspot_operators] JSON saved: ${jsonPath}`)
  console.log(`[select_hotspot_operators] Markdown saved: ${mdPath}`)
}

main().catch((error) => {
  console.error('[select_hotspot_operators] failed:', error)
  process.exit(1)
})
