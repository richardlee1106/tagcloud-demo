/**
 * Phase 2 优化：查询结果缓存
 * 
 * 职责：
 * - 基于查询指纹缓存 Executor 结果
 * - 减少重复查询的计算开销
 * - 支持 TTL 自动过期
 * - 支持缓存命中统计
 */

import { createHash } from 'crypto'
import h3 from 'h3-js'

// 缓存存储（简单内存实现，生产环境建议使用 Redis）
const cache = new Map()

// 缓存统计
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0
}

// 缓存配置
const CACHE_CONFIG = {
  // 不同类型查询的 TTL（毫秒）
  ttl: {
    poi_search: 3 * 60 * 1000,      // POI 搜索：3 分钟
    area_analysis: 10 * 60 * 1000,  // 区域分析：10 分钟
    region_comparison: 10 * 60 * 1000, // 选区对比：10 分钟
    default: 5 * 60 * 1000          // 默认：5 分钟
  },
  
  // 最大缓存条目数
  maxEntries: 500,

  // 内存硬上限（字节），超过时强制淘汰最旧条目
  // 默认 128MB，可通过环境变量 QUERY_CACHE_MAX_MEMORY_MB 调整
  maxMemoryBytes: (parseInt(process.env.QUERY_CACHE_MAX_MEMORY_MB || '128', 10)) * 1024 * 1024,
  
  // 空间指纹的 H3 分辨率（用于归一化空间坐标）
  h3Resolution: 7, // ~1.2km 边长的六边形
  
  // 半径归一化步长（米）
  radiusBucket: 500
}

/**
 * 生成查询指纹
 * 
 * 将查询计划和空间上下文转换为可缓存的唯一标识
 * 
 * @param {Object} queryPlan - 查询计划
 * @param {Object} spatialContext - 空间上下文
 * @returns {string} 查询指纹 (MD5 hash)
 */
export function generateQueryFingerprint(queryPlan, spatialContext = {}, extra = {}) {
  const fingerprintData = {}
  
  // 1. 查询类型
  fingerprintData.type = queryPlan.query_type || 'unknown'
  
  // 2. 类别列表（排序后）
  fingerprintData.categories = (queryPlan.categories || []).sort()
  
  // 3. 空间指纹
  // 将精确坐标归一化为 H3 网格，避免微小坐标差异导致缓存失效
  if (spatialContext.center || (queryPlan.anchor?.lat && queryPlan.anchor?.lon)) {
    const lat = spatialContext.center?.lat || queryPlan.anchor.lat
    const lon = spatialContext.center?.lon || queryPlan.anchor.lon
    
    if (typeof lat === 'number' && typeof lon === 'number' &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      try {
        fingerprintData.h3_center = h3.latLngToCell(lat, lon, CACHE_CONFIG.h3Resolution)
      } catch (e) {
        console.warn('[QueryCache] H3 编码失败:', e.message)
        // 使用粗粒度坐标作为后备
        fingerprintData.approx_center = `${lat.toFixed(3)},${lon.toFixed(3)}`
      }
    }
  } else if (spatialContext.viewport) {
    // 使用视野中心点
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport
    const centerLat = (minLat + maxLat) / 2
    const centerLon = (minLon + maxLon) / 2
    
    try {
      fingerprintData.h3_center = h3.latLngToCell(centerLat, centerLon, CACHE_CONFIG.h3Resolution)
    } catch (e) {
      fingerprintData.approx_center = `${centerLat.toFixed(3)},${centerLon.toFixed(3)}`
    }
  }
  
  // 4. 半径归一化
  if (queryPlan.radius_m) {
    // 归一化到 500m 步长
    fingerprintData.radius_bucket = Math.ceil(queryPlan.radius_m / CACHE_CONFIG.radiusBucket) * CACHE_CONFIG.radiusBucket
  }
  
  // 5. 语义查询（如果有）
  // 注意：语义查询的细微差异可能影响结果，所以直接包含
  if (queryPlan.semantic_query) {
    fingerprintData.semantic = queryPlan.semantic_query.trim().toLowerCase()
  }
  
  // 6. 聚合策略
  if (queryPlan.aggregation_strategy?.enable) {
    fingerprintData.aggregation = true
    fingerprintData.sampling = queryPlan.sampling_strategy?.method || 'default'
  }
  
  // 7. 选区对比模式
  if (queryPlan.target_regions) {
    fingerprintData.regions = queryPlan.target_regions.sort()
  }

  // 8. Source policy（避免 UI 约束变化时复用错误缓存）
  const sourcePolicy = extra?.sourcePolicy || {}
  if (sourcePolicy && typeof sourcePolicy === 'object') {
    const selectedCategories = Array.isArray(sourcePolicy.selected_categories)
      ? [...sourcePolicy.selected_categories].sort()
      : []

    fingerprintData.source_policy = {
      category_source: sourcePolicy.category_source || null,
      geometry_source: sourcePolicy.geometry_source || null,
      has_custom_area: Boolean(sourcePolicy.has_custom_area),
      has_category_filter: Boolean(sourcePolicy.has_category_filter),
      selected_categories: selectedCategories
    }
  }

  if (extra?.queryType) {
    fingerprintData.query_type = String(extra.queryType)
  }

  if (extra?.route) {
    fingerprintData.route = String(extra.route)
  }
  
  // 生成 MD5 哈希
  const dataString = JSON.stringify(fingerprintData)
  const fingerprint = createHash('md5').update(dataString).digest('hex')
  
  return fingerprint
}

/**
 * 缓存条目类
 */
class CacheEntry {
  constructor(data, ttl) {
    this.data = data
    this.createdAt = Date.now()
    this.expiresAt = Date.now() + ttl
    this.hitCount = 0
  }
  
  isExpired() {
    return Date.now() > this.expiresAt
  }
  
  hit() {
    this.hitCount++
    return this.data
  }
}

/**
 * 从缓存获取结果
 * 
 * @param {string} fingerprint - 查询指纹
 * @returns {Object|null} 缓存的 Executor 结果或 null
 */
export function getFromCache(fingerprint) {
  if (!cache.has(fingerprint)) {
    stats.misses++
    return null
  }
  
  const entry = cache.get(fingerprint)
  
  // 检查是否过期
  if (entry.isExpired()) {
    cache.delete(fingerprint)
    stats.misses++
    stats.evictions++
    return null
  }
  
  stats.hits++
  console.log(`[QueryCache] 缓存命中: ${fingerprint.slice(0, 8)}... (hitCount: ${entry.hitCount + 1})`)
  
  return entry.hit()
}

/**
 * 将结果存入缓存
 * 
 * @param {string} fingerprint - 查询指纹
 * @param {Object} data - 要缓存的 Executor 结果
 * @param {string} queryType - 查询类型（用于确定 TTL）
 */
export function setToCache(fingerprint, data, queryType = 'default') {
  // 条目数上限检查
  if (cache.size >= CACHE_CONFIG.maxEntries) {
    evictOldestEntries(Math.ceil(CACHE_CONFIG.maxEntries * 0.1))
  }

  // 内存硬上限检查：超过阈值时强制淘汰 20% 最旧条目
  const memBytes = estimateMemoryBytes()
  if (memBytes > CACHE_CONFIG.maxMemoryBytes) {
    const evictCount = Math.max(1, Math.ceil(cache.size * 0.2))
    console.warn(`[QueryCache] 内存超限 (${(memBytes / 1024 / 1024).toFixed(1)}MB > ${(CACHE_CONFIG.maxMemoryBytes / 1024 / 1024).toFixed(0)}MB)，淘汰 ${evictCount} 条`)
    evictOldestEntries(evictCount)
  }
  
  // 确定 TTL
  const ttl = CACHE_CONFIG.ttl[queryType] || CACHE_CONFIG.ttl.default
  
  // 创建缓存条目
  const entry = new CacheEntry(data, ttl)
  cache.set(fingerprint, entry)
  
  stats.sets++
  console.log(`[QueryCache] 缓存写入: ${fingerprint.slice(0, 8)}... (TTL: ${ttl / 1000}s, 内存: ${estimateMemoryUsage()})`)
}

/**
 * 驱逐最旧的缓存条目
 * @param {number} count - 要驱逐的数量
 */
function evictOldestEntries(count) {
  // 按创建时间排序
  const entries = Array.from(cache.entries())
    .sort((a, b) => a[1].createdAt - b[1].createdAt)
  
  for (let i = 0; i < count && i < entries.length; i++) {
    cache.delete(entries[i][0])
    stats.evictions++
  }
  
  console.log(`[QueryCache] LRU 驱逐: ${count} 条`)
}

/**
 * 清理过期缓存条目
 */
export function cleanupExpiredCache() {
  let cleaned = 0
  
  for (const [key, entry] of cache) {
    if (entry.isExpired()) {
      cache.delete(key)
      cleaned++
    }
  }
  
  if (cleaned > 0) {
    stats.evictions += cleaned
    console.log(`[QueryCache] 清理过期缓存: ${cleaned} 条`)
  }
  
  return cleaned
}

/**
 * 使特定查询类型的缓存失效
 * @param {string} queryType - 查询类型
 */
export function invalidateByType(queryType) {
  let invalidated = 0
  
  for (const [key, entry] of cache) {
    // 简单实现：不存储类型，所以清理所有
    // 生产环境可以在 CacheEntry 中存储 queryType
    cache.delete(key)
    invalidated++
  }
  
  console.log(`[QueryCache] 失效类型 "${queryType}": ${invalidated} 条`)
  return invalidated
}

/**
 * 清空所有缓存
 */
export function clearCache() {
  const size = cache.size
  cache.clear()
  console.log(`[QueryCache] 缓存已清空: ${size} 条`)
  return size
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats() {
  const hitRate = stats.hits + stats.misses > 0 
    ? (stats.hits / (stats.hits + stats.misses) * 100).toFixed(2)
    : 0
  
  return {
    size: cache.size,
    maxSize: CACHE_CONFIG.maxEntries,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: `${hitRate}%`,
    sets: stats.sets,
    evictions: stats.evictions,
    memoryEstimate: estimateMemoryUsage()
  }
}

/**
 * 估算内存使用量（字节数）
 */
function estimateMemoryBytes() {
  let totalBytes = 0
  
  for (const [key, entry] of cache) {
    // 粗略估计：key + JSON 序列化后的 data 大小
    totalBytes += key.length * 2 // UTF-16
    try {
      totalBytes += JSON.stringify(entry.data).length * 2
    } catch {
      totalBytes += 4096 // 序列化异常时给一个安全估计值
    }
    totalBytes += 200 // 对象开销
  }
  
  return totalBytes
}

/**
 * 格式化内存使用量为可读字符串
 */
function estimateMemoryUsage() {
  const totalBytes = estimateMemoryBytes()
  if (totalBytes > 1024 * 1024) {
    return `${(totalBytes / 1024 / 1024).toFixed(2)} MB`
  }
  return `${(totalBytes / 1024).toFixed(2)} KB`
}

// 定期清理：过期缓存 + 内存超限检查（每 2 分钟）
setInterval(() => {
  cleanupExpiredCache()
  // 即使没有过期条目，也检查内存是否超限
  const memBytes = estimateMemoryBytes()
  if (memBytes > CACHE_CONFIG.maxMemoryBytes) {
    const evictCount = Math.max(1, Math.ceil(cache.size * 0.15))
    console.warn(`[QueryCache] 定期检查：内存超限，淘汰 ${evictCount} 条`)
    evictOldestEntries(evictCount)
  }
}, 2 * 60 * 1000)

export default {
  generateQueryFingerprint,
  getFromCache,
  setToCache,
  cleanupExpiredCache,
  invalidateByType,
  clearCache,
  getCacheStats
}
