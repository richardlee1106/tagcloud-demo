import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildManagedLlamaCppServices,
  startManagedLlamaCppServices
} from '../../infra/llamaCppService.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('llamaCppService', () => {
  it('builds planner and synthesis managed services from local llama.cpp env config', () => {
    const services = buildManagedLlamaCppServices({
      USE_OLLAMA: 'false',
      LLAMACPP_AUTOSTART: 'true',
      LLAMACPP_SERVER_PATH: 'C:/llama/llama-server.exe',
      PLANNER_BASE_URL: 'http://127.0.0.1:18081/v1',
      PLANNER_MODEL: 'planner-model',
      PLANNER_MODEL_PATH: 'D:/models/planner.gguf',
      PLANNER_CTX_SIZE: '4096',
      PLANNER_GPU_LAYERS: '999',
      PLANNER_REASONING: 'off',
      PLANNER_PARALLEL: '1',
      ANSWER_SYNTHESIS_BASE_URL: 'http://127.0.0.1:18082/v1',
      ANSWER_SYNTHESIS_MODEL: 'synth-model',
      ANSWER_SYNTHESIS_MODEL_PATH: 'D:/models/synth.gguf',
      ANSWER_SYNTHESIS_CTX_SIZE: '4096',
      ANSWER_SYNTHESIS_GPU_LAYERS: '0',
      ANSWER_SYNTHESIS_REASONING: 'off',
      ANSWER_SYNTHESIS_PARALLEL: '1'
    })

    expect(services).toHaveLength(2)
    expect(services[0]).toMatchObject({
      key: 'planner',
      port: 18081,
      model: 'planner-model',
      modelPath: 'D:/models/planner.gguf',
      executablePath: 'C:/llama/llama-server.exe',
      reasoning: 'off',
      gpuLayers: 999
    })
    expect(services[1]).toMatchObject({
      key: 'answerSynthesis',
      port: 18082,
      model: 'synth-model',
      modelPath: 'D:/models/synth.gguf'
    })
  })

  it('does not manage llama.cpp services when autostart is disabled', () => {
    const services = buildManagedLlamaCppServices({
      USE_OLLAMA: 'false',
      LLAMACPP_AUTOSTART: 'false',
      LLAMACPP_SERVER_PATH: 'C:/llama/llama-server.exe',
      PLANNER_BASE_URL: 'http://127.0.0.1:18081/v1',
      PLANNER_MODEL: 'planner-model',
      PLANNER_MODEL_PATH: 'D:/models/planner.gguf'
    })

    expect(services).toEqual([])
  })

  it('reuses an already running local llama.cpp endpoint without spawning a duplicate process', async () => {
    const spawnProcess = vi.fn()

    const result = await startManagedLlamaCppServices({
      env: {
        USE_OLLAMA: 'false',
        LLAMACPP_AUTOSTART: 'true',
        LLAMACPP_SERVER_PATH: 'C:/llama/llama-server.exe',
        PLANNER_BASE_URL: 'http://127.0.0.1:18081/v1',
        PLANNER_MODEL: 'planner-model',
        PLANNER_MODEL_PATH: 'D:/models/planner.gguf'
      },
      deps: {
        fileExists: () => true,
        probeService: vi.fn().mockResolvedValue({
          available: true,
          models: ['planner-model']
        }),
        spawnProcess,
        ensureDir: vi.fn(),
        resetLogFile: vi.fn(),
        createLogStream: vi.fn(),
        logger: {
          log: vi.fn(),
          warn: vi.fn(),
          error: vi.fn()
        }
      }
    })

    expect(spawnProcess).not.toHaveBeenCalled()
    expect(result.reusedServices).toHaveLength(1)
    expect(result.startedServices).toHaveLength(0)
  })

  it('spawns local llama.cpp services when the configured endpoint is not yet reachable', async () => {
    const child = {
      pid: 4321,
      stdout: { pipe: vi.fn() },
      stderr: { pipe: vi.fn() },
      on: vi.fn(),
      unref: vi.fn()
    }

    const probeService = vi.fn().mockResolvedValue({ available: false, models: [] })
    const spawnProcess = vi.fn(() => child)

    const result = await startManagedLlamaCppServices({
      env: {
        USE_OLLAMA: 'false',
        LLAMACPP_AUTOSTART: 'true',
        LLAMACPP_SERVER_PATH: 'C:/llama/llama-server.exe',
        PLANNER_BASE_URL: 'http://127.0.0.1:18081/v1',
        PLANNER_MODEL: 'planner-model',
        PLANNER_MODEL_PATH: 'D:/models/planner.gguf',
        PLANNER_CTX_SIZE: '4096',
        PLANNER_GPU_LAYERS: '999',
        PLANNER_REASONING: 'off',
        PLANNER_PARALLEL: '1'
      },
      deps: {
        fileExists: () => true,
        probeService,
        spawnProcess,
        ensureDir: vi.fn(),
        resetLogFile: vi.fn(),
        createLogStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn() })),
        waitForReady: vi.fn().mockResolvedValue(true),
        logger: {
          log: vi.fn(),
          warn: vi.fn(),
          error: vi.fn()
        }
      }
    })

    expect(result.startedServices).toHaveLength(1)
    expect(result.startedServices[0]).toMatchObject({
      key: 'planner',
      pid: 4321
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        expect.stringContaining('llamaCppGuardian.js')
      ]),
      expect.objectContaining({
        key: 'planner',
        gpuLayers: 999,
        reasoning: 'off'
      })
    )
    expect(result.reusedServices).toHaveLength(0)
  })
})
