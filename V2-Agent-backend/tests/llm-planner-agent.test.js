import test from 'node:test'
import assert from 'node:assert/strict'

import { createLlmPlannerAgent } from '../src/agents/llm-planner-agent.js'
import { createPlannerAgent } from '../src/chain/planner.js'

test('returns normalized planning decision from llm json output', async () => {
  const llmPlannerAgent = createLlmPlannerAgent({
    enabled: true,
    llmGateway: {
      async chat() {
        return {
          text: JSON.stringify({
            template_id: 'dynamic-plan',
            lane: 'deep',
            deadline_ms: 18000,
            max_retries: 1,
            pipeline: [
              { op: 'clip', args: { source: 'poi', mask: 'aoi' } },
              { op: 'hotspot_grid', args: { resolution: 7 } },
              { op: 'summarize', args: { mode: 'hotspot_summary' } }
            ]
          })
        }
      }
    }
  })

  const decision = await llmPlannerAgent.decide({
    query: 'analyze hotspots',
    route: {
      query_type: 'area_analysis',
      primary_intent: 'compare',
      sub_intent: 'hotspot'
    },
    template: { id: 'macro-hotspot-summary' },
    toolDescriptors: [{ id: 'clip' }, { id: 'hotspot_grid' }, { id: 'summarize' }]
  })

  assert.equal(decision.template_id, 'dynamic-plan')
  assert.equal(decision.constraints.lane, 'deep')
  assert.equal(decision.constraints.deadline_ms, 18000)
  assert.equal(decision.pipeline.length, 3)
})

test('planner agent falls back to static template pipeline when llm plan is unavailable', async () => {
  const planner = createPlannerAgent({
    llmPlannerAgent: {
      async decide() {
        return null
      }
    }
  })

  const plan = await planner.plan({
    traceId: 'trace-fallback',
    query: 'buffer and export',
    route: {
      query_type: 'area_analysis',
      primary_intent: 'micro',
      sub_intent: 'buffer_merge'
    },
    template: { id: 'vector-buffer-merge' },
    registry: {
      list() {
        return []
      }
    }
  })

  assert.equal(plan.template_id, 'vector-buffer-merge')
  assert.equal(Array.isArray(plan.pipeline), true)
  assert.equal(plan.pipeline[0].op, 'clip')
})
