/**
 * Jobs 性能基线脚本。
 *
 * 输出指标：
 * - sync 端到端耗时（avg / p50 / p95 / max）
 * - async 创建耗时
 * - async 完成耗时
 */
const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3200'
const POLL_INTERVAL_MS = 600
const DEFAULT_TIMEOUT_MS = parseInt(process.env.BENCH_TIMEOUT_MS || '120000', 10)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 百分位函数：用于计算 p50/p95。
 */
function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

/**
 * 创建任务并返回耗时。
 */
async function createJob(payload) {
  const started = Date.now()
  const res = await fetch(`${BASE_URL}/api/jobs/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const elapsed = Date.now() - started
  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(`create job failed (${res.status}): ${JSON.stringify(body)}`)
  }

  return { elapsed, body }
}

/**
 * 等待异步任务完成。
 */
async function waitForJob(jobId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`)
    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw new Error(`poll failed (${res.status}): ${JSON.stringify(body)}`)
    }

    if (body.status === 'completed') {
      return Date.now() - started
    }

    if (body.status === 'failed') {
      throw new Error(`job failed: ${body.error || 'unknown error'}`)
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`job ${jobId} timeout after ${timeoutMs}ms`)
}

/**
 * 打印统计结果。
 */
function printStats(label, values) {
  if (values.length === 0) {
    console.log(`[bench] ${label}: no data`)
    return
  }

  const avg = values.reduce((sum, x) => sum + x, 0) / values.length
  console.log(`[bench] ${label}: count=${values.length} avg=${avg.toFixed(1)}ms p50=${percentile(values, 50).toFixed(1)}ms p95=${percentile(values, 95).toFixed(1)}ms max=${Math.max(...values).toFixed(1)}ms`)
}

/**
 * 压测同步路径（强制 sync）。
 */
async function runSyncBench(runs) {
  const latencies = []

  for (let i = 0; i < runs; i += 1) {
    const payload = {
      messages: [{ role: 'user', content: `附近咖啡店推荐 ${i + 1}` }],
      spatialContext: {
        mode: 'Viewport',
        viewport: [114.30, 30.50, 114.35, 30.55]
      },
      options: {
        forceSync: true,
        enableFuzzyRegion: false,
        enableVernacularRegion: false
      }
    }

    const { elapsed, body } = await createJob(payload)
    if (body.mode !== 'sync') {
      throw new Error(`expected sync mode but got ${body.mode}`)
    }

    latencies.push(elapsed)
  }

  return latencies
}

/**
 * 压测异步路径（强制 async + 重计算标志）。
 */
async function runAsyncBench(runs) {
  const createLatencies = []
  const completionLatencies = []

  for (let i = 0; i < runs; i += 1) {
    const payload = {
      messages: [{ role: 'user', content: `分析该区域商业主题和热点 ${i + 1}` }],
      spatialContext: {
        mode: 'Viewport',
        viewport: [114.20, 30.40, 114.48, 30.70]
      },
      options: {
        forceAsync: true,
        enableFuzzyRegion: true,
        enableVernacularRegion: true,
        needBoundaryRefine: true,
        need_global_context: true
      }
    }

    const { elapsed, body } = await createJob(payload)
    if (body.mode !== 'async') {
      throw new Error(`expected async mode but got ${body.mode}`)
    }

    createLatencies.push(elapsed)

    const completionMs = await waitForJob(body.job_id)
    completionLatencies.push(completionMs)
  }

  return { createLatencies, completionLatencies }
}

async function main() {
  const syncRuns = parseInt(process.argv[2] || '10', 10)
  const asyncRuns = parseInt(process.argv[3] || '6', 10)

  console.log(`[bench] base URL: ${BASE_URL}`)
  console.log(`[bench] syncRuns=${syncRuns}, asyncRuns=${asyncRuns}`)

  const syncLatencies = await runSyncBench(syncRuns)
  printStats('sync end-to-end latency', syncLatencies)

  const asyncStats = await runAsyncBench(asyncRuns)
  printStats('async create latency', asyncStats.createLatencies)
  printStats('async completion latency', asyncStats.completionLatencies)

  console.log('[bench] done')
}

main().catch((err) => {
  console.error(`[bench] fail: ${err.message}`)
  process.exit(1)
})
