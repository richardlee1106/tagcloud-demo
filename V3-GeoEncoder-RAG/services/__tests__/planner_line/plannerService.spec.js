import { describe, expect, it, vi } from 'vitest'

import { createPlannerService } from '../../planner_line/plannerService.js'

describe('plannerService', () => {
  it('returns the validated planner output when the model produces a valid plan', async () => {
    const generatedPlan = {
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
          step_id: 's1_resolve',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '武汉大学',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 1,
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
        plan: generatedPlan,
        attempts: [{ kind: 'initial' }]
      })
    })

    const result = await plannerService.planQuery('武汉大学附近有哪些咖啡店？')

    expect(result).toMatchObject({
      ok: true,
      source: 'planner_model',
      plan: generatedPlan
    })
  })

  it('falls back to a legacy-derived plan when planner generation fails', async () => {
    const plannerService = createPlannerService({
      generatePlannerPlan: vi.fn().mockResolvedValue({
        ok: false,
        attempts: [{ kind: 'initial', validation: { errors: ['bad output'] } }]
      }),
      inferIntentLegacy: vi.fn().mockResolvedValue({
        taskType: 'nearby_lookup',
        placeName: '武汉大学',
        poiSubType: '咖啡',
        category: '餐饮美食',
        radiusM: 800
      })
    })

    const result = await plannerService.planQuery('武汉大学附近有哪些咖啡店？')

    expect(result.ok).toBe(true)
    expect(result.source).toBe('legacy_fallback')
    expect(result.plan.steps.map((step) => step.tool)).toEqual([
      'spatial_core.resolve_anchor',
      'spatial_core.search_nearby_pois'
    ])
  })
})
