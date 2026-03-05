/**
 * Jobs 链路冒烟脚本。
 *
 * 验证内容：
 * 1) 任务创建成功（sync/async 都支持）。
 * 2) 异步任务可被轮询到 completed。
 * 3) 结果结构包含基础空间返回字段。
 */
const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3200'
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT_MS || '90000', 10)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 创建 narrative 任务并记录创建耗时。
 */
async function postNarrativeJob(payload) {
  const started = Date.now()
  const res = await fetch(`${BASE_URL}/api/jobs/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const elapsed = Date.now() - started
  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(`POST /api/jobs/narrative failed (${res.status}): ${JSON.stringify(body)}`)
  }

  return { elapsed, body }
}

/**
 * 异步模式下轮询任务直到 completed/failed/timeout。
 */
async function waitForCompletion(jobId) {
  const started = Date.now()

  while (Date.now() - started < TIMEOUT_MS) {
    const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`)
    const status = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw new Error(`GET /api/jobs/${jobId} failed (${res.status}): ${JSON.stringify(status)}`)
    }

    if (status.status === 'completed') {
      return { status, elapsed: Date.now() - started }
    }

    if (status.status === 'failed') {
      throw new Error(`job ${jobId} failed: ${status.error || 'unknown error'}`)
    }

    await sleep(1000)
  }

  throw new Error(`job ${jobId} did not complete within ${TIMEOUT_MS}ms`)
}

/**
 * 拉取 completed 任务结果。
 */
async function fetchJobResult(jobId) {
  const res = await fetch(`${BASE_URL}/api/jobs/${jobId}/result`)
  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(`GET /api/jobs/${jobId}/result failed (${res.status}): ${JSON.stringify(body)}`)
  }

  return body
}

async function main() {
  const query = process.argv[2] || '视野内东侧咖啡店'
  const payload = {
    messages: [{ role: 'user', content: query }],
    spatialContext: {
      mode: 'Viewport',
      viewport: [114.30, 30.50, 114.42, 30.62]
    },
    options: {
      enableFuzzyRegion: false,
      enableVernacularRegion: false
    }
  }

  console.log(`[smoke] base URL: ${BASE_URL}`)
  console.log(`[smoke] query: ${query}`)

  const { elapsed: createMs, body: createBody } = await postNarrativeJob(payload)
  const jobId = createBody.job_id
  const mode = createBody.mode

  if (!jobId) {
    throw new Error(`missing job_id in response: ${JSON.stringify(createBody)}`)
  }

  console.log(`[smoke] created job ${jobId}, mode=${mode}, create=${createMs}ms`)

  let result = createBody.result || null

  if (mode === 'async') {
    const completion = await waitForCompletion(jobId)
    console.log(`[smoke] async completed in ${completion.elapsed}ms, stage=${completion.status.stage}`)
    const resultBody = await fetchJobResult(jobId)
    result = resultBody.result
  }

  if (!result) {
    throw new Error('missing result payload')
  }

  const poiCount = Array.isArray(result?.results?.pois) ? result.results.pois.length : 0
  const regionCount = Array.isArray(result?.results?.vernacular_regions)
    ? result.results.vernacular_regions.length
    : 0

  console.log(`[smoke] success: pois=${poiCount}, regions=${regionCount}`)
  console.log('[smoke] pass')
}

main().catch((err) => {
  console.error(`[smoke] fail: ${err.message}`)
  process.exit(1)
})
