import test from 'node:test'
import assert from 'node:assert/strict'

import { createParallelAgentExecutor } from '../src/orchestrator/parallel-agent-executor.js'
import { createSpecialistRegistry } from '../src/orchestrator/specialist-registry.js'

const OBJECTIVE_CONTRACT = {
  scope: {
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    }
  }
}

const GROUNDING_RESULT = {
  coverage: {
    status: 'sufficient',
    poi_count: 6
  },
  working_set_refs: ['dataset://poi/area_briefing/aoi_exact'],
  limitations: [],
  working_set: {
    poi_features: [
      {
        geometry: { type: 'Point', coordinates: [114.31, 30.53] },
        properties: { name: 'A', category: 'food' }
      },
      {
        geometry: { type: 'Point', coordinates: [114.35, 30.56] },
        properties: { name: 'B', category: 'food' }
      },
      {
        geometry: { type: 'Point', coordinates: [114.33, 30.54] },
        properties: { name: 'C', category: 'retail' }
      }
    ]
  }
}

function buildTasks() {
  return [
    {
      specialist_id: 'hotspots',
      groundingResult: GROUNDING_RESULT,
      objectiveContract: OBJECTIVE_CONTRACT
    },
    {
      specialist_id: 'opportunity_points',
      groundingResult: GROUNDING_RESULT,
      objectiveContract: OBJECTIVE_CONTRACT
    }
  ]
}

test('runs specialist tasks in-process with deterministic ordering', async () => {
  const executor = createParallelAgentExecutor({
    mode: 'in_process'
  })

  const results = await executor.runSpecialists(buildTasks())

  assert.equal(results.length, 2)
  assert.equal(results[0].section_type, 'hotspots')
  assert.equal(results[1].section_type, 'opportunity_points')
})

test('runs specialist tasks via worker threads', async () => {
  const executor = createParallelAgentExecutor({
    mode: 'worker_threads'
  })

  const results = await executor.runSpecialists(buildTasks())

  assert.equal(results.length, 2)
  assert.equal(results[0].section_type, 'hotspots')
  assert.equal(results[1].section_type, 'opportunity_points')
})

test('uses custom specialist registry without changing orchestrator callsite', async () => {
  const specialistRegistry = createSpecialistRegistry({
    definitions: [
      {
        id: 'mock_alpha',
        supports_objectives: ['*'],
        run: () => ({
          section_type: 'mock_alpha',
          summary_text: 'mock alpha',
          metrics: {},
          claims: [],
          limitations: []
        })
      },
      {
        id: 'mock_beta',
        supports_objectives: ['*'],
        run: () => ({
          section_type: 'mock_beta',
          summary_text: 'mock beta',
          metrics: {},
          claims: [],
          limitations: []
        })
      }
    ]
  })

  const executor = createParallelAgentExecutor({
    mode: 'worker_threads',
    specialistRegistry
  })

  const results = await executor.runSpecialists([
    { specialist_id: 'mock_alpha', objectiveContract: OBJECTIVE_CONTRACT, groundingResult: GROUNDING_RESULT },
    { specialist_id: 'mock_beta', objectiveContract: OBJECTIVE_CONTRACT, groundingResult: GROUNDING_RESULT }
  ])

  assert.equal(executor.mode, 'worker_threads')
  assert.equal(results.length, 2)
  assert.equal(results[0].section_type, 'mock_alpha')
  assert.equal(results[1].section_type, 'mock_beta')
})
