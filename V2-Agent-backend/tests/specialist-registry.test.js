import test from 'node:test'
import assert from 'node:assert/strict'

import { createDefaultSpecialistRegistry } from '../src/orchestrator/specialist-catalog.js'
import { createSpecialistRegistry } from '../src/orchestrator/specialist-registry.js'

test('registers and executes specialist runners through registry', async () => {
  const registry = createSpecialistRegistry()
  registry.register({
    id: 'mock_specialist',
    supports_objectives: ['area_briefing'],
    run: ({ specialistTask }) => ({
      section_type: 'mock',
      summary_text: `Handled:${specialistTask.specialist_id}`,
      metrics: {},
      claims: [],
      limitations: []
    })
  })

  const result = await registry.runTask({
    specialist_id: 'mock_specialist',
    objectiveContract: { objective: 'area_briefing' },
    groundingResult: {}
  })

  assert.equal(result.section_type, 'mock')
  assert.equal(result.summary_text, 'Handled:mock_specialist')
})

test('throws for unknown specialist and unsupported objective', async () => {
  const registry = createSpecialistRegistry({
    definitions: [
      {
        id: 'mock_specialist',
        supports_objectives: ['compare_analysis'],
        run: () => ({ ok: true })
      }
    ]
  })

  await assert.rejects(
    () => registry.runTask({ specialist_id: 'unknown', objectiveContract: { objective: 'compare_analysis' } }),
    /unknown_specialist/
  )

  await assert.rejects(
    () => registry.runTask({ specialist_id: 'mock_specialist', objectiveContract: { objective: 'area_briefing' } }),
    /unsupported_objective/
  )
})

test('default specialist registry exposes known built-in specialists', () => {
  const registry = createDefaultSpecialistRegistry()
  const known = registry.listKnownSpecialists().sort()

  assert.deepEqual(
    known,
    ['comparison', 'coverage_gap', 'dominant_industries', 'hotspots', 'opportunity_points'].sort()
  )
})
