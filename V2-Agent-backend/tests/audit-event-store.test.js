import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createAuditEventStore } from '../src/observability/audit-event-store.js'

test('appends and queries persisted audit events by trace and job', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'v2-audit-store-'))
  const store = createAuditEventStore({ baseDir })

  await store.append({
    kind: 'request',
    event: 'analysis.request.received',
    trace_id: 'trace-a',
    job_id: 'job-a',
    session_id: 'session-a',
    payload: { query: 'q1' }
  })
  await store.append({
    kind: 'sse_event',
    event: 'fast.result',
    trace_id: 'trace-a',
    job_id: 'job-a',
    session_id: 'session-a',
    payload: { state: 'S3_FAST_DONE' }
  })
  await store.append({
    kind: 'request',
    event: 'analysis.request.received',
    trace_id: 'trace-b',
    job_id: 'job-b',
    session_id: 'session-b',
    payload: { query: 'q2' }
  })

  const byTrace = await store.query({ trace_id: 'trace-a', limit: 10 })
  assert.equal(byTrace.total, 2)
  assert.equal(byTrace.items.every((entry) => entry.trace_id === 'trace-a'), true)

  const byJob = await store.query({ job_id: 'job-b', limit: 10 })
  assert.equal(byJob.total, 1)
  assert.equal(byJob.items[0].job_id, 'job-b')
})

test('prunes expired audit events into archive file according to retention policy', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'v2-audit-prune-'))
  const store = createAuditEventStore({
    baseDir,
    retentionDays: 1,
    maxEvents: 2
  })

  await store.append({
    ts: '2020-01-01T00:00:00.000Z',
    kind: 'request',
    event: 'old.event',
    payload: {}
  })
  await store.append({
    ts: new Date().toISOString(),
    kind: 'request',
    event: 'recent.one',
    payload: {}
  })
  await store.append({
    ts: new Date().toISOString(),
    kind: 'request',
    event: 'recent.two',
    payload: {}
  })
  await store.append({
    ts: new Date().toISOString(),
    kind: 'request',
    event: 'recent.three',
    payload: {}
  })

  const result = await store.prune()
  assert.equal(result.pruned >= 1, true)
  assert.equal(typeof result.archived_to === 'string' || result.archived_to === null, true)

  const remaining = await store.query({ limit: 10 })
  assert.equal(remaining.total, 2)
})
