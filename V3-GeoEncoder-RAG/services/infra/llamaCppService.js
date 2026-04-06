import { execFileSync, execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { probeOpenAICompatibleService } from '../ai/runtimeStatusService.js'

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url)
const CURRENT_DIR = path.dirname(CURRENT_FILE_PATH)
const GUARDIAN_SCRIPT_PATH = path.join(CURRENT_DIR, 'llamaCppGuardian.js')
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0'])
const MANAGED_SERVERS = new Map()
const DEFAULT_READY_CHECK_INTERVAL_MS = 500
const DEFAULT_STARTUP_TIMEOUT_MS = 180000
const DEFAULT_LOG_DIR = path.resolve(process.cwd(), '.logs')

function normalizeBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

function normalizeString(value = '') {
  return String(value || '').trim()
}

function normalizeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isAbsolutePath(value = '') {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
}

function resolveLocalBaseUrl(baseUrl = '') {
  const normalized = normalizeString(baseUrl)
  if (!normalized) return null

  try {
    const parsed = new URL(normalized)
    if (!LOCAL_HOSTS.has(parsed.hostname)) return null
    const port = Number.parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10)
    if (!Number.isFinite(port)) return null

    return {
      baseUrl: normalized.replace(/\/+$/, ''),
      host: parsed.hostname,
      port
    }
  } catch {
    return null
  }
}

function buildServiceArgs(service) {
  return [
    '--host', service.host,
    '--port', String(service.port),
    '--model', service.modelPath,
    '--alias', service.model,
    '--ctx-size', String(service.ctxSize),
    '--gpu-layers', String(service.gpuLayers),
    '--reasoning', service.reasoning,
    '--parallel', String(service.parallel)
  ]
}

function buildGuardianPayload(service, args, logPaths) {
  return Buffer.from(JSON.stringify({
    parentPid: process.pid,
    executablePath: service.executablePath,
    serviceArgs: args,
    logPaths,
    displayName: service.displayName
  }), 'utf8').toString('base64')
}

function buildLaunchSpec(service, args, logPaths) {
  return {
    command: process.execPath,
    args: [
      GUARDIAN_SCRIPT_PATH,
      buildGuardianPayload(service, args, logPaths)
    ]
  }
}

function getServiceDescriptors() {
  return [
    {
      key: 'planner',
      displayName: 'planner',
      envPrefix: 'PLANNER',
      defaultCtxSize: 4096,
      defaultGpuLayers: 999,
      defaultReasoning: 'off',
      defaultParallel: 1
    },
    {
      key: 'answerSynthesis',
      displayName: 'answer synthesis',
      envPrefix: 'ANSWER_SYNTHESIS',
      defaultCtxSize: 4096,
      defaultGpuLayers: 0,
      defaultReasoning: 'off',
      defaultParallel: 1
    }
  ]
}

function isLlamaCppAutostartEnabled(env = process.env) {
  const useOllama = normalizeString(env?.USE_OLLAMA).toLowerCase() !== 'false'
  if (useOllama) return false
  return normalizeBoolean(env?.LLAMACPP_AUTOSTART, true)
}

function fileExistsOnPath(commandName = '') {
  const normalized = normalizeString(commandName)
  if (!normalized) return false

  try {
    const result = execSync(`where.exe ${normalized}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return Boolean(normalizeString(result))
  } catch {
    return false
  }
}

function defaultFileExists(targetPath = '') {
  const normalized = normalizeString(targetPath)
  if (!normalized) return false
  if (isAbsolutePath(normalized)) {
    return fs.existsSync(normalized)
  }
  return fileExistsOnPath(normalized)
}

function defaultEnsureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
}

function defaultResetLogFile(targetPath) {
  fs.writeFileSync(targetPath, '')
}

function defaultCreateLogStream(targetPath) {
  return fs.createWriteStream(targetPath, { flags: 'a' })
}

function defaultSpawnProcess(executablePath, args, service) {
  return spawn(executablePath, args, {
    cwd: isAbsolutePath(executablePath) ? path.dirname(executablePath) : process.cwd(),
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NO_COLOR: '1'
    }
  })
}

async function defaultWaitForReady(service, deps) {
  const {
    probeService,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = deps

  const deadline = Date.now() + service.startupTimeoutMs
  while (Date.now() < deadline) {
    const result = await probeService({
      baseUrl: service.baseUrl,
      configuredModel: service.model,
      timeoutMs: 2000
    })
    if (result?.available) {
      return true
    }
    await delay(DEFAULT_READY_CHECK_INTERVAL_MS)
  }

  return false
}

async function defaultKillProcessTree(pid) {
  if (!pid) return

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.on('error', () => resolve())
      killer.on('exit', () => resolve())
    })
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // ignore stale pid
  }
}

function defaultKillProcessTreeSync(pid) {
  if (!pid) return

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } catch {
      // ignore stale pid
    }
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // ignore stale pid
  }
}

function buildServiceLogPaths(logDir, service) {
  return {
    stdout: path.join(logDir, `llamacpp-${service.key}.stdout.log`),
    stderr: path.join(logDir, `llamacpp-${service.key}.stderr.log`)
  }
}

export function buildManagedLlamaCppServices(env = process.env) {
  if (!isLlamaCppAutostartEnabled(env)) {
    return []
  }

  const startupTimeoutMs = normalizeInt(env?.LLAMACPP_STARTUP_TIMEOUT_MS, DEFAULT_STARTUP_TIMEOUT_MS)
  const defaultExecutablePath = normalizeString(env?.LLAMACPP_SERVER_PATH)

  return getServiceDescriptors()
    .map((descriptor) => {
      const baseUrl = resolveLocalBaseUrl(env?.[`${descriptor.envPrefix}_BASE_URL`])
      if (!baseUrl) return null

      const model = normalizeString(env?.[`${descriptor.envPrefix}_MODEL`])
      const modelPath = normalizeString(env?.[`${descriptor.envPrefix}_MODEL_PATH`])
      const executablePath = normalizeString(env?.[`${descriptor.envPrefix}_SERVER_PATH`] || defaultExecutablePath)

      return {
        key: descriptor.key,
        displayName: descriptor.displayName,
        envPrefix: descriptor.envPrefix,
        baseUrl: baseUrl.baseUrl,
        host: baseUrl.host,
        port: baseUrl.port,
        model,
        modelPath,
        executablePath,
        ctxSize: normalizeInt(env?.[`${descriptor.envPrefix}_CTX_SIZE`], descriptor.defaultCtxSize),
        gpuLayers: normalizeInt(env?.[`${descriptor.envPrefix}_GPU_LAYERS`], descriptor.defaultGpuLayers),
        reasoning: normalizeString(env?.[`${descriptor.envPrefix}_REASONING`] || descriptor.defaultReasoning),
        parallel: normalizeInt(env?.[`${descriptor.envPrefix}_PARALLEL`], descriptor.defaultParallel),
        startupTimeoutMs
      }
    })
    .filter(Boolean)
}

export async function startManagedLlamaCppServices({
  env = process.env,
  logDir = DEFAULT_LOG_DIR,
  deps = {}
} = {}) {
  const services = buildManagedLlamaCppServices(env)
  const result = {
    enabled: services.length > 0,
    managedServices: services,
    startedServices: [],
    reusedServices: [],
    failedServices: [],
    skippedServices: []
  }

  if (services.length === 0) {
    return result
  }

  const runtimeDeps = {
    fileExists: defaultFileExists,
    probeService: probeOpenAICompatibleService,
    spawnProcess: defaultSpawnProcess,
    ensureDir: defaultEnsureDir,
    resetLogFile: defaultResetLogFile,
    createLogStream: defaultCreateLogStream,
    waitForReady: defaultWaitForReady,
    killProcessTree: defaultKillProcessTree,
    logger: console,
    ...deps
  }

  runtimeDeps.ensureDir(logDir)

  for (const service of services) {
    const initialProbe = await runtimeDeps.probeService({
      baseUrl: service.baseUrl,
      configuredModel: service.model,
      timeoutMs: 2000
    })

    if (initialProbe?.available) {
      runtimeDeps.logger.log(`[LlamaCpp] Reusing existing ${service.displayName} service at ${service.baseUrl}`)
      result.reusedServices.push({
        key: service.key,
        baseUrl: service.baseUrl,
        model: service.model
      })
      continue
    }

    if (!service.executablePath || !runtimeDeps.fileExists(service.executablePath)) {
      runtimeDeps.logger.warn(`[LlamaCpp] Skip ${service.displayName}: server executable not found -> ${service.executablePath || '(empty)'}`)
      result.failedServices.push({
        key: service.key,
        reason: 'server_executable_missing',
        executablePath: service.executablePath
      })
      continue
    }

    if (!service.modelPath || !runtimeDeps.fileExists(service.modelPath)) {
      runtimeDeps.logger.warn(`[LlamaCpp] Skip ${service.displayName}: model file not found -> ${service.modelPath || '(empty)'}`)
      result.failedServices.push({
        key: service.key,
        reason: 'model_path_missing',
        modelPath: service.modelPath
      })
      continue
    }

    const logPaths = buildServiceLogPaths(logDir, service)
    runtimeDeps.resetLogFile(logPaths.stdout)
    runtimeDeps.resetLogFile(logPaths.stderr)

    const args = buildServiceArgs(service)
    const launchSpec = buildLaunchSpec(service, args, logPaths)

    runtimeDeps.logger.log(`[LlamaCpp] Starting ${service.displayName} service on ${service.baseUrl}`)

    let child = null

    try {
      child = runtimeDeps.spawnProcess(launchSpec.command, launchSpec.args, service)
      child.unref?.()

      const ready = await runtimeDeps.waitForReady(service, runtimeDeps)
      if (!ready) {
        await runtimeDeps.killProcessTree(child?.pid)
        runtimeDeps.logger.warn(`[LlamaCpp] ${service.displayName} did not become ready within ${service.startupTimeoutMs}ms`)
        result.failedServices.push({
          key: service.key,
          reason: 'startup_timeout',
          baseUrl: service.baseUrl
        })
        continue
      }

      MANAGED_SERVERS.set(service.key, {
        ...service,
        child,
        logPaths
      })

      result.startedServices.push({
        key: service.key,
        pid: child?.pid || null,
        baseUrl: service.baseUrl,
        model: service.model,
        logPaths
      })
      runtimeDeps.logger.log(`[LlamaCpp] ${service.displayName} service is ready at ${service.baseUrl}`)
    } catch (error) {
      await runtimeDeps.killProcessTree(child?.pid)
      runtimeDeps.logger.error(`[LlamaCpp] Failed to start ${service.displayName}: ${error.message}`)
      result.failedServices.push({
        key: service.key,
        reason: 'spawn_failed',
        error: error.message
      })
    }
  }

  return result
}

export async function stopManagedLlamaCppServices({
  deps = {}
} = {}) {
  const runtimeDeps = {
    killProcessTree: defaultKillProcessTree,
    logger: console,
    ...deps
  }

  const stopped = []
  for (const [key, server] of MANAGED_SERVERS.entries()) {
    await runtimeDeps.killProcessTree(server?.child?.pid)
    runtimeDeps.logger.log(`[LlamaCpp] Stopped managed ${key} service (pid=${server?.child?.pid || 'unknown'})`)
    stopped.push({
      key,
      pid: server?.child?.pid || null
    })
    MANAGED_SERVERS.delete(key)
  }

  return stopped
}

export function stopManagedLlamaCppServicesSync({
  deps = {}
} = {}) {
  const runtimeDeps = {
    killProcessTreeSync: defaultKillProcessTreeSync,
    logger: console,
    ...deps
  }

  const stopped = []
  for (const [key, server] of MANAGED_SERVERS.entries()) {
    runtimeDeps.killProcessTreeSync(server?.child?.pid)
    runtimeDeps.logger.log(`[LlamaCpp] Synchronously stopped managed ${key} service (pid=${server?.child?.pid || 'unknown'})`)
    stopped.push({
      key,
      pid: server?.child?.pid || null
    })
    MANAGED_SERVERS.delete(key)
  }

  return stopped
}

export default {
  buildManagedLlamaCppServices,
  startManagedLlamaCppServices,
  stopManagedLlamaCppServices,
  stopManagedLlamaCppServicesSync
}
