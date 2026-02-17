/**
 * 空间计算迁移策略（Node 编排 -> Python 计算）
 *
 * 设计目标：
 * 1) 统一读取环境变量，避免分散判断导致行为不一致。
 * 2) 提供稳定灰度能力（按 request_id 做稳定采样），便于回归与复现。
 * 3) 输出结构化决策结果，供 JobRunner/Executor/日志统一消费。
 */

const ALLOWED_DATA_SOURCES = new Set(['hybrid', 'python', 'node'])

const ADVANCED_QUERY_TYPES = new Set([
  'area_analysis',
  'fuzzy_regions',
  'graph_reasoning',
  'region_comparison',
  'vernacular_region'
])

/**
 * 解析布尔环境变量，支持 true/1/yes/on 与 false/0/no/off。
 */
function parseBoolean(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback
  }

  const normalized = String(rawValue).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

/**
 * 解析百分比，限制在 0~100 之间。
 */
function parsePercent(rawValue, fallback) {
  const number = Number(rawValue)
  if (!Number.isFinite(number)) return fallback
  if (number <= 0) return 0
  if (number >= 100) return 100
  return Math.floor(number)
}

/**
 * 解析 query_type 白名单；为空表示“全部允许”。
 */
function parseQueryTypeSet(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return new Set()
  }

  const items = String(rawValue)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  return new Set(items)
}

/**
 * 简单稳定哈希，返回 0~99，用于灰度抽样。
 */
function stableBucket(seed) {
  const text = String(seed || 'seed')
  let hash = 0

  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }

  return hash % 100
}

/**
 * 判断某请求是否命中灰度百分比。
 */
function sampleHit(seed, percent) {
  if (percent >= 100) return true
  if (percent <= 0) return false
  return stableBucket(seed) < percent
}

/**
 * 归一化 query_type，避免大小写/空值干扰。
 */
function normalizeQueryType(queryType) {
  if (!queryType) return 'poi_search'
  return String(queryType).trim().toLowerCase() || 'poi_search'
}

/**
 * 归一化执行画像：core | advanced | shadow。
 */
function resolveExecutionProfile(queryType, options = {}, preferShadow = false) {
  if (typeof options.executionProfile === 'string' && options.executionProfile.trim()) {
    const explicit = options.executionProfile.trim().toLowerCase()
    if (['core', 'advanced', 'shadow'].includes(explicit)) {
      return explicit
    }
  }

  if (preferShadow) return 'shadow'
  return ADVANCED_QUERY_TYPES.has(queryType) ? 'advanced' : 'core'
}

/**
 * 读取迁移配置（可在运行时通过 env 热更新）。
 */
export function getSpatialMigrationConfig(env = process.env) {
  const pyDataSourceRaw = String(env.SPATIAL_PY_DATA_SOURCE || 'python').trim().toLowerCase()
  const pyDataSource = ALLOWED_DATA_SOURCES.has(pyDataSourceRaw) ? pyDataSourceRaw : 'hybrid'

  return {
    migrateEnabled: parseBoolean(env.SPATIAL_MIGRATE_ENABLED, true),
    migrateQueryTypes: parseQueryTypeSet(env.SPATIAL_MIGRATE_QUERY_TYPES),
    migratePercent: parsePercent(env.SPATIAL_MIGRATE_PERCENT, 100),
    dualRunEnabled: parseBoolean(env.SPATIAL_DUAL_RUN, false),
    dualRunSample: parsePercent(env.SPATIAL_DUAL_RUN_SAMPLE, 10),
    pyDataSource,
    forceNodeFallback: parseBoolean(env.SPATIAL_FORCE_NODE_FALLBACK, false)
  }
}

/**
 * 产出一次完整迁移决策，用于路由层执行与诊断。
 */
export function resolveSpatialMigrationDecision({
  requestId,
  queryPlan = {},
  options = {},
  env = process.env
} = {}) {
  const config = getSpatialMigrationConfig(env)
  const queryType = normalizeQueryType(queryPlan?.query_type || options?.queryType)
  const seed = requestId || options?.requestId || `${queryType}:default`

  const queryTypeMatched =
    config.migrateQueryTypes.size === 0 || config.migrateQueryTypes.has(queryType)
  const hitMigratePercent = sampleHit(seed, config.migratePercent)

  // 强制使用Python服务，不再支持Node.js回退。
  // 所有空间计算逻辑必须由Python处理。
  // 注意：forceNodeFallback配置已被废弃，强制使用Python作为唯一计算引擎。

  const pyDataSource = String(options.pyDataSource || config.pyDataSource).trim().toLowerCase()
  const normalizedDataSource = ALLOWED_DATA_SOURCES.has(pyDataSource) ? pyDataSource : 'hybrid'

  const allowPythonBySource = normalizedDataSource !== 'node'

  // 始终使用Python作为主计算引擎
  const usePythonPrimary =
    config.migrateEnabled &&
    queryTypeMatched &&
    hitMigratePercent &&
    allowPythonBySource

  const dualRunRequested = config.dualRunEnabled
  const dualRunHitSample = dualRunRequested && sampleHit(`${seed}:dual`, config.dualRunSample)

  // 双跑已禁用，始终使用Python主路径
  const shadowEnabled = false
  const executionProfile = resolveExecutionProfile(queryType, options, shadowEnabled)

  const reasons = []
  if (!config.migrateEnabled) reasons.push('migrate_disabled')
  if (!queryTypeMatched) reasons.push('query_type_not_matched')
  if (!hitMigratePercent) reasons.push('out_of_migrate_percent')
  if (!allowPythonBySource) reasons.push('py_data_source_node_only')

  return {
    request_id: seed,
    query_type: queryType,
    use_python_primary: usePythonPrimary,
    use_node_primary: !usePythonPrimary,
    shadow_enabled: shadowEnabled,
    dry_run: shadowEnabled,
    execution_profile: executionProfile,
    py_data_source: normalizedDataSource,
    config_snapshot: {
      migrate_enabled: config.migrateEnabled,
      migrate_percent: config.migratePercent,
      migrate_query_types: [...config.migrateQueryTypes],
      dual_run_enabled: config.dualRunEnabled,
      dual_run_sample: config.dualRunSample,
      force_node_fallback: config.forceNodeFallback
    },
    checks: {
      query_type_matched: queryTypeMatched,
      hit_migrate_percent: hitMigratePercent,
      allow_python_by_source: allowPythonBySource,
      force_node_fallback: forceNodeFallback
    },
    reasons
  }
}

export default {
  getSpatialMigrationConfig,
  resolveSpatialMigrationDecision
}
