import fs from 'fs/promises'
import path from 'path'

const DEFAULT_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3200'
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.PREFETCH_PROBE_TIMEOUT_MS || '120000', 10)
const DEFAULT_POLL_MS = Number.parseInt(process.env.PREFETCH_PROBE_POLL_MS || '1200', 10)
const DEFAULT_WINDOW = process.env.PREFETCH_PROBE_WINDOW || '1h'

const DEFAULT_CASES = Object.freeze([
  {
    name: 'macro_hotspot',
    query: '请分析当前视野内的商业热点与业态分布'
  },
  {
    name: 'poi_search',
    query: '请找出当前区域评分较高的咖啡店'
  },
  {
    name: 'comparison',
    query: '对比这几个片区的餐饮与便利店分布差异'
  }
])

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
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed (${response.status}): ${JSON.stringify(payload)}`)
  }
  return payload
}

function buildSpatialContext() {
  return {
    mode: 'Viewport',
    viewport: [114.30, 30.50, 114.42, 30.62]
  }
}

function buildProbePayload(query = '') {
  return {
    messages: [{ role: 'user', content: String(query || '').trim() }],
    spatialContext: buildSpatialContext(),
    options: {
      enableFuzzyRegion: false,
      enableVernacularRegion: false
    }
  }
}

async function postNarrativeJob(baseUrl, payload) {
  return fetchJson(`${baseUrl}/api/jobs/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

async function waitForCompletion(baseUrl, jobId, { timeoutMs, pollMs }) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await fetchJson(`${baseUrl}/api/jobs/${jobId}`)
    if (snapshot.status === 'completed') {
      return {
        status: snapshot,
        elapsedMs: Date.now() - startedAt
      }
    }
    if (snapshot.status === 'failed') {
      throw new Error(`job ${jobId} failed: ${snapshot.error || 'unknown_error'}`)
    }
    await sleep(pollMs)
  }
  throw new Error(`job ${jobId} did not complete within ${timeoutMs}ms`)
}

async function fetchJobResult(baseUrl, jobId) {
  const payload = await fetchJson(`${baseUrl}/api/jobs/${jobId}/result`)
  return payload.result || null
}

function pickPrefetchSummary(result = {}) {
  const diagnosticsPrefetch = result?.diagnostics?.prefetch
  if (diagnosticsPrefetch && typeof diagnosticsPrefetch === 'object') {
    return diagnosticsPrefetch
  }

  const stats = result?.results?.stats && typeof result.results.stats === 'object'
    ? result.results.stats
    : {}

  return {
    prefetch_attempted: stats.prefetch_attempted === true,
    prefetch_hit: stats.prefetch_hit === true,
    prefetch_degraded: stats.prefetch_degraded === true,
    prefetch_wasted: stats.prefetch_wasted === true,
    prefetch_overlap_delta_ms: Number.isFinite(Number(stats.prefetch_overlap_delta_ms))
      ? Number(stats.prefetch_overlap_delta_ms)
      : 0,
    prefetch_error_codes: Array.isArray(stats.prefetch_error_codes) ? stats.prefetch_error_codes : []
  }
}

async function loadCases(args = {}) {
  if (typeof args.cases_file === 'string' && args.cases_file.trim()) {
    const filePath = path.resolve(args.cases_file.trim())
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
    if (!Array.isArray(parsed)) {
      throw new Error(`cases file must be an array: ${filePath}`)
    }
    return parsed
  }
  return [...DEFAULT_CASES]
}

function buildMarkdown(report = {}) {
  const lines = [
    '# Prefetch Rollout Probe',
    '',
    `- generated_at: ${report.generated_at}`,
    `- base_url: ${report.base_url}`,
    `- total_cases: ${report.cases.length}`,
    ''
  ]

  lines.push('## Cases')
  lines.push('')
  lines.push('| case | mode | query_type | policy_source | attempted | hit | degraded | wasted | overlap_ms |')
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|')

  report.cases.forEach((item) => {
    lines.push(
      `| ${item.name} | ${item.mode} | ${item.query_type} | ${item.prefetch_policy_source} | ${item.prefetch_attempted ? 1 : 0} | ${item.prefetch_hit ? 1 : 0} | ${item.prefetch_degraded ? 1 : 0} | ${item.prefetch_wasted ? 1 : 0} | ${item.prefetch_overlap_delta_ms} |`
    )
  })

  lines.push('')
  lines.push('## KPI Delta')
  lines.push('')
  lines.push(`- prefetch_attempts_delta: ${report.kpi_delta.prefetch_attempts_delta}`)
  lines.push(`- prefetch_hits_delta: ${report.kpi_delta.prefetch_hits_delta}`)
  lines.push(`- prefetch_degraded_delta: ${report.kpi_delta.prefetch_degraded_delta}`)
  lines.push(`- prefetch_wasted_delta: ${report.kpi_delta.prefetch_wasted_delta}`)
  lines.push('')
  return lines.join('\n')
}

function summarizeKpi(report = {}) {
  const current = report?.periods?.current?.metrics || {}
  const overview = report?.overview || {}
  return {
    prefetch_attempts: Number(overview.prefetch_attempts || 0),
    prefetch_hits: Number(overview.prefetch_hits || 0),
    prefetch_degraded: Number(current.prefetch_degraded_total || 0),
    prefetch_wasted: Number(current.prefetch_wasted_total || 0)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = normalizeUrl(args.base_url || DEFAULT_BASE_URL)
  const timeoutMs = toInt(args.timeout_ms, DEFAULT_TIMEOUT_MS)
  const pollMs = toInt(args.poll_ms, DEFAULT_POLL_MS)
  const window = String(args.window || DEFAULT_WINDOW)
  const cases = await loadCases(args)

  const beforeKpi = await fetchJson(`${baseUrl}/api/ops/kpi-report?window=${encodeURIComponent(window)}`)
  const beforeSummary = summarizeKpi(beforeKpi)

  const caseResults = []
  for (const item of cases) {
    const caseName = String(item?.name || `case_${caseResults.length + 1}`)
    const query = String(item?.query || '').trim()
    if (!query) continue

    const startedAt = Date.now()
    const created = await postNarrativeJob(baseUrl, buildProbePayload(query))
    const jobId = String(created.job_id || '')
    const mode = String(created.mode || 'unknown')
    if (!jobId) {
      throw new Error(`missing job_id for case ${caseName}`)
    }

    let result = created.result || null
    if (mode === 'async') {
      await waitForCompletion(baseUrl, jobId, { timeoutMs, pollMs })
      result = await fetchJobResult(baseUrl, jobId)
    }

    const prefetchSummary = pickPrefetchSummary(result || {})
    const queryType = String(
      result?.query_plan?.query_type
      || result?.results?.stats?.query_type
      || 'unknown'
    )

    caseResults.push({
      name: caseName,
      query,
      mode,
      job_id: jobId,
      elapsed_ms: Date.now() - startedAt,
      query_type: queryType,
      prefetch_policy_source: String(prefetchSummary?.prefetch_policy_source || 'unknown'),
      prefetch_enabled: prefetchSummary?.prefetch_enabled === true,
      allow_prefetch: prefetchSummary?.allow_prefetch === true,
      prefetch_on_fields: Array.isArray(prefetchSummary?.prefetch_on_fields) ? prefetchSummary.prefetch_on_fields : [],
      prefetch_attempted: prefetchSummary?.prefetch_attempted === true,
      prefetch_hit: prefetchSummary?.prefetch_hit === true,
      prefetch_degraded: prefetchSummary?.prefetch_degraded === true,
      prefetch_wasted: prefetchSummary?.prefetch_wasted === true,
      prefetch_overlap_delta_ms: Number.isFinite(Number(prefetchSummary?.prefetch_overlap_delta_ms))
        ? Number(prefetchSummary.prefetch_overlap_delta_ms)
        : 0,
      prefetch_error_codes: Array.isArray(prefetchSummary?.prefetch_error_codes)
        ? prefetchSummary.prefetch_error_codes
        : []
    })
  }

  const afterKpi = await fetchJson(`${baseUrl}/api/ops/kpi-report?window=${encodeURIComponent(window)}`)
  const afterSummary = summarizeKpi(afterKpi)

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    window,
    timeout_ms: timeoutMs,
    poll_ms: pollMs,
    cases: caseResults,
    kpi_before: beforeSummary,
    kpi_after: afterSummary,
    kpi_delta: {
      prefetch_attempts_delta: afterSummary.prefetch_attempts - beforeSummary.prefetch_attempts,
      prefetch_hits_delta: afterSummary.prefetch_hits - beforeSummary.prefetch_hits,
      prefetch_degraded_delta: afterSummary.prefetch_degraded - beforeSummary.prefetch_degraded,
      prefetch_wasted_delta: afterSummary.prefetch_wasted - beforeSummary.prefetch_wasted
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputDir = path.resolve('reports', 'prefetch-e2e')
  await ensureDir(outputDir)
  const jsonPath = path.join(outputDir, `prefetch-rollout-probe-${timestamp}.json`)
  const mdPath = path.join(outputDir, `prefetch-rollout-probe-${timestamp}.md`)

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(mdPath, `${buildMarkdown(report)}\n`, 'utf8')

  console.log(`[prefetch_probe] cases=${caseResults.length}`)
  console.log(`[prefetch_probe] report json: ${jsonPath}`)
  console.log(`[prefetch_probe] report markdown: ${mdPath}`)
}

main().catch((error) => {
  console.error('[prefetch_probe] failed:', error)
  process.exit(1)
})
