/**
 * Session-level spatial context lock.
 * Locks first effective spatial context in a chat session and reuses it
 * for follow-up requests until session ends/reset.
 */

function toFiniteNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeViewport(viewport) {
  if (!Array.isArray(viewport) || viewport.length < 4) {
    return null
  }

  const minLon = toFiniteNumber(viewport[0])
  const minLat = toFiniteNumber(viewport[1])
  const maxLon = toFiniteNumber(viewport[2])
  const maxLat = toFiniteNumber(viewport[3])
  if (![minLon, minLat, maxLon, maxLat].every((v) => v !== null)) {
    return null
  }

  return [minLon, minLat, maxLon, maxLat]
}

function normalizeBoundary(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) {
    return null
  }

  const ring = []
  for (const raw of boundary) {
    if (Array.isArray(raw) && raw.length >= 2) {
      const lon = toFiniteNumber(raw[0])
      const lat = toFiniteNumber(raw[1])
      if (lon !== null && lat !== null) {
        ring.push([lon, lat])
      }
      continue
    }

    if (raw && typeof raw === 'object') {
      const lon = toFiniteNumber(raw.lon ?? raw.lng ?? raw.longitude)
      const lat = toFiniteNumber(raw.lat ?? raw.latitude)
      if (lon !== null && lat !== null) {
        ring.push([lon, lat])
      }
    }
  }

  return ring.length >= 3 ? ring : null
}

function normalizeCenter(center) {
  if (!center || typeof center !== 'object') return null
  const lon = toFiniteNumber(center.lon ?? center.lng ?? center.longitude)
  const lat = toFiniteNumber(center.lat ?? center.latitude)
  if (lon === null || lat === null) return null
  return { lon, lat }
}

function normalizeRegions(regions) {
  if (!Array.isArray(regions)) return []
  return regions
    .filter((region) => region && typeof region === 'object')
    .map((region) => ({
      id: region.id ?? null,
      type: region.type ?? null,
      name: region.name ?? null,
      boundaryWKT: region.boundaryWKT ?? null,
      poiCount: Number.isFinite(Number(region.poiCount)) ? Number(region.poiCount) : null
    }))
}

function cloneJson(value) {
  if (value == null) return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

function normalizeSpatialContext(spatialContext = {}) {
  const normalized = {
    mode: spatialContext?.mode ?? '',
    boundary: normalizeBoundary(spatialContext?.boundary),
    center: normalizeCenter(spatialContext?.center),
    radius: Number.isFinite(Number(spatialContext?.radius)) ? Number(spatialContext.radius) : null,
    viewport: normalizeViewport(spatialContext?.viewport),
    mapZoom: Number.isFinite(Number(spatialContext?.mapZoom)) ? Number(spatialContext.mapZoom) : null,
    analysisScale: spatialContext?.analysisScale ?? null,
    interactionHints:
      spatialContext?.interactionHints && typeof spatialContext.interactionHints === 'object'
        ? cloneJson(spatialContext.interactionHints)
        : null,
    regions: normalizeRegions(spatialContext?.regions)
  }

  return normalized
}

function comparableFingerprint(spatialContext = {}) {
  const comparable = {
    mode: spatialContext?.mode ?? '',
    boundary: spatialContext?.boundary ?? null,
    center: spatialContext?.center ?? null,
    radius: spatialContext?.radius ?? null,
    viewport: spatialContext?.viewport ?? null,
    regions: spatialContext?.regions ?? []
  }
  return JSON.stringify(comparable)
}

export function hasLockableSpatialContext(spatialContext = {}) {
  const normalized = normalizeSpatialContext(spatialContext)
  const hasBoundary = Array.isArray(normalized.boundary) && normalized.boundary.length >= 3
  const hasViewport = Array.isArray(normalized.viewport) && normalized.viewport.length >= 4
  const hasCircle = Boolean(normalized.center) && Number.isFinite(Number(normalized.radius)) && Number(normalized.radius) > 0
  const hasRegions = Array.isArray(normalized.regions) && normalized.regions.length > 0
  return hasBoundary || hasViewport || hasCircle || hasRegions
}

/**
 * Resolve session-scoped spatial context with optional lock.
 */
export function resolveSessionSpatialContext({
  session,
  incomingSpatialContext = {},
  lockEnabled = true,
  resetLock = false
} = {}) {
  const normalizedIncoming = normalizeSpatialContext(incomingSpatialContext)
  const lockState = {
    enabled: lockEnabled !== false,
    initialized: false,
    reused: false,
    changedIgnored: false,
    reset: false
  }

  if (!session || typeof session !== 'object' || lockEnabled === false) {
    return {
      spatialContext: normalizedIncoming,
      lockState
    }
  }

  if (resetLock === true) {
    delete session.__spatialContextLock
    lockState.reset = true
  }

  const existingLock = session.__spatialContextLock?.context
  if (existingLock && hasLockableSpatialContext(existingLock)) {
    lockState.reused = true
    if (
      hasLockableSpatialContext(normalizedIncoming) &&
      comparableFingerprint(existingLock) !== comparableFingerprint(normalizedIncoming)
    ) {
      lockState.changedIgnored = true
    }
    return {
      spatialContext: cloneJson(existingLock),
      lockState
    }
  }

  if (hasLockableSpatialContext(normalizedIncoming)) {
    session.__spatialContextLock = {
      context: cloneJson(normalizedIncoming),
      createdAt: Date.now()
    }
    lockState.initialized = true
  }

  return {
    spatialContext: normalizedIncoming,
    lockState
  }
}

