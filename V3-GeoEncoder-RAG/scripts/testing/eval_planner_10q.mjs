import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  evaluatePlannerQueries,
  getPlannerRuntimeInfo,
  PLANNER_EVAL_QUERIES
} from '../../services/planner_line/plannerHarness.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')
const logsDir = path.join(projectRoot, 'logs')

function buildOutputPath(baseName) {
  return path.join(logsDir, baseName)
}

function toPositiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

async function main() {
  await fs.mkdir(logsDir, { recursive: true })

  const runtime = await getPlannerRuntimeInfo()
  const maxRepairs = toPositiveInteger(process.env.PLANNER_EVAL_MAX_REPAIRS, 1)
  const timeout = toPositiveInteger(process.env.PLANNER_EVAL_TIMEOUT_MS, 180000)
  const maxTokens = toPositiveInteger(process.env.PLANNER_EVAL_MAX_TOKENS, 4096)
  const retries = toPositiveInteger(process.env.PLANNER_EVAL_RETRIES, 0)
  console.log(`[planner_eval_10q] provider=${runtime.provider} model=${runtime.model}`)

  const report = await evaluatePlannerQueries(PLANNER_EVAL_QUERIES, {
    max_repairs: maxRepairs,
    llm_options: {
      temperature: 0,
      maxTokens,
      timeout,
      retries
    }
  })

  const fullReport = {
    ...report,
    runtime,
    eval_options: {
      max_repairs: maxRepairs,
      timeout_ms: timeout,
      max_tokens: maxTokens,
      retries
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const latestPath = buildOutputPath('planner_eval_10q_report.json')
  const snapshotPath = buildOutputPath(`planner_eval_10q_report_${timestamp}.json`)

  await fs.writeFile(latestPath, `${JSON.stringify(fullReport, null, 2)}\n`, 'utf8')
  await fs.writeFile(snapshotPath, `${JSON.stringify(fullReport, null, 2)}\n`, 'utf8')

  console.log(`[planner_eval_10q] passed=${fullReport.summary.passed_queries}/${fullReport.summary.total_queries}`)
  console.log(`[planner_eval_10q] latest report: ${latestPath}`)
  console.log(`[planner_eval_10q] snapshot report: ${snapshotPath}`)
}

main().catch((error) => {
  console.error('[planner_eval_10q] failed:', error)
  process.exitCode = 1
})
