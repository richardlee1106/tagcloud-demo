import { describe, expect, it, vi } from 'vitest'

import { runSingleRoundPlannerQuery } from '../../planner_line/plannerRunner.js'

describe('plannerRunner', () => {
  it('orchestrates planning, execution, and synthesis into a single report', async () => {
    const plan = {
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

    const planningService = {
      planQuery: vi.fn().mockResolvedValue({
        ok: true,
        source: 'planner_model',
        plan
      })
    }
    const executor = {
      executePlan: vi.fn().mockResolvedValue({
        execution_trace: {
          executed_steps: ['s1_resolve_primary_anchor'],
          skipped_steps: [],
          query_count: 1,
          rounds_used: 1
        },
        evidence_bundle: {
          nearby_pois: [{ name: '瑞幸咖啡' }]
        },
        step_outputs: {
          s1_resolve_primary_anchor: {
            anchor: {
              place_name: '武汉大学'
            }
          }
        }
      })
    }
    const synthesize = vi.fn().mockResolvedValue({
      answer: '当前证据里比较相关的地点包括：瑞幸咖啡。',
      source: 'fallback_summary'
    })

    const result = await runSingleRoundPlannerQuery('武汉大学附近有哪些咖啡店？', {
      planningService,
      executor,
      synthesizeAnswer: synthesize
    })

    expect(planningService.planQuery).toHaveBeenCalledWith('武汉大学附近有哪些咖啡店？', {})
    expect(executor.executePlan).toHaveBeenCalledWith(plan, expect.objectContaining({
      user_query: '武汉大学附近有哪些咖啡店？',
      intent_spec: expect.any(Object)
    }))
    expect(synthesize).toHaveBeenCalledWith({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan,
      evidence_bundle: {
        nearby_pois: [{ name: '瑞幸咖啡' }]
      }
    })
    expect(result).toMatchObject({
      ok: true,
      planning: {
        source: 'planner_model'
      },
      execution: {
        execution_trace: {
          executed_steps: ['s1_resolve_primary_anchor']
        }
      },
      synthesis: {
        answer: '当前证据里比较相关的地点包括：瑞幸咖啡。'
      }
    })
  })

  it('returns a failed report when planning cannot produce a plan', async () => {
    const planningService = {
      planQuery: vi.fn().mockResolvedValue({
        ok: false,
        source: 'planner_model',
        plan: null,
        attempts: [{ kind: 'initial' }]
      })
    }

    const result = await runSingleRoundPlannerQuery('武汉大学附近有哪些咖啡店？', {
      planningService
    })

    expect(result.ok).toBe(false)
    expect(result.stage).toBe('planning')
  })

  it('returns a failed execution-stage report when executor throws', async () => {
    const planningService = {
      planQuery: vi.fn().mockResolvedValue({
        ok: true,
        source: 'planner_model',
        plan: {
          task_type_hint: 'nearby_lookup',
          user_goal: '查询武汉大学附近的咖啡店',
          anchors: [],
          steps: [],
          stop_conditions: {
            max_rounds: 1,
            max_queries: 1,
            min_evidence_items: 1
          },
          answer_frame: {
            style: 'lookup',
            must_ground_in_evidence: true,
            required_sections: [],
            forbidden_claims: []
          }
        }
      })
    }
    const executor = {
      executePlan: vi.fn().mockRejectedValue(new Error('handler missing'))
    }

    const result = await runSingleRoundPlannerQuery('武汉大学附近有哪些咖啡店？', {
      planningService,
      executor
    })

    expect(result.ok).toBe(false)
    expect(result.stage).toBe('execution')
    expect(result.error).toContain('handler missing')
  })

  it('builds intent_spec from runtime context and forwards it into executor for the main planner path', async () => {
    const plan = {
      task_type_hint: 'area_overview',
      user_goal: '分析当前圈选区域业态分布',
      anchors: [],
      steps: [],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 1,
        min_evidence_items: 1
      },
      answer_frame: {
        style: 'overview',
        must_ground_in_evidence: true,
        required_sections: ['spatial_structure'],
        forbidden_claims: []
      }
    }

    const intentSpec = {
      task_type: 'overview',
      spatial_scope: {
        mode: 'geometry'
      }
    }

    const planningService = {
      planQuery: vi.fn().mockResolvedValue({
        ok: true,
        source: 'planner_model',
        plan
      })
    }
    const intentSpecService = {
      buildIntentSpec: vi.fn().mockReturnValue(intentSpec)
    }
    const executor = {
      executePlan: vi.fn().mockResolvedValue({
        execution_trace: {
          executed_steps: [],
          skipped_steps: [],
          query_count: 0,
          rounds_used: 1
        },
        evidence_bundle: {
          evidence_profile: {
            spatial_scope_mode: 'geometry'
          }
        },
        step_outputs: {}
      })
    }
    const synthesize = vi.fn().mockResolvedValue({
      answer: '当前圈选范围内以餐饮配套为主。',
      source: 'fallback_summary'
    })

    const spatialContext = {
      boundary: [
        [114.36, 30.53],
        [114.37, 30.53],
        [114.37, 30.54],
        [114.36, 30.54]
      ]
    }

    await runSingleRoundPlannerQuery('这个圈里的业态分布如何？', {
      planningService,
      intentSpecService,
      executor,
      synthesizeAnswer: synthesize,
      spatialContext
    })

    expect(intentSpecService.buildIntentSpec).toHaveBeenCalledWith({
      userQuery: '这个圈里的业态分布如何？',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [114.36, 30.53],
          [114.37, 30.53],
          [114.37, 30.54],
          [114.36, 30.54],
          [114.36, 30.53]
        ]]
      },
      anchors: []
    })
    expect(executor.executePlan).toHaveBeenCalledWith(plan, {
      user_query: '这个圈里的业态分布如何？',
      intent_spec: intentSpec
    })
  })
})
