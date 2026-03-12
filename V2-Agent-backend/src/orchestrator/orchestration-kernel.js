export function createOrchestrationKernel({
  scheduleDeepLane,
  eventHub
} = {}) {
  if (!eventHub) {
    throw new Error('event_hub_required')
  }

  const enqueueDeepLane = scheduleDeepLane ?? ((task) => {
    void task()
  })

  return {
    enqueueDeepLane,
    async dispatch(topic, payload) {
      return eventHub.request(topic, payload)
    },
    listAgentSubscribers() {
      return eventHub.listSubscribers()
    }
  }
}
