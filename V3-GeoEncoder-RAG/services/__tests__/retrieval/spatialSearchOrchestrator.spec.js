import { describe, expect, it, vi } from 'vitest'

import { handleSpatialQuery } from '../../spatial_core/retrieval/spatialSearchOrchestrator.js'

describe('spatialSearchOrchestrator', () => {
  it('passes queryEmbedding into faissHybridSearch when the spatial encoder can encode the query anchor', async () => {
    const anchor = { lon: 114.304, lat: 30.502, source: 'spatial_context.center' }
    const intent = { category: 'coffee', radiusM: 800, regionLabel: 1 }
    const candidates = [
      {
        id: 1,
        name: 'Cafe A',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3008,
        lat: 30.5008,
        fused_score: 0.92,
        spatial_score: 0.93,
        semantic_score: 0.85
      }
    ]

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(anchor),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'encoded',
        source: 'anchor_encoder_v1',
        embeddingDim: 3,
        queryEmbedding: [0.21, 0.34, 0.55]
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({
        queryEmbedding: [0.21, 0.34, 0.55],
        semanticWeight: 0.52,
        spatialWeight: 0.48
      }),
      faissHybridSearch: vi.fn().mockResolvedValue(candidates),
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue(candidates),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'already_enriched',
        results: candidates
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: candidates,
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      }),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('咖啡', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-query-embedding'
    }, deps)

    expect(deps.buildSpatialQueryEmbedding).toHaveBeenCalledWith({
      userQuery: '咖啡',
      intent: {
        ...intent,
        poiSubType: '咖啡'
      },
      anchor
    })
    expect(deps.faissHybridSearch).toHaveBeenCalledWith(expect.objectContaining({
      anchor,
      radius: 800,
      categories: ['coffee'],
      targetRegion: 1,
      queryEmbedding: [0.21, 0.34, 0.55],
      semanticWeight: 0.52,
      spatialWeight: 0.48
    }))
    expect(result.queryEmbedding).toMatchObject({
      applied: true,
      source: 'anchor_encoder_v1'
    })
  })

  it('prefers resolved place-name coordinates over viewport fallback anchors', async () => {
    const fallbackAnchor = { lon: 114.22, lat: 30.61, source: 'spatial_context.viewport' }
    const resolvedAnchor = { lon: 114.331, lat: 30.588, poiId: 9527, source: 'intent.place_name' }
    const intent = { placeName: '湖北大学', category: '交通设施服务', poiSubType: '地铁站', radiusM: 500, regionLabel: null }

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(fallbackAnchor),
      quickSearchPois: vi.fn().mockResolvedValue([
        { id: resolvedAnchor.poiId, name: '湖北大学', lon: resolvedAnchor.lon, lat: resolvedAnchor.lat, distance_m: 0 }
      ]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_index',
        queryEmbedding: null
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      faissHybridSearch: vi.fn().mockResolvedValue([]),
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue([]),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_results',
        results: []
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: [],
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      }),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('湖北大学附近有哪些地铁站？', {
      poiFeatures: [],
      spatialContext: {
        viewport: [114.20, 30.56, 114.24, 30.64]
      },
      intent,
      traceId: 'trace-place-anchor'
    }, deps)

    expect(deps.quickSearchPois).toHaveBeenCalledWith({
      queryText: '湖北大学',
      lat: fallbackAnchor.lat,
      lon: fallbackAnchor.lon,
      limit: 120,
      radius: 50000,
      preferPrefix: true
    })
    expect(deps.faissHybridSearch).toHaveBeenCalledWith(expect.objectContaining({
      subcategory: '地铁站'
    }))
    expect(result.anchor).toMatchObject(resolvedAnchor)
    expect(deps.buildSpatialQueryEmbedding).toHaveBeenCalledWith({
      userQuery: '湖北大学附近有哪些地铁站？',
      intent,
      anchor: expect.objectContaining(resolvedAnchor)
    })
  })

  it('prefers canonical campus POIs over branded store matches when resolving anchors', async () => {
    const fallbackAnchor = { lon: 114.3055, lat: 30.5931, source: 'default' }
    const campusAnchor = { lon: 114.334121, lat: 30.57687, source: 'intent.place_name' }
    const intent = { placeName: '湖北大学', category: '交通设施服务', poiSubType: '地铁站', radiusM: 800, regionLabel: null }

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(fallbackAnchor),
      quickSearchPois: vi.fn().mockResolvedValue([
        { name: '7-ELEVEn(湖北大学店)', category_big: '购物服务', category_mid: '便民商店/便利店', lon: 114.251715, lat: 30.649763, distance_m: 8900 },
        { name: '湖北大学-西门', category_big: '科教文化服务', category_mid: '学校', lon: 114.33249, lat: 30.579311, distance_m: 4200 },
        { name: '湖北大学(武昌校区)', category_big: '科教文化服务', category_mid: '学校', lon: campusAnchor.lon, lat: campusAnchor.lat, distance_m: 4100 }
      ]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: false }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_index',
        queryEmbedding: null
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      faissHybridSearch: vi.fn().mockResolvedValue([]),
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue([]),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_results',
        results: []
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: [],
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      }),
      defaultSpatialAnchor: fallbackAnchor
    }

    const result = await handleSpatialQuery('湖北大学附近有哪些地铁站？', {
      poiFeatures: [],
      spatialContext: {
        viewport: [114.2, 30.56, 114.24, 30.64]
      },
      intent,
      traceId: 'trace-campus-anchor'
    }, deps)

    expect(result.anchor).toMatchObject(campusAnchor)
    expect(result.anchor.resolvedPlaceName).toBe('湖北大学(武昌校区)')
  })

  it('prefers dense exact-name campus clusters over a closer duplicate place name', async () => {
    const fallbackAnchor = { lon: 114.3055, lat: 30.5931, source: 'default' }
    const mainCampusAnchor = { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' }
    const intent = { placeName: '武汉大学', category: '餐饮美食', poiSubType: '咖啡', radiusM: 800, regionLabel: null }

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(fallbackAnchor),
      quickSearchPois: vi.fn().mockResolvedValue([
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: mainCampusAnchor.lon, lat: mainCampusAnchor.lat, distance_m: 7600 },
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: mainCampusAnchor.lon, lat: mainCampusAnchor.lat, distance_m: 7600 },
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: mainCampusAnchor.lon, lat: mainCampusAnchor.lat, distance_m: 7600 },
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: 114.270256, lat: 30.580249, distance_m: 3200 }
      ]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: false }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_index',
        queryEmbedding: null
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      faissHybridSearch: vi.fn().mockResolvedValue([]),
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue([]),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_results',
        results: []
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: [],
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      }),
      defaultSpatialAnchor: fallbackAnchor
    }

    const result = await handleSpatialQuery('武汉大学附近有哪些咖啡店？', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-dense-campus-anchor'
    }, deps)

    expect(result.anchor).toMatchObject(mainCampusAnchor)
  })

  it('expands abbreviated school names to canonical school anchors', async () => {
    const fallbackAnchor = { lon: 114.3055, lat: 30.5931, source: 'default' }
    const schoolAnchor = { lon: 114.308002, lat: 30.606691, source: 'intent.place_name' }
    const intent = { placeName: '武汉二中', category: '购物服务', poiSubType: '商超', radiusM: 1000, regionLabel: null }

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(fallbackAnchor),
      quickSearchPois: vi.fn().mockImplementation(async ({ queryText }) => {
        if (queryText === '武汉二中') {
          return [
            { name: '武汉二中学生服务中心', category_big: '生活服务', category_mid: '生活服务场所', lon: 114.308579, lat: 30.605369, distance_m: 180 },
            { name: '武汉二中广雅中学', category_big: '科教文化服务', category_mid: '学校', lon: 114.311398, lat: 30.604767, distance_m: 420 }
          ]
        }

        if (queryText === '武汉市第二中学') {
          return [
            { name: '武汉市第二中学', category_big: '科教文化服务', category_mid: '学校', lon: schoolAnchor.lon, lat: schoolAnchor.lat, distance_m: 260 }
          ]
        }

        return []
      }),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: false }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_index',
        queryEmbedding: null
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      faissHybridSearch: vi.fn().mockResolvedValue([]),
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue([]),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_results',
        results: []
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: [],
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      }),
      defaultSpatialAnchor: fallbackAnchor
    }

    const result = await handleSpatialQuery('武汉二中附近有哪些商超？', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-school-anchor'
    }, deps)

    expect(result.anchor).toMatchObject(schoolAnchor)
    expect(result.anchor.resolvedPlaceName).toBe('武汉市第二中学')
  })

  it('keeps the canonical school entity when the official POI is only exposed as a gate name', async () => {
    const fallbackAnchor = { lon: 114.3055, lat: 30.5931, source: 'default' }
    const schoolGateAnchor = { lon: 114.30811, lat: 30.60695, source: 'intent.place_name' }
    const intent = { placeName: '武汉二中', category: '购物服务', poiSubType: '商超', radiusM: 1000, regionLabel: null }

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(fallbackAnchor),
      quickSearchPois: vi.fn().mockImplementation(async ({ queryText }) => {
        if (queryText === '武汉二中') {
          return [
            { name: '武汉二中广雅中学', category_big: '科教文化服务', category_mid: '学校', lon: 114.311398, lat: 30.604767, distance_m: 120 }
          ]
        }

        if (queryText === '武汉市第二中学') {
          return [
            { name: '武汉市第二中学-北门', category_big: '科教文化服务', category_mid: '学校', lon: schoolGateAnchor.lon, lat: schoolGateAnchor.lat, distance_m: 260 }
          ]
        }

        return []
      }),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: false }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_index',
        queryEmbedding: null
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      faissHybridSearch: vi.fn().mockResolvedValue([]),
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue([]),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_results',
        results: []
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: [],
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      }),
      defaultSpatialAnchor: fallbackAnchor
    }

    const result = await handleSpatialQuery('武汉二中附近有哪些商超？', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-school-gate-anchor'
    }, deps)

    expect(result.anchor).toMatchObject(schoolGateAnchor)
    expect(result.anchor.resolvedPlaceName).toBe('武汉市第二中学-北门')
  })

  it('expands the local search radius when nearby results are too sparse and the query did not specify a radius', async () => {
    const anchor = { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' }
    const intent = { placeName: '武汉大学', category: '餐饮美食', poiSubType: '咖啡', radiusM: 500, regionLabel: null }
    const sparseResults = [
      { id: 1, name: '候选1', category: '咖啡', lon: 114.3644, lat: 30.5352, distance_m: 124, fused_score: 0.82, semantic_score: 0.84, spatial_score: 0.78 },
      { id: 2, name: '候选2', category: '咖啡', lon: 114.3658, lat: 30.5324, distance_m: 457, fused_score: 0.74, semantic_score: 0.79, spatial_score: 0.62 }
    ]
    const expandedResults = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      name: `扩展候选${index + 1}`,
      category: '咖啡',
      lon: 114.364 + index * 0.0002,
      lat: 30.536 - index * 0.0002,
      distance_m: 120 + index * 80,
      fused_score: 0.9 - index * 0.03,
      semantic_score: 0.88 - index * 0.02,
      spatial_score: 0.82 - index * 0.03
    }))

    const faissHybridSearch = vi.fn()
      .mockResolvedValueOnce(sparseResults)
      .mockResolvedValueOnce(expandedResults)

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue({ lon: 114.30, lat: 30.59, source: 'default' }),
      quickSearchPois: vi.fn().mockResolvedValue([
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: anchor.lon, lat: anchor.lat, distance_m: 0 }
      ]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'no_index',
        queryEmbedding: null
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      faissHybridSearch,
      filterCandidatesWithSmallLLM: vi.fn().mockImplementation(async (_query, _intent, candidates) => candidates),
      enrichResultsWithSpatialEncoder: vi.fn().mockImplementation(async ({ results }) => ({
        applied: false,
        reason: 'already_enriched',
        results
      })),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: expandedResults,
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      }),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('武汉大学附近有哪些咖啡店？', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-radius-expand'
    }, deps)

    expect(faissHybridSearch).toHaveBeenCalledTimes(2)
    expect(faissHybridSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      radius: 500,
      topK: 50
    }))
    expect(faissHybridSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      radius: 800,
      topK: 80
    }))
    expect(result.results).toHaveLength(9)
  })

  it('invokes both poi and town model stages and exposes model routing in evidence stats', async () => {
    const anchor = { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' }
    const intent = { placeName: '武汉大学', category: '餐饮美食', poiSubType: '咖啡', radiusM: 500, regionLabel: null }
    const candidates = [
      { id: 1, name: 'luckin coffee', category: '咖啡', lon: 114.364448, lat: 30.535222, distance_m: 124, fused_score: 0.82, spatial_score: 0.88, semantic_score: 0.76 }
    ]
    const enrichedWithCellContext = [
      {
        ...candidates[0],
        cell_context: {
          cell_id: '8841f05b6dfffff',
          region_idx: 5,
          region_name: '自然类',
          similarity: 0.91
        }
      }
    ]

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(anchor),
      quickSearchPois: vi.fn().mockResolvedValue([
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: anchor.lon, lat: anchor.lat, distance_m: 0 }
      ]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'encoded',
        source: 'poi_encoder'
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      faissHybridSearch: vi.fn().mockResolvedValue(candidates),
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue(candidates),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'poi_encoder_runtime',
        results: candidates,
        modelsUsed: ['poi_encoder']
      }),
      enrichResultsWithCellContext: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'town_encoder_context',
        results: enrichedWithCellContext,
        anchorCellContext: {
          cell_id: '8841f05b6dfffff',
          region_idx: 5,
          region_name: '自然类'
        },
        modelsUsed: ['town_encoder']
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockReturnValue({
        pois: enrichedWithCellContext,
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {
          model_route_primary: 'poi_encoder',
          model_route_secondary: ['town_encoder'],
          model_usage: ['poi_encoder', 'town_encoder']
        },
        refinedResult: {}
      }),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('武汉大学附近有哪些咖啡店？', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-dual-model-routing'
    }, deps)

    expect(deps.enrichResultsWithSpatialEncoder).toHaveBeenCalledTimes(1)
    expect(deps.enrichResultsWithCellContext).toHaveBeenCalledWith({
      anchor,
      results: candidates,
      intent,
      userQuery: '武汉大学附近有哪些咖啡店？'
    })
    expect(result.evidence.stats).toMatchObject({
      model_route_primary: 'poi_encoder',
      model_route_secondary: ['town_encoder'],
      model_usage: ['poi_encoder', 'town_encoder']
    })
  })

  it('uses town cell search as the primary retrieval route for support-gap analysis tasks', async () => {
    const anchor = { lon: 114.334121, lat: 30.57687, source: 'spatial_context.viewport' }
    const intent = {
      taskType: 'support_gap_analysis',
      answerType: 'support_gap_analysis',
      anchorMode: 'context',
      radiusM: 800,
      analysisFacets: {
        supportingFacilities: true,
        hotCategories: true,
        gaps: true
      }
    }
    const macroCells = [
      {
        cell_id: 'cell-a',
        lon: 114.334121,
        lat: 30.57687,
        distance_m: 0,
        similarity: 1,
        search_score: 1
      },
      {
        cell_id: 'cell-b',
        lon: 114.3391,
        lat: 30.5802,
        distance_m: 610,
        similarity: 0.93,
        search_score: 0.88
      }
    ]
    const macroCandidates = [
      { id: 11, name: '中百罗森', category: '便利店', lon: 114.3348, lat: 30.5771, distance_m: 90, fused_score: 0.79, spatial_score: 0.73, semantic_score: 0.68 },
      { id: 12, name: '瑞幸咖啡', category: '咖啡', lon: 114.3398, lat: 30.5804, distance_m: 130, fused_score: 0.76, spatial_score: 0.7, semantic_score: 0.66 }
    ]

    const faissHybridSearch = vi
      .fn()
      .mockResolvedValueOnce([macroCandidates[0]])
      .mockResolvedValueOnce([macroCandidates[1]])

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(anchor),
      quickSearchPois: vi.fn().mockResolvedValue([]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'encoded',
        source: 'poi_encoder',
        modelUsage: ['poi_encoder']
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({}),
      searchMacroCellsWithTownEncoder: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: macroCells,
        anchorCellContext: {
          cell_id: 'cell-a',
          region_idx: 1,
          region_name: '商业类'
        },
        modelRoute: 'town_encoder',
        modelsUsed: ['town_encoder'],
        searchRadiusM: 1800,
        perCellRadiusM: 700
      }),
      faissHybridSearch,
      filterCandidatesWithSmallLLM: vi.fn().mockImplementation(async (_query, _intent, candidates) => candidates),
      enrichResultsWithSpatialEncoder: vi.fn().mockResolvedValue({
        applied: false,
        reason: 'already_enriched',
        results: macroCandidates,
        modelsUsed: ['poi_encoder']
      }),
      enrichResultsWithCellContext: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'town_encoder_context',
        results: macroCandidates,
        modelsUsed: ['town_encoder']
      }),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockImplementation(({ macroCellSearch }) => ({
        pois: macroCandidates,
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {
          model_route_primary: macroCellSearch?.applied ? 'town_encoder' : 'poi_encoder',
          model_route_secondary: ['poi_encoder'],
          model_usage: ['town_encoder', 'poi_encoder']
        },
        refinedResult: {}
      })),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('请帮我看看这里附近有什么值得关注的配套、热门业态和明显缺口，并按相关性排序。', {
      poiFeatures: [],
      spatialContext: {
        viewport: [114.30, 30.55, 114.37, 30.59]
      },
      intent,
      traceId: 'trace-town-primary-routing'
    }, deps)

    expect(deps.searchMacroCellsWithTownEncoder).toHaveBeenCalledWith({
      anchor,
      intent: expect.objectContaining({
        taskType: 'support_gap_analysis',
        answerType: 'support_gap_analysis',
        anchorMode: 'context'
      }),
      userQuery: '请帮我看看这里附近有什么值得关注的配套、热门业态和明显缺口，并按相关性排序。'
    })
    expect(faissHybridSearch).toHaveBeenCalledTimes(2)
    expect(faissHybridSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      anchor: expect.objectContaining({
        lon: macroCells[0].lon,
        lat: macroCells[0].lat
      }),
      radius: 700
    }))
    expect(faissHybridSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      anchor: expect.objectContaining({
        lon: macroCells[1].lon,
        lat: macroCells[1].lat
      }),
      radius: 700
    }))
    expect(deps.buildSpatialEvidence).toHaveBeenCalledWith(expect.objectContaining({
      macroCellSearch: expect.objectContaining({
        applied: true,
        reason: 'town_encoder_macro_cells'
      })
    }))
    expect(result.evidence.stats).toMatchObject({
      model_route_primary: 'town_encoder',
      model_route_secondary: ['poi_encoder'],
      model_usage: ['town_encoder', 'poi_encoder']
    })
  })

  it('routes area-overview tasks through a dedicated macro executor without poi query embedding or small-llm candidate filtering', async () => {
    const anchor = { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' }
    const intent = {
      placeName: '武汉大学',
      taskType: 'area_overview',
      answerType: 'area_overview',
      anchorMode: 'explicit_place',
      radiusM: 1200,
      analysisFacets: {
        hotCategories: true
      }
    }
    const macroCells = [
      {
        cell_id: 'cell-a',
        lon: 114.3641,
        lat: 30.5361,
        distance_m: 0,
        similarity: 1,
        search_score: 1
      },
      {
        cell_id: 'cell-b',
        lon: 114.3688,
        lat: 30.5394,
        distance_m: 520,
        similarity: 0.92,
        search_score: 0.86
      }
    ]

    const faissHybridSearch = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 301, name: '武汉大学医院', category: '综合医院', lon: 114.3645, lat: 30.5367, distance_m: 88, fused_score: 0.91, spatial_score: 0.89, semantic_score: 0.84 },
        { id: 302, name: '轩轩副食', category: '便民商店/便利店', lon: 114.3648, lat: 30.5364, distance_m: 112, fused_score: 0.86, spatial_score: 0.84, semantic_score: 0.8 }
      ])
      .mockResolvedValueOnce([
        { id: 303, name: '瑞幸咖啡', category: '咖啡', lon: 114.3692, lat: 30.5396, distance_m: 135, fused_score: 0.83, spatial_score: 0.81, semantic_score: 0.79 },
        { id: 304, name: '武汉大学第5教学楼', category: '学校', lon: 114.3689, lat: 30.5391, distance_m: 146, fused_score: 0.79, spatial_score: 0.78, semantic_score: 0.76 }
      ])

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(anchor),
      quickSearchPois: vi.fn().mockResolvedValue([
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: anchor.lon, lat: anchor.lat, distance_m: 0 }
      ]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'should_not_run',
        source: 'poi_encoder'
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({
        queryEmbedding: [0.1, 0.2, 0.3]
      }),
      searchMacroCellsWithTownEncoder: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: macroCells,
        modelRoute: 'town_encoder',
        modelsUsed: ['town_encoder'],
        searchRadiusM: 2500,
        perCellRadiusM: 900
      }),
      faissHybridSearch,
      filterCandidatesWithSmallLLM: vi.fn().mockImplementation(async () => {
        throw new Error('area_overview dedicated macro executor should not call small-llm candidate filter')
      }),
      enrichResultsWithSpatialEncoder: vi.fn().mockImplementation(async ({ results }) => ({
        applied: false,
        reason: 'already_enriched',
        results,
        modelsUsed: ['poi_encoder']
      })),
      enrichResultsWithCellContext: vi.fn().mockImplementation(async ({ results }) => ({
        applied: true,
        reason: 'town_encoder_context',
        results,
        modelsUsed: ['town_encoder']
      })),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockImplementation(({ queryEmbedding, routeExecutor, filteredResults }) => ({
        pois: filteredResults,
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {
          route_executor: routeExecutor?.name || null,
          query_embedding_source: queryEmbedding?.source || null
        },
        refinedResult: {}
      })),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('请概览武汉大学附近的空间结构和业态分布。', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-area-overview-dedicated-executor'
    }, deps)

    expect(deps.buildSpatialQueryEmbedding).not.toHaveBeenCalled()
    expect(deps.buildQueryEmbeddingSearchOptions).not.toHaveBeenCalled()
    expect(deps.filterCandidatesWithSmallLLM).not.toHaveBeenCalled()
    expect(faissHybridSearch).toHaveBeenCalledTimes(2)
    expect(faissHybridSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      anchor: expect.objectContaining({ lon: macroCells[0].lon, lat: macroCells[0].lat }),
      radius: 900
    }))
    expect(faissHybridSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      anchor: expect.objectContaining({ lon: macroCells[1].lon, lat: macroCells[1].lat }),
      radius: 900
    }))
    expect(result.routeExecutor).toMatchObject({
      name: 'macro_overview_executor',
      taskType: 'area_overview'
    })
    expect(result.evidence.stats).toMatchObject({
      route_executor: 'macro_overview_executor',
      query_embedding_source: 'town_encoder_macro_route'
    })
  })

  it('selects diversified representative pois for site-suitability instead of letting noisy other-bucket results dominate the front of the list', async () => {
    const anchor = { lon: 114.364339, lat: 30.536334, source: 'intent.place_name' }
    const intent = {
      placeName: '武汉大学',
      taskType: 'site_suitability',
      answerType: 'site_suitability',
      anchorMode: 'explicit_place',
      radiusM: 1200,
      analysisFacets: {
        suitability: true,
        hotCategories: true
      }
    }
    const macroCells = [
      {
        cell_id: 'cell-a',
        lon: 114.3641,
        lat: 30.5361,
        distance_m: 0,
        similarity: 1,
        search_score: 1
      },
      {
        cell_id: 'cell-b',
        lon: 114.3692,
        lat: 30.5396,
        distance_m: 540,
        similarity: 0.9,
        search_score: 0.82
      }
    ]

    const faissHybridSearch = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 401, name: '汉西雅士利专卖店', category: '家居建材市场', lon: 114.3647, lat: 30.5363, distance_m: 5, fused_score: 0.99, spatial_score: 0.98, semantic_score: 0.96 },
        { id: 402, name: '海利不锈钢管', category: '家居建材市场', lon: 114.3649, lat: 30.5365, distance_m: 8, fused_score: 0.97, spatial_score: 0.96, semantic_score: 0.94 },
        { id: 403, name: '武汉大学医院', category: '综合医院', lon: 114.3645, lat: 30.5367, distance_m: 88, fused_score: 0.91, spatial_score: 0.89, semantic_score: 0.84 },
        { id: 404, name: '轩轩副食', category: '便民商店/便利店', lon: 114.3648, lat: 30.5364, distance_m: 112, fused_score: 0.86, spatial_score: 0.84, semantic_score: 0.8 }
      ])
      .mockResolvedValueOnce([
        { id: 405, name: '瑞幸咖啡', category: '咖啡', lon: 114.3692, lat: 30.5396, distance_m: 135, fused_score: 0.83, spatial_score: 0.81, semantic_score: 0.79 },
        { id: 406, name: '武汉大学第5教学楼', category: '学校', lon: 114.3689, lat: 30.5391, distance_m: 146, fused_score: 0.79, spatial_score: 0.78, semantic_score: 0.76 }
      ])

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue(anchor),
      quickSearchPois: vi.fn().mockResolvedValue([
        { name: '武汉大学', category_big: '科教文化服务', category_mid: '学校', lon: anchor.lon, lat: anchor.lat, distance_m: 0 }
      ]),
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'should_not_run',
        source: 'poi_encoder'
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({
        queryEmbedding: [0.1, 0.2, 0.3]
      }),
      searchMacroCellsWithTownEncoder: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: macroCells,
        modelRoute: 'town_encoder',
        modelsUsed: ['town_encoder'],
        searchRadiusM: 2200,
        perCellRadiusM: 850
      }),
      faissHybridSearch,
      filterCandidatesWithSmallLLM: vi.fn().mockResolvedValue([]),
      enrichResultsWithSpatialEncoder: vi.fn().mockImplementation(async ({ results }) => ({
        applied: false,
        reason: 'already_enriched',
        results,
        modelsUsed: ['poi_encoder']
      })),
      enrichResultsWithCellContext: vi.fn().mockImplementation(async ({ results }) => ({
        applied: true,
        reason: 'town_encoder_context',
        results,
        modelsUsed: ['town_encoder']
      })),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockImplementation(({ filteredResults }) => ({
        pois: filteredResults,
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {},
        refinedResult: {}
      })),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('武汉大学附近适合布局什么业态？', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-site-suitability-dedicated-executor'
    }, deps)

    expect(deps.filterCandidatesWithSmallLLM).not.toHaveBeenCalled()
    expect(result.routeExecutor).toMatchObject({
      name: 'macro_overview_executor',
      taskType: 'site_suitability'
    })
    expect(result.results.slice(0, 3).map((item) => item.name)).toEqual([
      '武汉大学医院',
      '轩轩副食',
      '瑞幸咖啡'
    ])
  })

  it('runs region-comparison through a dedicated dual-anchor macro executor and passes structured comparison regions downstream', async () => {
    const primaryAnchor = { lon: 114.364339, lat: 30.536334, poiId: 1001, source: 'intent.place_name', resolvedPlaceName: '武汉大学' }
    const secondaryAnchor = { lon: 114.334121, lat: 30.57687, poiId: 1002, source: 'intent.place_name', resolvedPlaceName: '湖北大学(武昌校区)' }
    const intent = {
      placeName: '武汉大学',
      taskType: 'region_comparison',
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      radiusM: 3200,
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary', index: 0 },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary', index: 1 }
      ],
      analysisFacets: {
        comparison: true,
        hotCategories: true
      }
    }
    const macroCellsByAnchor = new Map([
      ['武汉大学', [
        { cell_id: 'whu-cell-a', lon: 114.3641, lat: 30.5362, distance_m: 0, similarity: 1, search_score: 1 },
        { cell_id: 'whu-cell-b', lon: 114.3671, lat: 30.5386, distance_m: 350, similarity: 0.92, search_score: 0.86 }
      ]],
      ['湖北大学(武昌校区)', [
        { cell_id: 'hbu-cell-a', lon: 114.3343, lat: 30.5769, distance_m: 0, similarity: 1, search_score: 1 },
        { cell_id: 'hbu-cell-b', lon: 114.3374, lat: 30.5781, distance_m: 310, similarity: 0.9, search_score: 0.83 }
      ]]
    ])

    const quickSearchPois = vi.fn().mockImplementation(async ({ queryText }) => {
      if (queryText === '武汉大学') {
        return [{ id: primaryAnchor.poiId, name: primaryAnchor.resolvedPlaceName, lon: primaryAnchor.lon, lat: primaryAnchor.lat, distance_m: 0 }]
      }

      if (queryText === '湖北大学') {
        return [{ id: secondaryAnchor.poiId, name: secondaryAnchor.resolvedPlaceName, lon: secondaryAnchor.lon, lat: secondaryAnchor.lat, distance_m: 0 }]
      }

      return []
    })

    const searchMacroCellsWithTownEncoder = vi.fn().mockImplementation(async ({ anchor }) => {
      const label = Math.abs(Number(anchor?.lon) - primaryAnchor.lon) < 0.005 ? '武汉大学' : '湖北大学(武昌校区)'
      return {
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: macroCellsByAnchor.get(label),
        modelRoute: 'town_encoder',
        modelsUsed: ['town_encoder'],
        searchRadiusM: 3200,
        perCellRadiusM: 900
      }
    })

    const faissHybridSearch = vi.fn().mockImplementation(async ({ anchor }) => {
      if (Math.abs(Number(anchor?.lon) - 114.3641) < 0.002 || Math.abs(Number(anchor?.lon) - 114.3671) < 0.002) {
        return [
          { id: 601, name: '武汉大学医院', category: '综合医院', lon: 114.3648, lat: 30.5365, distance_m: 12, fused_score: 0.96, spatial_score: 0.94, semantic_score: 0.91 },
          { id: 602, name: '轩轩副食', category: '便民商店/便利店', lon: 114.3652, lat: 30.5362, distance_m: 35, fused_score: 0.91, spatial_score: 0.89, semantic_score: 0.86 }
        ]
      }

      return [
        { id: 701, name: '芊烨餐馆', category: '中国菜', lon: 114.3345, lat: 30.5771, distance_m: 18, fused_score: 0.97, spatial_score: 0.95, semantic_score: 0.93 },
        { id: 702, name: '湖北大学地铁站A口', category: '地铁站', lon: 114.3351, lat: 30.5776, distance_m: 42, fused_score: 0.9, spatial_score: 0.88, semantic_score: 0.84 }
      ]
    })

    const deps = {
      parseIntent: vi.fn().mockResolvedValue(intent),
      deriveSpatialAnchor: vi.fn().mockReturnValue({ lon: 114.3055, lat: 30.5931, source: 'default' }),
      quickSearchPois,
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      buildSpatialQueryEmbedding: vi.fn().mockResolvedValue({
        applied: true,
        reason: 'should_not_run',
        source: 'poi_encoder'
      }),
      buildQueryEmbeddingSearchOptions: vi.fn().mockReturnValue({
        queryEmbedding: [0.1, 0.2, 0.3]
      }),
      searchMacroCellsWithTownEncoder,
      faissHybridSearch,
      filterCandidatesWithSmallLLM: vi.fn().mockImplementation(async () => {
        throw new Error('region_comparison dedicated executor should not call small-llm candidate filter')
      }),
      enrichResultsWithSpatialEncoder: vi.fn().mockImplementation(async ({ results }) => ({
        applied: false,
        reason: 'already_enriched',
        results,
        modelsUsed: ['poi_encoder']
      })),
      enrichResultsWithCellContext: vi.fn().mockImplementation(async ({ results }) => ({
        applied: true,
        reason: 'town_encoder_context',
        results,
        modelsUsed: ['town_encoder']
      })),
      buildSurfaceQueryWkt: vi.fn().mockReturnValue(null),
      fetchSurfaceContext: vi.fn().mockResolvedValue(null),
      selectVectorConstraintContext: vi.fn().mockReturnValue(null),
      refineSurfaceConstraintGeometry: vi.fn().mockResolvedValue(null),
      buildSpatialEvidence: vi.fn().mockImplementation(({ comparisonRegions, routeExecutor, queryEmbedding, filteredResults }) => ({
        pois: filteredResults,
        boundary: null,
        spatialClusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        stats: {
          route_executor: routeExecutor?.name || null,
          query_embedding_source: queryEmbedding?.source || null,
          comparison_region_count: Array.isArray(comparisonRegions) ? comparisonRegions.length : 0
        },
        refinedResult: {
          results: {
            comparison_regions: comparisonRegions || []
          }
        }
      })),
      defaultSpatialAnchor: { lon: 114.3055, lat: 30.5931, source: 'default' }
    }

    const result = await handleSpatialQuery('比较武汉大学和湖北大学附近的业态差异。', {
      poiFeatures: [],
      spatialContext: null,
      intent,
      traceId: 'trace-region-comparison-dedicated-executor'
    }, deps)

    expect(deps.buildSpatialQueryEmbedding).not.toHaveBeenCalled()
    expect(deps.buildQueryEmbeddingSearchOptions).not.toHaveBeenCalled()
    expect(deps.filterCandidatesWithSmallLLM).not.toHaveBeenCalled()
    expect(quickSearchPois.mock.calls.map(([args]) => args.queryText)).toEqual(expect.arrayContaining(['武汉大学', '湖北大学']))
    expect(searchMacroCellsWithTownEncoder).toHaveBeenCalledTimes(2)
    expect(result.routeExecutor).toMatchObject({
      name: 'macro_comparison_executor',
      taskType: 'region_comparison'
    })
    expect(result.queryEmbedding).toMatchObject({
      applied: false,
      source: 'town_encoder_comparison_route'
    })
    expect(result.evidence.stats).toMatchObject({
      route_executor: 'macro_comparison_executor',
      query_embedding_source: 'town_encoder_comparison_route',
      comparison_region_count: 2
    })
    expect(result.evidence.refinedResult.results.comparison_regions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        anchor: expect.objectContaining({
          display_name: '武汉大学',
          role: 'primary'
        })
      }),
      expect.objectContaining({
        anchor: expect.objectContaining({
          display_name: '湖北大学',
          role: 'secondary'
        })
      })
    ]))
  })
})
