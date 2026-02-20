function pickObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return {}
}

function pickArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }
  return []
}

export function normalizeAiEvidencePayload(payload) {
  const root = pickObject(payload)
  const clusters = pickObject(root.clusters, root.spatialClusters, root.spatial_clusters)
  const hotspots = pickArray(
    clusters.hotspots,
    root.hotspots,
    root.spatialClusters?.hotspots,
    root.spatial_clusters?.hotspots
  )

  return {
    boundary: root.boundary ?? null,
    stats: pickObject(root.stats),
    clusters: { ...clusters, hotspots },
    vernacularRegions: pickArray(root.vernacularRegions, root.vernacular_regions),
    fuzzyRegions: pickArray(root.fuzzyRegions, root.fuzzy_regions)
  }
}

export function resolveRegionBoundary(entity) {
  const target = pickObject(entity)
  return (
    target.boundary ||
    target.boundary_geojson ||
    target.boundary_ring ||
    target.layers?.transition?.geojson ||
    target.layers?.transition?.boundary ||
    target.layers?.outer?.geojson ||
    target.layers?.outer?.boundary ||
    null
  )
}

export function resolveFuzzyLayerBundle(region) {
  const item = pickObject(region)
  const outerBoundary =
    item.layers?.outer?.boundary ||
    item.layers?.outer?.geojson ||
    item.boundary ||
    item.boundary_geojson ||
    item.boundary_ring ||
    null
  const transitionBoundary =
    item.layers?.transition?.boundary ||
    item.layers?.transition?.geojson ||
    outerBoundary
  const coreBoundary =
    item.layers?.core?.boundary ||
    item.layers?.core?.geojson ||
    transitionBoundary ||
    outerBoundary

  return {
    outer: {
      boundary: outerBoundary,
      confidence: item.layers?.outer?.confidence ?? item.boundary_confidence ?? null
    },
    transition: {
      boundary: transitionBoundary,
      confidence: item.layers?.transition?.confidence ?? item.boundary_confidence ?? null
    },
    core: {
      boundary: coreBoundary,
      confidence: item.layers?.core?.confidence ?? item.boundary_confidence ?? null
    }
  }
}

