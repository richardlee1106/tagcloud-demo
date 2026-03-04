import test from 'node:test'
import assert from 'node:assert/strict'

import { generateAnswer } from '../routes/ai/writer.js'

function buildStreamResponse(chunks = []) {
  const encoder = new TextEncoder()
  const encoded = chunks.map((item) => encoder.encode(item))
  let index = 0
  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= encoded.length) {
              return { done: true, value: undefined }
            }
            const value = encoded[index]
            index += 1
            return { done: false, value }
          }
        }
      }
    }
  }
}

test('generateAnswer recovers with non-stream fallback when stream yields no visible content', async () => {
  const originalFetch = global.fetch
  let callCount = 0

  global.fetch = async (url, options = {}) => {
    callCount += 1

    if (String(url).includes('/models')) {
      return {
        ok: true,
        async json() {
          return { data: [{ id: 'qwen3.5-2b' }] }
        }
      }
    }

    const body = options?.body ? JSON.parse(options.body) : {}
    if (body.stream === true) {
      return buildStreamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"<think>internal reasoning</think>"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    }

    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: '恢复后的最终答案'
              }
            }
          ]
        }
      }
    }
  }

  try {
    let output = ''
    for await (const chunk of generateAnswer(
      '请给出核心结论',
      {
        results: {
          query_executed: { query_type: 'area_analysis' },
          pois: [{ name: 'A', category: '教育' }],
          stats: {}
        }
      },
      {}
    )) {
      output += chunk
    }

    assert.ok(callCount >= 2)
    assert.equal(output.includes('<think>'), false)
    assert.match(output, /恢复后的最终答案/)
  } finally {
    global.fetch = originalFetch
  }
})

test('generateAnswer drops non-stream reasoning transcript fallback', async () => {
  const originalFetch = global.fetch
  let callCount = 0

  global.fetch = async (url, options = {}) => {
    callCount += 1

    if (String(url).includes('/models')) {
      return {
        ok: true,
        async json() {
          return { data: [{ id: 'qwen3.5-2b' }] }
        }
      }
    }

    const body = options?.body ? JSON.parse(options.body) : {}
    if (body.stream === true) {
      return buildStreamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"internal reasoning"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    }

    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: [
                  'Thinking Process:',
                  '1. **Analyze the Request:**',
                  '2. **Evaluate Data & Constraints:**',
                  '3. **Drafting Content:**',
                  '4. **Final Polish:**'
                ].join('\n')
              }
            }
          ]
        }
      }
    }
  }

  try {
    let output = ''
    for await (const chunk of generateAnswer(
      '请给出核心结论',
      {
        results: {
          query_executed: { query_type: 'area_analysis' },
          pois: [{ name: 'A', category: '教育' }],
          stats: {}
        }
      },
      {}
    )) {
      output += chunk
    }

    assert.ok(callCount >= 2)
    assert.equal(output.includes('Thinking Process'), false)
    assert.equal(output.includes('Analyze the Request'), false)
    assert.equal(output.trim(), '')
  } finally {
    global.fetch = originalFetch
  }
})

