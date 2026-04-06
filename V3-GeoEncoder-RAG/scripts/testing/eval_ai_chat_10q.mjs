import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')
const logsDir = path.join(projectRoot, 'logs')

const BASE_URL = process.env.V3_EVAL_BASE_URL || 'http://127.0.0.1:3300'
const TEST_QUERIES = [
  '武汉大学附近有哪些咖啡店？',
  '湖北大学附近有哪些地铁站？',
  '武汉大学附近有哪些医院？',
  '武汉大学附近有哪些商超？',
  '光谷附近有哪些咖啡店？',
  '请分析武汉大学附近的配套、热门业态和明显缺口。',
  '请分析湖北大学附近的配套、热门业态和明显缺口。',
  '请概览武汉大学附近的空间结构和业态分布。',
  '武汉大学附近适合布局什么业态？',
  '比较武汉大学和湖北大学附近的业态差异。'
]

function buildOutputPath(baseName) {
  return path.join(logsDir, baseName)
}

function toSafeNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function buildStageTiming(eventTimeline = []) {
  const markers = {
    intent: null,
    spatial: null,
    reasoning: null,
    answer: null,
    first_text: null,
    done: null
  }

  for (const event of eventTimeline) {
    if (event.type === 'stage' && event.name && markers[event.name] === null) {
      markers[event.name] = event.t_ms
    }
    if (event.type === 'text' && markers.first_text === null) {
      markers.first_text = event.t_ms
    }
    if (event.type === 'done' && markers.done === null) {
      markers.done = event.t_ms
    }
  }

  const estimated = {
    intent: markers.intent !== null && markers.spatial !== null ? Math.max(0, markers.spatial - markers.intent) : 0,
    spatial: markers.spatial !== null && markers.reasoning !== null ? Math.max(0, markers.reasoning - markers.spatial) : 0,
    reasoning: markers.reasoning !== null && markers.answer !== null ? Math.max(0, markers.answer - markers.reasoning) : 0,
    answer_until_first_text: markers.answer !== null && markers.first_text !== null ? Math.max(0, markers.first_text - markers.answer) : 0,
    answer_total: markers.answer !== null && markers.done !== null ? Math.max(0, markers.done - markers.answer) : 0
  }

  return {
    markers_ms: markers,
    estimated_stage_ms: estimated
  }
}

async function runSingleQuery(query) {
  const startAt = Date.now()
  const response = await fetch(`${BASE_URL}/api/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: query }]
    })
  })

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let lineBuffer = ''
  let finalAnswer = ''
  let intentPreview = null
  let stats = null
  let topPois = []
  let refinedQueryPlan = null
  const eventTimeline = []
  let doneEventMs = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    lineBuffer += decoder.decode(value, { stream: true })
    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      let payload = null
      try {
        payload = JSON.parse(trimmed.slice(6))
      } catch {
        continue
      }

      const tMs = Date.now() - startAt
      eventTimeline.push({
        t_ms: tMs,
        type: payload?.type || 'unknown',
        ...(payload?.name ? { name: payload.name } : {})
      })

      if (payload?.type === 'intent_preview') {
        intentPreview = payload
      } else if (payload?.type === 'stats') {
        stats = payload
      } else if (payload?.type === 'pois' && Array.isArray(payload?.payload)) {
        topPois = payload.payload.slice(0, 5).map((item) => ({
          name: item?.name || null,
          category: item?.category || null,
          distance_m: toSafeNumber(item?.distance_m),
          score: toSafeNumber(item?.fused_score ?? item?.score),
          relevance_score: toSafeNumber(item?.relevance_score),
          spatial_score: toSafeNumber(item?.spatial_score)
        }))
      } else if (payload?.type === 'refined_result') {
        refinedQueryPlan = payload?.query_plan || null
      } else if (payload?.type === 'text' && typeof payload?.content === 'string') {
        finalAnswer += payload.content
      } else if (payload?.type === 'done') {
        doneEventMs = tMs
      }
    }
  }

  const wallMs = Date.now() - startAt

  return {
    query,
    wall_ms: wallMs,
    done_duration_ms: null,
    done_event_ms: doneEventMs,
    intent_preview: intentPreview,
    stats,
    top_pois: topPois,
    refined_query_plan: refinedQueryPlan,
    stage_timing: buildStageTiming(eventTimeline),
    final_answer: finalAnswer,
    event_timeline: eventTimeline
  }
}

async function ensureHealth() {
  const response = await fetch(`${BASE_URL}/health`)
  if (!response.ok) {
    throw new Error(`health HTTP ${response.status}`)
  }
  return response.json()
}

async function main() {
  await fs.mkdir(logsDir, { recursive: true })
  const health = await ensureHealth()
  console.log(`[eval_10q] health=${health?.status || 'unknown'} base=${BASE_URL}`)

  const results = []
  for (const query of TEST_QUERIES) {
    console.log(`[eval_10q] running: ${query}`)
    const record = await runSingleQuery(query)
    results.push(record)
    console.log(`[eval_10q] done: ${query} wall_ms=${record.wall_ms}`)
  }

  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    results
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const latestPath = buildOutputPath('eval_10q_report.json')
  const snapshotPath = buildOutputPath(`eval_10q_report_${timestamp}.json`)
  await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(snapshotPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`[eval_10q] latest report: ${latestPath}`)
  console.log(`[eval_10q] snapshot report: ${snapshotPath}`)
}

main().catch((error) => {
  console.error('[eval_10q] failed:', error)
  process.exitCode = 1
})
