import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldGenerateWriterText } from '../services/spatialJobRunner.js'

test('shouldGenerateWriterText defaults to true when not explicitly disabled', () => {
  assert.equal(shouldGenerateWriterText({}, {}), true)
})

test('shouldGenerateWriterText returns false when need_text_answer is false', () => {
  assert.equal(
    shouldGenerateWriterText({
      need_text_answer: false
    }, {}),
    false
  )
})

test('shouldGenerateWriterText returns false when output_contract.include_writer_text is false', () => {
  assert.equal(
    shouldGenerateWriterText({
      output_contract: {
        include_writer_text: false
      }
    }, {}),
    false
  )
})
