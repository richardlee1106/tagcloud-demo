#!/usr/bin/env node

/**
 * Node 回退演练脚本。
 *
 * 目标：
 * 1) 验证 Python 主路径可正常执行。
 * 2) 验证 forceNodeFallback=true 时可稳定回退到 Node。
 * 3) 输出结构化报告，便于发布前人工/自动巡检。
 */

import fs from 'fs'
import path from 'path'

const DEFAULT_BASE_URL = process.env.SPATIAL_CHECK_BASE_URL || 'http://127.0.0.1:3200'
const DEFAULT_OUT = 'reports/rollout/fallback-drill-latest.json'
const DEFAULT_TIMEOUT_MS = 120000

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    base: DEFAULT_BASE_URL,
    out: DEFAULT_OUT,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]

    if ((token === '--base' || token === '-b') && next) {
      args.base = String(next)
      i += 1
      continue
    }

    if ((token === '--out' || token === '-o') && next) {
      args.out = String(next)
      i += 1
      continue
    }

    if (token === '--timeout' && next) {
      args.timeoutMs = Number(next)
      i += 1
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${args.timeoutMs}`)
  }

  args.timeoutMs = Math.floor(args.timeoutMs)
  return args
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })

    const body = await response.json().catch(() => ({}))

    return {
      ok: response.ok,
      status: response.status,
      body
    }
  } finally {
    clearTimeout(timer)
  }
}

async function ensureBackendReady(baseUrl, timeoutMs) {
  const status = await requestJson(`${baseUrl}/api/ai/status`, { method: 'GET' }, timeoutMs)
  if (!status.ok) {
    throw new Error(`backend not ready: status=${status.status}`)
  }
}

function buildNarrativePayload(forceNodeFallback) {
  return {
    messages: [{ role: 'user', content: '请分析当前视野内中餐厅的空间分布和东侧热点。' }],
    spatialContext: {
      mode: 'Viewport',
      viewport: [114.2825785446, 30.5492555039, 114.3774214553, 30.6107347504]
    },
    options: {
      forceSync: true,
      queryType: 'poi_search',
      forceNodeFallback,
      enableFuzzyRegion: false,
      enableVernacularRegion: false,
      selectedCategories: []
    }
  }
}

async function fetchJobResultIfNeeded(baseUrl, responseBody, timeoutMs) {
  if (responseBody?.mode !== 'async') {
    return {
      mode: responseBody?.mode || 'sync',
      jobId: responseBody?.job_id || null,
      result: responseBody?.result || null,
      status: responseBody?.status || null
    }
  }

  const jobId = responseBody?.job_id
  if (!jobId) {
    throw new Error('async response missing job_id')
  }

  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const snapshot = await requestJson(`${baseUrl}/api/jobs/${jobId}`, { method: 'GET' }, timeoutMs)

    if (!snapshot.ok) {
      throw new Error(`query job snapshot failed: ${snapshot.status}`)
    }

    if (snapshot.body?.status === 'completed') {
      const result = await requestJson(`${baseUrl}/api/jobs/${jobId}/result`, { method: 'GET' }, timeoutMs)
      if (!result.ok) {
        throw new Error(`query job result failed: ${result.status}`)
      }
      return {
        mode: 'async',
        jobId,
        result: result.body?.result || null,
        status: 'completed'
      }
    }

    if (snapshot.body?.status === 'failed') {
      throw new Error(`job failed: ${snapshot.body?.error || 'unknown error'}`)
    }

    await sleep(1000)
  }

  throw new Error(`job timeout after ${timeoutMs}ms`)
}

function buildRunSummary(label, httpResult, resolvedResult, elapsedMs) {
  const resultPayload = resolvedResult?.result || null
  const diagnostics = resultPayload?.diagnostics || {}
  const coreResults = resultPayload?.results || {}

  const computeMode = diagnostics.compute_mode || null
  const executorEngine = coreResults?.stats?.executor_engine || null
  const poiCount = Array.isArray(coreResults?.pois) ? coreResults.pois.length : 0

  const alerts = []

  if (!httpResult.ok) {
    alerts.push(`http_${httpResult.status}`)
  }

  if (!resultPayload) {
    alerts.push('missing_result_payload')
  }

  if (!computeMode) {
    alerts.push('missing_compute_mode')
  }

  if (label === 'python_primary') {
    if (!String(computeMode || '').toLowerCase().includes('python')) {
      alerts.push(`unexpected_compute_mode:${computeMode}`)
    }
  }

  if (label === 'node_fallback') {
    if (!String(computeMode || '').toLowerCase().includes('node')) {
      alerts.push(`fallback_not_effective:${computeMode}`)
    }
  }

  return {
    label,
    pass: alerts.length === 0,
    alerts,
    elapsed_ms: elapsedMs,
    http_status: httpResult.status,
    mode: resolvedResult?.mode || null,
    job_id: resolvedResult?.jobId || null,
    status: resolvedResult?.status || null,
    compute_mode: computeMode,
    executor_engine: executorEngine,
    poi_count: poiCount
  }
}

function buildMarkdownReport(report) {
  const lines = []
  lines.push('# Node 回退演练报告')
  lines.push('')
  lines.push(`- 检查时间: ${report.checked_at}`)
  lines.push(`- 服务地址: ${report.base_url}`)
  lines.push(`- 总体结论: ${report.summary.all_passed ? '通过' : '失败'}`)
  lines.push('')
  lines.push('## 运行明细')
  lines.push('')

  for (const item of report.runs) {
    lines.push(`### ${item.label}`)
    lines.push(`- 通过: ${item.pass ? '是' : '否'}`)
    lines.push(`- compute_mode: ${item.compute_mode || '-'}`)
    lines.push(`- executor_engine: ${item.executor_engine || '-'}`)
    lines.push(`- POI 数量: ${item.poi_count}`)
    lines.push(`- 用时: ${item.elapsed_ms}ms`)
    lines.push(`- 告警: ${item.alerts.length ? item.alerts.join(', ') : '无'}`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

async function runOneCase(baseUrl, label, forceNodeFallback, timeoutMs) {
  const payload = buildNarrativePayload(forceNodeFallback)
  const started = Date.now()
  const response = await requestJson(
    `${baseUrl}/api/jobs/narrative`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    timeoutMs
  )

  const resolved = await fetchJobResultIfNeeded(baseUrl, response.body, timeoutMs)
  const elapsedMs = Date.now() - started

  return buildRunSummary(label, response, resolved, elapsedMs)
}

async function main() {
  const args = parseArgs()
  await ensureBackendReady(args.base, args.timeoutMs)

  const runs = []

  runs.push(await runOneCase(args.base, 'python_primary', false, args.timeoutMs))
  await sleep(100)
  runs.push(await runOneCase(args.base, 'node_fallback', true, args.timeoutMs))

  const summary = {
    total: runs.length,
    passed: runs.filter((item) => item.pass).length,
    failed: runs.filter((item) => !item.pass).length
  }
  summary.all_passed = summary.failed === 0

  const report = {
    checked_at: new Date().toISOString(),
    base_url: args.base,
    summary,
    runs
  }

  const outPath = path.resolve(process.cwd(), args.out)
  const mdPath = outPath.replace(/\.json$/i, '.md')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  fs.writeFileSync(mdPath, buildMarkdownReport(report), 'utf-8')

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (!summary.all_passed) {
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(`[drill_node_fallback] ${error.message}`)
  process.exitCode = 1
})
