import { describe, expect, it, vi } from 'vitest'

import {
  enrichResultsWithSpatialEncoder,
  isMacroSpatialTask,
  searchMacroCellsWithTownEncoder,
  shouldEnrichResultsWithSpatialEncoder
} from '../../retrieval/runtimeSpatialAugmenter.js'

describe('runtimeSpatialAugmenter gating', () => {
  it('requests enrichment when region labels and spatial_info are both missing', () => {
    expect(
      shouldEnrichResultsWithSpatialEncoder([
        { id: 1, lon: 114.3, lat: 30.5, regionLabel: null, spatial_info: null }
      ])
    ).toBe(true)
  })

  it('skips enrichment when every result already carries usable spatial evidence', () => {
    expect(
      shouldEnrichResultsWithSpatialEncoder([
        {
          id: 1,
          lon: 114.3,
          lat: 30.5,
          regionLabel: 1,
          spatial_info: { region_idx: 1, region_confidence: 0.8 }
        }
      ])
    ).toBe(false)
  })
})

describe('runtimeSpatialAugmenter execution', () => {
  it('starts the encoder service on demand and merges returned spatial_info into results', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(false),
      startSpatialEncoder: vi.fn().mockResolvedValue(true),
      enrichPOIs: vi.fn().mockResolvedValue([
        {
          id: 1,
          lon: 114.3,
          lat: 30.5,
          spatial_info: { region_idx: 1, region_confidence: 0.84 }
        }
      ])
    }

    const output = await enrichResultsWithSpatialEncoder({
      anchor: { lon: 114.31, lat: 30.51 },
      results: [{ id: 1, lon: 114.3, lat: 30.5, regionLabel: null }],
      client
    })

    expect(client.startSpatialEncoder).toHaveBeenCalledTimes(1)
    expect(client.enrichPOIs).toHaveBeenCalledWith(114.31, 30.51, expect.any(Array))
    expect(output).toMatchObject({
      applied: true,
      results: [
        {
          id: 1,
          spatial_info: { region_idx: 1, region_confidence: 0.84 }
        }
      ]
    })
  })

  it('returns original results when enrichment is unnecessary', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn(),
      startSpatialEncoder: vi.fn(),
      enrichPOIs: vi.fn()
    }

    const original = [
      {
        id: 1,
        lon: 114.3,
        lat: 30.5,
        regionLabel: 1,
        spatial_info: { region_idx: 1, region_confidence: 0.77 }
      }
    ]

    const output = await enrichResultsWithSpatialEncoder({
      anchor: { lon: 114.31, lat: 30.51 },
      results: original,
      client
    })

    expect(output.applied).toBe(false)
    expect(output.reason).toBe('already_enriched')
    expect(output.results).toEqual(original)
    expect(client.enrichPOIs).not.toHaveBeenCalled()
  })

  it('falls back safely when the encoder service cannot be started', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(false),
      startSpatialEncoder: vi.fn().mockResolvedValue(false),
      enrichPOIs: vi.fn()
    }

    const original = [{ id: 1, lon: 114.3, lat: 30.5, regionLabel: null }]
    const output = await enrichResultsWithSpatialEncoder({
      anchor: { lon: 114.31, lat: 30.51 },
      results: original,
      client
    })

    expect(output.applied).toBe(false)
    expect(output.reason).toBe('encoder_unavailable')
    expect(output.results).toEqual(original)
  })
})

describe('runtimeSpatialAugmenter macro cell routing', () => {
  it('recognizes macro analysis tasks as town-encoder-first scenarios', () => {
    expect(isMacroSpatialTask({ taskType: 'support_gap_analysis' })).toBe(true)
    expect(isMacroSpatialTask({ answerType: 'area_overview' })).toBe(true)
    expect(isMacroSpatialTask({ taskType: 'nearby_lookup' })).toBe(false)
  })

  it('starts the encoder and fetches macro cell search results for town-first analysis tasks', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(false),
      startSpatialEncoder: vi.fn().mockResolvedValue(true),
      searchCells: vi.fn().mockResolvedValue({
        anchor_cell_context: {
          cell_id: 'anchor-cell',
          region_idx: 1,
          region_name: '商业类'
        },
        cells: [
          {
            cell_id: 'anchor-cell',
            lon: 114.334,
            lat: 30.579,
            distance_m: 0,
            similarity: 1,
            search_score: 1
          },
          {
            cell_id: 'neighbor-cell',
            lon: 114.338,
            lat: 30.582,
            distance_m: 420,
            similarity: 0.91,
            search_score: 0.87
          }
        ],
        model_route: 'town_encoder',
        models_used: ['town_encoder'],
        search_radius_m: 1800
      })
    }

    const output = await searchMacroCellsWithTownEncoder({
      anchor: { lon: 114.334, lat: 30.579 },
      intent: { taskType: 'support_gap_analysis' },
      userQuery: '帮我分析这里附近的配套、热门业态和明显缺口',
      client
    })

    expect(client.startSpatialEncoder).toHaveBeenCalledTimes(1)
    expect(client.searchCells).toHaveBeenCalledWith(114.334, 30.579, expect.objectContaining({
      taskType: 'support_gap_analysis',
      topK: 4
    }))
    expect(output).toMatchObject({
      applied: true,
      reason: 'town_encoder_macro_cells',
      modelRoute: 'town_encoder',
      modelsUsed: ['town_encoder'],
      searchRadiusM: 1800
    })
    expect(output.cells).toHaveLength(2)
  })

  it('preserves macro summary fields from town cell search for downstream evidence consumers', async () => {
    const client = {
      isSpatialEncoderRunning: vi.fn().mockResolvedValue(true),
      startSpatialEncoder: vi.fn(),
      searchCells: vi.fn().mockResolvedValue({
        anchor_cell_context: {
          cell_id: 'anchor-cell',
          region_idx: 3,
          region_name: '教育类'
        },
        cells: [
          {
            cell_id: 'anchor-cell',
            lon: 114.334,
            lat: 30.579,
            distance_m: 0,
            similarity: 1,
            search_score: 1
          }
        ],
        model_route: 'town_encoder',
        models_used: ['town_encoder'],
        search_radius_m: 2500,
        per_cell_radius_m: 900,
        support_bucket_distribution: [
          {
            bucket: '零售购物',
            count: 4,
            examples: ['中百超市'],
            representative_categories: ['购物消费']
          }
        ],
        dominant_buckets: ['零售购物', '生活服务'],
        scene_tags: ['高校周边', '混合业态'],
        cell_mix: [
          { label: '教育类', count: 2, ratio: 0.67 },
          { label: '商业类', count: 1, ratio: 0.33 }
        ],
        macro_uncertainty: {
          sample_size: 3,
          evidence_density: 'high',
          low_sample_warning: false
        }
      })
    }

    const output = await searchMacroCellsWithTownEncoder({
      anchor: { lon: 114.334, lat: 30.579 },
      intent: { taskType: 'area_overview' },
      userQuery: '请概览武汉大学附近的空间结构和业态分布',
      client
    })

    expect(output).toMatchObject({
      supportBucketDistribution: [
        {
          bucket: '零售购物',
          count: 4
        }
      ],
      dominantBuckets: ['零售购物', '生活服务'],
      sceneTags: ['高校周边', '混合业态'],
      cellMix: [
        { label: '教育类', count: 2, ratio: 0.67 },
        { label: '商业类', count: 1, ratio: 0.33 }
      ],
      macroUncertainty: {
        sample_size: 3,
        evidence_density: 'high',
        low_sample_warning: false
      }
    })
  })
})
