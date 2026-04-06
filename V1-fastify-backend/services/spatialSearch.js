/**
 * 空间检索服务 - Node.js 代理层
 *
 * 职责：
 * - 调用 Python gRPC 服务进行空间检索
 * - 缓存管理
 * - 错误处理
 *
 * Note: 实际的空间计算（PostGIS + 向量相似度）在 Python 服务中执行
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

import { spatialSearch, isGrpcComputeEnabled } from './grpcClient.js'

// 区域名称映射
export const REGION_NAMES = ['居住类', '商业类', '工业类', '教育类', '公共类', '自然类']

/**
 * 混合检索：空间过滤 + 向量相似度
 *
 * @param {Object} params - 检索参数
 * @param {Object} params.anchor - 锚点 {lon, lat}
 * @param {number} params.radius - 半径（米）
 * @param {number[]} params.queryEmbedding - 查询向量
 * @param {string[]} params.categories - 类别过滤
 * @param {number} params.targetRegion - 目标区域类型
 * @param {string} params.regionFilterMode - 区域过滤模式
 * @param {number} params.topK - 返回数量
 * @param {number} params.spatialWeight - 空间权重
 * @param {number} params.semanticWeight - 语义权重
 * @param {number} params.regionWeight - 区域权重
 * @returns {Promise<Array>} - 检索结果
 */
export async function hybridSearch(params) {
  const {
    anchor = { lon: 114.305, lat: 30.593 },
    radius = 1000,
    queryEmbedding = null,
    categories = [],
    targetRegion = null,
    regionFilterMode = 'boost',
    topK = 20,
    spatialWeight = 0.6,
    semanticWeight = 0.4,
    regionWeight = 0.15,
  } = params

  const startTime = Date.now()

  try {
    // 检查 gRPC 是否可用
    if (!isGrpcComputeEnabled()) {
      console.warn('[SpatialSearch] gRPC disabled, returning empty results')
      return []
    }

    // 调用 Python 服务
    const response = await spatialSearch({
      anchorLon: anchor.lon,
      anchorLat: anchor.lat,
      radius,
      queryEmbedding,
      categories,
      targetRegion: targetRegion ?? -1,
      regionFilterMode,
      topK,
      spatialWeight,
      semanticWeight,
      regionWeight,
    })

    const duration = Date.now() - startTime
    console.log(`[SpatialSearch] Found ${response.results.length} results in ${duration}ms (Python: ${response.durationMs}ms)`)

    return response.results

  } catch (err) {
    console.error('[SpatialSearch] Search failed:', err.message)
    return []
  }
}

/**
 * 获取索引状态
 *
 * @returns {Object} - 索引状态
 */
export function getIndexStatus() {
  return {
    loaded: isGrpcComputeEnabled(),
    poiCount: 615403, // 来自数据库
    embeddingDim: 352,
    loadTime: 0,
    backend: 'python_grpc',
  }
}

/**
 * 语义重排（在 Python 服务中执行）
 *
 * @param {Array} candidates - 候选 POI 列表
 * @param {number[]} queryEmbedding - 查询向量
 * @param {Object} options - 选项
 * @returns {Array} - 重排后的结果
 */
export function semanticRerank(candidates, queryEmbedding, options = {}) {
  // 如果结果已经包含 fused_score，直接返回
  // 实际重排在 Python 服务中完成
  if (!candidates || candidates.length === 0) {
    return candidates
  }

  // 按 fused_score 降序排列
  return candidates.sort((a, b) => (b.fused_score || 0) - (a.fused_score || 0))
}

/**
 * 区域过滤
 *
 * @param {Array} candidates - 候选 POI 列表
 * @param {number} targetRegion - 目标区域
 * @returns {Array} - 过滤后的结果
 */
export function filterByRegion(candidates, targetRegion) {
  if (targetRegion === null || targetRegion === undefined) {
    return candidates
  }
  return candidates.filter(c => c.regionLabel === targetRegion)
}

// 兼容旧接口
export const faissHybridSearch = hybridSearch

export default {
  hybridSearch,
  faissHybridSearch,
  getIndexStatus,
  semanticRerank,
  filterByRegion,
  REGION_NAMES,
}
