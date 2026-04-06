const REGION_LABEL_NAMES = Object.freeze({
  0: '居住片区',
  1: '商业片区',
  2: '工业片区',
  3: '教育片区',
  4: '公共片区',
  5: '自然片区'
})

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function roundCoord(value, digits = 6) {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  return Number(numeric.toFixed(digits))
}

function clamp01(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function toCoordinatePair(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const lon = toFiniteNumber(value[0])
    const lat = toFiniteNumber(value[1])
    if (lon !== null && lat !== null) return [lon, lat]
  }

  if (value && typeof value === 'object') {
    const lon = toFiniteNumber(value.lon ?? value.lng ?? value.longitude ?? value.x)
    const lat = toFiniteNumber(value.lat ?? value.latitude ?? value.y)
    if (lon !== null && lat !== null) return [lon, lat]
  }

  return null
}

function averageCoordinatePairs(pairs = []) {
  const validPairs = pairs
    .map((item) => toCoordinatePair(item))
    .filter(Boolean)

  if (!validPairs.length) return null

  const totals = validPairs.reduce(
    (acc, [lon, lat]) => {
      acc.lon += lon
      acc.lat += lat
      return acc
    },
    { lon: 0, lat: 0 }
  )

  return {
    lon: roundCoord(totals.lon / validPairs.length),
    lat: roundCoord(totals.lat / validPairs.length)
  }
}

function closeRing(points = []) {
  if (!Array.isArray(points) || points.length < 3) return null

  const ring = points
    .map((point) => toCoordinatePair(point))
    .filter(Boolean)

  if (ring.length < 3) return null

  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first])
  }

  return ring.map(([lon, lat]) => [roundCoord(lon), roundCoord(lat)])
}

function polygonFromRing(ring) {
  const normalized = closeRing(ring)
  if (!normalized || normalized.length < 4) return null
  return {
    type: 'Polygon',
    coordinates: [normalized]
  }
}

function polygonToRing(boundary = null) {
  if (!boundary || typeof boundary !== 'object') return null
  if (boundary.type === 'Polygon' && Array.isArray(boundary.coordinates?.[0])) {
    return closeRing(boundary.coordinates[0])
  }
  if (Array.isArray(boundary.boundary)) {
    return closeRing(boundary.boundary)
  }
  return null
}

function normalizeGeoJsonGeometry(value) {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return normalizeGeoJsonGeometry(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (value.type === 'Feature') {
    return normalizeGeoJsonGeometry(value.geometry)
  }
  if (value.type === 'Polygon' || value.type === 'MultiPolygon') {
    return value
  }
  return null
}

function pointInRing(point, ring = []) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function pointInPolygonGeometry(point, geometry) {
  const normalized = normalizeGeoJsonGeometry(geometry)
  if (!normalized) return false

  if (normalized.type === 'Polygon') {
    const outerRing = closeRing(normalized.coordinates?.[0] || [])
    return outerRing ? pointInRing(point, outerRing) : false
  }

  if (normalized.type === 'MultiPolygon') {
    return normalized.coordinates.some((polygon) => {
      const outerRing = closeRing(polygon?.[0] || [])
      return outerRing ? pointInRing(point, outerRing) : false
    })
  }

  return false
}

function normalizeSurfaceRows(rows = [], source = 'surface') {
  return rows
    .map((row) => {
      const geometry = normalizeGeoJsonGeometry(
        row?.geometry_geojson ?? row?.boundary_geojson ?? row?.geometry ?? null
      )
      if (!geometry) return null
      const id = row?.block_id ?? row?.aoi_id ?? row?.euluc_id ?? row?.id ?? null
      return {
        raw: row,
        id,
        source,
        geometry,
        label: row?.name ?? row?.type ?? row?.land_type ?? String(id ?? source)
      }
    })
    .filter(Boolean)
}

function buildFeatureCollectionFromSurfaceRows(rows = [], source = 'surface') {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      properties: {
        source,
        id: row.id,
        block_id: row.raw?.block_id ?? null,
        aoi_id: row.raw?.aoi_id ?? null,
        euluc_id: row.raw?.euluc_id ?? null,
        label: row.label
      },
      geometry: row.geometry
    }))
  }
}

function extractResultCoordinates(results = []) {
  return results
    .map((item) => toCoordinatePair([item?.lon, item?.lat]))
    .filter(Boolean)
}

function resolvePointStrength(item = {}) {
  const fused = toFiniteNumber(item?.fused_score)
  if (fused !== null) return clamp01(fused)

  const spatial = toFiniteNumber(item?.spatial_score)
  const semantic = toFiniteNumber(item?.semantic_score)
  if (spatial !== null && semantic !== null) return clamp01((spatial + semantic) / 2)
  if (spatial !== null) return clamp01(spatial)
  if (semantic !== null) return clamp01(semantic)
  return 0.5
}

function resolveEffectiveRegionLabel(item = {}) {
  if (item?.regionLabel !== null && item?.regionLabel !== undefined && item?.regionLabel !== '') {
    const value = Number(item.regionLabel)
    return Number.isFinite(value) ? value : item.regionLabel
  }

  const predicted = item?.spatial_info?.region_idx
  const confidence = toFiniteNumber(item?.spatial_info?.region_confidence)
  if (predicted !== null && predicted !== undefined && confidence !== null && confidence >= 0.55) {
    const value = Number(predicted)
    return Number.isFinite(value) ? value : predicted
  }

  return null
}

function collectEncoderRegionStats(results = []) {
  let predictedCount = 0
  let highConfidenceCount = 0
  let alignedCount = 0
  let comparableCount = 0

  for (const item of results) {
    const predicted = item?.spatial_info?.region_idx
    const confidence = toFiniteNumber(item?.spatial_info?.region_confidence)
    if (predicted !== null && predicted !== undefined) {
      predictedCount += 1
      if (confidence !== null && confidence >= 0.55) {
        highConfidenceCount += 1
      }
    }

    if (item?.regionLabel !== null && item?.regionLabel !== undefined && item?.regionLabel !== '' && predicted !== null && predicted !== undefined) {
      comparableCount += 1
      if (Number(item.regionLabel) === Number(predicted)) {
        alignedCount += 1
      }
    }
  }

  return {
    predictedCount,
    highConfidenceCount,
    comparableCount,
    alignmentRate: comparableCount > 0 ? alignedCount / comparableCount : null
  }
}

function withPointStrength(results = []) {
  return results.map((item) => ({
    ...item,
    __pointStrength: resolvePointStrength(item)
  }))
}

function buildCategorySummary(results = []) {
  const bucket = new Map()
  for (const item of results) {
    const category = String(item?.category || '未分类').trim() || '未分类'
    bucket.set(category, (bucket.get(category) || 0) + 1)
  }

  return [...bucket.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}

function averageNumbers(values = []) {
  const valid = values
    .map((value) => toFiniteNumber(value))
    .filter((value) => value !== null)

  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function summarizeSurfaceSupport(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null

  return {
    score: Number((averageNumbers(rows.map((row) => row.score)) || 0).toFixed(4)),
    weighted_support: Number((averageNumbers(rows.map((row) => row.weightedSupport)) || 0).toFixed(4)),
    core_support: Number((averageNumbers(rows.map((row) => row.coreSupport)) || 0).toFixed(4)),
    hit_count: rows.reduce((sum, row) => sum + Number(row.hitCount || 0), 0),
    core_hit_count: rows.reduce((sum, row) => sum + Number(row.coreHitCount || 0), 0)
  }
}

function computeEncoderConsistency({
  results = [],
  dominantRegionResults = [],
  encoderRegionStats = {},
  avgPointStrength = 0
} = {}) {
  if (!Array.isArray(results) || results.length === 0) return 0

  const resultCount = Math.max(1, results.length)
  const predictedCount = Number(encoderRegionStats?.predictedCount || 0)
  const highConfidenceCount = Number(encoderRegionStats?.highConfidenceCount || 0)
  const comparableCount = Number(encoderRegionStats?.comparableCount || 0)
  const dominantPurity = clamp01(dominantRegionResults.length / resultCount)
  const confidenceScore = clamp01(
    averageNumbers(results.map((item) => item?.spatial_info?.region_confidence)) ?? avgPointStrength
  )

  if (predictedCount <= 0) {
    return Number(clamp01(0.2 + dominantPurity * 0.25 + clamp01(avgPointStrength) * 0.15).toFixed(4))
  }

  const alignmentScore = comparableCount > 0
    ? clamp01(encoderRegionStats?.alignmentRate)
    : dominantPurity
  const predictedCoverage = clamp01(predictedCount / resultCount)
  const highConfidenceCoverage = clamp01(highConfidenceCount / resultCount)
  const score = alignmentScore * 0.45
    + dominantPurity * 0.25
    + confidenceScore * 0.2
    + Math.max(predictedCoverage, highConfidenceCoverage) * 0.1

  return Number(clamp01(score).toFixed(4))
}

function extractConstraintSurfaceSupport(vectorConstraint = null) {
  return clamp01(vectorConstraint?.supportSummary?.score ?? 0)
}

function extractConstraintClipCoverage(vectorConstraint = null) {
  return clamp01(
    vectorConstraint?.clipSummary?.coverage
    ?? vectorConstraint?.clipSummary?.transition_coverage
    ?? vectorConstraint?.clipSummary?.outer_coverage
    ?? vectorConstraint?.clipSummary?.core_coverage
    ?? 0
  )
}

function computeRefinedBoundaryConfidence({
  vectorConstraint = null,
  results = [],
  dominantRegionResults = [],
  encoderRegionStats = {},
  avgPointStrength = 0
} = {}) {
  if (!vectorConstraint || (!vectorConstraint?.supportSummary && !vectorConstraint?.clipSummary)) {
    return null
  }

  const encoderConsistency = computeEncoderConsistency({
    results,
    dominantRegionResults,
    encoderRegionStats,
    avgPointStrength
  })
  const surfaceSupport = extractConstraintSurfaceSupport(vectorConstraint)
  const clipCoverage = extractConstraintClipCoverage(vectorConstraint)
  const confidence = clamp01(
    encoderConsistency * 0.45
    + surfaceSupport * 0.3
    + clipCoverage * 0.25
  )

  return {
    confidence: Number(confidence.toFixed(4)),
    model: 'v3_encoder_surface_confidence_v2',
    components: {
      encoder_consistency: encoderConsistency,
      surface_support: Number(surfaceSupport.toFixed(4)),
      clip_coverage: Number(clipCoverage.toFixed(4))
    }
  }
}

function evaluateSurfaceSupport(surfaceRows = [], weightedResults = [], coreResults = []) {
  const totalWeight = Math.max(
    1e-9,
    weightedResults.reduce((sum, item) => sum + (item.__pointStrength || 0), 0)
  )
  const coreTotalWeight = Math.max(
    1e-9,
    coreResults.reduce((sum, item) => sum + (item.__pointStrength || 0), 0)
  )

  return surfaceRows
    .map((row) => {
      const hits = weightedResults.filter((item) => pointInPolygonGeometry([item.lon, item.lat], row.geometry))
      const coreHits = coreResults.filter((item) => pointInPolygonGeometry([item.lon, item.lat], row.geometry))
      const weightedSupport = hits.reduce((sum, item) => sum + (item.__pointStrength || 0), 0) / totalWeight
      const coreSupport = coreHits.reduce((sum, item) => sum + (item.__pointStrength || 0), 0) / coreTotalWeight
      const hitCount = hits.length
      const coreHitCount = coreHits.length
      const score = coreSupport * 0.55 + weightedSupport * 0.35 + Math.min(hitCount / Math.max(1, weightedResults.length), 1) * 0.1
      return {
        ...row,
        hitCount,
        coreHitCount,
        weightedSupport,
        coreSupport,
        score
      }
    })
    .filter((row) => row.hitCount > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return Number(left.id ?? 0) - Number(right.id ?? 0)
    })
}

function selectSurfaceRows(evaluated = []) {
  const outerRows = evaluated.filter((row) => row.coreHitCount > 0 || row.weightedSupport >= 0.12)
  const boundaryRows = evaluated.filter((row) => row.coreHitCount > 0 || row.weightedSupport >= 0.22)
  const coreRows = evaluated.filter((row) => row.coreHitCount > 0)

  return {
    outerRows: outerRows.length ? outerRows : boundaryRows,
    boundaryRows: boundaryRows.length ? boundaryRows : evaluated.slice(0, 1),
    coreRows: coreRows.length ? coreRows : (boundaryRows.length ? boundaryRows : evaluated.slice(0, 1))
  }
}

function dedupePoints(points = []) {
  const unique = new Map()
  for (const point of points) {
    const pair = toCoordinatePair(point)
    if (!pair) continue
    const key = `${pair[0].toFixed(6)}:${pair[1].toFixed(6)}`
    if (!unique.has(key)) unique.set(key, pair)
  }
  return [...unique.values()]
}

function comparePoint(a, b) {
  if (a[0] === b[0]) return a[1] - b[1]
  return a[0] - b[0]
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function computeConvexHull(points = []) {
  const sorted = [...dedupePoints(points)].sort(comparePoint)
  if (sorted.length < 3) return null

  const lower = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return closeRing(lower.concat(upper))
}

function buildPaddedEnvelope(points = [], options = {}) {
  const validPoints = dedupePoints(points)
  if (!validPoints.length) return null

  const lonValues = validPoints.map(([lon]) => lon)
  const latValues = validPoints.map(([, lat]) => lat)
  const minLon = Math.min(...lonValues)
  const maxLon = Math.max(...lonValues)
  const minLat = Math.min(...latValues)
  const maxLat = Math.max(...latValues)

  const lonSpan = maxLon - minLon
  const latSpan = maxLat - minLat
  const paddingRatio = Number.isFinite(Number(options.paddingRatio)) ? Number(options.paddingRatio) : 0.12
  const minPadding = Number.isFinite(Number(options.minPadding)) ? Number(options.minPadding) : 0.0008
  const paddingLon = Math.max(lonSpan * paddingRatio, minPadding)
  const paddingLat = Math.max(latSpan * paddingRatio, minPadding)

  return polygonFromRing([
    [minLon - paddingLon, minLat - paddingLat],
    [maxLon + paddingLon, minLat - paddingLat],
    [maxLon + paddingLon, maxLat + paddingLat],
    [minLon - paddingLon, maxLat + paddingLat]
  ])
}

function ringArea(ring = []) {
  if (!Array.isArray(ring) || ring.length < 4) return 0

  let area = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[index + 1]
    area += x1 * y2 - x2 * y1
  }

  return area / 2
}

function scaleRing(ring = [], factor = 1) {
  const normalized = closeRing(ring)
  if (!normalized || normalized.length < 4) return normalized

  const center = averageCoordinatePairs(normalized.slice(0, -1))
  if (!center) return normalized

  const minDelta = 0.00012
  const scaled = normalized.slice(0, -1).map(([lon, lat]) => {
    let nextLon = center.lon + (lon - center.lon) * factor
    let nextLat = center.lat + (lat - center.lat) * factor

    if (Math.abs(nextLon - center.lon) < minDelta) {
      nextLon = center.lon + Math.sign(lon - center.lon || 1) * minDelta
    }
    if (Math.abs(nextLat - center.lat) < minDelta) {
      nextLat = center.lat + Math.sign(lat - center.lat || 1) * minDelta
    }

    return [nextLon, nextLat]
  })

  return closeRing(scaled)
}

export function buildBoundaryFromPointSet(points = [], options = {}) {
  const validPoints = dedupePoints(points)
  if (!validPoints.length) {
    return { polygon: null, method: 'empty', pointCount: 0 }
  }

  if (validPoints.length < 3) {
    return {
      polygon: buildPaddedEnvelope(validPoints, options),
      method: 'bbox_padding_fallback_v1',
      pointCount: validPoints.length
    }
  }

  const hull = computeConvexHull(validPoints)
  if (!hull || hull.length < 4 || Math.abs(ringArea(hull)) < 1e-12) {
    return {
      polygon: buildPaddedEnvelope(validPoints, options),
      method: 'bbox_padding_fallback_v1',
      pointCount: validPoints.length
    }
  }

  const expandFactor = Number.isFinite(Number(options.expandFactor)) ? Number(options.expandFactor) : 1.04
  const expandedRing = expandFactor === 1 ? hull : scaleRing(hull, expandFactor)

  return {
    polygon: polygonFromRing(expandedRing),
    method: 'convex_hull_scaled_v1',
    pointCount: validPoints.length
  }
}

function buildLayerBundle(boundary = null, options = {}) {
  const ring = polygonToRing(boundary)
  if (!ring) return null

  const outerFactor = Number.isFinite(Number(options.outerFactor)) ? Number(options.outerFactor) : 1.08
  const coreFactor = Number.isFinite(Number(options.coreFactor)) ? Number(options.coreFactor) : 0.78
  const outer = polygonFromRing(scaleRing(ring, outerFactor)) || boundary
  const transition = polygonFromRing(ring) || boundary
  const core = polygonFromRing(scaleRing(ring, coreFactor)) || transition || boundary

  return {
    outer: {
      boundary: outer,
      geojson: outer,
      confidence: 0.58
    },
    transition: {
      boundary: transition,
      geojson: transition,
      confidence: 0.68
    },
    core: {
      boundary: core,
      geojson: core,
      confidence: 0.78
    }
  }
}

function groupResultsByRegion(results = []) {
  const grouped = new Map()

  for (const item of results) {
    const label = resolveEffectiveRegionLabel(item)
    if (label === null || label === undefined || label === '') continue
    const key = String(label)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(item)
  }

  return [...grouped.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((left, right) => right.items.length - left.items.length)
}

function buildRegionName(regionLabel) {
  const labelNumber = Number(regionLabel)
  if (Number.isFinite(labelNumber) && Object.prototype.hasOwnProperty.call(REGION_LABEL_NAMES, labelNumber)) {
    return REGION_LABEL_NAMES[labelNumber]
  }
  return `区域 ${regionLabel}`
}

function buildVernacularRegions(results = [], fallbackBoundary = null) {
  const weightedResults = withPointStrength(results)
  const groups = groupResultsByRegion(weightedResults)
  const total = Math.max(1, results.length)

  return groups.map(({ key, items }, index) => {
    const boundaryInfo = buildBoundaryFromPointSet(extractResultCoordinates(items), {
      expandFactor: 1.02,
      minPadding: 0.00035
    })
    const boundary = boundaryInfo.polygon || fallbackBoundary
    const layers = buildLayerBundle(boundary)
    const center = averageCoordinatePairs(extractResultCoordinates(items))
    const avgStrength = items.length
      ? items.reduce((sum, item) => sum + (item.__pointStrength || 0), 0) / items.length
      : 0
    const boundaryConfidence = Number((Math.min(0.96, 0.45 + items.length * 0.04 + avgStrength * 0.22)).toFixed(2))

    return {
      id: `region-${key}`,
      name: buildRegionName(key),
      region_label: Number.isFinite(Number(key)) ? Number(key) : key,
      membership: {
        score: Number((items.length / total).toFixed(4))
      },
      dominant_categories: buildCategorySummary(items).slice(0, 3),
      center: center ? [center.lon, center.lat] : null,
      boundary,
      boundary_geojson: boundary,
      boundary_confidence: boundaryConfidence,
      boundary_method: boundaryInfo.method,
      point_count: items.length,
      layers,
      rank: index + 1
    }
  })
}

function dominantRegionKey(results = []) {
  const grouped = groupResultsByRegion(results)
  return grouped[0]?.key ?? null
}

function pickDominantRegionResults(results = []) {
  const key = dominantRegionKey(results)
  if (key === null) return []
  return results.filter((item) => String(resolveEffectiveRegionLabel(item)) === String(key))
}

function pickCoreSignalResults(results = []) {
  const weighted = withPointStrength(results)
    .sort((left, right) => (right.__pointStrength || 0) - (left.__pointStrength || 0))

  if (weighted.length <= 3) return weighted

  const dominantRegion = dominantRegionKey(weighted)
  const regional = dominantRegion === null
    ? weighted
    : weighted.filter((item) => String(resolveEffectiveRegionLabel(item)) === String(dominantRegion))

  const source = regional.length >= 3 ? regional : weighted
  const coreCount = Math.max(3, Math.ceil(source.length * 0.45))
  return source.slice(0, Math.min(coreCount, source.length))
}

function buildVectorConstraintContext(weightedResults = [], surfaceContext = null) {
  if (!surfaceContext || typeof surfaceContext !== 'object') return null

  const coreResults = pickCoreSignalResults(weightedResults)
  const sources = [
    { key: 'roadBlocks', source: 'road_blocks', method: 'road_block_support_v1' },
    { key: 'osmAoiFeatures', source: 'osm_aoi', method: 'aoi_support_v1' },
    { key: 'eulucFeatures', source: 'euluc', method: 'euluc_support_v1' }
  ]

  for (const item of sources) {
    const rows = normalizeSurfaceRows(surfaceContext[item.key], item.source)
    if (!rows.length) continue

    const evaluated = evaluateSurfaceSupport(rows, weightedResults, coreResults)
    if (!evaluated.length) continue

    const selected = selectSurfaceRows(evaluated)
    const boundaryRows = selected.boundaryRows
    if (!boundaryRows.length) continue

    return {
      source: item.source,
      method: item.method,
      boundary: buildFeatureCollectionFromSurfaceRows(boundaryRows, item.source),
      outerBoundary: buildFeatureCollectionFromSurfaceRows(selected.outerRows, item.source),
      transitionBoundary: buildFeatureCollectionFromSurfaceRows(boundaryRows, item.source),
      coreBoundary: buildFeatureCollectionFromSurfaceRows(selected.coreRows, item.source),
      outerSelectedIds: selected.outerRows.map((row) => row.id).filter((value) => value !== null),
      transitionSelectedIds: boundaryRows.map((row) => row.id).filter((value) => value !== null),
      coreSelectedIds: selected.coreRows.map((row) => row.id).filter((value) => value !== null),
      selectedCount: boundaryRows.length,
      rejectedCount: Math.max(0, rows.length - boundaryRows.length),
      selectedIds: boundaryRows.map((row) => row.id).filter((value) => value !== null),
      supportSummary: summarizeSurfaceSupport(boundaryRows)
    }
  }

  return null
}

export function selectVectorConstraintContext(results = [], surfaceContext = null) {
  const weightedResults = Array.isArray(results) ? withPointStrength(results) : []
  return buildVectorConstraintContext(weightedResults, surfaceContext)
}

function buildHotspots(results = [], boundary = null, vernacularRegions = []) {
  if (!Array.isArray(results) || results.length === 0) return []

  const stableRegions = vernacularRegions.filter((region) => Number(region?.point_count) >= 2)
  if (stableRegions.length > 0 && results.length >= 4) {
    return stableRegions.slice(0, 3).map((region, index) => ({
      id: `hotspot-${index + 1}`,
      name: region.name,
      poiCount: region.point_count,
      center: region.center,
      dominant_categories: region.dominant_categories,
      boundary: region.boundary_geojson,
      boundary_geojson: region.boundary_geojson,
      boundary_confidence: region.boundary_confidence,
      boundary_method: region.boundary_method
    }))
  }

  const center = averageCoordinatePairs(extractResultCoordinates(results))
  return [
    {
      id: 'hotspot-1',
      name: '空间热点',
      poiCount: results.length,
      center: center ? [center.lon, center.lat] : null,
      dominant_categories: buildCategorySummary(results).slice(0, 3),
      boundary,
      boundary_geojson: boundary,
      boundary_confidence: 0.64,
      boundary_method: boundary ? 'result_boundary_v1' : 'none'
    }
  ]
}

function buildFuzzyRegions(
  results = [],
  boundary = null,
  vernacularRegions = [],
  anchor = null,
  layerOverrides = null,
  options = {}
) {
  if (!boundary || !Array.isArray(results) || results.length === 0) return []

  const transitionResults = Array.isArray(options.transitionResults)
    ? options.transitionResults
    : pickDominantRegionResults(results)
  const coreResults = Array.isArray(options.coreResults)
    ? options.coreResults
    : pickCoreSignalResults(results)
  const transitionBoundaryInfo = transitionResults.length >= 3
    ? buildBoundaryFromPointSet(extractResultCoordinates(transitionResults), { expandFactor: 1.01, minPadding: 0.00028 })
    : { polygon: null }
  const coreBoundaryInfo = coreResults.length >= 3
    ? buildBoundaryFromPointSet(extractResultCoordinates(coreResults), { expandFactor: 1.0, minPadding: 0.00022 })
    : { polygon: null }

  const layers = {
    outer: {
      boundary: layerOverrides?.outerBoundary || boundary,
      geojson: layerOverrides?.outerBoundary || boundary,
      confidence: 0.58
    },
    transition: {
      boundary: layerOverrides?.transitionBoundary || transitionBoundaryInfo.polygon || boundary,
      geojson: layerOverrides?.transitionBoundary || transitionBoundaryInfo.polygon || boundary,
      confidence: 0.68
    },
    core: {
      boundary: layerOverrides?.coreBoundary || coreBoundaryInfo.polygon || transitionBoundaryInfo.polygon || boundary,
      geojson: layerOverrides?.coreBoundary || coreBoundaryInfo.polygon || transitionBoundaryInfo.polygon || boundary,
      confidence: 0.78
    }
  }
  if (!layers) return []

  const topCategory = buildCategorySummary(results)[0]?.category || '活力'
  const preferredName = vernacularRegions[0]?.name || `${topCategory}片区`
  const centerFromBoundary = averageCoordinatePairs(polygonToRing(boundary)?.slice(0, -1))
  const center = centerFromBoundary || (
    anchor && Number.isFinite(Number(anchor.lon)) && Number.isFinite(Number(anchor.lat))
      ? { lon: roundCoord(anchor.lon), lat: roundCoord(anchor.lat) }
      : null
  )
  const confidence = Number((
    options.boundaryConfidence
    ?? Math.min(0.9, 0.6 + results.length * 0.025)
  ).toFixed(4))

  return [
    {
      id: 'fuzzy-region-1',
      name: preferredName,
      level: 'transition',
      center: center ? [center.lon, center.lat] : null,
      boundary,
      boundary_geojson: layers.transition.geojson,
      boundary_confidence: confidence,
      membership: {
        score: Number((0.48 + clamp01(results.length / 20) * 0.32).toFixed(4)),
        level: 'transition'
      },
      layers,
      hierarchy: {
        macro_name: '查询片区',
        micro_name: preferredName,
        level: 'transition',
        rank_in_macro: 1,
        macro_size: 1,
        layer_mode: 'multi_layer'
      },
      ambiguity: {
        score: Number((1 - confidence).toFixed(2)),
        flags: results.length < 4 ? ['small_sample'] : []
      },
      signal_summary: {
        dominant_region_label: options.dominantRegion ?? dominantRegionKey(results),
        transition_point_count: transitionResults.length,
        core_point_count: coreResults.length,
        score_model: options.signalModel || 'encoder_region_fused_v1',
        boundary_confidence_model: options.boundaryConfidenceModel || null,
        boundary_confidence_components: options.boundaryConfidenceComponents || null
      }
    }
  ]
}

export function buildSpatialGeometryEvidence({
  filteredResults = [],
  explicitBoundary = null,
  anchor = null,
  surfaceContext = null,
  surfaceConstraint = null
} = {}) {
  const weightedResults = withPointStrength(filteredResults)
  const pointCoordinates = extractResultCoordinates(weightedResults)

  let boundary = explicitBoundary
  let boundarySource = explicitBoundary ? 'spatial_context.boundary' : 'result_points'
  let boundaryMethod = explicitBoundary ? 'selection_boundary_v1' : 'empty'
  let boundaryPointCount = explicitBoundary ? pointCoordinates.length : 0
  const dominantRegion = dominantRegionKey(weightedResults)
  const dominantRegionResults = pickDominantRegionResults(weightedResults)
  const coreSignalResults = pickCoreSignalResults(weightedResults)
  const pointStrengthValues = weightedResults.map((item) => item.__pointStrength || 0)
  const avgPointStrength = pointStrengthValues.length
    ? pointStrengthValues.reduce((sum, value) => sum + value, 0) / pointStrengthValues.length
    : 0
  const encoderRegionPurity = weightedResults.length
    ? dominantRegionResults.length / weightedResults.length
    : 0
  const encoderRegionStats = collectEncoderRegionStats(weightedResults)

  if (!boundary && pointCoordinates.length > 0) {
    const boundaryInfo = buildBoundaryFromPointSet(pointCoordinates)
    boundary = boundaryInfo.polygon
    boundaryMethod = boundaryInfo.method
    boundaryPointCount = boundaryInfo.pointCount
  }

  const vectorConstraint = surfaceConstraint || buildVectorConstraintContext(weightedResults, surfaceContext)
  if (vectorConstraint?.boundary) {
    boundary = vectorConstraint.boundary
    boundarySource = vectorConstraint.source || 'vector_constraint'
    boundaryMethod = vectorConstraint.method
    boundaryPointCount = vectorConstraint.selectedCount
  }

  const vernacularRegions = buildVernacularRegions(weightedResults, boundary)
  const hotspots = buildHotspots(weightedResults, boundary, vernacularRegions)
  const refinedBoundaryConfidence = computeRefinedBoundaryConfidence({
    vectorConstraint,
    results: weightedResults,
    dominantRegionResults,
    encoderRegionStats,
    avgPointStrength
  })
  const fuzzyRegions = buildFuzzyRegions(
    weightedResults,
    boundary,
    vernacularRegions,
    anchor,
    vectorConstraint,
    {
      dominantRegion,
      transitionResults: dominantRegionResults,
      coreResults: coreSignalResults,
      signalModel: 'encoder_region_fused_v1',
      boundaryConfidence: refinedBoundaryConfidence?.confidence,
      boundaryConfidenceModel: refinedBoundaryConfidence?.model || null,
      boundaryConfidenceComponents: refinedBoundaryConfidence?.components || null
    }
  )

  const confidenceValues = [
    ...hotspots.map((item) => toFiniteNumber(item?.boundary_confidence)).filter((value) => value !== null),
    ...vernacularRegions.map((item) => toFiniteNumber(item?.boundary_confidence)).filter((value) => value !== null),
    ...fuzzyRegions.map((item) => toFiniteNumber(item?.boundary_confidence)).filter((value) => value !== null)
  ]

  const avgBoundaryConfidence = confidenceValues.length
    ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(2))
    : (boundary ? 0.64 : 0)

  return {
    boundary,
    boundarySource,
    boundaryMethod,
    boundaryPointCount,
    spatialClusters: { hotspots },
    vernacularRegions,
    fuzzyRegions,
    avgBoundaryConfidence,
    boundaryConfidenceModel: refinedBoundaryConfidence?.model || (boundary ? 'v3_l5_geometry_v1' : 'none'),
    signalModel: 'encoder_region_fused_v1',
    dominantRegionLabel: dominantRegion,
    encoderRegionPurity: Number(encoderRegionPurity.toFixed(4)),
    encoderScoreMean: Number(avgPointStrength.toFixed(4)),
    encoderCorePointCount: coreSignalResults.length,
    encoderTransitionPointCount: dominantRegionResults.length,
    encoderRegionPredictedCount: encoderRegionStats.predictedCount,
    encoderRegionHighConfidenceCount: encoderRegionStats.highConfidenceCount,
    encoderRegionAlignmentRate: encoderRegionStats.alignmentRate !== null
      ? Number(encoderRegionStats.alignmentRate.toFixed(4))
      : null,
    vectorConstraintSummary: vectorConstraint
      ? {
          source: vectorConstraint.source,
          selected_count: vectorConstraint.selectedCount,
          rejected_count: vectorConstraint.rejectedCount,
          selected_ids: vectorConstraint.selectedIds,
          surface_support_score: Number((vectorConstraint.supportSummary?.score ?? 0).toFixed(4)),
          surface_weighted_support: Number((vectorConstraint.supportSummary?.weighted_support ?? 0).toFixed(4)),
          surface_core_support: Number((vectorConstraint.supportSummary?.core_support ?? 0).toFixed(4)),
          clip_coverage: Number((
            vectorConstraint.clipSummary?.coverage
            ?? vectorConstraint.clipSummary?.transition_coverage
            ?? vectorConstraint.clipSummary?.outer_coverage
            ?? vectorConstraint.clipSummary?.core_coverage
            ?? 0
          ).toFixed(4)),
          clip_outer_coverage: Number((vectorConstraint.clipSummary?.outer_coverage ?? 0).toFixed(4)),
          clip_transition_coverage: Number((vectorConstraint.clipSummary?.transition_coverage ?? 0).toFixed(4)),
          clip_core_coverage: Number((vectorConstraint.clipSummary?.core_coverage ?? 0).toFixed(4))
        }
      : null
  }
}

export default {
  buildBoundaryFromPointSet,
  buildSpatialGeometryEvidence,
  selectVectorConstraintContext
}
