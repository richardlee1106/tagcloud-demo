import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildSpatialAnswerFallback, generateAnswerStream } from '../../spatial_core/ai/spatialAnswerService.js'
import { callLLM } from '../../ai/llmService.js'

const HUBEI_UNIVERSITY_METRO_QUERY = '\u6e56\u5317\u5927\u5b66\u9644\u8fd1\u6709\u54ea\u4e9b\u5730\u94c1\u7ad9\uff1f'
const HUBEI_UNIVERSITY_METRO_STATION = '\u6e56\u5317\u5927\u5b66\u7ad9'
const SANJIAOLU_METRO_STATION = '\u4e09\u89d2\u8def\u7ad9'
const TRANSIT_CATEGORY = '\u4ea4\u901a\u8bbe\u65bd\u670d\u52a1'
const METRO_SUBTYPE = '\u5730\u94c1\u7ad9'
const WUHAN_UNIVERSITY_COFFEE_QUERY = '\u6b66\u6c49\u5927\u5b66\u9644\u8fd1\u6709\u54ea\u4e9b\u5496\u5561\u5e97\uff1f'
const COFFEE_SUBTYPE = '\u5496\u5561'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('llmService spatial answer generation', () => {
  it('allows per-call model override for chat completion requests', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'ok'
              }
            }
          ]
        })
      }))

    const result = await callLLM(
      [{ role: 'user', content: 'test' }],
      { model: 'qwen3-4b-instruct-2507-q8', retries: 0 }
    )

    expect(result).toBe('ok')
    const fetchCalls = global.fetch.mock.calls
    const body = JSON.parse(fetchCalls[1][1].body)
    expect(body.model).toBe('qwen3-4b-instruct-2507-q8')
  })

  it('allows per-call baseUrl override for chat completion requests', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'ok-from-custom-base'
              }
            }
          ]
        })
      }))

    const result = await callLLM(
      [{ role: 'user', content: 'test custom base' }],
      { model: 'custom-model', baseUrl: 'http://127.0.0.1:18081/v1', retries: 0 }
    )

    expect(result).toBe('ok-from-custom-base')
    const fetchCalls = global.fetch.mock.calls
    expect(fetchCalls[0][0]).toBe('http://127.0.0.1:18081/v1/chat/completions')
  })

  it('falls back to the configured reasoning model when the default ollama model is missing', async () => {
    process.env.OLLAMA_REASONING_MODEL = 'qwen3.5-4b-reasoning'

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'qwen3.5-4b-reasoning:latest' }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => `{"error":{"message":"model 'qwen3.5-2b' not found"}}`
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'fallback-ok'
              }
            }
          ]
        })
      }))

    const result = await callLLM(
      [{ role: 'user', content: 'test fallback' }],
      { model: 'qwen3.5-2b', retries: 0 }
    )

    expect(result).toBe('fallback-ok')
    const fetchCalls = global.fetch.mock.calls
    const firstChatBody = JSON.parse(fetchCalls[1][1].body)
    const secondChatBody = JSON.parse(fetchCalls[2][1].body)
    expect(firstChatBody.model).toBe('qwen3.5-2b')
    expect(secondChatBody.model).toBe('qwen3.5-4b-reasoning')
  })

  it('returns the final streamed text even when no incremental chunk is emitted', async () => {
    const onChunk = vi.fn()
    const finalText = await generateAnswerStream(
      HUBEI_UNIVERSITY_METRO_QUERY,
      [
        { name: '\u5730\u94c1\u7ad9A', category: TRANSIT_CATEGORY, distance_m: 120 }
      ],
      onChunk,
      {
        requestedCategory: TRANSIT_CATEGORY,
        streamImpl: vi.fn().mockResolvedValue('\u6e56\u5317\u5927\u5b66\u9644\u8fd1\u53ef\u53c2\u8003\u5730\u94c1\u7ad9 A\u3002')
      }
    )

    expect(onChunk).not.toHaveBeenCalled()
    expect(finalText).toBe('\u6e56\u5317\u5927\u5b66\u9644\u8fd1\u53ef\u53c2\u8003\u5730\u94c1\u7ad9 A\u3002')
  })

  it('strips leaked think blocks from the final streamed text', async () => {
    const onChunk = vi.fn()
    const finalText = await generateAnswerStream(
      HUBEI_UNIVERSITY_METRO_QUERY,
      [
        { name: '\u6e56\u5317\u5927\u5b66\u5730\u94c1\u7ad9A\u53e3', category: METRO_SUBTYPE, distance_m: 448 }
      ],
      onChunk,
      {
        requestedCategory: METRO_SUBTYPE,
        streamImpl: vi.fn().mockResolvedValue('<think>\u5185\u90e8\u63a8\u7406\u672a\u95ed\u5408')
      }
    )

    expect(onChunk).not.toHaveBeenCalled()
    expect(finalText).toBe('')
  })

  it('builds a markdown-rich grounded fallback answer from spatial results', () => {
    const answer = buildSpatialAnswerFallback(HUBEI_UNIVERSITY_METRO_QUERY, [
      { name: HUBEI_UNIVERSITY_METRO_STATION, category: TRANSIT_CATEGORY, distance_m: 180 },
      { name: SANJIAOLU_METRO_STATION, category: TRANSIT_CATEGORY, distance_m: 620 }
    ], {
      requestedCategory: TRANSIT_CATEGORY
    })

    expect(answer).toContain('###')
    expect(answer).toContain(`**${HUBEI_UNIVERSITY_METRO_STATION}**`)
    expect(answer).toContain(`**${SANJIAOLU_METRO_STATION}**`)
    expect(answer).toContain('\u5982\u679c\u4f60\u613f\u610f')
    expect(answer).not.toContain('\u6c49\u9633\u8def')
  })

  it('passes richer markdown instructions and a wider result context into the streaming prompt', async () => {
    const onChunk = vi.fn()
    const streamImpl = vi.fn().mockResolvedValue('### \u5148\u770b\u7ed3\u8bba\n- \u4e00\u5207\u6b63\u5e38')
    const results = Array.from({ length: 11 }, (_, index) => ({
      name: `\u5019\u9009${index + 1}`,
      category: COFFEE_SUBTYPE,
      distance_m: 100 + index * 50
    }))

    await generateAnswerStream(
      WUHAN_UNIVERSITY_COFFEE_QUERY,
      results,
      onChunk,
      {
        requestedCategory: COFFEE_SUBTYPE,
        streamImpl
      }
    )

    const prompt = streamImpl.mock.calls[0]?.[0]?.[1]?.content || ''
    expect(prompt).toContain('Markdown')
    expect(prompt).toContain('### \u5148\u770b\u7ed3\u8bba')
    expect(prompt).toContain('\u5019\u900910')
    expect(prompt).not.toContain('\u5019\u900911')
  })
})
