/**
 * 三阶段 Spatial-RAG 管道协调器
 * 
 * 架构设计：
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 阶段1: Planner (LLM)                                         │
 * │   用户问题 → LLM → QueryPlan JSON                             │
 * │   (不看任何 POI 数据，只解析意图)                              │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 阶段2: Executor (后端)                                        │
 * │   QueryPlan → PostGIS + Milvus + 图库 → 压缩结果              │
 * │   (所有计算在数据库完成，不调 LLM)                             │
 * ├──────────────────────────────────────────────────────────────┤
 * │ 阶段3: Writer (LLM)                                          │
 * │   压缩结果 → LLM → 自然语言回答                                │
 * │   (只看少量结果，Token 可控)                                   │
 * └──────────────────────────────────────────────────────────────┘
 * 
 * Token 控制策略：
 * - Planner: < 500 tokens
 * - Executor: 0 tokens (纯后端)
 * - Writer: < 2000 tokens
 * - 总计: < 2500 tokens/请求
 */

import { parseIntent, quickIntentClassify, QUERY_PLAN_DEFAULTS } from './planner.js'
import { executeSpatialPlanWithFallback } from '../../services/spatialJobRunner.js'
import { generateAnswer, buildQuickReply } from './writer.js'
// Phase 2 优化：多轮对话上下文
import conversationContext from '../../services/conversationContext.js'

/**
 * 管道配置
 */
const PIPELINE_CONFIG = {
  // 是否启用快速模式（跳过 Planner LLM 调用）
  enableQuickMode: false,
  
  // 快速模式触发条件：POI 数量阈值
  quickModeThreshold: 50,
  
  // 是否记录详细日志
  verboseLogging: true,
  
  // 阶段超时（毫秒）
  stageTimeout: {
    planner: 10000,
    executor: 15000,
    writer: 30000
  }
}

/**
 * 管道执行统计
 */
class PipelineStats {
  constructor() {
    this.startTime = Date.now()
    this.stages = {}
  }
  
  startStage(name) {
    this.stages[name] = { start: Date.now() }
  }
  
  endStage(name, extra = {}) {
    if (this.stages[name]) {
      this.stages[name].duration = Date.now() - this.stages[name].start
      this.stages[name] = { ...this.stages[name], ...extra }
    }
  }
  
  getSummary() {
    return {
      total_duration: Date.now() - this.startTime,
      stages: this.stages
    }
  }

}

/**
 * ?????? pipeline ???? spatialJobRunner?
 * ???????? legacy executor.js?
 */
export async function executeQuery(queryPlan, frontendPOIs = [], options = {}) {
  const spatialContext = options.spatialContext || options.context || {}

  return executeSpatialPlanWithFallback({
    queryPlan,
    poiFeatures: frontendPOIs,
    spatialContext,
    options,
    requestId: options.requestId || options.request_id
  })
}

/**
 * 完整的三阶段管道执行（流式）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Array} frontendPOIs - 前端传来的 POI 数据
 * @param {Object} options - 选项
 *   @param {boolean} options.quickMode - 是否启用快速模式
 *   @param {Object} options.context - 额外上下文
 * @yields {string} 流式文本块
 */
export async function* executePipeline(userQuestion, frontendPOIs = [], options = {}) {
  const stats = new PipelineStats()
  const session = options.session // 从 options 中获取 RAG Session
  
  // Phase 2 优化：多轮对话上下文管理
  const conversationSessionId = options.conversationId || options.sessionId
  const convContext = conversationContext.getOrCreateContext(conversationSessionId)
  
  // 代词消解：处理"那附近"、"它们"等指代词
  const pronounResolution = convContext.resolvePronouns(userQuestion)
  let resolvedQuestion = pronounResolution.resolvedQuestion
  
  if (pronounResolution.needsContext) {
    console.log('[Pipeline] 代词消解:', JSON.stringify(pronounResolution.substitutions))
  }
  
  // 构建上下文
  const context = {
    hasSelectedArea: frontendPOIs.length > 0,
    poiCount: frontendPOIs.length,
    selectedCategories: extractCategories(frontendPOIs),
    regions: options.regions || [], // 多选区数据
    // Phase 2: 添加对话历史摘要
    conversationHistory: convContext.getHistorySummary(),
    lastMentionedLocation: convContext.lastMentionedLocation,
    ...options.context
  }
  
  if (PIPELINE_CONFIG.verboseLogging) {
    console.log('\n' + '='.repeat(60))
    console.log('[Pipeline] 开始处理')
    console.log(`[Pipeline] 原始问题: "${userQuestion.slice(0, 60)}${userQuestion.length > 60 ? '...' : ''}"`)  
    if (resolvedQuestion !== userQuestion) {
      console.log(`[Pipeline] 消解后: "${resolvedQuestion.slice(0, 60)}${resolvedQuestion.length > 60 ? '...' : ''}"`)  
    }
    console.log(`[Pipeline] POI 数量: ${frontendPOIs.length}`)
    console.log(`[Pipeline] 对话历史轮数: ${convContext.history.length}`)
    console.log('='.repeat(60))
  }
  
  // ========================================
  // 阶段 1: Planner - 意图解析
  // ========================================
  yield { type: 'stage', name: 'planner' }
  stats.startStage('planner')
  
  let queryPlan
  
  // 如果启用快速模式，跳过Planner LLM调用
  if (options.quickMode) {
    console.log('[Pipeline] 快速模式：跳过Planner LLM调用')
    queryPlan = {
      query_type: 'area_analysis',
      need_global_context: true,
      aggregation_strategy: { enable: true, resolution: 9 },
      sampling_strategy: { enable: true, count: 30 },
      need_landmarks: true
    }
    stats.endStage('planner', { success: true, query_type: 'area_analysis', quick_mode: true })
  } else if (PIPELINE_CONFIG.enableQuickMode && frontendPOIs.length < PIPELINE_CONFIG.quickModeThreshold) {
    // 自动快速模式：POI数量较少时使用规则匹配
    console.log('[Pipeline] 阶段1 (自动快速模式): 规则意图分类')
    queryPlan = quickIntentClassify(resolvedQuestion)
    stats.endStage('planner', { success: true, query_type: queryPlan.query_type, quick_mode: true })
  } else {
    // 正常模式：调用 LLM
    console.log('[Pipeline] 阶段1: LLM 意图解析...')
    const plannerResult = await parseIntent(resolvedQuestion, context)
    queryPlan = plannerResult.queryPlan
    
    stats.endStage('planner', {
      success: plannerResult.success,
      query_type: queryPlan.query_type,
      token_usage: plannerResult.tokenUsage
    })

    if (session && plannerResult.tokenUsage) {
      session.addTokenUsage('planner', plannerResult.tokenUsage)
    }
  }
  
  console.log(`[Pipeline] 阶段1完成: ${queryPlan.query_type}`)
  
  // 如果是无关输入，返回预设的友好响应
  if (queryPlan.query_type === 'irrelevant_input') {
    console.log('[Pipeline] 检测到无关输入，返回友好提示');
    const responses = [
      `你好！我是 Geoloom，很高兴见到你！😊

看起来你发送了一个问题，但这个问题似乎与地理空间分析不太相关呢。

我可以帮你分析：
🗺️ 空间分析 - 分析选中区域的 POI 分布
📊 数据可视化 - 生成标签云、统计图表
🧠 智能问答 - 基于地理数据回答问题
🔍 商业洞察 - 提供选址、竞争分析建议

不妨试试：
- "分析光谷的餐饮分布"
- "对比光谷和江汉路的商业密度"

期待你的地理相关问题！💪`,
      `嗨！你的问题我暂时无法理解哦！😅

作为地理空间智能助手，我可以帮你：
• 分析某个区域的 POI 分布
• 对比不同区域的商业配套
• 识别商业热点和冷区
• 推荐商业选址

试着这样问我：
- "这个区域有多少餐饮店"
- "帮我比较光谷和汉口"

有什么地理问题，随时问我！🌍`
    ];
    yield { type: 'text', content: responses[Math.floor(Math.random() * responses.length)] };
    return;
  }
  console.log(`[Pipeline] QueryPlan: ${JSON.stringify(queryPlan).slice(0, 150)}...`)
  
  // 记录 Planner 结果到 session
  if (session) {
    session.setIntent(queryPlan)
  }
  
  // 检查是否需要澄清
  if (queryPlan.query_type === 'clarification_needed' && queryPlan.clarification_question) {
    console.log('[Pipeline] 需要澄清，直接返回澄清问题')
    yield { type: 'text', content: queryPlan.clarification_question }
    return
  }
  
  // ========================================
  // 阶段 2: Executor - 数据库执行
  // ========================================
  yield { type: 'stage', name: 'executor' }
  stats.startStage('executor')
  console.log('[Pipeline] 阶段2: 数据库执行...')
  
  const executorResult = await executeQuery(queryPlan, frontendPOIs, {
    ...options,
    userQuestion: userQuestion // Phase 3: 传入原始问题供 POI 过滤器豁免检测
  })
  
  stats.endStage('executor', {
    success: executorResult.success,
    poi_count: executorResult.results?.pois?.length || 0,
    mode: executorResult.results?.mode
  })
  
  console.log(`[Pipeline] 阶段2完成: ${executorResult.results?.pois?.length || 0} POIs, 模式: ${executorResult.results?.mode}`)
  
  // 记录 Executor 结果到 session
  if (session) {
    // 记录空间追觅踪迹
    const trace = executorResult.results?.stats?.spatial_trace
    if (trace) {
      session.log('Executor', 'SpatialDecision', trace)
    }

    // 记录详细调试信息 (暴露给前端)
    const debugInfo = executorResult.results?.stats?.debug_info
    if (debugInfo && debugInfo.length > 0) {
      session.log('Executor', 'DebugDetail', debugInfo)
    }

    // 检查是否调用了数据库

    // 检查是否调用了数据库
    if (executorResult.results?.anchor) {
      session.log('PostGIS', 'SpatialQuery', { 
        anchor: executorResult.results.anchor.name,
        source: executorResult.results.anchor.resolved_from,
        poiCount: executorResult.results?.pois?.length || 0
      })
    }
    // 检查是否调用了 Milvus
    if (executorResult.results?.stats?.semantic_rerank_applied) {
      session.log('Milvus', 'SemanticRerank', { applied: true })
    }
    // 记录最终 POI
    if (executorResult.results?.pois?.length > 0) {
      session.setFinalPOIs(executorResult.results.pois)
    }
    
    // 记录自动生成的边界
    if (executorResult.results?.boundary) {
      session.setSpatialBoundary(executorResult.results.boundary)
    }
    
    // 记录空间聚类数据
    if (executorResult.results?.spatial_clusters?.hotspots) {
      session.setSpatialClusters(executorResult.results.spatial_clusters.hotspots)
    }
    
    // 记录语义模糊区域数据
    if (executorResult.results?.vernacular_regions) {
      session.setVernacularRegions(executorResult.results.vernacular_regions)
    }
    
    // 记录模糊区域数据（三层边界模型）
    if (executorResult.results?.fuzzy_regions) {
      session.setFuzzyRegions(executorResult.results.fuzzy_regions)
    }
  }
  
  // 如果执行失败，返回错误信息
  if (!executorResult.success) {
    yield { type: 'text', content: `抱歉，查询过程中出现问题: ${executorResult.error || '未知错误'}。请稍后重试。` }
    return
  }
  
  // 如果是纯搜索模式（仅获取 POI 数据），跳过 Writer 生成
  if (options.isSearchOnly) {
    console.log('[Pipeline] 纯搜索模式: 跳过 Writer 阶段')
    stats.endStage('writer', { skipped: true })
    return
  }

  // ========================================
  // 阶段 3: Writer - 生成回答
  // ========================================
  yield { type: 'stage', name: 'writer' }
  stats.startStage('writer')
  console.log('[Pipeline] 阶段3: 生成回答...')
  
  // 将 queryPlan 附加到结果中，供 Writer 参考
  executorResult.results.query_executed = queryPlan
  
  // 创建 token 使用回调
  let writerTokenUsage = null
  const writerOptions = {
    ...options,
    onTokenUsage: (usage) => {
      writerTokenUsage = usage
      if (session) {
        session.addTokenUsage('writer', usage)
      }
    }
  }
  
  let charCount = 0
  for await (const chunk of generateAnswer(resolvedQuestion, executorResult, writerOptions)) { // Phase 2: 使用消解后的问题
    charCount += chunk.length
    yield { type: 'text', content: chunk }
  }
  
  stats.endStage('writer', {
    char_count: charCount,
    token_usage: writerTokenUsage
  })
  
  // ========================================
  // 完成统计
  // ========================================
  const summary = stats.getSummary()
  
  if (PIPELINE_CONFIG.verboseLogging) {
    console.log('\n' + '='.repeat(60))
    console.log('[Pipeline] 执行完成')
    console.log(`[Pipeline] 总耗时: ${summary.total_duration}ms`)
    console.log('[Pipeline] 各阶段:')
    Object.entries(summary.stages).forEach(([name, data]) => {
      console.log(`  - ${name}: ${data.duration}ms`)
    })
    
    // Token 消耗统计
    if (session && session.summary.tokenStats) {
      const stats = session.summary.tokenStats
      console.log('[Pipeline] Token 消耗:')
      console.log(`  - Planner: ${stats.planner}`)
      console.log(`  - Writer: ${stats.writer}`)
      console.log(`  - 总计: ${stats.total}`)
    }
    
    console.log('='.repeat(60) + '\n')
  }
  
  // Phase 2 优化：记录对话轮次到上下文
  if (conversationSessionId && executorResult.success) {
    convContext.addTurn({
      question: userQuestion, // 记录原始问题
      queryPlan: queryPlan,
      anchor: executorResult.results?.anchor,
      pois: executorResult.results?.pois || [],
      summary: `查询类型: ${queryPlan.query_type}, 返回 ${executorResult.results?.pois?.length || 0} 个 POI`
    })
    console.log(`[Pipeline] 对话记录已保存 (总轮数: ${convContext.history.length})`)
  }
}

/**
 * 非流式管道执行（用于测试）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Array} frontendPOIs - 前端 POI 数据
 * @param {Object} options - 选项
 * @returns {Promise<{answer: string, stats: Object}>}
 */
export async function executePipelineSync(userQuestion, frontendPOIs = [], options = {}) {
  let answer = ''
  
  for await (const chunk of executePipeline(userQuestion, frontendPOIs, options)) {
    answer += chunk
  }
  
  return { answer }
}

/**
 * 仅执行阶段 1 和 2（用于调试或预检）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Array} frontendPOIs - 前端 POI 数据
 * @param {Object} context - 上下文
 * @returns {Promise<{queryPlan: Object, executorResult: Object}>}
 */
export async function executePlanAndQuery(userQuestion, frontendPOIs = [], context = {}) {
  // 阶段 1
  const { queryPlan } = await parseIntent(userQuestion, {
    hasSelectedArea: frontendPOIs.length > 0,
    poiCount: frontendPOIs.length,
    ...context
  })
  
  // 阶段 2
  const executorResult = await executeQuery(queryPlan, frontendPOIs)
  
  return { queryPlan, executorResult }
}

/**
 * 从 POI 数组中提取类别列表
 */
function extractCategories(pois) {
  const categories = new Set()
  
  for (const poi of pois.slice(0, 100)) { // 只检查前 100 个
    const props = poi.properties || poi
    if (props['大类']) categories.add(props['大类'])
  }
  
  return [...categories]
}

// =====================================================
// 导出原有函数以保持向后兼容
// =====================================================

// 重新导出各阶段函数
export { parseIntent } from './planner.js'
export { generateAnswer, buildQuickReply } from './writer.js'

export default {
  executePipeline,
  executePipelineSync,
  executePlanAndQuery,
  PIPELINE_CONFIG
}
