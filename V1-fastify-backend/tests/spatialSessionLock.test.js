import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasLockableSpatialContext,
  resolveSessionSpatialContext
} from '../routes/ai/spatialSessionLock.js'

test('detects lockable spatial context only when spatial constraints exist', () => {
  assert.equal(hasLockableSpatialContext({}), false)
  assert.equal(hasLockableSpatialContext({ viewport: [114.3, 30.5, 114.4, 30.6] }), true)
  assert.equal(
    hasLockableSpatialContext({
      boundary: [
        [114.3, 30.5],
        [114.4, 30.5],
        [114.4, 30.6]
      ]
    }),
    true
  )
})

test('locks first spatial context and keeps it stable in same session', () => {
  const session = {}
  const firstContext = {
    viewport: [114.30, 30.50, 114.40, 30.60],
    mapZoom: 16.2
  }
  const changedContext = {
    viewport: [114.10, 30.10, 114.20, 30.20],
    mapZoom: 13.1
  }

  const first = resolveSessionSpatialContext({
    session,
    incomingSpatialContext: firstContext,
    lockEnabled: true
  })
  const second = resolveSessionSpatialContext({
    session,
    incomingSpatialContext: changedContext,
    lockEnabled: true
  })

  assert.deepEqual(first.spatialContext.viewport, firstContext.viewport)
  assert.deepEqual(second.spatialContext.viewport, firstContext.viewport)
  assert.equal(first.lockState.initialized, true)
  assert.equal(second.lockState.reused, true)
  assert.equal(second.lockState.changedIgnored, true)
})

test('can bypass lock when lockEnabled is false', () => {
  const session = {}
  const firstContext = {
    viewport: [114.30, 30.50, 114.40, 30.60]
  }
  const changedContext = {
    viewport: [114.10, 30.10, 114.20, 30.20]
  }

  const first = resolveSessionSpatialContext({
    session,
    incomingSpatialContext: firstContext,
    lockEnabled: true
  })
  const unlocked = resolveSessionSpatialContext({
    session,
    incomingSpatialContext: changedContext,
    lockEnabled: false
  })

  assert.deepEqual(first.spatialContext.viewport, firstContext.viewport)
  assert.deepEqual(unlocked.spatialContext.viewport, changedContext.viewport)
  assert.equal(unlocked.lockState.enabled, false)
})
