import { describe, expect, it } from 'vitest'

import { buildSpatialGeometryEvidence } from '../../retrieval/spatialEvidenceService.js'

function polygon(coords) {
  return {
    type: 'Polygon',
    coordinates: [coords]
  }
}

describe('spatialEvidenceService vector surface constraints', () => {
  it('prefers encoder-supported road block surfaces over unconstrained point hulls when vector candidates are available', () => {
    const filteredResults = [
      {
        id: 1,
        name: 'Core 1',
        regionLabel: 1,
        lon: 114.3006,
        lat: 30.5006,
        fused_score: 0.94,
        spatial_score: 0.95,
        semantic_score: 0.91
      },
      {
        id: 2,
        name: 'Core 2',
        regionLabel: 1,
        lon: 114.3018,
        lat: 30.5014,
        fused_score: 0.92,
        spatial_score: 0.93,
        semantic_score: 0.9
      },
      {
        id: 3,
        name: 'Core 3',
        regionLabel: 1,
        lon: 114.3062,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.88
      },
      {
        id: 4,
        name: 'Outlier 1',
        regionLabel: 1,
        lon: 114.3400,
        lat: 30.5350,
        fused_score: 0.28,
        spatial_score: 0.28,
        semantic_score: 0.25
      },
      {
        id: 5,
        name: 'Outlier 2',
        regionLabel: 1,
        lon: 114.3410,
        lat: 30.5360,
        fused_score: 0.26,
        spatial_score: 0.26,
        semantic_score: 0.24
      }
    ]

    const roadBlocks = [
      {
        block_id: 11,
        geometry_geojson: polygon([
          [114.3000, 30.5000],
          [114.3040, 30.5000],
          [114.3040, 30.5040],
          [114.3000, 30.5040],
          [114.3000, 30.5000]
        ])
      },
      {
        block_id: 12,
        geometry_geojson: polygon([
          [114.3040, 30.5000],
          [114.3080, 30.5000],
          [114.3080, 30.5040],
          [114.3040, 30.5040],
          [114.3040, 30.5000]
        ])
      },
      {
        block_id: 99,
        geometry_geojson: polygon([
          [114.3390, 30.5340],
          [114.3435, 30.5340],
          [114.3435, 30.5385],
          [114.3390, 30.5385],
          [114.3390, 30.5340]
        ])
      }
    ]

    const evidence = buildSpatialGeometryEvidence({
      filteredResults,
      explicitBoundary: null,
      anchor: { lon: 114.304, lat: 30.502, source: 'test' },
      surfaceContext: {
        roadBlocks,
        osmAoiFeatures: [],
        eulucFeatures: []
      }
    })

    expect(evidence.boundary).toMatchObject({
      type: 'FeatureCollection',
      features: expect.any(Array)
    })
    expect(evidence.boundary.features).toHaveLength(2)
    expect(evidence.boundary.features.map((feature) => feature.properties.block_id)).toEqual([11, 12])
    expect(evidence.boundaryMethod).toBe('road_block_support_v1')
    expect(evidence.vectorConstraintSummary).toMatchObject({
      source: 'road_blocks',
      selected_count: 2,
      rejected_count: 1
    })
  })

  it('rescales refined boundary confidence with surface support and post-clip coverage instead of using a fixed rule value', () => {
    const filteredResults = [
      {
        id: 11,
        name: 'Refined A',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3008,
        lat: 30.5008,
        fused_score: 0.94,
        spatial_score: 0.95,
        semantic_score: 0.9,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.88
        }
      },
      {
        id: 12,
        name: 'Refined B',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3058,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.84
        }
      },
      {
        id: 13,
        name: 'Refined C',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3044,
        lat: 30.5032,
        fused_score: 0.88,
        spatial_score: 0.89,
        semantic_score: 0.84,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.82
        }
      },
      {
        id: 14,
        name: 'Refined D',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3020,
        lat: 30.5024,
        fused_score: 0.86,
        spatial_score: 0.87,
        semantic_score: 0.82,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.8
        }
      }
    ]

    const baseConstraint = {
      source: 'road_blocks',
      method: 'road_block_support_v1_postgis',
      boundary: polygon([
        [114.3000, 30.5000],
        [114.3080, 30.5000],
        [114.3080, 30.5040],
        [114.3000, 30.5040],
        [114.3000, 30.5000]
      ]),
      outerBoundary: polygon([
        [114.2995, 30.4995],
        [114.3085, 30.4995],
        [114.3085, 30.5045],
        [114.2995, 30.5045],
        [114.2995, 30.4995]
      ]),
      transitionBoundary: polygon([
        [114.3002, 30.5001],
        [114.3078, 30.5001],
        [114.3078, 30.5039],
        [114.3002, 30.5039],
        [114.3002, 30.5001]
      ]),
      coreBoundary: polygon([
        [114.3010, 30.5005],
        [114.3070, 30.5005],
        [114.3070, 30.5033],
        [114.3010, 30.5033],
        [114.3010, 30.5005]
      ]),
      selectedCount: 2,
      rejectedCount: 0,
      selectedIds: [11, 12]
    }

    const highEvidence = buildSpatialGeometryEvidence({
      filteredResults,
      explicitBoundary: null,
      anchor: { lon: 114.304, lat: 30.502, source: 'test' },
      surfaceConstraint: {
        ...baseConstraint,
        supportSummary: {
          score: 0.92,
          weighted_support: 0.9,
          core_support: 0.95
        },
        clipSummary: {
          coverage: 0.94,
          outer_coverage: 0.96,
          transition_coverage: 0.94,
          core_coverage: 0.88
        }
      }
    })

    const lowEvidence = buildSpatialGeometryEvidence({
      filteredResults,
      explicitBoundary: null,
      anchor: { lon: 114.304, lat: 30.502, source: 'test' },
      surfaceConstraint: {
        ...baseConstraint,
        supportSummary: {
          score: 0.31,
          weighted_support: 0.28,
          core_support: 0.34
        },
        clipSummary: {
          coverage: 0.42,
          outer_coverage: 0.45,
          transition_coverage: 0.42,
          core_coverage: 0.38
        }
      }
    })

    expect(highEvidence.boundaryConfidenceModel).toBe('v3_encoder_surface_confidence_v2')
    expect(highEvidence.vectorConstraintSummary).toMatchObject({
      surface_support_score: 0.92,
      clip_coverage: 0.94
    })
    expect(highEvidence.fuzzyRegions[0].signal_summary.boundary_confidence_components).toMatchObject({
      encoder_consistency: expect.any(Number),
      surface_support: 0.92,
      clip_coverage: 0.94
    })
    expect(highEvidence.fuzzyRegions[0].boundary_confidence).toBeGreaterThan(lowEvidence.fuzzyRegions[0].boundary_confidence)
    expect(highEvidence.avgBoundaryConfidence).toBeGreaterThan(lowEvidence.avgBoundaryConfidence)
  })

  it('penalizes refined boundary confidence when encoder consistency drops even if the refined surface support stays the same', () => {
    const stableConstraint = {
      source: 'road_blocks',
      method: 'road_block_support_v1_postgis',
      boundary: polygon([
        [114.3000, 30.5000],
        [114.3080, 30.5000],
        [114.3080, 30.5040],
        [114.3000, 30.5040],
        [114.3000, 30.5000]
      ]),
      outerBoundary: polygon([
        [114.2995, 30.4995],
        [114.3085, 30.4995],
        [114.3085, 30.5045],
        [114.2995, 30.5045],
        [114.2995, 30.4995]
      ]),
      transitionBoundary: polygon([
        [114.3002, 30.5001],
        [114.3078, 30.5001],
        [114.3078, 30.5039],
        [114.3002, 30.5039],
        [114.3002, 30.5001]
      ]),
      coreBoundary: polygon([
        [114.3010, 30.5005],
        [114.3070, 30.5005],
        [114.3070, 30.5033],
        [114.3010, 30.5033],
        [114.3010, 30.5005]
      ]),
      selectedCount: 2,
      rejectedCount: 0,
      selectedIds: [11, 12],
      supportSummary: {
        score: 0.86,
        weighted_support: 0.83,
        core_support: 0.89
      },
      clipSummary: {
        coverage: 0.91,
        outer_coverage: 0.94,
        transition_coverage: 0.91,
        core_coverage: 0.86
      }
    }

    const consistentResults = [
      {
        id: 21,
        name: 'Consistent A',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3008,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.9
        }
      },
      {
        id: 22,
        name: 'Consistent B',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3058,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.88
        }
      },
      {
        id: 23,
        name: 'Consistent C',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3044,
        lat: 30.5032,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.86
        }
      },
      {
        id: 24,
        name: 'Consistent D',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3020,
        lat: 30.5024,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.84
        }
      }
    ]

    const inconsistentResults = [
      {
        id: 31,
        name: 'Inconsistent A',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3008,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 5,
          region_confidence: 0.9
        }
      },
      {
        id: 32,
        name: 'Inconsistent B',
        category: 'coffee',
        regionLabel: 5,
        lon: 114.3058,
        lat: 30.5008,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.88
        }
      },
      {
        id: 33,
        name: 'Inconsistent C',
        category: 'coffee',
        regionLabel: 1,
        lon: 114.3044,
        lat: 30.5032,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 5,
          region_confidence: 0.86
        }
      },
      {
        id: 34,
        name: 'Inconsistent D',
        category: 'coffee',
        regionLabel: 5,
        lon: 114.3020,
        lat: 30.5024,
        fused_score: 0.9,
        spatial_score: 0.9,
        semantic_score: 0.86,
        spatial_info: {
          region_idx: 1,
          region_confidence: 0.84
        }
      }
    ]

    const consistentEvidence = buildSpatialGeometryEvidence({
      filteredResults: consistentResults,
      explicitBoundary: null,
      anchor: { lon: 114.304, lat: 30.502, source: 'test' },
      surfaceConstraint: stableConstraint
    })

    const inconsistentEvidence = buildSpatialGeometryEvidence({
      filteredResults: inconsistentResults,
      explicitBoundary: null,
      anchor: { lon: 114.304, lat: 30.502, source: 'test' },
      surfaceConstraint: stableConstraint
    })

    expect(
      consistentEvidence.fuzzyRegions[0].signal_summary.boundary_confidence_components.encoder_consistency
    ).toBeGreaterThan(
      inconsistentEvidence.fuzzyRegions[0].signal_summary.boundary_confidence_components.encoder_consistency
    )
    expect(consistentEvidence.fuzzyRegions[0].boundary_confidence).toBeGreaterThan(
      inconsistentEvidence.fuzzyRegions[0].boundary_confidence
    )
  })
})
