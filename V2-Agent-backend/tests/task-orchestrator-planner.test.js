import test from 'node:test'
import assert from 'node:assert/strict'

import { createTaskOrchestrator } from '../src/orchestrator/task-orchestrator.js'

test('uses planner agent to build legacy execution plan dynamically', async () => {
  const seenQueries = []
  const registry = {
    list() {
      return [{ id: 'summarize', capability: ['vector.summarize'] }]
    },
    get(toolId) {
      if (toolId !== 'summarize') {
        return null
      }
      return {
        id: 'summarize',
        async handler() {
          return {
            kind: 'summary',
            text: 'legacy dynamic summary'
          }
        }
      }
    }
  }

  const orchestrator = createTaskOrchestrator({
    registry,
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
    plannerAgent: {
      async plan({ query, route, traceId }) {
        seenQueries.push(query)
        return {
          trace_id: traceId,
          dsl_version: 'dsl.v0.1',
          query_type: route.query_type,
          primary_intent: route.primary_intent,
          sub_intent: route.sub_intent,
          template_id: 'dynamic-summary',
          scope: {
            aoi_source: 'viewport',
            crs: 'EPSG:4326'
          },
          constraints: {
            lane: 'fast',
            deadline_ms: 10000,
            max_retries: 2
          },
          pipeline: [
            { op: 'summarize', args: { mode: 'narrative' } }
          ]
        }
      }
    },
    intentRouterAgent: {
      async route() {
        return {
          objective: 'legacy_fallback',
          confidence: 0.71,
          routing_features: { matched_keywords: {} },
          legacy_hint: 'fallback-summary',
          allowlist_hit: false,
          fallback_reason_code: 'objective_not_in_allowlist',
          execution_path: 'legacy',
          query_type: 'regional_summary',
          primary_intent: 'macro',
          sub_intent: 'summary',
          selected_agents: [],
          routing_source: 'rule',
          legacy_route: {
            query_type: 'regional_summary',
            primary_intent: 'macro',
            sub_intent: 'summary',
            confidence: 0.71,
            features: {}
          }
        }
      }
    }
  })

  const result = await orchestrator.analyze({
    sessionId: 'session-planner',
    query: 'Give me a regional summary.',
    viewport: {
      bbox: [114.30, 30.52, 114.36, 30.57],
      zoom: 13
    },
    asyncDeep: false
  })

  assert.equal(seenQueries.length, 1)
  assert.equal(seenQueries[0], 'Give me a regional summary.')
  assert.equal(result.events.some((entry) => entry.event === 'fast.result'), true)
  const fastPayload = result.events.find((entry) => entry.event === 'fast.result')?.data
  assert.equal(fastPayload.execution_path, 'legacy')
})
