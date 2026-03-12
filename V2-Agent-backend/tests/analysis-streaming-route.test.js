import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'

import { analysisRoutes } from '../src/routes/analysis.js'

function createDeferred() {
  let resolve
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}

test('streams fast.result before the analysis promise finishes', async () => {
  const deepGate = createDeferred()
  const app = Fastify({ logger: false })

  app.decorate('analysisService', {
    async analyze({ onEvent }) {
      assert.equal(typeof onEvent, 'function')

      onEvent({
        event: 'fast.result',
        data: {
          schema_version: 'contract.v2.0',
          trace_id: 'trace-stream',
          job_id: 'job-stream',
          result_type: 'fast_initial',
          state: 'S3_FAST_DONE',
          summary: {
            text: 'Fast response is ready.'
          }
        }
      })

      await deepGate.promise

      onEvent({
        event: 'deep.final',
        data: {
          schema_version: 'contract.v2.0',
          trace_id: 'trace-stream',
          job_id: 'job-stream',
          result_type: 'deep_final',
          state: 'S7_DEEP_DONE',
          completion_summary: 'Deep response is ready.'
        }
      })

      return {
        jobId: 'job-stream',
        traceId: 'trace-stream',
        events: []
      }
    },
    async getJob() {
      return null
    }
  })

  await app.register(analysisRoutes)

  try {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : null
    assert.equal(typeof port, 'number')

    const response = await fetch(`http://127.0.0.1:${port}/api/v2/analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: 'session-stream',
        query: 'Stream this analysis',
        viewport: {
          bbox: [114.30, 30.52, 114.36, 30.57],
          zoom: 15
        }
      })
    })

    assert.equal(response.status, 200)
    assert.match(String(response.headers.get('content-type') || ''), /text\/event-stream/)

    const reader = response.body.getReader()
    const firstChunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('timed_out_waiting_for_fast_result'))
        }, 100)
      })
    ])

    assert.equal(firstChunk.done, false)
    const firstText = new TextDecoder().decode(firstChunk.value)
    assert.match(firstText, /event: fast\.result/)
    assert.match(firstText, /Fast response is ready/)

    deepGate.resolve()

    let remainder = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      remainder += new TextDecoder().decode(chunk.value)
    }

    assert.match(remainder, /event: deep\.final/)
    assert.match(remainder, /Deep response is ready/)
  } finally {
    deepGate.resolve()
    await app.close()
  }
})
