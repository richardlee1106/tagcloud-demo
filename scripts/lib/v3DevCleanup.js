import { spawnSync } from 'node:child_process'

export const DEFAULT_V3_BACKEND_PORT = 3300
export const DEFAULT_SPATIAL_ENCODER_PORT = 8100

const V3_PATH_TOKEN = 'v3-geoencoder-rag'
const DEV_V3_TOKEN = 'dev:v3'
const CONCURRENTLY_TOKEN = 'concurrently'
const FRONT_V3_TOKEN = 'front,v3'

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === '') return []
  return [value]
}

export function buildTrackedV3DevPorts({
  port = DEFAULT_V3_BACKEND_PORT,
  extraPorts = [DEFAULT_SPATIAL_ENCODER_PORT]
} = {}) {
  return [...new Set(
    [port, ...toArray(extraPorts)]
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  )]
}

function toPid(value) {
  const pid = Number.parseInt(String(value), 10)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function normalizeProcess(processInfo = {}) {
  return {
    pid: toPid(processInfo.pid ?? processInfo.ProcessId),
    parentPid: toPid(processInfo.parentPid ?? processInfo.ParentProcessId) ?? 0,
    name: String(processInfo.name ?? processInfo.Name ?? ''),
    commandLine: String(processInfo.commandLine ?? processInfo.CommandLine ?? '')
  }
}

function normalizeCommandLine(commandLine) {
  return String(commandLine || '').replace(/\\/g, '/').toLowerCase()
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

export function isV3DevRootProcess(processInfo) {
  const commandLine = normalizeCommandLine(processInfo.commandLine)
  return commandLine.includes('npm') && commandLine.includes(DEV_V3_TOKEN)
}

export function isV3ConcurrentlyProcess(processInfo) {
  const commandLine = normalizeCommandLine(processInfo.commandLine)
  return commandLine.includes(CONCURRENTLY_TOKEN) && commandLine.includes(FRONT_V3_TOKEN)
}

export function isV3ServerProcess(processInfo) {
  const commandLine = normalizeCommandLine(processInfo.commandLine)
  return commandLine.includes(V3_PATH_TOKEN) && commandLine.includes('server.js')
}

export function selectStaleV3ProcessPids({
  processes = [],
  portOwners = [],
  currentPid,
  currentParentPid
} = {}) {
  const normalizedProcesses = toArray(processes)
    .map((processInfo) => normalizeProcess(processInfo))
    .filter((processInfo) => processInfo.pid)

  const protectedPids = new Set([
    ...collectAncestorPids(normalizedProcesses, currentPid),
    ...collectAncestorPids(normalizedProcesses, currentParentPid)
  ])

  const childMap = createChildMap(normalizedProcesses)
  const portOwnerSet = new Set(toArray(portOwners).map((pid) => toPid(pid)).filter(Boolean))
  const seedPids = new Set()

  for (const processInfo of normalizedProcesses) {
    if (protectedPids.has(processInfo.pid)) {
      continue
    }

    if (
      isV3DevRootProcess(processInfo) ||
      isV3ConcurrentlyProcess(processInfo) ||
      isV3ServerProcess(processInfo) ||
      portOwnerSet.has(processInfo.pid)
    ) {
      seedPids.add(processInfo.pid)
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

  return Array.from(stalePids).sort((left, right) => left - right)
}

function runPowerShell(command) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      encoding: 'utf8'
    }
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
  const trackedPorts = buildTrackedV3DevPorts({
    port: toArray(ports)[0] ?? DEFAULT_V3_BACKEND_PORT,
    extraPorts: toArray(ports).slice(1)
  })
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
    portOwners: toArray(snapshot.portOwners)
  }
}

function killWindowsProcesses(pids) {
  if (!pids.length) return

  runPowerShell(`Stop-Process -Id @(${pids.join(',')}) -Force -ErrorAction SilentlyContinue`)
}

export function runV3DevCleanup({
  port = DEFAULT_V3_BACKEND_PORT,
  extraPorts = [DEFAULT_SPATIAL_ENCODER_PORT],
  currentPid = process.pid,
  currentParentPid = process.ppid,
  logger = console
} = {}) {
  if (process.platform !== 'win32') {
    logger.log('[dev:V3] Skipping stale-process cleanup outside Windows.')
    return { skipped: true, killedPids: [] }
  }

  const trackedPorts = buildTrackedV3DevPorts({ port, extraPorts })
  const snapshot = readWindowsProcessSnapshot(trackedPorts)
  const stalePids = selectStaleV3ProcessPids({
    ...snapshot,
    currentPid,
    currentParentPid
  })

  if (!stalePids.length) {
    logger.log('[dev:V3] No stale V3 processes detected before startup.')
    return { skipped: false, killedPids: [] }
  }

  killWindowsProcesses(stalePids)
  logger.log(`[dev:V3] Cleared stale V3 processes: ${stalePids.join(', ')}`)

  return { skipped: false, killedPids: stalePids }
}
