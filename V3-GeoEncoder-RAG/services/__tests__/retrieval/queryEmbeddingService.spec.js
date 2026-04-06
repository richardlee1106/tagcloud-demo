import { describe, expect, it, vi } from 'vitest'

import {
  buildSpatialQueryEmbedding,
  buildQueryEmbeddingSearchOptions
} from '../../retrieval/queryEmbeddingService.js'

describe('queryEmbeddingService', () => {
  it('fuses structured intent signals into the anchor embedding before exposing hybrid-search options', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(true),
      startSpatialEncoder: vi.fn(),
      encodeCoords: vi.fn().mockResolvedValue({
        embedding: [0.1, 0.2, 0.3, 0.4],
        embedding_dim: 4,
        feature_source: 'poi_online_context_v2',
        feature_stats: {
          neighbor_poi_count: 18,
          road_count: 23,
          landuse_type: '商业服务用地'
        }
      })
    }

    const queryEmbedding = await buildSpatialQueryEmbedding({
      userQuery: '武汉大学附近安静一点的咖啡馆',
      intent: {
        category: 'coffee',
        semanticTags: ['quiet', 'study'],
        radiusM: 800,
        regionLabel: 1
      },
      anchor: {
        lon: 114.36,
        lat: 30.54,
        source: 'spatial_context.center'
      },
      client
    })

    expect(client.encodeCoords).toHaveBeenCalledWith(114.36, 30.54)
    expect(queryEmbedding).toMatchObject({
      applied: true,
      reason: 'encoded',
      source: 'anchor_encoder_intent_adapter_v2',
      embeddingDim: 4,
      components: {
        anchor: expect.objectContaining({
          applied: true,
          weight: expect.any(Number),
          featureSource: 'poi_online_context_v2',
          featureStats: expect.objectContaining({
            neighbor_poi_count: 18,
            road_count: 23,
            landuse_type: '商业服务用地'
          })
        }),
        intentAdapter: expect.objectContaining({
          applied: true,
          signalCount: expect.any(Number),
          weight: expect.any(Number)
        })
      }
    })
    expect(queryEmbedding.queryEmbedding).toHaveLength(4)
    expect(queryEmbedding.queryEmbedding).not.toEqual([0.1, 0.2, 0.3, 0.4])
    expect(buildQueryEmbeddingSearchOptions(queryEmbedding)).toMatchObject({
      queryEmbedding: queryEmbedding.queryEmbedding,
      semanticWeight: 0.52,
      spatialWeight: 0.48
    })
  })

  it('does not collapse same-anchor requests with different spatial intents into the same fused embedding', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(true),
      startSpatialEncoder: vi.fn(),
      encodeCoords: vi.fn().mockResolvedValue({
        embedding: [0.2, 0.4, 0.6, 0.8],
        embedding_dim: 4
      })
    }

    const quietCoffee = await buildSpatialQueryEmbedding({
      userQuery: '武汉大学附近安静一点的咖啡馆',
      intent: {
        category: 'coffee',
        semanticTags: ['quiet', 'study'],
        radiusM: 800
      },
      anchor: {
        lon: 114.36,
        lat: 30.54,
        source: 'spatial_context.center'
      },
      client
    })

    const livelyBar = await buildSpatialQueryEmbedding({
      userQuery: '武汉大学附近热闹一点的酒吧',
      intent: {
        category: 'bar',
        semanticTags: ['lively', 'nightlife'],
        radiusM: 800
      },
      anchor: {
        lon: 114.36,
        lat: 30.54,
        source: 'spatial_context.center'
      },
      client
    })

    expect(quietCoffee.source).toBe('anchor_encoder_intent_adapter_v2')
    expect(livelyBar.source).toBe('anchor_encoder_intent_adapter_v2')
    expect(quietCoffee.queryEmbedding).not.toEqual(livelyBar.queryEmbedding)
  })

  it('lazy-starts the encoder service before encoding when it is not already running', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(false),
      startSpatialEncoder: vi.fn().mockResolvedValue(true),
      encodeCoords: vi.fn().mockResolvedValue({
        embedding: [0.4, 0.5],
        embedding_dim: 2
      })
    }

    const queryEmbedding = await buildSpatialQueryEmbedding({
      userQuery: '光谷附近餐厅',
      intent: {
        category: 'food',
        radiusM: 500
      },
      anchor: {
        lon: 114.41,
        lat: 30.51,
        source: 'poi_features.centroid'
      },
      client
    })

    expect(client.startSpatialEncoder).toHaveBeenCalledTimes(1)
    expect(queryEmbedding).toMatchObject({
      applied: true,
      reason: 'encoded',
      embeddingDim: 2
    })
  })

  it('remains backward compatible when no intent signal is available and keeps the raw anchor embedding', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(true),
      startSpatialEncoder: vi.fn(),
      encodeCoords: vi.fn().mockResolvedValue({
        embedding: [0.2, 0.4, 0.6, 0.8],
        embedding_dim: 4
      })
    }

    const queryEmbedding = await buildSpatialQueryEmbedding({
      userQuery: '附近有什么',
      intent: {},
      anchor: {
        lon: 114.36,
        lat: 30.54,
        source: 'spatial_context.center'
      },
      client
    })

    expect(queryEmbedding).toMatchObject({
      applied: true,
      reason: 'encoded',
      source: 'anchor_encoder_v1',
      embeddingDim: 4,
      queryEmbedding: [0.2, 0.4, 0.6, 0.8]
    })
  })

  it('falls back cleanly when the anchor is invalid', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn(),
      startSpatialEncoder: vi.fn(),
      encodeCoords: vi.fn()
    }

    const queryEmbedding = await buildSpatialQueryEmbedding({
      userQuery: '附近有什么',
      intent: {},
      anchor: {
        lon: null,
        lat: 30.51,
        source: 'invalid'
      },
      client
    })

    expect(queryEmbedding).toEqual({
      applied: false,
      reason: 'invalid_anchor',
      source: null,
      embeddingDim: 0,
      queryEmbedding: null
    })
    expect(client.encodeCoords).not.toHaveBeenCalled()
  })

  it('passes resolved poiId to the encoder client so exact anchor features can be used', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(true),
      startSpatialEncoder: vi.fn(),
      encodeCoords: vi.fn().mockResolvedValue({
        embedding: [0.3, 0.5, 0.7, 0.9],
        embedding_dim: 4,
        feature_source: 'poi_exact_anchor_v1',
        feature_stats: {
          anchor_poi_id: 9527,
          anchor_category_main: '科教文化服务'
        }
      })
    }

    const queryEmbedding = await buildSpatialQueryEmbedding({
      userQuery: '湖北大学附近有哪些地铁站？',
      intent: {
        placeName: '湖北大学',
        category: '交通设施服务',
        poiSubType: '地铁站',
        radiusM: 500
      },
      anchor: {
        lon: 114.334121,
        lat: 30.57687,
        poiId: 9527,
        source: 'intent.place_name'
      },
      client
    })

    expect(client.encodeCoords).toHaveBeenCalledWith(114.334121, 30.57687, {
      poiId: 9527
    })
    expect(queryEmbedding.components.anchor).toMatchObject({
      featureSource: 'poi_exact_anchor_v1',
      featureStats: expect.objectContaining({
        anchor_poi_id: 9527,
        anchor_category_main: '科教文化服务'
      })
    })
  })
})
