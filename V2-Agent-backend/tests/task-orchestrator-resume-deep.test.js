import test from 'node:test'
import assert from 'node:assert/strict'

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

test('resumes a queued deep lane from persisted job context', async () => {
  const jobs = new Map()
  let queuedTask = null

  const orchestrator = createTaskOrchestrator({
    registry: {},
    logger: null,
    baseDir: process.cwd(),
    artifactsDir: process.cwd(),
    cache: {
      async get() {
        return { hit: false, level: null, value: null }
      },
      async set() {}
    },
    jobStore: {
      async save(job) {
        jobs.set(job.job_id, structuredClone(job))
        return job
      },
      async get(jobId) {
        return structuredClone(jobs.get(jobId) ?? null)
      }
    },
    scheduleDeepLane(task) {
      queuedTask = task
      return Promise.resolve({ queued: true })
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
      async reviewDraft({ qualityDecision }) {
        return {
          qualityDecision,
          should_refine: false,
          rewrite_guidance: ''
        }
      }
    },
    narrativeWriterAgent: {
      async composeFastNarrativeWithLlm() {
        return {
          answer: { text: 'Fast answer', sections: [] },
          evidence: [],
          warnings: [],
          narrative_meta: { mode: 'llm_generate' }
        }
      },
      async composeDeepNarrativeWithLlm() {
        return {
          answer: { text: 'Deep answer', sections: [], details: [] },
          evidence: [],
          warnings: []
        }
      }
    }
  })

  const result = await orchestrator.analyze({
    sessionId: 'session-resume',
    query: 'Trigger queued deep lane',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 15
    },
    asyncDeep: true
  })

  assert.ok(queuedTask?.deepLaneDescriptor)
  const jobId = result.jobId
  const queuedJob = jobs.get(jobId)
  assert.equal(queuedJob.state, 'S4_DEEP_QUEUED')
  assert.equal(queuedJob.deep_lane_context.kind, 'structured')

  await orchestrator.resumeDeepLane(queuedTask.deepLaneDescriptor)

  const resumedJob = jobs.get(jobId)
  assert.equal(resumedJob.state, 'S7_DEEP_DONE')
  assert.equal(resumedJob.deep_partial.result_type, 'deep_patch')
  assert.equal(resumedJob.deep_final.result_type, 'deep_final')
})
