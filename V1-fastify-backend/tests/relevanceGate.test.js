import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasGeoHintKeyword,
  shouldHardBlockInput
} from '../services/relevanceGate.js'

test('hard-blocks obvious noise inputs', () => {
  const samples = [
    '0000000000',
    'asdasd',
    'abc123',
    '......',
    '!!!!!!!!!!!!'
  ]

  for (const sample of samples) {
    assert.equal(
      shouldHardBlockInput(sample),
      true,
      `expected hard block for "${sample}"`
    )
  }
})

test('keeps geospatial questions allowed', () => {
  const samples = [
    '\u9644\u8fd1\u5496\u5561\u5e97',
    '\u8bf7\u5206\u6790\u8fd9\u4e2a\u533a\u57df\u7684\u5546\u4e1a\u5206\u5e03',
    'find nearby parks within 2km',
    'map the poi density for this district'
  ]

  for (const sample of samples) {
    assert.equal(
      shouldHardBlockInput(sample),
      false,
      `expected pass-through for "${sample}"`
    )
    assert.equal(
      hasGeoHintKeyword(sample),
      true,
      `expected geo keyword hint for "${sample}"`
    )
  }
})
