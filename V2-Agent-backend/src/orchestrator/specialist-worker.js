import { parentPort, workerData } from 'node:worker_threads'

import { runSpecialistTask } from './specialist-catalog.js'

async function run() {
  try {
    const result = await runSpecialistTask(workerData)
    parentPort?.postMessage({
      ok: true,
      result
    })
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: {
        message: error?.message ?? 'unknown_worker_error'
      }
    })
  }
}

void run()
