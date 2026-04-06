function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function firstFiniteNumber(...candidates) {
  for (const candidate of candidates) {
    const numeric = toFiniteNumber(candidate)
    if (numeric !== null) return numeric
  }
  return null
}

function firstNonEmptyText(...candidates) {
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim()
    if (text) return text
  }
  return ''
}

export function readCoordinatePair(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const lon = toFiniteNumber(value[0])
    const lat = toFiniteNumber(value[1])
    return lon !== null && lat !== null ? [lon, lat] : null
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const lon = firstFiniteNumber(value.lon, value.lng, value.longitude, value.x)
  const lat = firstFiniteNumber(value.lat, value.latitude, value.y)
  if (lon !== null && lat !== null) {
    return [lon, lat]
  }

  const nestedCandidates = [
    value.geometry?.coordinates,
    value.location,
    value.center,
    value.coordinate,
    value.coordinates,
    value.coord,
    value.coords,
    value.position,
    value.point,
  ]

  for (const candidate of nestedCandidates) {
    const resolved = readCoordinatePair(candidate)
    if (resolved) return resolved
  }

  return null
}

export function readCoordSys(value, fallback = '') {
  const direct = firstNonEmptyText(
    value?.coordSys,
    value?.coord_sys,
    value?.properties?._coordSys,
    value?.properties?.coordSys,
    value?.properties?.coord_sys,
    value?.meta?.coordSys,
    value?.meta?.coord_sys,
  ).toLowerCase()

  return direct || String(fallback || '').trim().toLowerCase()
}

export function hasCoordinateMatch(value, lon, lat, epsilon = 1e-6) {
  const pair = readCoordinatePair(value)
  const targetLon = toFiniteNumber(lon)
  const targetLat = toFiniteNumber(lat)
  if (!pair || targetLon === null || targetLat === null) return false

  return Math.abs(pair[0] - targetLon) < epsilon && Math.abs(pair[1] - targetLat) < epsilon
}

export function normalizeAiMapFeature(value, options = {}) {
  const {
    defaultSource = 'ai_tagcloud',
    fallbackCoordSys = '',
  } = options

  if (!value || typeof value !== 'object') return null

  const coordinates = readCoordinatePair(value)
  if (!coordinates) return null

  const baseProperties = value.type === 'Feature' && value.properties && typeof value.properties === 'object'
    ? { ...value.properties }
    : {}

  const resolvedCoordSys = readCoordSys(value, fallbackCoordSys)
  const resolvedName = firstNonEmptyText(
    baseProperties['名称'],
    baseProperties.name,
    value.name,
    value.名称,
    value.placeName,
    value.displayName,
  ) || '未知'
  const resolvedMajorCategory = firstNonEmptyText(
    baseProperties['大类'],
    baseProperties.category_main,
    value.category_main,
    value.categoryMain,
    value.type,
    value.大类,
  )
  const resolvedMinorCategory = firstNonEmptyText(
    baseProperties['小类'],
    baseProperties.category_sub,
    baseProperties.category,
    value.category_sub,
    value.categorySub,
    value.category,
    value.小类,
  )
  const resolvedAddress = firstNonEmptyText(
    baseProperties['地址'],
    baseProperties.address,
    value.address,
    value.地址,
  )

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates,
    },
    properties: {
      ...baseProperties,
      name: baseProperties.name || resolvedName,
      名称: baseProperties['名称'] || resolvedName,
      ...(resolvedMajorCategory ? { 大类: baseProperties['大类'] || resolvedMajorCategory } : {}),
      ...(resolvedMinorCategory
        ? {
            小类: baseProperties['小类'] || resolvedMinorCategory,
            category: baseProperties.category || resolvedMinorCategory,
          }
        : {}),
      ...(resolvedAddress ? { 地址: baseProperties['地址'] || resolvedAddress } : {}),
      _source: baseProperties._source || defaultSource,
      ...(resolvedCoordSys ? { _coordSys: resolvedCoordSys } : {}),
    },
  }
}
