import { describe, expect, it } from 'vitest'

import { buildEvidenceBundle } from '../../planner_line/evidenceBundle.js'
import { createBaseIntentSpec } from '../../planner_line/intentSpec.js'
import { createIntentSpecService } from '../../planner_line/intentSpecService.js'

const intentSpecService = createIntentSpecService()

describe('evidence selectors driven by intent_spec', () => {
  it('keeps metro evidence and suppresses bus evidence for metro lookup intents', () => {
    const intentSpec = intentSpecService.buildIntentSpec({
      userQuery: '湖北大学附近 1km 内的地铁站'
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'primary'
          }
        },
        s2: {
          pois: [
            {
              id: 1,
              name: '湖北大学地铁站E口',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.95,
              distance_m: 280
            },
            {
              id: 2,
              name: '湖北大学(地铁站)',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.92,
              distance_m: 320
            },
            {
              id: 3,
              name: '秦园路(地铁站)',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.81,
              distance_m: 540
            },
            {
              id: 4,
              name: '湖北大学公交车站',
              categoryMain: '交通设施服务',
              categorySub: '公交车站',
              fused_score: 0.98,
              distance_m: 120
            }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '湖北大学(地铁站)',
      '秦园路(地铁站)'
    ])
    expect(bundle.evidence_profile).toMatchObject({
      style: 'lookup',
      task_type: 'lookup',
      focus_terms: ['地铁站'],
      target_entities: ['地铁站'],
      exclude_entities: ['公交车站'],
      transport_modalities: ['地铁站'],
      evidence_requirements: {
        macro_required: false,
        micro_required: true
      }
    })
  })

  it('keeps bus evidence and suppresses metro evidence for bus lookup intents', () => {
    const intentSpec = intentSpecService.buildIntentSpec({
      userQuery: '湖北大学附近 1km 内的公交车站'
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'primary'
          }
        },
        s2: {
          pois: [
            {
              id: 1,
              name: '湖北大学公交车站',
              categoryMain: '交通设施服务',
              categorySub: '公交车站',
              fused_score: 0.95,
              distance_m: 110
            },
            {
              id: 2,
              name: '积玉桥公交车站',
              categoryMain: '交通设施服务',
              categorySub: '公交车站',
              fused_score: 0.84,
              distance_m: 380
            },
            {
              id: 3,
              name: '湖北大学(地铁站)',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.99,
              distance_m: 260
            }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '湖北大学公交车站',
      '积玉桥公交车站'
    ])
    expect(bundle.evidence_profile).toMatchObject({
      style: 'lookup',
      task_type: 'lookup',
      focus_terms: ['公交车站'],
      target_entities: ['公交车站'],
      exclude_entities: ['地铁站'],
      transport_modalities: ['公交车站']
    })
  })

  it('keeps both metro and bus evidence for shared public transit intents', () => {
    const intentSpec = intentSpecService.buildIntentSpec({
      userQuery: '湖北大学附近的公共交通'
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'primary'
          }
        },
        s2: {
          pois: [
            {
              id: 1,
              name: '湖北大学(地铁站)',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.96,
              distance_m: 240
            },
            {
              id: 2,
              name: '湖北大学公交车站',
              categoryMain: '交通设施服务',
              categorySub: '公交车站',
              fused_score: 0.93,
              distance_m: 90
            },
            {
              id: 3,
              name: '积玉桥公交车站',
              categoryMain: '交通设施服务',
              categorySub: '公交车站',
              fused_score: 0.79,
              distance_m: 410
            }
          ]
        },
        s3: {
          support_buckets: [
            { bucket: '交通出行', count: 6 }
          ],
          support_bucket_metrics: [
            { bucket: '交通出行', count: 6, ratio: 1 }
          ],
          dominant_buckets: ['交通出行'],
          scene_tags: ['高校周边', '交通换乘'],
          cell_mix: [{ label: '教育类', count: 2, ratio: 1 }]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '湖北大学(地铁站)',
      '湖北大学公交车站',
      '积玉桥公交车站'
    ])
    expect(bundle.evidence_profile).toMatchObject({
      style: 'overview',
      task_type: 'overview',
      focus_terms: ['公共交通'],
      target_entities: ['地铁站', '公交车站'],
      transport_modalities: ['地铁站', '公交车站'],
      evidence_requirements: {
        macro_required: true,
        micro_required: true
      }
    })
  })

  it('prioritizes macro structure and civic representatives for overview intents instead of chain-store highscores', () => {
    const intentSpec = intentSpecService.buildIntentSpec({
      userQuery: '请概览武汉大学附近的空间结构和业态分布'
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            lon: 114.364339,
            lat: 30.536334,
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 1, name: '武汉大学', categoryMain: '科教文化服务', categorySub: '学校', fused_score: 0.99, distance_m: 0 },
            { id: 2, name: '星巴克', categoryMain: '餐饮美食', categorySub: '咖啡', fused_score: 0.97, distance_m: 80 },
            { id: 3, name: '武汉大学通讯服务中心', categoryMain: '生活服务', categorySub: '生活服务场所', fused_score: 0.88, distance_m: 59 },
            { id: 4, name: '武汉大学-新闻中心', categoryMain: '科教文化服务', categorySub: '传媒机构', fused_score: 0.84, distance_m: 59 },
            { id: 5, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.69, distance_m: 130 },
            { id: 6, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', fused_score: 0.64, distance_m: 151 },
            { id: 7, name: '中国移动(复地东湖国际营业厅)', categoryMain: '购物服务', categorySub: '家电电子卖场', fused_score: 0.81, distance_m: 71 }
          ]
        },
        s3: {
          support_buckets: [
            { bucket: '教育科研', count: 8 },
            { bucket: '餐饮配套', count: 4 },
            { bucket: '生活服务', count: 3 }
          ],
          support_bucket_metrics: [
            { bucket: '教育科研', count: 8, ratio: 0.533 },
            { bucket: '餐饮配套', count: 4, ratio: 0.267 },
            { bucket: '生活服务', count: 3, ratio: 0.2 }
          ],
          dominant_buckets: ['教育科研', '餐饮配套'],
          scene_tags: ['高校周边', '混合业态'],
          cell_mix: [
            { label: '教育类', count: 3, ratio: 0.75 },
            { label: '生活类', count: 1, ratio: 0.25 }
          ]
        }
      }
    })

    expect(bundle.support_buckets).toEqual([
      { bucket: '教育科研', count: 8 },
      { bucket: '餐饮配套', count: 4 },
      { bucket: '生活服务', count: 3 }
    ])
    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '武汉大学-新闻中心',
      '武汉大学万林艺术博物馆',
      '武汉大学珞珈文库'
    ])
    expect(bundle.representative_pois.map((item) => item.name)).not.toContain('星巴克')
    expect(bundle.evidence_profile).toMatchObject({
      style: 'overview',
      task_type: 'overview',
      focus_terms: ['空间结构', '业态分布'],
      target_entities: ['空间结构', '业态分布'],
      dominant_buckets: ['教育科研', '餐饮配套'],
      scene_tags: ['高校周边', '混合业态'],
      cell_mix: ['教育类', '生活类']
    })
  })

  it('allows chain coffee representatives in overview mode when representation_policy explicitly permits local shops', () => {
    const intentSpec = createBaseIntentSpec({
      task_type: 'overview',
      semantic_focus_terms: ['空间结构', '业态分布'],
      target_entities: [{ type: 'category_bucket', value: '业态分布' }],
      representation_policy: {
        representative_example_count: 2,
        allow_local_shop_as_region_representative: true,
        prefer_public_civic_examples: false
      }
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            lon: 114.364339,
            lat: 30.536334,
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 1, name: 'Starbucks Reserve', categoryMain: '餐饮美食', categorySub: '咖啡', fused_score: 0.97, distance_m: 90 },
            { id: 2, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.74, distance_m: 130 },
            { id: 3, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', fused_score: 0.71, distance_m: 160 }
          ]
        },
        s3: {
          support_buckets: [
            { bucket: '餐饮配套', count: 7 },
            { bucket: '教育科研', count: 5 }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toContain('Starbucks Reserve')
  })

  it('does not blacklist coffee chain names inside overview representative selection when policy allows local shops', () => {
    const intentSpec = createBaseIntentSpec({
      task_type: 'overview',
      semantic_focus_terms: ['空间结构', '业态分布'],
      target_entities: [{ type: 'category_bucket', value: '业态分布' }],
      representation_policy: {
        representative_example_count: 2,
        allow_local_shop_as_region_representative: true,
        prefer_public_civic_examples: true
      }
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            lon: 114.364339,
            lat: 30.536334,
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 1, name: 'Starbucks Reserve', categoryMain: '餐饮美食', categorySub: '咖啡', fused_score: 0.97, distance_m: 90 },
            { id: 2, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.74, distance_m: 130 },
            { id: 3, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', fused_score: 0.71, distance_m: 160 }
          ]
        },
        s3: {
          support_buckets: [
            { bucket: '餐饮配套', count: 7 },
            { bucket: '教育科研', count: 3 }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      'Starbucks Reserve',
      '武汉大学万林艺术博物馆'
    ])
  })

  it('uses representation_policy instead of fixed education quotas when local shops are allowed in overview mode', () => {
    const intentSpec = createBaseIntentSpec({
      task_type: 'overview',
      semantic_focus_terms: ['空间结构', '业态分布'],
      target_entities: [{ type: 'category_bucket', value: '业态分布' }],
      representation_policy: {
        representative_example_count: 3,
        allow_local_shop_as_region_representative: true,
        prefer_public_civic_examples: false
      }
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            lon: 114.364339,
            lat: 30.536334,
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 1, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.78, distance_m: 130 },
            { id: 2, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', fused_score: 0.75, distance_m: 160 },
            { id: 3, name: 'Today便利店', categoryMain: '购物服务', categorySub: '便利店', fused_score: 0.93, distance_m: 85 }
          ]
        },
        s3: {
          support_buckets: [
            { bucket: '教育科研', count: 8 },
            { bucket: '购物零售', count: 6 }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toContain('Today便利店')
    expect(bundle.representative_pois).toHaveLength(3)
  })

  it('does not keep forcing education-heavy quotas when shopping is the dominant overview bucket', () => {
    const intentSpec = createBaseIntentSpec({
      task_type: 'overview',
      semantic_focus_terms: ['空间结构', '业态分布'],
      target_entities: [{ type: 'category_bucket', value: '业态分布' }],
      representation_policy: {
        representative_example_count: 3,
        allow_local_shop_as_region_representative: true,
        prefer_public_civic_examples: true
      }
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            lon: 114.364339,
            lat: 30.536334,
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 1, name: 'Today便利店', categoryMain: '购物服务', categorySub: '便利店', fused_score: 0.97, distance_m: 80 },
            { id: 2, name: '武商超市', categoryMain: '购物服务', categorySub: '超市', fused_score: 0.94, distance_m: 110 },
            { id: 3, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.76, distance_m: 130 },
            { id: 4, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', fused_score: 0.73, distance_m: 160 }
          ]
        },
        s3: {
          support_buckets: [
            { bucket: '购物零售', count: 9 },
            { bucket: '教育科研', count: 3 }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      'Today便利店',
      '武商超市',
      '武汉大学万林艺术博物馆'
    ])
  })

  it('prioritizes geometry aggregation evidence when the intent scope is a drawn polygon', () => {
    const intentSpec = intentSpecService.buildIntentSpec({
      userQuery: '这个圈里的业态分布如何',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [114.36, 30.53],
            [114.37, 30.53],
            [114.37, 30.54],
            [114.36, 30.54],
            [114.36, 30.53]
          ]
        ]
      }
    })

    const bundle = buildEvidenceBundle({
      intentSpec,
      stepOutputs: {
        s2: {
          pois: [
            { id: 1, name: '瑞幸咖啡', categoryMain: '餐饮美食', categorySub: '咖啡', fused_score: 0.92, distance_m: 40 },
            { id: 2, name: 'KFC', categoryMain: '餐饮美食', categorySub: '小吃快餐', fused_score: 0.88, distance_m: 65 },
            { id: 3, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.7, distance_m: 120 },
            { id: 4, name: 'Today便利店', categoryMain: '购物服务', categorySub: '便利店', fused_score: 0.66, distance_m: 75 }
          ]
        }
      }
    })

    expect(bundle.support_buckets).toEqual([
      { bucket: '餐饮配套', count: 2 },
      { bucket: '教育科研', count: 1 },
      { bucket: '购物零售', count: 1 }
    ])
    expect(bundle.support_bucket_metrics).toEqual([
      { bucket: '餐饮配套', count: 2, ratio: 0.5 },
      { bucket: '教育科研', count: 1, ratio: 0.25 },
      { bucket: '购物零售', count: 1, ratio: 0.25 }
    ])
    expect(bundle.evidence_profile).toMatchObject({
      style: 'overview',
      task_type: 'overview',
      focus_terms: ['业态分布'],
      spatial_scope_mode: 'geometry',
      aggregation_mode: 'distribution',
      evidence_requirements: {
        macro_required: true,
        micro_required: true
      }
    })
  })
})
