import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryMock = vi.fn()

vi.mock('../../data/database.js', () => ({
  query: queryMock
}))

describe('frontendDataService quickSearchPois', () => {
  beforeEach(() => {
    queryMock.mockReset()
    vi.resetModules()
  })

  it('does not treat null coordinates as a real search center', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    const { quickSearchPois } = await import('../../data/frontendDataService.js')
    await quickSearchPois({ queryText: '湖北大学', limit: 8 })

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).not.toContain('ST_DWithin')
    expect(sql).not.toContain('ST_MakePoint($1, $2)')
    expect(params).toEqual(['%湖北大学%', 8])
  })

  it('keeps explicit zero coordinates valid when they are intentionally provided', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    const { quickSearchPois } = await import('../../data/frontendDataService.js')
    await quickSearchPois({ queryText: '测试', lon: 0, lat: 0, radius: 500, limit: 5 })

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).toContain('ST_DWithin')
    expect(params).toEqual([0, 0, '%测试%', 500, 5])
  })

  it('expands abbreviated school names so quick search prefers the canonical school over derivative school names', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          { id: 1, name: '武汉二中学生服务中心', category_big: '生活服务', category_mid: '生活服务场所', category_small: '生活服务场所', lon: 114.308579, lat: 30.605369 },
          { id: 2, name: '武汉二中广雅中学', category_big: '科教文化服务', category_mid: '学校', category_small: '学校', lon: 114.311398, lat: 30.604767 }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 3, name: '武汉第二中学', category_big: '科教文化服务', category_mid: '学校', category_small: '学校', lon: 114.30791, lat: 30.60671 }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 4, name: '武汉市第二中学', category_big: '科教文化服务', category_mid: '学校', category_small: '学校', lon: 114.308002, lat: 30.606691 }
        ]
      })

    const { quickSearchPois } = await import('../../data/frontendDataService.js')
    const rows = await quickSearchPois({ queryText: '武汉二中', limit: 8, preferPrefix: true })

    expect(queryMock).toHaveBeenCalledTimes(3)
    expect(rows[0]?.name).toBe('武汉市第二中学')
    expect(rows[1]?.name).toBe('武汉第二中学')
    expect(rows.some((row) => row.name === '武汉二中广雅中学')).toBe(true)
  })
})
