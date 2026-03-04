import test from 'node:test'
import assert from 'node:assert/strict'

import { createRAGSession } from '../services/ragLogger.js'

test('ingestExecutionStats updates PostGIS flag and token breakdown from stats', () => {
  const session = createRAGSession()

  session.log('Pipeline', 'StageChecklist', [
    { key: 'ocr', label: 'OCR 文本提取', ok: true, model: 'glm-ocr' },
    { key: 'writer', label: 'Writer 结果整合', ok: false, fallback_used: true, fallback_reason: 'empty_writer_output' }
  ])

  session.ingestExecutionStats(
    {
      candidate_source: 'db',
      token_usage: {
        planner: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        writer: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 }
      }
    },
    {
      compute_mode: 'python_primary'
    }
  )

  assert.equal(session.summary.postgisCalled, true)
  assert.equal(session.summary.vectorCalled, false)
  assert.equal(session.summary.tokenStats.total, 150)
  assert.equal(session.summary.tokenStats.planner, 20)
  assert.equal(session.summary.tokenStats.writer, 130)

  const markdown = session.generateMarkdownLog()
  assert.ok(markdown.includes('| OCR 文本提取 | PASS |'))
  assert.ok(markdown.includes('| Writer 结果整合 | FAIL |') || markdown.includes('| Writer 结果整合 | WARN |'))
  assert.ok(markdown.includes('- Retrieval mode: postgis_only'))
  assert.ok(markdown.includes('- Vector used: no (postgis_only)'))
  assert.ok(markdown.includes('- PostGIS used: yes'))
  assert.ok(markdown.includes('- Token breakdown: total=150, planner=20, writer=130'))
})

test('ingestExecutionStats accepts diagnostic token usage and coerces numeric strings', () => {
  const session = createRAGSession()

  session.ingestExecutionStats(
    {},
    {
      planner: {
        token_usage: { prompt_tokens: '4', completion_tokens: '5', total_tokens: '9' }
      },
      writer: {
        token_usage: { prompt_tokens: '6', completion_tokens: '8' }
      }
    }
  )

  assert.equal(session.summary.tokenStats.total, 23)
  assert.equal(session.summary.tokenStats.planner, 9)
  assert.equal(session.summary.tokenStats.writer, 14)
  assert.equal(session.summary.tokenStats.details.length, 2)
})

test('setFinalPOIs maps category from category_small/mid/big and type fields', () => {
  const session = createRAGSession()

  session.setFinalPOIs([
    {
      name: 'POI-A',
      category_small: '教育培训',
      distance_m: 18
    },
    {
      properties: {
        name: 'POI-B',
        category_mid: '餐饮服务'
      }
    },
    {
      properties: {
        name: 'POI-C'
      },
      type: '交通设施'
    }
  ])

  assert.equal(session.finalPOIs[0].category, '教育培训')
  assert.equal(session.finalPOIs[0].distance, 18)
  assert.equal(session.finalPOIs[1].category, '餐饮服务')
  assert.equal(session.finalPOIs[2].category, '交通设施')
})

test('ingestExecutionStats marks vector usage when vector_retrieval is used', () => {
  const session = createRAGSession()

  session.ingestExecutionStats(
    {
      candidate_source: 'payload',
      py_data_source: 'hybrid',
      vector_used: true
    },
    {
      compute_mode: 'python_primary',
      vector_retrieval: {
        used: true,
        candidate_count: 320
      }
    }
  )

  assert.equal(session.summary.vectorCalled, true)
  assert.equal(session.summary.postgisCalled, true)
})
