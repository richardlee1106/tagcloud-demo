import test from 'node:test'
import assert from 'node:assert/strict'

import { createTaskOrchestrator } from '../src/orchestrator/task-orchestrator.js'

function createRoutingOutput(objective = 'area_briefing') {
  return {
    objective,
    confidence: 0.91,
    routing_features: {
      matched_keywords: {}
    },
    legacy_hint: 'micro-poi-summary',
    allowlist_hit: true,
    execution_path: 'new_agent',
    query_type: 'area_analysis',
    primary_intent: 'micro',
    sub_intent: 'summary',
    selected_agents: ['hotspots'],
    routing_source: 'llm',
    llm_reasoning: 'history aware routing',
    llm_confidence: 0.91,
    legacy_route: {
      query_type: 'area_analysis',
      primary_intent: 'micro',
      sub_intent: 'summary',
      confidence: 0.82,
      features: {}
    }
  }
}

function createSessionHistoryStore() {
  const turnsBySession = new Map()

  return {
    async getRecentHistory(sessionId) {
      return turnsBySession.get(sessionId) ?? []
    },
    async appendTurn(sessionId, turn) {
      const turns = turnsBySession.get(sessionId) ?? []
      turns.push(turn)
      turnsBySession.set(sessionId, turns)
    }
  }
}

test('reuses previous session turns when routing the next request', async () => {
  const seenHistories = []
  const sessionHistoryStore = createSessionHistoryStore()

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
    sessionHistoryStore,
    poiRepository: {
      async groundingSearch() {
        return {
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [114.31, 30.53]
              },
              properties: {
                name: 'POI-A',
                category: 'food',
                district: 'district-a'
              }
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
      async route({ history }) {
        seenHistories.push(history)
        return createRoutingOutput()
      }
    },
    parallelAgentExecutor: {
      mode: 'in_process',
      async runSpecialists() {
        return [
          {
            section_type: 'hotspots',
            summary_text: 'Hotspots center on the southeast edge.',
            metrics: {
              top_quadrant: 'southeast'
            },
            claims: [
              {
                statement: 'Hotspots center on the southeast edge.',
                confidence: 0.88,
                evidence_refs: ['dataset://poi/area_briefing/aoi_exact']
              }
            ],
            limitations: []
          }
        ]
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm({ query }) {
        return {
          answer: {
            text: `Fast answer for ${query}`,
            sections: [
              {
                key: 'hotspots',
                title: 'Hotspots',
                summary: `Fast answer for ${query}`
              }
            ]
          },
          evidence: [{ kind: 'dataset', ref: 'dataset://poi/area_briefing/aoi_exact' }],
          warnings: [],
          narrative_meta: {
            mode: 'llm_rewrite'
          }
        }
      },
      async composeDeepNarrativeWithLlm({ query }) {
        return {
          answer: {
            text: `Deep answer for ${query}`,
            sections: [],
            details: []
          },
          evidence: [],
          warnings: [],
          narrative_meta: {
            mode: 'llm_rewrite'
          }
        }
      }
    },
    qualityGuardAgent: {
      decide() {
        return {
          decision: 'pass',
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

  await orchestrator.analyze({
    sessionId: 'session-history',
    query: 'First turn query',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    }
  })

  await orchestrator.analyze({
    sessionId: 'session-history',
    query: 'Second turn query',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    }
  })

  assert.deepEqual(seenHistories[0], [])
  assert.equal(Array.isArray(seenHistories[1]), true)
  assert.equal(seenHistories[1].length >= 2, true)
  assert.equal(seenHistories[1].some((entry) => entry.role === 'user' && entry.content === 'First turn query'), true)
  assert.equal(
    seenHistories[1].some((entry) => entry.role === 'assistant' && String(entry.content || '').includes('Fast answer for First turn query')),
    true
  )
})
