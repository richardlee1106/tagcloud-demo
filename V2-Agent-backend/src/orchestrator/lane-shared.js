export async function processDeepLane({
  allowDeep = true,
  asyncDeep = false,
  machine,
  traceId,
  jobId,
  routingOutput,
  executionPath,
  objectiveContract = null,
  fastResult,
  eventBuffer,
  buildDeepAccepted,
  persistSnapshot,
  enqueueDeepLane,
  deepJobDescriptor = null,
  runDeepLane,
  handleDeepLaneError,
  onAsyncAccepted = null,
  basePersistPayload = {}
} = {}) {
  if (!allowDeep) {
    await persistSnapshot({
      ...basePersistPayload,
      objectiveContract,
      fastResult,
      deepPartial: null,
      deepFinal: null
    })
    return
  }

  machine.transition('S4_DEEP_QUEUED')
  const deepAccepted = buildDeepAccepted({
    traceId,
    jobId,
    resultVersion: fastResult.result_version,
    objective: routingOutput.objective,
    executionPath
  })

  eventBuffer.emit('deep.accepted', deepAccepted)

  if (asyncDeep) {
    onAsyncAccepted?.()
    await persistSnapshot({
      ...basePersistPayload,
      objectiveContract,
      fastResult,
      deepPartial: null,
      deepFinal: null
    })

    const queuedTask = async () => {
      try {
        await runDeepLane()
      } catch (error) {
        await handleDeepLaneError(error)
      }
    }

    if (deepJobDescriptor) {
      queuedTask.deepLaneDescriptor = deepJobDescriptor
    }

    void enqueueDeepLane(queuedTask)
    return
  }

  const { deepPartial, deepFinal } = await runDeepLane()
  eventBuffer.emit('deep.patch', deepPartial)
  eventBuffer.emit('deep.final', deepFinal)
}
