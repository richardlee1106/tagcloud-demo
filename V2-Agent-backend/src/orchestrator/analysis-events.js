export const ANALYSIS_EVENT_NAMES = Object.freeze({
  FAST_RESULT: 'fast.result',
  DEEP_ACCEPTED: 'deep.accepted',
  DEEP_PATCH: 'deep.patch',
  DEEP_FINAL: 'deep.final',
  DEEP_FAILED: 'deep.failed'
})

export function createEventBuffer(onEvent, eventBus) {
  const events = []

  return {
    events,
    emit(event, data) {
      const entry = { event, data }
      events.push(entry)
      eventBus?.emit('analysis.event', entry)
      eventBus?.emit(event, data)
      onEvent?.(entry)
      return entry
    }
  }
}
