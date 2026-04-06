import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDependencyAdapterServer,
  createJsonRequestHandler,
  resolveVectorCacheFile,
  selectBestAnchorCandidate,
} from '../lib/v4-dependency-adapter.js'

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('server address unavailable')
  }
  return `http://127.0.0.1:${address.port}`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createJsonRequestHandler', () => {
  it('rejects invalid JSON payloads with a 400 response', async () => {
    const writeHead = vi.fn()
    const end = vi.fn()
    const handler = createJsonRequestHandler(async () => ({ ok: true }))

    await handler({
      on(event, callback) {
        if (event === 'data') callback(Buffer.from('{invalid'))
        if (event === 'end') callback()
      },
    }, { writeHead, end })

    expect(writeHead).toHaveBeenCalledWith(400, expect.objectContaining({
      'Content-Type': 'application/json; charset=utf-8',
    }))
    expect(end).toHaveBeenCalledWith(JSON.stringify({
      error: 'invalid_json',
    }))
  })
})

describe('createDependencyAdapterServer', () => {
  it('detects the V3 embeddings cache when the root cache directory is absent', () => {
    const cacheFile = resolveVectorCacheFile({
      rootDir: 'D:/AAA_Edu/TagCloud/vite-project',
      exists(filepath) {
        return String(filepath).replace(/\\/g, '/').endsWith('/V3-GeoEncoder-RAG/cache/embeddings.bin')
      },
    })

    expect(String(cacheFile).replace(/\\/g, '/')).toBe('D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/cache/embeddings.bin')
  })

  it('prefers the dominant education anchor cluster even when an off-cluster exact match appears first', () => {
    const selected = selectBestAnchorCandidate([
      {
        id: 99,
        name: '武汉大学',
        category_sub: '学校',
        lon: 114.313264,
        lat: 30.654145,
      },
      {
        id: 1,
        name: '武汉大学',
        category_sub: '学校',
        lon: 114.364339,
        lat: 30.536334,
      },
      {
        id: 2,
        name: '武汉大学',
        category_sub: '学校',
        lon: 114.364339,
        lat: 30.536334,
      },
      {
        id: 3,
        name: '武汉大学',
        category_sub: '学校',
        lon: 114.223461,
        lat: 30.559571,
      },
      {
        id: 4,
        name: '武汉大学',
        category_sub: '学校',
        lon: 114.364339,
        lat: 30.536334,
      },
      {
        id: 5,
        name: '武汉大学',
        category_sub: '学校',
        lon: 114.364339,
        lat: 30.536334,
      },
      {
        id: 6,
        name: '武汉大学',
        category_sub: '学校',
        lon: 114.364339,
        lat: 30.536334,
      },
      {
        id: 7,
        name: '武汉大学工会',
        category_sub: '社会团体',
        lon: 114.364719,
        lat: 30.532994,
      },
    ], '武汉大学')

    expect(selected).toEqual(expect.objectContaining({
      id: 1,
      lon: 114.364339,
      lat: 30.536334,
    }))
  })

  it('prefers the best-supported campus cluster over isolated exact matches', () => {
    const selected = selectBestAnchorCandidate([
      {
        id: 1,
        name: '湖北大学',
        category_sub: '科教文化场所',
        lon: 114.267624,
        lat: 30.58676,
      },
      {
        id: 2,
        name: '湖北大学',
        category_sub: '科教文化场所',
        lon: 114.343526,
        lat: 30.522367,
      },
      {
        id: 3,
        name: '湖北大学-教1',
        category_sub: '学校',
        lon: 114.33249,
        lat: 30.579311,
      },
      {
        id: 4,
        name: '湖北大学-教2',
        category_sub: '学校',
        lon: 114.331658,
        lat: 30.578546,
      },
      {
        id: 5,
        name: '湖北大学-教3',
        category_sub: '学校',
        lon: 114.331183,
        lat: 30.576679,
      },
      {
        id: 6,
        name: '湖北大学图书馆',
        category_sub: '图书馆',
        lon: 114.33465,
        lat: 30.578837,
      },
      {
        id: 7,
        name: '湖北大学停车场',
        category_sub: '停车场',
        lon: 114.332809,
        lat: 30.578207,
      },
      {
        id: 8,
        name: '湖北大学站',
        category_sub: '地铁站',
        lon: 114.329484,
        lat: 30.577279,
      },
    ], '湖北大学')

    expect(selected).toBeTruthy()
    expect(selected.lon).toBeGreaterThan(114.329)
    expect(selected.lon).toBeLessThan(114.336)
    expect(selected.lat).toBeGreaterThan(30.576)
    expect(selected.lat).toBeLessThan(30.58)
  })

  it('serves remote semantic POI candidates with the V4 bridge contract', async () => {
    const server = createDependencyAdapterServer({
      services: {
        async getHealth() {
          return {
            status: 'ok',
            dependencies: {
              vector: { ready: true },
            },
          }
        },
        async searchSemanticPois({ text, topK }) {
          expect(text).toBe('武汉大学附近咖啡店')
          expect(topK).toBe(3)
          return [
            { id: 'poi_remote_001', name: '远程咖啡馆', category: '咖啡', score: 0.97 },
          ]
        },
        async searchSimilarRegions() {
          return []
        },
        async getRouteEstimate() {
          return {
            distance_m: 800,
            duration_min: 10,
            degraded: false,
            degraded_reason: null,
          }
        },
      },
    })

    try {
      const baseUrl = await listen(server)
      const response = await fetch(`${baseUrl}/search/semantic-pois`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: '武汉大学附近咖啡店',
          top_k: 3,
        }),
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        candidates: [
          { id: 'poi_remote_001', name: '远程咖啡馆', category: '咖啡', score: 0.97 },
        ],
      })
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('serves similar-region and route responses with normalized JSON payloads', async () => {
    const server = createDependencyAdapterServer({
      services: {
        async getHealth() {
          return {
            status: 'partial',
            dependencies: {
              vector: { ready: true },
              routing: { ready: true, provider: 'osrm_public' },
            },
          }
        },
        async searchSemanticPois() {
          return []
        },
        async searchSimilarRegions({ text, topK }) {
          expect(text).toBe('和武汉大学周边气质相似的片区')
          expect(topK).toBe(2)
          return [
            {
              id: 'cell_001',
              name: '街道口-武大商圈',
              summary: '高校氛围明显，咖啡与轻餐集中',
              score: 0.91,
            },
          ]
        },
        async getRouteEstimate({ origin, destination, mode }) {
          expect(origin).toEqual([114.364339, 30.536334])
          expect(destination).toEqual([114.355, 30.54])
          expect(mode).toBe('walking')
          return {
            distance_m: 1280,
            duration_min: 17,
            degraded: true,
            degraded_reason: 'public_demo_provider',
          }
        },
      },
    })

    try {
      const baseUrl = await listen(server)

      const regionsResponse = await fetch(`${baseUrl}/search/similar-regions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: '和武汉大学周边气质相似的片区',
          top_k: 2,
        }),
      })

      expect(regionsResponse.status).toBe(200)
      await expect(regionsResponse.json()).resolves.toEqual({
        regions: [
          {
            id: 'cell_001',
            name: '街道口-武大商圈',
            summary: '高校氛围明显，咖啡与轻餐集中',
            score: 0.91,
          },
        ],
      })

      const routeResponse = await fetch(`${baseUrl}/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin: [114.364339, 30.536334],
          destination: [114.355, 30.54],
          mode: 'walking',
        }),
      })

      expect(routeResponse.status).toBe(200)
      await expect(routeResponse.json()).resolves.toEqual({
        distance_m: 1280,
        duration_min: 17,
        degraded: true,
        degraded_reason: 'public_demo_provider',
      })

      const healthResponse = await fetch(`${baseUrl}/health`)
      expect(healthResponse.status).toBe(200)
      await expect(healthResponse.json()).resolves.toEqual({
        status: 'partial',
        dependencies: {
          vector: { ready: true },
          routing: { ready: true, provider: 'osrm_public' },
        },
      })
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
