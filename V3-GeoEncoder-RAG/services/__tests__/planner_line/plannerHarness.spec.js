import { afterEach, describe, expect, it, vi } from 'vitest'

import { PLANNER_FEW_SHOT_EXAMPLES } from '../../planner_line/plannerPrompts.js'
import {
  evaluatePlannerQueries,
  generatePlannerPlanForQuery,
  PLANNER_EVAL_QUERIES,
  summarizePlannerEvaluation
} from '../../planner_line/plannerHarness.js'

afterEach(() => {
  delete process.env.PLANNER_MODEL
  delete process.env.PLANNER_BASE_URL
})

describe('planner_line harness', () => {
  it('generates a validated planner plan for a query in one pass', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify(
      PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan
    ))

    const result = await generatePlannerPlanForQuery('武汉大学附近有哪些咖啡店？', {
      llmCall
    })

    expect(result.ok).toBe(true)
    expect(result.attempts).toHaveLength(1)
    expect(result.plan).toEqual(PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan)
  })

  it('uses one repair round when the first planner output is invalid', async () => {
    const llmCall = vi.fn()
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(JSON.stringify(
        PLANNER_FEW_SHOT_EXAMPLES[1].assistant_plan
      ))

    const result = await generatePlannerPlanForQuery('请概览武汉大学附近的空间结构和业态分布。', {
      llmCall,
      max_repairs: 1
    })

    expect(result.ok).toBe(true)
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0].validation.ok).toBe(false)
    expect(result.attempts[1].validation.ok).toBe(true)
  })

  it('passes the dedicated planner model into llm options when configured', async () => {
    process.env.PLANNER_MODEL = 'qwen3.5-4b-reasoning'
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify(
      PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan
    ))

    await generatePlannerPlanForQuery('武汉大学附近有哪些咖啡店？', {
      llmCall
    })

    expect(llmCall.mock.calls[0][1]).toMatchObject({
      model: 'qwen3.5-4b-reasoning'
    })
  })

  it('passes the dedicated planner baseUrl into llm options when configured', async () => {
    process.env.PLANNER_BASE_URL = 'http://127.0.0.1:18081/v1'
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify(
      PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan
    ))

    await generatePlannerPlanForQuery('武汉大学附近有哪些咖啡店？', {
      llmCall
    })

    expect(llmCall.mock.calls[0][1]).toMatchObject({
      baseUrl: 'http://127.0.0.1:18081/v1'
    })
  })

  it('supports a runtime prompt profile that reduces the injected few-shot turns for latency-sensitive planner calls', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify(
      PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan
    ))

    await generatePlannerPlanForQuery('湖北大学附近有哪些地铁站？', {
      llmCall,
      prompt_profile: 'runtime'
    })

    expect(llmCall.mock.calls[0][0]).toHaveLength(4)
  })

  it('summarizes planner evaluation results by pass/fail and failure type', () => {
    const summary = summarizePlannerEvaluation([
      {
        ok: true,
        attempts: [{ validation: { ok: true, parse_error: null, validation_errors: [] } }]
      },
      {
        ok: false,
        attempts: [{ validation: { ok: false, parse_error: 'No JSON object start found in planner output', validation_errors: [] } }]
      },
      {
        ok: false,
        attempts: [{ validation: { ok: false, parse_error: null, validation_errors: ['plan.steps must be a non-empty array'] } }]
      }
    ])

    expect(summary).toMatchObject({
      total_queries: 3,
      passed_queries: 1,
      failed_queries: 2,
      parse_failures: 1,
      validation_failures: 1
    })
  })

  it('evaluates the standard 10 queries and keeps per-query details', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify(
      PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan
    ))

    const report = await evaluatePlannerQueries(PLANNER_EVAL_QUERIES.slice(0, 2), {
      llmCall
    })

    expect(report.results).toHaveLength(2)
    expect(report.summary.total_queries).toBe(2)
    expect(report.results[0]).toMatchObject({
      user_query: PLANNER_EVAL_QUERIES[0],
      ok: true
    })
  })
})
