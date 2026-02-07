#!/usr/bin/env node

/**
 * Migration rollout check utility.
 *
 * It validates policy sampling behavior for a target rollout percent and
 * emits a compact JSON report for commit-time evidence.
 */
import fs from 'fs'
import path from 'path'

import { resolveSpatialMigrationDecision } from '../services/migrationPolicy.js'

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    percent: 100,
    samples: 400,
    out: ''
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if ((token === '--percent' || token === '-p') && argv[i + 1]) {
      args.percent = Number(argv[i + 1])
      i += 1
    } else if ((token === '--samples' || token === '-n') && argv[i + 1]) {
      args.samples = Number(argv[i + 1])
      i += 1
    } else if ((token === '--out' || token === '-o') && argv[i + 1]) {
      args.out = String(argv[i + 1])
      i += 1
    }
  }

  if (!Number.isFinite(args.percent) || args.percent < 0 || args.percent > 100) {
    throw new Error(`invalid percent: ${args.percent}`)
  }

  if (!Number.isFinite(args.samples) || args.samples <= 0) {
    throw new Error(`invalid samples: ${args.samples}`)
  }

  args.percent = Math.floor(args.percent)
  args.samples = Math.floor(args.samples)
  return args
}

function expectRange(percent) {
  if (percent <= 0) return [0, 1]
  if (percent >= 100) return [99, 100]

  const margin = Math.max(3, Math.round(percent * 0.18))
  return [Math.max(0, percent - margin), Math.min(100, percent + margin)]
}

function evaluatePercent(percent, samples) {
  const queryTypes = [
    'poi_search',
    'area_analysis',
    'fuzzy_regions',
    'graph_reasoning',
    'region_comparison'
  ]

  const env = {
    ...process.env,
    SPATIAL_MIGRATE_ENABLED: 'true',
    SPATIAL_MIGRATE_PERCENT: String(percent),
    SPATIAL_MIGRATE_QUERY_TYPES: queryTypes.join(','),
    SPATIAL_PY_DATA_SOURCE: 'python',
    SPATIAL_FORCE_NODE_FALLBACK: 'false',
    SPATIAL_DUAL_RUN: 'false',
    SPATIAL_DUAL_RUN_SAMPLE: '0'
  }

  const [low, high] = expectRange(percent)
  const byQueryType = []
  let allWithinExpected = true

  for (const queryType of queryTypes) {
    let pythonPrimary = 0

    for (let i = 0; i < samples; i += 1) {
      const requestId = `rollout:${queryType}:${i}`
      const decision = resolveSpatialMigrationDecision({
        requestId,
        queryPlan: { query_type: queryType },
        options: {},
        env
      })

      if (decision.use_python_primary) {
        pythonPrimary += 1
      }
    }

    const ratio = Number(((pythonPrimary / samples) * 100).toFixed(2))
    const withinExpected = ratio >= low && ratio <= high
    if (!withinExpected) {
      allWithinExpected = false
    }

    byQueryType.push({
      query_type: queryType,
      python_primary_count: pythonPrimary,
      samples,
      python_ratio_percent: ratio,
      expected_range_percent: [low, high],
      within_expected: withinExpected
    })
  }

  return {
    percent,
    samples,
    expected_range_percent: [low, high],
    all_within_expected: allWithinExpected,
    checked_at: new Date().toISOString(),
    by_query_type: byQueryType
  }
}

function main() {
  const args = parseArgs()
  const report = evaluatePercent(args.percent, args.samples)

  const pretty = `${JSON.stringify(report, null, 2)}
`

  if (args.out) {
    const outPath = path.resolve(process.cwd(), args.out)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, pretty, 'utf-8')
  }

  process.stdout.write(pretty)

  if (!report.all_within_expected) {
    process.exitCode = 2
  }
}

main()
