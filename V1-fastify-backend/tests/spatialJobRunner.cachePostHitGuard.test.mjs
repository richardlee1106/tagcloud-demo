import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateCachePostHitGuard } from '../services/spatialJobRunner.js'

function buildRequestProfile(overrides = {}) {
  return {
    viewport_hash: 'vp_hash_req',
    area_km2: 45.777,
    center: {
      lat: 30.561,
      lon: 114.321
    },
    map_zoom_bucket: 13,
    ...overrides
  }
}

function buildCachedProfile(overrides = {}) {
  return {
    viewport_hash: 'vp_hash_req',
    area_km2: 45.721,
    center: {
      lat: 30.5606,
      lon: 114.3208
    },
    map_zoom_bucket: 13,
    ...overrides
  }
}

test('cache post-hit guard accepts geometry-consistent cache entry', () => {
  const verdict = evaluateCachePostHitGuard({
    requestProfile: buildRequestProfile(),
    cachedProfile: buildCachedProfile()
  })

  assert.equal(verdict.accepted, true)
  assert.equal(verdict.geometry_match, true)
  assert.equal(verdict.cache_guard_reject, false)
  assert.deepEqual(verdict.failed_guards, [])
})

test('cache post-hit guard rejects large area mismatch', () => {
  const verdict = evaluateCachePostHitGuard({
    requestProfile: buildRequestProfile({ area_km2: 45.777 }),
    cachedProfile: buildCachedProfile({ area_km2: 3.218 })
  })

  assert.equal(verdict.accepted, false)
  assert.equal(verdict.geometry_match, false)
  assert.equal(verdict.cache_guard_reject, true)
  assert.ok(verdict.failed_guards.includes('area_ratio_guard'))
})

test('cache post-hit guard rejects viewport hash mismatch', () => {
  const verdict = evaluateCachePostHitGuard({
    requestProfile: buildRequestProfile({ viewport_hash: 'vp_hash_new' }),
    cachedProfile: buildCachedProfile({ viewport_hash: 'vp_hash_old' })
  })

  assert.equal(verdict.accepted, false)
  assert.equal(verdict.geometry_match, false)
  assert.equal(verdict.cache_guard_reject, true)
  assert.ok(verdict.failed_guards.includes('viewport_hash_guard'))
})

test('cache post-hit guard rejects missing viewport hash when required', () => {
  const verdict = evaluateCachePostHitGuard({
    requestProfile: buildRequestProfile({ viewport_hash: 'vp_hash_new' }),
    cachedProfile: buildCachedProfile({ viewport_hash: '' })
  })

  assert.equal(verdict.accepted, false)
  assert.equal(verdict.geometry_match, false)
  assert.equal(verdict.cache_guard_reject, true)
  assert.ok(verdict.failed_guards.includes('viewport_hash_guard_missing'))
})
