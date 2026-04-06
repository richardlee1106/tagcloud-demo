/**
 * Spatial encoder client
 *
 * Provides a stable addon-facing contract for the Python V3 spatial encoder
 * service so higher-level LLM orchestration can treat it like an external
 * spatial intelligence capability.
 */

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SPATIAL_ENCODER_HOST = process.env.SPATIAL_ENCODER_HOST || '127.0.0.1'
const SPATIAL_ENCODER_PORT = Number.parseInt(process.env.SPATIAL_ENCODER_PORT || '8100', 10)

let pythonProcess = null

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeModelStatus(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  return {
    ready: safePayload.loaded === true,
    loaded: safePayload.loaded === true,
    architecture: safePayload.architecture || null,
    checkpointPath: safePayload.checkpoint_path || null,
    embeddingDim: toNumberOrNull(safePayload.embedding_dim),
    startupError: safePayload.startup_error || null,
    itemCount: toNumberOrNull(safePayload.item_count)
  }
}

export function isSpatialEncoderReadyStatus(payload = {}) {
  return payload?.status === 'ok' && payload?.encoder_loaded === true
}

export function normalizeSpatialEncoderStatus(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const safeModels = safePayload.models && typeof safePayload.models === 'object'
    ? safePayload.models
    : {}

  return {
    running: Boolean(safePayload.status),
    ready: isSpatialEncoderReadyStatus(safePayload),
    status: safePayload.status || 'unreachable',
    encoderLoaded: safePayload.encoder_loaded === true,
    device: safePayload.device || null,
    architecture: safePayload.architecture || null,
    checkpointPath: safePayload.checkpoint_path || null,
    embeddingDim: toNumberOrNull(safePayload.embedding_dim),
    supportedFeatures: Array.isArray(safePayload.supported_features) ? safePayload.supported_features : [],
    startupError: safePayload.startup_error || null,
    models: {
      poi: normalizeModelStatus(safeModels.poi),
      town: normalizeModelStatus(safeModels.town)
    }
  }
}

async function fetchSpatialEncoderJson(endpointPath, options = {}) {
  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}${endpointPath}`, {
    signal: AbortSignal.timeout(2000),
    ...options,
  })

  if (!response.ok) {
    throw new Error(`Spatial encoder request failed: ${response.status}`)
  }

  return response.json()
}

async function reloadTownIndex() {
  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/admin/reload-town-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Reload town index failed: ${response.status}`)
  }

  return response.json()
}

export async function getSpatialEncoderStatus() {
  try {
    const payload = await fetchSpatialEncoderJson('/health')
    return normalizeSpatialEncoderStatus(payload)
  } catch {
    return normalizeSpatialEncoderStatus({})
  }
}

export async function isSpatialEncoderRunning() {
  const status = await getSpatialEncoderStatus()
  return status.ready
}

export async function startSpatialEncoder() {
  const status = await getSpatialEncoderStatus()
  if (status.ready) {
    console.log('[SpatialEncoder] Service already running')
    return true
  }

  if (status.running && !status.ready) {
    console.warn('[SpatialEncoder] Service is reachable but encoder is not ready:', status.startupError || status.status)
    return false
  }

  const scriptPath = path.join(__dirname, '..', '..', 'python', 'services', 'spatialEncoderService.py')
  console.log(`[SpatialEncoder] Starting service: ${scriptPath}`)

  return new Promise((resolve) => {
    try {
      pythonProcess = spawn('python', [scriptPath, '--port', SPATIAL_ENCODER_PORT], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })

      pythonProcess.on('error', (error) => {
        console.error('[SpatialEncoder] Failed to start:', error.message)
        resolve(false)
      })

      setTimeout(async () => {
        if (await isSpatialEncoderRunning()) {
          console.log('[SpatialEncoder] Service started successfully')
          resolve(true)
        } else {
          console.error('[SpatialEncoder] Service failed to start')
          resolve(false)
        }
      }, 3000)
    } catch (error) {
      console.error('[SpatialEncoder] Failed to start:', error.message)
      resolve(false)
    }
  })
}

export async function predictDirection(userLon, userLat, poiLon, poiLat) {
  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/direction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_lon: userLon,
      user_lat: userLat,
      poi_lon: poiLon,
      poi_lat: poiLat,
    }),
  })

  if (!response.ok) {
    throw new Error(`Direction prediction failed: ${response.status}`)
  }

  return response.json()
}

export async function predictRegion(lon, lat) {
  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/region`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lon, lat }),
  })

  if (!response.ok) {
    throw new Error(`Region prediction failed: ${response.status}`)
  }

  return response.json()
}

export async function encodeCoords(lon, lat, options = {}) {
  const payload = {
    lon,
    lat
  }

  if (options?.poiId !== null && options?.poiId !== undefined && options?.poiId !== '') {
    payload.poi_id = options.poiId
  }

  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/encode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Coordinate encoding failed: ${response.status}`)
  }

  return response.json()
}

export async function batchPredictDirections(userLon, userLat, pois) {
  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/direction/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_lon: userLon,
      user_lat: userLat,
      pois: pois.map((poi) => ({
        lon: poi.lon || poi.longitude,
        lat: poi.lat || poi.latitude,
      })),
    }),
  })

  if (!response.ok) {
    throw new Error(`Batch direction prediction failed: ${response.status}`)
  }

  const payload = await response.json()
  return payload.results
}

export async function enrichPOIs(userLon, userLat, pois) {
  if (!pois || pois.length === 0) {
    return []
  }

  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_lon: userLon,
      user_lat: userLat,
      pois: pois.map((poi) => ({
        ...poi,
        lon: poi.lon || poi.longitude,
        lat: poi.lat || poi.latitude,
      })),
    }),
  })

  if (!response.ok) {
    console.warn('[SpatialEncoder] Enrichment failed, returning original POIs')
    return pois
  }

  const payload = await response.json()
  return payload.pois
}

export async function fetchCellContext(lon, lat) {
  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/cell/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lon, lat }),
  })

  if (!response.ok) {
    throw new Error(`Cell context failed: ${response.status}`)
  }

  return response.json()
}

export async function fetchBatchCellContext(anchorLon, anchorLat, pois, options = {}) {
  const response = await fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/cell/context/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anchor_lon: anchorLon,
      anchor_lat: anchorLat,
      user_query: options.userQuery || '',
      task_type: options.intent?.taskType || null,
      pois: Array.isArray(pois)
        ? pois.map((poi) => ({
            ...poi,
            lon: poi.lon ?? poi.longitude,
            lat: poi.lat ?? poi.latitude
          }))
        : []
    }),
  })

  if (!response.ok) {
    throw new Error(`Batch cell context failed: ${response.status}`)
  }

  return response.json()
}

export async function searchCells(anchorLon, anchorLat, options = {}) {
  const payload = {
    anchor_lon: anchorLon,
    anchor_lat: anchorLat,
    user_query: options.userQuery || '',
    task_type: options.taskType || null,
    top_k: options.topK || null,
    max_distance_m: options.maxDistanceM || null
  }

  const requestCellSearch = async () => fetch(`http://${SPATIAL_ENCODER_HOST}:${SPATIAL_ENCODER_PORT}/cell/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  let response = await requestCellSearch()

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 503 && errorText.includes('town_cell_index_not_ready')) {
      await reloadTownIndex()
      response = await requestCellSearch()
    } else {
      throw new Error(`Cell search failed: ${response.status}`)
    }
  }

  if (!response.ok) {
    throw new Error(`Cell search failed: ${response.status}`)
  }

  return response.json()
}

export const DIRECTION_NAMES = ['东', '东北', '北', '西北', '西', '西南', '南', '东南']
export const REGION_NAMES = ['居住类', '商业类', '工业类', '教育类', '公共类', '自然类']

export default {
  isSpatialEncoderRunning,
  startSpatialEncoder,
  predictDirection,
  predictRegion,
  encodeCoords,
  batchPredictDirections,
  enrichPOIs,
  fetchCellContext,
  fetchBatchCellContext,
  searchCells,
  reloadTownIndex,
  getSpatialEncoderStatus,
  isSpatialEncoderReadyStatus,
  normalizeSpatialEncoderStatus,
  DIRECTION_NAMES,
  REGION_NAMES,
}
