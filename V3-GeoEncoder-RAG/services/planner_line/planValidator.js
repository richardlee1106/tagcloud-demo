import {
  PLANNER_ALLOWED_TOOLS,
  PLANNER_LEGACY_DISALLOWED_KEYS,
  PLANNER_SCHEMA,
  PLANNER_TOOL_SCHEMAS
} from './plannerSchema.js'
import {
  ANSWER_FRAME_STYLE_VALUES,
  PLANNER_CONDITION_REFERENCE_PATTERN,
  PLANNER_REFERENCE_PATTERN,
  PLANNER_REQUIRED_ANCHOR_FIELDS,
  PLANNER_REQUIRED_ANSWER_FRAME_FIELDS,
  PLANNER_REQUIRED_STEP_FIELDS,
  PLANNER_REQUIRED_TOP_LEVEL_FIELDS,
  PLANNER_SCHEMA_VERSION,
  PLANNER_SNAKE_CASE_KEY_PATTERN,
  PLANNER_STEP_ID_PATTERN,
  PLANNER_STOP_CONDITION_FIELDS,
  TASK_TYPE_HINT_VALUES
} from './plannerTypes.js'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pushRequiredFieldErrors(containerName, value, requiredFields, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${containerName} must be an object`)
    return
  }

  for (const field of requiredFields) {
    if (!(field in value)) {
      errors.push(`${containerName}.${field} is required`)
    }
  }
}

function validateSnakeCaseKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateSnakeCaseKeys(item, `${path}[${index}]`, errors))
    return
  }

  if (!isPlainObject(value)) return

  for (const key of Object.keys(value)) {
    if (!PLANNER_SNAKE_CASE_KEY_PATTERN.test(key)) {
      errors.push(`${path}.${key} must use snake_case`)
    }
    validateSnakeCaseKeys(value[key], `${path}.${key}`, errors)
  }
}

function collectRefs(value, refs = []) {
  if (typeof value === 'string') {
    const directMatch = value.match(PLANNER_REFERENCE_PATTERN)
    if (directMatch) {
      refs.push({
        type: 'direct',
        step_id: directMatch[1],
        field_path: directMatch[2],
        raw: value
      })
      return refs
    }

    for (const match of value.matchAll(PLANNER_CONDITION_REFERENCE_PATTERN)) {
      refs.push({
        type: 'condition',
        step_id: match[1],
        field_path: match[2],
        raw: match[0]
      })
    }
    return refs
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs))
    return refs
  }

  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => collectRefs(item, refs))
  }

  return refs
}

function validateAnchorDescriptor(anchor, path, errors) {
  pushRequiredFieldErrors(path, anchor, PLANNER_REQUIRED_ANCHOR_FIELDS, errors)
  if (!isPlainObject(anchor)) return

  if (typeof anchor.place_name !== 'string' || !anchor.place_name.trim()) {
    errors.push(`${path}.place_name must be a non-empty string`)
  }
  if (typeof anchor.role !== 'string' || !anchor.role.trim()) {
    errors.push(`${path}.role must be a non-empty string`)
  }
}

function validateToolSchema(step, stepIndex, errors) {
  const toolSchema = PLANNER_TOOL_SCHEMAS[step.tool]
  if (!toolSchema) return

  const stepPath = `steps[${stepIndex}]`
  const input = step.input

  if (!isPlainObject(input)) {
    errors.push(`${stepPath}.input must be an object`)
    return
  }

  for (const field of toolSchema.required_input_fields) {
    if (!(field in input)) {
      errors.push(`${stepPath}.input.${field} is required for ${step.tool}`)
    }
  }

  for (const key of Object.keys(input)) {
    if (!toolSchema.allowed_input_fields.includes(key)) {
      errors.push(`${stepPath}.input.${key} is not allowed for ${step.tool}`)
    }
    if (toolSchema.disallowed_input_fields.includes(key)) {
      errors.push(`${stepPath}.input.${key} is not allowed for ${step.tool}`)
    }
  }

  for (const field of toolSchema.required_expect_output_fields) {
    if (!step.expect_output.includes(field)) {
      errors.push(`${stepPath}.expect_output must include ${field} for ${step.tool}`)
    }
  }

  if (step.tool === 'spatial_core.search_nearby_pois') {
    if ('lon' in input || 'lat' in input) {
      errors.push(`${stepPath}.input.anchor must be used instead of flat lon/lat fields`)
    }
    if (!isPlainObject(input.filter)) {
      errors.push(`${stepPath}.input.filter must be an object`)
    } else {
      for (const key of Object.keys(input.filter)) {
        if (!toolSchema.allowed_filter_keys.includes(key)) {
          errors.push(`${stepPath}.input.filter.${key} is not allowed for ${step.tool}`)
        }
        if (toolSchema.disallowed_filter_keys.includes(key)) {
          errors.push(`${stepPath}.input.filter.${key} is not allowed for ${step.tool}`)
        }
      }
    }
  }

  if ('filter' in input && input.filter !== undefined && input.filter !== null && step.tool !== 'spatial_core.search_nearby_pois') {
    if (!isPlainObject(input.filter)) {
      errors.push(`${stepPath}.input.filter must be an object`)
    } else if (Array.isArray(toolSchema.allowed_filter_keys) && toolSchema.allowed_filter_keys.length > 0) {
      for (const key of Object.keys(input.filter)) {
        if (!toolSchema.allowed_filter_keys.includes(key)) {
          errors.push(`${stepPath}.input.filter.${key} is not allowed for ${step.tool}`)
        }
        if (Array.isArray(toolSchema.disallowed_filter_keys) && toolSchema.disallowed_filter_keys.includes(key)) {
          errors.push(`${stepPath}.input.filter.${key} is not allowed for ${step.tool}`)
        }
      }
    }
  }
}

function validateStep(step, stepIndex, seenStepIds, errors) {
  const stepPath = `steps[${stepIndex}]`
  pushRequiredFieldErrors(stepPath, step, PLANNER_REQUIRED_STEP_FIELDS, errors)
  if (!isPlainObject(step)) return

  if (typeof step.step_id !== 'string' || !PLANNER_STEP_ID_PATTERN.test(step.step_id)) {
    errors.push(`${stepPath}.step_id must be a snake_case-like identifier`)
  } else if (seenStepIds.has(step.step_id)) {
    errors.push(`${stepPath}.step_id must be unique`)
  } else {
    seenStepIds.add(step.step_id)
  }

  if (!PLANNER_ALLOWED_TOOLS.includes(step.tool)) {
    errors.push(`${stepPath}.tool ${step.tool} is not registered`)
  }

  if (!Array.isArray(step.expect_output) || step.expect_output.length === 0) {
    errors.push(`${stepPath}.expect_output must be a non-empty array`)
  } else {
    for (const field of step.expect_output) {
      if (typeof field !== 'string' || !PLANNER_SNAKE_CASE_KEY_PATTERN.test(field)) {
        errors.push(`${stepPath}.expect_output values must be snake_case strings`)
      }
    }
  }

  if (!(step.condition === null || typeof step.condition === 'string')) {
    errors.push(`${stepPath}.condition must be null or a string`)
  }

  // B1 only reserves condition as a string field and validates $ref dependencies.
  // Full condition grammar / AST validation is intentionally deferred to phase D.
  validateToolSchema(step, stepIndex, errors)
}

function validateRefs(plan, errors) {
  const stepOrder = new Map(plan.steps.map((step, index) => [step.step_id, index]))

  plan.steps.forEach((step, index) => {
    const refs = [
      ...collectRefs(step.input),
      ...collectRefs(step.condition)
    ]

    refs.forEach((ref) => {
      if (!stepOrder.has(ref.step_id)) {
        errors.push(`steps[${index}] references unknown step ${ref.step_id}`)
        return
      }

      if (stepOrder.get(ref.step_id) >= index) {
        errors.push(`steps[${index}] cannot reference future step ${ref.step_id}`)
      }
    })
  })
}

export function validatePlannerPlan(plan) {
  const errors = []

  if (!isPlainObject(plan)) {
    return {
      ok: false,
      errors: ['plan must be an object']
    }
  }

  validateSnakeCaseKeys(plan, 'plan', errors)

  for (const key of PLANNER_LEGACY_DISALLOWED_KEYS) {
    if (key in plan) {
      errors.push(`plan.${key} is legacy contract baggage; use anchors[] and snake_case fields instead`)
    }
  }

  for (const field of PLANNER_REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in plan)) {
      errors.push(`plan.${field} is required`)
    }
  }

  if ('task_type_hint' in plan && !TASK_TYPE_HINT_VALUES.includes(plan.task_type_hint)) {
    errors.push(`plan.task_type_hint must be one of: ${TASK_TYPE_HINT_VALUES.join(', ')}`)
  }

  if (typeof plan.user_goal !== 'string' || !plan.user_goal.trim()) {
    errors.push('plan.user_goal must be a non-empty string')
  }

  if (!Array.isArray(plan.anchors) || plan.anchors.length === 0) {
    errors.push('plan.anchors must be a non-empty array')
  } else {
    plan.anchors.forEach((anchor, index) => validateAnchorDescriptor(anchor, `plan.anchors[${index}]`, errors))
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('plan.steps must be a non-empty array')
  } else {
    const seenStepIds = new Set()
    plan.steps.forEach((step, index) => validateStep(step, index, seenStepIds, errors))
  }

  pushRequiredFieldErrors('plan.stop_conditions', plan.stop_conditions, PLANNER_STOP_CONDITION_FIELDS, errors)
  if (isPlainObject(plan.stop_conditions)) {
    for (const key of PLANNER_STOP_CONDITION_FIELDS) {
      const value = Number(plan.stop_conditions[key])
      if (!Number.isInteger(value) || value < 1) {
        errors.push(`plan.stop_conditions.${key} must be a positive integer`)
      }
    }
  }

  pushRequiredFieldErrors('plan.answer_frame', plan.answer_frame, PLANNER_REQUIRED_ANSWER_FRAME_FIELDS, errors)
  if (isPlainObject(plan.answer_frame)) {
    if (!ANSWER_FRAME_STYLE_VALUES.includes(plan.answer_frame.style)) {
      errors.push(`plan.answer_frame.style must be one of: ${ANSWER_FRAME_STYLE_VALUES.join(', ')}`)
    }
    if (typeof plan.answer_frame.must_ground_in_evidence !== 'boolean') {
      errors.push('plan.answer_frame.must_ground_in_evidence must be a boolean')
    }
    if (!Array.isArray(plan.answer_frame.required_sections)) {
      errors.push('plan.answer_frame.required_sections must be an array')
    }
    if (!Array.isArray(plan.answer_frame.forbidden_claims)) {
      errors.push('plan.answer_frame.forbidden_claims must be an array')
    }
  }

  if (Array.isArray(plan.steps)) {
    validateRefs(plan, errors)
  }

  return {
    ok: errors.length === 0,
    errors,
    schema_version: PLANNER_SCHEMA_VERSION
  }
}

export function assertValidPlannerPlan(plan) {
  const result = validatePlannerPlan(plan)
  if (!result.ok) {
    throw new Error(`Invalid planner plan: ${result.errors.join('; ')}`)
  }
  return plan
}

export {
  PLANNER_ALLOWED_TOOLS,
  PLANNER_SCHEMA
}

export default {
  PLANNER_ALLOWED_TOOLS,
  PLANNER_SCHEMA,
  assertValidPlannerPlan,
  validatePlannerPlan
}
