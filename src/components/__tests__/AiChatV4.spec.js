import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const aiServiceMocks = vi.hoisted(() => ({
  sendChatMessageStream: vi.fn(),
  checkAIService: vi.fn(),
  getCurrentProviderInfo: vi.fn()
}))

vi.mock('../../utils/aiService.js', () => ({
  sendChatMessageStream: aiServiceMocks.sendChatMessageStream,
  checkAIService: aiServiceMocks.checkAIService,
  getCurrentProviderInfo: aiServiceMocks.getCurrentProviderInfo
}))

vi.mock('../../services/aiTelemetry.js', () => ({
  refreshTemplateWeights: vi.fn(async () => {}),
  trackSessionOutcome: vi.fn(async () => {})
}))

import AiChat from '../AiChat.vue'

const originalBackendVersion = import.meta.env.VITE_BACKEND_VERSION
const originalScrollTo = HTMLElement.prototype.scrollTo
const originalRequestAnimationFrame = window.requestAnimationFrame
const originalNavigator = globalThis.navigator

async function waitForCondition(predicate, timeoutMs = 1500) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error('Timed out waiting for test condition')
}

describe('AiChat V4 integration UI', () => {
  beforeEach(() => {
    import.meta.env.VITE_BACKEND_VERSION = 'v4'
    HTMLElement.prototype.scrollTo = vi.fn()
    window.requestAnimationFrame = (callback) => setTimeout(callback, 0)
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        geolocation: {
          getCurrentPosition: vi.fn((success) => {
            success({
              coords: {
                longitude: 114.3655,
                latitude: 30.5431,
                accuracy: 18
              },
              timestamp: new Date('2026-04-06T10:00:00.000Z').valueOf()
            })
          })
        }
      }
    })

    aiServiceMocks.checkAIService.mockResolvedValue(true)
    aiServiceMocks.getCurrentProviderInfo.mockReturnValue({
      id: 'minimax-anthropic-compatible',
      name: 'GeoLoom V4 Agent',
      modelId: 'MiniMax-M2.7',
      providerReady: true,
      degradedDependencies: ['short_term_memory'],
      dependencies: {
        short_term_memory: {
          name: 'short_term_memory',
          degraded: true,
          mode: 'fallback'
        }
      }
    })
    aiServiceMocks.sendChatMessageStream.mockImplementation(async (_messages, onChunk, _options, _poiFeatures, onMeta) => {
      onMeta?.('trace', {
        trace_id: 'trace_v4_ui_001',
        session_id: 'session_v4_ui_001'
      })
      onMeta?.('stage', { name: 'intent' })
      onMeta?.('intent_preview', {
        displayAnchor: '武汉大学',
        targetCategory: '咖啡',
        needsClarification: false
      })
      onMeta?.('stage', { name: 'evidence' })
      onMeta?.('refined_result', {
        answer: '武汉大学附近有 1 家咖啡店，推荐先看 luckin coffee。',
        tool_calls: [
          {
            id: 'tool_001',
            skill: 'postgis',
            action: 'execute_spatial_sql',
            status: 'done',
            latency_ms: 188
          }
        ],
        results: {
          stats: {
            query_type: 'nearby_poi',
            intent_mode: 'local_search',
            result_count: 1
          },
          evidence_view: {
            type: 'poi_list',
            anchor: {
              resolvedPlaceName: '武汉大学'
            },
            items: [
              {
                id: 1,
                name: 'luckin coffee',
                categorySub: '咖啡',
                distance_m: 123
              }
            ],
            meta: {}
          }
        }
      })
      onChunk('武汉大学附近有 1 家咖啡店，推荐先看 luckin coffee。')
      onMeta?.('done', {
        duration_ms: 88,
        session_id: 'session_v4_ui_001'
      })
      return '武汉大学附近有 1 家咖啡店，推荐先看 luckin coffee。'
    })
  })

  afterEach(() => {
    import.meta.env.VITE_BACKEND_VERSION = originalBackendVersion
    HTMLElement.prototype.scrollTo = originalScrollTo
    window.requestAnimationFrame = originalRequestAnimationFrame
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator
    })
    vi.clearAllMocks()
  })

  it('hides technical runtime details by default and reveals them only on demand', async () => {
    const wrapper = mount(AiChat, {
      props: {
        poiFeatures: [],
        globalAnalysisEnabled: false,
        boundaryPolygon: null,
        drawMode: '',
        circleCenter: null,
        circleRadius: null,
        mapBounds: null,
        mapZoom: null,
        selectedCategories: [],
        regions: []
      },
      global: {
        stubs: {
          EmbeddedTagCloud: true,
          SpatialEvidenceCard: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('GeoLoom V4')
    expect(wrapper.text()).toContain('查看运行详情')
    expect(wrapper.text()).toContain('MiniMax 编排已在线；当前处于本地回退的能力：短期记忆。')
    expect(wrapper.text()).not.toContain('minimax-anthropic-compatible')
    expect(wrapper.text()).not.toContain('MiniMax-M2.5')
    expect(wrapper.text()).not.toContain('short_term_memory')

    await wrapper.get('.runtime-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('收起运行详情')
    expect(wrapper.text()).toContain('MiniMax-M2.7')
    expect(wrapper.text()).not.toContain('minimax-anthropic-compatible')
    expect(wrapper.text()).not.toContain('MiniMax-M2.5')
    expect(wrapper.text()).toContain('短期记忆')
    expect(wrapper.text()).toContain('当前回退')
  })

  it('shows user-facing V4 copy while still rendering evidence after a query', async () => {
    const wrapper = mount(AiChat, {
      props: {
        poiFeatures: [],
        globalAnalysisEnabled: false,
        boundaryPolygon: null,
        drawMode: '',
        circleCenter: null,
        circleRadius: null,
        mapBounds: null,
        mapZoom: null,
        selectedCategories: [],
        regions: []
      },
      global: {
        stubs: {
          EmbeddedTagCloud: true,
          SpatialEvidenceCard: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('直接问附近配套、最近站点和片区比较')

    await wrapper.vm.autoSendMessage('武汉大学附近有哪些咖啡店？')
    await flushPromises()

    expect(wrapper.text()).toContain('周边证据清单')
    expect(wrapper.text()).toContain('luckin coffee')
    expect(wrapper.get('.chat-header').text()).not.toContain('session_v4')
  })

  it('uses a compact welcome layout while preserving quick prompt entry points', async () => {
    const wrapper = mount(AiChat, {
      props: {
        poiFeatures: [],
        globalAnalysisEnabled: false,
        boundaryPolygon: null,
        drawMode: '',
        circleCenter: null,
        circleRadius: null,
        mapBounds: null,
        mapZoom: null,
        selectedCategories: [],
        regions: []
      },
      global: {
        stubs: {
          EmbeddedTagCloud: true,
          SpatialEvidenceCard: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('快速提问')
    expect(wrapper.text()).toContain('武汉大学附近有哪些咖啡店？')
    expect(wrapper.text()).toContain('比较武汉大学和湖北大学附近的餐饮活跃度')
    expect(wrapper.text()).not.toContain('常用入口')
    expect(wrapper.text()).not.toContain('示例问法')
    expect(wrapper.text()).not.toContain('推荐问法')
    expect(wrapper.text()).not.toContain('先从这三类问题开始')
  })

  it('switches to full mode copy when all V4 dependencies are online', async () => {
    aiServiceMocks.getCurrentProviderInfo.mockReturnValue({
      id: 'minimax-anthropic-compatible',
      name: 'GeoLoom V4 Agent',
      modelId: 'MiniMax-M2.7',
      providerReady: true,
      degradedDependencies: [],
      dependencies: {}
    })

    const wrapper = mount(AiChat, {
      props: {
        poiFeatures: [],
        globalAnalysisEnabled: false,
        boundaryPolygon: null,
        drawMode: '',
        circleCenter: null,
        circleRadius: null,
        mapBounds: null,
        mapZoom: null,
        selectedCategories: [],
        regions: []
      },
      global: {
        stubs: {
          EmbeddedTagCloud: true,
          SpatialEvidenceCard: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('附近配套、最近站点和片区比较已经可以直接问了。')
    expect(wrapper.text()).toContain('可直接提问')

    await wrapper.get('.runtime-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('完整模式')
    expect(wrapper.text()).not.toContain('当前回退')
  })

  it('surfaces safe fallback copy when MiniMax orchestration is unavailable', async () => {
    aiServiceMocks.getCurrentProviderInfo.mockReturnValue({
      id: 'minimax-anthropic-compatible',
      name: 'GeoLoom V4 Agent',
      modelId: 'MiniMax-M2.7',
      providerReady: false,
      degradedDependencies: [],
      dependencies: {}
    })

    const wrapper = mount(AiChat, {
      props: {
        poiFeatures: [],
        globalAnalysisEnabled: false,
        boundaryPolygon: null,
        drawMode: '',
        circleCenter: null,
        circleRadius: null,
        mapBounds: null,
        mapZoom: null,
        selectedCategories: [],
        regions: []
      },
      global: {
        stubs: {
          EmbeddedTagCloud: true,
          SpatialEvidenceCard: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('MiniMax 编排暂不可用，当前走安全回退链路，仍可继续查询附近配套、最近站点和片区比较。')
    expect(wrapper.text()).toContain('安全回退中')

    await wrapper.get('.runtime-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('安全回退')
  })

  it('sends the selected quick prompt and renders the returned V4 evidence', async () => {
    const wrapper = mount(AiChat, {
      props: {
        poiFeatures: [],
        globalAnalysisEnabled: false,
        boundaryPolygon: null,
        drawMode: '',
        circleCenter: null,
        circleRadius: null,
        mapBounds: null,
        mapZoom: null,
        selectedCategories: [],
        regions: []
      },
      global: {
        stubs: {
          EmbeddedTagCloud: true,
          SpatialEvidenceCard: true
        }
      }
    })

    await flushPromises()

    const firstQuickPrompt = wrapper.findAll('.quick-prompt-chip')[0]
    expect(firstQuickPrompt.text()).toContain('武汉大学附近有哪些咖啡店？')

    await firstQuickPrompt.trigger('click')
    await waitForCondition(() => aiServiceMocks.sendChatMessageStream.mock.calls.length === 1)
    await waitForCondition(() => wrapper.text().includes('周边证据清单') && wrapper.text().includes('luckin coffee'))
    await flushPromises()

    expect(aiServiceMocks.sendChatMessageStream).toHaveBeenCalledTimes(1)
    const [messages] = aiServiceMocks.sendChatMessageStream.mock.calls[0]
    expect(messages.at(-1)?.content).toBe('武汉大学附近有哪些咖啡店？')
    expect(wrapper.text()).toContain('周边证据清单')
    expect(wrapper.text()).toContain('luckin coffee')

    wrapper.unmount()
  })

  it('shows a current-location entry point and injects browser coordinates into the V4 request', async () => {
    const wrapper = mount(AiChat, {
      props: {
        poiFeatures: [],
        globalAnalysisEnabled: false,
        boundaryPolygon: null,
        drawMode: '',
        circleCenter: null,
        circleRadius: null,
        mapBounds: null,
        mapZoom: null,
        selectedCategories: [],
        regions: []
      },
      global: {
        stubs: {
          EmbeddedTagCloud: true,
          SpatialEvidenceCard: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('使用当前位置')

    await wrapper.get('[data-testid="geo-locate-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已使用当前位置')

    await wrapper.vm.autoSendMessage('我附近有哪些咖啡店？')
    await waitForCondition(() => aiServiceMocks.sendChatMessageStream.mock.calls.length === 1)

    const [, , options] = aiServiceMocks.sendChatMessageStream.mock.calls[0]
    expect(options.spatialContext.userLocation).toEqual({
      lon: 114.3655,
      lat: 30.5431,
      accuracyM: 18,
      source: 'browser_geolocation',
      capturedAt: '2026-04-06T10:00:00.000Z',
      coordSys: 'wgs84'
    })
  })
})
