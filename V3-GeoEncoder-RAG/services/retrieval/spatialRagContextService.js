import { handleSpatialQuery } from '../spatial_core/retrieval/spatialSearchOrchestrator.js'
import {
  normalizeMacroUncertainty,
  normalizeRepresentativePois,
  normalizeSupportBuckets
} from '../spatial_core/ai/supportEvidenceUtils.js'

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function roundNumber(value, digits = 6) {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  return Number(numeric.toFixed(digits))
}

function buildDefaultDeps() {
  return {
    handleSpatialQuery
  }
}

function normalizeAnchor(anchor = null) {
  return {
    lon: roundNumber(anchor?.lon),
    lat: roundNumber(anchor?.lat),
    source: anchor?.source || 'unknown'
  }
}

function normalizeIntent(intent = {}) {
  const anchors = Array.isArray(intent?.anchors)
    ? intent.anchors
      .map((item, index) => {
        const placeName = String(item?.placeName || item?.place_name || '').trim()
        if (!placeName) return null

        return {
          place_name: placeName,
          display_name: String(item?.displayName || item?.display_name || placeName).trim() || placeName,
          role: String(
            item?.role ||
            (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
          ).trim() || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`),
          index
        }
      })
      .filter(Boolean)
    : []

  return {
    category: intent?.category || null,
    semantic_tags: Array.isArray(intent?.semanticTags) ? intent.semanticTags : [],
    intent_desc: intent?.intentDesc || '',
    place_name: intent?.placeName || null,
    radius_m: toFiniteNumber(intent?.radiusM),
    region_label: toFiniteNumber(intent?.regionLabel),
    method: intent?.method || null,
    task_type: intent?.taskType || null,
    answer_type: intent?.answerType || null,
    anchor_mode: intent?.anchorMode || null,
    analysis_facets: intent?.analysisFacets || null,
    anchors
  }
}

function normalizeQueryEmbedding(queryEmbedding = null) {
  return {
    applied: queryEmbedding?.applied === true,
    reason: queryEmbedding?.reason || 'unavailable',
    source: queryEmbedding?.source || null,
    embedding_dim: toFiniteNumber(queryEmbedding?.embeddingDim) || 0,
    components: queryEmbedding?.components || null
  }
}

function normalizeSpatialContextItem(item = {}, rank = 1) {
  return {
    rank,
    id: item?.id ?? null,
    name: item?.name || 'Unknown POI',
    category: item?.category || null,
    region_label: item?.regionLabel ?? item?.spatial_info?.region_idx ?? null,
    coordinates: {
      lon: roundNumber(item?.lon),
      lat: roundNumber(item?.lat)
    },
    distance_m: toFiniteNumber(item?.distance_m),
    scores: {
      fused: roundNumber(item?.fused_score, 4),
      spatial: roundNumber(item?.spatial_score, 4),
      semantic: roundNumber(item?.semantic_score, 4)
    },
    spatial_info: item?.spatial_info || null
  }
}

function buildEvidenceSummary(evidence = {}, contexts = []) {
  const hotspots = Array.isArray(evidence?.spatialClusters?.hotspots) ? evidence.spatialClusters.hotspots : []
  const vernacularRegions = Array.isArray(evidence?.vernacularRegions) ? evidence.vernacularRegions : []
  const fuzzyRegions = Array.isArray(evidence?.fuzzyRegions) ? evidence.fuzzyRegions : []
  const refinedResults = evidence?.refinedResult?.results || {}
  const supportBuckets = normalizeSupportBuckets(evidence?.supportBuckets || refinedResults?.support_buckets)
  const representativePois = normalizeRepresentativePois(
    evidence?.representativePois || refinedResults?.representative_pois
  )
  const uncertainty = normalizeMacroUncertainty(
    evidence?.uncertainty || refinedResults?.uncertainty,
    {
      supportBucketCount: supportBuckets.length,
      representativePoiCount: representativePois.length,
      sampleSize: toFiniteNumber(evidence?.stats?.result_count) ?? contexts.length,
      boundaryConfidence: toFiniteNumber(evidence?.stats?.avg_boundary_confidence),
      vectorConstraintSource: evidence?.stats?.vector_constraint_source || null
    }
  )

  return {
    boundary_available: Boolean(evidence?.boundary),
    avg_boundary_confidence: toFiniteNumber(evidence?.stats?.avg_boundary_confidence),
    boundary_confidence_model: evidence?.stats?.boundary_confidence_model || null,
    hotspot_count: hotspots.length,
    vernacular_region_count: vernacularRegions.length,
    fuzzy_region_count: fuzzyRegions.length,
    vector_constraint_source: evidence?.stats?.vector_constraint_source || null,
    support_bucket_count: uncertainty.support_bucket_count || supportBuckets.length,
    representative_poi_count: uncertainty.representative_poi_count || representativePois.length,
    evidence_density: uncertainty.evidence_density || null,
    low_sample_warning: uncertainty.low_sample_warning,
    top_context_names: contexts.map((item) => item.name)
  }
}

function buildFacts({
  userQuery = '',
  intent = {},
  anchor = {},
  queryEmbedding = {},
  queryPlan = null,
  evidenceSummary = {},
  evidence = {},
  contexts = []
} = {}) {
  const facts = [
    `query: ${userQuery}`,
    `anchor: lon=${anchor.lon}, lat=${anchor.lat}, source=${anchor.source}`,
    `query_embedding: applied=${queryEmbedding.applied}, source=${queryEmbedding.source}, dim=${queryEmbedding.embedding_dim}`
  ]

  if (intent?.category) {
    facts.push(`intent_category: ${intent.category}`)
  }
  if (Array.isArray(intent?.semantic_tags) && intent.semantic_tags.length > 0) {
    facts.push(`intent_tags: ${intent.semantic_tags.join(', ')}`)
  }
  if (toFiniteNumber(intent?.radius_m) !== null) {
    facts.push(`intent_radius_m: ${intent.radius_m}`)
  }
  if (toFiniteNumber(intent?.region_label) !== null) {
    facts.push(`intent_region_label: ${intent.region_label}`)
  }
  if (intent?.task_type) {
    facts.push(`task_type: ${intent.task_type}`)
  }
  if (intent?.answer_type) {
    facts.push(`answer_type: ${intent.answer_type}`)
  }
  if (Array.isArray(intent?.anchors) && intent.anchors.length > 0) {
    facts.push(`anchors: ${intent.anchors.map((item) => item.display_name || item.place_name).join(' | ')}`)
  }
  if (toFiniteNumber(evidence?.stats?.avg_boundary_confidence) !== null) {
    facts.push(
      `boundary_confidence: ${evidence.stats.avg_boundary_confidence} (${evidence?.stats?.boundary_confidence_model || 'unknown_model'})`
    )
  }
  if (queryPlan?.comparison_mode) {
    facts.push(`comparison_mode: ${queryPlan.comparison_mode}`)
  }
  if (toFiniteNumber(evidenceSummary?.avg_boundary_confidence) !== null) {
    facts.push(`uncertainty_boundary_confidence: ${evidenceSummary.avg_boundary_confidence}`)
  }
  const supportBuckets = normalizeSupportBuckets(
    evidence?.supportBuckets || evidence?.refinedResult?.results?.support_buckets
  )
  if (supportBuckets.length > 0) {
    facts.push(`support_buckets: ${supportBuckets.map((item) => `${item.bucket}(${item.count})`).join(' | ')}`)
  }
  const representativePois = normalizeRepresentativePois(
    evidence?.representativePois || evidence?.refinedResult?.results?.representative_pois
  )
  if (representativePois.length > 0) {
    facts.push(`representative_pois: ${representativePois.map((item) => `${item.name}/${item.category}`).join(' | ')}`)
  }
  if (evidenceSummary?.evidence_density) {
    facts.push(`evidence_density: ${evidenceSummary.evidence_density}`)
  }
  if (evidenceSummary?.low_sample_warning === true) {
    facts.push('low_sample_warning: true')
  }

  contexts.forEach((context, index) => {
    facts.push(
      `top_context_${index + 1}: ${context.name} | category=${context.category || 'unknown'} | distance_m=${context.distance_m ?? 'na'} | fused_score=${context.scores.fused ?? 'na'}`
    )
  })

  return facts
}

function buildSchemaContext({ intent = {}, queryPlan = null, contexts = [], evidence = {}, evidenceSummary = {} } = {}) {
  const refinedResults = evidence?.refinedResult?.results || {}
  const supportBuckets = normalizeSupportBuckets(evidence?.supportBuckets || refinedResults?.support_buckets)
  const representativePois = normalizeRepresentativePois(
    evidence?.representativePois || refinedResults?.representative_pois
  )
  const uncertainty = normalizeMacroUncertainty(
    evidence?.uncertainty || refinedResults?.uncertainty,
    {
      supportBucketCount: supportBuckets.length,
      representativePoiCount: representativePois.length || contexts.length,
      sampleSize: toFiniteNumber(evidence?.stats?.result_count) ?? contexts.length,
      boundaryConfidence: evidenceSummary?.avg_boundary_confidence,
      comparisonMode: queryPlan?.comparison_mode || null,
      vectorConstraintSource: evidenceSummary?.vector_constraint_source || null
    }
  )

  return {
    anchors: Array.isArray(intent?.anchors) ? intent.anchors : [],
    task_type: intent?.task_type || queryPlan?.task_type || null,
    answer_type: intent?.answer_type || queryPlan?.answer_type || null,
    requested_category: queryPlan?.subcategory || intent?.category || null,
    support_buckets: supportBuckets,
    representative_pois: representativePois.length > 0
      ? representativePois
      : contexts.slice(0, 5).map((item) => ({
        name: item.name,
        category: item.category,
        distance_m: item.distance_m,
        region_label: item.region_label
      })),
    uncertainty
  }
}

function buildPrompt(facts = [], schema = null) {
  return [
    'You are given grounded spatial retrieval context from the V3 spatial encoder stack.',
    'Use these facts as external spatial memory for any downstream LLM.',
    'Prefer the spatial evidence over unsupported guesses.',
    ...facts,
    schema ? `schema_json: ${JSON.stringify(schema)}` : null
  ]
    .filter(Boolean)
    .join('\n')
}

export async function buildSpatialRagContext({
  userQuery = '',
  topK = 10,
  poiFeatures = [],
  spatialContext = null,
  intent = null,
  traceId = null
} = {}, deps = buildDefaultDeps()) {
  const result = await deps.handleSpatialQuery(userQuery, {
    poiFeatures,
    spatialContext,
    intent,
    traceId
  })

  const normalizedIntent = normalizeIntent(result.intent)
  const normalizedAnchor = normalizeAnchor(result.anchor)
  const normalizedQueryEmbedding = normalizeQueryEmbedding(result.queryEmbedding)
  const contexts = (Array.isArray(result.results) ? result.results : [])
    .slice(0, Math.max(1, Number(topK) || 10))
    .map((item, index) => normalizeSpatialContextItem(item, index + 1))
  const evidenceSummary = buildEvidenceSummary(result.evidence, contexts)
  const queryPlan = result?.evidence?.queryPlan || result?.evidence?.refinedResult?.query_plan || null
  const facts = buildFacts({
    userQuery,
    intent: normalizedIntent,
    anchor: normalizedAnchor,
    queryEmbedding: normalizedQueryEmbedding,
    queryPlan,
    evidenceSummary,
    evidence: result.evidence,
    contexts
  })
  const llmSchema = buildSchemaContext({
    intent: normalizedIntent,
    queryPlan,
    contexts,
    evidence: result.evidence,
    evidenceSummary
  })

  return {
    success: true,
    contract: 'v3-spatial-rag-context/v1',
    query: userQuery,
    trace_id: traceId || result?.evidence?.stats?.trace_id || null,
    intent: normalizedIntent,
    anchor: normalizedAnchor,
    query_embedding: normalizedQueryEmbedding,
    retrieval: {
      candidate_count: Array.isArray(result.candidateResults)
        ? result.candidateResults.length
        : Number(result?.evidence?.stats?.candidate_count || 0),
      result_count: Array.isArray(result.results)
        ? result.results.length
        : Number(result?.evidence?.stats?.result_count || 0),
      returned_context_count: contexts.length,
      encoder_enrichment_applied: result?.runtimeEnrichment?.applied === true,
      encoder_enrichment_reason: result?.runtimeEnrichment?.reason || null
    },
    evidence_summary: evidenceSummary,
    query_plan: queryPlan,
    spatial_contexts: contexts,
    geometry_context: {
      boundary: result?.evidence?.boundary || null,
      spatial_clusters: result?.evidence?.spatialClusters || { hotspots: [] },
      vernacular_regions: result?.evidence?.vernacularRegions || [],
      fuzzy_regions: result?.evidence?.fuzzyRegions || []
    },
    llm_context: {
      type: 'spatial_rag_context',
      facts,
      schema: llmSchema,
      prompt: buildPrompt(facts, llmSchema)
    }
  }
}

export default {
  buildSpatialRagContext
}
