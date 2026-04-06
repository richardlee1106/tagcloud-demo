import { describe, expect, it } from 'vitest'

import { getGoldenPlanCases } from './goldenPlans.js'
import {
  EVIDENCE_BUNDLE_BLOCKS,
  validateEvidenceBundleShape
} from '../../planner_line/evidenceBundleSchema.js'
import {
  PLANNER_ALLOWED_TOOLS,
  validatePlannerPlan
} from '../../planner_line/planValidator.js'

describe('planner_line B1 validator', () => {
  it('accepts all 10 golden plans', () => {
    const validationResults = getGoldenPlanCases().map(({ plan }) => validatePlannerPlan(plan))

    expect(validationResults.every((result) => result.ok)).toBe(true)
  })

  it('keeps all golden plan tools inside the declared planner tool allowlist', () => {
    const usedTools = new Set()

    for (const { plan } of getGoldenPlanCases()) {
      for (const step of plan.steps) {
        usedTools.add(step.tool)
      }
    }

    expect([...usedTools].every((toolName) => PLANNER_ALLOWED_TOOLS.includes(toolName))).toBe(true)
  })

  it('rejects legacy flat anchor fields and non-snake-case contract keys', () => {
    const { plan } = getGoldenPlanCases()[0]
    const invalidPlan = {
      ...plan,
      comparisonAnchors: [],
      steps: plan.steps.map((step) => {
        if (step.tool !== 'spatial_core.search_nearby_pois') return step

        return {
          ...step,
          input: {
            lon: 114.36,
            lat: 30.53,
            radius_m: 800,
            filter: {
              category: '餐饮美食'
            }
          }
        }
      })
    }

    const result = validatePlannerPlan(invalidPlan)

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('comparisonAnchors'),
      expect.stringContaining('anchor')
    ]))
  })

  it('rejects search_nearby_pois steps that expose embedding controls to the planner', () => {
    const { plan } = getGoldenPlanCases()[0]
    const invalidPlan = {
      ...plan,
      steps: plan.steps.map((step) => {
        if (step.tool !== 'spatial_core.search_nearby_pois') return step

        return {
          ...step,
          input: {
            ...step.input,
            query_embedding: [0.1, 0.2, 0.3]
          }
        }
      })
    }

    const result = validatePlannerPlan(invalidPlan)

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('query_embedding')
    ]))
  })

  it('rejects search_nearby_pois filter objects that leak internal retrieval controls', () => {
    const { plan } = getGoldenPlanCases()[0]
    const invalidPlan = {
      ...plan,
      steps: plan.steps.map((step) => {
        if (step.tool !== 'spatial_core.search_nearby_pois') return step

        return {
          ...step,
          input: {
            ...step.input,
            filter: {
              ...step.input.filter,
              embedding_dim: 352
            }
          }
        }
      })
    }

    const result = validatePlannerPlan(invalidPlan)

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('embedding_dim')
    ]))
  })

  it('rejects refs that point to a future step', () => {
    const { plan } = getGoldenPlanCases()[0]
    const invalidPlan = {
      ...plan,
      steps: [
        {
          ...plan.steps[0],
          input: {
            place_name: '$ref:s2_search_primary_nearby_pois.anchor',
            role: 'primary'
          }
        },
        ...plan.steps.slice(1)
      ]
    }

    const result = validatePlannerPlan(invalidPlan)

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('future step')
    ]))
  })

  it('accepts plans that omit task_type_hint when the steps are otherwise valid', () => {
    const basePlan = getGoldenPlanCases().find(({ case_id }) => case_id === 'q5_nearby_coffee_optics_valley')?.plan
    const { task_type_hint, ...optionalHintPlan } = basePlan || {}

    expect(optionalHintPlan).toBeTruthy()
    expect('task_type_hint' in optionalHintPlan).toBe(false)

    const result = validatePlannerPlan(optionalHintPlan)

    expect(result.ok).toBe(true)
  })
})

describe('planner_line evidence bundle schema', () => {
  it('requires the agreed top-level evidence blocks and provenance companions', () => {
    expect(EVIDENCE_BUNDLE_BLOCKS).toEqual([
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
  })

  it('accepts a minimal evidence bundle with provenance metadata', () => {
    const result = validateEvidenceBundleShape({
      schema_version: 'planner_line.b1',
      anchors: [],
      anchors_meta: {
        source: 'postgis_geocode',
        source_detail: 'quickSearchPois resolved place anchors',
        confidence: 0.95,
        sample_size: 1,
        generated_by_step: 's1_resolve_primary_anchor',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      nearby_pois: [],
      nearby_pois_meta: {
        source: 'postgis_spatial_filter',
        source_detail: 'PostGIS radius filtering with semantic rerank inside retrieval',
        confidence: 0.9,
        sample_size: 0,
        generated_by_step: 's2_search_primary_nearby_pois',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      representative_pois: [],
      representative_pois_meta: {
        source: 'postgis_spatial_filter',
        source_detail: 'Representative subset extracted from nearby pois',
        confidence: 0.82,
        sample_size: 0,
        generated_by_step: 's2_search_primary_nearby_pois',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      support_buckets: [],
      support_buckets_meta: {
        source: 'cell_encoder_macro_analysis',
        source_detail: 'Macro cell analysis summary',
        confidence: 0.8,
        sample_size: 0,
        generated_by_step: 's3_macro_cell_analysis',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      support_bucket_metrics: [],
      support_bucket_metrics_meta: {
        source: 'cell_encoder_macro_analysis',
        source_detail: 'Derived metrics for support buckets',
        confidence: 0.8,
        sample_size: 0,
        generated_by_step: 's3_macro_cell_analysis',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      population_metrics: null,
      population_metrics_meta: {
        source: 'cell_encoder_macro_analysis',
        source_detail: 'Population-like context from macro cells when available',
        confidence: 0.5,
        sample_size: 0,
        generated_by_step: 's3_macro_cell_analysis',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      spatial_summary: {
        boundary: null,
        spatial_clusters: [],
        vernacular_regions: [],
        fuzzy_regions: [],
        comparison_regions: []
      },
      spatial_summary_meta: {
        source: 'postgis_geometry_builder',
        source_detail: 'Boundary and cluster summary',
        confidence: 0.7,
        sample_size: 0,
        generated_by_step: 's4_build_boundary',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      uncertainty: {
        low_sample_warning: false
      },
      uncertainty_meta: {
        source: 'planner_line.uncertainty',
        source_detail: 'Aggregated uncertainty summary',
        confidence: 0.75,
        sample_size: 0,
        generated_by_step: 's3_macro_cell_analysis',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      },
      execution_trace: {
        executed_steps: [],
        skipped_steps: [],
        query_count: 0,
        rounds_used: 1
      },
      execution_trace_meta: {
        source: 'planner_line.executor',
        source_detail: 'Execution trace for the validated plan',
        confidence: 1,
        sample_size: 0,
        generated_by_step: 'executor',
        data_freshness: '2026-03-28T00:00:00Z',
        staleness_warning: false
      }
    })

    expect(result.ok).toBe(true)
  })
})
