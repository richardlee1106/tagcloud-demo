import { describe, expect, it } from 'vitest'

import { applySemanticSubcategoryFilter, getCategoryConfig, resolveEmbeddingCachePath } from '../../retrieval/faissIndex.js'

describe('faissIndex category mapping', () => {
  it('maps transport categories into database transport facilities', () => {
    expect(getCategoryConfig('交通设施服务')).toMatchObject({
      dbCategories: ['交通设施服务']
    })
    expect(getCategoryConfig('地铁站')).toMatchObject({
      dbCategories: ['交通设施服务']
    })
  })

  it('keeps only coffee-like candidates for coffee subtype filters', () => {
    const filtered = applySemanticSubcategoryFilter([
      { name: 'luckin coffee', category: '咖啡' },
      { name: '健康厨房', category: '中国菜' },
      { name: '星巴克', category: '咖啡' },
      { name: '成都民俗餐馆', category: '中国菜' }
    ], '咖啡')

    expect(filtered.map((item) => item.name)).toEqual(['luckin coffee', '星巴克'])
  })

  it('keeps supermarket-like candidates for 商超 subtype filters', () => {
    const filtered = applySemanticSubcategoryFilter([
      { name: '小欣家超市', category: '便民商店/便利店' },
      { name: 'ELEVEN', category: '便民商店/便利店' },
      { name: '中国移动(复地东湖国际营业厅)', category: '家电电子卖场' },
      { name: 'AG·STYLE旗舰店', category: '服装鞋帽皮具店' },
      { name: '金箭电动车', category: '专卖店' }
    ], '商超')

    expect(filtered.map((item) => item.name)).toEqual(['小欣家超市', 'ELEVEN'])
  })

  it('understands hotpot brands from entity names instead of depending on category labels', () => {
    const filtered = applySemanticSubcategoryFilter([
      { name: '海底捞(街道口店)', category: '餐饮美食' },
      { name: '巴奴毛肚火锅(群光店)', category: '餐饮美食' },
      { name: '外婆家', category: '餐饮美食' },
      { name: '星巴克', category: '咖啡' }
    ], '火锅')

    expect(filtered.map((item) => item.name)).toEqual(['海底捞(街道口店)', '巴奴毛肚火锅(群光店)'])
  })

  it('understands hospital entities from entity names instead of raw field labels', () => {
    const filtered = applySemanticSubcategoryFilter([
      { name: '武汉协和医院', category: '医疗保健服务' },
      { name: '同济医院光谷院区', category: '医疗保健服务' },
      { name: '益丰大药房', category: '医药保健销售店' },
      { name: '湖滨公园', category: '公园广场' }
    ], '医院')

    expect(filtered.map((item) => item.name)).toEqual(['武汉协和医院', '同济医院光谷院区'])
  })

  it('falls back to the V3 cache directory when the current working directory has no embeddings cache', () => {
    const cachePath = resolveEmbeddingCachePath({
      cwd: 'D:/AAA_Edu/TagCloud/vite-project',
      env: {},
      exists(filepath) {
        return String(filepath).replace(/\\/g, '/').endsWith('/V3-GeoEncoder-RAG/cache/embeddings.bin')
      },
    })

    expect(String(cachePath).replace(/\\/g, '/')).toBe('D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/cache/embeddings.bin')
  })
})
