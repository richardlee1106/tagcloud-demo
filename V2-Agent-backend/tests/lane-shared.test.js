import test from 'node:test'
import assert from 'node:assert/strict'

import { processDeepLane } from '../src/orchestrator/lane-shared.js'

function createMachine() {
  return {
    state: 'S3_FAST_DONE',
    transition(next) {
      this.state = next
      return this.state
    }
  }
}

test('persists snapshot and skips deep lane when allowDeep is false', async () => {
  const persisted = []
  const emitted = []

  await processDeepLane({
    allowDeep: false,
    asyncDeep: false,
    machine: createMachine(),
    traceId: 'trace-1',
    jobId: 'job-1',
    routingOutput: { objective: 'area_briefing' },
    executionPath: 'new_agent',
    objectiveContract: {},
    fastResult: { result_version: 1 },
    eventBuffer: {
      emit(event, payload) {
        emitted.push({ event, payload })
      }
    },
    buildDeepAccepted() {
      throw new Error('should_not_be_called')
    },
    persistSnapshot(snapshot) {
      persisted.push(snapshot)
      return Promise.resolve()
    },
    enqueueDeepLane(task) {
      return task()
    },
    runDeepLane() {
      throw new Error('should_not_be_called')
    },
    handleDeepLaneError() {
      throw new Error('should_not_be_called')
    }
  })

  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].deepPartial, null)
  assert.equal(persisted[0].deepFinal, null)
  assert.equal(emitted.length, 0)
})

test('runs sync deep lane and emits accepted/patch/final events', async () => {
  const emitted = []

  await processDeepLane({
    allowDeep: true,
    asyncDeep: false,
    machine: createMachine(),
    traceId: 'trace-2',
    jobId: 'job-2',
    routingOutput: { objective: 'area_briefing' },
    executionPath: 'new_agent',
    objectiveContract: {},
    fastResult: { result_version: 1 },
    eventBuffer: {
      emit(event, payload) {
        emitted.push({ event, payload })
      }
    },
    buildDeepAccepted({ objective }) {
      return { objective, result_type: 'deep_patch' }
    },
    persistSnapshot() {
      return Promise.resolve()
    },
    enqueueDeepLane(task) {
      return task()
    },
    async runDeepLane() {
      return {
        deepPartial: { result_type: 'deep_patch' },
        deepFinal: { result_type: 'deep_final' }
      }
    },
    handleDeepLaneError() {
      throw new Error('should_not_be_called')
    }
  })

  assert.deepEqual(emitted.map((entry) => entry.event), ['deep.accepted', 'deep.patch', 'deep.final'])
})

test('queues async deep lane and delegates errors to handler', async () => {
  const emitted = []
  const persisted = []
  const errors = []

  await processDeepLane({
    allowDeep: true,
    asyncDeep: true,
    machine: createMachine(),
    traceId: 'trace-3',
    jobId: 'job-3',
    routingOutput: { objective: 'area_briefing' },
    executionPath: 'new_agent',
    objectiveContract: {},
    fastResult: { result_version: 1 },
    eventBuffer: {
      emit(event, payload) {
        emitted.push({ event, payload })
      }
    },
    buildDeepAccepted() {
      return { result_type: 'deep_patch' }
    },
    persistSnapshot(snapshot) {
      persisted.push(snapshot)
      return Promise.resolve()
    },
    async enqueueDeepLane(task) {
      await task()
    },
    async runDeepLane() {
      throw new Error('boom')
    },
    async handleDeepLaneError(error) {
      errors.push(error.message)
    }
  })

  assert.deepEqual(emitted.map((entry) => entry.event), ['deep.accepted'])
  assert.equal(persisted.length, 1)
  assert.deepEqual(errors, ['boom'])
})
