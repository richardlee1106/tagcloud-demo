import 'dotenv/config'

import { performance } from 'node:perf_hooks'

import { synthesizeAnswer } from '../../services/planner_line/answerSynthesis.js'
import { createPlanExecutor } from '../../services/planner_line/planExecutor.js'
import { createPlannerService } from '../../services/planner_line/plannerService.js'
import { createSpatialCoreToolRunner } from '../../services/spatial_core/defaultHandlers.js'

const query = process.argv.slice(2).join(' ').trim() || '武汉大学附近有哪些咖啡店？'
const synthesisMode = String(process.env.PLANNER_DEMO_SYNTHESIS_MODE || 'fallback').trim().toLowerCase()

function logStage(stage, message, extra = null) {
  const prefix = `[planner_demo] ${stage}: ${message}`
  if (extra && typeof extra === 'object') {
    console.error(prefix, JSON.stringify(extra))
    return
  }
  console.error(prefix)
}

const planningService = createPlannerService()
const executor = createPlanExecutor({
  toolRunner: createSpatialCoreToolRunner()
})

const synthesize = synthesisMode === 'llm'
  ? synthesizeAnswer
  : async (payload) => synthesizeAnswer({
      ...payload,
      llmCall: null
    })

const startAt = performance.now()

logStage('start', 'received query', {
  query,
  synthesis_mode: synthesisMode
})

logStage('planning', 'running')
const planningStart = performance.now()
const planning = await planningService.planQuery(query, {
  max_repairs: 1,
  llm_options: {
    temperature: 0,
    maxTokens: 4096,
    timeout: Number(process.env.PLANNER_EVAL_TIMEOUT_MS || 180000),
    retries: Number(process.env.PLANNER_EVAL_RETRIES || 0)
  }
})
logStage('planning', 'done', {
  ok: planning.ok,
  source: planning.source,
  ms: Math.round(performance.now() - planningStart)
})

let result

if (!planning.ok || !planning.plan) {
  result = {
    ok: false,
    stage: 'planning',
    planning
  }
} else {
  logStage('execution', 'running')
  const executionStart = performance.now()
  const execution = await executor.executePlan(planning.plan, {
    user_query: query
  })
  logStage('execution', 'done', {
    ms: Math.round(performance.now() - executionStart),
    executed_steps: execution.execution_trace.executed_steps,
    query_count: execution.execution_trace.query_count
  })

  logStage('synthesis', 'running')
  const synthesisStart = performance.now()
  const synthesis = await synthesize({
    user_query: query,
    plan: planning.plan,
    evidence_bundle: execution.evidence_bundle
  })
  logStage('synthesis', 'done', {
    ms: Math.round(performance.now() - synthesisStart),
    source: synthesis.source
  })

  result = {
    ok: true,
    planning,
    execution,
    synthesis
  }
}

logStage('done', 'completed', {
  ok: result.ok,
  ms: Math.round(performance.now() - startAt),
  planning_source: result.planning?.source || null,
  synthesis_source: result.synthesis?.source || null
})

console.log(JSON.stringify(result, null, 2))
