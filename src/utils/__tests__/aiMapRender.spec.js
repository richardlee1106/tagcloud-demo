import { describe, expect, it } from 'vitest'

import {
  hasCoordinateMatch,
  normalizeAiMapFeature,
  readCoordinatePair,
  readCoordSys,
} from '../aiMapRender.js'

describe('aiMapRender', () => {
  it('normalizes backend rows with longitude and latitude', () => {
    const feature = normalizeAiMapFeature({
      name: '瑞幸咖啡',
      longitude: '114.36512',
      latitude: '30.54321',
      category: '咖啡',
    })

    expect(feature).toMatchObject({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [114.36512, 30.54321],
      },
      properties: {
        名称: '瑞幸咖啡',
        category: '咖啡',
        _source: 'ai_tagcloud',
      },
    })
  })

  it('supports nested coordinate containers and preserves coord sys metadata', () => {
    const feature = normalizeAiMapFeature({
      displayName: '湖北大学站 A 口',
      location: {
        lng: 114.3123,
        lat: 30.5812,
      },
      coord_sys: 'gcj02',
    }, {
      defaultSource: 'evidence_locate',
    })

    expect(feature).toMatchObject({
      geometry: {
        coordinates: [114.3123, 30.5812],
      },
      properties: {
        名称: '湖北大学站 A 口',
        _source: 'evidence_locate',
        _coordSys: 'gcj02',
      },
    })
  })

  it('keeps zero coordinates valid instead of treating them as empty', () => {
    const feature = normalizeAiMapFeature({
      name: 'Zero Point',
      longitude: 0,
      latitude: 0,
    })

    expect(feature?.geometry?.coordinates).toEqual([0, 0])
  })

  it('detects coordinate matches across mixed payload shapes', () => {
    expect(hasCoordinateMatch({
      longitude: 114.36512,
      latitude: 30.54321,
    }, 114.36512, 30.54321)).toBe(true)

    expect(hasCoordinateMatch({
      geometry: {
        coordinates: ['114.36512', '30.54321'],
      },
    }, 114.36512, 30.54321)).toBe(true)
  })

  it('reads coordinates and coord sys from feature properties', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [114.3, 30.5],
      },
      properties: {
        _coordSys: 'wgs84',
      },
    }

    expect(readCoordinatePair(feature)).toEqual([114.3, 30.5])
    expect(readCoordSys(feature)).toBe('wgs84')
  })
})
