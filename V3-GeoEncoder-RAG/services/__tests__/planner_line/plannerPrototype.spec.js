import { describe, expect, it, vi } from 'vitest'

import { synthesizeAnswer } from '../../planner_line/answerSynthesis.js'
import { createPlanExecutor } from '../../planner_line/planExecutor.js'
import { createPlannerService } from '../../planner_line/plannerService.js'
import { createToolRunner } from '../../spatial_core/toolRunner.js'

describe('planner_line single-round prototype', () => {
  it('plans, executes, and synthesizes a nearby lookup in one round', async () => {
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

    const toolRunner = createToolRunner({
      handlers: {
        resolve_anchor: async (input) => ({
          anchor: {
            place_name: input.place_name,
            role: input.role,
            lon: 114.36,
            lat: 30.53
          }
        }),
        search_nearby_pois: async () => ({
          pois: [
            { name: '瑞幸咖啡', category: '咖啡', distance_m: 120 },
            { name: 'Manner Coffee', category: '咖啡', distance_m: 260 }
          ],
          total_count: 2
        })
      }
    })
    const executor = createPlanExecutor({ toolRunner })

    const planning = await plannerService.planQuery('武汉大学附近有哪些咖啡店？')
    const execution = await executor.executePlan(planning.plan)
    const synthesis = await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: planning.plan,
      evidence_bundle: execution.evidence_bundle,
      llmCall: null
    })

    expect(planning.ok).toBe(true)
    expect(execution.execution_trace.executed_steps).toEqual([
      's1_resolve_primary_anchor',
      's2_search_primary_nearby_pois'
    ])
    expect(execution.evidence_bundle.nearby_pois).toHaveLength(2)
    expect(synthesis.answer).toContain('瑞幸咖啡')
    expect(synthesis.source).toBe('fallback_summary')
  })
})
