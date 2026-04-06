import 'dotenv/config'

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')
const logsDir = path.join(projectRoot, 'logs')

const DEFAULT_BASE_URL = process.env.PLANNER_HTTP_BASE_URL || `http://127.0.0.1:${process.env.PORT || '3300'}`
const DEFAULT_QUERIES = [
  '武汉大学附近有哪些咖啡店？',
  '湖北大学附近有哪些地铁站？',
  '武汉大学附近有哪些医院？',
  '武汉大学附近有哪些商超？',
  '光谷附近有哪些咖啡店？',
  '请概览武汉大学附近的空间结构和业态分布。'
]

function buildOutputPath(baseName) {
  return path.join(logsDir, baseName)
}

function pickSupportBuckets(evidenceBundle = {}) {
  const buckets = Array.isArray(evidenceBundle?.support_buckets) ? evidenceBundle.support_buckets : []
  return buckets
    .map((item) => typeof item === 'string' ? item : String(item?.bucket || item?.label || '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

function pickRepresentativeNames(evidenceBundle = {}) {
  return (Array.isArray(evidenceBundle?.representative_pois) ? evidenceBundle.representative_pois : [])
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

async function runOne(baseUrl, query, synthesisMode) {
  const response = await fetch(`${baseUrl}/api/planner/demo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: query }],
      options: { synthesisMode }
    })
  })

  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }

  const evidenceBundle = payload?.execution?.evidence_bundle || {}
  return {
    query,
    synthesis_mode: synthesisMode,
    status: response.status,
    success: payload?.success ?? false,
    planning_source: payload?.planning?.source || null,
    task_type: payload?.planning?.plan?.task_type_hint || null,
    answer_source: payload?.answer?.source || null,
    nearby_count: Array.isArray(evidenceBundle?.nearby_pois) ? evidenceBundle.nearby_pois.length : 0,
    representative: pickRepresentativeNames(evidenceBundle),
    support_buckets: pickSupportBuckets(evidenceBundle),
    answer: payload?.answer?.text || payload?.error || text
  }
}

async function main() {
  await fs.mkdir(logsDir, { recursive: true })

  const baseUrl = DEFAULT_BASE_URL.replace(/\/$/, '')
  const allResults = []

  for (const synthesisMode of ['fallback', 'llm']) {
    for (const query of DEFAULT_QUERIES) {
      console.log(`[planner_http_regression] ${synthesisMode} :: ${query}`)
      try {
        const result = await runOne(baseUrl, query, synthesisMode)
        allResults.push(result)
      } catch (error) {
        allResults.push({
          query,
          synthesis_mode: synthesisMode,
          status: 0,
          success: false,
          planning_source: null,
          task_type: null,
          answer_source: null,
          nearby_count: 0,
          representative: [],
          support_buckets: [],
          answer: String(error?.message || error)
        })
      }
    }
  }

  const summary = {
    total_runs: allResults.length,
    success_runs: allResults.filter((item) => item.success).length,
    failed_runs: allResults.filter((item) => !item.success).length,
    fallback_runs: allResults.filter((item) => item.synthesis_mode === 'fallback').length,
    llm_runs: allResults.filter((item) => item.synthesis_mode === 'llm').length
  }

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    queries: DEFAULT_QUERIES,
    results: allResults,
    summary
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const latestPath = buildOutputPath('planner_http_regression_report.json')
  const snapshotPath = buildOutputPath(`planner_http_regression_report_${timestamp}.json`)

  await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(snapshotPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`[planner_http_regression] success=${summary.success_runs}/${summary.total_runs}`)
  console.log(`[planner_http_regression] latest report: ${latestPath}`)
  console.log(`[planner_http_regression] snapshot report: ${snapshotPath}`)
}

main().catch((error) => {
  console.error('[planner_http_regression] failed:', error)
  process.exitCode = 1
})
