import { describe, expect, it } from 'vitest'

import {
  buildPlannerPromptBundle,
  buildPlannerSystemPrompt,
  PLANNER_FEW_SHOT_EXAMPLES
} from '../../planner_line/plannerPrompts.js'
import { PLANNER_ALLOWED_TOOLS, validatePlannerPlan } from '../../planner_line/planValidator.js'
import {
  getToolCatalog,
  getToolDefinition,
  SPATIAL_TOOL_CATALOG
} from '../../spatial_core/toolCatalog.js'
import {
  getToolSchema,
  SPATIAL_TOOL_NAMES,
  SPATIAL_TOOL_SCHEMAS,
  validateToolInputShape
} from '../../spatial_core/toolSchemas.js'
import { createToolRunner } from '../../spatial_core/toolRunner.js'

describe('planner_line B2 tool contracts', () => {
  it('registers every planner-allowed tool in the spatial_core catalog', () => {
    expect(SPATIAL_TOOL_NAMES).toEqual(PLANNER_ALLOWED_TOOLS)
    expect(getToolCatalog()).toEqual(SPATIAL_TOOL_CATALOG)
  })

  it('exposes complete tool definitions and schemas for every registered tool', () => {
    for (const toolName of SPATIAL_TOOL_NAMES) {
      const definition = getToolDefinition(toolName)
      const schema = getToolSchema(toolName)

      expect(definition).toMatchObject({
        tool_name: toolName,
        description: expect.any(String),
        handler_key: expect.any(String),
        reliability: expect.any(String)
      })

      expect(schema).toMatchObject({
        tool_name: toolName,
        input_schema: expect.any(Object),
        output_schema: expect.any(Object)
      })
    }
  })

  it('documents search_nearby_pois as a PostGIS-first tool without embedding controls in planner-facing input', () => {
    const definition = getToolDefinition('spatial_core.search_nearby_pois')
    const schema = getToolSchema('spatial_core.search_nearby_pois')

    expect(definition.description).toContain('PostGIS')
    expect(definition.planning_notes).toContain('embedding')
    expect(schema.input_schema.required).toEqual(['anchor', 'radius_m', 'filter', 'limit'])
    expect(schema.input_schema.properties).not.toHaveProperty('query_embedding')
    expect(schema.input_schema.properties).not.toHaveProperty('semantic_weight')
  })

  it('rejects planner-facing input that includes disallowed internal retrieval fields', () => {
    const result = validateToolInputShape('spatial_core.search_nearby_pois', {
      anchor: '$ref:s1_resolve_primary_anchor.anchor',
      radius_m: 800,
      filter: {
        category: '餐饮美食',
        embedding_dim: 352
      },
      limit: 30
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('embedding_dim')
    ]))
  })
})

describe('planner_line B2 tool runner', () => {
  it('lists all registered tools and rejects missing handlers in the B2 skeleton', async () => {
    const runner = createToolRunner()

    expect(runner.listTools()).toEqual(SPATIAL_TOOL_NAMES)

    await expect(runner.runTool({
      tool_name: 'spatial_core.resolve_anchor',
      input: {
        place_name: '武汉大学'
      }
    })).rejects.toThrow('No handler registered')
  })

  it('invokes a registered handler and returns its output with the tool name', async () => {
    const runner = createToolRunner({
      handlers: {
        resolve_anchor: async (input) => ({
          anchor: {
            place_name: input.place_name,
            role: input.role || 'primary'
          }
        })
      }
    })

    await expect(runner.runTool({
      tool_name: 'spatial_core.resolve_anchor',
      input: {
        place_name: '武汉大学',
        role: 'primary'
      }
    })).resolves.toEqual({
      tool_name: 'spatial_core.resolve_anchor',
      output: {
        anchor: {
          place_name: '武汉大学',
          role: 'primary'
        }
      }
    })
  })
})

describe('planner_line B2 prompts', () => {
  it('builds a system prompt that references the B1 contract and all available tools', () => {
    const prompt = buildPlannerSystemPrompt()

    expect(prompt).toContain('snake_case')
    expect(prompt).toContain('anchors[]')
    expect(prompt).toContain('steps')

    for (const toolName of SPATIAL_TOOL_NAMES) {
      expect(prompt).toContain(toolName)
    }
  })

  it('ships stronger few-shot examples whose assistant plans are themselves validator-clean', () => {
    expect(PLANNER_FEW_SHOT_EXAMPLES.length).toBeGreaterThanOrEqual(5)

    for (const example of PLANNER_FEW_SHOT_EXAMPLES) {
      expect(example).toMatchObject({
        user_query: expect.any(String),
        why_this_plan: expect.any(String),
        assistant_plan: expect.any(Object)
      })

      const validation = validatePlannerPlan(example.assistant_plan)
      expect(validation.ok).toBe(true)
    }

    const gapExample = PLANNER_FEW_SHOT_EXAMPLES.find((example) =>
      example.assistant_plan?.task_type_hint === 'support_gap_analysis'
    )

    expect(gapExample).toBeTruthy()
    expect(gapExample.assistant_plan.answer_frame.style).toBe('gap')
  })

  it('builds a prompt bundle with serialized few-shot turns and an explicit output contract reminder', () => {
    expect(PLANNER_FEW_SHOT_EXAMPLES.length).toBeGreaterThanOrEqual(5)

    const promptBundle = buildPlannerPromptBundle({
      user_query: '武汉大学附近有哪些咖啡店？'
    })

    expect(promptBundle).toMatchObject({
      system_prompt: expect.any(String),
      user_prompt: expect.stringContaining('武汉大学附近有哪些咖啡店？'),
      few_shot_examples: expect.any(Array),
      messages: expect.any(Array),
      output_contract: expect.any(String)
    })
    expect(promptBundle.few_shot_examples.length).toBeGreaterThanOrEqual(2)
    expect(promptBundle.messages.length).toBeGreaterThanOrEqual(1 + promptBundle.few_shot_examples.length * 2 + 1)
    expect(promptBundle.output_contract).toContain('合法 JSON 对象')
  })

  it('spells out the required answer_frame style mapping for macro analysis tasks', () => {
    const prompt = buildPlannerSystemPrompt()

    expect(prompt).toContain('support_gap_analysis -> gap')
    expect(prompt).toContain('site_suitability -> gap')
    expect(prompt).toContain('area_overview -> overview')
    expect(prompt).toContain('region_comparison -> comparison')
  })

  it('selects the most relevant few-shot examples for comparison queries instead of injecting every example', () => {
    const promptBundle = buildPlannerPromptBundle({
      user_query: '比较武汉大学和湖北大学附近的业态差异。'
    })

    expect(promptBundle.few_shot_examples.length).toBeLessThan(PLANNER_FEW_SHOT_EXAMPLES.length)
    expect(promptBundle.few_shot_examples.some((example) =>
      example.assistant_plan?.task_type_hint === 'region_comparison'
    )).toBe(true)
    expect(promptBundle.few_shot_examples.some((example) =>
      example.assistant_plan?.task_type_hint === 'nearby_lookup'
    )).toBe(true)
  })

  it('builds a runtime prompt profile that keeps only the most relevant few-shot example for latency-sensitive planner calls', () => {
    const nearbyRuntimeBundle = buildPlannerPromptBundle({
      user_query: '湖北大学附近有哪些地铁站？',
      prompt_profile: 'runtime'
    })

    expect(nearbyRuntimeBundle.few_shot_examples).toHaveLength(1)
    expect(nearbyRuntimeBundle.few_shot_examples[0].assistant_plan.task_type_hint).toBe('nearby_lookup')
    expect(nearbyRuntimeBundle.messages.length).toBe(4)

    const comparisonRuntimeBundle = buildPlannerPromptBundle({
      user_query: '比较武汉大学和湖北大学附近的业态差异。',
      prompt_profile: 'runtime'
    })

    expect(comparisonRuntimeBundle.few_shot_examples).toHaveLength(1)
    expect(comparisonRuntimeBundle.few_shot_examples[0].assistant_plan.task_type_hint).toBe('region_comparison')
    expect(comparisonRuntimeBundle.messages.length).toBe(4)
  })

  it('builds a slimmer runtime system prompt that drops verbose tool catalog notes while keeping the full profile unchanged', () => {
    const fullBundle = buildPlannerPromptBundle({
      user_query: '湖北大学附近有哪些地铁站？'
    })
    const runtimeBundle = buildPlannerPromptBundle({
      user_query: '湖北大学附近有哪些地铁站？',
      prompt_profile: 'runtime'
    })

    expect(fullBundle.system_prompt).toContain('planning_notes:')
    expect(runtimeBundle.system_prompt).not.toContain('planning_notes:')
    expect(runtimeBundle.system_prompt.length).toBeLessThan(fullBundle.system_prompt.length)
  })
})
