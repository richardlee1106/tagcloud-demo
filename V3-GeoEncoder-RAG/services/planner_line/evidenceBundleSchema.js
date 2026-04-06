import { PLANNER_SCHEMA_VERSION, PLANNER_SNAKE_CASE_KEY_PATTERN } from './plannerTypes.js'

export const EVIDENCE_BUNDLE_BLOCKS = Object.freeze([
  'anchors',
  'nearby_pois',
  'representative_pois',
  'support_buckets',
  'support_bucket_metrics',
  'population_metrics',
  'spatial_summary',
  'uncertainty',
  'execution_trace'
])

export const EVIDENCE_META_REQUIRED_FIELDS = Object.freeze([
  'source',
  'source_detail',
  'confidence',
  'sample_size',
  'generated_by_step',
  'data_freshness',
  'staleness_warning'
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateMetaBlock(blockName, meta, errors) {
  if (!isPlainObject(meta)) {
    errors.push(`${blockName}_meta must be an object`)
    return
  }

  for (const field of EVIDENCE_META_REQUIRED_FIELDS) {
    if (!(field in meta)) {
      errors.push(`${blockName}_meta.${field} is required`)
    }
  }

  for (const key of Object.keys(meta)) {
    if (!PLANNER_SNAKE_CASE_KEY_PATTERN.test(key)) {
      errors.push(`${blockName}_meta.${key} must use snake_case`)
    }
  }
}

export function validateEvidenceBundleShape(bundle) {
  const errors = []

  if (!isPlainObject(bundle)) {
    return {
      ok: false,
      errors: ['evidence bundle must be an object']
    }
  }

  if (typeof bundle.schema_version !== 'string' || !bundle.schema_version.trim()) {
    errors.push('schema_version is required')
  }

  for (const key of Object.keys(bundle)) {
    if (!PLANNER_SNAKE_CASE_KEY_PATTERN.test(key)) {
      errors.push(`${key} must use snake_case`)
    }
  }

  for (const blockName of EVIDENCE_BUNDLE_BLOCKS) {
    if (!(blockName in bundle)) {
      errors.push(`${blockName} is required`)
    }
    validateMetaBlock(blockName, bundle[`${blockName}_meta`], errors)
  }

  const spatialSummary = bundle.spatial_summary
  if (!isPlainObject(spatialSummary)) {
    errors.push('spatial_summary must be an object')
  } else {
    for (const key of ['boundary', 'spatial_clusters', 'vernacular_regions', 'fuzzy_regions', 'comparison_regions']) {
      if (!(key in spatialSummary)) {
        errors.push(`spatial_summary.${key} is required`)
      }
    }
  }

  const executionTrace = bundle.execution_trace
  if (!isPlainObject(executionTrace)) {
    errors.push('execution_trace must be an object')
  } else {
    for (const key of ['executed_steps', 'skipped_steps', 'query_count', 'rounds_used']) {
      if (!(key in executionTrace)) {
        errors.push(`execution_trace.${key} is required`)
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    schema_version: bundle.schema_version || PLANNER_SCHEMA_VERSION
  }
}

export const EVIDENCE_BUNDLE_SCHEMA = Object.freeze({
  schema_version: PLANNER_SCHEMA_VERSION,
  required_blocks: EVIDENCE_BUNDLE_BLOCKS,
  required_meta_fields: EVIDENCE_META_REQUIRED_FIELDS
})

export default EVIDENCE_BUNDLE_SCHEMA
