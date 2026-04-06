import { describe, expect, it, vi } from 'vitest'

import {
  buildSpatialAnswerFallback,
  generateAnswerStream
} from '../../spatial_core/ai/spatialAnswerService.js'

const SUPPORT_GAP_QUERY = '请帮我看看这里附近有什么值得关注的配套、热门业态和明显缺口，并按相关性排序。'

const MIXED_RESULTS = [
  { name: '潮馆服饰', category: '服装鞋帽皮具店', distance_m: 21 },
  { name: '东方方素质成长中心(永清城区校区)', category: '培训机构', distance_m: 32 },
  { name: '高农生物园迷你街', category: '特色商业街', distance_m: 32 },
  { name: '惠安路', category: '交通地名', distance_m: 38 },
  { name: '百世快递', category: '物流速递', distance_m: 40 }
]

describe('spatialAnswerService', () => {
  it('treats chinese-cuisine style categories as dining support instead of a missing bucket', () => {
    const answer = buildSpatialAnswerFallback('请分析武汉大学附近的配套、热门业态和明显缺口。', [
      { name: '川味人家', category: '中国菜', distance_m: 88 },
      { name: '老街热干面', category: '面馆', distance_m: 112 }
    ], {
      answerType: 'support_gap_analysis',
      anchorLabel: '武汉大学'
    })

    expect(answer).toContain('**餐饮配套**')
    expect(answer).toContain('日常吃饭')
    expect(answer).not.toContain('在当前命中的前')
  })

  it('uses a reasoning-oriented markdown structure for support-gap answers', () => {
    const answer = buildSpatialAnswerFallback(SUPPORT_GAP_QUERY, MIXED_RESULTS, {
      answerType: 'support_gap_analysis',
      anchorLabel: '当前视图'
    })

    expect(answer).toContain('### 配套现状')
    expect(answer).toContain('### 热门业态')
    expect(answer).toContain('### 明显缺口')
    expect(answer).not.toContain('### 附近可选地点')
  })

  it('prefers structured macro evidence when support buckets and uncertainty are provided', () => {
    const answer = buildSpatialAnswerFallback('请分析武汉大学附近的配套、热门业态和明显缺口。', [
      { name: '样本点', category: '未分类', distance_m: 88 }
    ], {
      answerType: 'support_gap_analysis',
      anchorLabel: '武汉大学',
      supportBuckets: [
        {
          bucket: '餐饮配套',
          count: 4,
          examples: ['川味人家', '瑞幸咖啡']
        },
        {
          bucket: '零售购物',
          count: 2,
          examples: ['Today便利店']
        }
      ],
      uncertainty: {
        sample_size: 1,
        low_sample_warning: true
      }
    })

    expect(answer).toContain('餐饮')
    expect(answer).toContain('零售')
    expect(answer).toContain('当前证据样本仍然偏少')
  })

  it('omits generic macro category labels when structured bucket examples are not real poi names', () => {
    const answer = buildSpatialAnswerFallback('请分析武汉大学附近的配套、热门业态和明显缺口。', [
      { name: '武汉大学医院', category: '综合医院', distance_m: 88 }
    ], {
      answerType: 'support_gap_analysis',
      anchorLabel: '武汉大学',
      supportBuckets: [
        {
          bucket: '教育服务',
          count: 4,
          examples: ['科教文化', '商务住宅']
        }
      ],
      representativePois: [
        {
          name: '武汉大学医院',
          category: '综合医院',
          support_bucket: '医疗健康'
        }
      ]
    })

    expect(answer).toContain('**教育服务**')
    expect(answer).not.toContain('科教文化')
    expect(answer).not.toContain('商务住宅')
  })

  it('passes answer-type-specific markdown guidance into the streaming LLM prompt', async () => {
    const streamImpl = vi.fn(async (messages, onChunk) => {
      onChunk('### 配套现状\n- 当前命中以生活与教育配套为主。')
      return '### 配套现状\n- 当前命中以生活与教育配套为主。'
    })

    await generateAnswerStream(SUPPORT_GAP_QUERY, MIXED_RESULTS, () => {}, {
      answerType: 'support_gap_analysis',
      anchorLabel: '当前视图',
      streamImpl
    })

    const prompt = streamImpl.mock.calls[0][0][1].content
    expect(prompt).toContain('### 配套现状')
    expect(prompt).toContain('### 热门业态')
    expect(prompt).toContain('### 明显缺口')
    expect(prompt).toContain('按优先级给出 1-2 类更值得先补查或继续验证的缺口方向')
    expect(prompt).not.toContain('### 附近可选地点')
  })

  it('short-circuits simple nearby lookup answers to deterministic fallback without calling the LLM', async () => {
    const streamImpl = vi.fn(async () => '不应该走到这里')
    const onChunk = vi.fn()

    const answer = await generateAnswerStream('武汉大学附近有哪些咖啡店？', [
      { name: 'WHU Cafe', category: '咖啡厅', distance_m: 120 },
      { name: '珞珈咖啡', category: '咖啡厅', distance_m: 220 }
    ], onChunk, {
      answerType: 'nearby_lookup',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      requestedCategory: '咖啡',
      streamImpl
    })

    expect(streamImpl).not.toHaveBeenCalled()
    expect(answer).toContain('### 先看结论')
    expect(answer).toContain('### 附近可选地点')
    expect(answer).toContain('WHU Cafe')
    expect(onChunk).toHaveBeenCalledWith(answer)
  })

  it('short-circuits explicit-place support-gap answers to deterministic fallback without calling the LLM', async () => {
    const streamImpl = vi.fn(async () => '不应该走到这里')
    const onChunk = vi.fn()

    const answer = await generateAnswerStream('请分析武汉大学附近的配套、热门业态和明显缺口。', MIXED_RESULTS, onChunk, {
      answerType: 'support_gap_analysis',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      streamImpl
    })

    expect(streamImpl).not.toHaveBeenCalled()
    expect(answer).toContain('### 配套现状')
    expect(answer).toContain('### 热门业态')
    expect(answer).toContain('### 明显缺口')
    expect(onChunk).toHaveBeenCalledWith(answer)
  })

  it('short-circuits explicit-place area-overview answers to deterministic fallback without calling the LLM', async () => {
    const streamImpl = vi.fn(async () => '不应该走到这里')
    const onChunk = vi.fn()

    const answer = await generateAnswerStream('请概览武汉大学附近的空间结构和业态分布。', MIXED_RESULTS, onChunk, {
      answerType: 'area_overview',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      streamImpl
    })

    expect(streamImpl).not.toHaveBeenCalled()
    expect(answer).toContain('### 区域概览')
    expect(answer).toContain('### 主要业态')
    expect(onChunk).toHaveBeenCalledWith(answer)
  })

  it('short-circuits explicit-place site-suitability answers to deterministic fallback without calling the LLM', async () => {
    const streamImpl = vi.fn(async () => '不应该走到这里')
    const onChunk = vi.fn()

    const answer = await generateAnswerStream('武汉大学附近适合布局什么业态？', MIXED_RESULTS, onChunk, {
      answerType: 'site_suitability',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      streamImpl
    })

    expect(streamImpl).not.toHaveBeenCalled()
    expect(answer).toContain('### 场地画像')
    expect(answer).toContain('### 适合布局')
    expect(onChunk).toHaveBeenCalledWith(answer)
  })

  it('turns site-suitability macro evidence into actionable recommendations instead of defaulting to education-service dominance', () => {
    const answer = buildSpatialAnswerFallback('武汉大学附近适合布局什么业态？', [
      { name: '武汉大学医院', category: '综合医院', distance_m: 8 },
      { name: '轩轩副食', category: '便民商店/便利店', distance_m: 12 },
      { name: '瑞幸咖啡', category: '咖啡', distance_m: 18 },
      { name: '武汉大学第5教学楼', category: '学校', distance_m: 36 }
    ], {
      answerType: 'site_suitability',
      anchorLabel: '武汉大学',
      supportBuckets: [
        { bucket: '教育服务', count: 7, examples: ['武汉大学'] },
        { bucket: '零售购物', count: 5, examples: ['轩轩副食'] },
        { bucket: '餐饮配套', count: 4, examples: ['瑞幸咖啡'] },
        { bucket: '生活服务', count: 3, examples: ['校园营业厅'] }
      ],
      representativePois: [
        { name: '武汉大学医院', category: '综合医院', support_bucket: '医疗健康' },
        { name: '轩轩副食', category: '便民商店/便利店', support_bucket: '零售购物' },
        { name: '瑞幸咖啡', category: '咖啡', support_bucket: '餐饮配套' },
        { name: '武汉大学第5教学楼', category: '学校', support_bucket: '教育服务' }
      ]
    })

    expect(answer).toContain('高校/教育场景')
    expect(answer).toContain('零售购物')
    expect(answer).toContain('餐饮配套')
    expect(answer).not.toContain('最明显的配套倾向是 **教育服务**')
  })

  it('short-circuits dual-anchor comparison answers to deterministic fallback until dedicated comparison evidence is available', async () => {
    const streamImpl = vi.fn(async () => '不应该走到这里')
    const onChunk = vi.fn()

    const answer = await generateAnswerStream('比较武汉大学和湖北大学附近的业态差异。', MIXED_RESULTS, onChunk, {
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary' },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary' }
      ],
      streamImpl
    })

    expect(streamImpl).not.toHaveBeenCalled()
    expect(answer).toContain('### 对比结论')
    expect(answer).toContain('武汉大学')
    expect(answer).toContain('湖北大学')
    expect(onChunk).toHaveBeenCalledWith(answer)
  })

  it('uses contrastive consumer buckets for comparison conclusions when broad campus labels exist on both sides', () => {
    const answer = buildSpatialAnswerFallback('比较武汉大学和湖北大学附近的业态差异。', [
      { name: '武汉大学医院', category: '综合医院', distance_m: 12 },
      { name: '芊烨餐馆', category: '中国菜', distance_m: 18 }
    ], {
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary' },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary' }
      ],
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
            evidence_density: 'medium'
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
            sample_size: 6,
            evidence_density: 'medium'
          }
        }
      ]
    })

    expect(answer).toContain('零售购物')
    expect(answer).toContain('餐饮配套')
    expect(answer).not.toContain('更偏 **教育服务**，而 **湖北大学** 更偏 **生活服务**')
    expect(answer).not.toContain('代表点有 **团结大道油料社区(公交站)**')
  })

  it('builds a real comparison summary when dual-region structured evidence is available', () => {
    const answer = buildSpatialAnswerFallback('比较武汉大学和湖北大学附近的业态差异。', [
      { name: '武汉大学医院', category: '综合医院', distance_m: 12 },
      { name: '芊烨餐馆', category: '中国菜', distance_m: 18 }
    ], {
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary' },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary' }
      ],
      comparisonRegions: [
        {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          },
          support_buckets: [
            { bucket: '零售购物', count: 3, examples: ['轩轩副食'] },
            { bucket: '医疗健康', count: 1, examples: ['武汉大学医院'] }
          ],
          representative_pois: [
            { name: '武汉大学医院', category: '综合医院' },
            { name: '轩轩副食', category: '便民商店/便利店' }
          ],
          uncertainty: {
            sample_size: 5,
            evidence_density: 'medium'
          }
        },
        {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'secondary'
          },
          support_buckets: [
            { bucket: '餐饮配套', count: 4, examples: ['芊烨餐馆'] },
            { bucket: '交通出行', count: 2, examples: ['湖北大学地铁站A口'] }
          ],
          representative_pois: [
            { name: '芊烨餐馆', category: '中国菜' },
            { name: '湖北大学地铁站A口', category: '地铁站' }
          ],
          uncertainty: {
            sample_size: 6,
            evidence_density: 'medium'
          }
        }
      ]
    })

    expect(answer).toContain('### 对比结论')
    expect(answer).toContain('### 各自特点')
    expect(answer).toContain('### 选择建议')
    expect(answer).toContain('武汉大学')
    expect(answer).toContain('湖北大学')
    expect(answer).toContain('零售购物')
    expect(answer).toContain('餐饮配套')
    expect(answer).not.toContain('还没有形成“双区域分别取证、再并列比较”的完整证据')
  })

  it('translates comparison evidence into human language instead of dumping raw share and pop-grid metrics', () => {
    const answer = buildSpatialAnswerFallback('比较武汉大学和湖北大学附近的业态差异。', [
      { name: '武汉大学医院', category: '综合医院', distance_m: 12 },
      { name: '芊烨餐馆', category: '中国菜', distance_m: 18 }
    ], {
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary' },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary' }
      ],
      comparisonRegions: [
        {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          },
          support_buckets: [
            { bucket: '零售购物', count: 5, examples: ['轩轩副食'] },
            { bucket: '餐饮配套', count: 3, examples: ['瑞幸咖啡'] }
          ],
          support_bucket_metrics: [
            { bucket: '零售购物', count: 5, share: 0.625, share_pct: 63 },
            { bucket: '餐饮配套', count: 3, share: 0.375, share_pct: 38 }
          ],
          representative_pois: [
            { name: '轩轩副食', category: '便民商店/便利店' },
            { name: '瑞幸咖啡', category: '咖啡' }
          ],
          population_metrics: {
            avg_density: 22667,
            density_level: 'high',
            high_density_cell_ratio: 0.6667
          },
          uncertainty: {
            sample_size: 5,
            evidence_density: 'high'
          }
        },
        {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'secondary'
          },
          support_buckets: [
            { bucket: '餐饮配套', count: 6, examples: ['芊烨餐馆'] },
            { bucket: '交通出行', count: 4, examples: ['湖北大学地铁站A口'] }
          ],
          support_bucket_metrics: [
            { bucket: '餐饮配套', count: 6, share: 0.6, share_pct: 60 },
            { bucket: '交通出行', count: 4, share: 0.4, share_pct: 40 }
          ],
          representative_pois: [
            { name: '芊烨餐馆', category: '中国菜' },
            { name: '湖北大学地铁站A口', category: '地铁站' }
          ],
          population_metrics: {
            avg_density: 14000,
            density_level: 'medium',
            high_density_cell_ratio: 0
          },
          uncertainty: {
            sample_size: 6,
            evidence_density: 'medium'
          }
        }
      ]
    })

    expect(answer).toContain('零售购物')
    expect(answer).toContain('餐饮配套')
    expect(answer).toMatch(/人流|热闹|活跃/)
    expect(answer).not.toContain('22667')
    expect(answer).not.toContain('14000')
    expect(answer).not.toContain('pop栅格')
  })

  it('ignores generic macro-only secondary buckets when verified comparison metrics are available', () => {
    const answer = buildSpatialAnswerFallback('比较武汉大学和湖北大学附近的业态差异。', [
      { name: '武汉大学医院', category: '综合医院', distance_m: 12 },
      { name: '芊烨餐馆', category: '中国菜', distance_m: 18 }
    ], {
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary' },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary' }
      ],
      comparisonRegions: [
        {
          anchor: {
            place_name: '武汉大学',
            display_name: '武汉大学',
            role: 'primary'
          },
          support_buckets: [
            { bucket: '零售购物', count: 5, examples: ['轩轩副食', '雪糕批发'] },
            { bucket: '餐饮配套', count: 6, examples: ['科教文化', '商务住宅', '餐饮美食'] },
            { bucket: '医疗健康', count: 4, examples: ['武汉大学医院'] }
          ],
          support_bucket_metrics: [
            { bucket: '零售购物', count: 5, share: 0.5556, share_pct: 56 },
            { bucket: '医疗健康', count: 4, share: 0.4444, share_pct: 44 }
          ],
          representative_pois: [
            { name: '轩轩副食', category: '便民商店/便利店', support_bucket: '零售购物' },
            { name: '武汉大学医院', category: '综合医院', support_bucket: '医疗健康' }
          ],
          population_metrics: {
            avg_density: 30947,
            density_level: 'high',
            high_density_cell_ratio: 0.5
          }
        },
        {
          anchor: {
            place_name: '湖北大学',
            display_name: '湖北大学',
            role: 'secondary'
          },
          support_buckets: [
            { bucket: '餐饮配套', count: 6, examples: ['芊烨餐馆'] },
            { bucket: '交通出行', count: 6, examples: ['团结大道油料社区(公交站)'] },
            { bucket: '医疗健康', count: 5, examples: ['名医堂'] }
          ],
          support_bucket_metrics: [
            { bucket: '餐饮配套', count: 6, share: 0.5455, share_pct: 55 },
            { bucket: '医疗健康', count: 5, share: 0.4545, share_pct: 45 }
          ],
          representative_pois: [
            { name: '芊烨餐馆', category: '中国菜', support_bucket: '餐饮配套' },
            { name: '团结大道油料社区(公交站)', category: '公交车站', support_bucket: '交通出行' },
            { name: '名医堂', category: '医疗保健服务场所', support_bucket: '医疗健康' }
          ],
          population_metrics: {
            avg_density: 43519,
            density_level: 'high',
            high_density_cell_ratio: 0.6667
          }
        }
      ]
    })

    expect(answer).toContain('**武汉大学**：**零售购物**')
    expect(answer).toContain('**医疗健康**')
    expect(answer).not.toContain('**武汉大学**：**零售购物** 有存在感，更像在承接 **顺手买东西和即时消费**；**餐饮配套**')
  })

  it('prefers task-aware comparison buckets over raw campus-background metrics when both are present', () => {
    const answer = buildSpatialAnswerFallback('比较武汉大学和湖北大学附近的业态差异。', [
      { name: '样本点', category: '便民商店/便利店', distance_m: 12 }
    ], {
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary' },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary' }
      ],
      comparisonRegions: [
        {
          anchor: { place_name: '武汉大学', display_name: '武汉大学', role: 'primary' },
          support_buckets: [
            { bucket: '零售购物', count: 5, examples: ['轩轩副食'] },
            { bucket: '餐饮配套', count: 4, examples: ['瑞幸咖啡'] },
            { bucket: '教育服务', count: 6, examples: ['武汉大学'] }
          ],
          support_bucket_metrics: [
            { bucket: '教育服务', count: 6, share: 0.4, share_pct: 40 },
            { bucket: '零售购物', count: 5, share: 0.3333, share_pct: 33 },
            { bucket: '餐饮配套', count: 4, share: 0.2667, share_pct: 27 }
          ],
          population_metrics: {
            avg_density: 26000,
            density_level: 'high'
          }
        },
        {
          anchor: { place_name: '湖北大学', display_name: '湖北大学', role: 'secondary' },
          support_buckets: [
            { bucket: '餐饮配套', count: 6, examples: ['芊烨餐馆'] },
            { bucket: '零售购物', count: 5, examples: ['便利店'] },
            { bucket: '教育服务', count: 7, examples: ['湖北大学'] }
          ],
          support_bucket_metrics: [
            { bucket: '教育服务', count: 7, share: 0.3889, share_pct: 39 },
            { bucket: '餐饮配套', count: 6, share: 0.3333, share_pct: 33 },
            { bucket: '零售购物', count: 5, share: 0.2778, share_pct: 28 }
          ],
          population_metrics: {
            avg_density: 24000,
            density_level: 'high'
          }
        }
      ]
    })

    expect(answer).toContain('零售购物')
    expect(answer).toContain('餐饮配套')
    expect(answer).not.toContain('**武汉大学** 的 **教育服务**')
    expect(answer).not.toContain('**湖北大学** 的 **教育服务**')
  })

  it('translates support-gap evidence into living-circle language instead of count-report language', () => {
    const answer = buildSpatialAnswerFallback('请分析武汉大学附近的配套、热门业态和明显缺口。', [
      { name: '轩轩副食', category: '便民商店/便利店', distance_m: 12 },
      { name: '瑞幸咖啡', category: '咖啡', distance_m: 18 },
      { name: '武汉大学医院', category: '综合医院', distance_m: 36 }
    ], {
      answerType: 'support_gap_analysis',
      anchorLabel: '武汉大学',
      supportBuckets: [
        { bucket: '教育服务', count: 6, examples: ['武汉大学'] },
        { bucket: '零售购物', count: 5, examples: ['轩轩副食'] },
        { bucket: '餐饮配套', count: 4, examples: ['瑞幸咖啡'] },
        { bucket: '医疗健康', count: 2, examples: ['武汉大学医院'] }
      ],
      supportBucketMetrics: [
        { bucket: '教育服务', count: 6, share: 0.35, share_pct: 35 },
        { bucket: '零售购物', count: 5, share: 0.29, share_pct: 29 },
        { bucket: '餐饮配套', count: 4, share: 0.24, share_pct: 24 },
        { bucket: '医疗健康', count: 2, share: 0.12, share_pct: 12 }
      ],
      representativePois: [
        { name: '轩轩副食', category: '便民商店/便利店', support_bucket: '零售购物' },
        { name: '瑞幸咖啡', category: '咖啡', support_bucket: '餐饮配套' },
        { name: '武汉大学医院', category: '综合医院', support_bucket: '医疗健康' }
      ],
      populationMetrics: {
        avg_density: 28500,
        density_level: 'high',
        high_density_cell_ratio: 0.5
      }
    })

    expect(answer).toContain('生活圈')
    expect(answer).toMatch(/人流|活跃|日常/)
    expect(answer).not.toContain('当前命中 5 处')
    expect(answer).not.toContain('出现 2 次')
  })

  it('ranks support-gap priorities instead of stopping at a generic direction when daily consumer signals are already mature', () => {
    const answer = buildSpatialAnswerFallback('请分析武汉大学附近的配套、热门业态和明显缺口。', [
      { name: '轩轩副食', category: '便民商店/便利店', distance_m: 12 },
      { name: '瑞幸咖啡', category: '咖啡', distance_m: 18 },
      { name: '一点点', category: '奶茶', distance_m: 26 },
      { name: '芊烨餐馆', category: '中国菜', distance_m: 31 }
    ], {
      answerType: 'support_gap_analysis',
      anchorLabel: '武汉大学',
      supportBuckets: [
        { bucket: '教育服务', count: 7, examples: ['武汉大学'] },
        { bucket: '零售购物', count: 5, examples: ['轩轩副食'] },
        { bucket: '餐饮配套', count: 4, examples: ['瑞幸咖啡', '一点点'] },
        { bucket: '交通出行', count: 3, examples: ['武汉大学站'] }
      ],
      supportBucketMetrics: [
        { bucket: '教育服务', count: 7, share: 0.3684, share_pct: 37 },
        { bucket: '零售购物', count: 5, share: 0.2632, share_pct: 26 },
        { bucket: '餐饮配套', count: 4, share: 0.2105, share_pct: 21 },
        { bucket: '交通出行', count: 3, share: 0.1579, share_pct: 16 }
      ],
      representativePois: [
        { name: '轩轩副食', category: '便民商店/便利店', support_bucket: '零售购物' },
        { name: '瑞幸咖啡', category: '咖啡', support_bucket: '餐饮配套' },
        { name: '一点点', category: '奶茶', support_bucket: '餐饮配套' },
        { name: '武汉大学站', category: '公交车站', support_bucket: '交通出行' }
      ],
      populationMetrics: {
        avg_density: 24800,
        density_level: 'high',
        high_density_cell_ratio: 0.52
      }
    })

    expect(answer).toContain('第一优先')
    expect(answer).toContain('第二优先')
    expect(answer).toContain('**休闲娱乐**')
    expect(answer).toContain('**生活服务**')
    expect(answer).not.toContain('继续往品牌层、细分人群和步行圈深挖')
  })

  it('keeps support-gap ranking conservative when evidence is too sparse', () => {
    const answer = buildSpatialAnswerFallback('请分析湖北大学附近的配套、热门业态和明显缺口。', [
      { name: '样本点', category: '未分类', distance_m: 88 }
    ], {
      answerType: 'support_gap_analysis',
      anchorLabel: '湖北大学',
      supportBuckets: [
        { bucket: '教育服务', count: 4, examples: ['湖北大学'] },
        { bucket: '餐饮配套', count: 1, examples: ['一家面馆'] }
      ],
      supportBucketMetrics: [
        { bucket: '教育服务', count: 4, share: 0.8, share_pct: 80 },
        { bucket: '餐饮配套', count: 1, share: 0.2, share_pct: 20 }
      ],
      uncertainty: {
        sample_size: 1,
        low_sample_warning: true,
        evidence_density: 'low'
      }
    })

    expect(answer).toContain('第一优先先补查')
    expect(answer).toContain('暂时不建议直接把它当成明确缺口')
    expect(answer).not.toContain('还没有完全成型')
  })

  it('short-circuits dual-anchor comparison answers to deterministic comparison output when structured comparison evidence is available', async () => {
    const streamImpl = vi.fn(async () => '不应该走到这里')
    const onChunk = vi.fn()

    const answer = await generateAnswerStream('比较武汉大学和湖北大学附近的业态差异。', [
      { name: '武汉大学医院', category: '综合医院', distance_m: 12 },
      { name: '芊烨餐馆', category: '中国菜', distance_m: 18 }
    ], onChunk, {
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchorLabel: '武汉大学',
      anchors: [
        { placeName: '武汉大学', displayName: '武汉大学', role: 'primary' },
        { placeName: '湖北大学', displayName: '湖北大学', role: 'secondary' }
      ],
      comparisonRegions: [
        {
          anchor: {
            display_name: '武汉大学',
            role: 'primary'
          },
          support_buckets: [
            { bucket: '零售购物', count: 3 }
          ],
          representative_pois: [
            { name: '轩轩副食', category: '便民商店/便利店' }
          ],
          uncertainty: {
            sample_size: 4
          }
        },
        {
          anchor: {
            display_name: '湖北大学',
            role: 'secondary'
          },
          support_buckets: [
            { bucket: '餐饮配套', count: 4 }
          ],
          representative_pois: [
            { name: '芊烨餐馆', category: '中国菜' }
          ],
          uncertainty: {
            sample_size: 4
          }
        }
      ],
      streamImpl
    })

    expect(streamImpl).not.toHaveBeenCalled()
    expect(answer).toContain('### 对比结论')
    expect(answer).toContain('### 各自特点')
    expect(answer).toContain('### 选择建议')
    expect(answer).not.toContain('还没有形成“双区域分别取证、再并列比较”的完整证据')
    expect(onChunk).toHaveBeenCalledWith(answer)
  })
})
