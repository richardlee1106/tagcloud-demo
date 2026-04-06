import { describe, expect, it } from 'vitest'

import {
  buildSynthesisBrief,
  summarizeSynthesisBrief
} from '../../planner_line/synthesisBrief.js'

describe('synthesisBrief', () => {
  it('builds a compact lookup brief around the active transport intent', () => {
    const brief = buildSynthesisBrief({
      plan: {
        answer_frame: {
          style: 'lookup'
        }
      },
      evidenceBundle: {
        evidence_profile: {
          style: 'lookup',
          task_type: 'lookup',
          focus_terms: ['地铁站'],
          target_entities: ['地铁站'],
          transport_modalities: ['地铁站'],
          spatial_scope_mode: 'anchor_radius'
        },
        anchors: [
          { display_name: '湖北大学' }
        ],
        representative_pois: [
          { name: '湖北大学(地铁站)', distance_m: 280 },
          { name: '秦园路(地铁站)', distance_m: 540 }
        ],
        nearby_pois: [
          { name: '湖北大学(地铁站)', distance_m: 280 },
          { name: '秦园路(地铁站)', distance_m: 540 },
          { name: '友谊大道地铁站', distance_m: 860 }
        ],
        support_buckets: [
          { bucket: '交通出行', count: 3 }
        ]
      }
    })

    expect(brief).toMatchObject({
      anchor: '湖北大学',
      style: 'lookup',
      task_type: 'lookup',
      spatial_scope_mode: 'anchor_radius',
      focus_terms: ['地铁站'],
      target_entities: ['地铁站'],
      transport_modalities: ['地铁站'],
      core_axes: ['地铁站'],
      representative_examples: ['湖北大学(地铁站)', '秦园路(地铁站)'],
      result_count: 3,
      nearest_distance: '280米'
    })
    expect(brief).not.toHaveProperty('nearby_pois')
    expect(brief.constraints).toContain('先直接给结果，再补数量或距离，不要展开成宏观概览。')
  })

  it('builds an overview brief that highlights macro axes instead of raw evidence payloads', () => {
    const brief = buildSynthesisBrief({
      plan: {
        answer_frame: {
          style: 'overview'
        }
      },
      evidenceBundle: {
        evidence_profile: {
          style: 'overview',
          task_type: 'overview',
          focus_terms: ['空间结构', '业态分布'],
          target_entities: ['空间结构', '业态分布'],
          scene_tags: ['高校周边', '混合业态'],
          cell_mix: ['教育类', '生活类']
        },
        anchors: [
          { display_name: '武汉大学' }
        ],
        representative_pois: [
          { name: '武汉大学-新闻中心', distance_m: 59 },
          { name: '武汉大学万林艺术博物馆', distance_m: 130 },
          { name: '武汉大学珞珈文库', distance_m: 151 }
        ],
        support_buckets: [
          { bucket: '教育科研', count: 8 },
          { bucket: '餐饮配套', count: 4 },
          { bucket: '生活服务', count: 3 }
        ],
        spatial_summary: {
          spatial_clusters: [{ id: 'h1' }, { id: 'h2' }]
        }
      }
    })

    expect(brief).toMatchObject({
      anchor: '武汉大学',
      style: 'overview',
      task_type: 'overview',
      focus_terms: ['空间结构', '业态分布'],
      target_entities: ['空间结构', '业态分布'],
      core_axes: ['教育科研', '餐饮配套', '生活服务'],
      scene_tags: ['高校周边', '混合业态'],
      spatial_mix: ['教育类', '生活类'],
      representative_examples: ['武汉大学-新闻中心', '武汉大学万林艺术博物馆', '武汉大学珞珈文库'],
      hotspot_count: 2
    })
    expect(brief).not.toHaveProperty('support_bucket_metrics')
    expect(brief.constraints).toContain('先概括区域主轴，再补代表点，不要把局部门店写成区域主轴。')

    const summary = summarizeSynthesisBrief({ brief })
    expect(summary).toContain('武汉大学周边')
    expect(summary).toContain('教育科研')
    expect(summary).toContain('高校周边')
    expect(summary).toContain('武汉大学万林艺术博物馆')
  })
})
