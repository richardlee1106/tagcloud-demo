import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeMarkdownStructure,
  validateWriterOutput
} from '../routes/ai/writer.js'

test('normalizeMarkdownStructure repairs illegal mixed heading markers', () => {
  const malformed = [
    '###**1. 主导业态***',
    '正文描述',
    '',
    '***2. 机会建议***',
    '- 建议 A'
  ].join('\n')

  const repaired = normalizeMarkdownStructure(malformed)

  assert.equal(/###\*\*/.test(repaired), false)
  assert.equal(/\*\*\*2\./.test(repaired), false)
  assert.match(repaired, /^###\s+/m)
})

test('validateWriterOutput enforces markdown contract when enabled', () => {
  const malformed = [
    '###**1. 主导业态***',
    '',
    '***结论***：该区域绝对主力是充电宝。'
  ].join('\n')

  const validation = validateWriterOutput(
    malformed,
    {
      results: {
        pois: []
      }
    },
    {
      autoClean: false,
      addWarning: false,
      enforceMarkdownContract: true
    }
  )

  assert.equal(/###\*\*/.test(validation.cleanedOutput), false)
  assert.equal(/\*\*\*结论/.test(validation.cleanedOutput), false)
  assert.equal(validation.markdownContract?.normalized, true)
})

