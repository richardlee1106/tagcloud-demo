import test from 'node:test'
import assert from 'node:assert/strict'

import { createTaskOrchestrator } from '../src/orchestrator/task-orchestrator.js'

test('refines fast narrative once when draft review requests a rewrite', async () => {
  const calls = []
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
      async runSpecialists(tasks) {
        return tasks.map((task) => ({
          section_type: task.specialist_id,
          summary_text: `summary:${task.specialist_id}`,
          metrics: {},
          claims: [
            {
              statement: `claim:${task.specialist_id}`,
              confidence: 0.8,
              evidence_refs: ['dataset://poi/area_briefing/aoi_exact']
            }
          ],
          limitations: []
        }))
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm() {
        calls.push('fast')
        return {
          answer: { text: 'Initial generic answer.', sections: [] },
          evidence: [],
          warnings: [],
          narrative_meta: { mode: 'llm_generate' }
        }
      },
      async refineFastNarrativeWithLlm({ reviewFeedback }) {
        calls.push(`refine:${reviewFeedback}`)
        return {
          answer: { text: 'Refined answer with sharper detail.', sections: [] },
          evidence: [],
          warnings: [],
          narrative_meta: { mode: 'llm_refine' }
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
      async decide() {
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
      },
      async reviewDraft() {
        return {
          qualityDecision: {
            decision: 'conditional',
            reason_codes: ['llm_judge_downgrade'],
            allowed_output: {
              can_emit_fast: true,
              can_emit_deep: true,
              can_claim_artifact: false
            },
            required_disclaimers: ['Make the explanation more concrete.'],
            next_action: 'continue_with_constraints'
          },
          should_refine: true,
          rewrite_guidance: 'Mention the hotspot implication directly.'
        }
      }
    }
  })

  const result = await orchestrator.analyze({
    sessionId: 'session-refine',
    query: 'Give me a concise area briefing',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    },
    asyncDeep: false
  })

  const fastResult = result.events.find((entry) => entry.event === 'fast.result')?.data
  assert.deepEqual(calls, ['fast', 'refine:Mention the hotspot implication directly.'])
  assert.equal(fastResult.answer.text, 'Refined answer with sharper detail.')
  assert.equal(fastResult.telemetry.quality_decision, 'conditional')
})
