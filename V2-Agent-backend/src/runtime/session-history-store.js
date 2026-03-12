import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_TURNS = 6

function buildSessionsDir(baseDir) {
  return path.join(baseDir, '.state', 'sessions')
}

function buildSessionPath(baseDir, sessionId) {
  const safeName = encodeURIComponent(String(sessionId || 'default-session'))
  return path.join(buildSessionsDir(baseDir), `${safeName}.json`)
}

function normalizeTurn(turn = {}) {
  const role = turn?.role === 'assistant' ? 'assistant' : 'user'
  const content = String(turn?.content || '').trim()
  if (!content) {
    return null
  }

  return {
    role,
    content,
    trace_id: turn?.trace_id ?? null,
    job_id: turn?.job_id ?? null,
    at: turn?.at ?? new Date().toISOString()
  }
}

async function readSessionTurns(baseDir, sessionId) {
  try {
    const raw = await readFile(buildSessionPath(baseDir, sessionId), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeSessionTurns(baseDir, sessionId, turns) {
  await mkdir(buildSessionsDir(baseDir), { recursive: true })
  await writeFile(
    buildSessionPath(baseDir, sessionId),
    JSON.stringify(turns, null, 2),
    'utf8'
  )
}

export function createSessionHistoryStore({
  baseDir,
  maxTurns = Number(process.env.V2_SESSION_HISTORY_MAX_TURNS || DEFAULT_MAX_TURNS)
} = {}) {
  const cache = new Map()
  const resolvedMaxTurns = Number.isFinite(maxTurns) && maxTurns > 0 ? Math.floor(maxTurns) : DEFAULT_MAX_TURNS

  async function loadTurns(sessionId) {
    if (!sessionId) {
      return []
    }

    if (!cache.has(sessionId)) {
      cache.set(sessionId, await readSessionTurns(baseDir, sessionId))
    }

    return cache.get(sessionId) ?? []
  }

  return {
    async getRecentHistory(sessionId) {
      const turns = await loadTurns(sessionId)
      return turns.slice(-resolvedMaxTurns)
    },
    async appendTurn(sessionId, turn) {
      if (!sessionId) {
        return []
      }

      const normalized = normalizeTurn(turn)
      if (!normalized) {
        return this.getRecentHistory(sessionId)
      }

      const turns = await loadTurns(sessionId)
      const nextTurns = [...turns, normalized].slice(-resolvedMaxTurns)
      cache.set(sessionId, nextTurns)
      await writeSessionTurns(baseDir, sessionId, nextTurns)
      return nextTurns
    },
    async close() {
      cache.clear()
    }
  }
}
