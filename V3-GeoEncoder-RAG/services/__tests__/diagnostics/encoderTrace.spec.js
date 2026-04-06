import { describe, expect, it } from 'vitest'

import { buildEncoderTracePayload } from '../../diagnostics/encoderTrace.js'

describe('encoderTrace', () => {
  it('builds a compact structured payload from runtime enrichment and boundary stats', () => {
    const payload = buildEncoderTracePayload({
      traceId: 'trace_v3_encoder_001',
      query: '湖北大学附近咖啡店',
      anchor: { lon: 114.31, lat: 30.52, source: 'poi_features.centroid' },
      intent: { category: 'coffee', regionLabel: 1 },
      runtimeEnrichment: {
        applied: true,
        reason: 'enriched'
      },
      stats: {
        boundary_generation_method: 'road_block_support_v1_postgis',
        boundary_signal_model: 'encoder_region_fused_v1',
        encoder_region_predicted_count: 12,
        encoder_region_high_confidence_count: 10,
        encoder_region_purity: 0.83,
        encoder_core_point_count: 6,
        query_embedding_applied: true,
        query_embedding_source: 'anchor_encoder_intent_adapter_v2',
        query_embedding_feature_source: 'poi_online_context_v2',
        macro_cell_search_applied: true,
        macro_cell_search_reason: 'town_encoder_macro_cells',
        macro_cell_count: 3,
        model_route_primary: 'poi_encoder',
        model_route_secondary: ['town_encoder'],
        model_usage: ['poi_encoder', 'town_encoder'],
        vector_constraint_source: 'road_blocks',
        vector_constraint_selected_count: 4,
        vector_constraint_rejected_count: 9
      }
    })

    expect(payload).toMatchObject({
      trace_id: 'trace_v3_encoder_001',
      anchor: { lon: 114.31, lat: 30.52, source: 'poi_features.centroid' },
      intent: { category: 'coffee', region_label: 1 },
      runtime_enrichment: { applied: true, reason: 'enriched' },
      query_embedding: {
        applied: true,
        source: 'anchor_encoder_intent_adapter_v2',
        feature_source: 'poi_online_context_v2'
      },
      model_routing: {
        primary: 'poi_encoder',
        secondary: ['town_encoder'],
        usage: ['poi_encoder', 'town_encoder']
      },
      macro_cell_search: {
        applied: true,
        reason: 'town_encoder_macro_cells',
        count: 3
      },
      boundary: {
        method: 'road_block_support_v1_postgis',
        signal_model: 'encoder_region_fused_v1'
      },
      encoder: {
        predicted_count: 12,
        high_confidence_count: 10,
        region_purity: 0.83,
        core_point_count: 6
      },
      vector_constraint: {
        source: 'road_blocks',
        selected_count: 4,
        rejected_count: 9
      }
    })
  })
})
