import { describe, expect, it } from 'vitest'

import { createIntentSpecService } from '../../planner_line/intentSpecService.js'

describe('intentSpecService', () => {
  const service = createIntentSpecService()

  it('builds a metro lookup intent spec with a focused transport target and bus noise suppression', () => {
    const spec = service.buildIntentSpec({
      userQuery: '湖北大学附近 1km 内的地铁站'
    })

    expect(spec).toMatchObject({
      task_type: 'lookup',
      spatial_scope: {
        mode: 'anchor_radius',
        radius_m: 1000
      },
      aggregation_mode: 'list',
      ranking_objective: 'distance',
      completeness: 'top_k',
      answer_mode: 'direct_list',
      target_entities: [
        { type: 'transport_node', value: '地铁站' }
      ],
      exclude_entities: [
        { type: 'transport_node', value: '公交车站' }
      ],
      entity_resolution: {
        merge_station_exits: true
      },
      spatial_relation: {
        relation: 'nearby',
        distance_constraint_m: 1000
      },
      evidence_policy: {
        micro_required: true,
        macro_required: false
      },
      needs_clarification: false
    })

    expect(spec.semantic_focus_terms).toContain('地铁站')
    expect(spec.spatial_scope.anchor_refs).toEqual([
      { place_name: '湖北大学', role: 'primary' }
    ])
  })

  it('builds a bus lookup intent spec with metro stations treated as noise', () => {
    const spec = service.buildIntentSpec({
      userQuery: '湖北大学附近 1km 内的公交车站'
    })

    expect(spec).toMatchObject({
      task_type: 'lookup',
      spatial_scope: {
        mode: 'anchor_radius',
        radius_m: 1000
      },
      target_entities: [
        { type: 'transport_node', value: '公交车站' }
      ],
      exclude_entities: [
        { type: 'transport_node', value: '地铁站' }
      ],
      aggregation_mode: 'list',
      ranking_objective: 'distance'
    })
  })

  it('expands public transit queries into a shared transport intent instead of a single-mode lookup', () => {
    const spec = service.buildIntentSpec({
      userQuery: '湖北大学附近的公共交通'
    })

    expect(spec).toMatchObject({
      task_type: 'overview',
      aggregation_mode: 'summary',
      ranking_objective: 'representativeness',
      answer_mode: 'area_portrait',
      target_entities: [
        { type: 'transport_node', value: '地铁站' },
        { type: 'transport_node', value: '公交车站' }
      ],
      exclude_entities: [],
      evidence_policy: {
        micro_required: true,
        macro_required: true
      }
    })

    expect(spec.semantic_focus_terms).toContain('公共交通')
  })

  it('builds an overview spec that requires macro evidence for spatial structure and business mix', () => {
    const spec = service.buildIntentSpec({
      userQuery: '请概览武汉大学附近的空间结构和业态分布'
    })

    expect(spec).toMatchObject({
      task_type: 'overview',
      aggregation_mode: 'summary',
      ranking_objective: 'representativeness',
      answer_mode: 'area_portrait',
      evidence_policy: {
        macro_required: true,
        micro_required: true
      },
      representation_policy: {
        allow_local_shop_as_region_representative: false,
        prefer_public_civic_examples: true
      },
      output_contract: {
        must_avoid: ['unverified_claims'],
        tone: 'analytical'
      }
    })

    expect(spec.semantic_focus_terms).toEqual(
      expect.arrayContaining(['空间结构', '业态分布'])
    )
  })

  it('uses geometry scope directly when the user asks about the drawn area distribution', () => {
    const spec = service.buildIntentSpec({
      userQuery: '这个圈里的业态分布如何',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [114.36, 30.53],
            [114.37, 30.53],
            [114.37, 30.54],
            [114.36, 30.54],
            [114.36, 30.53]
          ]
        ]
      }
    })

    expect(spec).toMatchObject({
      task_type: 'overview',
      spatial_scope: {
        mode: 'geometry',
        geometry_ref: 'inline_geometry',
        radius_m: null
      },
      aggregation_mode: 'distribution',
      ranking_objective: 'representativeness',
      answer_mode: 'area_portrait',
      evidence_policy: {
        macro_required: true,
        micro_required: true
      }
    })

    expect(spec.spatial_scope.anchor_refs).toEqual([])
  })

  it('can assemble intent specs from semi-structured inputs without rerunning full text understanding', () => {
    const spec = service.buildIntentSpec({
      anchor: {
        place_name: '湖北大学',
        role: 'primary'
      },
      radius_m: 1000,
      targetEntity: '公交车站'
    })

    expect(spec).toMatchObject({
      task_type: 'lookup',
      spatial_scope: {
        mode: 'anchor_radius',
        anchor_refs: [
          { place_name: '湖北大学', role: 'primary' }
        ],
        radius_m: 1000
      },
      target_entities: [
        { type: 'transport_node', value: '公交车站' }
      ],
      exclude_entities: [
        { type: 'transport_node', value: '地铁站' }
      ],
      needs_clarification: false
    })
  })
})
