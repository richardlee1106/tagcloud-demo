import { mount } from '@vue/test-utils'

import V4EvidencePanel from '../V4EvidencePanel.vue'

describe('V4EvidencePanel', () => {
  it('renders transport evidence with degraded dependency hints and tool traces', () => {
    const wrapper = mount(V4EvidencePanel, {
      props: {
        providerReady: true,
        providerLabel: 'GeoLoom Agent',
        modelId: 'MiniMax-M2.7',
        degradedDependencies: ['short_term_memory'],
        sessionId: 'session_transport_001',
        message: {
          toolCalls: [
            {
              id: 'tool_001',
              skill: 'postgis',
              action: 'execute_spatial_sql',
              status: 'done',
              latency_ms: 231
            }
          ],
          evidenceView: {
            type: 'transport',
            anchor: {
              resolvedPlaceName: '湖北大学'
            },
            items: [
              {
                id: 1,
                name: '小洪山地铁站A口',
                categorySub: '地铁站',
                distance_m: 1028,
                duration_min: 14
              }
            ],
            meta: {}
          }
        }
      }
    })

    expect(wrapper.text()).toContain('GeoLoom V4')
    expect(wrapper.text()).toContain('交通接驳证据')
    expect(wrapper.text()).toContain('小洪山地铁站A口')
    expect(wrapper.text()).toContain('short_term_memory')
    expect(wrapper.text()).toContain('postgis.execute_spatial_sql')
  })

  it('renders comparison evidence cards for dual-place analysis', () => {
    const wrapper = mount(V4EvidencePanel, {
      props: {
        providerReady: false,
        providerLabel: 'GeoLoom Fallback',
        modelId: 'deterministic-router',
        degradedDependencies: [],
        sessionId: 'session_compare_001',
        message: {
          toolCalls: [],
          evidenceView: {
            type: 'comparison',
            anchor: {
              resolvedPlaceName: '武汉大学'
            },
            secondaryAnchor: {
              resolvedPlaceName: '湖北大学'
            },
            items: [],
            pairs: [
              {
                label: '武汉大学',
                value: 8,
                items: [{ name: '武大食堂街' }]
              },
              {
                label: '湖北大学',
                value: 5,
                items: [{ name: '湖大美食城' }]
              }
            ],
            meta: {}
          }
        }
      }
    })

    expect(wrapper.text()).toContain('双片区对比证据')
    expect(wrapper.text()).toContain('武汉大学')
    expect(wrapper.text()).toContain('湖北大学')
    expect(wrapper.text()).toContain('Fallback 模式')
  })

  it('renders semantic candidate evidence with anchor fallback and score bars', () => {
    const wrapper = mount(V4EvidencePanel, {
      props: {
        providerReady: true,
        providerLabel: 'GeoLoom Agent',
        modelId: 'MiniMax-M2.7',
        degradedDependencies: [],
        sessionId: 'session_semantic_candidate_00123456789',
        message: {
          toolCalls: [],
          evidenceView: {
            type: 'semantic_candidate',
            anchor: {
              placeName: '武汉大学'
            },
            items: [],
            regions: [
              {
                name: '街道口片区',
                score: 0.82,
                summary: '高校与商业混合密度较高'
              },
              {
                name: '广埠屯片区',
                score: 0.64,
                summary: '消费活跃且与校园人流耦合'
              }
            ],
            meta: {}
          }
        }
      }
    })

    expect(wrapper.text()).toContain('语义相似片区证据')
    expect(wrapper.text()).toContain('武汉大学')
    expect(wrapper.text()).toContain('街道口片区')
    expect(wrapper.text()).toContain('广埠屯片区')
    expect(wrapper.text()).toContain('82%')
    expect(wrapper.text()).toContain('64%')
    expect(wrapper.text()).toContain('2')
  })

  it('renders poi list evidence with display name anchor fallback and empty trace state', () => {
    const wrapper = mount(V4EvidencePanel, {
      props: {
        providerReady: true,
        providerLabel: 'GeoLoom Agent',
        modelId: 'MiniMax-M2.7',
        degradedDependencies: [],
        sessionId: '',
        message: {
          toolCalls: [],
          evidenceView: {
            type: 'poi_list',
            anchor: {
              displayName: '世界城(光谷步行街通讯数码港)'
            },
            items: [
              {
                id: 11,
                name: 'luckin coffee',
                categorySub: '咖啡',
                distance_m: 1288
              }
            ],
            meta: {}
          }
        }
      }
    })

    expect(wrapper.text()).toContain('周边证据清单')
    expect(wrapper.text()).toContain('世界城(光谷步行街通讯数码港)')
    expect(wrapper.text()).toContain('luckin coffee')
    expect(wrapper.text()).toContain('1.3 km')
    expect(wrapper.text()).toContain('未分配')
    expect(wrapper.text()).toContain('当前回答还没有 tool trace。')
  })
})
