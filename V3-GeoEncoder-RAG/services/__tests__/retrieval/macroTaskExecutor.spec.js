import { describe, expect, it, vi } from 'vitest'

import { executeDedicatedComparisonTask } from '../../spatial_core/retrieval/macroTaskExecutor.js'

describe('macroTaskExecutor comparison summaries', () => {
  it('prefers town macro bucket summaries over noisy poi buckets when building comparison regions', async () => {
    const searchMacroCellsWithTownEncoder = vi.fn()
      .mockResolvedValueOnce({
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: [
          { cell_id: 'whu-cell-1', lon: 114.3643, lat: 30.5363, similarity: 1, search_score: 1, distance_m: 0, population_density: 28000 },
          { cell_id: 'whu-cell-2', lon: 114.3651, lat: 30.5371, similarity: 0.92, search_score: 0.9, distance_m: 120, population_density: 22000 },
          { cell_id: 'whu-cell-3', lon: 114.3662, lat: 30.5382, similarity: 0.84, search_score: 0.83, distance_m: 260, population_density: 18000 }
        ],
        modelRoute: 'town_encoder',
        modelsUsed: ['town_encoder'],
        searchRadiusM: 3200,
        perCellRadiusM: 1100,
        supportBucketDistribution: [
          { bucket: '零售购物', count: 5, examples: ['便利店'], representative_categories: ['购物消费'] },
          { bucket: '餐饮配套', count: 3, examples: ['咖啡'], representative_categories: ['餐饮美食'] }
        ],
        dominantBuckets: ['零售购物', '生活服务'],
        sceneTags: ['高校周边', '混合业态'],
        cellMix: [
          { label: '教育类', count: 2, ratio: 0.67 },
          { label: '商业类', count: 1, ratio: 0.33 }
        ],
        macroUncertainty: {
          sample_size: 5,
          evidence_density: 'high',
          low_sample_warning: false
        }
      })
      .mockResolvedValueOnce({
        applied: true,
        reason: 'town_encoder_macro_cells',
        cells: [
          { cell_id: 'hubu-cell-1', lon: 114.3111, lat: 30.5842, similarity: 1, search_score: 1, distance_m: 0, population_density: 16000 },
          { cell_id: 'hubu-cell-2', lon: 114.3122, lat: 30.5851, similarity: 0.91, search_score: 0.89, distance_m: 140, population_density: 14000 },
          { cell_id: 'hubu-cell-3', lon: 114.3133, lat: 30.5862, similarity: 0.82, search_score: 0.8, distance_m: 320, population_density: 12000 }
        ],
        modelRoute: 'town_encoder',
        modelsUsed: ['town_encoder'],
        searchRadiusM: 3200,
        perCellRadiusM: 1100,
        supportBucketDistribution: [
          { bucket: '交通出行', count: 4, examples: ['公交站'], representative_categories: ['交通设施服务'] },
          { bucket: '餐饮配套', count: 6, examples: ['餐馆'], representative_categories: ['餐饮美食'] }
        ],
        dominantBuckets: ['交通出行', '教育服务'],
        sceneTags: ['交通换乘', '校园外围'],
        cellMix: [
          { label: '公共类', count: 2, ratio: 0.67 },
          { label: '教育类', count: 1, ratio: 0.33 }
        ],
        macroUncertainty: {
          sample_size: 4,
          evidence_density: 'medium',
          low_sample_warning: false
        }
      })

    const deps = {
      getIndexStatus: vi.fn().mockReturnValue({ loaded: true }),
      searchMacroCellsWithTownEncoder,
      faissHybridSearch: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: '公交站A',
          category: '公交车站',
          lon: 114.3644,
          lat: 30.5365,
          distance_m: 80,
          fused_score: 0.76
        },
        {
          id: 2,
          name: '校区服务点',
          category: '学校',
          lon: 114.3641,
          lat: 30.5361,
          distance_m: 120,
          fused_score: 0.71
        }
      ]),
      enrichResultsWithSpatialEncoder: vi.fn().mockImplementation(async ({ results }) => ({
        applied: false,
        reason: 'already_enriched',
        results,
        modelsUsed: []
      })),
      enrichResultsWithCellContext: vi.fn().mockImplementation(async ({ results }) => ({
        applied: false,
        reason: 'already_enriched',
        results,
        modelsUsed: []
      }))
    }

    const result = await executeDedicatedComparisonTask({
      userQuery: '比较武汉大学和湖北大学附近的业态差异。',
      intent: {
        taskType: 'region_comparison',
        answerType: 'region_comparison',
        radiusM: 3200
      },
      comparisonAnchors: [
        {
          place_name: '武汉大学',
          display_name: '武汉大学',
          role: 'primary',
          index: 0,
          lon: 114.364339,
          lat: 30.536334,
          source: 'intent.place_name'
        },
        {
          place_name: '湖北大学',
          display_name: '湖北大学',
          role: 'secondary',
          index: 1,
          lon: 114.311086,
          lat: 30.584176,
          source: 'intent.place_name'
        }
      ],
      deps
    })

    expect(result.applied).toBe(true)
    expect(result.comparisonRegions[0]).toMatchObject({
      support_buckets: expect.arrayContaining([
        expect.objectContaining({
          bucket: '零售购物',
          count: 5
        })
      ]),
      scene_tags: ['高校周边', '混合业态'],
      cell_mix: [
        { label: '教育类', count: 2, ratio: 0.67 },
        { label: '商业类', count: 1, ratio: 0.33 }
      ],
      uncertainty: {
        evidence_density: 'high'
      },
      support_bucket_metrics: expect.arrayContaining([
        expect.objectContaining({
          bucket: '零售购物',
          count: 5,
          share_pct: 63
        }),
        expect.objectContaining({
          bucket: '餐饮配套',
          count: 3,
          share_pct: 38
        })
      ]),
      population_metrics: expect.objectContaining({
        avg_density: 22667,
        density_level: 'high',
        high_density_cell_ratio: 0.6667
      })
    })
    expect(result.comparisonRegions[1]).toMatchObject({
      support_buckets: expect.arrayContaining([
        expect.objectContaining({
          bucket: '交通出行',
          count: 4
        })
      ]),
      scene_tags: ['交通换乘', '校园外围'],
      uncertainty: {
        evidence_density: 'medium'
      },
      support_bucket_metrics: [
        expect.objectContaining({
          bucket: '餐饮配套',
          count: 6,
          share_pct: 100
        })
      ],
      population_metrics: expect.objectContaining({
        avg_density: 14000,
        density_level: 'medium',
        high_density_cell_ratio: 0
      })
    })
  })
})
