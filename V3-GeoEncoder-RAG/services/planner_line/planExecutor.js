import { createToolRunner } from '../spatial_core/toolRunner.js'
import { buildEvidenceBundle } from './evidenceBundle.js'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveRefString(value, stepOutputs = {}) {
  const match = String(value || '').match(/^\$ref:([a-z0-9_]+)\.([a-z0-9_.]+)$/u)
  if (!match) return value

  const [, stepId, fieldPath] = match
  const source = stepOutputs[stepId]
  return fieldPath.split('.').reduce((current, segment) => current?.[segment], source)
}

function resolveRefs(value, stepOutputs = {}) {
  if (typeof value === 'string') {
    return resolveRefString(value, stepOutputs)
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveRefs(item, stepOutputs))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveRefs(item, stepOutputs)])
    )
  }
  return value
}

function evaluateCondition(condition, stepOutputs = {}) {
  if (condition === null || condition === undefined || condition === '') return true

  const match = String(condition).trim().match(/^\$ref:([a-z0-9_]+)\.([a-z0-9_.]+)\s*(<=|>=|<|>|===|==|!==|!=)\s*(.+)$/u)
  if (!match) return false

  const [, stepId, fieldPath, operator, rawExpected] = match
  const actual = fieldPath.split('.').reduce((current, segment) => current?.[segment], stepOutputs[stepId])
  let expected = rawExpected.trim()

  if (/^(true|false)$/i.test(expected)) {
    expected = expected.toLowerCase() === 'true'
  } else if (/^null$/i.test(expected)) {
    expected = null
  } else if (/^-?\d+(\.\d+)?$/u.test(expected)) {
    expected = Number(expected)
  } else {
    expected = expected.replace(/^['"]|['"]$/g, '')
  }

  switch (operator) {
    case '<': return actual < expected
    case '<=': return actual <= expected
    case '>': return actual > expected
    case '>=': return actual >= expected
    case '==': return actual == expected
    case '===': return actual === expected
    case '!=': return actual != expected
    case '!==': return actual !== expected
    default: return false
  }
}

export function createPlanExecutor({
  toolRunner = createToolRunner()
} = {}) {
  return {
    async executePlan(plan = {}, context = {}) {
      const stepOutputs = {}
      const executedSteps = []
      const skippedSteps = []

      for (const step of Array.isArray(plan?.steps) ? plan.steps : []) {
        if (!evaluateCondition(step.condition, stepOutputs)) {
          skippedSteps.push(step.step_id)
          continue
        }

        const resolvedInput = resolveRefs(step.input, stepOutputs)
        const result = await toolRunner.runTool({
          tool_name: step.tool,
          input: resolvedInput
        }, {
          ...context,
          step_id: step.step_id,
          step_outputs: stepOutputs
        })

        stepOutputs[step.step_id] = result.output
        executedSteps.push(step.step_id)
      }

      const executionTrace = {
        executed_steps: executedSteps,
        skipped_steps: skippedSteps,
        query_count: executedSteps.length,
        rounds_used: 1
      }

      return {
        step_outputs: stepOutputs,
        execution_trace: executionTrace,
        evidence_bundle: buildEvidenceBundle({
          stepOutputs,
          executionTrace,
          plan,
          intentSpec: context?.intent_spec || context?.intentSpec || null
        })
      }
    }
  }
}

export default {
  createPlanExecutor
}
