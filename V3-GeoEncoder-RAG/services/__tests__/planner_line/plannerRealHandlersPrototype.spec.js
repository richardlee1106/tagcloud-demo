import { describe, expect, it, vi } from 'vitest'

import { synthesizeAnswer } from '../../planner_line/answerSynthesis.js'
import { createPlanExecutor } from '../../planner_line/planExecutor.js'
import { createPlannerService } from '../../planner_line/plannerService.js'
import { createSpatialCoreToolRunner } from '../../spatial_core/defaultHandlers.js'

describe('planner_line prototype with spatial_core handlers', () => {
  it('runs a nearby lookup plan through the real spatial_core handler adapters', async () => {
    const plannerPlan = {
      task_type_hint: 'nearby_lookup',
      user_goal: '查询武汉大学附近的咖啡店',
      anchors: [
        {
          place_name: '武汉大学',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '武汉大学',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's2_search_primary_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 800,
            filter: {
              category: '餐饮美食',
              subcategory: '咖啡'
            },
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 2,
        min_evidence_items: 1
      },
      answer_frame: {
        style: 'lookup',
        must_ground_in_evidence: true,
        required_sections: ['result_list'],
        forbidden_claims: []
      }
    }

    const plannerService = createPlannerService({
      generatePlannerPlan: vi.fn().mockResolvedValue({
        ok: true,
        plan: plannerPlan,
        attempts: [{ kind: 'initial' }]
      })
    })

    const executor = createPlanExecutor({
      toolRunner: createSpatialCoreToolRunner({
        quickSearchPois: vi.fn().mockResolvedValue([
          {
            id: 9527,
            name: '武汉大学',
            lon: 114.36,
            lat: 30.53
          }
        ]),
        buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
          applied: false
        }),
        buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
        faissHybridSearch: vi.fn().mockResolvedValue([
          {
            id: 1,
            name: '瑞幸咖啡',
            category: '咖啡',
            distance_m: 120
          }
        ])
      })
    })

    const planning = await plannerService.planQuery('武汉大学附近有哪些咖啡店？')
    const execution = await executor.executePlan(planning.plan, {
      user_query: '武汉大学附近有哪些咖啡店？'
    })
    const synthesis = await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: planning.plan,
      evidence_bundle: execution.evidence_bundle,
      llmCall: null
    })

    expect(execution.evidence_bundle.anchors[0]).toMatchObject({
      place_name: '武汉大学',
      resolved_place_name: '武汉大学'
    })
    expect(execution.evidence_bundle.nearby_pois[0]).toMatchObject({
      name: '瑞幸咖啡'
    })
    expect(synthesis.answer).toContain('瑞幸咖啡')
  })
})
