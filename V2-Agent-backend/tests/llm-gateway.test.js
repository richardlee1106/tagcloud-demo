import test from 'node:test'
import assert from 'node:assert/strict'

import { createLlmGateway } from '../src/llm/llm-gateway.js'

test('returns structured degradation metadata when local llm fails and no cloud fallback is configured', async () => {
  const gateway = createLlmGateway({
    enabled: true,
    localApiKey: '',
    cloudApiKey: '',
    fetchImpl: async () => {
      throw new Error('local_llm_down')
    }
  })

  const response = await gateway.chat({
    systemPrompt: 'system',
    userPrompt: 'user'
  })

  assert.equal(response.text, '')
  assert.equal(response.degraded, true)
  assert.equal(response.error.code, 'llm_local_unavailable')
  assert.equal(response.error.provider, 'local')
})

test('falls back to cloud llm and keeps the failure metadata from the local attempt', async () => {
  let calls = 0
  const gateway = createLlmGateway({
    enabled: true,
    localApiKey: '',
    cloudApiKey: 'cloud-key',
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) {
        throw new Error('local_timeout')
      }

      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: 'cloud answer'
                }
              }
            ]
          }
        }
      }
    }
  })

  const response = await gateway.chat({
    systemPrompt: 'system',
    userPrompt: 'user'
  })

  assert.equal(response.text, 'cloud answer')
  assert.equal(response.provider, 'cloud')
  assert.equal(Array.isArray(response.warnings), true)
  assert.equal(response.warnings[0].code, 'llm_local_unavailable')
})
