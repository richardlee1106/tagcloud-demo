/**
 * Node SQL ????????
 *
 * ???
 * 1) ? Python ???????????????????
 * 2) ???? legacy Node ??????????????????
 * 3) ?? /api/ai/execute ? jobs ???????????
 */

import db from './database.js'

const ADVANCED_QUERY_TYPES = new Set([
  'area_analysis',
  'fuzzy_regions',
  'vernacular_region',
  'graph_reasoning',
  'region_comparison'
])

function normalizeQueryType(queryPlan = {}) {
  const rawType = queryPlan?.query_type || queryPlan?.queryType || 'poi_search'
  return String(rawType).trim().toLowerCase() || 'poi_search'
}

function toNumber(value, fallback = NaN) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizePoint(input) {
  if (!input) return null

  if (Array.isArray(input) && input.length >= 2) {
    const lon = toNumber(input[0])
    const lat = toNumber(input[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat }
    }
    return null
  }

  const lon = toNumber(input.lon ?? input.lng ?? input.longitude)
  const lat = toNumber(input.lat ?? input.latitude)
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return { lon, lat }
  }

  return null
}

function normalizeDirection(direction) {
  const raw = String(direction || '').trim().toLowerCase()
  if (!raw) return null

  const map = {
    east: '?',
    west: '?',
    south: '?',
    north: '?',
    northeast: '??',
    northwest: '??',
    southeast: '??',
    southwest: '??',
    '?': '?',
    '?': '?',
    '?': '?',
    '?': '?',
    '??': '??',
    '??': '??',
    '??': '??',
    '??': '??'
  }

  return map[raw] || null
}

function normalizeLimit(value, fallback = 300, max = 2000) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(max, Math.max(1, Math.floor(parsed)))
}

function buildPolygonWKT(rawBoundary) {
  if (!Array.isArray(rawBoundary) || rawBoundary.length < 3) return null

  const points = []
  for (const raw of rawBoundary) {
    const point = normalizePoint(raw)
    if (point) points.push(point)
  }

  if (points.length < 3) return null

  const first = points[0]
  const last = points[points.length - 1]
  if (first.lon !== last.lon || first.lat !== last.lat) {
    points.push(first)
  }

  const coordinateText = points.map((point) => `${point.lon} ${point.lat}`).join(', ')
  return `POLYGON((${coordinateText}))`
}

function buildViewportWKT(viewport) {
  if (!Array.isArray(viewport) || viewport.length < 4) return null

  const minLon = toNumber(viewport[0])
  const minLat = toNumber(viewport[1])
  const maxLon = toNumber(viewport[2])
  const maxLat = toNumber(viewport[3])

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
    return null
  }

  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`
}

function buildGeometryWKTList(spatialContext = {}) {
  const wkts = []

  const regions = Array.isArray(spatialContext?.regions) ? spatialContext.regions : []
  for (const region of regions) {
    if (!region || typeof region !== 'object') continue

    if (typeof region.boundaryWKT === 'string' && region.boundaryWKT.trim()) {
      wkts.push(region.boundaryWKT.trim())
      continue
    }

    if (typeof region.wkt === 'string' && region.wkt.trim()) {
      wkts.push(region.wkt.trim())
      continue
    }

    const geometry = region.geometry
    if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
      const polygonWKT = buildPolygonWKT(geometry.coordinates[0])
      if (polygonWKT) wkts.push(polygonWKT)
    }
  }

  if (wkts.length > 0) {
    return wkts
  }

  const boundaryWKT = buildPolygonWKT(spatialContext?.boundary)
  if (boundaryWKT) {
    return [boundaryWKT]
  }

  const viewportWKT = buildViewportWKT(spatialContext?.viewport)
  if (viewportWKT) {
    return [viewportWKT]
  }

  return []
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function collectCategories(queryPlan = {}, options = {}) {
  const fromPlan = normalizeTextArray(queryPlan.categories)
  const fromSelected = normalizeTextArray(options.selectedCategories || options.selected_categories)
  const fromPolicy = normalizeTextArray(options?.sourcePolicy?.selected_categories)

  const merged = [...fromPlan, ...fromSelected, ...fromPolicy]
  const dedup = []
  const seen = new Set()
  for (const item of merged) {
    const key = item.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      dedup.push(item)
    }
  }

  return dedup
}

function collectTerms(queryPlan = {}) {
  const terms = []

  const candidateArrays = [
    queryPlan.terms,
    queryPlan.keywords,
    queryPlan.search_terms,
    queryPlan.semantic_terms
  ]

  for (const arr of candidateArrays) {
    for (const term of normalizeTextArray(arr)) {
      terms.push(term)
    }
  }

  if (typeof queryPlan.semantic_query === 'string' && queryPlan.semantic_query.trim()) {
    terms.push(queryPlan.semantic_query.trim())
  }

  const dedup = []
  const seen = new Set()
  for (const term of terms) {
    const key = term.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      dedup.push(term)
    }
  }

  return dedup
}

function pickAnchor(queryPlan = {}, spatialContext = {}) {
  return (
    normalizePoint(queryPlan?.anchor) ||
    normalizePoint(spatialContext?.center) ||
    null
  )
}

function dedupePOIs(rows = [], limit = 300) {
  const results = []
  const seen = new Set()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue

    const key = row.id
      ? `id:${row.id}`
      : `n:${String(row.name || '').trim().toLowerCase()}|${Number(row.lon || 0).toFixed(6)}|${Number(row.lat || 0).toFixed(6)}`

    if (seen.has(key)) continue
    seen.add(key)
    results.push(row)

    if (results.length >= limit) break
  }

  return results
}

function containsText(rawText, term) {
  const left = String(rawText || '').toLowerCase()
  const right = String(term || '').toLowerCase()
  return Boolean(right) && left.includes(right)
}

function postFilterRows(rows = [], categories = [], terms = []) {
  const categoryKeys = categories.map((item) => String(item).toLowerCase())
  const termKeys = terms.map((item) => String(item).toLowerCase())

  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false

    if (categoryKeys.length > 0) {
      const fields = [row.category_big, row.category_mid, row.category_small, row.type, row.name]
      const categoryHit = categoryKeys.some((cat) => fields.some((field) => containsText(field, cat)))
      if (!categoryHit) return false
    }

    if (termKeys.length > 0) {
      const fields = [row.name, row.address, row.category_big, row.category_mid, row.category_small, row.type]
      const termHit = termKeys.some((term) => fields.some((field) => containsText(field, term)))
      if (!termHit) return false
    }

    return true
  })
}

function emptyGraphReasoningSummary() {
  return {
    node_count: 0,
    edge_count: 0,
    component_count: 0,
    components: [],
    top_hubs: [],
    avg_degree: 0,
    distance_threshold_m: 280
  }
}

function buildAdvancedShape(queryType, categories = []) {
  const base = {
    mode: `${queryType}_sql_fallback`,
    pois: [],
    boundary: null,
    spatial_clusters: { hotspots: [] },
    vernacular_regions: [],
    fuzzy_regions: [],
    graph_reasoning: emptyGraphReasoningSummary()
  }

  if (queryType === 'region_comparison') {
    return {
      ...base,
      target_regions: [],
      region_analyses: [],
      comparison: {
        summary: 'Node SQL fallback does not execute full region comparison modeling.',
        dimensions: categories
      }
    }
  }

  if (queryType === 'graph_reasoning') {
    return {
      ...base,
      graph_analysis: {
        summary: 'Node SQL fallback skips heavy graph inference.',
        top_hubs: []
      }
    }
  }

  return base
}

async function fetchRowsByGeometry({ geometryWKT, categories, terms, limit }) {
  if (terms.length > 0) {
    const rows = await db.quickSearch({
      terms,
      geometryWKT,
      limit
    })
    return postFilterRows(rows, categories, [])
  }

  const rows = await db.findPOIsFiltered({
    geometry: geometryWKT,
    categories,
    limit
  })
  return postFilterRows(rows, [], terms)
}

async function fetchRowsByAnchor({ anchor, direction, radiusM, categories, terms, limit }) {
  if (anchor && direction) {
    const rows = await db.findPOIsByDirection(anchor.lon, anchor.lat, direction, radiusM)
    return dedupePOIs(postFilterRows(rows, categories, terms), limit)
  }

  if (terms.length > 0) {
    const rows = await db.quickSearch({
      terms,
      center: anchor,
      radius: radiusM,
      limit
    })
    return dedupePOIs(postFilterRows(rows, categories, []), limit)
  }

  const rows = await db.findPOIsFiltered({
    anchor,
    radius_m: radiusM,
    categories,
    limit
  })

  return dedupePOIs(postFilterRows(rows, [], terms), limit)
}

export async function executeNodeSqlFallback({
  queryPlan = {},
  spatialContext = {},
  options = {},
  fallbackReasons = []
} = {}) {
  const queryType = normalizeQueryType(queryPlan)
  const categories = collectCategories(queryPlan, options)
  const terms = collectTerms(queryPlan)
  const limit = normalizeLimit(options.maxResults || options.limit || queryPlan.limit, 300, 2500)
  const radiusM = normalizeLimit(queryPlan.radius_m || options.radius_m, 2000, 50000)
  const direction = normalizeDirection(queryPlan.direction || queryPlan.spatial_direction)

  if (ADVANCED_QUERY_TYPES.has(queryType)) {
    return {
      success: true,
      results: {
        ...buildAdvancedShape(queryType, categories),
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: queryType,
          executor_engine: 'node_sql_fallback',
          degraded: true,
          categories,
          terms,
          fallback_reasons: fallbackReasons
        }
      },
      diagnostics: {
        engine: 'node-sql-fallback',
        query_type: queryType,
        fallback_reasons: fallbackReasons,
        degraded: true
      }
    }
  }

  const geometryWKTs = buildGeometryWKTList(spatialContext)
  const anchor = pickAnchor(queryPlan, spatialContext)
  const allRows = []

  if (geometryWKTs.length > 0) {
    const perRegionLimit = Math.max(20, Math.ceil(limit / geometryWKTs.length))

    for (const geometryWKT of geometryWKTs) {
      const rows = await fetchRowsByGeometry({
        geometryWKT,
        categories,
        terms,
        limit: perRegionLimit
      })
      allRows.push(...rows)
    }
  } else if (anchor) {
    const rows = await fetchRowsByAnchor({
      anchor,
      direction,
      radiusM,
      categories,
      terms,
      limit
    })
    allRows.push(...rows)
  }

  const pois = dedupePOIs(postFilterRows(allRows, categories, terms), limit)

  return {
    success: true,
    results: {
      mode: 'node_sql_fallback',
      pois,
      boundary: null,
      spatial_clusters: { hotspots: [] },
      vernacular_regions: [],
      fuzzy_regions: [],
      graph_reasoning: emptyGraphReasoningSummary(),
      stats: {
        total_candidates: pois.length,
        cluster_count: 0,
        query_type: queryType,
        executor_engine: 'node_sql_fallback',
        degraded: false,
        geometry_count: geometryWKTs.length,
        categories,
        terms,
        direction
      }
    },
    diagnostics: {
      engine: 'node-sql-fallback',
      query_type: queryType,
      geometry_count: geometryWKTs.length,
      used_anchor: Boolean(anchor),
      fallback_reasons: fallbackReasons
    }
  }
}

export default {
  executeNodeSqlFallback
}
