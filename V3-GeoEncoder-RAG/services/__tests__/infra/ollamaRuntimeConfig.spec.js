import { beforeEach, describe, expect, it } from 'vitest'

import {
  getOllamaEndpoint,
  getOllamaLaunchCandidates,
  getOllamaNativeBaseUrl,
  getOllamaOpenAIBaseUrl,
  resetOllamaEndpoint,
  setOllamaEndpoint
} from '../../infra/ollamaRuntimeConfig.js'

describe('ollamaRuntimeConfig', () => {
  beforeEach(() => {
    resetOllamaEndpoint()
  })

  it('defaults the V3 runtime endpoint away from the blocked 11434 port', () => {
    expect(getOllamaEndpoint()).toMatchObject({
      host: '127.0.0.1',
      port: 22114
    })
  })

  it('updates both native and OpenAI-compatible base urls when the runtime endpoint changes', () => {
    setOllamaEndpoint({ host: '127.0.0.1', port: 22118 })

    expect(getOllamaNativeBaseUrl()).toBe('http://127.0.0.1:22118')
    expect(getOllamaOpenAIBaseUrl()).toBe('http://127.0.0.1:22118/v1')
  })

  it('keeps the current runtime endpoint first and appends unique fallback launch candidates', () => {
    setOllamaEndpoint({ host: '127.0.0.1', port: 11434 })

    expect(
      getOllamaLaunchCandidates({ fallbackPorts: [22114, 22115, 11434] })
    ).toEqual([
      { host: '127.0.0.1', port: 11434 },
      { host: '127.0.0.1', port: 22114 },
      { host: '127.0.0.1', port: 22115 }
    ])
  })
})
