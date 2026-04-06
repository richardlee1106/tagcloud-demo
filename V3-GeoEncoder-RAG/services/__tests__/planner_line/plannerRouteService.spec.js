import { describe, expect, it, vi } from 'vitest'

import { createPlannerDemoService } from '../../planner_line/plannerRouteService.js'

describe('plannerRouteService', () => {
  it('extracts the latest user query from chat messages and returns a demo response payload', async () => {
    const runSingleRoundPlannerQuery = vi.fn().mockResolvedValue({
      ok: true,
      planning: {
        source: 'planner_model',
        plan: {
          task_type_hint: 'nearby_lookup'
        }
      },
      execution: {
        execution_trace: {
          executed_steps: ['s1', 's2'],
          query_count: 2
        },
        evidence_bundle: {
          nearby_pois: [{ name: '瑞幸咖啡' }]
        }
      },
      synthesis: {
        answer: '当前证据里比较相关的地点包括：瑞幸咖啡。',
        source: 'fallback_summary'
      }
    })

    const service = createPlannerDemoService({
      runSingleRoundPlannerQuery
    })

    const result = await service.runChatRequest({
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好，有什么可以帮你的？' },
        { role: 'user', content: '武汉大学附近有哪些咖啡店？' }
      ]
    })

    expect(runSingleRoundPlannerQuery).toHaveBeenCalledWith(
      '武汉大学附近有哪些咖啡店？',
      expect.objectContaining({
        planningOptions: expect.any(Object)
      })
    )
    expect(result).toMatchObject({
      success: true,
      backend: 'planner_line_prototype',
      query: '武汉大学附近有哪些咖啡店？',
      answer: {
        text: '当前证据里比较相关的地点包括：瑞幸咖啡。',
        source: 'fallback_summary'
      },
      planning: {
        source: 'planner_model'
      },
      execution: {
        trace: {
          executed_steps: ['s1', 's2']
        }
      }
    })
  })

  it('defaults demo synthesis mode to fallback and rejects empty message payloads', async () => {
    const runSingleRoundPlannerQuery = vi.fn().mockResolvedValue({
      ok: false,
      stage: 'planning'
    })

    const service = createPlannerDemoService({
      runSingleRoundPlannerQuery
    })

    await expect(service.runChatRequest({ messages: [] })).rejects.toThrow('messages is required')

    await service.runChatRequest({
      messages: [
        { role: 'user', content: '武汉大学附近有哪些咖啡店？' }
      ]
    })

    expect(runSingleRoundPlannerQuery).toHaveBeenCalledWith(
      '武汉大学附近有哪些咖啡店？',
      expect.objectContaining({
        synthesisMode: 'fallback'
      })
    )
  })

  it('forwards spatialContext into the planner runner so geometry-aware intent specs can be built on the main path', async () => {
    const runSingleRoundPlannerQuery = vi.fn().mockResolvedValue({
      ok: true,
      planning: {
        source: 'planner_model',
        plan: {
          task_type_hint: 'area_overview'
        }
      },
      execution: {
        execution_trace: {
          executed_steps: ['s1'],
          query_count: 1
        },
        evidence_bundle: {
          support_buckets: [{ bucket: '餐饮配套', count: 2 }]
        }
      },
      synthesis: {
        answer: '当前圈选范围内以餐饮配套为主。',
        source: 'fallback_summary'
      }
    })

    const service = createPlannerDemoService({
      runSingleRoundPlannerQuery
    })

    const spatialContext = {
      boundary: [
        [114.36, 30.53],
        [114.37, 30.53],
        [114.37, 30.54],
        [114.36, 30.54]
      ]
    }

    await service.runChatRequest({
      messages: [
        { role: 'user', content: '这个圈里的业态分布如何？' }
      ],
      options: {
        synthesisMode: 'fallback',
        spatialContext
      }
    })

    expect(runSingleRoundPlannerQuery).toHaveBeenCalledWith(
      '这个圈里的业态分布如何？',
      expect.objectContaining({
        synthesisMode: 'fallback',
        spatialContext
      })
    )
  })

  it('uses the runtime planner prompt profile and tighter token budget on the real chat path', async () => {
    const runSingleRoundPlannerQuery = vi.fn().mockResolvedValue({
      ok: true,
      planning: {
        source: 'planner_model',
        plan: {
          task_type_hint: 'nearby_lookup'
        }
      },
      execution: {
        execution_trace: {
          executed_steps: ['s1', 's2'],
          query_count: 2
        },
        evidence_bundle: {
          nearby_pois: [{ name: '湖北大学地铁站' }]
        }
      },
      synthesis: {
        answer: '当前证据里检索到了湖北大学附近的地铁站。',
        source: 'llm_summary'
      }
    })

    const service = createPlannerDemoService({
      runSingleRoundPlannerQuery
    })

    await service.runChatRequest({
      messages: [
        { role: 'user', content: '湖北大学附近有哪些地铁站？' }
      ],
      options: {
        synthesisMode: 'llm'
      }
    })

    expect(runSingleRoundPlannerQuery).toHaveBeenCalledWith(
      '湖北大学附近有哪些地铁站？',
      expect.objectContaining({
        synthesisMode: 'llm',
        planningOptions: expect.objectContaining({
          prompt_profile: 'runtime',
          llm_options: expect.objectContaining({
            temperature: 0,
            maxTokens: 1024
          })
        })
      })
    )
  })
})
