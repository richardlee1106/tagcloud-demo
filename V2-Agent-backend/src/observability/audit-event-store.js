import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

function buildAuditPath(baseDir) {
  return path.join(baseDir, 'observability', 'logs', 'audit', 'audit-events.jsonl')
}

function buildArchiveDir(baseDir) {
  return path.join(baseDir, 'observability', 'logs', 'audit', 'archive')
}

function normalizeLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : fallback
}

function normalizePositive(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function safeParseLine(line = '') {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function matchesFilters(entry, filters = {}) {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  const pairs = [
    ['trace_id', filters.trace_id],
    ['job_id', filters.job_id],
    ['session_id', filters.session_id],
    ['tenant_id', filters.tenant_id],
    ['user_id', filters.user_id],
    ['event', filters.event],
    ['kind', filters.kind]
  ]

  return pairs.every(([key, expected]) => {
    if (!expected) return true
    return String(entry[key] || '') === String(expected)
  })
    && (!filters.since_ts || String(entry.ts || '') >= String(filters.since_ts))
    && (!filters.until_ts || String(entry.ts || '') <= String(filters.until_ts))
}

export function createAuditEventStore({
  baseDir,
  retentionDays = normalizePositive(process.env.V2_AUDIT_RETENTION_DAYS, 14),
  maxEvents = normalizePositive(process.env.V2_AUDIT_MAX_EVENTS, 50_000)
} = {}) {
  const auditPath = buildAuditPath(baseDir)
  const archiveDir = buildArchiveDir(baseDir)

  return {
    auditPath,
    async append(entry = {}) {
      const payload = {
        schema_version: 'audit.v1',
        ts: new Date().toISOString(),
        ...entry
      }

      await mkdir(path.dirname(auditPath), { recursive: true })
      await appendFile(auditPath, `${JSON.stringify(payload)}\n`, 'utf8')
      return payload
    },
    async query(filters = {}) {
      const limit = normalizeLimit(filters.limit, 100)

      try {
        const content = await readFile(auditPath, 'utf8')
        const lines = content.trim().split('\n').filter(Boolean)
        const entries = lines
          .map((line) => safeParseLine(line))
          .filter((entry) => matchesFilters(entry, filters))
          .slice(-limit)
          .reverse()

        return {
          items: entries,
          total: entries.length,
          file_path: auditPath
        }
      } catch {
        return {
          items: [],
          total: 0,
          file_path: auditPath
        }
      }
    },
    async getHealthSnapshot() {
      const result = await this.query({ limit: maxEvents })
      return {
        path: auditPath,
        archive_dir: archiveDir,
        exists: result.total >= 0,
        retention_days: retentionDays,
        max_events: maxEvents,
        total_events: result.total
      }
    },
    async prune() {
      const now = Date.now()
      const cutoff = now - retentionDays * 24 * 60 * 60 * 1000

      let lines = []
      try {
        const content = await readFile(auditPath, 'utf8')
        lines = content.trim().split('\n').filter(Boolean)
      } catch {
        return {
          kept: 0,
          pruned: 0,
          archived_to: null
        }
      }

      const parsed = lines.map((line) => ({
        line,
        entry: safeParseLine(line)
      }))

      const kept = []
      const pruned = []
      for (const item of parsed) {
        const timestamp = item.entry?.ts ? new Date(item.entry.ts).getTime() : 0
        if (timestamp >= cutoff) {
          kept.push(item)
        } else {
          pruned.push(item)
        }
      }

      while (kept.length > maxEvents) {
        pruned.push(kept.shift())
      }

      let archivedTo = null
      if (pruned.length > 0) {
        await mkdir(archiveDir, { recursive: true })
        archivedTo = path.join(archiveDir, `audit-archive-${new Date().toISOString().replaceAll(':', '-')}.jsonl`)
        await writeFile(archivedTo, `${pruned.map((item) => item.line).join('\n')}\n`, 'utf8')
      }

      await mkdir(path.dirname(auditPath), { recursive: true })
      await writeFile(auditPath, kept.length > 0 ? `${kept.map((item) => item.line).join('\n')}\n` : '', 'utf8')

      return {
        kept: kept.length,
        pruned: pruned.length,
        archived_to: archivedTo
      }
    }
  }
}
