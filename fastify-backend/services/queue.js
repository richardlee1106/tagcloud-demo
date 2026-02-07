/**
 * Jobs 队列服务。
 * 支持 BullMQ（Redis）与内存降级模式。
 */
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import IORedis from 'ioredis'
import { Queue, QueueEvents, Worker } from 'bullmq'

const QUEUE_NAME = process.env.SPATIAL_QUEUE_NAME || 'spatial-narrative'
const JOB_EVENT_LIMIT = parseInt(process.env.SPATIAL_JOB_EVENT_LIMIT || '200', 10)
const DEFAULT_CONCURRENCY = parseInt(process.env.SPATIAL_WORKER_CONCURRENCY || '1', 10)

const eventBus = new EventEmitter()
eventBus.setMaxListeners(0)

const jobSnapshots = new Map()
const memoryQueue = []

let queue
let queueEvents
let worker
let redisConnection
let initialized = false
let memoryProcessor = null
let memoryDraining = false

/**
 */
/**
 * 构建 Redis 连接参数。
 */
function getRedisConfig() {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL }
  }

  if (process.env.REDIS_HOST) {
    return {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10)
    }
  }

  return null
}

/**
 */
/**
 * 创建或更新任务快照。
 */
function touchSnapshot(jobId, patch = {}) {
  const current = jobSnapshots.get(jobId) || {
    job_id: jobId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    eta_ms: null,
    error: null,
    result: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    events: []
  }

  const next = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString()
  }

  jobSnapshots.set(jobId, next)
  return next
}

/**
 */
/**
 * 追加任务事件并驱动状态机更新。
 */
function appendEvent(jobId, type, payload = {}) {
  const event = {
    job_id: jobId,
    type,
    payload,
    ts: Date.now()
  }

  const snapshot = touchSnapshot(jobId)
  const nextEvents = snapshot.events.concat(event)
  if (nextEvents.length > JOB_EVENT_LIMIT) {
    snapshot.events = nextEvents.slice(nextEvents.length - JOB_EVENT_LIMIT)
  } else {
    snapshot.events = nextEvents
  }

  if (type === 'stage') {
    snapshot.stage = payload.stage || payload.name || snapshot.stage
  }

  if (type === 'progress') {
    const rawProgress = payload.progress
    if (typeof rawProgress === 'number' && Number.isFinite(rawProgress)) {
      snapshot.progress = rawProgress <= 1 ? Math.max(0, rawProgress * 100) : Math.max(0, rawProgress)
    }
    snapshot.stage = payload.stage || payload.name || snapshot.stage
    snapshot.eta_ms = Number.isFinite(payload.eta_ms) ? payload.eta_ms : snapshot.eta_ms
  }

  if (type === 'queued') {
    snapshot.status = 'queued'
    snapshot.stage = payload.stage || 'queued'
  } else if (type === 'started') {
    snapshot.status = 'running'
    snapshot.stage = payload.stage || 'started'
    if (snapshot.progress < 1) {
      snapshot.progress = 1
    }
  } else if (type === 'completed') {
    snapshot.status = 'completed'
    snapshot.progress = 100
    snapshot.stage = 'completed'
    snapshot.result = payload.result ?? snapshot.result
  } else if (type === 'failed') {
    snapshot.status = 'failed'
    snapshot.stage = 'failed'
    snapshot.error = payload.error || 'Job failed'
  }

  eventBus.emit('job_event', event)
  return event
}

/**
 */
/**
 * 上报进度：内存事件必写，BullMQ 进度尽力写。
 */
async function emitProgress(jobId, eventType, payload, bullJob) {
  appendEvent(jobId, eventType, payload)

  if (bullJob) {
    try {
      await bullJob.updateProgress({ event: eventType, ...payload, ts: Date.now() })
    } catch (err) {
      console.warn(`[Queue] Failed to persist progress for ${jobId}: ${err.message}`)
    }
  }
}

/**
 */
/**
 * 生成标准 reporter 接口。
 */
function createReporter(jobId, bullJob = null) {
  return {
    reportStage: async (stage, payload = {}) => {
      await emitProgress(jobId, 'stage', { stage, ...payload }, bullJob)
    },
    reportProgress: async (progress, payload = {}) => {
      await emitProgress(jobId, 'progress', { progress, ...payload }, bullJob)
    },
    reportPartial: async (payload = {}) => {
      await emitProgress(jobId, 'partial', payload, bullJob)
    },
    reportText: async (textChunk) => {
      await emitProgress(jobId, 'partial', { text_chunk: textChunk }, bullJob)
    }
  }
}

/**
 */
/**
 * 执行任务处理器，统一维护完成/失败状态。
 */
async function runProcessor(processor, jobId, payload, bullJob = null) {
  touchSnapshot(jobId, {
    status: 'running',
    stage: 'started',
    progress: Math.max(1, touchSnapshot(jobId).progress)
  })
  appendEvent(jobId, 'started', { stage: 'started' })

  try {
    const reporter = createReporter(jobId, bullJob)
    const result = await processor(payload, reporter)

    touchSnapshot(jobId, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      result
    })
    appendEvent(jobId, 'completed', {
      result,
      summary: {
        poi_count: Array.isArray(result?.results?.pois) ? result.results.pois.length : undefined,
        region_count: Array.isArray(result?.results?.vernacular_regions)
          ? result.results.vernacular_regions.length
          : undefined
      }
    })

    return result
  } catch (err) {
    const errorMessage = err?.message || 'Unknown worker error'
    touchSnapshot(jobId, {
      status: 'failed',
      stage: 'failed',
      error: errorMessage
    })
    appendEvent(jobId, 'failed', { error: errorMessage })
    throw err
  }
}

/**
 */
/**
 * 内存队列消费器（Redis 不可用时启用）。
 */
async function drainMemoryQueue() {
  if (memoryDraining || !memoryProcessor) {
    return
  }

  memoryDraining = true
  try {
    while (memoryQueue.length > 0) {
      const job = memoryQueue.shift()
      if (!job) {
        continue
      }
      await runProcessor(memoryProcessor, job.id, job.payload)
    }
  } finally {
    memoryDraining = false
  }
}

/**
 */
/**
 * 监听 BullMQ 事件并映射到内部事件总线。
 */
function attachQueueEventListeners() {
  if (!queueEvents) {
    return
  }

  queueEvents.on('waiting', ({ jobId }) => {
    touchSnapshot(jobId, { status: 'queued', stage: 'queued' })
    appendEvent(jobId, 'queued', { stage: 'queued' })
  })

  queueEvents.on('active', ({ jobId }) => {
    touchSnapshot(jobId, {
      status: 'running',
      stage: 'started',
      progress: Math.max(1, touchSnapshot(jobId).progress)
    })
    appendEvent(jobId, 'started', { stage: 'started' })
  })

  queueEvents.on('progress', ({ jobId, data }) => {
    if (data && typeof data === 'object' && data.event) {
      const { event, ...payload } = data
      appendEvent(jobId, event, payload)
      return
    }

    appendEvent(jobId, 'progress', {
      progress: typeof data === 'number' ? data : 0,
      stage: 'running'
    })
  })

  queueEvents.on('completed', async ({ jobId }) => {
    let returnValue = null

    try {
      const job = await queue.getJob(jobId)
      returnValue = job?.returnvalue ?? null
    } catch {
      returnValue = null
    }

    touchSnapshot(jobId, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      result: returnValue
    })

    appendEvent(jobId, 'completed', {
      result: returnValue
    })
  })

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    touchSnapshot(jobId, {
      status: 'failed',
      stage: 'failed',
      error: failedReason
    })

    appendEvent(jobId, 'failed', {
      error: failedReason
    })
  })
}

/**
 */
/**
 * 初始化队列服务。
 * 优先 BullMQ，失败自动降级内存模式。
 */
export async function initQueueServices() {
  if (initialized) {
    return
  }

  const redisConfig = getRedisConfig()

  if (redisConfig) {
    try {
      if (redisConfig.url) {
        redisConnection = new IORedis(redisConfig.url, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false
        })
      } else {
        redisConnection = new IORedis({
          ...redisConfig,
          maxRetriesPerRequest: null,
          enableReadyCheck: false
        })
      }

      queue = new Queue(QUEUE_NAME, { connection: redisConnection })
      queueEvents = new QueueEvents(QUEUE_NAME, { connection: redisConnection })
      await queueEvents.waitUntilReady()
      attachQueueEventListeners()
      console.log(`[Queue] BullMQ mode enabled (${QUEUE_NAME})`)
    } catch (err) {
      console.warn(`[Queue] Falling back to memory mode: ${err.message}`)
      queue = null
      queueEvents = null
      if (redisConnection) {
        try {
          await redisConnection.quit()
        } catch {
                    // 忽略关闭阶段的次要错误，避免影响主退出流程
        }
      }
      redisConnection = null
    }
  } else {
    console.log('[Queue] Memory mode enabled (REDIS not configured)')
  }

  initialized = true
}

/**
 */
/**
 * 当前是否为 BullMQ 模式。
 */
export function isBullQueueEnabled() {
  return !!queue
}

/**
 */
/**
 * 返回当前队列模式标识。
 */
export function getQueueMode() {
  return queue ? 'bullmq' : 'memory'
}

/**
 * 统计当前内存快照中的任务状态分布，便于统一监控队列健康。
 */
function buildSnapshotStatusStats() {
  const stats = {
    total: jobSnapshots.size,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    unknown: 0
  }

  for (const snapshot of jobSnapshots.values()) {
    const status = String(snapshot?.status || '').toLowerCase()

    if (status === 'queued' || status === 'waiting' || status === 'delayed') {
      stats.queued += 1
      continue
    }

    if (status === 'running' || status === 'active') {
      stats.running += 1
      continue
    }

    if (status === 'completed') {
      stats.completed += 1
      continue
    }

    if (status === 'failed') {
      stats.failed += 1
      continue
    }

    stats.unknown += 1
  }

  return stats
}

/**
 * 解析健康检查阈值，保证环境变量异常时仍有安全默认值。
 */
function parseHealthThreshold(rawValue, fallback) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.floor(parsed)
}

/**
 * 规范化告警对象，便于 API 与脚本统一解析。
 */
function createQueueAlert(code, severity, message, extra = {}) {
  return {
    code,
    severity,
    message,
    ...extra
  }
}

/**
 * 提供队列健康快照：模式、积压、失败数、阈值与告警。
 * - Jobs 健康接口直接消费该结构。
 * - 发布前演练脚本也可复用该结构做断言。
 */
export async function getQueueHealthSnapshot(options = {}) {
  if (!initialized) {
    await initQueueServices()
  }

  const thresholds = {
    backlog_warn: parseHealthThreshold(options.backlogWarn ?? process.env.SPATIAL_QUEUE_BACKLOG_WARN, 200),
    failed_warn: parseHealthThreshold(options.failedWarn ?? process.env.SPATIAL_QUEUE_FAILED_WARN, 20)
  }

  const snapshot_stats = buildSnapshotStatusStats()
  const memory = {
    pending: memoryQueue.length,
    draining: memoryDraining,
    processor_registered: Boolean(memoryProcessor)
  }

  let bullmq = null

  if (queue) {
    try {
      const rawCounts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
        'paused',
        'waiting-children',
        'prioritized'
      )

      bullmq = {
        waiting: Number(rawCounts.waiting || 0),
        active: Number(rawCounts.active || 0),
        delayed: Number(rawCounts.delayed || 0),
        completed: Number(rawCounts.completed || 0),
        failed: Number(rawCounts.failed || 0),
        paused: Number(rawCounts.paused || 0),
        waiting_children: Number(rawCounts['waiting-children'] || 0),
        prioritized: Number(rawCounts.prioritized || 0),
        worker_attached: Boolean(worker),
        queue_events_attached: Boolean(queueEvents)
      }
    } catch (err) {
      bullmq = {
        error: err.message,
        worker_attached: Boolean(worker),
        queue_events_attached: Boolean(queueEvents)
      }
    }
  }

  const backlog = queue
    ? Number(bullmq?.waiting || 0) +
      Number(bullmq?.active || 0) +
      Number(bullmq?.delayed || 0) +
      Number(bullmq?.waiting_children || 0) +
      Number(bullmq?.prioritized || 0)
    : memory.pending

  const failed = queue ? Number(bullmq?.failed || 0) : snapshot_stats.failed

  const alerts = []

  if (!queue) {
    alerts.push(createQueueAlert(
      'memory_mode_enabled',
      'warning',
      '当前运行在 memory 队列模式，进程重启会丢失未完成任务。'
    ))
  }

  if (bullmq?.error) {
    alerts.push(createQueueAlert(
      'bullmq_stats_unavailable',
      'error',
      `BullMQ 统计读取失败: ${bullmq.error}`
    ))
  }

  if (backlog >= thresholds.backlog_warn) {
    alerts.push(createQueueAlert(
      'queue_backlog_high',
      'warning',
      '队列积压已超过预警阈值。',
      { value: backlog, threshold: thresholds.backlog_warn }
    ))
  }

  if (failed >= thresholds.failed_warn) {
    alerts.push(createQueueAlert(
      'queue_failed_high',
      'warning',
      '失败任务数量已超过预警阈值。',
      { value: failed, threshold: thresholds.failed_warn }
    ))
  }

  return {
    sampled_at: new Date().toISOString(),
    queue_name: QUEUE_NAME,
    mode: getQueueMode(),
    initialized,
    redis_configured: Boolean(getRedisConfig()),
    snapshot_stats,
    memory,
    bullmq,
    metrics: {
      backlog,
      failed
    },
    thresholds,
    alerts
  }
}

/**
 * 提交空间任务。
 */
export async function enqueueSpatialJob(payload, options = {}) {
  if (!initialized) {
    await initQueueServices()
  }

  const jobId = payload?.request_id || randomUUID()
  touchSnapshot(jobId, {
    status: 'queued',
    stage: 'queued',
    progress: 0,
    error: null,
    result: null
  })
  appendEvent(jobId, 'queued', { stage: 'queued' })

  if (queue) {
    await queue.add('narrative', payload, {
      jobId,
      attempts: options.attempts ?? parseInt(process.env.SPATIAL_JOB_ATTEMPTS || '2', 10),
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 }
    })
  } else {
    memoryQueue.push({ id: jobId, payload })
    queueMicrotask(() => {
      drainMemoryQueue().catch((err) => {
        console.error(`[Queue] Memory queue drain error: ${err.message}`)
      })
    })
  }

  return {
    jobId,
    queueMode: getQueueMode()
  }
}

/**
 */
/**
 * 注册任务处理器。
 */
export async function registerSpatialJobProcessor(processor, options = {}) {
  if (!initialized) {
    await initQueueServices()
  }

  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY

  if (queue) {
    if (worker) {
      return worker
    }

    worker = new Worker(
      QUEUE_NAME,
      async (job) => runProcessor(processor, job.id, job.data, job),
      {
        connection: redisConnection,
        concurrency
      }
    )

    worker.on('error', (err) => {
      console.error(`[Queue Worker] ${err.message}`)
    })

    worker.on('failed', (job, err) => {
      console.error(`[Queue Worker] Job failed ${job?.id || 'unknown'}: ${err.message}`)
    })

    return worker
  }

  memoryProcessor = processor
  await drainMemoryQueue()
  return null
}

/**
 */
/**
 * 获取任务快照（含状态和进度）。
 */
export async function getJobSnapshot(jobId) {
  const snapshot = jobSnapshots.get(jobId)
  if (snapshot) {
    return snapshot
  }

  if (queue) {
    const job = await queue.getJob(jobId)
    if (!job) {
      return null
    }

    const state = await job.getState()
    const progressRaw = await job.progress
    const progressValue =
      typeof progressRaw === 'number'
        ? progressRaw
        : typeof progressRaw?.progress === 'number'
          ? progressRaw.progress
          : 0

    const hydrated = touchSnapshot(jobId, {
      status: state,
      stage: progressRaw?.stage || state,
      progress: progressValue,
      result: job.returnvalue ?? null,
      error: job.failedReason ?? null
    })

    return hydrated
  }

  return null
}

/**
 */
/**
 * 获取任务结果。
 */
export async function getJobResult(jobId) {
  const snapshot = await getJobSnapshot(jobId)
  if (!snapshot) {
    return null
  }

  return snapshot.result || null
}

/**
 */
/**
 * 等待任务结束（sync 路由使用）。
 */
export async function awaitJobCompletion(jobId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000
  const current = await getJobSnapshot(jobId)

  if (current?.status === 'completed') {
    return current
  }

  if (current?.status === 'failed') {
    throw new Error(current.error || 'Job failed')
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Job timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const unsubscribe = subscribeJobEvents(jobId, async (event) => {
      if (event.type === 'completed') {
        clearTimeout(timeout)
        unsubscribe()
        const snapshot = await getJobSnapshot(jobId)
        resolve(snapshot)
      }

      if (event.type === 'failed') {
        clearTimeout(timeout)
        unsubscribe()
        reject(new Error(event.payload?.error || 'Job failed'))
      }
    }, { replay: false })
  })
}

/**
 */
/**
 * 订阅单任务事件流。
 */
export function subscribeJobEvents(jobId, handler, options = {}) {
  const replay = options.replay !== false
  const snapshot = jobSnapshots.get(jobId)

  const listener = (event) => {
    if (event.job_id !== jobId) {
      return
    }
    handler(event)
  }

  eventBus.on('job_event', listener)

  const unsubscribe = () => {
    eventBus.off('job_event', listener)
  }

  if (replay && snapshot?.events?.length) {
    queueMicrotask(() => {
      for (const event of snapshot.events) {
        handler(event)
      }
    })
  }

  return unsubscribe
}

/**
 */
/**
 * 关闭队列服务资源。
 */
export async function closeQueueServices() {
  if (worker) {
    await worker.close()
    worker = null
  }

  if (queueEvents) {
    await queueEvents.close()
    queueEvents = null
  }

  if (queue) {
    await queue.close()
    queue = null
  }

  if (redisConnection) {
    await redisConnection.quit()
    redisConnection = null
  }

  initialized = false
}

export default {
  initQueueServices,
  closeQueueServices,
  enqueueSpatialJob,
  registerSpatialJobProcessor,
  getJobSnapshot,
  getJobResult,
  awaitJobCompletion,
  subscribeJobEvents,
  getQueueMode,
  isBullQueueEnabled,
  getQueueHealthSnapshot
}
