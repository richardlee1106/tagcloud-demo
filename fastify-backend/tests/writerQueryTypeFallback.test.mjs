import test from 'node:test'
import assert from 'node:assert/strict'

import { generateAnswer } from '../routes/ai/writer.js'

function buildStreamResponse(chunks = []) {
  const encoder = new TextEncoder()
  const encoded = chunks.map((chunk) => encoder.encode(chunk))
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

test('generateAnswer diagnostics keeps area_analysis query_type when query_executed is missing', async () => {
  const originalFetch = global.fetch
  let diagnostics = null

  global.fetch = async (url, options = {}) => {
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
        'data: {"choices":[{"delta":{"content":"analysis output"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    }

    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: 'analysis output' } }]
        }
      }
    }
  }

  try {
    let output = ''
    for await (const chunk of generateAnswer(
      'summarize this area',
      {
        results: {
          stats: { query_type: 'area_analysis' },
          pois: [{ name: 'POI-A', category: 'education' }]
        }
      },
      {
        onWriterDiagnostics(payload) {
          diagnostics = payload
        }
      }
    )) {
      output += chunk
    }

    assert.ok(output.length > 0)
    assert.equal(diagnostics?.query_type, 'area_analysis')
  } finally {
    global.fetch = originalFetch
  }
})

