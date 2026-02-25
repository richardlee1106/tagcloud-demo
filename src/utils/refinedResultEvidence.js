function pickArray(...candidates) {
  for (const value of candidates) {
    if (Array.isArray(value)) return value
  }
  return []
}

function pickObject(...candidates) {
  for (const value of candidates) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return null
}

function pickString(...candidates) {
  for (const value of candidates) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeIntentMeta(root, results) {
  const queryPlan = pickObject(
    results.query_plan,
    results.queryPlan,
    root.query_plan,
    root.queryPlan,
    results.query_executed,
    root.query_executed
  )

  const queryType = pickString(
    queryPlan?.query_type,
    queryPlan?.queryType,
    results.query_type,
    results.queryType,
    root.query_type,
    root.queryType
  ).toLowerCase()

  const intentMode = pickString(
    queryPlan?.intent_mode,
    queryPlan?.intentMode,
    results.intent_mode,
    results.intentMode,
    root.intent_mode,
    root.intentMode
  ).toLowerCase()

  if (!queryPlan && !queryType && !intentMode) {
    return null
  }

  return {
    queryType: queryType || null,
    intentMode: intentMode || null,
    queryPlan: queryPlan || null
  }
}

export function normalizeRefinedResultEvidence(payload) {
  const root = pickObject(payload) || {}
  const results = pickObject(root.results) || root

  const boundary = results.boundary ?? root.boundary ?? null
  const spatialClusters =
    pickObject(results.spatial_clusters, results.spatialClusters, root.spatial_clusters, root.spatialClusters) ||
    { hotspots: [] }
  const vernacularRegions = pickArray(
    results.vernacular_regions,
    results.vernacularRegions,
    root.vernacular_regions,
    root.vernacularRegions
  )
  const fuzzyRegions = pickArray(
    results.fuzzy_regions,
    results.fuzzyRegions,
    root.fuzzy_regions,
    root.fuzzyRegions
  )
  const stats = pickObject(results.stats, results.analysisStats, root.stats, root.analysisStats)
  const intent = normalizeIntentMeta(root, results)

  const hotspotCount = Array.isArray(spatialClusters?.hotspots) ? spatialClusters.hotspots.length : 0
  const hasEvidence = Boolean(
    boundary ||
      hotspotCount > 0 ||
      vernacularRegions.length > 0 ||
      fuzzyRegions.length > 0
  )

  return {
    boundary,
    spatialClusters,
    vernacularRegions,
    fuzzyRegions,
    stats,
    intent,
    hasEvidence
  }
}

