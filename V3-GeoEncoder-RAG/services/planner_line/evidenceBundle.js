import { buildEvidenceProfile } from './evidenceProfile.js'
import {
  selectRepresentativePois,
  selectSupportBuckets,
  selectSupportBucketMetrics
} from './evidenceSelectors.js'

const EVIDENCE_SCHEMA_VERSION = 'planner_line.c1'

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function buildMeta({
  source = 'planner_line.executor',
  sourceDetail = '',
  confidence = 0.75,
  sampleSize = 0,
  generatedByStep = 'executor'
} = {}) {
  return {
    source,
    source_detail: sourceDetail,
    confidence,
    sample_size: sampleSize,
    generated_by_step: generatedByStep,
    data_freshness: new Date().toISOString(),
    staleness_warning: false
  }
}

function pickFirstAnchor(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (output?.anchor) return output.anchor
  }
  return null
}

function collectNearbyPois(stepOutputs = {}) {
  const allPois = []
  for (const output of Object.values(stepOutputs || {})) {
    if (Array.isArray(output?.pois)) {
      allPois.push(...output.pois)
    }
  }
  return allPois
}

function buildRepresentativePois(nearbyPois = [], { plan = {}, anchor = null, supportBuckets = [], intentSpec = null } = {}) {
  return selectRepresentativePois({
    nearbyPois,
    anchor,
    supportBuckets,
    intentSpec,
    plan
  })
}

function collectExplicitSupportBuckets(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (Array.isArray(output?.support_buckets)) {
      if (output.support_buckets.length > 0) {
        return output.support_buckets
      }
    }
  }

  return []
}

function collectSupportBuckets(stepOutputs = {}, { plan = {}, nearbyPois = [], anchor = null, intentSpec = null } = {}) {
  const explicitSupportBuckets = collectExplicitSupportBuckets(stepOutputs)
  return selectSupportBuckets({
    explicitSupportBuckets,
    nearbyPois,
    anchor,
    intentSpec,
    plan
  })
}

function collectExplicitSupportBucketMetrics(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (Array.isArray(output?.support_bucket_metrics)) {
      if (output.support_bucket_metrics.length > 0) {
        return output.support_bucket_metrics
      }
    }
  }

  return []
}

function collectSupportBucketMetrics(stepOutputs = {}, { plan = {}, nearbyPois = [], anchor = null, supportBuckets = [], intentSpec = null } = {}) {
  const explicitSupportBucketMetrics = collectExplicitSupportBucketMetrics(stepOutputs)
  return selectSupportBucketMetrics({
    explicitSupportBucketMetrics,
    supportBuckets,
    nearbyPois,
    anchor,
    intentSpec,
    plan
  })
}

function collectPopulationMetrics(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (output?.population_metrics) {
      return output.population_metrics
    }
  }
  return null
}

function collectDominantBuckets(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (Array.isArray(output?.dominant_buckets) && output.dominant_buckets.length > 0) {
      return output.dominant_buckets
    }
  }
  return []
}

function collectSceneTags(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (Array.isArray(output?.scene_tags) && output.scene_tags.length > 0) {
      return output.scene_tags
    }
  }
  return []
}

function collectCellMix(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (Array.isArray(output?.cell_mix) && output.cell_mix.length > 0) {
      return output.cell_mix
    }
  }
  return []
}

function collectBoundary(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (output?.boundary || output?.spatial_clusters) {
      return {
        boundary: output.boundary || null,
        spatial_clusters: output.spatial_clusters || [],
        vernacular_regions: output.vernacular_regions || [],
        fuzzy_regions: output.fuzzy_regions || [],
        comparison_regions: output.comparison_regions || []
      }
    }
  }

  return {
    boundary: null,
    spatial_clusters: [],
    vernacular_regions: [],
    fuzzy_regions: [],
    comparison_regions: []
  }
}

function collectUncertainty(stepOutputs = {}) {
  for (const output of Object.values(stepOutputs || {})) {
    if (output?.uncertainty) return output.uncertainty
  }
  return {
    low_sample_warning: false
  }
}

export function buildEvidenceBundle({
  stepOutputs = {},
  executionTrace = null,
  plan = {},
  intentSpec = null
} = {}) {
  const firstAnchor = pickFirstAnchor(stepOutputs)
  const nearbyPois = collectNearbyPois(stepOutputs)
  const supportBuckets = collectSupportBuckets(stepOutputs, {
    plan,
    nearbyPois,
    anchor: firstAnchor,
    intentSpec
  })
  const supportBucketMetrics = collectSupportBucketMetrics(stepOutputs, {
    plan,
    nearbyPois,
    anchor: firstAnchor,
    supportBuckets,
    intentSpec
  })
  const dominantBuckets = collectDominantBuckets(stepOutputs)
  const sceneTags = collectSceneTags(stepOutputs)
  const cellMix = collectCellMix(stepOutputs)
  const representativePois = buildRepresentativePois(nearbyPois, {
    plan,
    anchor: firstAnchor,
    supportBuckets,
    intentSpec
  })
  const populationMetrics = collectPopulationMetrics(stepOutputs)
  const spatialSummary = collectBoundary(stepOutputs)
  const uncertainty = collectUncertainty(stepOutputs)
  const evidenceProfile = buildEvidenceProfile({
    plan,
    intentSpec,
    evidenceBundle: {
      support_buckets: supportBuckets,
      dominant_buckets: dominantBuckets,
      scene_tags: sceneTags,
      cell_mix: cellMix
    }
  })

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    evidence_profile: evidenceProfile,
    anchors: firstAnchor ? [firstAnchor] : [],
    anchors_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Anchors collected from executed tool outputs',
      confidence: 0.95,
      sampleSize: firstAnchor ? 1 : 0,
      generatedByStep: 'executor'
    }),
    nearby_pois: nearbyPois,
    nearby_pois_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Merged nearby pois from executed step outputs',
      confidence: 0.88,
      sampleSize: nearbyPois.length,
      generatedByStep: 'executor'
    }),
    representative_pois: representativePois,
    representative_pois_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Top nearby pois used for answer synthesis',
      confidence: 0.82,
      sampleSize: representativePois.length,
      generatedByStep: 'executor'
    }),
    support_buckets: supportBuckets,
    support_buckets_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Support buckets collected from macro analysis outputs',
      confidence: 0.8,
      sampleSize: supportBuckets.length,
      generatedByStep: 'executor'
    }),
    support_bucket_metrics: supportBucketMetrics,
    support_bucket_metrics_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Support bucket metrics collected from macro analysis outputs',
      confidence: 0.8,
      sampleSize: supportBucketMetrics.length,
      generatedByStep: 'executor'
    }),
    dominant_buckets: dominantBuckets,
    dominant_buckets_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Dominant macro buckets collected from macro analysis outputs',
      confidence: 0.78,
      sampleSize: dominantBuckets.length,
      generatedByStep: 'executor'
    }),
    scene_tags: sceneTags,
    scene_tags_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Macro scene tags collected from macro analysis outputs',
      confidence: 0.76,
      sampleSize: sceneTags.length,
      generatedByStep: 'executor'
    }),
    cell_mix: cellMix,
    cell_mix_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Macro cell mix collected from macro analysis outputs',
      confidence: 0.78,
      sampleSize: cellMix.length,
      generatedByStep: 'executor'
    }),
    population_metrics: populationMetrics,
    population_metrics_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Population metrics gathered from macro outputs',
      confidence: populationMetrics ? 0.72 : 0.4,
      sampleSize: populationMetrics ? 1 : 0,
      generatedByStep: 'executor'
    }),
    spatial_summary: spatialSummary,
    spatial_summary_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Boundary and cluster summary from executed outputs',
      confidence: spatialSummary.boundary ? 0.76 : 0.5,
      sampleSize: toArray(spatialSummary.spatial_clusters).length,
      generatedByStep: 'executor'
    }),
    uncertainty,
    uncertainty_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Uncertainty summary from executed outputs',
      confidence: 0.7,
      sampleSize: 1,
      generatedByStep: 'executor'
    }),
    execution_trace: executionTrace || {
      executed_steps: [],
      skipped_steps: [],
      query_count: 0,
      rounds_used: 1
    },
    execution_trace_meta: buildMeta({
      source: 'planner_line.executor',
      sourceDetail: 'Execution trace for the current single-round run',
      confidence: 1,
      sampleSize: 1,
      generatedByStep: 'executor'
    })
  }
}

export default {
  buildEvidenceBundle
}
