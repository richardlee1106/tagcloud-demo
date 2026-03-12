function coercePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeEnvString(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function parseRedisUrl(url) {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db: parsed.pathname && parsed.pathname !== '/'
        ? Number.parseInt(parsed.pathname.slice(1), 10) || 0
        : 0,
      tls: parsed.protocol === 'rediss:' ? {} : undefined
    }
  } catch {
    return null
  }
}

export function resolveRedisConfig({
  urlEnvNames = [],
  hostEnvNames = []
} = {}) {
  for (const envName of urlEnvNames) {
    const url = normalizeEnvString(process.env[envName])
    if (url) {
      return {
        url
      }
    }
  }

  for (const envName of hostEnvNames) {
    const host = normalizeEnvString(process.env[envName])
    if (host) {
      return {
        host,
        port: coercePositiveInteger(process.env.REDIS_PORT, 6379),
        username: normalizeEnvString(process.env.REDIS_USERNAME) || undefined,
        password: normalizeEnvString(process.env.REDIS_PASSWORD) || undefined,
        db: coercePositiveInteger(process.env.REDIS_DB, 0)
      }
    }
  }

  return null
}

export function buildBullMqConnection(config = null) {
  if (!config) {
    return null
  }

  if (config.url) {
    return parseRedisUrl(config.url)
  }

  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    db: config.db
  }
}

export async function createRedisClient(config = null) {
  if (!config) {
    return null
  }

  const module = await import('ioredis')
  const Redis = module.default
  const client = config.url
    ? new Redis(config.url, {
      lazyConnect: true,
      enableAutoPipelining: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000
    })
    : new Redis({
      ...config,
      lazyConnect: true,
      enableAutoPipelining: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000
    })

  if (typeof client.connect === 'function' && client.status === 'wait') {
    await client.connect()
  }

  return client
}

export {
  coercePositiveInteger,
  normalizeEnvString
}
