import { describe, expect, it } from 'vitest'

import { buildSurfaceQueryWkt, refineSurfaceConstraintGeometry } from '../../data/surfaceDataService.js'

describe('surfaceDataService query geometry helpers', () => {
  it('uses the explicit selection polygon before any derived result bbox', () => {
    const wkt = buildSurfaceQueryWkt({
      spatialContext: {
        boundary: [
          [114.30, 30.50],
          [114.36, 30.50],
          [114.36, 30.54],
          [114.30, 30.54]
        ]
      },
      filteredResults: [
        { lon: 114.31, lat: 30.51 },
        { lon: 114.32, lat: 30.52 }
      ]
    })

    expect(wkt).toBe('POLYGON((114.3 30.5, 114.36 30.5, 114.36 30.54, 114.3 30.54, 114.3 30.5))')
  })

  it('falls back to a padded bbox around filtered V3 results when no explicit boundary is present', () => {
    const wkt = buildSurfaceQueryWkt({
      spatialContext: null,
      filteredResults: [
        { lon: 114.3000, lat: 30.5000 },
        { lon: 114.3050, lat: 30.5040 },
        { lon: 114.3040, lat: 30.5010 }
      ]
    })

    expect(typeof wkt).toBe('string')
    expect(wkt.startsWith('POLYGON((')).toBe(true)
    expect(wkt).toContain('114.299')
    expect(wkt).toContain('30.499')
  })

  it('ignores a null boundary and falls back to viewport geometry from the UI payload', () => {
    const wkt = buildSurfaceQueryWkt({
      spatialContext: {
        boundary: null,
        viewport: [114.24, 30.52, 114.43, 30.63]
      },
      filteredResults: []
    })

    expect(wkt).toBe('POLYGON((114.24 30.52, 114.43 30.52, 114.43 30.63, 114.24 30.63, 114.24 30.52))')
  })

  it('uses PostGIS union and clip results to produce tightened polygon layers from selected vector faces', async () => {
    const dbQuery = async (sql, params) => {
      expect(sql).toContain('ST_UnaryUnion')
      expect(sql).toContain('ST_Intersection')
      expect(params[0]).toBe('POLYGON((114.3 30.5, 114.36 30.5, 114.36 30.54, 114.3 30.54, 114.3 30.5))')
      return {
        rows: [
          {
            outer_geojson: {
              type: 'Polygon',
              coordinates: [[[114.3000, 30.5000], [114.3080, 30.5000], [114.3080, 30.5040], [114.3000, 30.5040], [114.3000, 30.5000]]]
            },
            outer_clip_coverage: 0.96,
            transition_geojson: {
              type: 'Polygon',
              coordinates: [[[114.3005, 30.5002], [114.3075, 30.5002], [114.3075, 30.5038], [114.3005, 30.5038], [114.3005, 30.5002]]]
            },
            transition_clip_coverage: 0.91,
            core_geojson: {
              type: 'Polygon',
              coordinates: [[[114.3010, 30.5005], [114.3070, 30.5005], [114.3070, 30.5033], [114.3010, 30.5033], [114.3010, 30.5005]]]
            },
            core_clip_coverage: 0.82
          }
        ]
      }
    }

    const refined = await refineSurfaceConstraintGeometry({
      queryWkt: 'POLYGON((114.3 30.5, 114.36 30.5, 114.36 30.54, 114.3 30.54, 114.3 30.5))',
      constraint: {
        source: 'road_blocks',
        method: 'road_block_support_v1',
        outerSelectedIds: [11, 12],
        transitionSelectedIds: [11, 12],
        coreSelectedIds: [12],
        supportSummary: {
          score: 0.88,
          weighted_support: 0.84,
          core_support: 0.91
        },
        selectedCount: 2,
        rejectedCount: 1,
        selectedIds: [11, 12]
      },
      dbQuery
    })

    expect(refined).toMatchObject({
      source: 'road_blocks',
      method: 'road_block_support_v1_postgis',
      boundary: { type: 'Polygon' },
      outerBoundary: { type: 'Polygon' },
      transitionBoundary: { type: 'Polygon' },
      coreBoundary: { type: 'Polygon' },
      supportSummary: {
        score: 0.88,
        weighted_support: 0.84,
        core_support: 0.91
      },
      clipSummary: {
        coverage: 0.91,
        outer_coverage: 0.96,
        transition_coverage: 0.91,
        core_coverage: 0.82
      }
    })
  })
})
