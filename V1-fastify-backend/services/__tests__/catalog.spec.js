import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database.js', () => ({
  default: {
    query: vi.fn()
  }
}))

import db from '../database.js'
import { buildCategoryTree, getCategoryTreeFromDB } from '../catalog.js'

describe('buildCategoryTree', () => {
  it('aggregates counts from pois rows and sorts nodes by real database distribution', () => {
    const tree = buildCategoryTree([
      { big: '生活服务', mid: '餐饮服务', small: '中餐厅', count: 12 },
      { big: '生活服务', mid: '餐饮服务', small: '咖啡厅', count: 5 },
      { big: '交通设施', mid: '公交设施', small: '公交站', count: 20 }
    ])

    expect(tree).toEqual([
      {
        value: '交通设施',
        label: '交通设施',
        count: 20,
        children: [
          {
            value: '公交设施',
            label: '公交设施',
            count: 20,
            children: [
              { value: '公交站', label: '公交站', count: 20 }
            ]
          }
        ]
      },
      {
        value: '生活服务',
        label: '生活服务',
        count: 17,
        children: [
          {
            value: '餐饮服务',
            label: '餐饮服务',
            count: 17,
            children: [
              { value: '中餐厅', label: '中餐厅', count: 12 },
              { value: '咖啡厅', label: '咖啡厅', count: 5 }
            ]
          }
        ]
      }
    ])
  })
})

describe('getCategoryTreeFromDB', () => {
  beforeEach(() => {
    db.query.mockReset()
  })

  it('returns category tree directly from public.pois rows', async () => {
    db.query.mockResolvedValue({
      rows: [
        { big: '生活服务', mid: '餐饮服务', small: '中餐厅', count: 8 },
        { big: '教育科研', mid: '高等院校', small: '大学', count: 3 }
      ]
    })

    const tree = await getCategoryTreeFromDB()

    expect(db.query).toHaveBeenCalledTimes(1)
    expect(db.query.mock.calls[0][0]).toContain('FROM public.pois')
    expect(tree).toHaveLength(2)
    expect(tree[0]).toMatchObject({ value: '生活服务', count: 8 })
  })

  it('returns empty tree when pois table has no rows instead of falling back to legacy static catalog', async () => {
    db.query.mockResolvedValue({ rows: [] })

    const tree = await getCategoryTreeFromDB()

    expect(tree).toEqual([])
  })
})
