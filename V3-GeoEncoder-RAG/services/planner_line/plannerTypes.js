/**
 * Shared planner-line contract constants and typedef-style metadata for B1.
 */

export const PLANNER_SCHEMA_VERSION = 'planner_line.b1'

export const TASK_TYPE_HINT_VALUES = Object.freeze([
  'nearby_lookup',
  'support_gap_analysis',
  'site_suitability',
  'region_comparison',
  'area_overview'
])

export const ANSWER_FRAME_STYLE_VALUES = Object.freeze([
  'lookup',
  'gap',
  'overview',
  'comparison'
])

export const TASK_TYPE_TO_ANSWER_STYLE = Object.freeze({
  nearby_lookup: 'lookup',
  support_gap_analysis: 'gap',
  site_suitability: 'gap',
  area_overview: 'overview',
  region_comparison: 'comparison'
})

export const PLANNER_STOP_CONDITION_FIELDS = Object.freeze([
  'max_rounds',
  'max_queries',
  'min_evidence_items'
])

export const PLANNER_REQUIRED_TOP_LEVEL_FIELDS = Object.freeze([
  'user_goal',
  'anchors',
  'steps',
  'stop_conditions',
  'answer_frame'
])

export const PLANNER_REQUIRED_STEP_FIELDS = Object.freeze([
  'step_id',
  'tool',
  'input',
  'expect_output',
  'condition'
])

export const PLANNER_REQUIRED_ANSWER_FRAME_FIELDS = Object.freeze([
  'style',
  'must_ground_in_evidence',
  'required_sections',
  'forbidden_claims'
])

export const PLANNER_REQUIRED_ANCHOR_FIELDS = Object.freeze([
  'place_name',
  'role'
])

export const PLANNER_REFERENCE_PATTERN = /^\$ref:([a-z0-9_]+)\.([a-z0-9_.]+)$/u

export const PLANNER_CONDITION_REFERENCE_PATTERN = /\$ref:([a-z0-9_]+)\.([a-z0-9_.]+)/gu

export const PLANNER_SNAKE_CASE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/u

export const PLANNER_STEP_ID_PATTERN = /^[a-z0-9_]+$/u
