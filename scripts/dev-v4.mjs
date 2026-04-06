import { execSync, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildCompetingDevPorts,
  createV4ProcessSpecs,
  ensureV4RedisTargetReady,
  parseWindowsNetstatPids,
  readEnvFile,
  resolveV4RedisUrl,
  resolveV4DevConfig,
  runV4DevCleanup,
} from './lib/dev-v4.js'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))

function listPidsForPort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString('utf8')
      return parseWindowsNetstatPids(output).filter((pid) => pid !== process.pid)
    }

    const output = execSync(`lsof -ti tcp:${port}`, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8')

    return output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid)
  } catch {
    return []
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, {
        cwd: rootDir,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      return true
    }

    process.kill(pid, 'SIGKILL')
    return true
  } catch {
    return false
  }
}

function cleanupPorts(ports = []) {
  const uniquePorts = [...new Set(ports.filter(Boolean))]
  const killed = []

  for (const port of uniquePorts) {
    const pids = listPidsForPort(port)
    for (const pid of pids) {
      if (killPid(pid)) {
        killed.push({ port, pid })
      }
    }
  }

  return killed
}

const frontendEnv = readEnvFile(join(rootDir, '.env.v4'))
const backendEnv = readEnvFile(join(rootDir, 'V4-GeoLoom-beta', '.env'))
const backendExampleEnv = readEnvFile(join(rootDir, 'V4-GeoLoom-beta', '.env.example'))
const runtimeEnv = {
  ...process.env,
}

runtimeEnv.REDIS_URL = await resolveV4RedisUrl({
  env: runtimeEnv,
  frontendEnv,
  backendEnv,
  backendExampleEnv,
})

const redisBootstrap = await ensureV4RedisTargetReady({
  rootDir,
  redisUrl: runtimeEnv.REDIS_URL,
  logger: console,
})

if (redisBootstrap.ready) {
  const suffix = redisBootstrap.started ? ` (started ${redisBootstrap.containerName})` : ''
  console.log(`[dev:v4] redis ready at ${runtimeEnv.REDIS_URL}${suffix}`)
} else {
  console.warn(`[dev:v4] redis unavailable at ${runtimeEnv.REDIS_URL}; V4 short-term memory may fallback to in-memory mode`)
}

const config = resolveV4DevConfig({
  env: runtimeEnv,
  frontendEnv,
  backendEnv,
  backendExampleEnv,
})

const trackedPorts = buildCompetingDevPorts({
  frontendPort: config.frontendPort,
  backendPort: config.backendPort,
  dependencyPort: config.dependencyPort,
  v3EncoderPort: config.spatialEncoderPort,
})

const cleanupResult = runV4DevCleanup({
  frontendPort: config.frontendPort,
  backendPort: config.backendPort,
  dependencyPort: config.dependencyPort,
  v3EncoderPort: config.spatialEncoderPort,
  logger: console,
})

const cleaned = cleanupPorts(cleanupResult.trackedPorts || trackedPorts)

if (cleaned.length > 0) {
  console.log('[dev:v4] cleaned occupied ports:')
  for (const item of cleaned) {
    console.log(`  - port ${item.port} -> pid ${item.pid}`)
  }
} else if (!cleanupResult.killedPids.length) {
  console.log('[dev:v4] no competing dev ports were occupied')
}

function pipeWithPrefix(stream, prefix, target) {
  if (!stream) return

  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      target.write(`[${prefix}] ${line}\n`)
    }
  })
  stream.on('end', () => {
    if (buffer) {
      target.write(`[${prefix}] ${buffer}\n`)
      buffer = ''
    }
  })
}

const processSpecs = createV4ProcessSpecs({
  rootDir,
  platform: process.platform,
  frontendEnv: config.frontendEnv,
  dependencyEnv: config.dependencyEnv,
  backendEnv: config.backendEnv,
})

const children = processSpecs.map((spec) => {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...spec.env,
    },
  })

  pipeWithPrefix(child.stdout, spec.label, process.stdout)
  pipeWithPrefix(child.stderr, spec.label, process.stderr)

  return {
    label: spec.label,
    child,
  }
})

let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  for (const entry of children) {
    if (!entry.child.killed) {
      entry.child.kill(signal)
    }
  }
}

for (const { label, child } of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    if (signal) {
      console.log(`[dev:v4] ${label} exited via signal ${signal}`)
      shutdown(signal)
      process.kill(process.pid, signal)
      return
    }

    console.log(`[dev:v4] ${label} exited with code ${code ?? 0}`)
    shutdown('SIGTERM')
    process.exit(code ?? 0)
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal)
  })
}
