import test from 'node:test'
import assert from 'node:assert/strict'

import { createDataGroundingAgent } from '../src/agents/data-grounding-agent.js'

function buildObjectiveContract(objective = 'area_briefing') {
  return {
    objective,
    scope: {
      aoi_source: 'viewport',
      viewport: {
        bbox: [114.30, 30.52, 114.36, 30.57],
        zoom: 15
      }
    }
  }
}

test('grounding agent owns the no-data ladder and retries repository searches progressively', async () => {
  const calls = []
  const features = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [114.31, 30.53] },
      properties: { id: 'poi-1', category: 'food' }
    }
  ]

  const repository = {
    async searchPois({ viewport, step }) {
      calls.push({ viewport, step })

      if (calls.length < 3) {
        return {
          features: [],
          query_summary: {
            data_source: 'postgis',
            tables: ['public.pois'],
            filters: [`within_${step}`]
          },
          limitations: []
        }
      }

      return {
        features,
        query_summary: {
          data_source: 'postgis',
          tables: ['public.pois'],
          filters: [`within_${step}`]
        },
        limitations: []
      }
    }
  }

  const groundingAgent = createDataGroundingAgent({
    repository,
    coverageJudge: {
      async assess({ noDataLadder, resolvedStep, objectiveContract }) {
        assert.equal(objectiveContract.objective, 'area_briefing')
        assert.equal(resolvedStep, 'aoi_expand_medium')
        assert.equal(noDataLadder.length, 3)
        return {
          status: 'partial',
          poi_count: 1,
          sufficiency_reason: 'Coverage judge marked the recovered set as partial.'
        }
      }
    }
  })

  const result = await groundingAgent.ground({
    objectiveContract: buildObjectiveContract()
  })

  assert.equal(calls.length, 3)
  assert.deepEqual(
    result.no_data_ladder.map((entry) => entry.step),
    ['aoi_exact', 'aoi_expand_near', 'aoi_expand_medium']
  )
  assert.equal(result.coverage.status, 'partial')
  assert.equal(result.working_set.poi_features.length, 1)
  assert.equal(result.query_summary.filters[0], 'within_aoi_expand_medium')
})

test('grounding agent remains compatible with legacy repository.groundingSearch implementations', async () => {
  const groundingAgent = createDataGroundingAgent({
    repository: {
      async groundingSearch() {
        return {
          features: [],
          resolved_step: null,
          query_summary: {
            data_source: 'sample-postgis',
            tables: ['poi'],
            filters: ['within_aoi_ladder']
          },
          no_data_ladder: [
            { step: 'aoi_exact', status: 'empty', poi_count: 0 }
          ],
          limitations: []
        }
      }
    }
  })

  const result = await groundingAgent.ground({
    objectiveContract: buildObjectiveContract('coverage_gap_analysis')
  })

  assert.equal(result.coverage.status, 'none')
  assert.equal(result.no_data_ladder[0].step, 'aoi_exact')
})
