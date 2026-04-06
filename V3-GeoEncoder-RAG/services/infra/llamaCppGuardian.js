import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

function decodePayload(raw = '') {
  return JSON.parse(Buffer.from(String(raw || ''), 'base64').toString('utf8'))
}

function processExists(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killTreeSync(pid) {
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

function openLogStream(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  return fs.createWriteStream(filePath, { flags: 'a' })
}

const payload = decodePayload(process.argv[2] || '')
const stdoutStream = openLogStream(payload.logPaths.stdout)
const stderrStream = openLogStream(payload.logPaths.stderr)
const child = spawn(payload.executablePath, payload.serviceArgs, {
  cwd: path.isAbsolute(payload.executablePath) ? path.dirname(payload.executablePath) : process.cwd(),
  detached: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NO_COLOR: '1'
  }
})

child.stdout?.pipe(stdoutStream)
child.stderr?.pipe(stderrStream)

let isCleaningUp = false
const interval = setInterval(() => {
  if (!processExists(payload.parentPid)) {
    cleanupAndExit(0)
  }
}, 1000)
interval.unref?.()

function cleanupAndExit(code = 0) {
  if (isCleaningUp) return
  isCleaningUp = true

  clearInterval(interval)
  killTreeSync(child?.pid)
  stdoutStream.end()
  stderrStream.end()
  process.exit(code)
}

child.on('exit', (code) => {
  if (isCleaningUp) return
  isCleaningUp = true
  clearInterval(interval)
  stdoutStream.end()
  stderrStream.end()
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  stderrStream.write(`[Guardian] Failed to start ${payload.displayName}: ${error.message}\n`)
  cleanupAndExit(1)
})

process.on('SIGTERM', () => cleanupAndExit(0))
process.on('SIGINT', () => cleanupAndExit(0))
process.on('SIGBREAK', () => cleanupAndExit(0))
