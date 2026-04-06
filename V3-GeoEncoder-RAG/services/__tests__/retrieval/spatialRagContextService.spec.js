import { describe, expect, it, vi } from 'vitest'

import { buildSpatialRagContext } from '../../retrieval/spatialRagContextService.js'

describe('spatialRagContextService', () => {
  it('returns a model-agnostic spatial context contract without forcing chat generation', async () => {
    const deps = {
      handleSpatialQuery: vi.fn().mockResolvedValue({
        intent: {
          category: 'coffee',
          semanticTags: ['quiet', 'study'],
          intentDesc: '想找适合学习的安静咖啡馆',
          radiusM: 800,
          regionLabel: 1,
          method: 'small_llm'
        },
        anchor: {
          lon: 114.36,
          lat: 30.54,
          source: 'spatial_context.center'
        },
        queryEmbedding: {
          applied: true,
          reason: 'encoded',
          source: 'anchor_encoder_intent_adapter_v2',
          embeddingDim: 352,
          queryEmbedding: [0.12, 0.34, 0.56],
          components: {
            anchor: {
              applied: true,
              weight: 0.76
            },
            intentAdapter: {
              applied: true,
              weight: 0.24,
              signalCount: 4
            }
          }
        },
        candidateResults: [
          { id: 1 },
          { id: 2 },
          { id: 3 }
        ],
        results: [
          {
            id: 101,
            name: '静谧咖啡馆',
            category: 'coffee',
            regionLabel: 1,
            lon: 114.3608,
            lat: 30.5409,
            distance_m: 118,
            fused_score: 0.94,
            spatial_score: 0.91,
            semantic_score: 0.89,
            spatial_info: {
              region_idx: 1,
              region_name: '商业类',
              region_confidence: 0.87
            }
          },
          {
            id: 102,
            name: '湖畔咖啡',
            category: 'coffee',
            regionLabel: 1,
            lon: 114.3621,
            lat: 30.5412,
            distance_m: 186,
            fused_score: 0.91,
            spatial_score: 0.88,
            semantic_score: 0.86
          }
        ],
        runtimeEnrichment: {
          applied: true,
          reason: 'enriched'
        },
        evidence: {
          boundary: {
            type: 'Polygon',
            coordinates: [[
              [114.36, 30.54],
              [114.363, 30.54],
              [114.363, 30.543],
              [114.36, 30.543],
              [114.36, 30.54]
            ]]
          },
          spatialClusters: {
            hotspots: [
              {
                id: 'hotspot-1',
                name: '学习咖啡热点'
              }
            ]
          },
          vernacularRegions: [
            {
              id: 'region-1',
              name: '商业片区'
            }
          ],
          fuzzyRegions: [
            {
              id: 'fuzzy-1',
              name: '静谧咖啡片区',
              boundary_confidence: 0.84
            }
          ],
          stats: {
            candidate_count: 3,
            result_count: 2,
            avg_boundary_confidence: 0.84,
            boundary_confidence_model: 'v3_encoder_surface_confidence_v2',
            vector_constraint_source: 'road_blocks'
          },
          queryPlan: {
            query_type: 'poi_search',
            intent_mode: 'local_search'
          }
        }
      })
    }

    const payload = await buildSpatialRagContext({
      userQuery: '武汉大学附近安静一点的咖啡馆',
      topK: 1,
      spatialContext: {
        center: [114.36, 30.54]
      },
      traceId: 'trace-spatial-context'
    }, deps)

    expect(deps.handleSpatialQuery).toHaveBeenCalledWith('武汉大学附近安静一点的咖啡馆', {
      poiFeatures: [],
      spatialContext: {
        center: [114.36, 30.54]
      },
      intent: null,
      traceId: 'trace-spatial-context'
    })
    expect(payload).toMatchObject({
      success: true,
      contract: 'v3-spatial-rag-context/v1',
      query: '武汉大学附近安静一点的咖啡馆',
      anchor: {
        lon: 114.36,
        lat: 30.54,
        source: 'spatial_context.center'
      },
      query_embedding: {
        applied: true,
        source: 'anchor_encoder_intent_adapter_v2',
        embedding_dim: 352
      },
      retrieval: {
        candidate_count: 3,
        result_count: 2,
        returned_context_count: 1,
        encoder_enrichment_applied: true
      },
      evidence_summary: {
        boundary_available: true,
        avg_boundary_confidence: 0.84,
        hotspot_count: 1,
        vernacular_region_count: 1,
        fuzzy_region_count: 1,
        vector_constraint_source: 'road_blocks'
      },
      spatial_contexts: [
        {
          rank: 1,
          id: 101,
          name: '静谧咖啡馆'
        }
      ],
      llm_context: {
        type: 'spatial_rag_context'
      }
    })
    expect(payload).not.toHaveProperty('answer')
    expect(payload.llm_context.prompt).toContain('静谧咖啡馆')
    expect(payload.llm_context.facts).toEqual(expect.arrayContaining([
      expect.stringContaining('anchor'),
      expect.stringContaining('query_embedding'),
      expect.stringContaining('静谧咖啡馆')
    ]))
  })

  it('exposes schema-first comparison context with anchors for downstream LLM consumers', async () => {
    const deps = {
      handleSpatialQuery: vi.fn().mockResolvedValue({
        intent: {
          placeName: '武汉大学',
          taskType: 'region_comparison',
          answerType: 'region_comparison',
          anchorMode: 'explicit_place',
          analysisFacets: {
            comparison: true
          },
          anchors: [
            { placeName: '武汉大学', displayName: '武汉大学', role: 'primary', index: 0 },
            { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary', index: 1 }
          ],
          radiusM: 3200,
          method: 'fallback'
        },
        anchor: {
          lon: 114.364339,
          lat: 30.536334,
          source: 'intent.place_name'
        },
        queryEmbedding: {
          applied: true,
          reason: 'encoded',
          source: 'anchor_encoder_v1',
          embeddingDim: 352,
          queryEmbedding: [0.22, 0.31, 0.47]
        },
        candidateResults: [{ id: 1 }],
        results: [
          {
            id: 101,
            name: '武汉大学医院',
            category: '综合医院',
            regionLabel: 3,
            lon: 114.3648,
            lat: 30.5367,
            distance_m: 56,
            fused_score: 0.93,
            spatial_score: 0.9,
            semantic_score: 0.87
          }
        ],
        runtimeEnrichment: {
          applied: false,
          reason: 'already_enriched'
        },
        evidence: {
          boundary: null,
          spatialClusters: { hotspots: [] },
          vernacularRegions: [],
          fuzzyRegions: [],
          stats: {
            candidate_count: 1,
            result_count: 1,
            avg_boundary_confidence: 0.62,
            boundary_confidence_model: 'v3_l5_geometry_v1',
            comparison_anchor_count: 2,
            comparison_mode: 'dual_anchor'
          },
          queryPlan: {
            query_type: 'poi_search',
            intent_mode: 'local_search',
            task_type: 'region_comparison',
            anchors: [
              { place_name: '武汉大学', display_name: '武汉大学', role: 'primary' },
              { place_name: '湖北大学', display_name: '湖北大学', role: 'secondary' }
            ],
            comparison_mode: 'dual_anchor'
          }
        }
      })
    }

    const payload = await buildSpatialRagContext({
      userQuery: '比较武汉大学和湖北大学附近的业态差异。',
      traceId: 'trace-comparison-context'
    }, deps)

    expect(payload.intent).toMatchObject({
      place_name: '武汉大学',
      task_type: 'region_comparison',
      answer_type: 'region_comparison',
      anchor_mode: 'explicit_place',
      anchors: [
        { place_name: '武汉大学', display_name: '武汉大学', role: 'primary' },
        { place_name: '湖北大学', display_name: '湖北大学', role: 'secondary' }
      ]
    })
    expect(payload.query_plan).toMatchObject({
      task_type: 'region_comparison',
      comparison_mode: 'dual_anchor'
    })
    expect(payload.llm_context.schema).toMatchObject({
      task_type: 'region_comparison',
      anchors: [
        { place_name: '武汉大学', display_name: '武汉大学', role: 'primary' },
        { place_name: '湖北大学', display_name: '湖北大学', role: 'secondary' }
      ],
      representative_pois: [
        {
          name: '武汉大学医院',
          category: '综合医院'
        }
      ],
      uncertainty: {
        boundary_confidence: 0.62,
        comparison_mode: 'dual_anchor'
      }
    })
    expect(payload.llm_context.facts).toEqual(expect.arrayContaining([
      expect.stringContaining('task_type'),
      expect.stringContaining('anchors'),
      expect.stringContaining('武汉大学')
    ]))
  })

  it('prefers structured macro evidence blocks when building schema-first llm context', async () => {
    const deps = {
      handleSpatialQuery: vi.fn().mockResolvedValue({
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
          radiusM: 1200,
          method: 'fallback'
        },
        anchor: {
          lon: 114.364339,
          lat: 30.536334,
          source: 'intent.place_name'
        },
        queryEmbedding: {
          applied: true,
          reason: 'encoded',
          source: 'poi_encoder',
          embeddingDim: 352,
          queryEmbedding: [0.12, 0.21, 0.33]
        },
        candidateResults: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
        results: [
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
          }
        ],
        runtimeEnrichment: {
          applied: true,
          reason: 'macro_enriched'
        },
        evidence: {
          boundary: null,
          spatialClusters: { hotspots: [] },
          vernacularRegions: [],
          fuzzyRegions: [],
          stats: {
            candidate_count: 4,
            result_count: 4,
            avg_boundary_confidence: 0.71,
            boundary_confidence_model: 'v3_encoder_surface_confidence_v2',
            vector_constraint_source: 'road_blocks'
          },
          queryPlan: {
            query_type: 'poi_search',
            intent_mode: 'local_search',
            task_type: 'support_gap_analysis'
          },
          refinedResult: {
            results: {
              support_buckets: [
                {
                  bucket: '餐饮配套',
                  count: 2,
                  examples: ['川味人家', '瑞幸咖啡']
                },
                {
                  bucket: '零售购物',
                  count: 1,
                  examples: ['Today便利店']
                }
              ],
              representative_pois: [
                {
                  name: '川味人家',
                  category: '中国菜',
                  distance_m: 88,
                  support_bucket: '餐饮配套'
                },
                {
                  name: 'Today便利店',
                  category: '便利店',
                  distance_m: 144,
                  support_bucket: '零售购物'
                }
              ],
              uncertainty: {
                boundary_confidence: 0.71,
                support_bucket_count: 2,
                representative_poi_count: 2,
                evidence_density: 'medium',
                low_sample_warning: false,
                sample_size: 4
              }
            }
          }
        }
      })
    }

    const payload = await buildSpatialRagContext({
      userQuery: '请分析武汉大学附近的配套、热门业态和明显缺口。',
      traceId: 'trace-macro-schema-context'
    }, deps)

    expect(payload.evidence_summary).toMatchObject({
      support_bucket_count: 2,
      representative_poi_count: 2,
      evidence_density: 'medium',
      low_sample_warning: false
    })
    expect(payload.llm_context.schema).toMatchObject({
      task_type: 'support_gap_analysis',
      support_buckets: [
        {
          bucket: '餐饮配套',
          count: 2,
          examples: ['川味人家', '瑞幸咖啡']
        },
        {
          bucket: '零售购物',
          count: 1,
          examples: ['Today便利店']
        }
      ],
      representative_pois: [
        {
          name: '川味人家',
          category: '中国菜',
          support_bucket: '餐饮配套'
        },
        {
          name: 'Today便利店',
          category: '便利店',
          support_bucket: '零售购物'
        }
      ],
      uncertainty: {
        boundary_confidence: 0.71,
        support_bucket_count: 2,
        representative_poi_count: 2,
        evidence_density: 'medium',
        low_sample_warning: false,
        sample_size: 4
      }
    })
    expect(payload.llm_context.facts).toEqual(expect.arrayContaining([
      expect.stringContaining('support_buckets'),
      expect.stringContaining('餐饮配套'),
      expect.stringContaining('evidence_density')
    ]))
  })
})
