import { spawn } from 'child_process'
import net from 'net'
import readline from 'readline'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// 允许通过环境变量覆盖 Python 可执行路径（Windows/venv 常见需求）
const PYTHON_BIN = process.env.PYTHON_BIN || 'python'
const GRPC_HOST = process.env.SPATIAL_GRPC_HOST || '127.0.0.1'
const GRPC_PORT = parseInt(process.env.SPATIAL_GRPC_PORT || '50051', 10)
const GRPC_WAIT_MS = parseInt(process.env.SPATIAL_GRPC_WAIT_MS || '15000', 10)
// ???????? Worker????????????????Redis??????????
const FORCE_EXTERNAL_WORKER = process.env.SPATIAL_FORCE_EXTERNAL_WORKER === 'true'
// ????? Redis ?????????? BullMQ ??????
const HAS_REDIS_CONFIG = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST)
// ?????
// - ? Redis?????? + ?? Worker?
// - ? Redis???????? Worker??????????????
const USE_EXTERNAL_WORKER = FORCE_EXTERNAL_WORKER || HAS_REDIS_CONFIG

const pythonService = {
  name: 'python-grpc',
  command: PYTHON_BIN,
  args: ['python_service/grpc_server.py'],
  cwd: ROOT,
  env: {}
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
      // ? Redis ??????? Worker??? jobs ? memory ?????????????
      ENABLE_INLINE_SPATIAL_WORKER: USE_EXTERNAL_WORKER ? 'false' : 'true'
    }
  }
}

const children = []
let stopping = false

/**
 * 将子进程输出按服务名前缀打印，便于观察多服务日志。
 */
function pipePrefixedLines(stream, prefix, writer) {
  if (!stream) return

  const rl = readline.createInterface({ input: stream })
  rl.on('line', (line) => {
    writer(`[${prefix}] ${line}`)
  })
}

/**
 * 统一停止所有子进程。
 * - 先发 SIGTERM 给优雅退出机会
 * - 超时后发 SIGKILL 强制清理
 */
function stopAll(exitCode = 0) {
  if (stopping) return
  stopping = true

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
 * 启动单个服务并接管其生命周期。
 */
function spawnService(definition) {
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

  // 任一关键服务异常退出时，整体联调环境同步收敛。
  child.on('exit', (code, signal) => {
    if (stopping) return

    const reason = signal ? `signal=${signal}` : `code=${code}`
    console.error(`[${definition.name}] exited (${reason}), shutting down all services...`)
    stopAll(code || 1)
  })

  children.push(child)
  console.log(`[launcher] started ${definition.name} (${definition.command} ${definition.args.join(' ')})`)

  return child
}

/**
 * 等待目标 TCP 端口可连接，用于确保 Python gRPC 已就绪后再放行后续服务。
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
  spawnService(pythonService)

  // Python ???????????????? gRPC ????????????
  const grpcReady = await waitForTcpPort(GRPC_HOST, GRPC_PORT, GRPC_WAIT_MS)
  if (grpcReady) {
    console.log(`[launcher] python gRPC ready at ${GRPC_HOST}:${GRPC_PORT}`)
  } else {
    // ???????????? Node ?? executor ?????
    console.warn(`[launcher] python gRPC not ready within ${GRPC_WAIT_MS}ms, backend will rely on fallback path until ready`)
  }

  if (USE_EXTERNAL_WORKER) {
    // Redis ???????? Worker??? memory ????????
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
