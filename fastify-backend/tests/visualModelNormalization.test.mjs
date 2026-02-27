import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeVisualModelName } from '../services/spatialJobRunner.js'

test('normalizeVisualModelName upgrades legacy visual model alias', () => {
  assert.equal(normalizeVisualModelName('qwen3-vl-4b'), 'qwen/qwen3-vl-4b')
})

test('normalizeVisualModelName falls back to env model and upgrades legacy alias', () => {
  const envBackup = {
    LOCAL_VISUAL_MODEL: process.env.LOCAL_VISUAL_MODEL,
    LOCAL_VLM_MODEL: process.env.LOCAL_VLM_MODEL,
    LOCAL_LLM_MODEL: process.env.LOCAL_LLM_MODEL,
    LLM_MODEL: process.env.LLM_MODEL
  }

  process.env.LOCAL_VISUAL_MODEL = ''
  process.env.LOCAL_VLM_MODEL = 'qwen3-vl-4b'
  process.env.LOCAL_LLM_MODEL = ''
  process.env.LLM_MODEL = ''

  try {
    assert.equal(normalizeVisualModelName(''), 'qwen/qwen3-vl-4b')
  } finally {
    if (envBackup.LOCAL_VISUAL_MODEL === undefined) delete process.env.LOCAL_VISUAL_MODEL
    else process.env.LOCAL_VISUAL_MODEL = envBackup.LOCAL_VISUAL_MODEL

    if (envBackup.LOCAL_VLM_MODEL === undefined) delete process.env.LOCAL_VLM_MODEL
    else process.env.LOCAL_VLM_MODEL = envBackup.LOCAL_VLM_MODEL

    if (envBackup.LOCAL_LLM_MODEL === undefined) delete process.env.LOCAL_LLM_MODEL
    else process.env.LOCAL_LLM_MODEL = envBackup.LOCAL_LLM_MODEL

    if (envBackup.LLM_MODEL === undefined) delete process.env.LLM_MODEL
    else process.env.LLM_MODEL = envBackup.LLM_MODEL
  }
})
