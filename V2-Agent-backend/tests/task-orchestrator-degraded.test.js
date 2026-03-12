import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

import { createTaskOrchestrator } from '../src/orchestrator/task-orchestrator.js'

function createRoutingOutput() {
  return {
    objective: 'area_briefing',
    confidence: 0.9,
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
    llm_confidence: 0.9,
    legacy_route: {
      query_type: 'area_analysis',
      primary_intent: 'micro',
      sub_intent: 'summary',
      confidence: 0.82,
      features: {}
    }
  }
}

test('async deep-lane failures transition the job into S8_TERMINAL_DEGRADED and emit deep.failed', async () => {
  const seen = []
  let lastSavedJob = null

  const orchestrator = createTaskOrchestrator({
    registry: {},
    logger: {
      async log() {}
    },
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
        lastSavedJob = job
        return job
      }
    },
    scheduleDeepLane(task) {
      return task()
    },
    sessionHistoryStore: {
      async getRecentHistory() {
        return []
      },
      async appendTurn() {}
    },
    poiRepository: {
      async searchPois() {
        return {
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [114.31, 30.53] },
              properties: { id: 'poi-1', category: 'food' }
            }
          ],
          query_summary: {
            data_source: 'postgis',
            tables: ['public.pois'],
            filters: ['within_aoi_exact']
          },
          limitations: []
        }
      }
    },
    intentRouterAgent: {
      async route() {
        return createRoutingOutput()
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
          answer: {
            text: 'Fast summary',
            sections: []
          },
          evidence: [],
          warnings: [],
          narrative_meta: {
            mode: 'llm_rewrite'
          }
        }
      },
      async composeDeepNarrativeWithLlm() {
        throw new Error('deep_lane_exploded')
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

  orchestrator.events.on('deep.failed', (payload) => {
    seen.push(payload)
  })

  const result = await orchestrator.analyze({
    sessionId: 'session-degraded',
    query: 'Trigger async deep failure',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    },
    asyncDeep: true
  })

  assert.equal(result.events.some((entry) => entry.event === 'fast.result'), true)
  assert.equal(result.events.some((entry) => entry.event === 'deep.accepted'), true)

  await delay(0)

  assert.equal(seen.length, 1)
  assert.equal(seen[0].state, 'S8_TERMINAL_DEGRADED')
  assert.equal(seen[0].schema_version, 'contract.v2.0')
  assert.equal(seen[0].result_type, 'degraded')
  assert.equal(seen[0].execution_path, 'new_agent')
  assert.equal(typeof seen[0].error?.message, 'string')
  assert.equal(lastSavedJob.state, 'S8_TERMINAL_DEGRADED')
  assert.equal(lastSavedJob.deep_final, null)
})
