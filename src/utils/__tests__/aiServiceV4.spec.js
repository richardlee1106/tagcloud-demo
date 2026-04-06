import { afterEach, describe, expect, it, vi } from 'vitest'

function createSseResponse(chunks, headers = {}) {
  const encoder = new TextEncoder()
  const encodedChunks = chunks.map((chunk) => encoder.encode(chunk))
  let index = 0

  return {
    ok: true,
    headers: {
      get(name) {
        return headers[name] || headers[name.toLowerCase()] || null
      }
    },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= encodedChunks.length) {
              return { done: true, value: undefined }
            }
            return { done: false, value: encodedChunks[index++] }
          }
        }
      }
    }
  }
}

const originalFetch = globalThis.fetch
const originalBackendVersion = import.meta.env.VITE_BACKEND_VERSION

afterEach(() => {
  globalThis.fetch = originalFetch
  import.meta.env.VITE_BACKEND_VERSION = originalBackendVersion
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('sendChatMessageStream in V4 mode', () => {
  it('posts to /api/geo/chat and parses V4 SSE events', async () => {
    import.meta.env.VITE_BACKEND_VERSION = 'v4'

    const onChunk = vi.fn()
    const onMeta = vi.fn()

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse(
        [
          'event: trace\n',
          'data: {"trace_id":"trace_v4_001"}\n\n',
          'event: job\n',
          'data: {"mode":"deterministic_single_turn"}\n\n',
          'event: stage\n',
          'data: {"name":"intent"}\n\n',
          'event: intent_preview\n',
          'data: {"displayAnchor":"武汉大学","targetCategory":"咖啡","needsClarification":false}\n\n',
          'event: pois\n',
          'data: [{"id":1,"name":"luckin coffee","lon":114.3651,"lat":30.5368,"category":"咖啡"}]\n\n',
          'event: stats\n',
          'data: {"query_type":"nearby_poi","intent_mode":"deterministic_visible_loop","result_count":1}\n\n',
          'event: refined_result\n',
          'data: {"answer":"武汉大学附近找到 1 家咖啡相关地点。","results":{"stats":{"query_type":"nearby_poi","intent_mode":"deterministic_visible_loop","result_count":1}}}\n\n',
          'event: done\n',
          'data: {"duration_ms":123}\n\n'
        ],
        { 'X-Trace-Id': 'trace_v4_001' }
      )
    )

    const { sendChatMessageStream } = await import('../aiService.js')
    const fullText = await sendChatMessageStream(
      [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
      onChunk,
      { requestId: 'req_v4_001' },
      [],
      onMeta
    )

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/geo\/chat$/),
      expect.objectContaining({ method: 'POST' })
    )
    expect(fullText).toBe('武汉大学附近找到 1 家咖啡相关地点。')
    expect(onChunk).toHaveBeenCalledWith('武汉大学附近找到 1 家咖啡相关地点。')
    expect(onMeta).toHaveBeenCalledWith('job', expect.objectContaining({ mode: 'deterministic_single_turn' }))
    expect(onMeta).toHaveBeenCalledWith('intent_preview', expect.objectContaining({ displayAnchor: '武汉大学' }))
    expect(onMeta).toHaveBeenCalledWith('done', expect.objectContaining({ duration_ms: 123 }))
  })

  it('reads provider readiness and degraded dependencies from /api/geo/health', async () => {
    import.meta.env.VITE_BACKEND_VERSION = 'v4'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        provider_ready: true,
        llm: {
          provider: 'minimax-anthropic-compatible',
          model: 'MiniMax-M2.7',
          target: 'https://api.minimaxi.com/anthropic'
        },
        degraded_dependencies: ['short_term_memory'],
        dependencies: {
          short_term_memory: {
            name: 'short_term_memory',
            mode: 'fallback',
            degraded: true
          }
        }
      })
    })

    const { checkAIService, getCurrentProviderInfo } = await import('../aiService.js')
    const online = await checkAIService()
    const provider = getCurrentProviderInfo()

    expect(online).toBe(true)
    expect(provider.id).toBe('minimax-anthropic-compatible')
    expect(provider.modelId).toBe('MiniMax-M2.7')
    expect(provider.providerReady).toBe(true)
    expect(provider.degradedDependencies).toEqual(['short_term_memory'])
    expect(provider.dependencies.short_term_memory.mode).toBe('fallback')
  })
})
