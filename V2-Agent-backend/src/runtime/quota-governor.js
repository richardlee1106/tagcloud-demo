import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { coercePositiveInteger, createRedisClient, resolveRedisConfig } from './redis-support.js'

const DEFAULT_TENANT_DAILY_LIMIT = 2_000
const DEFAULT_USER_DAILY_LIMIT = 200
const QUOTA_FILE_NAME = 'quota-ledger.json'
const QUOTA_KEY_PREFIX = 'v2:quota:'

function buildQuotaPath(baseDir) {
  return path.join(baseDir, '.state', 'quotas', QUOTA_FILE_NAME)
}

function resolveDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

function buildRedisKey(scope, id, dateKey) {
  return `${QUOTA_KEY_PREFIX}${scope}:${id}:${dateKey}`
}

function normalizeIdentity(value, fallback) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function buildFileBucketKey(dateKey, scope, id) {
  return `${dateKey}:${scope}:${id}`
}

function buildTtlMs(dateKey) {
  const nextDay = new Date(`${dateKey}T23:59:59.999Z`).getTime() - Date.now()
  return Math.max(60_000, nextDay)
}

async function readLedger(filePath) {
  try {
    const content = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeLedger(filePath, ledger) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(ledger, null, 2), 'utf8')
}

async function runRedisQuotaScript(redis, {
  tenantKey,
  userKey,
  tenantLimit,
  userLimit,
  increment,
  ttlMs
}) {
  const script = `
    local tenantCurrent = tonumber(redis.call('GET', KEYS[1]) or '0')
    local userCurrent = tonumber(redis.call('GET', KEYS[2]) or '0')
    local tenantLimit = tonumber(ARGV[1])
    local userLimit = tonumber(ARGV[2])
    local increment = tonumber(ARGV[3])
    local ttlMs = tonumber(ARGV[4])

    if tenantCurrent + increment > tenantLimit then
      return {0, tenantCurrent, userCurrent}
    end

    if userCurrent + increment > userLimit then
      return {0, tenantCurrent, userCurrent}
    end

    tenantCurrent = redis.call('INCRBY', KEYS[1], increment)
    userCurrent = redis.call('INCRBY', KEYS[2], increment)
    redis.call('PEXPIRE', KEYS[1], ttlMs)
    redis.call('PEXPIRE', KEYS[2], ttlMs)

    return {1, tenantCurrent, userCurrent}
  `

  const result = await redis.eval(script, 2, tenantKey, userKey, tenantLimit, userLimit, increment, ttlMs)
  return {
    allowed: Number(result?.[0] || 0) === 1,
    tenant_used: Number(result?.[1] || 0),
    user_used: Number(result?.[2] || 0)
  }
}

export function createQuotaGovernor({
  baseDir,
  redisClient = null,
  tenantDailyLimit = coercePositiveInteger(process.env.V2_TENANT_DAILY_QUOTA, DEFAULT_TENANT_DAILY_LIMIT),
  userDailyLimit = coercePositiveInteger(process.env.V2_USER_DAILY_QUOTA, DEFAULT_USER_DAILY_LIMIT)
} = {}) {
  const quotaPath = buildQuotaPath(baseDir)
  let ownedRedisClient = null
  let redisResolved = false

  async function getRedisClient() {
    if (redisClient) {
      return redisClient
    }
    if (ownedRedisClient) {
      return ownedRedisClient
    }
    if (redisResolved) {
      return null
    }

    redisResolved = true
    const config = resolveRedisConfig({
      urlEnvNames: ['V2_QUOTA_REDIS_URL', 'JOB_STATE_REDIS_URL', 'REDIS_URL'],
      hostEnvNames: ['V2_QUOTA_REDIS_HOST', 'REDIS_HOST']
    })
    if (!config) {
      return null
    }

    try {
      ownedRedisClient = await createRedisClient(config)
      return ownedRedisClient
    } catch {
      ownedRedisClient = null
      return null
    }
  }

  async function consumeFromFile({ dateKey, tenantId, userId, increment }) {
    const ledger = await readLedger(quotaPath)
    const tenantKey = buildFileBucketKey(dateKey, 'tenant', tenantId)
    const userKey = buildFileBucketKey(dateKey, 'user', userId)
    const tenantUsed = Number(ledger[tenantKey] || 0)
    const userUsed = Number(ledger[userKey] || 0)

    if (tenantUsed + increment > tenantDailyLimit || userUsed + increment > userDailyLimit) {
      return {
        allowed: false,
        tenant_used: tenantUsed,
        user_used: userUsed
      }
    }

    ledger[tenantKey] = tenantUsed + increment
    ledger[userKey] = userUsed + increment
    await writeLedger(quotaPath, ledger)

    return {
      allowed: true,
      tenant_used: ledger[tenantKey],
      user_used: ledger[userKey]
    }
  }

  return {
    async consume({
      tenantId,
      userId,
      sessionId = '',
      increment = 1,
      now = new Date()
    } = {}) {
      const dateKey = resolveDateKey(now)
      const resolvedTenantId = normalizeIdentity(tenantId, 'public')
      const resolvedUserId = normalizeIdentity(userId, normalizeIdentity(sessionId, 'interactive'))
      const redis = await getRedisClient()
      const ttlMs = buildTtlMs(dateKey)

      let usage
      let mode = 'file'
      if (redis) {
        try {
          usage = await runRedisQuotaScript(redis, {
            tenantKey: buildRedisKey('tenant', resolvedTenantId, dateKey),
            userKey: buildRedisKey('user', resolvedUserId, dateKey),
            tenantLimit: tenantDailyLimit,
            userLimit: userDailyLimit,
            increment,
            ttlMs
          })
          mode = 'redis'
        } catch {
          usage = await consumeFromFile({
            dateKey,
            tenantId: resolvedTenantId,
            userId: resolvedUserId,
            increment
          })
        }
      } else {
        usage = await consumeFromFile({
          dateKey,
          tenantId: resolvedTenantId,
          userId: resolvedUserId,
          increment
        })
      }

      return {
        allowed: usage.allowed,
        mode,
        date_key: dateKey,
        tenant_id: resolvedTenantId,
        user_id: resolvedUserId,
        tenant_limit: tenantDailyLimit,
        user_limit: userDailyLimit,
        tenant_used: usage.tenant_used,
        user_used: usage.user_used,
        tenant_remaining: Math.max(0, tenantDailyLimit - usage.tenant_used),
        user_remaining: Math.max(0, userDailyLimit - usage.user_used)
      }
    },
    async getSnapshot({
      tenantId,
      userId,
      sessionId = '',
      now = new Date()
    } = {}) {
      const dateKey = resolveDateKey(now)
      const resolvedTenantId = normalizeIdentity(tenantId, 'public')
      const resolvedUserId = normalizeIdentity(userId, normalizeIdentity(sessionId, 'interactive'))
      const redis = await getRedisClient()

      let tenantUsed = 0
      let userUsed = 0
      let mode = 'file'

      if (redis) {
        try {
          tenantUsed = Number(await redis.get(buildRedisKey('tenant', resolvedTenantId, dateKey)) || 0)
          userUsed = Number(await redis.get(buildRedisKey('user', resolvedUserId, dateKey)) || 0)
          mode = 'redis'
        } catch {
          tenantUsed = 0
          userUsed = 0
        }
      }

      if (mode !== 'redis') {
        const ledger = await readLedger(quotaPath)
        tenantUsed = Number(ledger[buildFileBucketKey(dateKey, 'tenant', resolvedTenantId)] || 0)
        userUsed = Number(ledger[buildFileBucketKey(dateKey, 'user', resolvedUserId)] || 0)
      }

      return {
        mode,
        date_key: dateKey,
        tenant_id: resolvedTenantId,
        user_id: resolvedUserId,
        tenant_limit: tenantDailyLimit,
        user_limit: userDailyLimit,
        tenant_used: tenantUsed,
        user_used: userUsed,
        tenant_remaining: Math.max(0, tenantDailyLimit - tenantUsed),
        user_remaining: Math.max(0, userDailyLimit - userUsed)
      }
    },
    async getHealthSnapshot() {
      const redis = await getRedisClient()
      let redisReachable = false
      if (redis && typeof redis.ping === 'function') {
        try {
          await redis.ping()
          redisReachable = true
        } catch {
          redisReachable = false
        }
      }

      return {
        storage_path: quotaPath,
        tenant_daily_limit: tenantDailyLimit,
        user_daily_limit: userDailyLimit,
        redis_reachable: redisReachable,
        mode: redisReachable ? 'redis' : 'file'
      }
    },
    async close() {
      if (ownedRedisClient) {
        await ownedRedisClient.quit()
        ownedRedisClient = null
      }
    }
  }
}
