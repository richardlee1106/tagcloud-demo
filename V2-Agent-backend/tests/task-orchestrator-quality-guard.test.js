import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { createTaskOrchestrator } from '../src/orchestrator/task-orchestrator.js'
import { createToolRegistry } from '../src/tools/tool-registry.js'
import { registerVectorTools } from '../src/tools/vector-tools.js'

function createRoutingOutput(objective = 'area_briefing') {
  return {
    objective,
    confidence: 0.8,
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
    routing_source: 'rule',
    llm_reasoning: null,
    llm_confidence: null,
    legacy_route: {
      query_type: 'area_analysis',
      primary_intent: 'micro',
      sub_intent: 'summary',
      confidence: 0.72,
      features: {}
    }
  }
}

test('falls back to the legacy path when quality guard returns handoff_legacy', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'v2-quality-handoff-'))
  const registry = createToolRegistry()
  registerVectorTools({
    registry,
    artifactsDir: path.join(baseDir, 'artifacts')
  })

  const orchestrator = createTaskOrchestrator({
    registry,
    logger: {
      async log() {}
    },
    baseDir,
    artifactsDir: path.join(baseDir, 'artifacts'),
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
                id: 'poi-1',
                category: 'food',
                name: 'POI-1'
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
            summary_text: 'Should be ignored by handoff.',
            metrics: {},
            claims: [],
            limitations: []
          }
        ]
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm() {
        return {
          answer: {
            text: 'New-agent answer that must not leak when handoff happens.',
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
        return {
          answer: {
            text: 'Deep answer that must not be emitted.',
            sections: [],
            details: []
          },
          evidence: [],
          warnings: []
        }
      }
    },
    qualityGuardAgent: {
      decide() {
        return {
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
      }
    }
  })

  const result = await orchestrator.analyze({
    sessionId: 'session-handoff',
    query: 'Area briefing that must hand off',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    }
  })

  const eventNames = result.events.map((event) => event.event)
  const fastResult = result.events.find((event) => event.event === 'fast.result')

  assert.equal(eventNames.includes('fast.result'), true)
  assert.equal(eventNames.includes('deep.accepted'), true)
  assert.equal(eventNames.includes('deep.patch'), true)
  assert.equal(eventNames.includes('deep.final'), true)
  assert.equal(fastResult?.data?.execution_path, 'legacy')
  assert.equal(fastResult?.data?.objective, 'area_briefing')
  assert.equal(typeof fastResult?.data?.summary?.text, 'string')
  assert.equal(fastResult?.data?.fallback?.reason_code, 'quality_guard_handoff')
  assert.equal(fastResult?.data?.artifact, undefined)
  assert.equal(fastResult?.data?.summary?.text.includes('New-agent answer'), false)
})
