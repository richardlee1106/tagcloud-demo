import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { createEventBuffer } from '../src/orchestrator/analysis-events.js'

test('captures emitted events and fans out to event bus listeners', () => {
  const bus = new EventEmitter()
  const seen = []
  const analysisEntries = []
  const buffer = createEventBuffer((entry) => {
    seen.push(entry.event)
  }, bus)

  bus.on('analysis.event', (entry) => {
    analysisEntries.push(entry.event)
  })

  buffer.emit('fast.result', { ok: true })
  buffer.emit('deep.final', { ok: true })

  assert.deepEqual(seen, ['fast.result', 'deep.final'])
  assert.deepEqual(analysisEntries, ['fast.result', 'deep.final'])
  assert.equal(buffer.events.length, 2)
})
