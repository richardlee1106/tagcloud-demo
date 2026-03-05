import test from 'node:test'
import assert from 'node:assert/strict'

import { buildWriterQualityStats } from '../services/spatialJobRunner.js'

test('buildWriterQualityStats extracts hallucination and markdown contract flags', () => {
  const stats = buildWriterQualityStats({
    hallucination: {
      hasHallucination: true,
      hallucinations: ['A', 'B']
    },
    markdown_contract: {
      normalized: true
    }
  })

  assert.equal(stats.writer_hallucination, true)
  assert.equal(stats.writer_hallucination_count, 2)
  assert.equal(stats.writer_markdown_contract_normalized, true)
})

test('buildWriterQualityStats defaults to safe falsey values', () => {
  const stats = buildWriterQualityStats(null)
  assert.equal(stats.writer_hallucination, false)
  assert.equal(stats.writer_hallucination_count, 0)
  assert.equal(stats.writer_markdown_contract_normalized, false)
})

