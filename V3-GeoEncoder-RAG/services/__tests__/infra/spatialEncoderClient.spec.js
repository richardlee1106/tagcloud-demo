import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isSpatialEncoderReadyStatus,
  normalizeSpatialEncoderStatus,
  searchCells
} from '../../infra/spatialEncoderClient.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('spatialEncoderClient readiness semantics', () => {
  it('does not treat an encoder_not_loaded health response as ready', () => {
    expect(isSpatialEncoderReadyStatus({
      status: 'encoder_not_loaded',
      encoder_loaded: false,
      device: 'cuda'
    })).toBe(false)
  })

  it('treats an ok plus encoder_loaded status as ready', () => {
    expect(isSpatialEncoderReadyStatus({
      status: 'ok',
      encoder_loaded: true,
      device: 'cuda'
    })).toBe(true)
  })

  it('normalizes addon-facing metadata from the health payload', () => {
    expect(normalizeSpatialEncoderStatus({
      status: 'ok',
      encoder_loaded: true,
      architecture: 'ultimate',
      checkpoint_path: 'saved_models/poi_encoder/best_model.pt',
      embedding_dim: 352,
      supported_features: ['encode', 'region', 'direction']
    })).toMatchObject({
      running: true,
      ready: true,
      architecture: 'ultimate',
      embeddingDim: 352,
      supportedFeatures: ['encode', 'region', 'direction']
    })
  })

  it('normalizes dual-model health metadata when both poi and town encoders are available', () => {
    expect(normalizeSpatialEncoderStatus({
      status: 'ok',
      encoder_loaded: true,
      models: {
        poi: {
          loaded: true,
          architecture: 'ultimate',
          checkpoint_path: 'saved_models/poi_encoder/best_model.pt',
          embedding_dim: 352
        },
        town: {
          loaded: true,
          architecture: 'mlp',
          checkpoint_path: 'saved_models/town_encoder/best_model.pt',
          embedding_dim: 352
        }
      },
      supported_features: ['encode', 'enrich', 'cell_context']
    })).toMatchObject({
      ready: true,
      models: {
        poi: {
          ready: true,
          architecture: 'ultimate',
          checkpointPath: 'saved_models/poi_encoder/best_model.pt'
        },
        town: {
          ready: true,
          architecture: 'mlp',
          checkpointPath: 'saved_models/town_encoder/best_model.pt'
        }
      },
      supportedFeatures: ['encode', 'enrich', 'cell_context']
    })
  })

  it('retries cell search once after reloading the town index when the python service reports it as not ready', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => '{"detail":"town_cell_index_not_ready"}'
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'partial' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cells: [{ cell_id: 'cell-a' }],
          support_bucket_distribution: [{ bucket: '教育科研', count: 2 }]
        })
      }))

    const payload = await searchCells(114.36, 30.53, {
      taskType: 'area_overview',
      topK: 5,
      maxDistanceM: 2500
    })

    expect(payload.cells).toHaveLength(1)
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(global.fetch.mock.calls[1][0]).toContain('/admin/reload-town-index')
    expect(global.fetch.mock.calls[2][0]).toContain('/cell/search')
  })
})
