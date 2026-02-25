import { mount } from '@vue/test-utils'
import SpatialEvidenceCard from '../SpatialEvidenceCard.vue'

function createProps() {
  return {
    clusters: {
      hotspots: [
        {
          name: '沙湖热点',
          dominantCategories: [{ category: '生活服务' }],
          poiCount: 36,
          center: [114.33, 30.58],
          boundary_confidence: 0.74
        },
        {
          name: '中北路热点',
          dominantCategories: [{ category: '商业' }],
          poiCount: 30,
          center: [114.31, 30.59],
          boundary_confidence: 0.68
        }
      ]
    },
    vernacularRegions: [
      {
        name: '徐东商圈',
        membership: { score: 0.78, level: 'core' },
        center: [114.32, 30.57],
        boundary_confidence: 0.69,
        dominant_categories: [
          { category: '商业', count: 132 },
          { category: '生活服务', count: 104 }
        ]
      },
      {
        name: '岳家嘴片区',
        membership: { score: 0.72, level: 'transition' },
        center: [114.34, 30.58],
        boundary_confidence: 0.63,
        dominant_categories: [
          { category: '商业', count: 96 },
          { category: '餐饮', count: 64 }
        ]
      }
    ],
    fuzzyRegions: [
      {
        name: '沙湖缓冲带',
        level: 'transition',
        ambiguity: { score: 0.61 },
        center: [114.3, 30.6]
      }
    ],
    analysisStats: {
      avg_boundary_confidence: 0.66,
      boundary_confidence_model: 'composite_v5',
      cluster_count: 4
    },
    intentMode: 'macro_overview',
    queryType: 'area_analysis'
  }
}

describe('SpatialEvidenceCard intent templates', () => {
  it('renders 1-3 intent-driven widgets', () => {
    const wrapper = mount(SpatialEvidenceCard, { props: createProps() })

    const cards = wrapper.findAll('.template-card')
    expect(cards.length).toBeGreaterThanOrEqual(1)
    expect(cards.length).toBeLessThanOrEqual(3)
    expect(wrapper.text()).toContain('意图驱动模板看板')
    expect(wrapper.text()).toContain('宏观意图')
  })

  it('emits locate when clicking locate action', async () => {
    const wrapper = mount(SpatialEvidenceCard, { props: createProps() })
    const locateAction = wrapper.findAll('.template-action').find((node) => node.text().includes('定位'))

    expect(locateAction).toBeTruthy()
    await locateAction.trigger('click')

    const events = wrapper.emitted('locate')
    expect(events).toBeTruthy()
    expect([
      [114.33, 30.58],
      [114.32, 30.57]
    ]).toContainEqual(events[0][0])
  })
})
