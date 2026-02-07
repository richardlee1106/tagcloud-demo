/**
 * 空间任务 Worker 入口。
 *
 * 用法：
 * - 独立进程运行（推荐生产）：`node workers/spatialWorker.js`
 * - 或由 server 内联启动（开发调试）。
 */
import { initQueueServices, registerSpatialJobProcessor, closeQueueServices } from '../services/queue.js'
import { runNarrativeSpatialJob } from '../services/spatialJobRunner.js'

let started = false

/**
 * 启动 worker，并将 narrative 任务处理函数注册给队列层。
 */
export async function startSpatialWorker(options = {}) {
  if (started) {
    return
  }

  await initQueueServices()
  await registerSpatialJobProcessor(async (payload, reporter) => {
    return runNarrativeSpatialJob(payload, reporter)
  }, {
    concurrency: options.concurrency
  })

  started = true
  console.log('[SpatialWorker] Ready')
}

/**
 * 停止 worker，释放队列连接。
 */
export async function stopSpatialWorker() {
  if (!started) {
    return
  }

  await closeQueueServices()
  started = false
}

// 作为独立脚本运行时，自动启动并监听退出信号。
if (process.argv[1] && process.argv[1].endsWith('spatialWorker.js')) {
  startSpatialWorker().catch((err) => {
    console.error('[SpatialWorker] Failed to start:', err)
    process.exit(1)
  })

  const shutdown = async () => {
    try {
      await stopSpatialWorker()
      process.exit(0)
    } catch (err) {
      console.error('[SpatialWorker] Failed to stop cleanly:', err)
      process.exit(1)
    }
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

export default {
  startSpatialWorker,
  stopSpatialWorker
}
