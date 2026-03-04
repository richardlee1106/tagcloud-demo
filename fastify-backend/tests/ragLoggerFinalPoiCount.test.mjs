import test from 'node:test'
import assert from 'node:assert/strict'

import { createRAGSession } from '../services/ragLogger.js'

test('setFinalPOIs updates summary.totalPOIsRetrieved from final result length', () => {
  const session = createRAGSession()

  session.setFinalPOIs([
    { name: 'POI-1', category: 'cat-a' },
    { name: 'POI-2', category: 'cat-b' },
    { name: 'POI-3', category: 'cat-c' }
  ])

  assert.equal(session.summary.totalPOIsRetrieved, 3)
})
