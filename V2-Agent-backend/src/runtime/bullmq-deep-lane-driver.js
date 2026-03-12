import { buildBullMqConnection, coercePositiveInteger, resolveRedisConfig } from './redis-support.js'

const DEFAULT_QUEUE_NAME = 'v2-deep-lane'
const DEFAULT_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = 1_000

function resolveQueueName() {
  return String(process.env.V2_DEEP_LANE_QUEUE_NAME || DEFAULT_QUEUE_NAME).trim() || DEFAULT_QUEUE_NAME
}

export async function createBullMqDeepLaneDriver({
  queueName = resolveQueueName(),
  concurrency = 2,
  onError = null,
  redisConfig = resolveRedisConfig({
    urlEnvNames: ['V2_DEEP_LANE_REDIS_URL', 'JOB_STATE_REDIS_URL', 'REDIS_URL'],
    hostEnvNames: ['V2_DEEP_LANE_REDIS_HOST', 'REDIS_HOST']
  }),
  attempts = coercePositiveInteger(process.env.V2_DEEP_LANE_ATTEMPTS, DEFAULT_ATTEMPTS),
  backoffMs = coercePositiveInteger(process.env.V2_DEEP_LANE_BACKOFF_MS, DEFAULT_BACKOFF_MS)
} = {}) {
  const connection = buildBullMqConnection(redisConfig)
  if (!connection) {
    return null
  }

  const module = await import('bullmq')
  const Queue = module.Queue
  const Worker = module.Worker
  const QueueEvents = module.QueueEvents

  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: {
      attempts,
      backoff: {
        type: 'fixed',
        delay: backoffMs
      },
      removeOnComplete: 100,
      removeOnFail: 100
    }
  })
  const queueEvents = new QueueEvents(queueName, {
    connection
  })

  let worker = null
  let processor = null

  async function ensureWorker() {
    if (worker || typeof processor !== 'function') {
      return
    }

    worker = new Worker(queueName, async (job) => {
      return processor(job.data)
    }, {
      connection,
      concurrency
    })

    worker.on('error', (error) => {
      onError?.(error)
    })
  }

  return {
    mode: 'bullmq',
    async setProcessor(nextProcessor) {
      processor = nextProcessor
      await ensureWorker()
    },
    async enqueue(descriptor) {
      await ensureWorker()
      if (typeof processor !== 'function') {
        throw new Error('deep_lane_processor_missing')
      }

      const job = await queue.add(descriptor.kind || 'deep-lane', descriptor)
      return {
        queued: true,
        queue_name: queueName,
        queue_job_id: String(job.id)
      }
    },
    async getCounts() {
      return queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
    },
    async close() {
      if (worker) {
        await worker.close()
        worker = null
      }
      await queueEvents.close()
      await queue.close()
    }
  }
}
