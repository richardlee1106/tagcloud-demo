import { describe, expect, it } from 'vitest'

import { PLANNER_FEW_SHOT_EXAMPLES } from '../../planner_line/plannerPrompts.js'
import {
  buildPlannerRepairPrompt,
  extractPlannerPlanCandidates,
  extractPlannerPlanJson,
  validatePlannerModelOutput
} from '../../planner_line/plannerOutputValidator.js'

describe('planner_line B2 output validation skeleton', () => {
  it('extracts a fenced JSON plan from model output text', () => {
    const rawOutput = [
      '下面是计划：',
      '```json',
      JSON.stringify(PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan, null, 2),
      '```'
    ].join('\n')

    const extracted = extractPlannerPlanJson(rawOutput)

    expect(extracted).toContain('"steps"')
    expect(extracted).toContain('"anchors"')
  })

  it('collects multiple json candidates when the model output contains more than one object-like segment', () => {
    const rawOutput = [
      JSON.stringify(PLANNER_FEW_SHOT_EXAMPLES[1].assistant_plan, null, 2),
      '',
      '```json',
      '{"task_type_hint":"area_analysis"}',
      '```'
    ].join('\n')

    const candidates = extractPlannerPlanCandidates(rawOutput)

    expect(candidates.length).toBeGreaterThanOrEqual(2)
  })

  it('returns validator-clean result for a valid planner response payload', () => {
    const result = validatePlannerModelOutput(JSON.stringify(PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan))

    expect(result.ok).toBe(true)
    expect(result.plan).toEqual(PLANNER_FEW_SHOT_EXAMPLES[0].assistant_plan)
    expect(result.errors).toEqual([])
  })

  it('prefers the validator-clean planner plan when later fenced json blocks are invalid', () => {
    const rawOutput = [
      JSON.stringify(PLANNER_FEW_SHOT_EXAMPLES[2].assistant_plan, null, 2),
      '',
      '```json',
      JSON.stringify({
        task_type_hint: 'area_analysis'
      }, null, 2),
      '```'
    ].join('\n')

    const result = validatePlannerModelOutput(rawOutput)

    expect(result.ok).toBe(true)
    expect(result.plan).toEqual(PLANNER_FEW_SHOT_EXAMPLES[2].assistant_plan)
  })

  it('reports parse errors for non-json model output', () => {
    const result = validatePlannerModelOutput('这不是 JSON')

    expect(result.ok).toBe(false)
    expect(result.parse_error).toBeTruthy()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('reports schema errors when the JSON parses but the plan is invalid', () => {
    const result = validatePlannerModelOutput(JSON.stringify({
      user_goal: '坏计划',
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
    }))

    expect(result.ok).toBe(false)
    expect(result.parse_error).toBeNull()
    expect(result.validation_errors.length).toBeGreaterThan(0)
  })

  it('builds a repair prompt that feeds back validation failures to the planner model', () => {
    const repairPrompt = buildPlannerRepairPrompt({
      user_query: '武汉大学附近有哪些咖啡店？',
      errors: ['plan.steps must be a non-empty array']
    })

    expect(repairPrompt).toContain('武汉大学附近有哪些咖啡店？')
    expect(repairPrompt).toContain('plan.steps must be a non-empty array')
    expect(repairPrompt).toContain('只输出一个合法 JSON 对象')
  })

  it('tells the model not to continue or quote the broken prior output verbatim', () => {
    const repairPrompt = buildPlannerRepairPrompt({
      user_query: '请分析武汉大学附近的配套、热门业态和明显缺口。',
      errors: ['plan.answer_frame.style must be one of: lookup, gap, overview, comparison']
    })

    expect(repairPrompt).toContain('不要复述或修补上一次的输出')
    expect(repairPrompt).not.toContain('原始输出摘要')
  })
})
