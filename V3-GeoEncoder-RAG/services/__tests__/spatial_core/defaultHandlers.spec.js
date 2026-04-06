import { describe, expect, it, vi } from 'vitest'

import { createSpatialCoreHandlers } from '../../spatial_core/defaultHandlers.js'

describe('spatial_core default handlers', () => {
  it('resolve_anchor uses quickSearchPois and returns a structured anchor object', async () => {
    const quickSearchPois = vi.fn().mockResolvedValue([
      {
        id: 9527,
        name: '湖北大学(武昌校区)',
        lon: 114.334121,
        lat: 30.57687
      }
    ])

    const handlers = createSpatialCoreHandlers({
      quickSearchPois
    })

    const output = await handlers.resolve_anchor({
      place_name: '湖北大学',
      role: 'primary'
    }, {
      user_query: '湖北大学附近有哪些地铁站？'
    })

    expect(quickSearchPois).toHaveBeenCalledWith({
      queryText: '湖北大学',
      limit: 120,
      preferPrefix: true
    })
    expect(output).toEqual({
      anchor: {
        place_name: '湖北大学',
        display_name: '湖北大学',
        role: 'primary',
        index: 0,
        lon: 114.334121,
        lat: 30.57687,
        source: 'quick_search',
        resolved_place_name: '湖北大学(武昌校区)',
        poi_id: 9527
      }
    })
  })

  it('resolve_anchor prefers canonical campus POIs over branded store matches for education anchors', async () => {
    const quickSearchPois = vi.fn().mockResolvedValue([
      { id: 1, name: '7-ELEVEn(湖北大学店)', category_big: '购物服务', category_mid: '便民商店/便利店', lon: 114.251715, lat: 30.649763, distance_m: 8900 },
      { id: 2, name: '湖北大学-西门', category_big: '科教文化服务', category_mid: '学校', lon: 114.33249, lat: 30.579311, distance_m: 4200 },
      { id: 3, name: '湖北大学(武昌校区)', category_big: '科教文化服务', category_mid: '学校', lon: 114.334121, lat: 30.57687, distance_m: 4100 }
    ])

    const handlers = createSpatialCoreHandlers({
      quickSearchPois
    })

    const output = await handlers.resolve_anchor({
      place_name: '湖北大学',
      role: 'primary'
    }, {
      user_query: '湖北大学附近有哪些地铁站？'
    })

    expect(output.anchor).toMatchObject({
      resolved_place_name: '湖北大学(武昌校区)',
      lon: 114.334121,
      lat: 30.57687,
      poi_id: 3
    })
  })

  it('resolve_anchor expands abbreviated school names to canonical school anchors', async () => {
    const quickSearchPois = vi.fn().mockImplementation(async ({ queryText }) => {
      if (queryText === '武汉二中') {
        return [
          { id: 1, name: '武汉二中学生服务中心', category_big: '生活服务', category_mid: '生活服务场所', lon: 114.308579, lat: 30.605369, distance_m: 180 },
          { id: 2, name: '武汉二中广雅中学', category_big: '科教文化服务', category_mid: '学校', lon: 114.311398, lat: 30.604767, distance_m: 420 }
        ]
      }

      if (queryText === '武汉市第二中学') {
        return [
          { id: 3, name: '武汉市第二中学', category_big: '科教文化服务', category_mid: '学校', lon: 114.308002, lat: 30.606691, distance_m: 260 }
        ]
      }

      return []
    })

    const handlers = createSpatialCoreHandlers({
      quickSearchPois
    })

    const output = await handlers.resolve_anchor({
      place_name: '武汉二中',
      role: 'primary'
    }, {
      user_query: '武汉二中附近有哪些商超？'
    })

    expect(output.anchor).toMatchObject({
      resolved_place_name: '武汉市第二中学',
      lon: 114.308002,
      lat: 30.606691,
      poi_id: 3
    })
  })

  it('resolve_anchor degrades into a structured unresolved anchor when quick search is unavailable', async () => {
    const quickSearchPois = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:15432'))

    const handlers = createSpatialCoreHandlers({
      quickSearchPois
    })

    const output = await handlers.resolve_anchor({
      place_name: '湖北大学',
      role: 'primary'
    }, {
      user_query: '湖北大学附近有哪些地铁站？'
    })

    expect(output).toEqual({
      anchor: {
        place_name: '湖北大学',
        display_name: '湖北大学',
        role: 'primary',
        index: 0,
        source: 'quick_search_unavailable',
        resolved_place_name: '湖北大学',
        poi_id: null
      }
    })
  })

  it('search_nearby_pois maps planner-facing input to PostGIS-first hybrid search with optional query embedding', async () => {
    const buildSpatialQueryEmbedding = vi.fn().mockResolvedValue({
      applied: true,
      queryEmbedding: [0.1, 0.2, 0.3]
    })
    const buildQueryEmbeddingSearchOptions = vi.fn().mockReturnValue({
      queryEmbedding: [0.1, 0.2, 0.3],
      semanticWeight: 0.52,
      spatialWeight: 0.48
    })
    const faissHybridSearch = vi.fn().mockResolvedValue([
      {
        id: 1,
        name: '瑞幸咖啡',
        category: '咖啡',
        distance_m: 120
      }
    ])

    const handlers = createSpatialCoreHandlers({
      buildSpatialQueryEmbedding,
      buildQueryEmbeddingSearchOptions,
      faissHybridSearch
    })

    const anchor = {
      place_name: '武汉大学',
      role: 'primary',
      lon: 114.36,
      lat: 30.53
    }

    const output = await handlers.search_nearby_pois({
      anchor,
      radius_m: 800,
      filter: {
        category: '餐饮美食',
        subcategory: '咖啡',
        target_region: 1
      },
      limit: 30
    }, {
      user_query: '武汉大学附近有哪些咖啡店？'
    })

    expect(buildSpatialQueryEmbedding).toHaveBeenCalledWith({
      userQuery: '武汉大学附近有哪些咖啡店？',
      intent: {
        category: '餐饮美食',
        poiSubType: '咖啡',
        regionLabel: 1,
        radiusM: 800
      },
      anchor
    })
    expect(faissHybridSearch).toHaveBeenCalledWith({
      anchor,
      radius: 800,
      categories: ['餐饮美食'],
      subcategory: '咖啡',
      topK: 30,
      targetRegion: 1,
      regionFilterMode: 'boost',
      queryEmbedding: [0.1, 0.2, 0.3],
      semanticWeight: 0.52,
      spatialWeight: 0.48
    })
    expect(output).toMatchObject({
      pois: [
        {
          name: '瑞幸咖啡'
        }
      ],
      total_count: 1
    })
  })

  it('search_nearby_pois normalizes transport-style planner labels to backend-supported category values', async () => {
    const buildSpatialQueryEmbedding = vi.fn().mockResolvedValue({
      applied: false
    })
    const buildQueryEmbeddingSearchOptions = vi.fn().mockReturnValue({})
    const faissHybridSearch = vi.fn().mockResolvedValue([])

    const handlers = createSpatialCoreHandlers({
      buildSpatialQueryEmbedding,
      buildQueryEmbeddingSearchOptions,
      faissHybridSearch
    })

    await handlers.search_nearby_pois({
      anchor: {
        place_name: '湖北大学',
        lon: 114.33,
        lat: 30.57
      },
      radius_m: 1200,
      filter: {
        category: '交通出行',
        subcategory: '地铁'
      },
      limit: 20
    }, {
      user_query: '湖北大学附近有哪些地铁站？'
    })

    expect(faissHybridSearch).toHaveBeenCalledWith(expect.objectContaining({
      categories: ['交通设施服务'],
      subcategory: '地铁站'
    }))
  })

  it('search_nearby_pois short-circuits to an empty result when the anchor has no coordinates', async () => {
    const buildSpatialQueryEmbedding = vi.fn()
    const buildQueryEmbeddingSearchOptions = vi.fn()
    const faissHybridSearch = vi.fn()

    const handlers = createSpatialCoreHandlers({
      buildSpatialQueryEmbedding,
      buildQueryEmbeddingSearchOptions,
      faissHybridSearch
    })

    const output = await handlers.search_nearby_pois({
      anchor: {
        place_name: '湖北大学',
        role: 'primary',
        source: 'quick_search_unavailable'
      },
      radius_m: 1000,
      filter: {
        category: '交通设施服务',
        subcategory: '地铁站'
      },
      limit: 20
    }, {
      user_query: '湖北大学附近有哪些地铁站？'
    })

    expect(buildSpatialQueryEmbedding).not.toHaveBeenCalled()
    expect(buildQueryEmbeddingSearchOptions).not.toHaveBeenCalled()
    expect(faissHybridSearch).not.toHaveBeenCalled()
    expect(output).toEqual({
      pois: [],
      total_count: 0
    })
  })

  it('macro_cell_analysis delegates to town encoder search and returns normalized macro outputs', async () => {
    const searchMacroCellsWithTownEncoder = vi.fn().mockResolvedValue({
      applied: true,
      reason: 'town_encoder_macro_cells',
      cells: [{ cell_id: 'a' }],
      supportBucketDistribution: [{ bucket: '餐饮配套', count: 3 }],
      dominantBuckets: ['餐饮配套'],
      sceneTags: ['高校周边'],
      cellMix: [{ label: '商业片区', count: 2, ratio: 1 }],
      macroUncertainty: {
        sample_size: 2,
        evidence_density: 'medium'
      }
    })

    const handlers = createSpatialCoreHandlers({
      searchMacroCellsWithTownEncoder
    })

    const anchor = {
      place_name: '武汉大学',
      role: 'primary',
      lon: 114.36,
      lat: 30.53
    }

    const output = await handlers.macro_cell_analysis({
      anchor,
      radius_m: 2500,
      focus: 'area_overview'
    }, {
      user_query: '请概览武汉大学附近的空间结构和业态分布。'
    })

    expect(searchMacroCellsWithTownEncoder).toHaveBeenCalledWith({
      anchor,
      intent: {
        taskType: 'area_overview',
        answerType: 'area_overview',
        radiusM: 2500
      },
      userQuery: '请概览武汉大学附近的空间结构和业态分布。'
    })
    expect(output).toEqual({
      support_buckets: [{ bucket: '餐饮配套', count: 3 }],
      support_bucket_metrics: [],
      population_metrics: null,
      uncertainty: {
        sample_size: 2,
        evidence_density: 'medium'
      },
      cells: [{ cell_id: 'a' }],
      dominant_buckets: ['餐饮配套'],
      scene_tags: ['高校周边'],
      cell_mix: [{ label: '商业片区', count: 2, ratio: 1 }]
    })
  })

  it('vector_search reuses hybrid search with semantic-heavy options', async () => {
    const buildSpatialQueryEmbedding = vi.fn().mockResolvedValue({
      applied: true,
      queryEmbedding: [0.4, 0.5, 0.6]
    })
    const buildQueryEmbeddingSearchOptions = vi.fn().mockReturnValue({
      queryEmbedding: [0.4, 0.5, 0.6]
    })
    const faissHybridSearch = vi.fn().mockResolvedValue([
      { id: 1, name: '相似POI' }
    ])

    const handlers = createSpatialCoreHandlers({
      buildSpatialQueryEmbedding,
      buildQueryEmbeddingSearchOptions,
      faissHybridSearch
    })

    const output = await handlers.vector_search({
      anchor: { lon: 114.36, lat: 30.53 },
      limit: 10,
      target: '高校周边类似片区'
    }, {
      user_query: '比较像高校周边的区域'
    })

    expect(faissHybridSearch).toHaveBeenCalledWith(expect.objectContaining({
      radius: 2500,
      topK: 10,
      semanticWeight: 0.7,
      spatialWeight: 0.3,
      queryEmbedding: [0.4, 0.5, 0.6]
    }))
    expect(output.total_count).toBe(1)
  })

  it('spatial_encode returns anchor_context based on query embedding and macro cell context', async () => {
    const buildSpatialQueryEmbedding = vi.fn().mockResolvedValue({
      applied: true,
      source: 'anchor_encoder_v1',
      embeddingDim: 352,
      modelUsage: ['poi_encoder']
    })
    const searchMacroCellsWithTownEncoder = vi.fn().mockResolvedValue({
      applied: true,
      cells: [{ cell_id: 'a' }],
      modelRoute: 'town_encoder',
      modelsUsed: ['town_encoder']
    })

    const handlers = createSpatialCoreHandlers({
      buildSpatialQueryEmbedding,
      searchMacroCellsWithTownEncoder
    })

    const output = await handlers.spatial_encode({
      anchor: {
        place_name: '武汉大学',
        lon: 114.36,
        lat: 30.53
      },
      focus: 'area_overview'
    }, {
      user_query: '请概览武汉大学附近的空间结构和业态分布。'
    })

    expect(output.anchor_context).toMatchObject({
      anchor: {
        place_name: '武汉大学'
      },
      query_embedding_source: 'anchor_encoder_v1',
      query_embedding_applied: true,
      macro_cell_count: 1,
      model_route: 'town_encoder'
    })
  })

  it('build_boundary delegates to spatial geometry evidence builder and returns boundary payload', async () => {
    const buildSpatialGeometryEvidence = vi.fn().mockReturnValue({
      boundary: { type: 'Polygon', coordinates: [] },
      spatialClusters: { hotspots: [{ id: 'h1' }] },
      vernacularRegions: [{ id: 'r1' }],
      fuzzyRegions: [{ id: 'f1' }]
    })

    const handlers = createSpatialCoreHandlers({
      buildSpatialGeometryEvidence
    })

    const output = await handlers.build_boundary({
      anchor: { lon: 114.36, lat: 30.53 },
      pois: [{ name: '瑞幸咖啡', lon: 114.35, lat: 30.52 }]
    }, {
      user_query: '请概览武汉大学附近的空间结构和业态分布。'
    })

    expect(buildSpatialGeometryEvidence).toHaveBeenCalled()
    expect(output).toMatchObject({
      boundary: { type: 'Polygon', coordinates: [] },
      spatial_clusters: { hotspots: [{ id: 'h1' }] },
      vernacular_regions: [{ id: 'r1' }],
      fuzzy_regions: [{ id: 'f1' }]
    })
  })

  it('infer_intent_legacy delegates to parseIntent and returns the raw legacy intent', async () => {
    const parseIntent = vi.fn().mockResolvedValue({
      taskType: 'nearby_lookup',
      placeName: '武汉大学'
    })

    const handlers = createSpatialCoreHandlers({
      parseIntent
    })

    const output = await handlers.infer_intent_legacy({
      user_query: '武汉大学附近有哪些咖啡店？'
    })

    expect(parseIntent).toHaveBeenCalledWith('武汉大学附近有哪些咖啡店？')
    expect(output).toEqual({
      intent: {
        taskType: 'nearby_lookup',
        placeName: '武汉大学'
      }
    })
  })
})
