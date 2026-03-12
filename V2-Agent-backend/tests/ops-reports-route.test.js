import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createApp } from '../src/app.js'

test('exposes latest summary report and release markdown from real report files', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'v2-ops-reports-'))
  const summaryDir = path.join(baseDir, 'reports', 'summary')
  await mkdir(summaryDir, { recursive: true })

  const payload = {
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

  await writeFile(path.join(summaryDir, 'live-summary-2026-03-11T00-00-00-000Z.json'), JSON.stringify(payload), 'utf8')

  const app = await createApp({ baseDir })

  try {
    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/latest-summary-report'
    })
    assert.equal(summaryResponse.statusCode, 200)
    const summaryPayload = summaryResponse.json()
    assert.equal(summaryPayload.report.generated_at, '2026-03-11T00:00:00.000Z')

    const historyResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/summary-report-history'
    })
    assert.equal(historyResponse.statusCode, 200)
    const historyPayload = historyResponse.json()
    assert.equal(Array.isArray(historyPayload.items), true)
    assert.equal(historyPayload.items[0].file_name, 'live-summary-2026-03-11T00-00-00-000Z.json')

    const summaryByFileResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/summary-report?file_name=live-summary-2026-03-11T00-00-00-000Z.json'
    })
    assert.equal(summaryByFileResponse.statusCode, 200)
    const summaryByFilePayload = summaryByFileResponse.json()
    assert.equal(summaryByFilePayload.file_name, 'live-summary-2026-03-11T00-00-00-000Z.json')

    const releaseResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/latest-release-markdown'
    })
    assert.equal(releaseResponse.statusCode, 200)
    const releasePayload = releaseResponse.json()
    assert.equal(releasePayload.markdown.includes('# V2 Release Summary'), true)

    const releaseByFileResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/release-markdown?file_name=live-summary-2026-03-11T00-00-00-000Z.json'
    })
    assert.equal(releaseByFileResponse.statusCode, 200)
    const releaseByFilePayload = releaseByFileResponse.json()
    assert.equal(releaseByFilePayload.file_name, 'live-summary-2026-03-11T00-00-00-000Z.json')
  } finally {
    await app.close()
  }
})
