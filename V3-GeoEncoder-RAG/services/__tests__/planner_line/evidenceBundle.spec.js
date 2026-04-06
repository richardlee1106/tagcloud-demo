import { describe, expect, it } from 'vitest'

import { buildEvidenceBundle } from '../../planner_line/evidenceBundle.js'

describe('evidenceBundle', () => {
  it('builds representative_pois by deduping and sorting on fused_score then distance', () => {
    const bundle = buildEvidenceBundle({
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 1, name: 'A', fused_score: 0.7, distance_m: 200 },
            { id: 1, name: 'A', fused_score: 0.8, distance_m: 220 },
            { id: 2, name: 'B', fused_score: 0.9, distance_m: 300 },
            { id: 3, name: 'C', fused_score: 0.8, distance_m: 100 }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual(['B', 'C', 'A'])
    expect(bundle.representative_pois).toHaveLength(3)
  })

  it('groups transport exits into station-level representative pois and prefers station entities', () => {
    const bundle = buildEvidenceBundle({
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '湖北大学',
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
              distance_m: 360
            },
            {
              id: 2,
              name: '湖北大学地铁站A口',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.94,
              distance_m: 420
            },
            {
              id: 3,
              name: '湖北大学(地铁站)',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.9,
              distance_m: 450
            },
            {
              id: 4,
              name: '秦园路(地铁站)',
              categoryMain: '交通设施服务',
              categorySub: '地铁站',
              fused_score: 0.82,
              distance_m: 530
            }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '湖北大学(地铁站)',
      '秦园路(地铁站)'
    ])
  })

  it('dedupes same-name same-location entities even when upstream ids differ', () => {
    const bundle = buildEvidenceBundle({
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 101, name: '武汉大学医院', lon: 114.3640919, lat: 30.533522, fused_score: 0.85, distance_m: 312 },
            { id: 102, name: '武汉大学医院', lon: 114.3640919, lat: 30.533522, fused_score: 0.85, distance_m: 312 },
            { id: 103, name: '武汉大学社区卫生服务中心', lon: 114.359594, lat: 30.541897, fused_score: 0.71, distance_m: 766 }
          ]
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '武汉大学医院',
      '武汉大学社区卫生服务中心'
    ])
  })

  it('filters low-signal anchor-adjacent pois for overview-style representative selection', () => {
    const bundle = buildEvidenceBundle({
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
            { id: 1, name: '武汉大学', categoryMain: '科教文化服务', categorySub: '学校', lon: 114.364339, lat: 30.536334, fused_score: 0.97, distance_m: 0 },
            { id: 2, name: '武汉大学梅园6舍', categoryMain: '商务住宅', categorySub: '住宅区', lon: 114.364201, lat: 30.536204, fused_score: 0.93, distance_m: 19 },
            { id: 3, name: '武汉大学停车场', categoryMain: '交通设施服务', categorySub: '停车场', lon: 114.365253, lat: 30.536173, fused_score: 0.77, distance_m: 89 },
            { id: 4, name: '武汉大学通讯服务中心', categoryMain: '生活服务', categorySub: '生活服务场所', lon: 114.364243, lat: 30.535808, fused_score: 0.84, distance_m: 59 },
            { id: 5, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', lon: 114.363073, lat: 30.536759, fused_score: 0.69, distance_m: 130 },
            { id: 6, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', lon: 114.362895, lat: 30.535781, fused_score: 0.64, distance_m: 151 },
            { id: 7, name: 'KFC', categoryMain: '餐饮美食', categorySub: '小吃快餐', lon: 114.364763, lat: 30.535624, fused_score: 0.79, distance_m: 88 },
            { id: 8, name: '波司登(光谷天地F区店)', categoryMain: '购物服务', categorySub: '服装鞋帽皮具店', lon: 114.364562, lat: 30.536166, fused_score: 0.91, distance_m: 28 }
          ]
        }
      },
      plan: {
        answer_frame: {
          style: 'overview'
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '武汉大学万林艺术博物馆',
      '武汉大学珞珈文库'
    ])
  })

  it('infers overview support buckets from nearby pois when macro analysis is empty', () => {
    const bundle = buildEvidenceBundle({
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          }
        },
        s2: {
          pois: [
            { id: 1, name: 'KFC', categoryMain: '餐饮美食', categorySub: '小吃快餐', fused_score: 0.79, distance_m: 88 },
            { id: 2, name: 'luckin coffee', categoryMain: '餐饮美食', categorySub: '咖啡', fused_score: 0.71, distance_m: 123 },
            { id: 3, name: '波司登(光谷天地F区店)', categoryMain: '购物服务', categorySub: '服装鞋帽皮具店', fused_score: 0.91, distance_m: 28 },
            { id: 4, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.68, distance_m: 130 },
            { id: 5, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', fused_score: 0.64, distance_m: 151 }
          ]
        },
        s3: {
          support_buckets: [],
          support_bucket_metrics: []
        }
      },
      plan: {
        answer_frame: {
          style: 'overview'
        }
      }
    })

    expect(bundle.support_buckets).toEqual([
      { bucket: '教育科研', count: 2 },
      { bucket: '餐饮配套', count: 2 },
      { bucket: '购物零售', count: 1 }
    ])
    expect(bundle.support_bucket_metrics).toEqual([
      { bucket: '教育科研', count: 2, ratio: 0.4 },
      { bucket: '餐饮配套', count: 2, ratio: 0.4 },
      { bucket: '购物零售', count: 1, ratio: 0.2 }
    ])
  })

  it('derives support bucket metrics from macro support buckets when explicit metrics are absent', () => {
    const bundle = buildEvidenceBundle({
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          }
        },
        s2: {
          pois: []
        },
        s3: {
          support_buckets: [
            { bucket: '教育服务', count: 7 },
            { bucket: '生活服务', count: 5 },
            { bucket: '餐饮配套', count: 5 }
          ],
          support_bucket_metrics: []
        }
      },
      plan: {
        answer_frame: {
          style: 'overview'
        }
      }
    })

    expect(bundle.support_bucket_metrics).toEqual([
      { bucket: '教育服务', count: 7, ratio: 0.412 },
      { bucket: '生活服务', count: 5, ratio: 0.294 },
      { bucket: '餐饮配套', count: 5, ratio: 0.294 }
    ])
  })

  it('keeps default overview representatives focused on civic and cultural anchors instead of local shops and utility outlets', () => {
    const bundle = buildEvidenceBundle({
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
            { id: 1, name: '波司登(光谷天地F区店)', categoryMain: '购物服务', categorySub: '服装鞋帽皮具店', fused_score: 0.91, distance_m: 28 },
            { id: 2, name: '梅园', categoryMain: '餐饮美食', categorySub: '中国菜', fused_score: 0.84, distance_m: 67 },
            { id: 3, name: '武汉大学-新闻中心', categoryMain: '科教文化服务', categorySub: '传媒机构', fused_score: 0.84, distance_m: 59 },
            { id: 4, name: '梅园教工食堂', categoryMain: '餐饮美食', categorySub: '中国菜', fused_score: 0.82, distance_m: 75 },
            { id: 5, name: '中国移动(复地东湖国际营业厅)', categoryMain: '购物服务', categorySub: '家电电子卖场', fused_score: 0.81, distance_m: 71 },
            { id: 6, name: '武汉大学万林艺术博物馆', categoryMain: '科教文化服务', categorySub: '博物馆', fused_score: 0.69, distance_m: 130 },
            { id: 7, name: '武汉大学珞珈文库', categoryMain: '科教文化服务', categorySub: '图书馆', fused_score: 0.64, distance_m: 151 }
          ]
        },
        s3: {
          support_buckets: [
            { bucket: '教育服务', count: 7 },
            { bucket: '生活服务', count: 5 },
            { bucket: '餐饮配套', count: 5 }
          ],
          support_bucket_metrics: []
        }
      },
      plan: {
        answer_frame: {
          style: 'overview'
        }
      }
    })

    expect(bundle.representative_pois.map((item) => item.name)).toEqual([
      '武汉大学-新闻中心',
      '武汉大学万林艺术博物馆',
      '武汉大学珞珈文库'
    ])
    expect(bundle.representative_pois.map((item) => item.name)).not.toContain('梅园')
    expect(bundle.representative_pois.map((item) => item.name)).not.toContain('波司登(光谷天地F区店)')
    expect(bundle.representative_pois.map((item) => item.name)).not.toContain('中国移动(复地东湖国际营业厅)')
  })

  it('preserves dominant buckets, scene tags, and cell mix from macro outputs', () => {
    const bundle = buildEvidenceBundle({
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          }
        },
        s2: {
          pois: []
        },
        s3: {
          support_buckets: [{ bucket: '教育服务', count: 7 }],
          dominant_buckets: ['教育服务', '生活服务'],
          scene_tags: ['高校周边', '混合业态'],
          cell_mix: [
            { label: '教育类', count: 3, ratio: 0.6 },
            { label: '居住类', count: 2, ratio: 0.4 }
          ]
        }
      },
      plan: {
        answer_frame: {
          style: 'overview'
        }
      }
    })

    expect(bundle.dominant_buckets).toEqual(['教育服务', '生活服务'])
    expect(bundle.scene_tags).toEqual(['高校周边', '混合业态'])
    expect(bundle.cell_mix).toEqual([
      { label: '教育类', count: 3, ratio: 0.6 },
      { label: '居住类', count: 2, ratio: 0.4 }
    ])
  })

  it('builds an evidence profile that captures the current query focus from plan and macro signals', () => {
    const bundle = buildEvidenceBundle({
      stepOutputs: {
        s1: {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'primary'
          }
        },
        s2: {
          pois: []
        },
        s3: {
          support_buckets: [{ bucket: '交通出行', count: 5 }],
          dominant_buckets: ['交通出行'],
          scene_tags: ['高校周边', '交通换乘'],
          cell_mix: [{ label: '教育类', count: 2, ratio: 1 }]
        }
      },
      plan: {
        task_type_hint: 'nearby_lookup',
        steps: [
          {
            tool: 'spatial_core.search_nearby_pois',
            input: {
              filter: {
                category: '交通设施服务',
                subcategory: '地铁站'
              }
            }
          }
        ],
        answer_frame: {
          style: 'lookup'
        }
      }
    })

    expect(bundle.evidence_profile).toEqual({
      style: 'lookup',
      task_type: 'nearby_lookup',
      search_filters: [
        {
          category: '交通设施服务',
          subcategory: '地铁站',
          target_region: null
        }
      ],
      focus_terms: ['地铁站', '交通设施服务'],
      transport_modalities: ['地铁站'],
      dominant_buckets: ['交通出行'],
      scene_tags: ['高校周边', '交通换乘'],
      cell_mix: ['教育类']
    })
  })
})
