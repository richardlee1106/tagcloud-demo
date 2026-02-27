/**
 * Jobs 闃熷垪鏈嶅姟銆?
 * 鏀寔 BullMQ锛圧edis锛変笌鍐呭瓨闄嶇骇妯″紡銆?
 */
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import IORedis from 'ioredis'
import { Queue, QueueEvents, Worker } from 'bullmq'
import telemetry from './telemetry.js'

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

export function buildQueueFailurePayload(errorLike) {
  if (errorLike && typeof errorLike === 'object' && !Array.isArray(errorLike)) {
    const plain = errorLike
    const resolvedCode = plain.error_code || plain.code || plain?.diagnostics?.error_code
    return {
      error: String(plain.error || plain.message || 'Job failed'),
      error_code: resolvedCode
        ? String(resolvedCode)
        : null,
      diagnostics: plain.diagnostics && typeof plain.diagnostics === 'object'
        ? plain.diagnostics
        : null
    }
  }

  if (errorLike instanceof Error) {
    return {
      error: String(errorLike.message || 'Job failed'),
      error_code: errorLike.code ? String(errorLike.code) : null,
      diagnostics: errorLike.diagnostics && typeof errorLike.diagnostics === 'object'
        ? errorLike.diagnostics
        : null
    }
  }

  return {
    error: String(errorLike || 'Job failed'),
    error_code: null,
    diagnostics: null
  }
}
/**
 */
/**
 * 鏋勫缓 Redis 杩炴帴鍙傛暟銆?
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
 * 鍒涘缓鎴栨洿鏂颁换鍔″揩鐓с€?
 */
function touchSnapshot(jobId, patch = {}) {
  const current = jobSnapshots.get(jobId) || {
    job_id: jobId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    eta_ms: null,
    error: null,
    error_code: null,
    diagnostics: null,
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
 * 杩藉姞浠诲姟浜嬩欢骞堕┍鍔ㄧ姸鎬佹満鏇存柊銆?
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
    const failurePayload = buildQueueFailurePayload(payload)
    snapshot.status = 'failed'
    snapshot.stage = 'failed'
    snapshot.error = failurePayload.error || 'Job failed'
    snapshot.error_code = failurePayload.error_code || null
    snapshot.diagnostics = failurePayload.diagnostics || null
  }

  eventBus.emit('job_event', event)
  telemetry.incrementCounter('queue_event_total', { type: String(type || 'unknown') })
  return event
}

/**
 */
/**
 * 涓婃姤杩涘害锛氬唴瀛樹簨浠跺繀鍐欙紝BullMQ 杩涘害灏藉姏鍐欍€?
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
 * 鐢熸垚鏍囧噯 reporter 鎺ュ彛銆?
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
 * 鎵ц浠诲姟澶勭悊鍣紝缁熶竴缁存姢瀹屾垚/澶辫触鐘舵€併€?
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
    const failurePayload = buildQueueFailurePayload(err)
    touchSnapshot(jobId, {
      status: 'failed',
      stage: 'failed',
      error: failurePayload.error,
      error_code: failurePayload.error_code,
      diagnostics: failurePayload.diagnostics
    })
    appendEvent(jobId, 'failed', failurePayload)
    if (bullJob) {
      try {
        await bullJob.updateProgress({ event: 'failed', ...failurePayload, ts: Date.now() })
      } catch {
      }
    }
    throw err
  }
}

/**
 */
/**
 * 鍐呭瓨闃熷垪娑堣垂鍣紙Redis 涓嶅彲鐢ㄦ椂鍚敤锛夈€?
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
 * 鐩戝惉 BullMQ 浜嬩欢骞舵槧灏勫埌鍐呴儴浜嬩欢鎬荤嚎銆?
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
    const failurePayload = buildQueueFailurePayload(failedReason)
    touchSnapshot(jobId, {
      status: 'failed',
      stage: 'failed',
      error: failurePayload.error,
      error_code: failurePayload.error_code,
      diagnostics: failurePayload.diagnostics
    })

    appendEvent(jobId, 'failed', failurePayload)
  })
}

/**
 */
/**
 * 鍒濆鍖栭槦鍒楁湇鍔°€?
 * 浼樺厛 BullMQ锛屽け璐ヨ嚜鍔ㄩ檷绾у唴瀛樻ā寮忋€?
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
                    // 怨乇战锥蔚拇要螅影顺
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
 * 褰撳墠鏄惁涓?BullMQ 妯″紡銆?
 */
export function isBullQueueEnabled() {
  return !!queue
}

/**
 */
/**
 * 杩斿洖褰撳墠闃熷垪妯″紡鏍囪瘑銆?
 */
export function getQueueMode() {
  return queue ? 'bullmq' : 'memory'
}

/**
 * 缁熻褰撳墠鍐呭瓨蹇収涓殑浠诲姟鐘舵€佸垎甯冿紝渚夸簬缁熶竴鐩戞帶闃熷垪鍋ュ悍銆?
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
 * 值证斐Ｊ毙叭?
 */
function parseHealthThreshold(rawValue, fallback) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.floor(parsed)
}

/**
 * 瑙勮寖鍖栧憡璀﹀璞★紝渚夸簬 API 涓庤剼鏈粺涓€瑙ｆ瀽銆?
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
 * 鎻愪緵闃熷垪鍋ュ悍蹇収锛氭ā寮忋€佺Н鍘嬨€佸け璐ユ暟銆侀槇鍊间笌鍛婅銆?
 * - Jobs 鍋ュ悍鎺ュ彛鐩存帴娑堣垂璇ョ粨鏋勩€?
 * - 鍙戝竷鍓嶆紨缁冭剼鏈篃鍙鐢ㄨ缁撴瀯鍋氭柇瑷€銆?
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

  telemetry.setGauge('queue_backlog', backlog, { mode: getQueueMode() })
  telemetry.setGauge('queue_failed', failed, { mode: getQueueMode() })

  const alerts = []

  if (!queue) {
    alerts.push(createQueueAlert(
      'memory_mode_enabled',
      'warning',
      'Queue is running in memory mode; unfinished jobs may be lost on restart.'
    ))
  }

  if (bullmq?.error) {
    alerts.push(createQueueAlert(
      'bullmq_stats_unavailable',
      'error',
      `BullMQ 缁熻璇诲彇澶辫触: ${bullmq.error}`
    ))
  }

  if (backlog >= thresholds.backlog_warn) {
    alerts.push(createQueueAlert(
      'queue_backlog_high',
      'warning',
      '谢压殉预值',
      { value: backlog, threshold: thresholds.backlog_warn }
    ))
  }

  if (failed >= thresholds.failed_warn) {
    alerts.push(createQueueAlert(
      'queue_failed_high',
      'warning',
      '失殉预值',
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
 * 鎻愪氦绌洪棿浠诲姟銆?
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
 * 娉ㄥ唽浠诲姟澶勭悊鍣ㄣ€?
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
 * 鑾峰彇浠诲姟蹇収锛堝惈鐘舵€佸拰杩涘害锛夈€?
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
      error: job.failedReason ?? null,
      error_code: progressRaw?.error_code || null,
      diagnostics: progressRaw?.diagnostics && typeof progressRaw.diagnostics === 'object'
        ? progressRaw.diagnostics
        : null
    })

    return hydrated
  }

  return null
}

/**
 */
/**
 * 鑾峰彇浠诲姟缁撴灉銆?
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
 * 绛夊緟浠诲姟缁撴潫锛坰ync 璺敱浣跨敤锛夈€?
 */
export async function awaitJobCompletion(jobId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000
  const current = await getJobSnapshot(jobId)

  if (current?.status === 'completed') {
    return current
  }

  if (current?.status === 'failed') {
    const error = new Error(current.error || 'Job failed')
    if (current.error_code) error.code = String(current.error_code)
    if (current.diagnostics && typeof current.diagnostics === 'object') {
      error.diagnostics = current.diagnostics
    }
    throw error
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
        const failurePayload = buildQueueFailurePayload(event.payload)
        const error = new Error(failurePayload.error || 'Job failed')
        if (failurePayload.error_code) error.code = String(failurePayload.error_code)
        if (failurePayload.diagnostics && typeof failurePayload.diagnostics === 'object') {
          error.diagnostics = failurePayload.diagnostics
        }
        reject(error)
      }
    }, { replay: false })
  })
}

/**
 */
/**
 * 璁㈤槄鍗曚换鍔′簨浠舵祦銆?
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
 * 鍏抽棴闃熷垪鏈嶅姟璧勬簮銆?
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

