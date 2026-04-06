import { generatePlannerPlanForQuery } from './plannerHarness.js'
import { TASK_TYPE_TO_ANSWER_STYLE } from './plannerTypes.js'

function mapLegacyTaskToStyle(taskType = '') {
  const normalizedTaskType = String(taskType || '').trim()
  return TASK_TYPE_TO_ANSWER_STYLE[normalizedTaskType] || 'lookup'
}

function buildLegacyFallbackPlan(userQuery, legacyIntent = {}) {
  const taskType = String(legacyIntent?.taskType || legacyIntent?.answerType || 'nearby_lookup').trim() || 'nearby_lookup'
  const placeName = String(legacyIntent?.placeName || '').trim()
  const anchors = placeName
    ? [{ place_name: placeName, role: 'primary' }]
    : []
  const steps = []

  if (placeName) {
    steps.push({
      step_id: 's1_resolve_primary_anchor',
      tool: 'spatial_core.resolve_anchor',
      input: {
        place_name: placeName,
        role: 'primary'
      },
      expect_output: ['anchor'],
      condition: null
    })
  }

  const anchorRef = placeName ? '$ref:s1_resolve_primary_anchor.anchor' : null
  const radiusM = Number(legacyIntent?.radiusM || 800)
  const category = legacyIntent?.category || null
  const subcategory = legacyIntent?.poiSubType || null

  if (taskType === 'nearby_lookup') {
    steps.push({
      step_id: 's2_search_primary_nearby_pois',
      tool: 'spatial_core.search_nearby_pois',
      input: {
        anchor: anchorRef,
        radius_m: radiusM,
        filter: {
          ...(category ? { category } : {}),
          ...(subcategory ? { subcategory } : {})
        },
        limit: 30
      },
      expect_output: ['pois', 'total_count'],
      condition: null
    })
  } else {
    steps.push({
      step_id: 's2_search_primary_nearby_pois',
      tool: 'spatial_core.search_nearby_pois',
      input: {
        anchor: anchorRef,
        radius_m: Math.max(radiusM, 1500),
        filter: {},
        limit: 80
      },
      expect_output: ['pois', 'total_count'],
      condition: null
    })
    steps.push({
      step_id: 's3_macro_cell_analysis',
      tool: 'spatial_core.macro_cell_analysis',
      input: {
        anchor: anchorRef,
        radius_m: Math.max(radiusM, 2500),
        focus: taskType
      },
      expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
      condition: null
    })
  }

  if (taskType === 'area_overview' || taskType === 'support_gap_analysis' || taskType === 'site_suitability') {
    steps.push({
      step_id: 's4_build_boundary',
      tool: 'spatial_core.build_boundary',
      input: {
        anchor: anchorRef,
        pois: '$ref:s2_search_primary_nearby_pois.pois'
      },
      expect_output: ['boundary', 'spatial_clusters'],
      condition: null
    })
  }

  return {
    task_type_hint: taskType,
    user_goal: legacyIntent?.intentDesc || userQuery,
    anchors,
    steps,
    stop_conditions: {
      max_rounds: 1,
      max_queries: Math.max(steps.length, 1),
      min_evidence_items: 1
    },
    answer_frame: {
      style: mapLegacyTaskToStyle(taskType),
      must_ground_in_evidence: true,
      required_sections: taskType === 'nearby_lookup' ? ['result_list'] : [],
      forbidden_claims: []
    }
  }
}

export function createPlannerService({
  generatePlannerPlan = generatePlannerPlanForQuery,
  inferIntentLegacy = null
} = {}) {
  return {
    async planQuery(userQuery, options = {}) {
      const generated = await generatePlannerPlan(userQuery, options)
      if (generated?.ok) {
        return {
          ok: true,
          source: 'planner_model',
          plan: generated.plan,
          attempts: generated.attempts || []
        }
      }

      if (typeof inferIntentLegacy === 'function') {
        const legacyIntent = await inferIntentLegacy(userQuery)
        const legacyPlan = buildLegacyFallbackPlan(userQuery, legacyIntent || {})
        return {
          ok: true,
          source: 'legacy_fallback',
          plan: legacyPlan,
          attempts: generated?.attempts || [],
          legacy_intent: legacyIntent || null
        }
      }

      return {
        ok: false,
        source: 'planner_model',
        plan: null,
        attempts: generated?.attempts || []
      }
    }
  }
}

export default {
  createPlannerService
}
