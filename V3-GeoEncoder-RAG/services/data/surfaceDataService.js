import { query } from './database.js'

function toFiniteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

function closeRing(points = []) {
  const ring = (Array.isArray(points) ? points : [])
    .map((item) => toCoordinatePair(item))
    .filter(Boolean)

  if (ring.length < 3) return null

  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first])
  }

  return ring
}

function ringToWkt(ring = []) {
  const normalized = closeRing(ring)
  if (!normalized || normalized.length < 4) return null
  return `POLYGON((${normalized.map(([lon, lat]) => `${lon} ${lat}`).join(', ')}))`
}

function bboxToWkt(bounds = null) {
  if (!Array.isArray(bounds) || bounds.length < 4) return null
  const [minLon, minLat, maxLon, maxLat] = bounds.map((value) => Number(value))
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null
  return `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`
}

function resultsToWkt(results = []) {
  const points = results
    .map((item) => toCoordinatePair([item?.lon, item?.lat]))
    .filter(Boolean)

  if (!points.length) return null

  const lonValues = points.map(([lon]) => lon)
  const latValues = points.map(([, lat]) => lat)
  const minLon = Math.min(...lonValues)
  const maxLon = Math.max(...lonValues)
  const minLat = Math.min(...latValues)
  const maxLat = Math.max(...latValues)
  const lonSpan = maxLon - minLon
  const latSpan = maxLat - minLat
  const paddingLon = Math.max(lonSpan * 0.12, 0.0008)
  const paddingLat = Math.max(latSpan * 0.12, 0.0008)

  return bboxToWkt([
    minLon - paddingLon,
    minLat - paddingLat,
    maxLon + paddingLon,
    maxLat + paddingLat
  ])
}

export function buildSurfaceQueryWkt({ spatialContext = null, filteredResults = [] } = {}) {
  const boundaryWkt = ringToWkt(spatialContext?.boundary)
  if (boundaryWkt) return boundaryWkt

  const viewportWkt = bboxToWkt(spatialContext?.viewport)
  if (viewportWkt) return viewportWkt

  return resultsToWkt(filteredResults)
}

const SURFACE_SOURCE_CONFIG = Object.freeze({
  road_blocks: { table: 'wuhan_road_blocks', idColumn: 'block_id' },
  osm_aoi: { table: 'wuhan_osm_aoi', idColumn: 'aoi_id' },
  euluc: { table: 'wuhan_euluc', idColumn: 'euluc_id' }
})

function normalizeCoverage(value) {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(4))
}

async function refineLayerGeometry({ queryWkt, source, ids = [], dbQuery = query } = {}) {
  const config = SURFACE_SOURCE_CONFIG[source]
  const normalizedIds = [...new Set((ids || []).map((value) => Number(value)).filter(Number.isFinite))]
  if (!config || !queryWkt || normalizedIds.length === 0) return null

  const sql = `
    WITH selected AS (
      SELECT geom
      FROM ${config.table}
      WHERE ${config.idColumn} = ANY($2::int[])
    ),
    unioned AS (
      SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom
      FROM selected
    ),
    clipped AS (
      SELECT ST_Intersection(geom, ST_GeomFromText($1, 4326)) AS geom
      FROM unioned
    )
    SELECT ST_AsGeoJSON(ST_MakeValid(geom))::json AS geometry_geojson
    FROM clipped
  `

  const result = await dbQuery(sql, [queryWkt, normalizedIds])
  return result?.rows?.[0]?.geometry_geojson || null
}

export async function refineSurfaceConstraintGeometry({
  queryWkt,
  constraint = null,
  dbQuery = query
} = {}) {
  if (!constraint || typeof constraint !== 'object' || typeof queryWkt !== 'string' || !queryWkt.trim()) {
    return null
  }

  const source = constraint.source
  const outerSelectedIds = constraint.outerSelectedIds || constraint.selectedIds || []
  const transitionSelectedIds = constraint.transitionSelectedIds || constraint.selectedIds || []
  const coreSelectedIds = constraint.coreSelectedIds || constraint.selectedIds || []
  const config = SURFACE_SOURCE_CONFIG[source]
  if (!config) return null

  const sql = `
    WITH query_geom AS (
      SELECT ST_GeomFromText($1, 4326) AS geom
    ),
    outer_selected AS (
      SELECT geom
      FROM ${config.table}
      WHERE ${config.idColumn} = ANY($2::int[])
    ),
    transition_selected AS (
      SELECT geom
      FROM ${config.table}
      WHERE ${config.idColumn} = ANY($3::int[])
    ),
    core_selected AS (
      SELECT geom
      FROM ${config.table}
      WHERE ${config.idColumn} = ANY($4::int[])
    ),
    outer_union AS (
      SELECT
        ST_UnaryUnion(ST_Collect(geom)) AS source_geom,
        ST_Intersection(ST_UnaryUnion(ST_Collect(geom)), q.geom) AS clipped_geom
      FROM outer_selected, query_geom q
    ),
    transition_union AS (
      SELECT
        ST_UnaryUnion(ST_Collect(geom)) AS source_geom,
        ST_Intersection(ST_UnaryUnion(ST_Collect(geom)), q.geom) AS clipped_geom
      FROM transition_selected, query_geom q
    ),
    core_union AS (
      SELECT
        ST_UnaryUnion(ST_Collect(geom)) AS source_geom,
        ST_Intersection(ST_UnaryUnion(ST_Collect(geom)), q.geom) AS clipped_geom
      FROM core_selected, query_geom q
    )
    SELECT
      ST_AsGeoJSON(ST_MakeValid((SELECT clipped_geom FROM outer_union)))::json AS outer_geojson,
      CASE
        WHEN (SELECT source_geom FROM outer_union) IS NULL THEN NULL
        WHEN NULLIF(ST_Area(ST_Transform((SELECT source_geom FROM outer_union), 3857)), 0) IS NULL THEN NULL
        ELSE LEAST(
          1,
          COALESCE(
            ST_Area(
              ST_Transform(
                ST_CollectionExtract(ST_MakeValid((SELECT clipped_geom FROM outer_union)), 3),
                3857
              )
            ),
            0
          ) / NULLIF(ST_Area(ST_Transform((SELECT source_geom FROM outer_union), 3857)), 0)
        )
      END AS outer_clip_coverage,
      ST_AsGeoJSON(ST_MakeValid((SELECT clipped_geom FROM transition_union)))::json AS transition_geojson,
      CASE
        WHEN (SELECT source_geom FROM transition_union) IS NULL THEN NULL
        WHEN NULLIF(ST_Area(ST_Transform((SELECT source_geom FROM transition_union), 3857)), 0) IS NULL THEN NULL
        ELSE LEAST(
          1,
          COALESCE(
            ST_Area(
              ST_Transform(
                ST_CollectionExtract(ST_MakeValid((SELECT clipped_geom FROM transition_union)), 3),
                3857
              )
            ),
            0
          ) / NULLIF(ST_Area(ST_Transform((SELECT source_geom FROM transition_union), 3857)), 0)
        )
      END AS transition_clip_coverage,
      ST_AsGeoJSON(ST_MakeValid((SELECT clipped_geom FROM core_union)))::json AS core_geojson,
      CASE
        WHEN (SELECT source_geom FROM core_union) IS NULL THEN NULL
        WHEN NULLIF(ST_Area(ST_Transform((SELECT source_geom FROM core_union), 3857)), 0) IS NULL THEN NULL
        ELSE LEAST(
          1,
          COALESCE(
            ST_Area(
              ST_Transform(
                ST_CollectionExtract(ST_MakeValid((SELECT clipped_geom FROM core_union)), 3),
                3857
              )
            ),
            0
          ) / NULLIF(ST_Area(ST_Transform((SELECT source_geom FROM core_union), 3857)), 0)
        )
      END AS core_clip_coverage
  `

  const result = await dbQuery(sql, [
    queryWkt,
    [...new Set(outerSelectedIds.map((value) => Number(value)).filter(Number.isFinite))],
    [...new Set(transitionSelectedIds.map((value) => Number(value)).filter(Number.isFinite))],
    [...new Set(coreSelectedIds.map((value) => Number(value)).filter(Number.isFinite))]
  ])

  const row = result?.rows?.[0] || {}
  const outerBoundary = row.outer_geojson || null
  const transitionBoundary = row.transition_geojson || null
  const coreBoundary = row.core_geojson || null
  const outerCoverage = normalizeCoverage(row.outer_clip_coverage)
  const transitionCoverage = normalizeCoverage(row.transition_clip_coverage)
  const coreCoverage = normalizeCoverage(row.core_clip_coverage)

  const boundary = transitionBoundary || outerBoundary || coreBoundary
  if (!boundary) return null

  return {
    ...constraint,
    method: `${constraint.method || source}_postgis`,
    boundary,
    outerBoundary: outerBoundary || boundary,
    transitionBoundary: transitionBoundary || boundary,
    coreBoundary: coreBoundary || transitionBoundary || boundary,
    clipSummary: {
      coverage: transitionCoverage ?? outerCoverage ?? coreCoverage,
      outer_coverage: outerCoverage,
      transition_coverage: transitionCoverage,
      core_coverage: coreCoverage
    }
  }
}

async function safeFetch(sql, params = []) {
  try {
    const result = await query(sql, params)
    return result.rows || []
  } catch (error) {
    return []
  }
}

export async function fetchSurfaceContext({ queryWkt, limits = {} } = {}) {
  if (typeof queryWkt !== 'string' || !queryWkt.trim()) {
    return {
      queryWkt: null,
      roadBlocks: [],
      osmAoiFeatures: [],
      eulucFeatures: []
    }
  }

  const roadLimit = Math.max(1, Math.min(Number(limits.roadLimit) || 5000, 10000))
  const aoiLimit = Math.max(1, Math.min(Number(limits.aoiLimit) || 3000, 10000))
  const eulucLimit = Math.max(1, Math.min(Number(limits.eulucLimit) || 3000, 10000))

  const geometryExpr = 'ST_GeomFromText($1, 4326)'

  const roadSql = `
    SELECT
      rb.block_id,
      ST_AsGeoJSON(rb.geom) AS geometry_geojson
    FROM wuhan_road_blocks rb
    WHERE rb.geom && ${geometryExpr}
      AND ST_Intersects(rb.geom, ${geometryExpr})
    LIMIT $2
  `

  const aoiSql = `
    SELECT
      a.aoi_id,
      a.name,
      a.type,
      ST_AsGeoJSON(a.geom) AS geometry_geojson
    FROM wuhan_osm_aoi a
    WHERE a.geom && ${geometryExpr}
      AND ST_Intersects(a.geom, ${geometryExpr})
    LIMIT $2
  `

  const eulucSql = `
    SELECT
      e.euluc_id,
      e.land_type,
      ST_AsGeoJSON(e.geom) AS geometry_geojson
    FROM wuhan_euluc e
    WHERE e.geom && ${geometryExpr}
      AND ST_Intersects(e.geom, ${geometryExpr})
    LIMIT $2
  `

  const [roadBlocks, osmAoiFeatures, eulucFeatures] = await Promise.all([
    safeFetch(roadSql, [queryWkt, roadLimit]),
    safeFetch(aoiSql, [queryWkt, aoiLimit]),
    safeFetch(eulucSql, [queryWkt, eulucLimit])
  ])

  return {
    queryWkt,
    roadBlocks,
    osmAoiFeatures,
    eulucFeatures
  }
}

export default {
  buildSurfaceQueryWkt,
  fetchSurfaceContext,
  refineSurfaceConstraintGeometry
}
