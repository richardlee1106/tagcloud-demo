import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createApp } from '../src/app.js'

test('rejects analysis requests when quota governor denies the request', async () => {
  const app = await createApp({
    baseDir: await mkdtemp(path.join(tmpdir(), 'v2-analysis-quota-'))
  })

  const originalConsume = app.quotaGovernor.consume
  app.quotaGovernor.consume = async () => ({
    allowed: false,
    tenant_id: 'tenant-blocked',
    user_id: 'user-blocked',
    tenant_limit: 1,
    user_limit: 1,
    tenant_used: 1,
    user_used: 1,
    tenant_remaining: 0,
    user_remaining: 0
  })

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/analysis',
      payload: {
        session_id: 'session-quota',
        query: 'Give me a 30s briefing of this area.',
        viewport: {
          zoom: 15,
          bbox: [114.30, 30.52, 114.36, 30.57]
        }
      }
    })

    assert.equal(response.statusCode, 429)
    const payload = response.json()
    assert.equal(payload.error, 'QUOTA_EXCEEDED')
    assert.equal(payload.quota.user_remaining, 0)
  } finally {
    app.quotaGovernor.consume = originalConsume
    await app.close()
  }
})
