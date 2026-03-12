import { createBullMqDeepLaneDriver } from './bullmq-deep-lane-driver.js'

const DEFAULT_CONCURRENCY = 2

function resolveConcurrency(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONCURRENCY
}

function buildQueuedTask(task) {
  if (typeof task === 'function') {
    return {
      runLocal: task,
      descriptor: task.deepLaneDescriptor ?? null
    }
  }

  return {
    runLocal: task?.runLocal,
    descriptor: task?.deepLaneDescriptor ?? task?.descriptor ?? null
  }
}

export function createDeepLaneScheduler({
  concurrency = resolveConcurrency(process.env.V2_DEEP_LANE_CONCURRENCY),
  onError = null,
  persistentDriver = null
} = {}) {
  const queue = []
  let activeCount = 0
  let closed = false
  let processor = null
  let ownedPersistentDriver = persistentDriver
  let persistentDriverPromise = null

  async function getPersistentDriver() {
    if (ownedPersistentDriver) {
      return ownedPersistentDriver
    }

    if (persistentDriverPromise) {
      return persistentDriverPromise
    }

    persistentDriverPromise = createBullMqDeepLaneDriver({
      concurrency,
      onError
    }).then(async (driver) => {
      ownedPersistentDriver = driver
      if (ownedPersistentDriver && typeof processor === 'function' && typeof ownedPersistentDriver.setProcessor === 'function') {
        await ownedPersistentDriver.setProcessor(processor)
      }
      return ownedPersistentDriver
    }).catch(() => null)

    return persistentDriverPromise
  }

  async function runNext() {
    if (closed || activeCount >= concurrency || queue.length === 0) {
      return
    }

    const next = queue.shift()
    if (!next) {
      return
    }

    activeCount += 1

    try {
      const value = await next.task()
      next.resolve(value)
    } catch (error) {
      onError?.(error)
      next.reject(error)
    } finally {
      activeCount -= 1
      if (queue.length > 0) {
        queueMicrotask(() => {
          void runNext()
        })
      }
    }
  }

  function scheduleInMemory(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject })
      queueMicrotask(() => {
        void runNext()
      })
    })
  }

  return {
    async setProcessor(nextProcessor) {
      processor = nextProcessor
      const driver = await getPersistentDriver()
      if (driver && typeof driver.setProcessor === 'function') {
        await driver.setProcessor(nextProcessor)
      }
    },
    async schedule(task) {
      if (closed) {
        return Promise.reject(new Error('deep_lane_scheduler_closed'))
      }

      const queuedTask = buildQueuedTask(task)
      if (queuedTask.descriptor) {
        const driver = await getPersistentDriver()
        if (driver) {
          try {
            return await driver.enqueue(queuedTask.descriptor)
          } catch (error) {
            onError?.(error)
          }
        }
      }

      if (typeof queuedTask.runLocal !== 'function') {
        return Promise.reject(new Error('deep_lane_task_missing_runner'))
      }

      return scheduleInMemory(queuedTask.runLocal)
    },
    snapshot() {
      return {
        mode: ownedPersistentDriver ? 'persistent' : 'memory',
        active_count: activeCount,
        queued_count: queue.length,
        concurrency
      }
    },
    async getHealthSnapshot() {
      const base = this.snapshot()
      const driver = await getPersistentDriver()
      if (!driver || typeof driver.getCounts !== 'function') {
        return {
          ...base,
          persistent_available: false,
          queue_counts: null
        }
      }

      try {
        const counts = await driver.getCounts()
        return {
          ...base,
          persistent_available: true,
          queue_counts: counts
        }
      } catch (error) {
        onError?.(error)
        return {
          ...base,
          persistent_available: true,
          queue_counts: null,
          error_message: error instanceof Error ? error.message : String(error)
        }
      }
    },
    async close() {
      closed = true
      const driver = await getPersistentDriver()
      if (driver && typeof driver.close === 'function') {
        await driver.close()
      }
    }
  }
}
