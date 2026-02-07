#!/usr/bin/env node

/**
 * Dual-run parity checker.
 *
 * Purpose:
 * 1) Execute graph_reasoning / region_comparison through Python primary and Node fallback.
 * 2) Validate response schema stability.
 * 3) Emit JSON report with thresholds for regression monitoring.
 */

import fs from 'fs'
import path from 'path'

const DEFAULT_BASE_URL = process.env.SPATIAL_CHECK_BASE_URL || 'http://127.0.0.1:3200'
const DEFAULT_OUT = 'reports/rollout/dual-run-latest.json'
const DEFAULT_SAMPLES = 2
const DEFAULT_TIMEOUT_MS = 120000

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    base: DEFAULT_BASE_URL,
    out: DEFAULT_OUT,
    samples: DEFAULT_SAMPLES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    minPoiOverlap: 0.1
  }

  for (let i = 0; i < argv.length; i += 1) {
    let token = argv[i]
    let tokenValue = null

    if (typeof token === 'string' && token.includes('=')) {
      const splitIndex = token.indexOf('=')
      tokenValue = token.slice(splitIndex + 1)
      token = token.slice(0, splitIndex)
    }

    const readValue = () => {
      if (tokenValue !== null) return tokenValue
      if (argv[i + 1] === undefined) return null
      i += 1
      return argv[i]
    }

    if (token === '--base' || token === '-b') {
      const value = readValue()
      if (value !== null) args.base = String(value)
    } else if (token === '--out' || token === '-o') {
      const value = readValue()
      if (value !== null) args.out = String(value)
    } else if (token === '--samples' || token === '-n') {
      const value = readValue()
      if (value !== null) args.samples = Number(value)
    } else if (token === '--timeout') {
      const value = readValue()
      if (value !== null) args.timeoutMs = Number(value)
    } else if (token === '--min-poi-overlap') {
      const value = readValue()
      if (value !== null) args.minPoiOverlap = Number(value)
    }
  }

  if (!Number.isFinite(args.samples) || args.samples <= 0) {
    throw new Error(`invalid samples: ${args.samples}`)
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${args.timeoutMs}`)
  }
  if (!Number.isFinite(args.minPoiOverlap) || args.minPoiOverlap < 0 || args.minPoiOverlap > 1) {
    throw new Error(`invalid min-poi-overlap: ${args.minPoiOverlap}`)
  }

  args.samples = Math.floor(args.samples)
  args.timeoutMs = Math.floor(args.timeoutMs)
  return args
}

function waitTimeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function checkBaseHealth(baseUrl, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${baseUrl}/api/ai/status`, {
      method: 'GET',
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`status=${response.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

function normalizePoiName(poi) {
  if (!poi || typeof poi !== 'object') return null
  const name = poi.name || poi.poi_name || poi.title || null
  if (!name) return null
  return String(name).trim().toLowerCase() || null
}

function calcTopKOverlap(leftPois = [], rightPois = [], topK = 20) {
  const left = leftPois.map(normalizePoiName).filter(Boolean).slice(0, topK)
  const right = rightPois.map(normalizePoiName).filter(Boolean).slice(0, topK)

  if (left.length === 0 || right.length === 0) {
    return { overlapCount: 0, topK, ratioByLeft: 0, ratioByRight: 0 }
  }

  const rightSet = new Set(right)
  const overlapCount = left.filter((item) => rightSet.has(item)).length

  return {
    overlapCount,
    topK,
    ratioByLeft: Number((overlapCount / left.length).toFixed(4)),
    ratioByRight: Number((overlapCount / right.length).toFixed(4))
  }
}

function hasShape(results, shapeType) {
  if (!results || typeof results !== 'object') return false

  const baseOk =
    typeof results.mode === 'string' &&
    Array.isArray(results.pois) &&
    results.stats && typeof results.stats === 'object' &&
    results.spatial_clusters && typeof results.spatial_clusters === 'object'

  if (!baseOk) return false

  if (shapeType === 'graph_reasoning') {
    return (
      results.graph_reasoning && typeof results.graph_reasoning === 'object' &&
      results.graph_analysis && typeof results.graph_analysis === 'object'
    )
  }

  if (shapeType === 'region_comparison') {
    return (
      Array.isArray(results.region_analyses) &&
      Array.isArray(results.target_regions) &&
      results.comparison && typeof results.comparison === 'object'
    )
  }

  return true
}

function buildRegionPois(seed = 0) {
  const offset = seed * 0.0001
  return [
    { id: `r${seed}-1`, name: `Cafe-${seed}-A`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.312 + offset, lat: 30.552 + offset },
    { id: `r${seed}-2`, name: `Cafe-${seed}-B`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.313 + offset, lat: 30.553 + offset },
    { id: `r${seed}-3`, name: `Meal-${seed}-A`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.314 + offset, lat: 30.554 + offset },
    { id: `r${seed}-4`, name: `Book-${seed}-A`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.315 + offset, lat: 30.555 + offset },
    { id: `r${seed}-5`, name: `Sport-${seed}-A`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.316 + offset, lat: 30.556 + offset }
  ]
}

function buildRegionPoisB(seed = 0) {
  const offset = seed * 0.0001
  return [
    { id: `rb${seed}-1`, name: `Retail-${seed}-A`, category_big: '??', category_mid: '??', category_small: '???', lon: 114.332 + offset, lat: 30.552 + offset },
    { id: `rb${seed}-2`, name: `Retail-${seed}-B`, category_big: '??', category_mid: '??', category_small: '???', lon: 114.333 + offset, lat: 30.553 + offset },
    { id: `rb${seed}-3`, name: `Retail-${seed}-C`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.334 + offset, lat: 30.554 + offset },
    { id: `rb${seed}-4`, name: `Edu-${seed}-A`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.335 + offset, lat: 30.555 + offset },
    { id: `rb${seed}-5`, name: `Food-${seed}-A`, category_big: '??', category_mid: '??', category_small: '??', lon: 114.336 + offset, lat: 30.556 + offset }
  ]
}

function buildCasePayload(caseType, sampleIndex) {
  if (caseType === 'graph_reasoning') {
    const shift = sampleIndex * 0.002
    return {
      queryPlan: {
        query_type: 'graph_reasoning',
        categories: [],
        semantic_query: '',
        need_graph_reasoning: true
      },
      options: {
        spatialContext: {
          mode: 'Viewport',
          viewport: [114.31 + shift, 30.55, 114.34 + shift, 30.58]
        },
        sourcePolicy: {
          has_custom_area: false,
          has_category_filter: false,
          area_scope: 'viewport',
          selected_categories: []
        }
      }
    }
  }

  if (caseType === 'region_comparison') {
    const regionA = buildRegionPois(sampleIndex)
    const regionB = buildRegionPoisB(sampleIndex)

    return {
      queryPlan: {
        query_type: 'region_comparison',
        categories: [],
        target_regions: [1, 2],
        comparison_dimensions: ['????']
      },
      options: {
        spatialContext: {
          mode: 'Viewport',
          viewport: [114.30, 30.54, 114.35, 30.58]
        },
        regions: [
          {
            id: 1,
            name: `A-${sampleIndex}`,
            pois: regionA,
            stats: {
              poiCount: regionA.length,
              categories: { food: 3, culture: 2 }
            }
          },
          {
            id: 2,
            name: `B-${sampleIndex}`,
            pois: regionB,
            stats: {
              poiCount: regionB.length,
              categories: { retail: 3, education: 2 }
            }
          }
        ]
      }
    }
  }

  throw new Error(`unknown case type: ${caseType}`)
}

async function executePlan(baseUrl, payload, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetch(`${baseUrl}/api/ai/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    const elapsedMs = Date.now() - startedAt
    const body = await response.json().catch(() => ({}))

    return {
      ok: response.ok,
      status: response.status,
      elapsedMs,
      body
    }
  } finally {
    clearTimeout(timer)
  }
}

function buildRunSummary(caseType, sampleIndex, pythonRun, nodeRun, minPoiOverlap) {
  const pyResults = pythonRun?.body?.results || {}
  const ndResults = nodeRun?.body?.results || {}

  const schemaPython = hasShape(pyResults, caseType)
  const schemaNode = hasShape(ndResults, caseType)
  const poiOverlap = calcTopKOverlap(pyResults.pois || [], ndResults.pois || [], 20)

  const alerts = []
  if (!pythonRun.ok) alerts.push(`python_run_http_${pythonRun.status}`)
  if (!nodeRun.ok) alerts.push(`node_run_http_${nodeRun.status}`)
  if (!schemaPython) alerts.push('python_schema_invalid')
  if (!schemaNode) alerts.push('node_schema_invalid')

  if ((pyResults.pois || []).length > 0 && poiOverlap.ratioByLeft < minPoiOverlap) {
    alerts.push(`poi_overlap_low:${poiOverlap.ratioByLeft}`)
  }

  if (caseType === 'region_comparison') {
    const pyValid = Number(pyResults?.stats?.valid_regions || pyResults?.stats?.regions_analyzed || 0)
    const ndValid = Number(ndResults?.stats?.valid_regions || ndResults?.stats?.regions_analyzed || 0)
    if (pyValid < 2 || ndValid < 2) {
      alerts.push(`region_valid_count_low:py=${pyValid},node=${ndValid}`)
    }
  }

  if (caseType === 'graph_reasoning') {
    const pyNodes = Number(pyResults?.graph_reasoning?.node_count || 0)
    const ndNodes = Number(ndResults?.graph_reasoning?.node_count || 0)
    if (pyNodes <= 0 && ndNodes <= 0) {
      alerts.push('graph_nodes_empty_both')
    }
  }

  return {
    case_type: caseType,
    sample_index: sampleIndex,
    pass: alerts.length === 0,
    alerts,
    python: {
      ok: pythonRun.ok,
      status: pythonRun.status,
      elapsed_ms: pythonRun.elapsedMs,
      mode: pyResults.mode || null,
      compute_mode: pythonRun?.body?.diagnostics?.compute_mode || null,
      executor_engine: pyResults?.stats?.executor_engine || null,
      poi_count: Array.isArray(pyResults.pois) ? pyResults.pois.length : 0,
      schema_ok: schemaPython
    },
    node_fallback: {
      ok: nodeRun.ok,
      status: nodeRun.status,
      elapsed_ms: nodeRun.elapsedMs,
      mode: ndResults.mode || null,
      compute_mode: nodeRun?.body?.diagnostics?.compute_mode || null,
      executor_engine: ndResults?.stats?.executor_engine || null,
      poi_count: Array.isArray(ndResults.pois) ? ndResults.pois.length : 0,
      schema_ok: schemaNode
    },
    poi_overlap: poiOverlap
  }
}

function summarize(reportItems = []) {
  const total = reportItems.length
  const passed = reportItems.filter((item) => item.pass).length
  const failed = total - passed
  const alertCount = reportItems.reduce((sum, item) => sum + item.alerts.length, 0)

  const avgPythonLatency = total > 0
    ? Number((reportItems.reduce((sum, item) => sum + Number(item?.python?.elapsed_ms || 0), 0) / total).toFixed(2))
    : 0
  const avgNodeLatency = total > 0
    ? Number((reportItems.reduce((sum, item) => sum + Number(item?.node_fallback?.elapsed_ms || 0), 0) / total).toFixed(2))
    : 0

  return {
    total,
    passed,
    failed,
    alert_count: alertCount,
    avg_python_latency_ms: avgPythonLatency,
    avg_node_latency_ms: avgNodeLatency,
    all_passed: failed === 0
  }
}

async function main() {
  const args = parseArgs()
  await checkBaseHealth(args.base, args.timeoutMs)

  const caseTypes = ['graph_reasoning', 'region_comparison']
  const runs = []

  for (const caseType of caseTypes) {
    for (let sampleIndex = 0; sampleIndex < args.samples; sampleIndex += 1) {
      const basePayload = buildCasePayload(caseType, sampleIndex)

      const pythonRun = await executePlan(
        args.base,
        {
          ...basePayload,
          options: {
            ...(basePayload.options || {}),
            forceNodeFallback: false
          }
        },
        args.timeoutMs
      )

      await waitTimeout(50)

      const nodeRun = await executePlan(
        args.base,
        {
          ...basePayload,
          options: {
            ...(basePayload.options || {}),
            forceNodeFallback: true
          }
        },
        args.timeoutMs
      )

      runs.push(buildRunSummary(caseType, sampleIndex, pythonRun, nodeRun, args.minPoiOverlap))
    }
  }

  const report = {
    checked_at: new Date().toISOString(),
    base_url: args.base,
    samples_per_case: args.samples,
    threshold: {
      min_poi_overlap: args.minPoiOverlap
    },
    summary: summarize(runs),
    runs
  }

  const outPath = path.resolve(process.cwd(), args.out)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (!report.summary.all_passed) {
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(`[dual_run_parity_check] ${error.message}`)
  process.exitCode = 1
})
