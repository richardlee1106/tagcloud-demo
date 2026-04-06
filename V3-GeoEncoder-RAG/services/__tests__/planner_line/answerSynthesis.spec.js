import { afterEach, describe, expect, it, vi } from 'vitest'

import { synthesizeAnswer } from '../../planner_line/answerSynthesis.js'

afterEach(() => {
  delete process.env.ANSWER_SYNTHESIS_MODEL
  delete process.env.ANSWER_SYNTHESIS_BASE_URL
})

describe('answerSynthesis', () => {
  it('passes evidence bundle into the llm synthesizer when a model is available', async () => {
    const llmCall = vi.fn().mockResolvedValue('基于证据，武汉大学附近咖啡店较多。')

    const result = await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: {
        answer_frame: {
          style: 'lookup',
          must_ground_in_evidence: true,
          required_sections: ['result_list'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        nearby_pois: [{ name: '瑞幸咖啡' }],
        support_buckets: [],
        execution_trace: {
          executed_steps: ['s1', 's2']
        }
      },
      llmCall
    })

    expect(llmCall).toHaveBeenCalledTimes(1)
    const messages = llmCall.mock.calls[0][0]
    expect(messages[0].content).toContain('直接回答用户问题')
    expect(messages[0].content).toContain('不要分析 JSON')
    expect(messages[0].content).toContain('如果是 lookup')
    expect(messages[1].content).toContain('synthesis_brief:')
    expect(messages[1].content).not.toContain('evidence_slice:')
    expect(result.brief).toMatchObject({
      style: 'lookup',
      representative_examples: ['瑞幸咖啡']
    })
    expect(result.answer).toBe('基于证据，武汉大学附近咖啡店较多。')
  })

  it('passes the dedicated synthesis model override to llmCall when configured', async () => {
    process.env.ANSWER_SYNTHESIS_MODEL = 'qwen3-4b-instruct-2507-q8'
    const llmCall = vi.fn().mockResolvedValue('基于证据，武汉大学附近有咖啡店。')

    await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: {
        answer_frame: {
          style: 'lookup',
          must_ground_in_evidence: true,
          required_sections: ['result_list'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        nearby_pois: [{ name: '瑞幸咖啡' }]
      },
      llmCall
    })

    expect(llmCall.mock.calls[0][1]).toMatchObject({
      model: 'qwen3-4b-instruct-2507-q8'
    })
  })

  it('passes the dedicated synthesis baseUrl override to llmCall when configured', async () => {
    process.env.ANSWER_SYNTHESIS_BASE_URL = 'http://127.0.0.1:18082/v1'
    const llmCall = vi.fn().mockResolvedValue('基于证据，武汉大学附近有咖啡店。')

    await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: {
        answer_frame: {
          style: 'lookup',
          must_ground_in_evidence: true,
          required_sections: ['result_list'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        nearby_pois: [{ name: '瑞幸咖啡' }]
      },
      llmCall
    })

    expect(llmCall.mock.calls[0][1]).toMatchObject({
      baseUrl: 'http://127.0.0.1:18082/v1'
    })
  })

  it('falls back when the llm returns meta-analysis of the evidence bundle instead of an answer', async () => {
    const llmCall = vi.fn().mockResolvedValue('1. 分析该 JSON 数据结构的整体架构，2. 分析其核心字段及其语义')

    const result = await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: {
        answer_frame: {
          style: 'lookup',
          must_ground_in_evidence: true,
          required_sections: ['result_list'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        nearby_pois: [
          { name: '瑞幸咖啡', distance_m: 120 },
          { name: 'Manner Coffee', distance_m: 260 }
        ],
        support_buckets: [],
        execution_trace: {
          executed_steps: ['s1', 's2']
        }
      },
      llmCall
    })

    expect(result.source).toBe('fallback_summary')
    expect(result.answer).toContain('瑞幸咖啡')
  })

  it('trims prompt-leakage tails from llm synthesis output when the leading answer is still usable', async () => {
    const llmCall = vi.fn().mockResolvedValue(
      '武汉大学附近有瑞幸咖啡、Manner Coffee等咖啡店，最近的一家约120米。<|endoftext|>Human: 请继续'
    )

    const result = await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: {
        answer_frame: {
          style: 'lookup',
          must_ground_in_evidence: true,
          required_sections: ['result_list'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        representative_pois: [
          { name: '瑞幸咖啡', distance_m: 120 },
          { name: 'Manner Coffee', distance_m: 260 }
        ],
        nearby_pois: [
          { name: '瑞幸咖啡', distance_m: 120 },
          { name: 'Manner Coffee', distance_m: 260 }
        ]
      },
      llmCall
    })

    expect(result.source).toBe('llm_synthesis')
    expect(result.answer).toBe('武汉大学附近有瑞幸咖啡、Manner Coffee等咖啡店，最近的一家约120米。')
  })

  it('falls back when llm synthesis starts echoing synthesis brief payloads or prompt instructions', async () => {
    const llmCall = vi.fn().mockResolvedValue(
      '- synthesis_brief:\n{"anchor":"武汉大学"}\n武汉大学周边以校园为核心。\n请直接输出面向用户的中文回答，尽量简洁，避免模板腔。'
    )

    const result = await synthesizeAnswer({
      user_query: '请概览武汉大学附近的空间结构和业态分布。',
      plan: {
        answer_frame: {
          style: 'overview',
          must_ground_in_evidence: true,
          required_sections: ['spatial_structure', 'category_distribution'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        anchors: [{ place_name: '武汉大学', display_name: '武汉大学' }],
        representative_pois: [
          { name: '武汉大学', distance_m: 0 },
          { name: '临空港市民阅读中心', distance_m: 0 }
        ],
        spatial_summary: {
          spatial_clusters: [{ id: 'h1' }, { id: 'h2' }]
        }
      },
      llmCall
    })

    expect(result.source).toBe('fallback_summary')
    expect(result.answer).toContain('武汉大学周边')
  })

  it('returns a grounded fallback summary when llm synthesis is unavailable', async () => {
    const result = await synthesizeAnswer({
      user_query: '武汉大学附近有哪些咖啡店？',
      plan: {
        answer_frame: {
          style: 'lookup',
          must_ground_in_evidence: true,
          required_sections: ['result_list'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        nearby_pois: [
          { name: '瑞幸咖啡', distance_m: 120 },
          { name: 'Manner Coffee', distance_m: 260 }
        ],
        support_buckets: [],
        execution_trace: {
          executed_steps: ['s1', 's2']
        }
      },
      llmCall: null
    })

    expect(result.answer).toContain('瑞幸咖啡')
    expect(result.answer).toContain('Manner Coffee')
    expect(result.answer).toContain('共找到')
    expect(result.answer).toContain('最近')
    expect(result.answer.match(/瑞幸咖啡/g)?.length).toBe(1)
    expect(result.brief).toMatchObject({
      style: 'lookup',
      representative_examples: ['瑞幸咖啡', 'Manner Coffee']
    })
    expect(result.source).toBe('fallback_summary')
  })

  it('prefers representative transport stations over raw exit-level pois in fallback summaries', async () => {
    const result = await synthesizeAnswer({
      user_query: '湖北大学附近有哪些地铁站？',
      plan: {
        answer_frame: {
          style: 'lookup',
          must_ground_in_evidence: true,
          required_sections: ['result_list'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        representative_pois: [
          { name: '湖北大学(地铁站)' },
          { name: '秦园路(地铁站)' }
        ],
        nearby_pois: [
          { name: '湖北大学地铁站E口' },
          { name: '湖北大学地铁站A口' },
          { name: '秦园路地铁站H口' }
        ]
      },
      llmCall: null
    })

    expect(result.answer).toContain('湖北大学(地铁站)')
    expect(result.answer).toContain('秦园路(地铁站)')
    expect(result.answer).not.toContain('湖北大学地铁站E口')
    expect(result.answer).not.toContain('湖北大学地铁站A口')
  })

  it('builds a more narrative overview fallback summary from macro evidence', async () => {
    const result = await synthesizeAnswer({
      user_query: '请概览武汉大学附近的空间结构和业态分布。',
      plan: {
        answer_frame: {
          style: 'overview',
          must_ground_in_evidence: true,
          required_sections: ['spatial_structure', 'category_distribution'],
          forbidden_claims: []
        }
      },
      evidence_bundle: {
        anchors: [{ place_name: '武汉大学', display_name: '武汉大学' }],
        representative_pois: [
          { name: '瑞幸咖啡', distance_m: 120 },
          { name: '武汉大学医院', distance_m: 260 }
        ],
        support_buckets: [
          { bucket: '餐饮配套', count: 12 },
          { bucket: '校园服务', count: 9 },
          { bucket: '医疗配套', count: 4 }
        ],
        scene_tags: ['高校周边', '混合业态'],
        cell_mix: [
          { label: '教育类', count: 2, ratio: 0.67 },
          { label: '商业类', count: 1, ratio: 0.33 }
        ],
        spatial_summary: {
          spatial_clusters: [{ id: 'h1' }, { id: 'h2' }]
        }
      },
      llmCall: null
    })

    expect(result.answer).toContain('武汉大学周边')
    expect(result.answer).toContain('餐饮配套')
    expect(result.answer).toContain('校园服务')
    expect(result.answer).toContain('高校周边')
    expect(result.answer).toContain('教育类')
    expect(result.answer).toContain('瑞幸咖啡')
  })
})
