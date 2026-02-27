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

  function applyIntentMetaToMessage(message, intent) {
    if (!message || !intent) return null

    const mergedIntent = {
      ...(message.intentMeta || {}),
      ...intent
    }

    message.intentMeta = mergedIntent
    if (mergedIntent.queryType) message.queryType = mergedIntent.queryType
    if (mergedIntent.queryPlan) message.queryPlan = mergedIntent.queryPlan

    const resolvedMode = toEmbeddedIntentMode(mergedIntent.intentMode, mergedIntent.queryType)
    if (resolvedMode) {
      message.intentMode = resolvedMode
    }

    return mergedIntent
  }

  function applySSEMetaToMessage(message, payload) {
    if (!message || !payload || typeof payload !== 'object' || Array.isArray(payload)) return

    const traceId = payload.trace_id || payload.traceId
    const schemaVersion = payload.schema_version || payload.schemaVersion
    const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.slice() : null

    if (traceId) message.traceId = String(traceId)
    if (schemaVersion) message.schemaVersion = String(schemaVersion)
    if (capabilities) message.capabilities = capabilities
  }

  function dispatchRefinedResult(data, aiMessageIndex) {
    const normalized = normalizeRefinedResultEvidence(data)
    const currentMsg = getMessage(aiMessageIndex)

    if (currentMsg) {
      applySSEMetaToMessage(currentMsg, data)
      if (normalized.boundary) currentMsg.boundary = normalized.boundary
      if (normalized.spatialClusters) currentMsg.spatialClusters = normalized.spatialClusters
      if (normalized.vernacularRegions.length > 0) currentMsg.vernacularRegions = normalized.vernacularRegions
      if (normalized.fuzzyRegions.length > 0) currentMsg.fuzzyRegions = normalized.fuzzyRegions
      if (normalized.stats) currentMsg.analysisStats = normalized.stats
      if (normalized.stats?.model_timing_ms) currentMsg.modelTiming = normalized.stats.model_timing_ms
      applyIntentMetaToMessage(currentMsg, normalized.intent)
    }

    if (normalized.boundary) emit('ai-boundary', normalized.boundary)
    if (normalized.spatialClusters?.hotspots?.length) emit('ai-spatial-clusters', normalized.spatialClusters)
    if (normalized.vernacularRegions.length > 0) emit('ai-vernacular-regions', normalized.vernacularRegions)
    if (normalized.fuzzyRegions.length > 0) emit('ai-fuzzy-regions', normalized.fuzzyRegions)
    if (normalized.stats) emit('ai-analysis-stats', normalized.stats)
    if (normalized.intent) emit('ai-intent-meta', normalized.intent)
  }

  function dispatchMetaEvent({ type, data, aiMessageIndex, fallbackIntentMode }) {
    const currentMsg = getMessage(aiMessageIndex)

    if (type === 'trace' && data && typeof data === 'object') {
      if (currentMsg) {
        const traceId = data.trace_id || data.traceId || data.request_id || data.requestId
        if (traceId) currentMsg.traceId = String(traceId)
      }
      return {}
    }

    if (type === 'stage') {
      if (currentMsg) {
        applySSEMetaToMessage(currentMsg, data)
      }
      const stageName = typeof data === 'string' ? data : data?.name
      const normalizedStage = String(stageName || '').trim().toLowerCase()
      if (currentMsg && normalizedStage) {
        if (normalizedStage === 'general_qa' || normalizedStage === 'smalltalk') {
          currentMsg.queryType = 'general_qa'
          currentMsg.intentMode = 'llm_chat'
        } else if (normalizedStage === 'irrelevant_input') {
          currentMsg.queryType = 'irrelevant_input'
          currentMsg.intentMode = 'out_of_scope'
        }
      }
      return { stage: stageName || '' }
    }

    if (type === 'pois' && Array.isArray(data)) {
      extractedPOIsRef.value = data
      if (currentMsg) {
        currentMsg.pois = data
        currentMsg.intentMode = fallbackIntentMode
      }
      return {}
    }

    if (type === 'boundary' && data) {
      if (currentMsg) {
        currentMsg.boundary = data
        applySSEMetaToMessage(currentMsg, data)
      }
      emit('ai-boundary', data)
      return {}
    }

    if (type === 'spatial_clusters' && data) {
      if (currentMsg) currentMsg.spatialClusters = data
      if (currentMsg) applySSEMetaToMessage(currentMsg, data)
      emit('ai-spatial-clusters', data)
      return {}
    }

    if (type === 'vernacular_regions' && Array.isArray(data)) {
      if (currentMsg) currentMsg.vernacularRegions = data
      emit('ai-vernacular-regions', data)
      return {}
    }

    if (type === 'fuzzy_regions' && Array.isArray(data)) {
      if (currentMsg) currentMsg.fuzzyRegions = data
      emit('ai-fuzzy-regions', data)
      return {}
    }

    if (type === 'stats' && data && typeof data === 'object') {
      if (currentMsg) currentMsg.analysisStats = data
      if (currentMsg && data.model_timing_ms && typeof data.model_timing_ms === 'object') {
        currentMsg.modelTiming = data.model_timing_ms
      }
      if (currentMsg) applySSEMetaToMessage(currentMsg, data)
      emit('ai-analysis-stats', data)

      const statsIntent = normalizeRefinedResultEvidence({
        results: { stats: data }
      })?.intent
      const resolvedIntent = applyIntentMetaToMessage(currentMsg, statsIntent)
      if (resolvedIntent) {
        emit('ai-intent-meta', resolvedIntent)
      }
      return {}
    }

    if (type === 'refined_result' && data && typeof data === 'object') {
      dispatchRefinedResult(data, aiMessageIndex)
      return {}
    }

    if (type === 'progress' && data) {
      if (currentMsg) {
        currentMsg.progress = data.progress
        applySSEMetaToMessage(currentMsg, data)
      }
      return {}
    }

    if (type === 'schema_error' && data) {
      if (currentMsg) {
        currentMsg.schemaWarning = {
          event: data.event,
          errors: Array.isArray(data.errors) ? data.errors.slice(0, 3) : [],
          traceId: data.trace_id || data.traceId || null
        }
        applySSEMetaToMessage(currentMsg, data)
      }
      return {}
    }

    return {}
  }

  return {
    dispatchMetaEvent
  }
}
