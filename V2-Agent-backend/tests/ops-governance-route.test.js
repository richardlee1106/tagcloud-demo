import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createApp } from '../src/app.js'

test('exposes quota and audit retention governance endpoints', async () => {
  const app = await createApp({
    baseDir: await mkdtemp(path.join(tmpdir(), 'v2-ops-governance-'))
  })

  try {
    const quotaResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/quota?tenant_id=tenant-a&user_id=user-a'
    })
    assert.equal(quotaResponse.statusCode, 200)
    const quotaPayload = quotaResponse.json()
    assert.equal(quotaPayload.schema_version, 'contract.v2.0')
    assert.equal(quotaPayload.quota.tenant_id, 'tenant-a')
    assert.equal(quotaPayload.quota.user_id, 'user-a')

    const retentionResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/ops/audit-retention'
    })
    assert.equal(retentionResponse.statusCode, 200)
    const retentionPayload = retentionResponse.json()
    assert.equal(retentionPayload.schema_version, 'contract.v2.0')
    assert.equal(typeof retentionPayload.retention.retention_days, 'number')

    const pruneResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/ops/audit-retention/prune'
    })
    assert.equal(pruneResponse.statusCode, 200)
    const prunePayload = pruneResponse.json()
    assert.equal(prunePayload.schema_version, 'contract.v2.0')
    assert.equal(typeof prunePayload.result.kept, 'number')
  } finally {
    await app.close()
  }
})
