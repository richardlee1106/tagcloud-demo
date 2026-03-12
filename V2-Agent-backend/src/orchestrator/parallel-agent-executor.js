import { Worker } from 'node:worker_threads'

import { isTestRuntime } from '../llm/llm-gateway.js'
import { KNOWN_SPECIALISTS, runSpecialistTask } from './specialist-catalog.js'

const EXECUTOR_MODES = new Set(['in_process', 'worker_threads'])

function resolveExecutorMode() {
  const mode = String(process.env.V2_AGENT_EXECUTOR_MODE || '').trim().toLowerCase()
  if (EXECUTOR_MODES.has(mode)) {
    return mode
  }

  return isTestRuntime() ? 'in_process' : 'worker_threads'
}

async function runInProcess(tasks = [], runTask) {
  return Promise.all(tasks.map((task) => runTask(task)))
}

function runInWorker(task, { workerTimeoutMs, workerScriptUrl }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerScriptUrl, {
      workerData: task
    })

    const timer = setTimeout(() => {
      worker.terminate().catch(() => {})
      reject(new Error('worker_timeout'))
    }, workerTimeoutMs)

    worker.once('message', (message) => {
      clearTimeout(timer)
      if (message?.ok) {
        resolve(message.result)
        return
      }

      reject(new Error(message?.error?.message ?? 'worker_task_failed'))
    })

    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer)
        reject(new Error(`worker_exit_${code}`))
      }
    })
  })
}

export function createParallelAgentExecutor({
  mode = resolveExecutorMode(),
  workerTimeoutMs = Number(process.env.V2_AGENT_WORKER_TIMEOUT_MS || 2500),
  specialistRegistry = null
} = {}) {
  const resolvedMode = EXECUTOR_MODES.has(mode) ? mode : 'in_process'
  const workerScriptUrl = new URL('./specialist-worker.js', import.meta.url)
  const usesCustomRegistry = Boolean(specialistRegistry)
  const runTask = (task) => runSpecialistTask(task, { specialistRegistry })

  return {
    mode: resolvedMode,
    listKnownSpecialists() {
      if (typeof specialistRegistry?.listKnownSpecialists === 'function') {
        return specialistRegistry.listKnownSpecialists()
      }
      return [...KNOWN_SPECIALISTS]
    },
    async runSpecialist(task) {
      if (!task || typeof task !== 'object') {
        throw new Error('invalid_specialist_task')
      }

      if (resolvedMode === 'in_process' || usesCustomRegistry) {
        return runTask(task)
      }

      try {
        return await runInWorker(task, { workerTimeoutMs, workerScriptUrl })
      } catch {
        return runTask(task)
      }
    },
    async runSpecialists(tasks = []) {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return []
      }

      return Promise.all(tasks.map((task) => this.runSpecialist(task)))
    }
  }
}
