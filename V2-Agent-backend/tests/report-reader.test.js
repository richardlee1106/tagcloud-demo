import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  listSummaryReports,
  readLatestReleaseMarkdown,
  readLatestSummaryReport,
  readReleaseMarkdownByFileName,
  readSummaryReportByFileName
} from '../src/ops/report-reader.js'

test('reads latest summary report and renders markdown from summary payload', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'v2-report-reader-'))
  const summaryDir = path.join(baseDir, 'reports', 'summary')
  await mkdir(summaryDir, { recursive: true })

  const olderPayload = {
    generated_at: '2026-03-10T00:00:00.000Z',
    summary: { summary: { comparison_available: false } }
  }
  const latestPayload = {
    generated_at: '2026-03-11T00:00:00.000Z',
    summary: {
      summary: {
        comparison_available: true,
        v2_completion_advantage: true,
        persistence_ok: true,
        event_quality_ok: true,
        performance_baseline_ok: true,
        routing_eval_ok: true,
        no_data_eval_ok: true
      }
    },
    comparison: {},
    benchmark: {},
    performance_baseline: { status: { overall_ok: true } },
    routing_evaluation: { summary: { accuracy: 1 } },
    no_data_evaluation: { summary: { accuracy: 1 } },
    persistence: { redis: { latency_ms: 1 }, postgres: { latency_ms: 2 } }
  }

  await writeFile(path.join(summaryDir, 'live-summary-2026-03-10T00-00-00-000Z.json'), JSON.stringify(olderPayload), 'utf8')
  await writeFile(path.join(summaryDir, 'live-summary-2026-03-11T00-00-00-000Z.json'), JSON.stringify(latestPayload), 'utf8')

  const latestSummary = await readLatestSummaryReport(baseDir)
  assert.equal(latestSummary.file_name, 'live-summary-2026-03-11T00-00-00-000Z.json')
  assert.equal(latestSummary.payload.generated_at, '2026-03-11T00:00:00.000Z')

  const history = await listSummaryReports(baseDir, { limit: 10 })
  assert.equal(history.total, 2)
  assert.equal(history.items[0].file_name, 'live-summary-2026-03-11T00-00-00-000Z.json')

  const reportByFile = await readSummaryReportByFileName(baseDir, 'live-summary-2026-03-10T00-00-00-000Z.json')
  assert.equal(reportByFile.payload.generated_at, '2026-03-10T00:00:00.000Z')

  const releaseMarkdown = await readLatestReleaseMarkdown(baseDir)
  assert.equal(releaseMarkdown.file_name, undefined)
  assert.equal(releaseMarkdown.source_file_name, 'live-summary-2026-03-11T00-00-00-000Z.json')
  assert.equal(releaseMarkdown.markdown.includes('# V2 Release Summary'), true)

  const releaseMarkdownByFile = await readReleaseMarkdownByFileName(baseDir, 'live-summary-2026-03-10T00-00-00-000Z.json')
  assert.equal(releaseMarkdownByFile.source_file_name, 'live-summary-2026-03-10T00-00-00-000Z.json')
})
