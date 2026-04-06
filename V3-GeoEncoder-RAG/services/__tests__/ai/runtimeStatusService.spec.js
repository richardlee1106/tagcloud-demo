import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildModelsEndpoint,
  probeOpenAICompatibleService,
  resolveChatRuntimeStatus
} from '../../ai/runtimeStatusService.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('runtimeStatusService', () => {
  it('builds the models endpoint for OpenAI-compatible base URLs', () => {
    expect(buildModelsEndpoint('http://127.0.0.1:18081/v1')).toBe('http://127.0.0.1:18081/v1/models')
    expect(buildModelsEndpoint('http://127.0.0.1:18082')).toBe('http://127.0.0.1:18082/v1/models')
  })

  it('probes a custom service and preserves the configured model alias', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'qwen3.5-9b-claude-4.6-opus-reasoning-distilled-v2' }
        ]
      })
    }))

    const result = await probeOpenAICompatibleService({
      baseUrl: 'http://127.0.0.1:18081/v1',
      configuredModel: 'qwen3.5-9b-claude-4.6-opus-reasoning-distilled-v2'
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18081/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result.available).toBe(true)
    expect(result.models).toContain('qwen3.5-9b-claude-4.6-opus-reasoning-distilled-v2')
    expect(result.configuredModel).toBe('qwen3.5-9b-claude-4.6-opus-reasoning-distilled-v2')
  })

  it('reports llama.cpp runtime as online when planner or synthesis service is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'planner-live' }]
        })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({})
      }))

    const result = await resolveChatRuntimeStatus({
      env: {
        USE_OLLAMA: 'false',
        PLANNER_MODEL: 'planner-live',
        PLANNER_BASE_URL: 'http://127.0.0.1:18081/v1',
        ANSWER_SYNTHESIS_MODEL: 'synthesis-live',
        ANSWER_SYNTHESIS_BASE_URL: 'http://127.0.0.1:18082/v1'
      },
      ollamaStatus: {
        running: false,
        models: []
      }
    })

    expect(result.provider).toBe('llama.cpp')
    expect(result.online).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.model).toBe('planner-live')
    expect(result.models).toContain('planner-live')
    expect(result.answerSynthesis.error).toBe('http_503')
  })

  it('keeps ollama mode semantics when USE_OLLAMA is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'custom-model' }]
      })
    }))

    const result = await resolveChatRuntimeStatus({
      env: {
        USE_OLLAMA: 'true',
        PLANNER_MODEL: 'planner-live',
        PLANNER_BASE_URL: 'http://127.0.0.1:18081/v1',
        ANSWER_SYNTHESIS_MODEL: 'synthesis-live',
        ANSWER_SYNTHESIS_BASE_URL: 'http://127.0.0.1:18082/v1'
      },
      ollamaStatus: {
        running: true,
        defaultModel: 'qwen3.5-2b',
        models: [{ name: 'qwen3.5-2b' }]
      }
    })

    expect(result.provider).toBe('ollama')
    expect(result.online).toBe(true)
    expect(result.ready).toBe(true)
    expect(result.model).toBe('qwen3.5-2b')
    expect(result.models).toEqual(['qwen3.5-2b'])
  })
})
