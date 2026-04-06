import { describe, expect, it } from 'vitest'

import {
  buildCategoryTree,
  boundsToWKT,
  expandSearchTerms,
  isSimpleQuery,
  toSpatialPoiFeature
} from '../../data/frontendDataService.js'

describe('frontendDataService category tree', () => {
  it('builds sorted category tree with counts', () => {
    const tree = buildCategoryTree([
      { big: '生活服务', mid: '餐饮服务', small: '中餐厅', count: 12 },
      { big: '生活服务', mid: '餐饮服务', small: '咖啡厅', count: 3 },
      { big: '交通设施', mid: '公交设施', small: '公交站', count: 18 }
    ])

    expect(tree[0]).toMatchObject({ value: '交通设施', count: 18 })
    expect(tree[1]).toMatchObject({ value: '生活服务', count: 15 })
    expect(tree[1].children[0].children[0]).toMatchObject({ value: '中餐厅', count: 12 })
  })
})

describe('frontendDataService spatial helpers', () => {
  it('converts bounds to WKT polygon', () => {
    expect(boundsToWKT([114.3, 30.5, 114.4, 30.6]))
      .toBe('POLYGON((114.3 30.5, 114.4 30.5, 114.4 30.6, 114.3 30.6, 114.3 30.5))')
  })

  it('maps poi row to feature payload expected by frontend', () => {
    expect(toSpatialPoiFeature({
      id: 1,
      name: '湖北大学',
      address: '武汉市武昌区友谊大道368号',
      category_big: '教育科研',
      category_mid: '高等院校',
      category_small: '大学',
      lon: 114.35,
      lat: 30.56
    })).toMatchObject({
      type: 'Feature',
      properties: {
        '名称': '湖北大学',
        '大类': '教育科研',
        '中类': '高等院校',
        '小类': '大学'
      }
    })
  })
})

describe('frontendDataService quick search heuristics', () => {
  it('expands known category synonyms', () => {
    expect(expandSearchTerms('星巴克')).toContain('咖啡')
  })

  it('marks complex natural language as non-simple query', () => {
    expect(isSimpleQuery('附近有什么好吃的')).toBe(false)
    expect(isSimpleQuery('咖啡')).toBe(true)
  })
})
