import test from 'node:test'
import assert from 'node:assert/strict'

import { createTaskOrchestrator } from '../src/orchestrator/task-orchestrator.js'

function createBaseOrchestrator({
  routingOutput,
  qualityDecision,
  specialistResults = [],
  fastText = 'Fast answer',
  deepText = 'Deep answer'
}) {
  return createTaskOrchestrator({
    registry: {},
    logger: null,
    baseDir: process.cwd(),
    artifactsDir: process.cwd(),
    cache: {
      get() {
        return {
          hit: true,
          level: 'process',
          value: {
            output: {
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [114.31, 30.53] },
                  properties: { id: 'cached-poi-1' }
                }
              ]
            },
            diagnostics: {
              duration_ms: 12
            },
            artifact: null
          }
        }
      },
      set() {}
    },
    jobStore: {
      async save(job) {
        return job
      }
    },
    sessionHistoryStore: {
      async getRecentHistory() {
        return []
      },
      async appendTurn() {}
    },
    poiRepository: {
      async groundingSearch() {
        return {
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [114.31, 30.53] },
              properties: { id: 'poi-1', category: 'food' }
            }
          ],
          resolved_step: 'aoi_exact',
          query_summary: {
            data_source: 'postgis',
            tables: ['poi'],
            filters: ['within_aoi_exact']
          },
          no_data_ladder: [
            { step: 'aoi_exact', status: 'success', poi_count: 1 }
          ],
          limitations: []
        }
      },
      async searchPois() {
        return {
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [114.31, 30.53] },
              properties: { id: 'poi-legacy-1', category: 'food' }
            }
          ]
        }
      }
    },
    intentRouterAgent: {
      async route() {
        return routingOutput
      }
    },
    parallelAgentExecutor: {
      mode: 'in_process',
      async runSpecialists() {
        return specialistResults
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm() {
        return {
          answer: { text: fastText, sections: [] },
          evidence: [],
          warnings: [],
          narrative_meta: { mode: 'llm_rewrite' }
        }
      },
      async composeDeepNarrativeWithLlm() {
        return {
          answer: { text: deepText, sections: [], details: [] },
          evidence: [],
          warnings: []
        }
      }
    },
    qualityGuardAgent: {
      decide() {
        return qualityDecision
      }
    }
  })
}

function assertEventContract(payload) {
  assert.equal(typeof payload?.schema_version, 'string')
  assert.equal(typeof payload?.trace_id, 'string')
  assert.equal(typeof payload?.job_id, 'string')
  assert.equal(typeof payload?.result_type, 'string')
  assert.equal(typeof payload?.result_version, 'number')
  assert.equal(typeof payload?.state, 'string')
}

test('keeps SSE payload compatibility for new-agent fast/deep events', async () => {
  const orchestrator = createBaseOrchestrator({
    routingOutput: {
      objective: 'area_briefing',
      confidence: 0.9,
      routing_features: { matched_keywords: {} },
      legacy_hint: 'micro-poi-summary',
      allowlist_hit: true,
      execution_path: 'new_agent',
      query_type: 'area_analysis',
      primary_intent: 'micro',
      sub_intent: 'summary',
      selected_agents: ['hotspots'],
      routing_source: 'rule',
      legacy_route: {
        query_type: 'area_analysis',
        primary_intent: 'micro',
        sub_intent: 'summary',
        confidence: 0.9,
        features: {}
      }
    },
    qualityDecision: {
      decision: 'pass',
      reason_codes: [],
      allowed_output: {
        can_emit_fast: true,
        can_emit_deep: true,
        can_claim_artifact: false
      },
      required_disclaimers: [],
      next_action: 'continue'
    },
    specialistResults: [
      {
        section_type: 'hotspots',
        summary_text: 'Hotspot summary',
        metrics: {},
        claims: [],
        limitations: []
      }
    ]
  })

  const result = await orchestrator.analyze({
    sessionId: 'session-contract-new-agent',
    query: 'Area briefing',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    },
    asyncDeep: false
  })

  const events = result.events
  assert.deepEqual(
    events.map((entry) => entry.event),
    ['fast.result', 'deep.accepted', 'deep.patch', 'deep.final']
  )

  for (const entry of events) {
    assertEventContract(entry.data)
    assert.equal(typeof entry.data.objective, 'string')
  }
})

test('keeps SSE payload compatibility for quality-guard handoff to legacy path', async () => {
  const orchestrator = createBaseOrchestrator({
    routingOutput: {
      objective: 'area_briefing',
      confidence: 0.8,
      routing_features: { matched_keywords: {} },
      legacy_hint: 'micro-poi-summary',
      allowlist_hit: true,
      execution_path: 'new_agent',
      query_type: 'area_analysis',
      primary_intent: 'micro',
      sub_intent: 'summary',
      selected_agents: ['hotspots'],
      routing_source: 'rule',
      legacy_route: {
        query_type: 'area_analysis',
        primary_intent: 'micro',
        sub_intent: 'summary',
        confidence: 0.8,
        features: {}
      }
    },
    qualityDecision: {
      decision: 'handoff_legacy',
      reason_codes: ['quality_contract_failed'],
      allowed_output: {
        can_emit_fast: false,
        can_emit_deep: false,
        can_claim_artifact: false
      },
      required_disclaimers: ['Legacy fallback is required.'],
      next_action: 'handoff_legacy'
    }
  })

  const result = await orchestrator.analyze({
    sessionId: 'session-contract-legacy',
    query: 'Area briefing with fallback',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    },
    asyncDeep: false
  })

  const events = result.events
  assert.deepEqual(
    events.map((entry) => entry.event),
    ['fast.result', 'deep.accepted', 'deep.patch', 'deep.final']
  )

  const fastPayload = events[0].data
  assertEventContract(fastPayload)
  assert.equal(fastPayload.execution_path, 'legacy')
  assert.equal(typeof fastPayload.summary?.text, 'string')
  assert.equal(fastPayload.fallback?.reason_code, 'quality_guard_handoff')
})
