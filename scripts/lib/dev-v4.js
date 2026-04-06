import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'

import { parse as parseEnv } from 'dotenv'

export const DEFAULT_V4_FRONTEND_PORT = 3000
export const DEFAULT_V4_BACKEND_PORT = 3210
export const DEFAULT_V4_DEPENDENCY_PORT = 3410
export const DEFAULT_V1_BACKEND_PORT = 3200
export const DEFAULT_V3_BACKEND_PORT = 3300
export const DEFAULT_V1_SPATIAL_GRPC_PORT = 50051
export const DEFAULT_V3_SPATIAL_ENCODER_PORT = 8100

const DEV_V3_TOKEN = 'dev:v3'
const FRONT_V3_TOKEN = 'front,v3'
const CONCURRENTLY_TOKEN = 'concurrently'
const V1_PATH_TOKEN = 'v1-fastify-backend'
const V3_PATH_TOKEN = 'v3-geoencoder-rag'
const V4_PATH_TOKEN = 'v4-geoloom-beta'
const DEFAULT_V4_REDIS_URL = 'redis://127.0.0.1:6380/0'
const DEFAULT_V4_REDIS_PORTS = [6380, 6379]

function toPort(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === '') return []
  return [value]
}

function toPid(value) {
  const pid = Number.parseInt(String(value), 10)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function getPortFromUrl(value, fallback) {
  const text = String(value || '').trim()
  if (!text) return fallback

  try {
    const url = new URL(text)
    return toPort(url.port, fallback)
  } catch {
    return fallback
  }
}

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase()
}

function isLocalHostname(value) {
  return ['127.0.0.1', 'localhost', '::1'].includes(normalizeHostname(value))
}

function toRedisUrl(hostname, port) {
  return `redis://${hostname}:${port}/0`
}

function parseRedisTarget(redisUrl) {
  const text = String(redisUrl || '').trim()
  if (!text) return null

  try {
    const target = new URL(text)
    return {
      url: target,
      hostname: target.hostname || '127.0.0.1',
      port: toPort(target.port, target.protocol === 'rediss:' ? 6380 : 6379),
    }
  } catch {
    return null
  }
}

function runCommandSync(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  })

  return {
    status: typeof result.status === 'number' ? result.status : (result.error ? 1 : 0),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  }
}

export function probeTcpPort(hostname, port, timeoutMs = 350) {
  const host = normalizeHostname(hostname) || '127.0.0.1'
  const targetPort = toPort(port, 0)
  if (!targetPort) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(targetPort, host)
  })
}

async function waitForTcpPort({
  hostname,
  port,
  timeoutMs = 5000,
  intervalMs = 250,
  portProbe = probeTcpPort,
} = {}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await portProbe(hostname, port)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

export async function resolveV4RedisUrl({
  env = {},
  backendEnv = {},
  backendExampleEnv = {},
  portProbe = probeTcpPort,
  preferredPorts = DEFAULT_V4_REDIS_PORTS,
  hostname = '127.0.0.1',
} = {}) {
  const explicitRedisUrl = String(
    env.REDIS_URL || backendEnv.REDIS_URL || backendExampleEnv.REDIS_URL || '',
  ).trim()

  if (explicitRedisUrl) {
    return explicitRedisUrl
  }

  for (const candidatePort of preferredPorts) {
    const targetPort = toPort(candidatePort, 0)
    if (!targetPort) continue

    if (await portProbe(hostname, targetPort)) {
      return toRedisUrl(hostname, targetPort)
    }
  }

  return DEFAULT_V4_REDIS_URL
}

export async function ensureV4RedisTargetReady({
  rootDir,
  redisUrl,
  logger = console,
  portProbe = probeTcpPort,
  runCommand = runCommandSync,
  waitForPort = waitForTcpPort,
  containerNamePrefix = 'geoloom-v4-redis',
  dockerImage = 'redis:7-alpine',
} = {}) {
  const target = parseRedisTarget(redisUrl)
  if (!target) {
    return {
      ready: false,
      started: false,
      reason: 'invalid_redis_url',
      redisUrl: String(redisUrl || ''),
      containerName: null,
      port: null,
    }
  }

  if (!isLocalHostname(target.hostname)) {
    return {
      ready: true,
      started: false,
      reason: null,
      redisUrl,
      containerName: null,
      port: target.port,
    }
  }

  if (await portProbe(target.hostname, target.port)) {
    return {
      ready: true,
      started: false,
      reason: null,
      redisUrl,
      containerName: `${containerNamePrefix}-${target.port}`,
      port: target.port,
    }
  }

  const containerName = `${containerNamePrefix}-${target.port}`
  const versionResult = runCommand('docker', ['version', '--format', '{{.Server.Version}}'], {
    cwd: rootDir,
  })
  if (versionResult.status !== 0) {
    logger.warn?.(`[dev:v4] Redis target ${redisUrl} is unavailable and Docker is not ready.`)
    return {
      ready: false,
      started: false,
      reason: 'docker_unavailable',
      redisUrl,
      containerName,
      port: target.port,
    }
  }

  const inspectResult = runCommand(
    'docker',
    ['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}'],
    { cwd: rootDir },
  )
  if (inspectResult.status !== 0) {
    logger.warn?.(`[dev:v4] Unable to inspect Redis container ${containerName}.`)
    return {
      ready: false,
      started: false,
      reason: 'docker_inspect_failed',
      redisUrl,
      containerName,
      port: target.port,
    }
  }

  const existingContainer = inspectResult.stdout.trim()
  const startResult = existingContainer === containerName
    ? runCommand('docker', ['start', containerName], { cwd: rootDir })
    : runCommand(
      'docker',
      ['run', '-d', '--name', containerName, '-p', `${target.port}:6379`, dockerImage],
      { cwd: rootDir },
    )

  if (startResult.status !== 0) {
    logger.warn?.(`[dev:v4] Failed to start Redis container ${containerName}.`)
    return {
      ready: false,
      started: false,
      reason: 'docker_start_failed',
      redisUrl,
      containerName,
      port: target.port,
    }
  }

  const ready = await waitForPort({
    hostname: target.hostname,
    port: target.port,
    portProbe,
  })

  if (!ready) {
    logger.warn?.(`[dev:v4] Redis container ${containerName} started but port ${target.port} is still unavailable.`)
  }

  return {
    ready,
    started: true,
    reason: ready ? null : 'redis_boot_timeout',
    redisUrl,
    containerName,
    port: target.port,
  }
}

function normalizeCommandLine(commandLine) {
  return String(commandLine || '').replace(/\\/g, '/').toLowerCase()
}

function normalizeProcess(processInfo = {}) {
  return {
    pid: toPid(processInfo.pid ?? processInfo.ProcessId),
    parentPid: toPid(processInfo.parentPid ?? processInfo.ParentProcessId) ?? 0,
    name: String(processInfo.name ?? processInfo.Name ?? ''),
    commandLine: String(processInfo.commandLine ?? processInfo.CommandLine ?? ''),
  }
}

function createChildMap(processes) {
  const childMap = new Map()

  for (const processInfo of processes) {
    const parentPid = processInfo.parentPid
    if (!childMap.has(parentPid)) {
      childMap.set(parentPid, [])
    }
    childMap.get(parentPid).push(processInfo.pid)
  }

  return childMap
}

function belongsToProtectedTree(processMap, protectedPids, startPid) {
  let cursor = toPid(startPid)
  const visited = new Set()

  while (cursor && !visited.has(cursor)) {
    if (protectedPids.has(cursor)) {
      return true
    }

    visited.add(cursor)
    const current = processMap.get(cursor)
    if (!current || !current.parentPid || current.parentPid === cursor) {
      break
    }

    cursor = current.parentPid
  }

  return false
}

function matchesAny(commandLine, patterns = []) {
  return patterns.some((pattern) => commandLine.includes(pattern))
}

function isV1DevProcess(processInfo) {
  const commandLine = normalizeCommandLine(processInfo.commandLine)

  if (commandLine.includes('dev:v4') || commandLine.includes('scripts/dev-v4.mjs')) {
    return false
  }

  if (matchesAny(commandLine, [
    `${V1_PATH_TOKEN}/server.js`,
    `${V1_PATH_TOKEN}/scripts/dev_stack.js`,
    `${V1_PATH_TOKEN}/python_service/`,
    `${V1_PATH_TOKEN}/workers/spatialworker.js`,
  ])) {
    return true
  }

  return matchesAny(commandLine, [
    `cd ${V1_PATH_TOKEN}`,
    'npm run dev:backend',
    'npm run dev:stack',
    'v1-fastify-backend && npm run dev',
    'v1-fastify-backend && npm run dev:stack',
  ])
}

function isV3DevProcess(processInfo) {
  const commandLine = normalizeCommandLine(processInfo.commandLine)

  if (commandLine.includes('dev:v4') || commandLine.includes('scripts/dev-v4.mjs')) {
    return false
  }

  if (matchesAny(commandLine, [
    `${V3_PATH_TOKEN}/server.js`,
    `${V3_PATH_TOKEN}/python/services/spatialencoderservice.py`,
    `${V3_PATH_TOKEN}/python/`,
    'vite --mode v3',
    'npm run dev:frontend:v3',
    DEV_V3_TOKEN,
  ])) {
    return true
  }

  return (
    commandLine.includes(V3_PATH_TOKEN)
    || (commandLine.includes(CONCURRENTLY_TOKEN) && commandLine.includes(FRONT_V3_TOKEN))
  )
}

function isV4DevProcess(processInfo) {
  const commandLine = normalizeCommandLine(processInfo.commandLine)

  return matchesAny(commandLine, [
    'scripts/dev-v4.mjs',
    'scripts/v4-dependency-adapter.mjs',
    'npm run dev:v4',
    'npm run dev:frontend:v4',
    'vite --mode v4',
    `${V4_PATH_TOKEN}/src/server.ts`,
    `${V4_PATH_TOKEN}/node_modules/.bin`,
  ])
}

function isCompetingDevProcess(processInfo) {
  return isV1DevProcess(processInfo) || isV3DevProcess(processInfo)
}

export function collectAncestorPids(processes, startPid) {
  const pid = toPid(startPid)
  if (!pid) return []

  const processMap = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]))
  const ancestors = []
  const visited = new Set()

  let cursor = pid
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor)
    ancestors.push(cursor)

    const current = processMap.get(cursor)
    if (!current || !current.parentPid || current.parentPid === cursor) {
      break
    }

    cursor = current.parentPid
  }

  return ancestors
}

export function parseWindowsNetstatPids(output = '') {
  const pids = new Set()

  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.trim().match(/(\d+)$/)
    if (!match) continue
    const pid = Number(match[1])
    if (Number.isFinite(pid) && pid > 0) {
      pids.add(pid)
    }
  }

  return [...pids]
}

export function readEnvFile(filepath) {
  if (!filepath || !existsSync(filepath)) {
    return {}
  }

  return parseEnv(readFileSync(filepath, 'utf8'))
}

export function buildCompetingDevPorts({
  frontendPort = DEFAULT_V4_FRONTEND_PORT,
  backendPort = DEFAULT_V4_BACKEND_PORT,
  dependencyPort = DEFAULT_V4_DEPENDENCY_PORT,
  v1BackendPort = DEFAULT_V1_BACKEND_PORT,
  v3BackendPort = DEFAULT_V3_BACKEND_PORT,
  v1GrpcPort = DEFAULT_V1_SPATIAL_GRPC_PORT,
  v3EncoderPort = DEFAULT_V3_SPATIAL_ENCODER_PORT,
} = {}) {
  return [...new Set(
    [frontendPort, backendPort, dependencyPort, v1BackendPort, v3BackendPort, v1GrpcPort, v3EncoderPort]
      .map((value) => toPort(value, 0))
      .filter((value) => value > 0)
  )]
}

export function resolveV4DevConfig({
  env = {},
  frontendEnv = {},
  backendEnv = {},
  backendExampleEnv = {},
} = {}) {
  const backendPort = toPort(
    env.V4_BACKEND_PORT || env.PORT || backendEnv.PORT || backendExampleEnv.PORT,
    DEFAULT_V4_BACKEND_PORT,
  )

  const frontendPort = toPort(
    env.VITE_FRONTEND_PORT || frontendEnv.VITE_FRONTEND_PORT,
    DEFAULT_V4_FRONTEND_PORT,
  )

  const dependencyPort = toPort(
    env.V4_DEPENDENCY_PORT
      || getPortFromUrl(backendEnv.SPATIAL_VECTOR_BASE_URL, 0)
      || getPortFromUrl(backendExampleEnv.SPATIAL_VECTOR_BASE_URL, 0),
    DEFAULT_V4_DEPENDENCY_PORT,
  )

  const spatialEncoderPort = toPort(
    env.SPATIAL_ENCODER_PORT
      || getPortFromUrl(backendEnv.SPATIAL_ENCODER_BASE_URL, 0)
      || getPortFromUrl(backendExampleEnv.SPATIAL_ENCODER_BASE_URL, 0),
    DEFAULT_V3_SPATIAL_ENCODER_PORT,
  )

  const redisUrl = String(
    env.REDIS_URL
      || backendEnv.REDIS_URL
      || backendExampleEnv.REDIS_URL
      || 'redis://127.0.0.1:6380/0',
  ).trim()

  const backendBase = env.VITE_DEV_API_BASE
    || frontendEnv.VITE_DEV_API_BASE
    || `http://127.0.0.1:${backendPort}`

  return {
    frontendPort,
    backendPort,
    dependencyPort,
    spatialEncoderPort,
    frontendEnv: {
      VITE_BACKEND_VERSION: env.VITE_BACKEND_VERSION || frontendEnv.VITE_BACKEND_VERSION || 'v4',
      VITE_DEV_API_BASE: backendBase,
      VITE_AI_DEV_API_BASE: env.VITE_AI_DEV_API_BASE || frontendEnv.VITE_AI_DEV_API_BASE || backendBase,
      VITE_SPATIAL_DEV_API_BASE: env.VITE_SPATIAL_DEV_API_BASE || frontendEnv.VITE_SPATIAL_DEV_API_BASE || backendBase,
    },
    backendEnv: {
      SPATIAL_ENCODER_BASE_URL: `http://127.0.0.1:${spatialEncoderPort}`,
      SPATIAL_VECTOR_BASE_URL: `http://127.0.0.1:${dependencyPort}`,
      ROUTING_BASE_URL: `http://127.0.0.1:${dependencyPort}`,
      REDIS_URL: redisUrl,
    },
    dependencyEnv: {
      V4_DEPENDENCY_PORT: String(dependencyPort),
      SPATIAL_ENCODER_PORT: String(spatialEncoderPort),
    },
  }
}

export function selectStaleCompetingDevProcessPids({
  processes = [],
  portOwners = [],
  currentPid,
  currentParentPid,
} = {}) {
  const normalizedProcesses = toArray(processes)
    .map((processInfo) => normalizeProcess(processInfo))
    .filter((processInfo) => processInfo.pid)

  const processMap = new Map(normalizedProcesses.map((processInfo) => [processInfo.pid, processInfo]))
  const protectedPids = new Set([
    ...collectAncestorPids(normalizedProcesses, currentPid),
    ...collectAncestorPids(normalizedProcesses, currentParentPid),
  ])
  const childMap = createChildMap(normalizedProcesses)
  const portOwnerSet = new Set(toArray(portOwners).map((pid) => toPid(pid)).filter(Boolean))
  const seedPids = new Set()

  for (const processInfo of normalizedProcesses) {
    if (belongsToProtectedTree(processMap, protectedPids, processInfo.pid)) {
      continue
    }

    if (isCompetingDevProcess(processInfo) || isV4DevProcess(processInfo) || portOwnerSet.has(processInfo.pid)) {
      seedPids.add(processInfo.pid)
    }
  }

  for (const seedPid of [...seedPids]) {
    let cursor = processMap.get(seedPid)?.parentPid ?? 0
    while (cursor && !protectedPids.has(cursor)) {
      const current = processMap.get(cursor)
      if (!current || (!isCompetingDevProcess(current) && !isV4DevProcess(current))) {
        break
      }
      seedPids.add(cursor)
      cursor = current.parentPid
    }
  }

  const stalePids = new Set()
  const queue = [...seedPids]

  while (queue.length > 0) {
    const pid = queue.shift()
    if (!pid || protectedPids.has(pid) || stalePids.has(pid)) {
      continue
    }

    stalePids.add(pid)

    for (const childPid of childMap.get(pid) || []) {
      if (!protectedPids.has(childPid)) {
        queue.push(childPid)
      }
    }
  }

  return [...stalePids].sort((left, right) => left - right)
}

export function createV4ProcessSpecs({
  rootDir,
  platform = process.platform,
  nodeCommand = process.execPath,
  npmExecPath = process.env.npm_execpath || '',
  frontendEnv = {},
  dependencyEnv = {},
  backendEnv = {},
} = {}) {
  const isWindows = platform === 'win32'
  const npmRunner = isWindows && npmExecPath
    ? {
      command: nodeCommand,
      args: (scriptName) => [npmExecPath, 'run', scriptName],
    }
    : {
      command: isWindows ? 'npm.cmd' : 'npm',
      args: (scriptName) => ['run', scriptName],
    }

  return [
    {
      label: 'front',
      command: npmRunner.command,
      args: npmRunner.args('dev:frontend:v4'),
      cwd: rootDir,
      env: frontendEnv,
    },
    {
      label: 'deps',
      command: nodeCommand,
      args: ['scripts/v4-dependency-adapter.mjs'],
      cwd: rootDir,
      env: dependencyEnv,
    },
    {
      label: 'v4',
      command: npmRunner.command,
      args: npmRunner.args('dev'),
      cwd: join(rootDir, 'V4-GeoLoom-beta'),
      env: backendEnv,
    },
  ]
}

function runPowerShell(command) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      encoding: 'utf8',
    },
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    throw new Error(stderr || `PowerShell exited with code ${result.status}`)
  }

  return result.stdout || ''
}

function readWindowsProcessSnapshot(ports = []) {
  const trackedPorts = [...new Set(
    toArray(ports)
      .map((value) => toPort(value, 0))
      .filter((value) => value > 0)
  )]
  const portListLiteral = trackedPorts.join(',')
  const output = runPowerShell(`
$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
$portOwners = @()
foreach ($trackedPort in @(${portListLiteral})) {
  $portOwners += @(Get-NetTCPConnection -LocalPort $trackedPort -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}
[pscustomobject]@{
  processes = $processes
  portOwners = @($portOwners | Sort-Object -Unique)
} | ConvertTo-Json -Depth 4 -Compress
`)

  const snapshot = output.trim() ? JSON.parse(output) : {}

  return {
    processes: toArray(snapshot.processes),
    portOwners: toArray(snapshot.portOwners),
  }
}

function killWindowsProcesses(pids) {
  if (!pids.length) return
  for (const pid of pids) {
    const normalizedPid = toPid(pid)
    if (!normalizedPid) continue

    // taskkill 在 Windows 上比 Stop-Process 更稳，重复执行 dev:v4 时不会因为竞态直接中断整轮启动。
    spawnSync(
      'taskkill',
      ['/PID', String(normalizedPid), '/T', '/F'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
      },
    )
  }
}

export function runV4DevCleanup({
  platform = process.platform,
  frontendPort = DEFAULT_V4_FRONTEND_PORT,
  backendPort = DEFAULT_V4_BACKEND_PORT,
  dependencyPort = DEFAULT_V4_DEPENDENCY_PORT,
  v1BackendPort = DEFAULT_V1_BACKEND_PORT,
  v3BackendPort = DEFAULT_V3_BACKEND_PORT,
  v1GrpcPort = DEFAULT_V1_SPATIAL_GRPC_PORT,
  v3EncoderPort = DEFAULT_V3_SPATIAL_ENCODER_PORT,
  currentPid = process.pid,
  currentParentPid = process.ppid,
  logger = console,
  readSnapshot = readWindowsProcessSnapshot,
  killProcesses = killWindowsProcesses,
} = {}) {
  const trackedPorts = buildCompetingDevPorts({
    frontendPort,
    backendPort,
    dependencyPort,
    v1BackendPort,
    v3BackendPort,
    v1GrpcPort,
    v3EncoderPort,
  })

  if (platform !== 'win32') {
    logger.log('[dev:v4] Skipping competing-dev cleanup outside Windows.')
    return { skipped: true, killedPids: [], trackedPorts }
  }

  const snapshot = readSnapshot(trackedPorts)
  const stalePids = selectStaleCompetingDevProcessPids({
    ...snapshot,
    currentPid,
    currentParentPid,
  })

  if (!stalePids.length) {
    logger.log('[dev:v4] No competing V1/V3 dev processes detected before startup.')
    return { skipped: false, killedPids: [], trackedPorts }
  }

  killProcesses(stalePids)
  logger.log(`[dev:v4] Cleared competing dev processes: ${stalePids.join(', ')}`)

  return { skipped: false, killedPids: stalePids, trackedPorts }
}
