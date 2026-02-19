/**
 * 阶段 1: Planner (查询规划器)
 * 
 * 职责：
 * - 将用户自然语言问题转换为结构化 QueryPlan JSON
 * - 绝不访问 POI 数据，只做意图解析
 * - Token 消耗: < 500
 */

import { getLLMConfig } from '../../services/llm.js'
import { extractCategoriesFromQuestion, expandCategory, CATEGORY_ONTOLOGY } from '../../services/categoryOntology.js'
import { shouldHardBlockInput } from '../../services/relevanceGate.js'

/**
 * QueryPlan 默认值
 */
export const QUERY_PLAN_DEFAULTS = {
  query_type: null,
  intent_mode: null, // 'macro_overview' | 'local_search'
  anchor: {
    type: 'unknown',
    name: null,
    gate: null,
    direction: null,
    lat: null,
    lon: null
  },
  radius_m: 3000,  // 增加默认半径
  categories: [],
  rating_range: [null, null],
  semantic_query: '',
  max_results: 30,  // 增加默认结果数
  sort_by: 'distance',
  
  // 三通道核心配置
  aggregation_strategy: {
    enable: false,
    method: 'h3',       // 'h3' | 'cluster' | 'administrative'
    resolution: 9,      // H3 分辨率
    max_bins: 60        // 传给 Writer 的最大网格/聚类数 (增加)
  },
  sampling_strategy: {
    enable: false,
    method: 'representative', // 'representative' | 'random' | 'top_k'
    count: 50,                // 默认 50，支持 coarse aggregation
    rules: ['diversity']      // 采样规则: 'diversity' (多样性), 'density' (高密区), 'outlier' (异常点)
  },
  
  need_global_context: false,
  need_landmarks: false,
  need_graph_reasoning: false,
  clarification_question: null,
  
  // Phase 1 新增：置信度评分
  confidence: {
    score: 0,           // 0-10 分
    level: 'unknown',   // 'high' | 'medium' | 'low' | 'unknown'
    reasons: []         // 置信度来源说明
  }
}

/**
 * 图推理关键词（用于检测是否需要启用图推理）
 */
const GRAPH_REASONING_KEYWORDS = [
  // 网络/可达性
  '可达性', '交通网络', '路网', '连通性', '通达', '便利度',
  // 枢纽/节点
  '枢纽', '核心节点', '中心节点', '交通中心', '商业中心', '核心区',
  // 路径/连接
  '路径', '连接', '串联', '贯穿', '衔接', '辐射',
  // 结构/拓扑
  '结构', '网络结构', '空间结构', '拓扑', '布局',
  // 关系
  '关联', '协同', '共生', '聚集效应', '生态圈', '生活圈'
]

/**
 * 检测问题是否需要图推理
 * @param {string} question - 用户问题
 * @returns {boolean}
 */
function detectGraphReasoningNeed(question) {
  if (!question) return false
  const q = question.toLowerCase()
  return GRAPH_REASONING_KEYWORDS.some(kw => q.includes(kw))
}

// =====================================================
// Phase 1 优化：置信度评分 + 澄清问题生成
// =====================================================

/**
 * 计算 QueryPlan 的置信度评分
 * 
 * 评分维度 (总分 10 分)：
 * - query_type 明确性: 2 分
 * - intent_mode 一致性: 2 分  
 * - anchor 有效性: 2 分
 * - categories 非空: 1.5 分
 * - semantic_query 有效: 1 分
 * - 无冲突关键词: 1.5 分
 * 
 * @param {Object} plan - QueryPlan
 * @param {string} question - 原始问题
 * @returns {Object} { score: number, level: string, reasons: string[] }
 */
function calculatePlanConfidence(plan, question) {
  let score = 0
  const reasons = []
  const q = question?.toLowerCase() || ''

  // 1. query_type 明确性 (2分)
  if (plan.query_type && plan.query_type !== 'area_analysis') {
    // 非默认值，说明 LLM 做出了明确判断
    score += 2
    reasons.push('query_type 已明确')
  } else if (plan.query_type === 'area_analysis') {
    // 是默认值，检查是否有宏观分析的关键词
    const macroKeywords = ['分析', '概况', '分布', '评估', '特征', '怎么样']
    if (macroKeywords.some(kw => q.includes(kw))) {
      score += 2
      reasons.push('query_type 与关键词匹配')
    } else {
      score += 0.5
      reasons.push('query_type 为默认值')
    }
  }

  // 2. intent_mode 一致性 (2分)
  if (plan.intent_mode) {
    // 检查 intent_mode 与 query_type 是否一致
    const consistent = 
      (plan.intent_mode === 'local_search' && plan.query_type === 'poi_search') ||
      (plan.intent_mode === 'macro_overview' && plan.query_type === 'area_analysis')
    
    if (consistent) {
      score += 2
      reasons.push('intent_mode 与 query_type 一致')
    } else {
      score += 1
      reasons.push('intent_mode 与 query_type 不完全一致')
    }
  } else {
    score += 0
    reasons.push('intent_mode 未设置')
  }

  // 3. anchor 有效性 (2分)
  if (plan.anchor?.type === 'landmark' && plan.anchor?.name) {
    score += 2
    reasons.push('anchor 已明确设置')
  } else if (plan.anchor?.type === 'coordinate' && plan.anchor?.lat && plan.anchor?.lon) {
    score += 2
    reasons.push('anchor 坐标已设置')
  } else if (plan.anchor?.type === 'unknown') {
    // 检查问题中是否有地名
    const hasPlaceName = /(?:在|到|去|附近|周边|旁边)[^，。？]+/.test(question)
    if (!hasPlaceName) {
      score += 1 // 问题中没有地名，unknown 是合理的
      reasons.push('anchor 未知但问题中无明确地名')
    } else {
      score += 0
      reasons.push('anchor 未能解析问题中的地名')
    }
  }

  // 4. categories 非空 (1.5分)
  if (plan.categories && plan.categories.length > 0) {
    score += 1.5
    reasons.push(`categories 已设置 (${plan.categories.length} 个)`)
  } else {
    // 全域分析也是合理的
    const wholeAreaKeywords = ['整体', '全部', '所有', '这片', '这个区域']
    if (wholeAreaKeywords.some(kw => q.includes(kw))) {
      score += 1
      reasons.push('全域分析模式')
    } else {
      score += 0
      reasons.push('categories 为空')
    }
  }

  // 5. semantic_query 有效 (1分)
  if (plan.semantic_query && plan.semantic_query.length > 2) {
    score += 1
    reasons.push('semantic_query 已设置')
  }

  // 6. 无冲突关键词 (1.5分)
  const localKeywords = ['附近', '最近', '找', '哪里有', '有没有']
  const macroKeywords = ['分析', '概况', '分布', '评估', '结构']
  const hasLocal = localKeywords.some(kw => q.includes(kw))
  const hasMacro = macroKeywords.some(kw => q.includes(kw))
  
  if (hasLocal && hasMacro) {
    // 同时包含微观和宏观关键词，可能有歧义
    score += 0
    reasons.push('问题包含冲突关键词 (微观+宏观)')
  } else {
    score += 1.5
    reasons.push('无冲突关键词')
  }

  // 计算等级
  let level = 'unknown'
  if (score >= 8) level = 'high'
  else if (score >= 5) level = 'medium'
  else if (score >= 2) level = 'low'
  else level = 'very_low'

  return {
    score: Math.round(score * 10) / 10,
    level,
    reasons
  }
}

/**
 * 生成澄清问题
 * 
 * 当解析置信度低时，生成针对性的澄清问题
 * 
 * @param {Object} plan - 当前解析的 QueryPlan
 * @param {string} question - 原始用户问题
 * @param {Object} confidence - 置信度评分结果
 * @returns {string|null} 澄清问题或 null
 */
function generateClarificationQuestion(plan, question, confidence) {
  const issues = []

  // 分析置信度低的原因
  if (confidence.reasons.includes('问题包含冲突关键词 (微观+宏观)')) {
    // 意图模糊：同时有微观和宏观词
    return `您的问题同时涉及「搜索」和「分析」，请问您是想：
1️⃣ **找具体的点** - 如"推荐几家附近的餐厅"
2️⃣ **分析区域整体情况** - 如"这片区域的餐饮分布如何"

请选择或换一种方式描述您的需求。`
  }

  if (confidence.reasons.includes('anchor 未能解析问题中的地名')) {
    // 地名解析失败
    return `我注意到您提到了一个地点，但我没能准确识别。请问您说的是：
- 📍 一个具体的地名（如"武汉大学"、"光谷广场"）?  
- 🗺️ 当前地图视野范围?  

请提供更具体的位置描述，或者在地图上选择一个区域。`
  }

  if (confidence.reasons.includes('categories 为空') && 
      !confidence.reasons.includes('全域分析模式') &&
      plan.query_type === 'poi_search') {
    // POI 搜索但没有类别
    return `您想找什么类型的地点呢？例如：
- 🍜 餐饮美食（餐厅、咖啡厅、奶茶店...）
- 🏪 购物消费（商场、超市、便利店...）
- 🚇 交通出行（地铁站、公交站、停车场...）
- 🏥 生活服务（医院、银行、药店...）

请告诉我您具体想找什么。`
  }

  if (confidence.score < 3) {
    // 整体置信度很低
    return `抱歉，我没太理解您的问题。您是想：
1️⃣ 在某个位置**找特定类型的地点**？
2️⃣ **分析**某个区域的**整体情况**？
3️⃣ 了解**两地之间的距离或路线**？

请用更具体的描述告诉我。`
  }

  return null
}

/**
 * 净化类别列表：移除过于泛化的类别
 * 
 * 问题场景：LLM 输出 ["咖啡厅", "餐厅"]
 * - "餐厅" 会匹配所有中餐厅、快餐厅等，淹没咖啡厅的结果
 * - 应该只保留精确的 "咖啡厅" 类别
 * 
 * @param {string[]} categories - LLM 输出的类别列表
 * @returns {string[]} 净化后的类别列表
 */
function sanitizeCategories(categories) {
  if (!categories || categories.length === 0) return []
  if (categories.length === 1) return categories
  
  // 定义泛化类别及其精确子类
  const generalizationMap = {
    '餐厅': {
      generalKeywords: ['餐厅', '饭店', '餐饮'],
      preciseCategories: ['咖啡厅', '咖啡馆', '咖啡', '奶茶', '茶饮', '火锅', '烧烤', '日料', '韩餐', '西餐']
    },
    '商店': {
      generalKeywords: ['商店', '店铺', '门店'],
      preciseCategories: ['超市', '便利店', '商场', '药店']
    },
    '服务': {
      generalKeywords: ['服务', '生活服务'],
      preciseCategories: ['银行', '邮局', '快递']
    }
  }
  
  const result = []
  const hasPrecise = new Set()
  
  // 第一轮：识别精确类别
  for (const cat of categories) {
    const catLower = cat.toLowerCase()
    for (const [general, config] of Object.entries(generalizationMap)) {
      if (config.preciseCategories.some(p => catLower.includes(p.toLowerCase()))) {
        hasPrecise.add(general)
      }
    }
  }
  
  // 第二轮：过滤掉泛化类别
  for (const cat of categories) {
    const catLower = cat.toLowerCase()
    let isGeneral = false
    
    for (const [general, config] of Object.entries(generalizationMap)) {
      // 如果这是一个泛化类别，且已经有了精确类别，则跳过
      if (config.generalKeywords.some(kw => catLower.includes(kw.toLowerCase()))) {
        if (hasPrecise.has(general)) {
          isGeneral = true
          console.log(`[Planner] 净化类别: 移除泛化类别 "${cat}"，保留精确类别`)
          break
        }
      }
    }
    
    if (!isGeneral) {
      result.push(cat)
    }
  }
  
  // 如果净化后为空（不应该发生），返回原列表
  return result.length > 0 ? result : categories
}

/**
 * 检测问题中是否存在意图冲突
 * @param {string} question
 * @returns {Object} { hasConflict: boolean, localScore: number, macroScore: number }
 */
function detectIntentConflict(question) {
  const q = question.toLowerCase()
  
  const localKeywords = ['附近', '周围', '周边', '最近', '找', '哪里有', '有没有', '推荐', '去哪']
  const macroKeywords = ['分析', '概况', '特征', '分布', '评估', '怎么样', '如何', '结构', '便利度']
  
  const localScore = localKeywords.filter(kw => q.includes(kw)).length
  const macroScore = macroKeywords.filter(kw => q.includes(kw)).length
  
  return {
    hasConflict: localScore > 0 && macroScore > 0,
    localScore,
    macroScore
  }
}


// 对明显简单请求走规则快路，减少 Router LLM 开销。

function shouldUseRuleFastPath(question, context = {}) {
  const normalized = String(question || '').trim().toLowerCase()
  if (!normalized) {
    return { bypass: true, reason: 'empty_question' }
  }

  // 先执行硬规则兜底，拦截明显噪声/无关输入
  if (shouldHardBlockInput(question)) {
    return { bypass: true, reason: 'irrelevant_input' }
  }

  const complexHints = [
    '选区', '比较', '对比', '差异', '关系', '多步', '连通', '拓扑', '演化',
    'fuzzy', 'vernacular', 'narrative', 'region_comparison', 'graph'
  ]

  if (complexHints.some((hint) => normalized.includes(hint))) {
    return { bypass: false, reason: 'complex_hint_detected' }
  }

  const localHints = ['附近', '周边', '周围', '最近', '找', '哪里有', '推荐', '有没有']
  const macroHints = ['分析', '分布', '概况', '评估', '特征', '结构', '画像']
  const directionHints = ['东侧', '西侧', '南侧', '北侧', '东边', '西边', '南边', '北边', '向东', '向西', '向南', '向北']
  const hasIntentHints = localHints.some((hint) => normalized.includes(hint)) ||
    macroHints.some((hint) => normalized.includes(hint))
  const hasDirectionHints = directionHints.some((hint) => normalized.includes(hint))
  const hasCategoryHints = extractCategoriesFromQuestion(question).length > 0

  const hasAreaContext = Boolean(context?.hasSelectedArea)
  const isShortQuery = normalized.length <= 36

  if (isShortQuery && (hasIntentHints || hasDirectionHints || hasCategoryHints)) {
    return { bypass: true, reason: 'short_query_with_intent_or_direction' }
  }

  if (hasAreaContext && (hasIntentHints || hasDirectionHints || hasCategoryHints) && normalized.length <= 56) {
    return { bypass: true, reason: 'selected_area_with_clear_intent' }
  }

  return { bypass: false, reason: 'router_needed' }
}

// 统一构建快路径输出，确保规则路径与 Router 快路径结构一致。
function buildQuickPlannerOutput(userQuestion, { routerResult = null, reason = 'rule_fast_path', startTime = Date.now() } = {}) {
  // 如果是无关输入
  if (reason === "irrelevant_input") {
    const duration = Date.now() - startTime
    return {
      success: true,
      queryPlan: {
        ...QUERY_PLAN_DEFAULTS,
        query_type: 'irrelevant_input',
        intent_mode: 'out_of_scope',
        categories: [],
        semantic_query: '',
        confidence: {
          score: 9,
          level: 'high',
          reasons: ['hard_rule_block', 'query_not_geo_related']
        }
      },
      tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      duration,
      confidence: 'high',
      fastPath: true,
      routerUsed: false,
      fastPathReason: reason
    }
  }

  const quickPlan = quickIntentClassify(userQuestion)

  if (routerResult?.anchor) {
    quickPlan.anchor = { type: 'landmark', name: routerResult.anchor, lat: null, lon: null }
  }
  if (routerResult?.categories?.length > 0) {
    quickPlan.categories = routerResult.categories
  }
  if (routerResult?.intent) {
    quickPlan.query_type = routerResult.intent === 'search' ? 'poi_search' : 'area_analysis'
    quickPlan.intent_mode = routerResult.intent === 'search' ? 'local_search' : 'macro_overview'
  }

  if (!quickPlan.need_graph_reasoning && detectGraphReasoningNeed(userQuestion)) {
    quickPlan.need_graph_reasoning = true
  }

  quickPlan.confidence = {
    score: routerResult ? 8 : 7,
    level: 'high',
    reasons: routerResult
      ? ['LLM 路由判定简单问题', '规则引擎快速生成']
      : ['规则引擎快速路径', reason]
  }

  const duration = Date.now() - startTime
  return {
    success: true,
    queryPlan: quickPlan,
    tokenUsage: routerResult?.tokenUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    duration,
    confidence: 'high',
    fastPath: true,
    routerUsed: Boolean(routerResult),
    fastPathReason: reason
  }
}

// =====================================================
// LLM Router: 超快速问题复杂度分类
// 使用极短 prompt，预期响应时间 < 1秒
// =====================================================

const ROUTER_PROMPT = `判断这个空间查询的复杂度，返回JSON:
- complexity: "simple"(找地点/分析单一区域) 或 "complex"(对比多选区/关系/多步推理)
- intent: "search"(找具体POI) 或 "analysis"(区域分析) 或 "comparison"(多选区对比)
- anchor: 提取的地名(如"武汉大学")，无则null
- categories: 类别数组(如["咖啡厅"])
- regions: 提取的选区编号数组(如问题中有"选区1和选区4"则返回[1,4])，无则[]

只返回JSON，不要解释。`

/**
 * LLM Router: 快速分类问题复杂度
 * 使用极短 prompt，预期 < 1秒完成
 * 
 * @param {string} question - 用户问题
 * @returns {Promise<{isSimple: boolean, intent: string, anchor: string|null, categories: string[]}>}
 */
async function classifyQueryComplexity(question) {
  const startTime = Date.now()
  
  try {
    const { baseUrl, model, apiKey, isLocal } = await getLLMConfig()
    
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ROUTER_PROMPT },
          { role: 'user', content: question }
        ],
        temperature: 0,      // 零温度，确保确定性输出
        max_tokens: 100,     // 极短输出
      }),
    })
    
    if (!response.ok) {
      throw new Error(`Router API error: ${response.status}`)
    }
    
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    // 解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[Router] 无法解析 JSON，降级到完整分析')
      return { isSimple: false, error: 'router_parse_failed' }
    }
    
    const parsed = JSON.parse(jsonMatch[0])
    const duration = Date.now() - startTime
    
    // 检测是否为多选区对比
    const isComparison = parsed.intent === 'comparison' || (parsed.regions && parsed.regions.length > 1)
    
    console.log(`[Router] 分类完成 (${duration}ms): ${parsed.complexity}, intent=${parsed.intent}${isComparison ? ', regions=' + JSON.stringify(parsed.regions) : ''}`)
    
    return {
      isSimple: parsed.complexity === 'simple' && !isComparison,
      isComparison,
      intent: parsed.intent,
      anchor: parsed.anchor,
      categories: parsed.categories || [],
      regions: parsed.regions || [],
      tokenUsage: data.usage
    }
  } catch (err) {
    console.warn('[Router] 分类失败，降级到完整分析:', err.message)
    return { isSimple: false, error: err.message }
  }
}

/**
 * Planner System Prompt
 * 严格约束 LLM 只做意图解析，不做回答
 */
const PLANNER_SYSTEM_PROMPT = `你是一个"空间查询规划器"，职责是将自然语言转换为结构化 QueryPlan。

## 核心职责：区分"宏观概括"与"微观检索"
这是最关键的决策！你必须判断用户是想看**整体区域的统计特征**，还是想找**具体的点**。

### 模式 A: 宏观概括 (Macro Overview) / query_type="area_analysis"
- **用户意图**：了解区域整体情况、分布规律、业态结构、交通便利度等。
- **典型提问**："分析这片区域"、"这里有什么特点"、"交通怎么样"、"商业分布如何"。
- **配置**：
  - \`query_type\`: "area_analysis"
  - \`intent_mode\`: "macro_overview"
  - \`aggregation_strategy.enable\`: true (必须开启! 看统计数据)
  - \`radius_m\`: 3000 ~ 5000 (大范围)
  - \`sampling_strategy.enable\`: true (选代表点)
  - \`categories\`: 
    - 问"交通": ["公交站", "地铁站", "停车场", ...]
    - 问"商业": ["商场", "超市", ...]
    - 问"整体": [] (空数组代表全域)

### 模式 B: 微观检索 (Local Search) / query_type="poi_search"
- **用户意图**：寻找特定的店、设施，或者查询某个具体地点周边的信息。
- **典型提问**："附近有好吃的吗"、"找最近的咖啡馆"、"武汉大学附近有什么"、"哪里有停车场"。
- **配置**：
  - \`query_type\`: "poi_search"
  - \`intent_mode\`: "local_search"
  - \`aggregation_strategy.enable\`: false (看明细!)
  - \`radius_m\`: 500 ~ 1500 (小范围)
  - \`categories\`: 必须指定具体类别! (如 ["咖啡厅", "中餐厅"])
  - \`max_results\`: 10 ~ 20

## JSON 结构定义
{
  "query_type": "area_analysis" | "poi_search" | "distance_query",
  "intent_mode": "macro_overview" | "local_search", // 显式标记意图模式
  "anchor": { ... },
  "radius_m": number,
  "categories": ["cat1", "cat2"], 
  "semantic_query": "...", // 用于 pgvector 搜索
  
  "aggregation_strategy": {
    "enable": boolean,
    "method": "h3",
    "resolution": number
  },
  
  "sampling_strategy": { ... },
  
  // 图推理开关
  "need_graph_reasoning": boolean // 是否需要图结构分析（可达性/枢纽/网络结构）
}

## 类别映射表 (必须严格遵守)
| 领域 | 关键词 | categories |
|---|---|---|
| **交通/通勤** | 交通,出行,公交,地铁,停车 | ["公交站", "地铁站", "停车场", "加油站", "火车站"] |
| **教育/学校** | 教育,上学,学校,培训 | ["学校", "幼儿园", "小学", "中学", "大学", "培训机构"] |
| **医疗/健康** | 医院,看病,药店 | ["医院", "诊所", "药店", "社区卫生服务中心"] |
| **购物/商业** | 购物,商场,买东西 | ["商场", "购物中心", "超市", "便利店"] |
| **餐饮/美食** | 吃饭,好吃的,餐厅 | ["餐厅", "中餐厅", "快餐", "小吃", "咖啡厅"] |

## 决策逻辑
1. **关键词匹配**：
   - 有"分析"、"概况"、"特征"、"分布"、"便利度" → **Macro Overview**
   - 有"附近"、"最近"、"找..."、"哪里有" → **Local Search**

2. **语义推断**：
   - "评估当前区域交通" → Area Analysis (Traffic Topic)
   - "最近的地铁站在哪" → POI Search (Traffic Topic)

3. **Pgvector 触发**：
   - 凡是意图模糊或涉及形容词（"好玩的", "高档的"），必须生成 \`semantic_query\`。

4. **图推理触发 (Graph Reasoning)**：
   - 涉及"可达性"、"枢纽"、"连接"、"网络结构"、"辐射"、"生活圈"时，设置 \`need_graph_reasoning: true\`。
   - 图推理用于分析：区域核心节点、桥梁连接点、功能社区划分。

### 模式 C: 多选区对比 (Region Comparison) / query_type="region_comparison"
- **用户意图**：对比多个已绘制选区的差异、相似性、优劣势等。
- **典型提问**："选区1和选区4的产业结构有什么差异"、"对比选区2和选区3的商业分布"。
- **配置**：
  - \`query_type\`: "region_comparison"
  - \`intent_mode\`: "comparison"
  - \`target_regions\`: [1, 4] (用户提到的选区编号)
  - \`comparison_dimensions\`: ["产业结构", "商业分布"] (用户关注的对比维度)
  - \`aggregation_strategy.enable\`: true (需要统计数据来对比)

## 示例

用户："评估当前区域的交通便利程度"
输出：
{
  "query_type": "area_analysis",
  "intent_mode": "macro_overview",
  "categories": ["公交站", "地铁站", "停车场", "加油站", "火车站"],
  "radius_m": 3000,
  "aggregation_strategy": { "enable": true, "method": "h3", "resolution": 9 },
  "sampling_strategy": { "enable": true, "count": 25 },
  "semantic_query": "交通便利度 交通枢纽 公交站 地铁站",
  "need_landmarks": true
}

用户："武汉大学附近有什么好吃的"
输出：
{
  "query_type": "poi_search",
  "intent_mode": "local_search",
  "anchor": { "type": "landmark", "name": "武汉大学" },
  "categories": ["餐厅", "中餐厅", "小吃", "快餐"],
  "radius_m": 1000,
  "aggregation_strategy": { "enable": false },
  "semantic_query": "美食 餐厅 好吃的",
  "max_results": 20
}

用户："分析选区1和选区4的产业结构差异"
输出：
{
  "query_type": "region_comparison",
  "intent_mode": "comparison",
  "target_regions": [1, 4],
  "comparison_dimensions": ["产业结构", "业态分布"],
  "aggregation_strategy": { "enable": true, "method": "h3", "resolution": 9 },
  "semantic_query": "产业结构 业态 商业分布"
}
`

/**
 * 构建上下文提示字符串
 * @param {Object} context - 上下文信息
 * @returns {string} 格式化的上下文字符串
 */
function buildContextString(context) {
  const lines = []
  
  if (context.hasSelectedArea) {
    lines.push('- 用户已选择了一个地图区域')
  } else {
    lines.push('- 用户尚未选择区域，需要根据问题中的地名定位')
  }
  
  if (context.poiCount) {
    lines.push(`- 当前选区内 POI 总数: ${context.poiCount}`)
  }
  
  if (context.selectedCategories?.length > 0) {
    lines.push(`- 已筛选的类别: ${context.selectedCategories.slice(0, 5).join(', ')}`)
  }
  
  if (context.viewportCenter) {
    lines.push(`- 当前视图中心: ${context.viewportCenter.lat.toFixed(4)}, ${context.viewportCenter.lon.toFixed(4)}`)
  }
  
  // 多选区上下文
  if (context.regions && context.regions.length > 0) {
    lines.push(`- 用户已绘制 ${context.regions.length} 个选区: ${context.regions.map(r => r.name).join(', ')}`)
    context.regions.forEach(r => {
      lines.push(`  - ${r.name}: ${r.poiCount || 0} 个 POI`)
    })
  }
  
  // 多选区对比上下文
  if (context.isComparison && context.targetRegions?.length > 0) {
    lines.push(`- 用户正在对比选区: ${context.targetRegions.map(id => '选区' + id).join(' vs ')}`)
    lines.push('- 请使用 query_type: "region_comparison" 并设置 target_regions 字段')
  }
  
  return lines.length > 0 ? lines.join('\n') : '无额外上下文'
}

/**
 * 清理 LLM 输出，提取 JSON
 * @param {string} content - LLM 原始输出
 * @returns {Object|null} 解析后的 JSON 或 null
 */
function extractJSON(content) {
  if (!content) return null
  
  // 1. 移除 <think> 标签
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  
  // 2. 移除 Markdown 代码块标记
  cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  
  // 3. 尝试提取 JSON 对象
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  
  try {
    return JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error('[Planner] JSON 解析失败:', err.message)
    console.error('[Planner] 原始内容:', jsonMatch[0].slice(0, 200))
    return null
  }
}

/**
 * 验证并规范化 QueryPlan
 * @param {Object} plan - 原始解析的 plan
 * @returns {Object} 规范化后的 QueryPlan
 */
function validateAndNormalize(plan) {
  if (!plan || typeof plan !== 'object') {
    return { ...QUERY_PLAN_DEFAULTS }
  }
  
  const normalized = { ...QUERY_PLAN_DEFAULTS }
  
  // query_type
  const validTypes = ['poi_search', 'area_analysis', 'distance_query', 'recommendation', 'path_query', 'clarification_needed']
  if (validTypes.includes(plan.query_type)) {
    normalized.query_type = plan.query_type
  }
  
  // anchor
  if (plan.anchor && typeof plan.anchor === 'object') {
    normalized.anchor = {
      type: ['landmark', 'coordinate', 'area', 'unknown'].includes(plan.anchor.type) 
        ? plan.anchor.type 
        : 'unknown',
      name: plan.anchor.name || null,
      gate: plan.anchor.gate || null,
      direction: plan.anchor.direction || null,
      lat: typeof plan.anchor.lat === 'number' ? plan.anchor.lat : null,
      lon: typeof plan.anchor.lon === 'number' ? plan.anchor.lon : null
    }
  }
  
  // radius_m
  if (typeof plan.radius_m === 'number' && plan.radius_m > 0) {
    normalized.radius_m = Math.min(plan.radius_m, 10000) // 最大 10km
  }
  
  // categories
  if (Array.isArray(plan.categories)) {
    normalized.categories = plan.categories.filter(c => typeof c === 'string').slice(0, 10)
    
    // Phase 1 修复：净化 categories，避免泛化类别覆盖精确类别
    // 例如：["咖啡厅", "餐厅"] → ["咖啡厅", "咖啡馆", "咖啡店"] (移除"餐厅"并展开)
    normalized.categories = sanitizeCategories(normalized.categories)
  }
  
  // rating_range
  if (Array.isArray(plan.rating_range) && plan.rating_range.length === 2) {
    normalized.rating_range = [
      typeof plan.rating_range[0] === 'number' ? plan.rating_range[0] : null,
      typeof plan.rating_range[1] === 'number' ? plan.rating_range[1] : null
    ]
  }
  
  // semantic_query
  if (typeof plan.semantic_query === 'string') {
    normalized.semantic_query = plan.semantic_query.slice(0, 200)
  }
  
  // max_results
  if (typeof plan.max_results === 'number' && plan.max_results > 0) {
    normalized.max_results = Math.min(plan.max_results, 50)
  }
  
  // sort_by
  if (['distance', 'rating', 'relevance'].includes(plan.sort_by)) {
    normalized.sort_by = plan.sort_by
  }
  
  // 布尔开关
  normalized.need_global_context = !!plan.need_global_context
  normalized.need_landmarks = !!plan.need_landmarks
  
  // 图推理开关：LLM 判断 + 后端关键词检测双保险
  normalized.need_graph_reasoning = !!plan.need_graph_reasoning
  
  // intent_mode (支持宏观/微观意图)
  if (['macro_overview', 'local_search'].includes(plan.intent_mode)) {
    normalized.intent_mode = plan.intent_mode
  } else {
    // 简单的推断
    if (normalized.query_type === 'poi_search') normalized.intent_mode = 'local_search'
    else if (normalized.query_type === 'area_analysis') normalized.intent_mode = 'macro_overview'
  }
  
  // aggregation_strategy
  if (plan.aggregation_strategy) {
    normalized.aggregation_strategy = {
      enable: !!plan.aggregation_strategy.enable,
      method: 'h3',
      // 允许根据范围动态调整: 大范围用8，小范围用9或10
      resolution: plan.aggregation_strategy.resolution || (normalized.radius_m > 5000 ? 8 : 9),
      max_bins: plan.aggregation_strategy.max_bins || (normalized.radius_m > 5000 ? 60 : 50)
    }
  }

  // sampling_strategy
  if (plan.sampling_strategy) {
    normalized.sampling_strategy = {
      enable: !!plan.sampling_strategy.enable,
      method: plan.sampling_strategy.method || 'representative',
      // 【强制修复】宏观分析模式下，强制设为 50，不管 LLM 说了什么
      count: (normalized.intent_mode === 'macro_overview' || normalized.query_type === 'area_analysis') ? 50 : (plan.sampling_strategy.count || 20),
      rules: Array.isArray(plan.sampling_strategy.rules) ? plan.sampling_strategy.rules : ['diversity']
    }
  }

  // clarification_question
  if (typeof plan.clarification_question === 'string') {
    normalized.clarification_question = plan.clarification_question
  }
  
  // 语义查询增强逻辑
  if (!normalized.semantic_query) {
    if (normalized.intent_mode === 'macro_overview') {
       // 宏观模式：地标优先
       normalized.semantic_query = '具有代表性的地标 购物中心 商场 大厦 广场 公园 医院 学校 交通枢纽'
       console.log('[Planner] 宏观模式：自动生成全域地标语义查询')
    } else if (normalized.intent_mode === 'local_search' && normalized.categories.length > 0) {
       // 微观搜索：基于类别生成 (e.g. "好吃的 餐厅")
       normalized.semantic_query = `好评 ${normalized.categories.join(' ')}`
       console.log('[Planner] 微观模式：自动生成基于类别的语义查询:', normalized.semantic_query)
    }
  }
  
  return normalized
}

/**
 * 根据用户问题自动推断 POI 类别（后备逻辑）
 * 当 LLM 没有正确识别专题时，后端自动补充
 * 
 * Phase 1 优化：使用类别本体进行更精确的匹配
 */
function inferCategoriesFromQuestion(question, existingCategories) {
  // 如果已经有非空 categories，直接返回
  if (existingCategories && existingCategories.length > 0) {
    return existingCategories
  }
  
  // 使用类别本体提取类别
  const detected = extractCategoriesFromQuestion(question)
  
  if (detected.length > 0) {
    // 取置信度最高的类别，并展开为子类别
    const topCategory = detected[0].category
    const expanded = expandCategory(topCategory)
    console.log(`[Planner] 类别本体推断：检测到 "${topCategory}"，展开为 ${expanded.length} 个类别`)
    return expanded.slice(0, 8) // 限制最多 8 个
  }
  
  // 兜底：使用原来的硬编码映射
  const q = question.toLowerCase()
  
  const topicMapping = {
    traffic: {
      keywords: ['交通', '出行', '通勤', '公交', '地铁', '火车', '机场', '停车'],
      categories: ['公交站', '地铁站', '停车场', '加油站', '高铁站', '火车站', '汽车站', '机场']
    },
    education: {
      keywords: ['教育', '学校', '上学', '幼儿园', '小学', '中学', '大学', '培训'],
      categories: ['学校', '幼儿园', '小学', '中学', '高中', '大学', '培训机构', '图书馆']
    },
    medical: {
      keywords: ['医疗', '看病', '就医', '医院', '诊所', '药店', '卫生'],
      categories: ['医院', '诊所', '卫生院', '药店', '社区卫生服务中心']
    },
    shopping: {
      keywords: ['购物', '买东西', '商场', '超市', '商业'],
      categories: ['商场', '超市', '购物中心', '百货', '便利店']
    },
    food: {
      keywords: ['餐饮', '吃饭', '美食', '餐厅', '小吃', '好吃'],
      categories: ['餐厅', '饭店', '快餐', '小吃', '咖啡', '奶茶']
    },
    entertainment: {
      keywords: ['娱乐', '休闲', '玩', '电影', '公园', '景点'],
      categories: ['电影院', 'KTV', '游乐场', '公园', '景区', '健身房']
    },
    finance: {
      keywords: ['银行', '金融', 'ATM', '理财'],
      categories: ['银行', 'ATM', '证券', '保险']
    },
    lodging: {
      keywords: ['住宿', '酒店', '宾馆', '民宿'],
      categories: ['酒店', '宾馆', '民宿', '公寓']
    }
  }
  
  for (const [topic, config] of Object.entries(topicMapping)) {
    for (const keyword of config.keywords) {
      if (q.includes(keyword)) {
        console.log(`[Planner] 后备推断：检测到专题 "${topic}"，自动设置 categories`)
        return config.categories
      }
    }
  }
  
  return []
}

/**
 * 阶段 1 主入口：解析用户意图
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Object} context - 上下文信息
 *   @param {boolean} context.hasSelectedArea - 是否已选区域
 *   @param {number} context.poiCount - 选区内 POI 数量
 *   @param {string[]} context.selectedCategories - 已选类别
 *   @param {Object} context.viewportCenter - 当前视图中心 {lat, lon}
 * @returns {Promise<{success: boolean, queryPlan: Object, error?: string, tokenUsage?: Object}>}
 */
export async function parseIntent(userQuestion, context = {}) {
  const startTime = Date.now()
  
  console.log(`[Planner] 开始解析意图: "${userQuestion.slice(0, 50)}..."`)
  
  // =========================================================
  // 快速规则路径优先：明显简单问题不再等待 LLM Router
  // =========================================================
  const fastPathDecision = shouldUseRuleFastPath(userQuestion, context)
  if (fastPathDecision.bypass) {
    const quickOutput = buildQuickPlannerOutput(userQuestion, {
      reason: fastPathDecision.reason,
      startTime
    })

    console.log(`[Planner] ⚡ 规则快速路径 (${quickOutput.duration}ms): ${quickOutput.queryPlan.query_type}`)
    console.log(`[Planner] fast-path reason: ${fastPathDecision.reason}`)
    return quickOutput
  }

  const routerResult = await classifyQueryComplexity(userQuestion)

  // Router 不可用时，直接回退规则引擎，避免额外一次 LLM 重试。
  if (routerResult?.error) {
    const fallbackOutput = buildQuickPlannerOutput(userQuestion, {
      reason: `router_failed:${routerResult.error}`,
      startTime
    })

    fallbackOutput.confidence = 'medium'
    fallbackOutput.queryPlan.confidence = {
      score: 6,
      level: 'medium',
      reasons: ['router 失败回退', routerResult.error]
    }

    console.log(`[Planner] ⚡ Router 失败回退规则路径 (${fallbackOutput.duration}ms)`)
    return fallbackOutput
  }

  if (routerResult.isSimple) {
    const quickOutput = buildQuickPlannerOutput(userQuestion, {
      routerResult,
      reason: 'router_simple',
      startTime
    })

    console.log(`[Planner] ⚡ 智能快速路径 (${quickOutput.duration}ms): ${quickOutput.queryPlan.query_type}`)
    console.log(`[Planner] categories: ${quickOutput.queryPlan.categories?.join(', ') || '(全域分析)'}`)
    return quickOutput
  }
  
  // 多选区对比模式
  if (routerResult.isComparison) {
    console.log(`[Planner] 📊 检测到多选区对比请求，目标选区: ${routerResult.regions.join(', ')}`)
  }
  
  console.log(`[Planner] 🧠 复杂问题，使用完整 LLM 解析...`)
  
  // =========================================================
  // 原有路径：调用 LLM 进行解析
  // =========================================================
  
  // 如果是多选区对比，增强上下文
  let enhancedContext = { ...context }
  if (routerResult.isComparison && routerResult.regions.length > 0) {
    enhancedContext.targetRegions = routerResult.regions
    enhancedContext.isComparison = true
  }
  
  // 构建上下文
  const contextStr = buildContextString(enhancedContext)
  const systemPrompt = PLANNER_SYSTEM_PROMPT.replace('{context}', contextStr)
  
  try {
    // 获取 LLM 配置（自动选择本地或云端）
    const { baseUrl, model, apiKey, isLocal } = await getLLMConfig()
    
    console.log(`[Planner] 使用 ${isLocal ? '本地' : '云端'} 模型: ${model}`)
    
    // 构建请求头
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuestion }
        ],
        temperature: 0.1,  // 低温度保证输出稳定
        max_tokens: 500,   // 限制输出 token
      }),
    })
    
    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    
    // 提取并解析 JSON
    const rawPlan = extractJSON(content)
    let queryPlan = validateAndNormalize(rawPlan)
    
    // Phase 1 核心优化：计算置信度评分
    const confidence = calculatePlanConfidence(queryPlan, userQuestion)
    queryPlan.confidence = confidence
    
    console.log(`[Planner] 置信度评分: ${confidence.score}/10 (${confidence.level})`)
    console.log(`[Planner] 置信度原因:`, confidence.reasons.join(', '))
    
    // 低置信度时触发澄清机制
    if (confidence.level === 'very_low' || confidence.level === 'low') {
      const clarificationQ = generateClarificationQuestion(queryPlan, userQuestion, confidence)
      if (clarificationQ) {
        console.log('[Planner] 触发澄清机制')
        queryPlan.query_type = 'clarification_needed'
        queryPlan.clarification_question = clarificationQ
      }
    }
    
    // 关键后备逻辑：如果 LLM 没有正确设置 categories，根据问题自动推断
    if (queryPlan.query_type !== 'clarification_needed') {
      queryPlan.categories = inferCategoriesFromQuestion(userQuestion, queryPlan.categories)
    }
    
    // 图推理后备检测：如果 LLM 没有识别到图推理需求，但问题中包含关键词，强制开启
    if (!queryPlan.need_graph_reasoning && detectGraphReasoningNeed(userQuestion)) {
      queryPlan.need_graph_reasoning = true
      console.log('[Planner] 后备检测：启用图推理通道')
    }
    
    const duration = Date.now() - startTime
    console.log(`[Planner] 解析完成 (${duration}ms): ${queryPlan.query_type}, 置信度: ${confidence.level}`)
    console.log(`[Planner] categories: ${queryPlan.categories?.join(', ') || '(全域分析)'}`)
    console.log(`[Planner] QueryPlan:`, JSON.stringify(queryPlan).slice(0, 200))
    
    return {
      success: true,
      queryPlan,
      tokenUsage: data.usage,
      duration,
      confidence: confidence.level
    }
  } catch (err) {
    console.error('[Planner] 意图解析失败:', err.message)
    
    // 返回默认的区域分析 plan
    return {
      success: false,
      error: err.message,
      queryPlan: {
        ...QUERY_PLAN_DEFAULTS,
        query_type: 'area_analysis',
        need_global_context: true,
        need_landmarks: true,
        confidence: { score: 0, level: 'error', reasons: [err.message] }
      }
    }
  }
}

/**
 * 快速意图分类（不调用 LLM，用于简单场景）
 * @param {string} question - 用户问题
 * @returns {Object} 简化的 QueryPlan
 */
export function quickIntentClassify(question) {
  const q = question.toLowerCase()
  const plan = { ...QUERY_PLAN_DEFAULTS }
  
  // 1. 明确的微观检索 (Local Search)
  // 关键词：附近、周围、周边、最近、找、哪里有、有没有、推荐几个
  const localKeywords = ['附近', '周围', '周边', '最近', '找', '哪里有', '有没有', '推荐几个', '东侧', '西侧', '南侧', '北侧', '东边', '西边', '南边', '北边']
  if (localKeywords.some(kw => q.includes(kw))) {
    plan.query_type = 'poi_search'
    plan.intent_mode = 'local_search'
    plan.radius_m = 1000 // 默认小范围
    plan.aggregation_strategy.enable = false // 不聚合，看明细
    
    // 尝试提取锚点 (地标)
    // 匹配模式: "XX附近"、"XX周边"、"XX旁边" 等
    const anchorPatterns = [
      /(.{2,15})(附近|周边|周围|旁边)/,  // "湖北大学附近"
      /在(.{2,15})(附近|周边)/,           // "在武汉大学附近"
      /去(.{2,15})/                       // "去光谷广场"
    ]
    
    for (const pattern of anchorPatterns) {
      const match = question.match(pattern)
      if (match && match[1]) {
        const anchorName = match[1].trim()
        // 过滤掉太短或太通用的词
        if (anchorName.length >= 2 && !['这里', '那里', '这边', '那边', '哪里'].includes(anchorName)) {
          plan.anchor = { type: 'landmark', name: anchorName, lat: null, lon: null }
          console.log(`[Planner Quick] 提取到锚点: "${anchorName}"`)
          break
        }
      }
    }
    
    // 尝试提取类别
    const categories = inferCategoriesFromQuestion(q, [])
    if (categories.length > 0) {
      plan.categories = categories
      // 生成语义查询
      plan.semantic_query = categories.join(' ')
    } else {
      // 尝试从问题中截取（简单启发式）
      const match = q.match(/(?:找|哪里有|有没有|好吃的|好玩的)(.+)/)
      if (match) {
        plan.semantic_query = match[1].trim()
      }
    }
    
    // 设置置信度
    plan.confidence = { 
      score: plan.anchor?.name ? 8 : 6, 
      level: plan.anchor?.name ? 'high' : 'medium', 
      reasons: plan.anchor?.name ? ['规则匹配成功', '锚点已提取'] : ['规则匹配成功'] 
    }
    
    return plan
  }
  
  // 2. 明确的宏观分析 (Macro Overview)
  // 关键词：分析、概况、特征、规律、分布、评估、怎么样、如何、特点、报告
  const macroKeywords = ['分析', '概况', '特征', '规律', '分布', '评估', '怎么样', '如何', '特点', '报告']
  if (macroKeywords.some(kw => q.includes(kw))) {
    plan.query_type = 'area_analysis'
    plan.intent_mode = 'macro_overview'
    plan.radius_m = 3000 // 默认大范围
    
    // 必须开启聚合
    plan.aggregation_strategy = { enable: true, method: 'h3', resolution: 9, max_bins: 60 }
    plan.sampling_strategy = { enable: true, method: 'representative', count: 50, rules: ['diversity'] }
    plan.need_global_context = true
    plan.need_landmarks = true
    
    // 专题推断
    plan.categories = inferCategoriesFromQuestion(q, [])
    return plan
  }
  
  // 3. 检查是否需要图推理
  if (detectGraphReasoningNeed(question)) {
    plan.need_graph_reasoning = true
    plan.query_type = 'area_analysis'
    plan.intent_mode = 'macro_overview'
    plan.aggregation_strategy = { enable: true, method: 'h3', resolution: 9, max_bins: 60 }
    plan.need_global_context = true
    console.log('[Planner Quick] 检测到图推理关键词，启用图推理通道')
  }
  
  // 4. 默认兜底：如果没有明确分类，设置为 area_analysis 并标记低置信度
  if (!plan.query_type) {
    plan.query_type = 'area_analysis'
    plan.intent_mode = 'macro_overview'
    plan.confidence = { score: 3, level: 'low', reasons: ['意图不明确，默认使用宏观分析'] }
  }
  
  // 5. 检查意图冲突
  const conflict = detectIntentConflict(question)
  if (conflict.hasConflict) {
    plan.query_type = 'clarification_needed'
    plan.clarification_question = `您的问题同时包含微观搜索（如"${localKeywords.find(kw => q.includes(kw))}"）和宏观分析（如"${macroKeywords.find(kw => q.includes(kw))}"），请问您更倾向于：
1️⃣ **查看区域整体分布与分析**
2️⃣ **寻找具体的兴趣点列表**`
  }

  plan.categories = inferCategoriesFromQuestion(q, plan.categories || [])
  
  return plan
}

export default {
  parseIntent,
  quickIntentClassify,
  QUERY_PLAN_DEFAULTS
}
