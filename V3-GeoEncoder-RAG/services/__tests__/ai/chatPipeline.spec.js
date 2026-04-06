import { describe, expect, it } from 'vitest'

import {
  buildAssistantMetaReply,
  buildSpatialEvidence,
  buildGreetingReply,
  buildGeneralReasoningOutline,
  buildSpatialReasoningOutline,
  deriveSpatialAnchor,
  isAssistantMetaQuery,
  isPureGreetingQuery,
  isLikelySpatialIntent
} from '../../ai/chatPipeline.js'

function polygonBounds(polygon) {
  const ring = polygon?.coordinates?.[0] || []
  const lonValues = ring.map(([lon]) => lon)
  const latValues = ring.map(([, lat]) => lat)
  return {
    minLon: Math.min(...lonValues),
    maxLon: Math.max(...lonValues),
    minLat: Math.min(...latValues),
    maxLat: Math.max(...latValues)
  }
}

describe('chatPipeline spatial intent gating', () => {
  it('recognizes pure greetings before spatial parsing', () => {
    expect(isPureGreetingQuery('你好')).toBe(true)
    expect(isPureGreetingQuery('您好！')).toBe(true)
    expect(isPureGreetingQuery('武汉大学附近咖啡')).toBe(false)
  })

  it('recognizes assistant meta questions before any spatial routing', () => {
    expect(isAssistantMetaQuery('你是谁？')).toBe(true)
    expect(isAssistantMetaQuery('你能干嘛？')).toBe(true)
    expect(isAssistantMetaQuery('湖北大学附近有什么？')).toBe(false)
  })

  it('does not misclassify generic recommendation text as a spatial query without spatial signals', () => {
    expect(
      isLikelySpatialIntent({
        userQuery: '推荐一本好书',
        intent: {
          category: null,
          placeName: null,
          regionLabel: null,
          semanticTags: []
        },
        poiFeatures: [],
        spatialContext: null
      })
    ).toBe(false)
  })

  it('does not treat greeting-only text as spatial even when viewport and visible POIs exist', () => {
    expect(
      isLikelySpatialIntent({
        userQuery: '你好',
        intent: {
          category: '餐饮美食',
          placeName: '武汉大学',
          regionLabel: null,
          semanticTags: []
        },
        poiFeatures: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [114.35, 30.56] },
            properties: { name: '湖北大学' }
          }
        ],
        spatialContext: {
          viewport: [114.3, 30.5, 114.4, 30.6],
          center: { lon: 114.35, lat: 30.55 }
        }
      })
    ).toBe(false)
  })

  it('does not treat assistant identity questions as spatial even if the small model hallucinates a category', () => {
    expect(
      isLikelySpatialIntent({
        userQuery: '你是谁？',
        intent: {
          category: '餐饮美食',
          placeName: '武汉大学',
          regionLabel: 3,
          semanticTags: ['约会']
        },
        poiFeatures: [],
        spatialContext: null
      })
    ).toBe(false)
  })

  it('treats deictic area questions with active map context as spatial queries', () => {
    expect(
      isLikelySpatialIntent({
        userQuery: '这个区域有什么大学？',
        intent: {
          category: null,
          placeName: null,
          regionLabel: null,
          semanticTags: []
        },
        poiFeatures: [],
        spatialContext: {
          viewport: [114.3, 30.5, 114.4, 30.6]
        }
      })
    ).toBe(true)
  })

  it('treats category, place name, user selection or POI context as spatial signals', () => {
    expect(
      isLikelySpatialIntent({
        userQuery: '武汉大学附近咖啡店',
        intent: {
          category: '餐饮美食',
          placeName: '武汉大学',
          regionLabel: null,
          semanticTags: ['安静']
        },
        poiFeatures: [],
        spatialContext: null
      })
    ).toBe(true)
  })
})

describe('chatPipeline subtype observability', () => {
  it('prefers poi subtype wording in reasoning and query plan when available', () => {
    const outline = buildSpatialReasoningOutline({
      intent: {
        placeName: '湖北大学',
        category: '交通设施服务',
        poiSubType: '地铁站'
      },
      spatialContext: null
    })

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-subtype',
      userQuery: '湖北大学附近有哪些地铁站？',
      intent: {
        category: '交通设施服务',
        poiSubType: '地铁站',
        radiusM: 500
      },
      anchor: { lon: 114.334121, lat: 30.57687, source: 'intent.place_name' },
      candidateResults: [],
      filteredResults: [],
      spatialContext: null
    })

    expect(outline).toContain('地铁站')
    expect(evidence.refinedResult.query_plan.categories).toEqual(['地铁站'])
    expect(evidence.refinedResult.query_plan.subcategory).toBe('地铁站')
    expect(evidence.stats.requested_subcategory).toBe('地铁站')
  })

  it('builds task-aware reasoning and exposes structured reasoning metadata for support-gap analysis', () => {
    const outline = buildSpatialReasoningOutline({
      intent: {
        placeName: null,
        anchorMode: 'context',
        taskType: 'support_gap_analysis',
        answerType: 'support_gap_analysis',
        analysisFacets: {
          supportingFacilities: true,
          hotCategories: true,
          gaps: true
        }
      },
      spatialContext: {
        viewport: [114.30, 30.55, 114.37, 30.59]
      }
    })

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-reasoning-001',
      userQuery: '请帮我看看这里附近有什么值得关注的配套、热门业态和明显缺口，并按相关性排序。',
      intent: {
        taskType: 'support_gap_analysis',
        answerType: 'support_gap_analysis',
        anchorMode: 'context',
        analysisFacets: {
          supportingFacilities: true,
          hotCategories: true,
          gaps: true
        },
        radiusM: 800
      },
      anchor: { lon: 114.334121, lat: 30.57687, source: 'spatial_context.viewport' },
      candidateResults: [],
      filteredResults: [],
      spatialContext: {
        viewport: [114.30, 30.55, 114.37, 30.59]
      }
    })

    expect(outline).toContain('配套现状')
    expect(outline).toContain('热门业态')
    expect(outline).toContain('明显缺口')
    expect(evidence.refinedResult.query_plan).toMatchObject({
      task_type: 'support_gap_analysis',
      answer_type: 'support_gap_analysis',
      anchor_mode: 'context'
    })
    expect(evidence.stats).toMatchObject({
      task_type: 'support_gap_analysis',
      answer_type: 'support_gap_analysis',
      anchor_mode: 'context'
    })
    expect(evidence.refinedResult.query_plan.analysis_facets).toMatchObject({
      supportingFacilities: true,
      hotCategories: true,
      gaps: true
    })
  })

  it('adds dual-anchor comparison metadata into the query plan and evidence stats', () => {
    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-comparison-schema-001',
      userQuery: '比较武汉大学和湖北大学附近的业态差异。',
      intent: {
        placeName: '武汉大学',
        taskType: 'region_comparison',
        answerType: 'region_comparison',
        anchorMode: 'explicit_place',
        anchors: [
          { placeName: '武汉大学', displayName: '武汉大学', role: 'primary', index: 0 },
          { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary', index: 1 }
        ],
        analysisFacets: {
          comparison: true
        },
        radiusM: 3200
      },
      anchor: { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' },
      candidateResults: [],
      filteredResults: [
        {
          id: 1,
          name: '武汉大学医院',
          category: '综合医院',
          lon: 114.3643,
          lat: 30.5363,
          distance_m: 12,
          fused_score: 0.94,
          spatial_score: 0.91,
          semantic_score: 0.88
        }
      ],
      spatialContext: null
    })

    expect(evidence.refinedResult.query_plan).toMatchObject({
      anchor: '武汉大学',
      task_type: 'region_comparison',
      answer_type: 'region_comparison',
      comparison_mode: 'dual_anchor',
      anchors: [
        {
          place_name: '武汉大学',
          display_name: '武汉大学',
          role: 'primary'
        },
        {
          place_name: '湖北大学',
          display_name: '湖北大学',
          role: 'secondary'
        }
      ]
    })
    expect(evidence.stats).toMatchObject({
      task_type: 'region_comparison',
      answer_type: 'region_comparison',
      comparison_anchor_count: 2,
      comparison_mode: 'dual_anchor'
    })
  })

  it('passes structured comparison-region evidence through the refined result when dedicated comparison execution provides it', () => {
    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-comparison-regions-001',
      userQuery: '比较武汉大学和湖北大学附近的业态差异。',
      intent: {
        placeName: '武汉大学',
        taskType: 'region_comparison',
        answerType: 'region_comparison',
        anchorMode: 'explicit_place',
        anchors: [
          { placeName: '武汉大学', displayName: '武汉大学', role: 'primary', index: 0 },
          { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary', index: 1 }
        ],
        analysisFacets: {
          comparison: true
        },
        radiusM: 3200
      },
      anchor: { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' },
      candidateResults: [],
      filteredResults: [
        {
          id: 1,
          name: '武汉大学医院',
          category: '综合医院',
          lon: 114.3643,
          lat: 30.5363,
          distance_m: 12,
          fused_score: 0.94,
          spatial_score: 0.91,
          semantic_score: 0.88
        },
        {
          id: 2,
          name: '芊烨餐馆',
          category: '中国菜',
          lon: 114.3345,
          lat: 30.5771,
          distance_m: 18,
          fused_score: 0.92,
          spatial_score: 0.9,
          semantic_score: 0.86
        }
      ],
      spatialContext: null,
      queryEmbedding: {
        applied: false,
        source: 'town_encoder_comparison_route',
        modelUsage: ['town_encoder']
      },
      routeExecutor: {
        name: 'macro_comparison_executor',
        reason: 'dedicated_comparison_executor'
      },
      comparisonRegions: [
        {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          },
          support_buckets: [
            { bucket: '零售购物', count: 3 }
          ],
          support_bucket_metrics: [
            { bucket: '零售购物', count: 3, share: 0.6, share_pct: 60 },
            { bucket: '餐饮配套', count: 2, share: 0.4, share_pct: 40 }
          ],
          representative_pois: [
            { name: '轩轩副食', category: '便民商店/便利店' }
          ],
          population_metrics: {
            avg_density: 24000,
            density_level: 'high',
            high_density_cell_ratio: 0.5
          },
          uncertainty: {
            sample_size: 4,
            comparison_mode: 'dual_anchor'
          }
        },
        {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'secondary'
          },
          support_buckets: [
            { bucket: '餐饮配套', count: 4 }
          ],
          support_bucket_metrics: [
            { bucket: '餐饮配套', count: 4, share: 0.6667, share_pct: 67 },
            { bucket: '交通出行', count: 2, share: 0.3333, share_pct: 33 }
          ],
          representative_pois: [
            { name: '芊烨餐馆', category: '中国菜' }
          ],
          population_metrics: {
            avg_density: 15000,
            density_level: 'medium',
            high_density_cell_ratio: 0
          },
          uncertainty: {
            sample_size: 5,
            comparison_mode: 'dual_anchor'
          }
        }
      ]
    })

    expect(evidence.stats).toMatchObject({
      route_executor: 'macro_comparison_executor',
      query_embedding_source: 'town_encoder_comparison_route',
      comparison_region_count: 2
    })
    expect(evidence.refinedResult.results.comparison_regions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        anchor: expect.objectContaining({
          display_name: '武汉大学'
        }),
        support_buckets: expect.arrayContaining([
          expect.objectContaining({
            bucket: '零售购物'
          })
        ]),
        support_bucket_metrics: expect.arrayContaining([
          expect.objectContaining({
            bucket: '零售购物',
            share_pct: 100
          })
        ]),
        population_metrics: expect.objectContaining({
          avg_density: 24000,
          density_level: 'high'
        })
      }),
      expect.objectContaining({
        anchor: expect.objectContaining({
          display_name: '湖北大学'
        }),
        support_buckets: expect.arrayContaining([
          expect.objectContaining({
            bucket: '餐饮配套'
          })
        ]),
        support_bucket_metrics: expect.arrayContaining([
          expect.objectContaining({
            bucket: '餐饮配套',
            share_pct: 100
          })
        ]),
        population_metrics: expect.objectContaining({
          avg_density: 15000,
          density_level: 'medium'
        })
      })
    ]))
  })

  it('marks town encoder as the primary route when macro cell retrieval is applied', () => {
    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-macro-routing-001',
      userQuery: '帮我看下这里的整体业态概况和缺口',
      intent: {
        taskType: 'area_overview',
        answerType: 'area_overview',
        anchorMode: 'context',
        radiusM: 1200
      },
      anchor: { lon: 114.334121, lat: 30.57687, source: 'spatial_context.viewport' },
      candidateResults: [],
      filteredResults: [],
      spatialContext: {
        viewport: [114.30, 30.55, 114.37, 30.59]
      },
      queryEmbedding: {
        applied: true,
        source: 'poi_encoder',
        modelUsage: ['poi_encoder']
      },
      macroCellSearch: {
        applied: true,
        reason: 'town_encoder_macro_cells',
        modelRoute: 'town_encoder',
        modelsUsed: ['town_encoder'],
        cells: [
          { cell_id: 'cell-a', search_score: 1 },
          { cell_id: 'cell-b', search_score: 0.88 }
        ]
      },
      runtimeEnrichment: {
        applied: false,
        reason: 'already_enriched',
        modelsUsed: ['poi_encoder']
      }
    })

    expect(evidence.stats).toMatchObject({
      macro_cell_search_applied: true,
      macro_cell_count: 2,
      model_route_primary: 'town_encoder',
      model_route_secondary: ['poi_encoder'],
      model_usage: ['town_encoder', 'poi_encoder']
    })
  })

  it('builds schema-friendly macro evidence blocks for support buckets, representative pois, and uncertainty', () => {
    const filteredResults = [
      {
        id: 201,
        name: '川味人家',
        category: '中国菜',
        regionLabel: 1,
        lon: 114.3645,
        lat: 30.5365,
        distance_m: 88,
        fused_score: 0.95,
        spatial_score: 0.93,
        semantic_score: 0.9
      },
      {
        id: 202,
        name: '瑞幸咖啡',
        category: '咖啡',
        regionLabel: 1,
        lon: 114.3648,
        lat: 30.5358,
        distance_m: 126,
        fused_score: 0.92,
        spatial_score: 0.9,
        semantic_score: 0.88
      },
      {
        id: 203,
        name: 'Today便利店',
        category: '便利店',
        regionLabel: 1,
        lon: 114.3639,
        lat: 30.5361,
        distance_m: 144,
        fused_score: 0.84,
        spatial_score: 0.81,
        semantic_score: 0.79
      },
      {
        id: 204,
        name: '武大校医院',
        category: '综合医院',
        regionLabel: 1,
        lon: 114.3652,
        lat: 30.5372,
        distance_m: 236,
        fused_score: 0.8,
        spatial_score: 0.77,
        semantic_score: 0.74
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-macro-schema-001',
      userQuery: '请分析武汉大学附近的配套、热门业态和明显缺口。',
      intent: {
        placeName: '武汉大学',
        taskType: 'support_gap_analysis',
        answerType: 'support_gap_analysis',
        anchorMode: 'explicit_place',
        analysisFacets: {
          supportingFacilities: true,
          hotCategories: true,
          gaps: true
        },
        radiusM: 1200
      },
      anchor: { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' },
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: null
    })

    expect(evidence.supportBuckets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bucket: '餐饮配套',
        count: 2
      }),
      expect.objectContaining({
        bucket: '零售购物',
        count: 1
      }),
      expect.objectContaining({
        bucket: '医疗健康',
        count: 1
      })
    ]))
    expect(evidence.representativePois).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '川味人家',
        support_bucket: '餐饮配套'
      }),
      expect.objectContaining({
        name: 'Today便利店',
        support_bucket: '零售购物'
      })
    ]))
    expect(evidence.uncertainty).toMatchObject({
      sample_size: 4,
      support_bucket_count: 3,
      representative_poi_count: 4,
      evidence_density: 'medium',
      low_sample_warning: false
    })
    expect(evidence.refinedResult.results).toMatchObject({
      support_buckets: expect.arrayContaining([
        expect.objectContaining({
          bucket: '餐饮配套',
          count: 2
        })
      ]),
      representative_pois: expect.arrayContaining([
        expect.objectContaining({
          name: '川味人家'
        })
      ]),
      uncertainty: expect.objectContaining({
        sample_size: 4,
        evidence_density: 'medium'
      })
    })
    expect(evidence.stats).toMatchObject({
      support_bucket_count: 3,
      representative_poi_count: 4,
      evidence_density: 'medium',
      low_sample_warning: false
    })
  })

  it('exposes the online query feature source when query embedding carries richer anchor metadata', () => {
    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-query-feature-source-001',
      userQuery: '武汉大学附近有哪些咖啡店？',
      intent: {
        category: '餐饮美食',
        poiSubType: '咖啡',
        radiusM: 800
      },
      anchor: { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' },
      candidateResults: [],
      filteredResults: [],
      spatialContext: null,
      queryEmbedding: {
        applied: true,
        source: 'anchor_encoder_intent_adapter_v2',
        modelUsage: ['poi_encoder'],
        components: {
          anchor: {
            applied: true,
            weight: 0.72,
            featureSource: 'poi_online_context_v2'
          }
        }
      }
    })

    expect(evidence.stats).toMatchObject({
      query_embedding_applied: true,
      query_embedding_source: 'anchor_encoder_intent_adapter_v2',
      query_embedding_feature_source: 'poi_online_context_v2'
    })
  })
})

describe('chatPipeline general replies', () => {
  it('builds deterministic replies for assistant identity and capability queries', () => {
    expect(buildAssistantMetaReply('你是谁？')).toContain('武汉三镇的地理智能助手')
    expect(buildAssistantMetaReply('你能干嘛？')).toContain('湖北大学附近有哪些地铁站')
  })

  it('builds a dedicated reasoning outline for assistant meta queries', () => {
    const outline = buildGeneralReasoningOutline({
      userQuery: '你是谁？',
      isAssistantMeta: true
    })

    expect(outline).toContain('助手身份/能力问答')
    expect(outline).toContain('不调用空间检索')
  })
})

describe('chatPipeline anchor derivation', () => {
  it('prefers spatialContext.center when available', () => {
    expect(
      deriveSpatialAnchor({
        poiFeatures: [],
        spatialContext: {
          center: { lon: 114.401, lat: 30.612 }
        }
      })
    ).toEqual({
      lon: 114.401,
      lat: 30.612,
      source: 'spatial_context.center'
    })
  })

  it('falls back to poi feature centroid before the hard-coded default', () => {
    expect(
      deriveSpatialAnchor({
        poiFeatures: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [114.31, 30.51] },
            properties: { name: '点位A' }
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [114.35, 30.55] },
            properties: { name: '点位B' }
          }
        ],
        spatialContext: null
      })
    ).toEqual({
      lon: 114.33,
      lat: 30.53,
      source: 'poi_features.centroid'
    })
  })

  it('tolerates null poiFeatures and falls back to the default anchor', () => {
    expect(
      deriveSpatialAnchor({
        poiFeatures: null,
        spatialContext: null
      })
    ).toEqual({
      lon: 114.3055,
      lat: 30.5931,
      source: 'default'
    })
  })
})

describe('chatPipeline evidence building', () => {
  it('builds minimal structured evidence payloads consumable by the frontend', () => {
    const anchor = { lon: 114.33, lat: 30.53, source: 'poi_features.centroid' }
    const filteredResults = [
      {
        id: 1,
        name: '湖北大学',
        category: '科教文化服务',
        regionLabel: 3,
        lon: 114.351,
        lat: 30.562,
        distance_m: 120,
        spatial_score: 0.92,
        semantic_score: 0.81,
        fused_score: 0.88
      },
      {
        id: 2,
        name: '沙湖公园',
        category: '风景名胜',
        regionLabel: 5,
        lon: 114.327,
        lat: 30.571,
        distance_m: 260,
        spatial_score: 0.76,
        semantic_score: 0.73,
        fused_score: 0.75
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-001',
      userQuery: '湖北大学周边有什么适合散步的地方',
      intent: {
        category: '风景名胜',
        intentDesc: '寻找适合散步的地点',
        radiusM: 500
      },
      anchor,
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: {
        boundary: [
          [114.30, 30.55],
          [114.37, 30.55],
          [114.37, 30.58],
          [114.30, 30.58]
        ]
      }
    })

    expect(evidence.pois).toHaveLength(2)
    expect(evidence.boundary).toMatchObject({
      type: 'Polygon',
      coordinates: expect.any(Array)
    })
    expect(evidence.spatialClusters).toMatchObject({
      hotspots: [
        expect.objectContaining({
          poiCount: 2,
          center: expect.any(Array)
        })
      ]
    })
    expect(evidence.stats).toMatchObject({
      trace_id: 'trace-v3-001',
      candidate_count: 2,
      result_count: 2,
      radius_m: 500,
      anchor_source: 'poi_features.centroid'
    })
    expect(evidence.refinedResult).toMatchObject({
      results: expect.objectContaining({
        boundary: evidence.boundary,
        spatial_clusters: evidence.spatialClusters,
        stats: evidence.stats
      })
    })
  })

  it('builds region-specific boundaries and fuzzy layers for V3 evidence instead of reusing one placeholder polygon', () => {
    const filteredResults = [
      {
        id: 1,
        name: 'Region A-1',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3000,
        lat: 30.5000,
        distance_m: 120,
        spatial_score: 0.92,
        semantic_score: 0.86,
        fused_score: 0.89
      },
      {
        id: 2,
        name: 'Region A-2',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3022,
        lat: 30.5008,
        distance_m: 150,
        spatial_score: 0.91,
        semantic_score: 0.82,
        fused_score: 0.87
      },
      {
        id: 3,
        name: 'Region A-3',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3014,
        lat: 30.5030,
        distance_m: 180,
        spatial_score: 0.88,
        semantic_score: 0.79,
        fused_score: 0.84
      },
      {
        id: 4,
        name: 'Region B-1',
        category: 'park',
        regionLabel: 5,
        lon: 114.3320,
        lat: 30.5280,
        distance_m: 260,
        spatial_score: 0.76,
        semantic_score: 0.74,
        fused_score: 0.75
      },
      {
        id: 5,
        name: 'Region B-2',
        category: 'park',
        regionLabel: 5,
        lon: 114.3344,
        lat: 30.5292,
        distance_m: 310,
        spatial_score: 0.72,
        semantic_score: 0.71,
        fused_score: 0.72
      },
      {
        id: 6,
        name: 'Region B-3',
        category: 'park',
        regionLabel: 5,
        lon: 114.3331,
        lat: 30.5310,
        distance_m: 340,
        spatial_score: 0.70,
        semantic_score: 0.68,
        fused_score: 0.69
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-l5-001',
      userQuery: 'find spatially structured regions',
      intent: {
        category: 'mixed',
        intentDesc: 'region comparison',
        radiusM: 800
      },
      anchor: { lon: 114.317, lat: 30.515, source: 'test' },
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: null
    })

    expect(evidence.vernacularRegions).toHaveLength(2)
    expect(evidence.vernacularRegions.every((item) => item.boundary_geojson?.type === 'Polygon')).toBe(true)
    expect(evidence.vernacularRegions[0].boundary_geojson).not.toEqual(evidence.boundary)
    expect(evidence.vernacularRegions[1].boundary_geojson).not.toEqual(evidence.boundary)

    expect(evidence.fuzzyRegions).toHaveLength(1)
    expect(evidence.fuzzyRegions[0]).toMatchObject({
      layers: {
        outer: { boundary: expect.any(Object) },
        transition: { boundary: expect.any(Object) },
        core: { boundary: expect.any(Object) }
      }
    })

    expect(evidence.stats).toMatchObject({
      boundary_generation_method: expect.any(String),
      vernacular_region_count: 2,
      fuzzy_region_count: 1
    })
  })

  it('keeps an explicit selection boundary as the query boundary while still generating internal region polygons', () => {
    const explicitBoundary = [
      [114.2900, 30.4900],
      [114.3600, 30.4900],
      [114.3600, 30.5400],
      [114.2900, 30.5400]
    ]

    const filteredResults = [
      {
        id: 11,
        name: 'Cluster 1',
        category: 'food',
        regionLabel: 1,
        lon: 114.3000,
        lat: 30.5000,
        distance_m: 100,
        spatial_score: 0.9,
        semantic_score: 0.8,
        fused_score: 0.86
      },
      {
        id: 12,
        name: 'Cluster 2',
        category: 'food',
        regionLabel: 1,
        lon: 114.3040,
        lat: 30.5030,
        distance_m: 130,
        spatial_score: 0.88,
        semantic_score: 0.78,
        fused_score: 0.84
      },
      {
        id: 13,
        name: 'Cluster 3',
        category: 'food',
        regionLabel: 1,
        lon: 114.3060,
        lat: 30.5000,
        distance_m: 160,
        spatial_score: 0.86,
        semantic_score: 0.76,
        fused_score: 0.82
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-l5-002',
      userQuery: 'use selected polygon',
      intent: {
        category: 'food',
        intentDesc: 'selected polygon search',
        radiusM: 600
      },
      anchor: { lon: 114.305, lat: 30.501, source: 'test' },
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: {
        boundary: explicitBoundary
      }
    })

    expect(evidence.boundary).toMatchObject({
      type: 'Polygon',
      coordinates: [expect.arrayContaining([[114.29, 30.49]])]
    })
    expect(evidence.stats.boundary_source).toBe('spatial_context.boundary')
    expect(evidence.vernacularRegions[0].boundary_geojson).not.toEqual(evidence.boundary)
  })

  it('uses encoder-ranked high-confidence points to contract the fuzzy core boundary instead of uniformly shrinking the whole query extent', () => {
    const filteredResults = [
      {
        id: 21,
        name: 'Core A',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3000,
        lat: 30.5000,
        distance_m: 80,
        spatial_score: 0.95,
        semantic_score: 0.92,
        fused_score: 0.94
      },
      {
        id: 22,
        name: 'Core B',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3015,
        lat: 30.5008,
        distance_m: 100,
        spatial_score: 0.93,
        semantic_score: 0.91,
        fused_score: 0.92
      },
      {
        id: 23,
        name: 'Core C',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3010,
        lat: 30.5021,
        distance_m: 110,
        spatial_score: 0.92,
        semantic_score: 0.89,
        fused_score: 0.91
      },
      {
        id: 24,
        name: 'Low-score outlier 1',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3400,
        lat: 30.5320,
        distance_m: 500,
        spatial_score: 0.32,
        semantic_score: 0.28,
        fused_score: 0.30
      },
      {
        id: 25,
        name: 'Low-score outlier 2',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3420,
        lat: 30.5330,
        distance_m: 540,
        spatial_score: 0.30,
        semantic_score: 0.27,
        fused_score: 0.29
      },
      {
        id: 26,
        name: 'Low-score outlier 3',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3410,
        lat: 30.5345,
        distance_m: 570,
        spatial_score: 0.28,
        semantic_score: 0.25,
        fused_score: 0.27
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-l5-003',
      userQuery: 'encoder first boundary generation',
      intent: {
        category: 'coffee',
        intentDesc: 'boundary should follow encoder confidence',
        radiusM: 1000
      },
      anchor: { lon: 114.305, lat: 30.505, source: 'test' },
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: null
    })

    const outerBounds = polygonBounds(evidence.fuzzyRegions[0].layers.outer.boundary)
    const coreBounds = polygonBounds(evidence.fuzzyRegions[0].layers.core.boundary)

    expect(outerBounds.maxLon).toBeGreaterThan(114.33)
    expect(coreBounds.maxLon).toBeLessThan(114.32)
    expect(evidence.stats).toMatchObject({
      boundary_signal_model: 'encoder_region_fused_v1',
      encoder_core_point_count: expect.any(Number),
      encoder_region_purity: expect.any(Number)
    })
  })

  it('forwards vector surface candidates into geometry evidence assembly when V3 surface context is available', () => {
    const filteredResults = [
      {
        id: 31,
        name: 'Block point 1',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3008,
        lat: 30.5008,
        fused_score: 0.94,
        spatial_score: 0.95,
        semantic_score: 0.9
      },
      {
        id: 32,
        name: 'Block point 2',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3058,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-l5-004',
      userQuery: 'surface constrained boundary',
      intent: {
        category: 'coffee',
        radiusM: 800
      },
      anchor: { lon: 114.304, lat: 30.502, source: 'test' },
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: null,
      surfaceContext: {
        roadBlocks: [
          {
            block_id: 11,
            geometry_geojson: {
              type: 'Polygon',
              coordinates: [[[114.3000, 30.5000], [114.3040, 30.5000], [114.3040, 30.5040], [114.3000, 30.5040], [114.3000, 30.5000]]]
            }
          },
          {
            block_id: 12,
            geometry_geojson: {
              type: 'Polygon',
              coordinates: [[[114.3040, 30.5000], [114.3080, 30.5000], [114.3080, 30.5040], [114.3040, 30.5040], [114.3040, 30.5000]]]
            }
          }
        ]
      }
    })

    expect(evidence.boundary).toMatchObject({
      type: 'FeatureCollection',
      features: expect.any(Array)
    })
    expect(evidence.stats.boundary_generation_method).toBe('road_block_support_v1')
    expect(evidence.stats.vector_constraint_source).toBe('road_blocks')
  })

  it('uses spatial-encoder region predictions when database region labels are missing', () => {
    const filteredResults = [
      {
        id: 41,
        name: 'Predicted region A-1',
        category: 'coffee',
        regionLabel: null,
        lon: 114.3000,
        lat: 30.5000,
        fused_score: 0.91,
        spatial_score: 0.92,
        semantic_score: 0.87,
        spatial_info: {
          region_idx: 1,
          region_name: '商业类',
          region_confidence: 0.88
        }
      },
      {
        id: 42,
        name: 'Predicted region A-2',
        category: 'coffee',
        regionLabel: null,
        lon: 114.3012,
        lat: 30.5007,
        fused_score: 0.9,
        spatial_score: 0.91,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_name: '商业类',
          region_confidence: 0.85
        }
      },
      {
        id: 43,
        name: 'Predicted region B-1',
        category: 'park',
        regionLabel: null,
        lon: 114.3320,
        lat: 30.5280,
        fused_score: 0.72,
        spatial_score: 0.73,
        semantic_score: 0.68,
        spatial_info: {
          region_idx: 5,
          region_name: '自然类',
          region_confidence: 0.81
        }
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-l5-005',
      userQuery: 'encoder predicted regions',
      intent: {
        category: 'mixed',
        radiusM: 900
      },
      anchor: { lon: 114.315, lat: 30.515, source: 'test' },
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: null
    })

    expect(evidence.vernacularRegions).toHaveLength(2)
    expect(evidence.stats).toMatchObject({
      encoder_region_predicted_count: 3,
      encoder_region_high_confidence_count: 3
    })
  })

  it('prefers refined PostGIS surface polygons over raw selected-face feature collections when provided', () => {
    const filteredResults = [
      {
        id: 51,
        name: 'Refined A',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3008,
        lat: 30.5008,
        fused_score: 0.94,
        spatial_score: 0.95,
        semantic_score: 0.9
      },
      {
        id: 52,
        name: 'Refined B',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3058,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86
      }
    ]

    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-l5-006',
      userQuery: 'postgis refined surface boundary',
      intent: {
        category: 'coffee',
        radiusM: 800
      },
      anchor: { lon: 114.304, lat: 30.502, source: 'test' },
      candidateResults: filteredResults,
      filteredResults,
      spatialContext: null,
      surfaceConstraint: {
        source: 'road_blocks',
        method: 'road_block_support_v1_postgis',
        boundary: {
          type: 'Polygon',
          coordinates: [[[114.3000, 30.5000], [114.3080, 30.5000], [114.3080, 30.5040], [114.3000, 30.5040], [114.3000, 30.5000]]]
        },
        outerBoundary: {
          type: 'Polygon',
          coordinates: [[[114.2995, 30.4995], [114.3085, 30.4995], [114.3085, 30.5045], [114.2995, 30.5045], [114.2995, 30.4995]]]
        },
        transitionBoundary: {
          type: 'Polygon',
          coordinates: [[[114.3002, 30.5001], [114.3078, 30.5001], [114.3078, 30.5039], [114.3002, 30.5039], [114.3002, 30.5001]]]
        },
        coreBoundary: {
          type: 'Polygon',
          coordinates: [[[114.3010, 30.5005], [114.3070, 30.5005], [114.3070, 30.5033], [114.3010, 30.5033], [114.3010, 30.5005]]]
        },
        selectedCount: 2,
        rejectedCount: 0,
        selectedIds: [11, 12]
      }
    })

    expect(evidence.boundary).toMatchObject({ type: 'Polygon' })
    expect(evidence.stats.boundary_generation_method).toBe('road_block_support_v1_postgis')
    expect(evidence.fuzzyRegions[0].layers.core.boundary).toMatchObject({
      type: 'Polygon',
      coordinates: [expect.arrayContaining([[114.301, 30.5005]])]
    })
  })

  it('prefers town macro summaries over noisy poi summaries when macro cell search exposes them', () => {
    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-macro-summary-001',
      userQuery: '请概览武汉大学附近的空间结构和业态分布。',
      intent: {
        placeName: '武汉大学',
        taskType: 'area_overview',
        answerType: 'area_overview',
        anchorMode: 'explicit_place',
        radiusM: 2500
      },
      anchor: { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' },
      candidateResults: [],
      filteredResults: [
        {
          id: 1,
          name: '公交站A',
          category: '公交车站',
          lon: 114.3644,
          lat: 30.5365,
          distance_m: 80,
          fused_score: 0.76,
          spatial_score: 0.71,
          semantic_score: 0.68
        },
        {
          id: 2,
          name: '公交站B',
          category: '公交车站',
          lon: 114.3646,
          lat: 30.5362,
          distance_m: 95,
          fused_score: 0.72,
          spatial_score: 0.69,
          semantic_score: 0.64
        }
      ],
      macroCellSearch: {
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: [
          {
            cell_id: 'whu-cell-1',
            lon: 114.3643,
            lat: 30.5363,
            distance_m: 0,
            similarity: 1,
            search_score: 1,
            population_density: 26800
          }
        ],
        modelsUsed: ['town_encoder'],
        supportBucketDistribution: [
          {
            bucket: '零售购物',
            count: 4,
            examples: ['中百超市'],
            representative_categories: ['购物消费']
          }
        ],
        dominantBuckets: ['零售购物', '生活服务'],
        sceneTags: ['高校周边', '混合业态'],
        cellMix: [
          { label: '教育类', count: 2, ratio: 0.67 },
          { label: '商业类', count: 1, ratio: 0.33 }
        ],
        macroUncertainty: {
          sample_size: 4,
          evidence_density: 'high',
          low_sample_warning: false
        }
      },
      spatialContext: null
    })

    expect(evidence.supportBuckets).toMatchObject([
      {
        bucket: '零售购物',
        count: 4
      }
    ])
    expect(evidence.uncertainty).toMatchObject({
      evidence_density: 'high',
      low_sample_warning: false
    })
    expect(evidence.stats).toMatchObject({
      support_bucket_count: 1,
      evidence_density: 'high',
      macro_scene_tag_count: 2
    })
    expect(evidence.refinedResult.results.macro_cell_summary).toMatchObject({
      support_bucket_metrics: [
        {
          bucket: '零售购物',
          count: 4,
          share_pct: 100
        }
      ],
      dominant_buckets: ['零售购物', '生活服务'],
      scene_tags: ['高校周边', '混合业态'],
      cell_mix: [
        { label: '教育类', count: 2, ratio: 0.67 },
        { label: '商业类', count: 1, ratio: 0.33 }
      ],
      population_metrics: {
        avg_density: 26800,
        density_level: 'high'
      }
    })
  })

  it('reorders site-suitability macro buckets toward deployable consumer signals instead of defaulting to campus identity buckets', () => {
    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-site-suitability-buckets-001',
      userQuery: '武汉大学附近适合布局什么业态？',
      intent: {
        placeName: '武汉大学',
        taskType: 'site_suitability',
        answerType: 'site_suitability',
        anchorMode: 'explicit_place',
        radiusM: 2200
      },
      anchor: { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' },
      candidateResults: [],
      filteredResults: [
        {
          id: 1,
          name: '武汉大学医院',
          category: '综合医院',
          lon: 114.3645,
          lat: 30.5366,
          distance_m: 8,
          fused_score: 0.97,
          spatial_score: 0.96,
          semantic_score: 0.9
        },
        {
          id: 2,
          name: '轩轩副食',
          category: '便民商店/便利店',
          lon: 114.3647,
          lat: 30.5364,
          distance_m: 12,
          fused_score: 0.95,
          spatial_score: 0.94,
          semantic_score: 0.88
        },
        {
          id: 3,
          name: '瑞幸咖啡',
          category: '咖啡',
          lon: 114.3649,
          lat: 30.5363,
          distance_m: 18,
          fused_score: 0.92,
          spatial_score: 0.91,
          semantic_score: 0.86
        },
        {
          id: 4,
          name: '武汉大学第5教学楼',
          category: '学校',
          lon: 114.3651,
          lat: 30.5369,
          distance_m: 36,
          fused_score: 0.9,
          spatial_score: 0.88,
          semantic_score: 0.82
        }
      ],
      macroCellSearch: {
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: [
          {
            cell_id: 'whu-cell-1',
            lon: 114.3643,
            lat: 30.5363,
            distance_m: 0,
            similarity: 1,
            search_score: 1
          }
        ],
        modelsUsed: ['town_encoder'],
        supportBucketDistribution: [
          { bucket: '教育服务', count: 7, examples: ['武汉大学'] },
          { bucket: '零售购物', count: 5, examples: ['轩轩副食'] },
          { bucket: '餐饮配套', count: 4, examples: ['瑞幸咖啡'] },
          { bucket: '生活服务', count: 3, examples: ['校园营业厅'] }
        ],
        dominantBuckets: ['教育服务', '零售购物'],
        sceneTags: ['高校周边', '混合业态'],
        cellMix: [
          { label: '教育类', count: 2, ratio: 0.67 },
          { label: '商业类', count: 1, ratio: 0.33 }
        ],
        macroUncertainty: {
          sample_size: 4,
          evidence_density: 'high',
          low_sample_warning: false
        }
      },
      spatialContext: null
    })

    expect(evidence.supportBuckets.slice(0, 3).map((item) => item.bucket)).toEqual([
      '零售购物',
      '餐饮配套',
      '生活服务'
    ])
    expect(evidence.refinedResult.results.support_buckets.slice(0, 2).map((item) => item.bucket)).toEqual([
      '零售购物',
      '餐饮配套'
    ])
  })

  it('reorders structured comparison-region buckets so contrastive consumer signals surface before broad campus labels', () => {
    const evidence = buildSpatialEvidence({
      traceId: 'trace-v3-comparison-bucket-order-001',
      userQuery: '比较武汉大学和湖北大学附近的业态差异。',
      intent: {
        placeName: '武汉大学',
        taskType: 'region_comparison',
        answerType: 'region_comparison',
        anchorMode: 'explicit_place',
        anchors: [
          { placeName: '武汉大学', displayName: '武汉大学', role: 'primary', index: 0 },
          { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary', index: 1 }
        ],
        radiusM: 3200
      },
      anchor: { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' },
      candidateResults: [],
      filteredResults: [],
      spatialContext: null,
      comparisonRegions: [
        {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          },
          support_buckets: [
            { bucket: '教育服务', count: 7, examples: ['武汉大学'] },
            { bucket: '零售购物', count: 5, examples: ['轩轩副食'] },
            { bucket: '餐饮配套', count: 2, examples: ['瑞幸咖啡'] }
          ],
          representative_pois: [
            { name: '轩轩副食', category: '便民商店/便利店', support_bucket: '零售购物' },
            { name: '武汉大学医院', category: '综合医院', support_bucket: '医疗健康' },
            { name: '武汉大学第5教学楼', category: '学校', support_bucket: '教育服务' }
          ],
          uncertainty: {
            sample_size: 5,
            comparison_mode: 'dual_anchor'
          }
        },
        {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'secondary'
          },
          support_buckets: [
            { bucket: '生活服务', count: 6, examples: ['湖北大学(武昌校区)'] },
            { bucket: '餐饮配套', count: 6, examples: ['芊烨餐馆'] },
            { bucket: '教育服务', count: 5, examples: ['湖北大学'] }
          ],
          representative_pois: [
            { name: '芊烨餐馆', category: '中国菜', support_bucket: '餐饮配套' },
            { name: '团结大道油料社区(公交站)', category: '公交车站', support_bucket: '交通出行' },
            { name: '湖北大学(武昌校区)', category: '学校', support_bucket: '教育服务' }
          ],
          uncertainty: {
            sample_size: 5,
            comparison_mode: 'dual_anchor'
          }
        }
      ]
    })

    expect(evidence.comparisonRegions[0].support_buckets[0].bucket).toBe('零售购物')
    expect(evidence.comparisonRegions[1].support_buckets[0].bucket).toBe('餐饮配套')
    expect(evidence.refinedResult.results.comparison_regions[1].support_buckets[0].bucket).toBe('餐饮配套')
  })
})

describe('chatPipeline reasoning outlines', () => {
  it('builds a non-spatial outline for greetings', () => {
    expect(buildGeneralReasoningOutline({ userQuery: '你好', isGreeting: true }))
      .toContain('普通问候')
  })

  it('builds a stable greeting reply for pure greetings', () => {
    expect(buildGreetingReply('你好')).toContain('有什么我可以帮你的吗')
    expect(buildGreetingReply('武汉大学附近')).toBe('')
  })

  it('builds a user-facing spatial outline instead of raw retrieval counters', () => {
    const outline = buildSpatialReasoningOutline({
      intent: {
        placeName: '武汉大学',
        category: '餐饮美食'
      },
      spatialContext: null
    })

    expect(outline).toContain('围绕“武汉大学”附近展开检索')
    expect(outline).toContain('餐饮美食')
    expect(outline).not.toContain('50')
  })
})
