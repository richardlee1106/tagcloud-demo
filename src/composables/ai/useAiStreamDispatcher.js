export function useAiStreamDispatcher({
  messagesRef,
  extractedPOIsRef,
  emit,
  normalizeRefinedResultEvidence,
  toEmbeddedIntentMode
}) {
  function getMessage(aiMessageIndex) {
    return messagesRef.value?.[aiMessageIndex] || null
  }

  function dispatchRefinedResult(data, aiMessageIndex) {
    const normalized = normalizeRefinedResultEvidence(data)
    const currentMsg = getMessage(aiMessageIndex)

    if (currentMsg) {
      if (normalized.boundary) currentMsg.boundary = normalized.boundary
      if (normalized.spatialClusters) currentMsg.spatialClusters = normalized.spatialClusters
      if (normalized.vernacularRegions.length > 0) currentMsg.vernacularRegions = normalized.vernacularRegions
      if (normalized.fuzzyRegions.length > 0) currentMsg.fuzzyRegions = normalized.fuzzyRegions
      if (normalized.stats) currentMsg.analysisStats = normalized.stats
      if (normalized.intent) {
        currentMsg.intentMeta = normalized.intent
        if (normalized.intent.queryType) currentMsg.queryType = normalized.intent.queryType
        if (normalized.intent.queryPlan) currentMsg.queryPlan = normalized.intent.queryPlan
        const resolvedMode = toEmbeddedIntentMode(
          normalized.intent.intentMode,
          normalized.intent.queryType
        )
        if (resolvedMode) {
          currentMsg.intentMode = resolvedMode
        }
      }
    }

    if (normalized.boundary) emit('ai-boundary', normalized.boundary)
    if (normalized.spatialClusters?.hotspots?.length) emit('ai-spatial-clusters', normalized.spatialClusters)
    if (normalized.vernacularRegions.length > 0) emit('ai-vernacular-regions', normalized.vernacularRegions)
    if (normalized.fuzzyRegions.length > 0) emit('ai-fuzzy-regions', normalized.fuzzyRegions)
    if (normalized.stats) emit('ai-analysis-stats', normalized.stats)
    if (normalized.intent) emit('ai-intent-meta', normalized.intent)
  }

  function dispatchMetaEvent({ type, data, aiMessageIndex, fallbackIntentMode }) {
    if (type === 'stage') {
      return { stage: data }
    }

    if (type === 'pois' && Array.isArray(data)) {
      extractedPOIsRef.value = data
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) {
        currentMsg.pois = data
        currentMsg.intentMode = fallbackIntentMode
      }
      return {}
    }

    if (type === 'boundary' && data) {
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) currentMsg.boundary = data
      emit('ai-boundary', data)
      return {}
    }

    if (type === 'spatial_clusters' && data) {
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) currentMsg.spatialClusters = data
      emit('ai-spatial-clusters', data)
      return {}
    }

    if (type === 'vernacular_regions' && Array.isArray(data)) {
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) currentMsg.vernacularRegions = data
      emit('ai-vernacular-regions', data)
      return {}
    }

    if (type === 'fuzzy_regions' && Array.isArray(data)) {
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) currentMsg.fuzzyRegions = data
      emit('ai-fuzzy-regions', data)
      return {}
    }

    if (type === 'stats' && data && typeof data === 'object') {
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) currentMsg.analysisStats = data
      emit('ai-analysis-stats', data)
      return {}
    }

    if (type === 'refined_result' && data && typeof data === 'object') {
      dispatchRefinedResult(data, aiMessageIndex)
      return {}
    }

    if (type === 'progress' && data) {
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) {
        currentMsg.progress = data.progress
      }
      return {}
    }

    if (type === 'schema_error' && data) {
      const currentMsg = getMessage(aiMessageIndex)
      if (currentMsg) {
        currentMsg.schemaWarning = {
          event: data.event,
          errors: Array.isArray(data.errors) ? data.errors.slice(0, 3) : []
        }
      }
      return {}
    }

    return {}
  }

  return {
    dispatchMetaEvent
  }
}
