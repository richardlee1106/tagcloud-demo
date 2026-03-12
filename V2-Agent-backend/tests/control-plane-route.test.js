import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createApp } from '../src/app.js'

test('exposes control-plane snapshot with persistence cache queue and subscribers', async () => {
  const app = await createApp({
    baseDir: await mkdtemp(path.join(tmpdir(), 'v2-control-plane-')),
    jobStateStoreOverrides: {
      redisClient: {
        async ping() {
          return 'PONG'
        }
      },
      pgPool: {
        options: {
          max: 4,
          min: 1
        },
        async query(query) {
          const sql = String(query?.text || query)
          if (sql.includes('SELECT 1')) {
            return { rows: [{ ok: 1 }] }
          }
          return { rows: [], rowCount: 1 }
        }
      }
    }
  })

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/control-plane'
    })

    assert.equal(response.statusCode, 200)
    const payload = response.json()

    assert.equal(payload.schema_version, 'contract.v2.0')
    assert.equal(typeof payload.persistence.ok, 'boolean')
    assert.equal(typeof payload.cache.l1.sessions, 'number')
    assert.equal(typeof payload.deep_lane.mode, 'string')
    assert.equal(Array.isArray(payload.subscribers), true)
    assert.equal(typeof payload.metrics.counters, 'object')
  } finally {
    await app.close()
  }
})
