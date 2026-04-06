import 'dotenv/config'

import fs from 'fs/promises'
import path from 'path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'url'

import { callLLM, getLLMConfig } from '../../services/ai/llmService.js'
import { ensurePostgreSQLRunning } from '../../services/infra/dockerService.js'
import {
  startManagedLlamaCppServices,
  stopManagedLlamaCppServices
} from '../../services/infra/llamaCppService.js'
import {
  getSpatialEncoderStatus,
  startSpatialEncoder
} from '../../services/infra/spatialEncoderClient.js'
import {
  generatePlannerPlanForQuery,
  PLANNER_EVAL_QUERIES
} from '../../services/planner_line/plannerHarness.js'
import { buildEvidenceBundle } from '../../services/planner_line/evidenceBundle.js'
import { createIntentSpecService } from '../../services/planner_line/intentSpecService.js'
import { buildSynthesisBrief } from '../../services/planner_line/synthesisBrief.js'
import { synthesizeAnswer } from '../../services/planner_line/answerSynthesis.js'
import { loadEmbeddings, getIndexStatus } from '../../services/retrieval/faissIndex.js'
import { createSpatialCoreToolRunner } from '../../services/spatial_core/defaultHandlers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')
const reportDir = path.join(projectRoot, 'docs', 'reports', 'test-runs')
const rawLogDir = path.join(projectRoot, 'logs')

process.chdir(projectRoot)

const intentSpecService = createIntentSpecService()
const toolRunner = createSpatialCoreToolRunner()

function roundMs(value) {
  return Math.round(Number(value) || 0)
}

function safeJson(value) {
  return JSON.stringify(value, null, 2)
}

function normalizeText(value = '') {
  return String(value || '').trim()
}

function formatShanghaiTimestamp(dateLike = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(dateLike)).replace(/\//g, '-')
}

function formatSlugTimestamp(dateLike = new Date()) {
  return formatShanghaiTimestamp(dateLike)
    .replace(/[ :]/g, '-')
    .replace(/--/g, '-')
}

function markdownEscape(value = '') {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
}

function summarizeNames(items = [], limit = 5) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item?.name || item))
    .filter(Boolean)
    .slice(0, limit)
}

function summarizeBuckets(items = [], limit = 5) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(typeof item === 'string' ? item : item?.bucket || item?.label))
    .filter(Boolean)
    .slice(0, limit)
}

function summarizeStepOutput(output = {}) {
  if (!output || typeof output !== 'object') {
    return {
      kind: typeof output,
      preview: String(output ?? '')
    }
  }

  if (output.anchor) {
    return {
      kind: 'anchor',
      anchor: output.anchor
    }
  }

  if (Array.isArray(output.pois)) {
    return {
      kind: 'pois',
      total_count: Number(output.total_count || output.pois.length || 0),
      top_names: summarizeNames(output.pois, 5)
    }
  }

  if (Array.isArray(output.support_buckets) || Array.isArray(output.dominant_buckets)) {
    return {
      kind: 'macro',
      support_buckets: summarizeBuckets(output.support_buckets, 5),
      dominant_buckets: summarizeBuckets(output.dominant_buckets, 5),
      scene_tags: (Array.isArray(output.scene_tags) ? output.scene_tags : []).slice(0, 5),
      cell_mix: (Array.isArray(output.cell_mix) ? output.cell_mix : [])
        .map((item) => normalizeText(item?.label || item))
        .filter(Boolean)
        .slice(0, 5)
    }
  }

  if (output.boundary || output.spatial_clusters) {
    return {
      kind: 'boundary',
      has_boundary: Boolean(output.boundary),
      hotspot_count: Array.isArray(output?.spatial_clusters?.hotspots)
        ? output.spatial_clusters.hotspots.length
        : Array.isArray(output.spatial_clusters)
          ? output.spatial_clusters.length
          : 0,
      vernacular_regions: Array.isArray(output.vernacular_regions) ? output.vernacular_regions.length : 0,
      fuzzy_regions: Array.isArray(output.fuzzy_regions) ? output.fuzzy_regions.length : 0
    }
  }

  if (output.anchor_context) {
    return {
      kind: 'anchor_context',
      anchor_context: output.anchor_context
    }
  }

  return output
}

function normalizePlanAnchors(plan = {}) {
  return (Array.isArray(plan?.anchors) ? plan.anchors : [])
    .map((anchor) => ({
      place_name: normalizeText(anchor?.place_name),
      role: normalizeText(anchor?.role) || 'primary'
    }))
    .filter((anchor) => anchor.place_name)
}

function buildIntentSpecInput({ userQuery = '', plan = {} } = {}) {
  return {
    userQuery,
    anchors: normalizePlanAnchors(plan)
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveRefString(value, stepOutputs = {}) {
  const match = String(value || '').match(/^\$ref:([a-z0-9_]+)\.([a-z0-9_.]+)$/u)
  if (!match) return value

  const [, stepId, fieldPath] = match
  const source = stepOutputs[stepId]
  return fieldPath.split('.').reduce((current, segment) => current?.[segment], source)
}

function resolveRefs(value, stepOutputs = {}) {
  if (typeof value === 'string') return resolveRefString(value, stepOutputs)
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, stepOutputs))
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveRefs(item, stepOutputs)])
    )
  }
  return value
}

function parseConditionExpectedValue(rawExpected = '') {
  const expected = String(rawExpected || '').trim()
  if (/^(true|false)$/i.test(expected)) return expected.toLowerCase() === 'true'
  if (/^null$/i.test(expected)) return null
  if (/^-?\d+(\.\d+)?$/u.test(expected)) return Number(expected)
  return expected.replace(/^['"]|['"]$/g, '')
}

function evaluateCondition(condition, stepOutputs = {}) {
  if (condition === null || condition === undefined || condition === '') {
    return { passed: true, actual: null, expected: null }
  }

  const match = String(condition).trim().match(/^\$ref:([a-z0-9_]+)\.([a-z0-9_.]+)\s*(<=|>=|<|>|===|==|!==|!=)\s*(.+)$/u)
  if (!match) {
    return { passed: false, actual: null, expected: null, error: 'unsupported_condition_syntax' }
  }

  const [, stepId, fieldPath, operator, rawExpected] = match
  const actual = fieldPath.split('.').reduce((current, segment) => current?.[segment], stepOutputs[stepId])
  const expected = parseConditionExpectedValue(rawExpected)

  let passed = false
  switch (operator) {
    case '<': passed = actual < expected; break
    case '<=': passed = actual <= expected; break
    case '>': passed = actual > expected; break
    case '>=': passed = actual >= expected; break
    case '==': passed = actual == expected; break
    case '===': passed = actual === expected; break
    case '!=': passed = actual != expected; break
    case '!==': passed = actual !== expected; break
    default: passed = false
  }

  return {
    passed,
    actual,
    expected,
    operator
  }
}

async function ensureRuntimeReady() {
  const bootstrap = {
    started_at: new Date().toISOString()
  }

  const bootstrapStart = performance.now()
  bootstrap.postgres_ready = await ensurePostgreSQLRunning()
  bootstrap.llamacpp = await startManagedLlamaCppServices()
  bootstrap.spatial_encoder_started = await startSpatialEncoder()
  await loadEmbeddings()
  bootstrap.faiss = getIndexStatus()
  bootstrap.spatial_encoder = await getSpatialEncoderStatus()
  bootstrap.planner_runtime = await getLLMConfig({
    model: process.env.PLANNER_MODEL,
    baseUrl: process.env.PLANNER_BASE_URL
  })
  bootstrap.answer_runtime = await getLLMConfig({
    model: process.env.ANSWER_SYNTHESIS_MODEL,
    baseUrl: process.env.ANSWER_SYNTHESIS_BASE_URL
  })
  bootstrap.bootstrap_ms = roundMs(performance.now() - bootstrapStart)

  return bootstrap
}

async function runPlanningStage(userQuery) {
  const llmCalls = []
  let llmAttemptCounter = 0
  const stageStart = performance.now()

  const planning = await generatePlannerPlanForQuery(userQuery, {
    max_repairs: 1,
    prompt_profile: 'runtime',
    llm_options: {
      temperature: 0,
      maxTokens: 1024,
      timeout: Number(process.env.PLANNER_EVAL_TIMEOUT_MS || 180000),
      retries: Number(process.env.PLANNER_EVAL_RETRIES || 0)
    },
    llmCall: async (messages, options = {}) => {
      const callStart = performance.now()
      const callRecord = {
        llm_call_index: llmAttemptCounter,
        started_at: new Date().toISOString(),
        messages,
        options
      }

      try {
        const rawOutput = await callLLM(messages, options)
        callRecord.duration_ms = roundMs(performance.now() - callStart)
        callRecord.raw_output = rawOutput
        llmCalls.push(callRecord)
        llmAttemptCounter += 1
        return rawOutput
      } catch (error) {
        callRecord.duration_ms = roundMs(performance.now() - callStart)
        callRecord.error = error instanceof Error ? error.message : String(error || '')
        llmCalls.push(callRecord)
        llmAttemptCounter += 1
        throw error
      }
    }
  })

  return {
    planning,
    llm_calls: llmCalls,
    duration_ms: roundMs(performance.now() - stageStart)
  }
}

function buildPlanningSource(planningResult = {}) {
  return {
    source: planningResult?.planning?.ok ? 'planner_model' : 'planner_model_failed',
    attempts: (planningResult?.planning?.attempts || []).map((attempt, index) => ({
      attempt_index: attempt.attempt_index,
      kind: attempt.kind,
      raw_output: attempt.raw_output,
      validation: attempt.validation,
      llm_duration_ms: planningResult?.llm_calls?.[index]?.duration_ms ?? null,
      llm_messages: planningResult?.llm_calls?.[index]?.messages ?? null,
      llm_options: planningResult?.llm_calls?.[index]?.options ?? null
    }))
  }
}

function buildIntentSpecStage(userQuery, plan = {}) {
  const stageStart = performance.now()
  const input = buildIntentSpecInput({ userQuery, plan })
  const intentSpec = intentSpecService.buildIntentSpec(input)

  return {
    input,
    intent_spec: intentSpec,
    duration_ms: roundMs(performance.now() - stageStart)
  }
}

async function runExecutionStage({ userQuery = '', plan = {}, intentSpec = null } = {}) {
  const stageStart = performance.now()
  const stepOutputs = {}
  const executedSteps = []
  const skippedSteps = []
  const stepRecords = []

  for (const step of Array.isArray(plan?.steps) ? plan.steps : []) {
    const conditionResult = evaluateCondition(step.condition, stepOutputs)
    if (!conditionResult.passed) {
      skippedSteps.push(step.step_id)
      stepRecords.push({
        step_id: step.step_id,
        tool: step.tool,
        status: 'skipped',
        condition: step.condition,
        condition_result: conditionResult,
        duration_ms: 0,
        input: null,
        output: null,
        output_summary: null
      })
      continue
    }

    const resolvedInput = resolveRefs(step.input, stepOutputs)
    const stepStart = performance.now()

    try {
      const result = await toolRunner.runTool({
        tool_name: step.tool,
        input: resolvedInput
      }, {
        user_query: userQuery,
        intent_spec: intentSpec,
        step_id: step.step_id,
        step_outputs: stepOutputs
      })

      const durationMs = roundMs(performance.now() - stepStart)
      stepOutputs[step.step_id] = result.output
      executedSteps.push(step.step_id)

      stepRecords.push({
        step_id: step.step_id,
        tool: step.tool,
        status: 'ok',
        condition: step.condition,
        condition_result: conditionResult,
        duration_ms: durationMs,
        input: resolvedInput,
        output: result.output,
        output_summary: summarizeStepOutput(result.output)
      })
    } catch (error) {
      stepRecords.push({
        step_id: step.step_id,
        tool: step.tool,
        status: 'error',
        condition: step.condition,
        condition_result: conditionResult,
        duration_ms: roundMs(performance.now() - stepStart),
        input: resolvedInput,
        output: null,
        output_summary: null,
        error: error instanceof Error ? error.message : String(error || '')
      })
      throw Object.assign(
        new Error(`step ${step.step_id} failed: ${error instanceof Error ? error.message : String(error || '')}`),
        { stepRecords, stepOutputs, executedSteps, skippedSteps }
      )
    }
  }

  const executionTrace = {
    executed_steps: executedSteps,
    skipped_steps: skippedSteps,
    query_count: executedSteps.length,
    rounds_used: 1
  }

  const bundleStart = performance.now()
  const evidenceBundle = buildEvidenceBundle({
    stepOutputs,
    executionTrace,
    plan,
    intentSpec
  })
  const evidenceBundleMs = roundMs(performance.now() - bundleStart)

  return {
    execution_trace: executionTrace,
    step_outputs: stepOutputs,
    evidence_bundle: evidenceBundle,
    step_records: stepRecords,
    evidence_bundle_ms: evidenceBundleMs,
    duration_ms: roundMs(performance.now() - stageStart)
  }
}

function runBriefStage({ userQuery = '', plan = {}, evidenceBundle = {} } = {}) {
  const stageStart = performance.now()
  const brief = buildSynthesisBrief({
    userQuery,
    plan,
    evidenceBundle
  })

  return {
    brief,
    duration_ms: roundMs(performance.now() - stageStart)
  }
}

async function runAnswerStage({ userQuery = '', plan = {}, evidenceBundle = {} } = {}) {
  const llmCalls = []
  const stageStart = performance.now()

  const synthesis = await synthesizeAnswer({
    user_query: userQuery,
    plan,
    evidence_bundle: evidenceBundle,
    llmCall: async (messages, options = {}) => {
      const callStart = performance.now()
      const record = {
        started_at: new Date().toISOString(),
        messages,
        options
      }

      try {
        const rawOutput = await callLLM(messages, options)
        record.duration_ms = roundMs(performance.now() - callStart)
        record.raw_output = rawOutput
        llmCalls.push(record)
        return rawOutput
      } catch (error) {
        record.duration_ms = roundMs(performance.now() - callStart)
        record.error = error instanceof Error ? error.message : String(error || '')
        llmCalls.push(record)
        throw error
      }
    }
  })

  return {
    synthesis,
    llm_calls: llmCalls,
    duration_ms: roundMs(performance.now() - stageStart)
  }
}

async function runSingleQuery(query, index) {
  const queryStart = new Date()
  const totalStart = performance.now()
  const record = {
    index,
    query,
    started_at_iso: queryStart.toISOString(),
    started_at_shanghai: formatShanghaiTimestamp(queryStart),
    planning: null,
    intent_spec_stage: null,
    execution: null,
    brief_stage: null,
    answer_stage: null,
    total_duration_ms: null,
    status: 'unknown'
  }

  try {
    const planningStage = await runPlanningStage(query)
    record.planning = {
      ...buildPlanningSource(planningStage),
      ok: planningStage.planning.ok,
      duration_ms: planningStage.duration_ms,
      prompt_bundle: planningStage.planning.prompt_bundle,
      plan: planningStage.planning.plan
    }

    if (!planningStage.planning.ok || !planningStage.planning.plan) {
      record.status = 'planning_failed'
      return record
    }

    const intentSpecStage = buildIntentSpecStage(query, planningStage.planning.plan)
    record.intent_spec_stage = intentSpecStage

    const executionStage = await runExecutionStage({
      userQuery: query,
      plan: planningStage.planning.plan,
      intentSpec: intentSpecStage.intent_spec
    })
    record.execution = executionStage

    const briefStage = runBriefStage({
      userQuery: query,
      plan: planningStage.planning.plan,
      evidenceBundle: executionStage.evidence_bundle
    })
    record.brief_stage = briefStage

    const answerStage = await runAnswerStage({
      userQuery: query,
      plan: planningStage.planning.plan,
      evidenceBundle: executionStage.evidence_bundle
    })
    record.answer_stage = answerStage

    record.status = answerStage?.synthesis?.source === 'llm_synthesis'
      ? 'ok_llm'
      : 'ok_fallback'

    return record
  } catch (error) {
    record.status = 'error'
    record.error = error instanceof Error ? error.message : String(error || '')
    if (error?.stepRecords && !record.execution) {
      record.execution = {
        step_records: error.stepRecords,
        step_outputs: error.stepOutputs,
        execution_trace: {
          executed_steps: error.executedSteps || [],
          skipped_steps: error.skippedSteps || [],
          query_count: Array.isArray(error.executedSteps) ? error.executedSteps.length : 0,
          rounds_used: 1
        }
      }
    }
    return record
  } finally {
    const finishedAt = new Date()
    record.ended_at_iso = finishedAt.toISOString()
    record.ended_at_shanghai = formatShanghaiTimestamp(finishedAt)
    record.total_duration_ms = roundMs(performance.now() - totalStart)
  }
}

function buildSummaryRow(record = {}) {
  const answerSource = record?.answer_stage?.synthesis?.source || '-'
  const plannerSource = record?.planning?.ok ? 'planner_model' : 'planner_failed'
  const executedSteps = Array.isArray(record?.execution?.step_records)
    ? record.execution.step_records.filter((item) => item.status === 'ok').length
    : 0

  return `| Q${record.index} | ${markdownEscape(record.query)} | ${markdownEscape(record.started_at_shanghai)} | ${record.status} | ${plannerSource} | ${answerSource} | ${record?.planning?.duration_ms ?? '-'} | ${record?.intent_spec_stage?.duration_ms ?? '-'} | ${record?.execution?.duration_ms ?? '-'} | ${record?.execution?.evidence_bundle_ms ?? '-'} | ${record?.brief_stage?.duration_ms ?? '-'} | ${record?.answer_stage?.duration_ms ?? '-'} | ${executedSteps} | ${record.total_duration_ms ?? '-'} |`
}

function buildKeyValueTable(rows = []) {
  return [
    '| 字段 | 值 |',
    '|---|---|',
    ...rows.map(([key, value]) => `| ${markdownEscape(key)} | ${markdownEscape(value)} |`)
  ].join('\n')
}

function buildStageTable(record = {}) {
  const rows = [
    ['planner_llm', record?.planning?.duration_ms ?? '-', record?.planning?.ok ? 'planner 模型产出 plan' : 'planner 失败'],
    ['intent_spec', record?.intent_spec_stage?.duration_ms ?? '-', '按 query + anchors 组装 intent_spec'],
    ['execution_total', record?.execution?.duration_ms ?? '-', '执行 plan steps + 汇总 evidence_bundle'],
    ['evidence_bundle', record?.execution?.evidence_bundle_ms ?? '-', 'evidence_profile / representative_pois / support_buckets 汇总'],
    ['synthesis_brief', record?.brief_stage?.duration_ms ?? '-', '压缩为短摘要 brief'],
    ['answer_synthesis', record?.answer_stage?.duration_ms ?? '-', 'answer_synthesis 阶段；当前已合并文本输出与润色']
  ]

  return [
    '| 阶段 | 耗时(ms) | 说明 |',
    '|---|---:|---|',
    ...rows.map(([stage, ms, note]) => `| ${markdownEscape(stage)} | ${markdownEscape(ms)} | ${markdownEscape(note)} |`)
  ].join('\n')
}

function buildStepTable(stepRecords = []) {
  return [
    '| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |',
    '|---|---|---|---:|---|---|---|',
    ...(Array.isArray(stepRecords) ? stepRecords : []).map((step) => `| ${markdownEscape(step.step_id)} | ${markdownEscape(step.tool)} | ${markdownEscape(step.status)} | ${markdownEscape(step.duration_ms ?? '-')} | ${markdownEscape(step.condition || 'null')} | ${markdownEscape(safeJson(step.input || {}))} | ${markdownEscape(safeJson(step.output_summary || {}))} |`)
  ].join('\n')
}

function buildPlannerAttemptTable(planning = {}) {
  const attempts = Array.isArray(planning?.attempts) ? planning.attempts : []
  return [
    '| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |',
    '|---|---|---:|---|---|---|',
    ...attempts.map((attempt) => `| ${attempt.attempt_index} | ${markdownEscape(attempt.kind)} | ${markdownEscape(attempt.llm_duration_ms ?? '-')} | ${markdownEscape(Boolean(attempt?.validation?.ok))} | ${markdownEscape(attempt?.validation?.parse_error || '')} | ${markdownEscape((attempt?.validation?.errors || []).join('; '))} |`)
  ].join('\n')
}

function buildSynthesisCallTable(answerStage = {}) {
  const calls = Array.isArray(answerStage?.llm_calls) ? answerStage.llm_calls : []
  return [
    '| llm_call | duration_ms | error |',
    '|---|---:|---|',
    ...calls.map((call, index) => `| ${index} | ${markdownEscape(call.duration_ms ?? '-')} | ${markdownEscape(call.error || '')} |`)
  ].join('\n')
}

function buildDetailsBlock(title, language, content) {
  return [
    `<details>`,
    `<summary>${title}</summary>`,
    '',
    `\`\`\`${language}`,
    String(content || ''),
    '```',
    '',
    '</details>'
  ].join('\n')
}

function buildMarkdownReport(report = {}) {
  const headerLines = [
    '# Planner Line 10题完整实测报告',
    '',
    `- 生成时间（上海）: ${formatShanghaiTimestamp(report.generated_at)}`,
    `- Bootstrap耗时: ${report.runtime?.bootstrap_ms ?? '-'} ms`,
    `- Planner模型: ${report.runtime?.planner_runtime?.model || '-'} @ ${report.runtime?.planner_runtime?.baseUrl || '-'}`,
    `- Answer模型: ${report.runtime?.answer_runtime?.model || '-'} @ ${report.runtime?.answer_runtime?.baseUrl || '-'}`,
    `- Spatial Encoder: ${report.runtime?.spatial_encoder?.status || '-'} / ready=${report.runtime?.spatial_encoder?.ready ?? '-'}`,
    `- FAISS: loaded=${report.runtime?.faiss?.loaded ?? '-'} / poi_count=${report.runtime?.faiss?.poiCount ?? '-'}`,
    '',
    '> 说明：当前 pipeline 已将“文本输出”和“润色”合并在同一个 `answer_synthesis` 阶段中，因此本报告使用 `synthesis_brief JSON + synthesis raw text + final sanitized answer` 来记录该阶段。',
    ''
  ]

  const summaryTable = [
    '## 总表',
    '',
    '| 题号 | 问题 | 开始时间(上海) | 状态 | planner_source | answer_source | planner_ms | intent_ms | execution_ms | evidence_bundle_ms | brief_ms | answer_ms | executed_steps | total_ms |',
    '|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...(report.results || []).map((record) => buildSummaryRow(record)),
    ''
  ]

  const detailsSections = (report.results || []).map((record) => {
    const planningAttempts = record?.planning?.attempts || []
    const finalAttempt = planningAttempts[planningAttempts.length - 1] || null
    const planJson = record?.planning?.plan || null
    const briefJson = record?.answer_stage?.synthesis?.brief || record?.brief_stage?.brief || null
    const synthesisCall = Array.isArray(record?.answer_stage?.llm_calls) ? record.answer_stage.llm_calls[0] : null

    return [
      `## Q${record.index}. ${record.query}`,
      '',
      buildKeyValueTable([
        ['问题', record.query],
        ['开始时间（ISO）', record.started_at_iso],
        ['开始时间（上海）', record.started_at_shanghai],
        ['结束时间（ISO）', record.ended_at_iso],
        ['结束时间（上海）', record.ended_at_shanghai],
        ['最终状态', record.status],
        ['总耗时(ms)', record.total_duration_ms],
        ['planner是否成功', record?.planning?.ok ?? false],
        ['answer source', record?.answer_stage?.synthesis?.source || '-'],
        ['执行步骤数', Array.isArray(record?.execution?.step_records) ? record.execution.step_records.length : 0]
      ]),
      '',
      '### 阶段耗时',
      '',
      buildStageTable(record),
      '',
      '### 执行环节',
      '',
      buildStepTable(record?.execution?.step_records || []),
      '',
      '### Planner LLM 产物',
      '',
      buildPlannerAttemptTable(record?.planning || {}),
      '',
      buildDetailsBlock('Planner 最终 attempt 原始文本', 'text', finalAttempt?.raw_output || ''),
      '',
      buildDetailsBlock('Planner 最终 attempt 校验后 raw_json', 'json', finalAttempt?.validation?.raw_json ? safeJson(JSON.parse(finalAttempt.validation.raw_json)) : ''),
      '',
      buildDetailsBlock('Planner 最终 plan JSON', 'json', planJson ? safeJson(planJson) : ''),
      '',
      '### Intent Spec',
      '',
      buildDetailsBlock('Intent Spec 输入', 'json', safeJson(record?.intent_spec_stage?.input || {})),
      '',
      buildDetailsBlock('Intent Spec 输出', 'json', safeJson(record?.intent_spec_stage?.intent_spec || {})),
      '',
      '### Evidence / Brief / Answer',
      '',
      buildSynthesisCallTable(record?.answer_stage || {}),
      '',
      buildDetailsBlock('Evidence Profile JSON', 'json', safeJson(record?.execution?.evidence_bundle?.evidence_profile || {})),
      '',
      buildDetailsBlock('Synthesis Brief JSON', 'json', safeJson(briefJson || {})),
      '',
      buildDetailsBlock('Answer 阶段原始 LLM 文本', 'text', synthesisCall?.raw_output || ''),
      '',
      buildDetailsBlock('最终回答文本', 'text', record?.answer_stage?.synthesis?.answer || ''),
      '',
      record?.error ? buildDetailsBlock('错误信息', 'text', record.error) : null,
      ''
    ].filter(Boolean).join('\n')
  })

  return [
    ...headerLines,
    ...summaryTable,
    '## 详细记录',
    '',
    ...detailsSections
  ].join('\n')
}

async function writeOutputs(report = {}) {
  await fs.mkdir(reportDir, { recursive: true })
  await fs.mkdir(rawLogDir, { recursive: true })

  const slug = formatSlugTimestamp(report.generated_at)
  const markdownPath = path.join(reportDir, `${slug}_planner_line_10q_detailed_eval.md`)
  const jsonPath = path.join(rawLogDir, `${slug}_planner_line_10q_detailed_eval.json`)

  await fs.writeFile(jsonPath, `${safeJson(report)}\n`, 'utf8')
  await fs.writeFile(markdownPath, `${buildMarkdownReport(report)}\n`, 'utf8')

  return {
    markdownPath,
    jsonPath
  }
}

async function main() {
  const runtime = await ensureRuntimeReady()
  const results = []

  for (let index = 0; index < PLANNER_EVAL_QUERIES.length; index += 1) {
    const query = PLANNER_EVAL_QUERIES[index]
    console.log(`[planner_detailed_eval] running Q${index + 1}: ${query}`)
    const result = await runSingleQuery(query, index + 1)
    results.push(result)
    console.log(`[planner_detailed_eval] done Q${index + 1}: status=${result.status} total_ms=${result.total_duration_ms}`)
  }

  const report = {
    generated_at: new Date().toISOString(),
    runtime,
    results
  }

  const output = await writeOutputs(report)
  console.log(`[planner_detailed_eval] markdown report: ${output.markdownPath}`)
  console.log(`[planner_detailed_eval] raw json: ${output.jsonPath}`)
} 

main()
  .catch(async (error) => {
    console.error('[planner_detailed_eval] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await stopManagedLlamaCppServices()
  })
