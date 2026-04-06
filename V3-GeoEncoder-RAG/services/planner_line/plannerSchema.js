import {
  ANSWER_FRAME_STYLE_VALUES,
  PLANNER_REQUIRED_ANCHOR_FIELDS,
  PLANNER_REQUIRED_ANSWER_FRAME_FIELDS,
  PLANNER_REQUIRED_STEP_FIELDS,
  PLANNER_REQUIRED_TOP_LEVEL_FIELDS,
  PLANNER_SCHEMA_VERSION,
  PLANNER_STOP_CONDITION_FIELDS,
  TASK_TYPE_HINT_VALUES
} from './plannerTypes.js'
import { SPATIAL_TOOL_NAMES } from '../spatial_core/toolSchemas.js'

export const PLANNER_ALLOWED_TOOLS = Object.freeze([...SPATIAL_TOOL_NAMES])

export const PLANNER_LEGACY_DISALLOWED_KEYS = Object.freeze([
  'anchor',
  'comparison_anchors',
  'comparisonAnchors',
  'taskType',
  'answerType',
  'anchorMode'
])

export const PLANNER_TOOL_SCHEMAS = Object.freeze({
  'spatial_core.resolve_anchor': {
    required_input_fields: ['place_name'],
    allowed_input_fields: ['place_name', 'role', 'search_hint', 'search_radius_m'],
    required_expect_output_fields: ['anchor'],
    disallowed_input_fields: ['lon', 'lat', 'query_embedding', 'embedding', 'embedding_dim']
  },
  'spatial_core.search_nearby_pois': {
    required_input_fields: ['anchor', 'radius_m', 'filter', 'limit'],
    allowed_input_fields: ['anchor', 'radius_m', 'filter', 'limit', 'sort_by'],
    required_expect_output_fields: ['pois', 'total_count'],
    disallowed_input_fields: ['lon', 'lat', 'query_embedding', 'embedding', 'embedding_dim', 'semantic_weight', 'spatial_weight'],
    allowed_filter_keys: ['category', 'subcategory', 'target_region', 'region_filter_mode'],
    disallowed_filter_keys: ['lon', 'lat', 'query_embedding', 'embedding', 'embedding_dim', 'semantic_weight', 'spatial_weight']
  },
  'spatial_core.vector_search': {
    required_input_fields: ['anchor', 'limit'],
    allowed_input_fields: ['anchor', 'limit', 'filter', 'target'],
    required_expect_output_fields: ['pois', 'total_count'],
    disallowed_input_fields: ['query_embedding', 'embedding_dim'],
    allowed_filter_keys: ['category', 'subcategory', 'target_region'],
    disallowed_filter_keys: ['lon', 'lat', 'query_embedding', 'embedding', 'embedding_dim', 'semantic_weight', 'spatial_weight']
  },
  'spatial_core.macro_cell_analysis': {
    required_input_fields: ['anchor', 'radius_m', 'focus'],
    allowed_input_fields: ['anchor', 'radius_m', 'focus', 'limit'],
    required_expect_output_fields: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
    disallowed_input_fields: ['query_embedding', 'embedding', 'embedding_dim']
  },
  'spatial_core.spatial_encode': {
    required_input_fields: ['anchor'],
    allowed_input_fields: ['anchor', 'focus'],
    required_expect_output_fields: ['anchor_context'],
    disallowed_input_fields: ['query_embedding', 'embedding_dim']
  },
  'spatial_core.build_boundary': {
    required_input_fields: ['anchor', 'pois'],
    allowed_input_fields: ['anchor', 'pois', 'boundary_hint'],
    required_expect_output_fields: ['boundary', 'spatial_clusters'],
    disallowed_input_fields: ['query_embedding', 'embedding_dim']
  },
  'spatial_core.infer_intent_legacy': {
    required_input_fields: ['user_query'],
    allowed_input_fields: ['user_query'],
    required_expect_output_fields: ['intent'],
    disallowed_input_fields: ['query_embedding', 'embedding_dim']
  }
})

export const PLANNER_SCHEMA = Object.freeze({
  schema_version: PLANNER_SCHEMA_VERSION,
  task_type_hint_values: TASK_TYPE_HINT_VALUES,
  required_top_level_fields: PLANNER_REQUIRED_TOP_LEVEL_FIELDS,
  required_anchor_fields: PLANNER_REQUIRED_ANCHOR_FIELDS,
  required_step_fields: PLANNER_REQUIRED_STEP_FIELDS,
  required_stop_condition_fields: PLANNER_STOP_CONDITION_FIELDS,
  required_answer_frame_fields: PLANNER_REQUIRED_ANSWER_FRAME_FIELDS,
  answer_frame_style_values: ANSWER_FRAME_STYLE_VALUES,
  allowed_tools: PLANNER_ALLOWED_TOOLS,
  legacy_disallowed_keys: PLANNER_LEGACY_DISALLOWED_KEYS,
  tool_schemas: PLANNER_TOOL_SCHEMAS
})

export default PLANNER_SCHEMA
