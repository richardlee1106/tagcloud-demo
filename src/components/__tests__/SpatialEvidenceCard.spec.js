import { mount } from '@vue/test-utils'
import SpatialEvidenceCard from '../SpatialEvidenceCard.vue'

function createProps() {
  return {
    clusters: {
      hotspots: [
        {
          name: '沙湖热点',
          dominantCategories: [{ category: '生态' }],
          poiCount: 36,
          density: 12.3,
          center: [114.33, 30.58],
          boundary_confidence: 0.74,
          confidence_explain: { model: 'composite_v5' },
          boundary_geojson: {
            type: 'Polygon',
            coordinates: [[[114.3, 30.5], [114.4, 30.5], [114.4, 30.6], [114.3, 30.6], [114.3, 30.5]]]
          },
          semantic_anchor: { name: '沙湖' },
          niche_profile: { niche_type: 'ecology', confidence: 0.82 },
          semantic_reasoning: { evidence: [{ type: 'anchor' }, { type: 'water_context' }] }
        }
      ]
    },
    vernacularRegions: [
      {
        name: '销品茂商圈',
        membership: { score: 0.78, level: 'core' },
        center: [114.32, 30.57],
        boundary_confidence: 0.69,
        semantic_anchor: { name: '销品茂' },
        niche_profile: { niche_type: 'commerce', confidence: 0.75 },
        semantic_reasoning: { evidence: [{ type: 'anchor' }, { type: 'landuse' }] },
        boundary_geojson: {
          type: 'Polygon',
          coordinates: [[[114.31, 30.56], [114.33, 30.56], [114.33, 30.58], [114.31, 30.58], [114.31, 30.56]]]
        }
      }
    ],
    fuzzyRegions: [
      {
        level: 'transition',
        boundary_confidence: 0.66
      }
    ],
    boundary: {
      type: 'Polygon',
      coordinates: [[[114.2, 30.5], [114.5, 30.5], [114.5, 30.7], [114.2, 30.7], [114.2, 30.5]]]
    }
  }
}

describe('SpatialEvidenceCard semantic rendering', () => {
  it('renders semantic summary and confidence labels', async () => {
    const wrapper = mount(SpatialEvidenceCard, { props: createProps() })
    const fuzzyHeader = wrapper.findAll('.section-header').find((node) => node.text().includes('渐变边界'))
    if (fuzzyHeader) {
      await fuzzyHeader.trigger('click')
    }
    const text = wrapper.text()

    expect(text).toContain('锚点 沙湖')
    expect(text).toContain('生态位 生态 82%')
    expect(text).toContain('约束 关键词')
    expect(text).toContain('边界 74%')
    expect(text).toContain('边界可信 66%')
    expect(text).toContain('模型 composite_v5')
  })

  it('emits locate when hotspot chip is clicked', async () => {
    const wrapper = mount(SpatialEvidenceCard, { props: createProps() })
    const hotspotChip = wrapper.find('.hotspot-chip')
    await hotspotChip.trigger('click')

    const events = wrapper.emitted('locate')
    expect(events).toBeTruthy()
    expect(events[0][0]).toEqual([114.33, 30.58])
  })
})
