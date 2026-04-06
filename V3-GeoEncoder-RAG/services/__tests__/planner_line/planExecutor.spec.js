import { describe, expect, it, vi } from 'vitest'

import { createPlanExecutor } from '../../planner_line/planExecutor.js'
import { createIntentSpecService } from '../../planner_line/intentSpecService.js'

describe('planExecutor', () => {
  it('executes steps in order, resolves $ref values, and returns execution trace', async () => {
    const toolRunner = {
      runTool: vi
        .fn()
        .mockResolvedValueOnce({
          tool_name: 'spatial_core.resolve_anchor',
          output: {
            anchor: {
              place_name: '武汉大学',
              role: 'primary',
              lon: 114.36,
              lat: 30.53
            }
          }
        })
        .mockResolvedValueOnce({
          tool_name: 'spatial_core.search_nearby_pois',
          output: {
            pois: [
              { name: '瑞幸咖啡', category: '咖啡', distance_m: 120 }
            ],
            total_count: 1
          }
        })
    }

    const executor = createPlanExecutor({ toolRunner })
    const result = await executor.executePlan({
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
        },
        {
          step_id: 's2_search',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve.anchor',
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
      ]
    })

    expect(toolRunner.runTool).toHaveBeenNthCalledWith(2, {
      tool_name: 'spatial_core.search_nearby_pois',
      input: {
        anchor: {
          place_name: '武汉大学',
          role: 'primary',
          lon: 114.36,
          lat: 30.53
        },
        radius_m: 800,
        filter: {
          category: '餐饮美食',
          subcategory: '咖啡'
        },
        limit: 30
      }
    }, expect.any(Object))

    expect(result.execution_trace).toMatchObject({
      executed_steps: ['s1_resolve', 's2_search'],
      skipped_steps: [],
      query_count: 2,
      rounds_used: 1
    })
    expect(result.step_outputs.s2_search.total_count).toBe(1)
  })

  it('skips conditionally gated steps when the simple condition is not met', async () => {
    const toolRunner = {
      runTool: vi
        .fn()
        .mockResolvedValueOnce({
          tool_name: 'spatial_core.resolve_anchor',
          output: {
            anchor: { place_name: '武汉大学', role: 'primary' }
          }
        })
        .mockResolvedValueOnce({
          tool_name: 'spatial_core.search_nearby_pois',
          output: {
            pois: [{ name: '结果A' }],
            total_count: 9
          }
        })
    }

    const executor = createPlanExecutor({ toolRunner })
    const result = await executor.executePlan({
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
        },
        {
          step_id: 's2_search',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve.anchor',
            radius_m: 800,
            filter: {},
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's3_expand',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve.anchor',
            radius_m: 1200,
            filter: {},
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: '$ref:s2_search.total_count < 8'
        }
      ]
    })

    expect(toolRunner.runTool).toHaveBeenCalledTimes(2)
    expect(result.execution_trace.skipped_steps).toEqual(['s3_expand'])
  })

  it('passes runtime intent_spec into evidence bundle assembly so representative evidence follows the live intent', async () => {
    const intentSpec = createIntentSpecService().buildIntentSpec({
      userQuery: '湖北大学附近 1km 内的地铁站'
    })

    const toolRunner = {
      runTool: vi
        .fn()
        .mockResolvedValueOnce({
          tool_name: 'spatial_core.resolve_anchor',
          output: {
            anchor: {
              place_name: '湖北大学',
              display_name: '湖北大学',
              role: 'primary'
            }
          }
        })
        .mockResolvedValueOnce({
          tool_name: 'spatial_core.search_nearby_pois',
          output: {
            pois: [
              {
                id: 1,
                name: '湖北大学公交车站',
                categoryMain: '交通设施服务',
                categorySub: '公交车站',
                fused_score: 0.98,
                distance_m: 90
              },
              {
                id: 2,
                name: '湖北大学(地铁站)',
                categoryMain: '交通设施服务',
                categorySub: '地铁站',
                fused_score: 0.92,
                distance_m: 260
              }
            ],
            total_count: 2
          }
        })
    }

    const executor = createPlanExecutor({ toolRunner })
    const result = await executor.executePlan({
      steps: [
        {
          step_id: 's1_resolve',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '湖北大学',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's2_search',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve.anchor',
            radius_m: 1000,
            filter: {
              category: '交通设施服务',
              subcategory: '地铁站'
            },
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        }
      ]
    }, {
      user_query: '湖北大学附近 1km 内的地铁站',
      intent_spec: intentSpec
    })

    expect(result.evidence_bundle.evidence_profile).toMatchObject({
      target_entities: ['地铁站'],
      exclude_entities: ['公交车站']
    })
    expect(result.evidence_bundle.representative_pois.map((item) => item.name)).toEqual([
      '湖北大学(地铁站)'
    ])
  })
})
