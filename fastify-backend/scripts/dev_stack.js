import { spawn } from 'child_process'
import fs from 'fs'
import net from 'net'
import readline from 'readline'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// Allow overriding Python executable path (venv/py launcher on Windows)
const PYTHON_BIN = process.env.PYTHON_BIN || 'python'
const GRPC_HOST = process.env.SPATIAL_GRPC_HOST || '127.0.0.1'
const GRPC_PORT = parseInt(process.env.SPATIAL_GRPC_PORT || '50051', 10)
const GRPC_WAIT_MS = parseInt(process.env.SPATIAL_GRPC_WAIT_MS || '15000', 10)
const PYTHON_WATCH_ENABLED = process.env.PYTHON_WATCH_ENABLED !== 'false'
const PYTHON_WATCH_DEBOUNCE_MS = parseInt(process.env.PYTHON_WATCH_DEBOUNCE_MS || '450', 10)

// Worker mode:
// - Redis configured: external worker
// - no Redis: backend consumes memory queue inline
const FORCE_EXTERNAL_WORKER = process.env.SPATIAL_FORCE_EXTERNAL_WORKER === 'true'
const HAS_REDIS_CONFIG = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST)
const USE_EXTERNAL_WORKER = FORCE_EXTERNAL_WORKER || HAS_REDIS_CONFIG

const pythonService = {
  name: 'python-grpc',
  command: PYTHON_BIN,
  args: ['python_service/grpc_server.py'],
  cwd: ROOT,
  env: {
    PYTHONUTF8: process.env.PYTHONUTF8 || '1',
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8'
  }
}

const workerService = {
  name: 'worker',
  command: 'node',
  args: ['workers/spatialWorker.js'],
  cwd: ROOT,
  env: {}
}

function createBackendService() {
  return {
    name: 'backend',
    command: 'node',
    args: ['server.js'],
    cwd: ROOT,
    env: {
      ENABLE_INLINE_SPATIAL_WORKER: USE_EXTERNAL_WORKER ? 'false' : 'true'
    }
  }
}

const children = []
let stopping = false
let pythonChild = null
let pythonWatcher = null
let pythonRestartTimer = null
let pythonRestarting = false

/**
 * Prefix child process logs with service name.
 */
function pipePrefixedLines(stream, prefix, writer) {
  if (!stream) return

  const rl = readline.createInterface({ input: stream })
  rl.on('line', (line) => {
    writer(`[${prefix}] ${line}`)
  })
}

/**
 * Stop all child processes gracefully, then force kill on timeout.
 */
function stopAll(exitCode = 0) {
  if (stopping) return
  stopping = true

  if (pythonRestartTimer) {
    clearTimeout(pythonRestartTimer)
    pythonRestartTimer = null
  }

  if (pythonWatcher) {
    try {
      pythonWatcher.close()
    } catch {
      // ignore watcher close errors
    }
    pythonWatcher = null
  }

  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore child termination errors
      }
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
    }
    process.exit(exitCode)
  }, 1500)
}

/**
 * Start one service process and attach lifecycle handlers.
 */
function spawnService(definition, options = {}) {
  const child = spawn(definition.command, definition.args, {
    cwd: definition.cwd,
    env: {
      ...process.env,
      ...definition.env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  pipePrefixedLines(child.stdout, definition.name, console.log)
  pipePrefixedLines(child.stderr, definition.name, console.error)

  child.on('exit', (code, signal) => {
    const idx = children.indexOf(child)
    if (idx >= 0) {
      children.splice(idx, 1)
    }

    if (stopping) return

    if (typeof options.onExit === 'function') {
      options.onExit({ code, signal, child, definition })
      return
    }

    const reason = signal ? `signal=${signal}` : `code=${code}`
    console.error(`[${definition.name}] exited (${reason}), shutting down all services...`)
    stopAll(code || 1)
  })

  children.push(child)
  console.log(`[launcher] started ${definition.name} (${definition.command} ${definition.args.join(' ')})`)

  return child
}

function shouldRestartPythonOnFile(filename) {
  if (!filename) return false
  const normalized = String(filename).replace(/\\/g, '/').toLowerCase()
  if (!normalized) return false
  if (!normalized.endsWith('.py') && !normalized.endsWith('.proto')) return false
  if (normalized.endsWith('.pyc')) return false
  if (normalized.includes('/__pycache__/')) return false
  if (normalized.includes('/generated/')) return false
  return true
}

function handlePythonExit({ code, signal }) {
  if (stopping) return

  if (pythonRestarting) {
    pythonRestarting = false
    pythonChild = spawnService(pythonService, { onExit: handlePythonExit })
    return
  }

  const reason = signal ? `signal=${signal}` : `code=${code}`
  console.error(`[python-grpc] exited (${reason}), shutting down all services...`)
  stopAll(code || 1)
}

function restartPythonService(trigger) {
  if (!pythonChild || pythonChild.killed || stopping) return
  if (pythonRestarting) return

  pythonRestarting = true
  console.log(`[launcher] python source changed (${trigger}), restarting python-grpc...`)

  try {
    pythonChild.kill('SIGTERM')
  } catch {
    // fallback hard kill path
    try {
      pythonChild.kill('SIGKILL')
    } catch {
      pythonRestarting = false
    }
  }

  setTimeout(() => {
    if (!pythonRestarting || !pythonChild || pythonChild.killed) return
    try {
      pythonChild.kill('SIGKILL')
    } catch {
      // ignore
    }
  }, 1200)
}

function startPythonWatcher() {
  if (!PYTHON_WATCH_ENABLED) {
    console.log('[launcher] python watch disabled (PYTHON_WATCH_ENABLED=false)')
    return
  }

  const watchRoot = path.resolve(ROOT, 'python_service')

  try {
    pythonWatcher = fs.watch(watchRoot, { recursive: true }, (_eventType, filename) => {
      const file = Buffer.isBuffer(filename) ? filename.toString('utf8') : filename
      if (!shouldRestartPythonOnFile(file)) return

      if (pythonRestartTimer) clearTimeout(pythonRestartTimer)
      pythonRestartTimer = setTimeout(() => {
        pythonRestartTimer = null
        restartPythonService(file || 'python_service')
      }, Math.max(100, PYTHON_WATCH_DEBOUNCE_MS))
    })

    pythonWatcher.on('error', (err) => {
      console.warn(`[launcher] python watcher error: ${err.message}`)
    })

    console.log(`[launcher] python watch enabled: ${watchRoot}`)
  } catch (err) {
    console.warn(`[launcher] python watch unavailable: ${err.message}`)
  }
}

/**
 * Wait until a TCP port is connectable.
 */
async function waitForTcpPort(host, port, timeoutMs) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = new net.Socket()

      const cleanup = () => {
        socket.removeAllListeners()
        socket.destroy()
      }

      socket.setTimeout(1000)
      socket.once('connect', () => {
        cleanup()
        resolve(true)
      })
      socket.once('timeout', () => {
        cleanup()
        resolve(false)
      })
      socket.once('error', () => {
        cleanup()
        resolve(false)
      })

      socket.connect(port, host)
    })

    if (connected) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  return false
}

async function bootStack() {
  console.log(`[launcher] queue mode decision: ${USE_EXTERNAL_WORKER ? 'external-worker' : 'inline-worker'} (${HAS_REDIS_CONFIG ? 'redis-configured' : 'redis-missing'})`)

  pythonChild = spawnService(pythonService, { onExit: handlePythonExit })
  startPythonWatcher()

  const grpcReady = await waitForTcpPort(GRPC_HOST, GRPC_PORT, GRPC_WAIT_MS)
  if (grpcReady) {
    console.log(`[launcher] python gRPC ready at ${GRPC_HOST}:${GRPC_PORT}`)
  } else {
    console.warn(`[launcher] python gRPC not ready within ${GRPC_WAIT_MS}ms, backend will rely on fallback path until ready`)
  }

  if (USE_EXTERNAL_WORKER) {
    spawnService(workerService)
  } else {
    console.log('[launcher] skip external worker: memory queue will be consumed by backend inline worker')
  }

  spawnService(createBackendService())

  console.log(`[launcher] stack started: python-grpc + ${USE_EXTERNAL_WORKER ? 'worker + ' : ''}backend`)
  console.log('[launcher] press Ctrl+C to stop')
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

await bootStack()
