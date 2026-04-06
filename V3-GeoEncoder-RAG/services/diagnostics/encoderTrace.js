function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function buildEncoderTracePayload({
  traceId = null,
  query = '',
  anchor = null,
  intent = null,
  runtimeEnrichment = null,
  stats = null
} = {}) {
  const safeStats = stats && typeof stats === 'object' ? stats : {}
  const safeIntent = intent && typeof intent === 'object' ? intent : {}
  const safeAnchor = anchor && typeof anchor === 'object' ? anchor : null
  const safeRuntime = runtimeEnrichment && typeof runtimeEnrichment === 'object' ? runtimeEnrichment : {}

  return {
    trace_id: traceId || null,
    query: String(query || ''),
    anchor: safeAnchor
      ? {
          lon: toFiniteNumber(safeAnchor.lon),
          lat: toFiniteNumber(safeAnchor.lat),
          source: safeAnchor.source || null
        }
      : null,
    intent: {
      category: safeIntent.category || null,
      region_label: safeIntent.regionLabel ?? null
    },
    runtime_enrichment: {
      applied: safeRuntime.applied === true,
      reason: safeRuntime.reason || null
    },
    query_embedding: {
      applied: safeStats.query_embedding_applied === true,
      source: safeStats.query_embedding_source || null,
      feature_source: safeStats.query_embedding_feature_source || null
    },
    model_routing: {
      primary: safeStats.model_route_primary || null,
      secondary: Array.isArray(safeStats.model_route_secondary) ? safeStats.model_route_secondary : [],
      usage: Array.isArray(safeStats.model_usage) ? safeStats.model_usage : []
    },
    macro_cell_search: {
      applied: safeStats.macro_cell_search_applied === true,
      reason: safeStats.macro_cell_search_reason || null,
      count: Number(safeStats.macro_cell_count || 0)
    },
    boundary: {
      method: safeStats.boundary_generation_method || null,
      signal_model: safeStats.boundary_signal_model || null
    },
    encoder: {
      predicted_count: Number(safeStats.encoder_region_predicted_count || 0),
      high_confidence_count: Number(safeStats.encoder_region_high_confidence_count || 0),
      region_purity: toFiniteNumber(safeStats.encoder_region_purity),
      core_point_count: Number(safeStats.encoder_core_point_count || 0)
    },
    vector_constraint: {
      source: safeStats.vector_constraint_source || null,
      selected_count: Number(safeStats.vector_constraint_selected_count || 0),
      rejected_count: Number(safeStats.vector_constraint_rejected_count || 0)
    }
  }
}

export function logEncoderTrace(context = {}) {
  const payload = buildEncoderTracePayload(context)
  console.log(`[EncoderTrace] ${JSON.stringify(payload)}`)
  return payload
}

export default {
  buildEncoderTracePayload,
  logEncoderTrace
}
