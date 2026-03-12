import test from 'node:test'
import assert from 'node:assert/strict'

import { createDeepLaneScheduler } from '../src/runtime/deep-lane-scheduler.js'

test('runs deep lane tasks in memory when no persistent driver is available', async () => {
  const calls = []
  const scheduler = createDeepLaneScheduler({
    concurrency: 1
  })

  await scheduler.schedule(async () => {
    calls.push('ran')
  })

  assert.deepEqual(calls, ['ran'])
  assert.equal(scheduler.snapshot().mode, 'memory')
  await scheduler.close()
})

test('enqueues descriptor-backed tasks into persistent driver when available', async () => {
  const enqueued = []
  const scheduler = createDeepLaneScheduler({
    concurrency: 1,
    persistentDriver: {
      async setProcessor() {},
      async enqueue(descriptor) {
        enqueued.push(descriptor)
        return { queued: true, queue_job_id: '1' }
      },
      async close() {}
    }
  })

  await scheduler.setProcessor(async () => {})

  const task = async () => {
    throw new Error('local_runner_should_not_execute')
  }
  task.deepLaneDescriptor = {
    kind: 'structured',
    job_id: 'job-1'
  }

  const result = await scheduler.schedule(task)

  assert.equal(result.queued, true)
  assert.deepEqual(enqueued, [{ kind: 'structured', job_id: 'job-1' }])
  assert.equal(scheduler.snapshot().mode, 'persistent')
  await scheduler.close()
})
