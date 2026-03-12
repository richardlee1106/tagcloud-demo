import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createQuotaGovernor } from '../src/runtime/quota-governor.js'

test('consumes quota and blocks when tenant or user exceeds daily limit', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'v2-quota-governor-'))
  const governor = createQuotaGovernor({
    baseDir,
    tenantDailyLimit: 3,
    userDailyLimit: 2
  })

  const first = await governor.consume({
    tenantId: 'tenant-a',
    userId: 'user-a'
  })
  const second = await governor.consume({
    tenantId: 'tenant-a',
    userId: 'user-a'
  })
  const third = await governor.consume({
    tenantId: 'tenant-a',
    userId: 'user-a'
  })

  assert.equal(first.allowed, true)
  assert.equal(second.allowed, true)
  assert.equal(third.allowed, false)
  assert.equal(third.user_remaining, 0)

  const snapshot = await governor.getSnapshot({
    tenantId: 'tenant-a',
    userId: 'user-a'
  })
  assert.equal(snapshot.user_used, 2)
  assert.equal(snapshot.tenant_used, 2)
})
