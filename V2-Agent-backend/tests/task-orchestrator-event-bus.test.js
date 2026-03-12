import test from 'node:test'
import assert from 'node:assert/strict'

import { createTaskOrchestrator } from '../src/orchestrator/task-orchestrator.js'

test('orchestrator emits analysis events on its event bus', async () => {
  const seenEvents = []
  const orchestrator = createTaskOrchestrator({
    registry: {},
    logger: null,
    baseDir: process.cwd(),
    artifactsDir: process.cwd(),
    cache: {
      get() {
        return { hit: false, level: null, value: null }
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
    },
    intentRouterAgent: {
      async route() {
        return {
          objective: 'area_briefing',
          confidence: 0.82,
          routing_features: { matched_keywords: {} },
          legacy_hint: 'micro-poi-summary',
          allowlist_hit: true,
          execution_path: 'new_agent',
          query_type: 'area_analysis',
          primary_intent: 'micro',
          sub_intent: 'summary',
          selected_agents: [],
          routing_source: 'rule',
          legacy_route: {
            query_type: 'area_analysis',
            primary_intent: 'micro',
            sub_intent: 'summary',
            confidence: 0.82,
            features: {}
          }
        }
      }
    },
    parallelAgentExecutor: {
      mode: 'in_process',
      async runSpecialists() {
        return []
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm() {
        return {
          answer: { text: 'No data.', sections: [] },
          evidence: [],
          warnings: [],
          narrative_meta: { mode: 'no_data' }
        }
      },
      async composeDeepNarrativeWithLlm() {
        return {
          answer: { text: 'No data.', sections: [], details: [] },
          evidence: [],
          warnings: []
        }
      }
    },
    qualityGuardAgent: {
      decide() {
        return {
          decision: 'no_data',
          reason_codes: ['grounding_none'],
          allowed_output: {
            can_emit_fast: true,
            can_emit_deep: false,
            can_claim_artifact: false
          },
          required_disclaimers: [],
          next_action: 'explain_no_data'
        }
      }
    }
  })

  orchestrator.events.on('analysis.event', (entry) => {
    seenEvents.push(entry.event)
  })

  await orchestrator.analyze({
    sessionId: 'session-bus',
    query: 'No data case',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    }
  })

  assert.deepEqual(seenEvents, ['fast.result'])
})

test('orchestrator emits deterministic fast-to-deep event ordering when deep lane is synchronous', async () => {
  const seenEvents = []
  const orchestrator = createTaskOrchestrator({
    registry: {},
    logger: null,
    baseDir: process.cwd(),
    artifactsDir: process.cwd(),
    cache: {
      get() {
        return { hit: false, level: null, value: null }
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
      }
    },
    intentRouterAgent: {
      async route() {
        return {
          objective: 'area_briefing',
          confidence: 0.82,
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
            confidence: 0.82,
            features: {}
          }
        }
      }
    },
    parallelAgentExecutor: {
      mode: 'in_process',
      async runSpecialists() {
        return [
          {
            section_type: 'hotspots',
            summary_text: 'Hotspot summary',
            metrics: {},
            claims: [
              {
                statement: 'Hotspot summary',
                confidence: 0.8,
                evidence_refs: ['dataset://poi/area_briefing/aoi_exact']
              }
            ],
            limitations: []
          }
        ]
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm() {
        return {
          answer: { text: 'Fast answer', sections: [] },
          evidence: [],
          warnings: [],
          narrative_meta: { mode: 'llm_rewrite' }
        }
      },
      async composeDeepNarrativeWithLlm() {
        return {
          answer: { text: 'Deep answer', sections: [], details: [] },
          evidence: [],
          warnings: []
        }
      }
    },
    qualityGuardAgent: {
      decide() {
        return {
          decision: 'pass',
          reason_codes: [],
          allowed_output: {
            can_emit_fast: true,
            can_emit_deep: true,
            can_claim_artifact: false
          },
          required_disclaimers: [],
          next_action: 'continue'
        }
      }
    }
  })

  orchestrator.events.on('analysis.event', (entry) => {
    seenEvents.push(entry.event)
  })

  await orchestrator.analyze({
    sessionId: 'session-bus-order',
    query: 'Give me a deep answer',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    },
    asyncDeep: false
  })

  assert.deepEqual(seenEvents, ['fast.result', 'deep.accepted', 'deep.patch', 'deep.final'])
})
