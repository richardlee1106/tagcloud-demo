/**
 * 阶段 3: Writer (解释器)
 * 
 * 职责：
 * - 基于 Executor 的压缩结果 JSON 生成自然语言回答
 * - 绝不读取原始 POI 数据
 * - Token 消耗: < 2000
 */

import { getLLMConfig } from '../../services/llm.js'

/**
 * Writer System Prompt
 * 专注于基于压缩数据生成自然语言回答
 */
const WRITER_SYSTEM_PROMPT = `You are GeoLoom-RAG, a spatial analysis assistant.
Use only the structured evidence in {result_context}.

Hard rules:
- Grounded only: never invent POIs, numbers, boundaries or region names.
- Section gating:
  - Mention multi-region comparison only when mode=region_comparison and comparison data exists.
  - Mention vernacular/fuzzy regions only when those arrays are non-empty.
  - Do not mention comparison workflows when the user did not select multiple regions.
- If source_policy.category_source is all_categories, clearly state that the analysis covers all POI categories in the active spatial boundary.
- If source_policy.category_source is ui_selector, clearly state that category filtering comes from the UI selector.

Output style:
1) Start with a 1-2 sentence direct answer.
2) Then provide 2-4 concise markdown sections that are truly relevant to available evidence.
3) Keep suggestions practical (0-3 bullets), avoid generic boilerplate.
4) Use markdown tables only when they improve readability.
5) If evidence is insufficient, state uncertainty and what is missing.
6) Match the user's language and tone.
`

const DEFAULT_WRITER_CONTEXT_LIMIT = 9000
const DEFAULT_WRITER_OUTPUT_LIMIT = 2200

// 将环境变量/入参安全转成正整数，防止预算参数异常。
function toPositiveInt(value, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return fallback
  return Math.round(num)
}

// 对上下文做硬截断，避免大上下文拖慢 Writer 推理。
function trimContextText(context, maxChars) {
  if (!context) return ''
  if (!maxChars || context.length <= maxChars) return context

  const clipped = context.slice(0, maxChars)
  const lastBreak = clipped.lastIndexOf('\n\n')
  const safePrefix = lastBreak > 200 ? clipped.slice(0, lastBreak) : clipped
  return `${safePrefix}\n\n⚠️ Context truncated to keep latency stable.`
}

// 按 query_type 选择生成参数，平衡回答质量与延迟。
function resolveWriterProfile(executorResult, options = {}) {
  const queryType = executorResult?.results?.query_executed?.query_type || 'poi_search'

  const profileByType = {
    poi_search: { temperature: 0.3, maxTokens: 1200, poiDisplayLimit: 10 },
    area_analysis: { temperature: 0.36, maxTokens: 1800, poiDisplayLimit: 8 },
    region_comparison: { temperature: 0.35, maxTokens: 2100, poiDisplayLimit: 6 },
    graph_reasoning: { temperature: 0.35, maxTokens: 1900, poiDisplayLimit: 8 },
    default: { temperature: 0.34, maxTokens: 1600, poiDisplayLimit: 10 }
  }

  const base = profileByType[queryType] || profileByType.default
  const qualityMode = String(options.writerQuality || process.env.WRITER_QUALITY || 'balanced').trim().toLowerCase()

  let maxTokens = base.maxTokens
  if (qualityMode === 'high') maxTokens += 280
  if (qualityMode === 'fast') maxTokens -= 260

  if (Array.isArray(executorResult?.results?.pois) && executorResult.results.pois.length > 150) {
    maxTokens -= 180
  }

  const maxContextChars = toPositiveInt(
    options.maxContextChars ?? process.env.WRITER_CONTEXT_LIMIT,
    DEFAULT_WRITER_CONTEXT_LIMIT
  )

  maxTokens = toPositiveInt(
    options.maxTokens ?? maxTokens,
    base.maxTokens
  )

  maxTokens = Math.max(600, Math.min(maxTokens, toPositiveInt(process.env.WRITER_OUTPUT_LIMIT, DEFAULT_WRITER_OUTPUT_LIMIT)))

  const poiDisplayLimit = toPositiveInt(options.poiDisplayLimit, base.poiDisplayLimit)

  return {
    queryType,
    qualityMode,
    temperature: typeof options.temperature === 'number' ? options.temperature : base.temperature,
    maxTokens,
    poiDisplayLimit: Math.max(3, Math.min(poiDisplayLimit, 20)),
    maxContextChars
  }
}

// 只在疑似幻觉占比较高时追加纠偏，避免正常回答被频繁打断。
function shouldAppendCorrection(report) {
  if (!report?.hasHallucination) return false
  const totalMentions = report.totalMentions || 0
  if (totalMentions === 0) return false

  const ratio = report.hallucinations.length / totalMentions
  return report.hallucinations.length >= 2 && ratio >= 0.35
}

// 高风险时输出可核验摘要，确保回答最终可落地。
function buildConservativeCorrection(executorResult, report) {
  const results = executorResult?.results || {}
  const topPois = Array.isArray(results.pois) ? results.pois.slice(0, 5) : []
  const stats = results.stats || {}

  const lines = [
    '',
    '---',
    '⚠️ **一致性校验提醒**：上文存在疑似未命中证据的地点表述，以下为可核验摘要。'
  ]

  if (topPois.length > 0) {
    lines.push('**可核验 POI（Top 5）**：')
    topPois.forEach((poi, idx) => {
      const category = poi.category || poi.type || '未知类别'
      lines.push(`${idx + 1}. ${poi.name || '未命名 POI'}（${category}）`)
    })
  } else {
    lines.push('当前结果中暂无可直接核验的 POI 明细。')
  }

  if (Number.isFinite(stats.total_candidates)) {
    lines.push(`- 候选量: ${stats.total_candidates}`)
  }
  if (Number.isFinite(stats.execution_time_ms)) {
    lines.push(`- 计算耗时: ${stats.execution_time_ms}ms`)
  }
  if (report?.hallucinations?.length) {
    lines.push(`- 待核验实体: ${report.hallucinations.join('、')}`)
  }

  return lines.join('\n')
}

/**
 * 构建精简的结果上下文（供 LLM 使用）
 * 
 * 这是关键的 Token 控制点：
 * - 只传必要信息
 * - 使用紧凑格式
 * - 限制 POI 数量
 * 
 * @param {Object} executorResult - Executor 输出
 * @returns {string} 格式化的上下文字符串
 */
function buildResultContext(executorResult, options = {}) {
  const { results } = executorResult
  if (!results) return '⚠️ 无可用数据'

  const writerProfile = options?.writerProfile || resolveWriterProfile(executorResult, options)
  const sections = []

  const sourcePolicy = options?.sourcePolicy
  if (sourcePolicy) {
    const categorySourceMap = {
      ui_selector: 'UI category selector',
      all_categories: 'all categories within boundary',
      planner: 'query intent categories',
      planner_only: 'query intent categories'
    }

    const geometrySourceMap = {
      custom_area: 'custom drawn/uploaded region',
      viewport_fallback: 'current viewport'
    }

    const selectedCategories = Array.isArray(sourcePolicy.selected_categories)
      ? sourcePolicy.selected_categories
      : []

    const sourceText = categorySourceMap[sourcePolicy.category_source] || 'query intent categories'
    const geometryText = geometrySourceMap[sourcePolicy.geometry_source] || 'current viewport'
    const categoryDetail = selectedCategories.length > 0
      ? selectedCategories.join(', ')
      : 'all categories'

    sections.push(`**Data Scope**\n- Geometry source: ${geometryText}\n- Category source: ${sourceText}\n- Category filter: ${categoryDetail}`)
  }
  
  // 0. 执行错误/异常提示
  if (results.execution_failure || results.error_message) {
    sections.push(`⚠️ **查询执行遇到问题**: ${results.error_message || '无法获取位置信息'}`)
    // 如果是严重错误，可能不需要展示其他空数据，但为了上下文完整，我们继续
  }
  
  // 1. 锚点信息
  if (results.anchor) {
    const lon = typeof results.anchor.lon === 'number' ? results.anchor.lon.toFixed(5) : 'Unknown';
    const lat = typeof results.anchor.lat === 'number' ? results.anchor.lat.toFixed(5) : 'Unknown';
    sections.push(`🎯 **参考位置**: ${results.anchor.name || '未知位置'} (${lon}, ${lat})`)
  }
  
  // 2. 区域画像
  if (results.area_profile && results.area_profile.total_count > 0) {
    const profile = results.area_profile
    let profileText = `📊 **区域概览** (共 ${profile.total_count} 个 POI)\n\n`
    
    if (profile.dominant_categories?.length > 0) {
      profileText += '**主要类别分布**:\n'
      profile.dominant_categories.forEach(cat => {
        const examples = cat.examples?.length > 0 ? `，如 ${cat.examples.join('、')}` : ''
        const rating = cat.avg_rating ? `，平均评分 ${cat.avg_rating}` : ''
        profileText += `- ${cat.category}: ${cat.count} 个 (${cat.percentage}%)${rating}${examples}\n`
      })
    }
    
    if (profile.rare_categories?.length > 0) {
      profileText += '\n**稀缺类别**:\n'
      profile.rare_categories.forEach(cat => {
        profileText += `- ${cat.category}: 仅 ${cat.count} 个\n`
      })
    }
    
    sections.push(profileText)
  }
  
  // 1.5. 多选区对比模式
  if (results.mode === 'region_comparison' && results.comparison) {
    const { comparison, region_analyses } = results
    
    let comparisonText = `📊 **多选区对比分析报告**\n`
    comparisonText += `对比对象: ${comparison.regions_compared.join(' vs ')}\n`
    comparisonText += `样本总量: ${comparison.total_pois_compared} POI\n\n`
    
    // 摘要部分
    comparisonText += `**自动生成摘要**:\n`
    comparisonText += comparison.summary + '\n\n'
    
    // 差异分析
    if (comparison.differences?.length > 0) {
      comparisonText += `**核心差异**:\n`
      comparison.differences.forEach(d => {
        comparisonText += `- **${d.dimension}**: ${d.description} (差距 ${d.gap})\n`
      })
      comparisonText += '\n'
    }
    
    // 相似性分析
    if (comparison.similarities?.length > 0) {
      comparisonText += `**共性特征**:\n`
      comparison.similarities.forEach(s => {
        comparisonText += `- **${s.dimension}**: ${s.description}\n`
      })
      comparisonText += '\n'
    }
    
    // 各选区详情
    comparisonText += `**各选区详细画像**:\n`
    region_analyses.forEach(r => {
      comparisonText += `\n### ${r.name} (${r.poi_count} POI)\n`
      
      // Top 业态
      if (r.top_categories?.length > 0) {
        comparisonText += `- **主要业态**: ${r.top_categories.slice(0, 5).map(c => `${c.name}(${c.ratio})`).join(', ')}\n`
      }
      
      // Top 大类
      if (r.top_major_categories?.length > 0) {
        comparisonText += `- **宏观结构**: ${r.top_major_categories.map(c => `${c.name}(${c.ratio})`).join(', ')}\n`
      }
    })
    
    sections.push(comparisonText)
    const comparisonContext = sections.join('\n\n')
    return trimContextText(comparisonContext, writerProfile.maxContextChars)
  }

  // 3. 空间分布 (H3 聚合)
  if (results.spatial_analysis?.grids?.length > 0) {
    const { grids, resolution } = results.spatial_analysis
    let spatialText = `🗺️ **空间分布分析**:\n`
    
    // 列出 Top 网格 (简化格式)
    spatialText += '\n**热点区域**:\n'
    grids.forEach((g, i) => {
      // g: { id, c (count), m (main_cat), p (rep_poi), r (ratio) }
      if (i < 5) { // 只列出前 5 个
         spatialText += `- 热区 ${i+1}: ${g.p || '未命名'} 附近，主导业态: ${g.m}\n`
      }
    })
    
    sections.push(spatialText)
  }
  
  // 4. 代表性地标 (不显示距离)
  if (results.landmarks?.length > 0) {
    let landmarkText = '🏛️ **区域内代表性 POI** (共 ' + results.landmarks.length + ' 个):\n'
    results.landmarks.forEach((l, idx) => {
      landmarkText += `${idx + 1}. **${l.name}** [${l.type}]\n`
    })
    sections.push(landmarkText)
  }
  
  // 5. 空间聚类热点区域
  if (results.spatial_clusters?.hotspots?.length > 0) {
    let hotspotText = '🔥 **识别的热点区域**:\n'
    results.spatial_clusters.hotspots.forEach((h, i) => {
      hotspotText += `\n**热点 ${i + 1}**: `;
      if (h.dominantCategories && h.dominantCategories.length > 0) {
        hotspotText += `${h.dominantCategories[0].category}聚集区 `;
      }
      hotspotText += `(密度: ${Math.round(h.density * 100) / 100}, 包含 ${h.poiCount} 个POI)\n`;
      if (h.center) {
        hotspotText += `- 中心位置: ${h.center.lat?.toFixed(4)}, ${h.center.lon?.toFixed(4)}\n`;
      }
    });
    sections.push(hotspotText);
  }
  
  // 6. 语义模糊区域（Vernacular Regions）
  if (results.vernacular_regions?.length > 0) {
    let regionText = '📍 **语义功能区识别**:\n';
    results.vernacular_regions.forEach(vr => {
      if (vr.regions && vr.regions.length > 0) {
        regionText += `\n**${vr.category}功能区**:\n`;
        vr.regions.forEach((r, i) => {
          regionText += `- 子区域 ${i + 1}: 置信度 ${Math.round(r.confidence * 100)}%, 包含 ${r.poiCount} 个POI\n`;
        });
      }
    });
    sections.push(regionText);
  }

  // 7. 模糊区域 (Fuzzy Regions) - Narrative Mode 专用
  if (results.fuzzy_regions?.length > 0) {
    let fuzzyText = '🌌 **检测到的模糊区域 (用于 Narrative 引导)**:\n';
    results.fuzzy_regions.forEach((fr, i) => {
      // fr: { id, theme, pointCount, dominantCategories: [{category, count}] }
      const domCats = fr.dominantCategories?.map(c => c.category).join('、') || '综合';
      const centerStr = fr.center ? `(${fr.center.lat.toFixed(4)}, ${fr.center.lon.toFixed(4)})` : '';
      fuzzyText += `- **[ID: ${fr.id}]** 主题: ${fr.theme} | 主导: ${domCats} | 规模: ${fr.pointCount} POI ${centerStr}\n`;
    });
    fuzzyText += '\n> 提示：请在 narrative_flow 中优先使用上述 [ID] 作为 focus 目标。\n';
    sections.push(fuzzyText);
  }
  
  // 4. POI 列表（核心数据）- 仅当不是纯区域分析时显示
  const skipPoiList = results.stats?.skip_poi_search === true
  
  if (!skipPoiList && results.pois?.length > 0) {
    const poiDisplayLimit = writerProfile.poiDisplayLimit
    const displayPOIs = results.pois.slice(0, poiDisplayLimit)

    let poiText = `📍 **检索结果** (${results.pois.length} 条${results.pois.length > poiDisplayLimit ? `，显示前 ${poiDisplayLimit} 条` : ''}):\n\n`
    
    // Phase 2 优化：Grounded Generation - 为每个 POI 添加可追溯 ID
    displayPOIs.forEach((poi, i) => {
      const dist = poi.distance_m > 0 ? `${poi.distance_m}m` : ''
      const info = [poi.category, dist].filter(Boolean).join(' | ')
      // 添加 ID 标记，供 LLM 引用
      const poiId = poi.id || poi.poiid || `poi_${i + 1}`
      poiText += `${i + 1}. **${poi.name}** [ID:${poiId}] [${info}]\n`
    })
    
    sections.push(poiText)
  } else if (!skipPoiList && (!results.pois || results.pois.length === 0)) {
    // Phase 3 优化：处理拓展搜索结果
    if (results.expansion_suggestion?.hasMessage) {
      // 有拓展建议，生成更智能的反问
      const messages = results.expansion_suggestion.messages || []
      let expansionText = ''
      
      messages.forEach(msg => {
        if (msg.type === 'not_found') {
          expansionText += `${msg.text}\n\n`
          if (msg.suggestions?.length > 0) {
            expansionText += '**您可以尝试：**\n'
            msg.suggestions.forEach((sug, i) => {
              expansionText += `${i + 1}. ${sug.text}\n`
            })
          }
        } else if (msg.type === 'info') {
          expansionText += `${msg.text}\n`
        }
      })
      
      sections.push(expansionText || '⚠️ 未检索到符合条件的 POI 数据。')
    } else if (results.stats?.expansion_applied) {
      // 拓展成功但这里不应该进入（有POI时不会到这个分支）
      sections.push('⚠️ 未检索到符合条件的 POI 数据。')
    } else {
      // 普通的空结果
      sections.push('⚠️ 未检索到符合条件的 POI 数据。')
    }
  }
  
  // Phase 3 优化：如果拓展搜索成功应用，添加说明
  if (results.stats?.expansion_applied && results.pois?.length > 0) {
    let expansionNote = '\n> 💡 *'
    
    if (results.stats.expansion_applied === 'expand_radius') {
      expansionNote += `在原始 ${results.stats.original_radius}m 范围内未找到结果，已自动扩展搜索范围*`
    } else if (results.stats.expansion_applied === 'generalize_category') {
      expansionNote += `未找到"${results.stats.original_categories?.join('、')}"，已扩展搜索至相关类别*`
    } else if (results.stats.expansion_applied === 'expand_both') {
      expansionNote += `已扩大搜索范围并放宽类别限制*`
    } else {
      expansionNote += `${results.stats.expansion_description || '已应用智能拓展搜索'}*`
    }
    
    sections.push(expansionNote)
  }
  // 纯区域分析模式下不显示 POI 列表，只展示区域画像
  
  // 5. 图结构分析 (Graph Analysis)
  if (results.graph_analysis && !results.graph_analysis.error) {
    const ga = results.graph_analysis
    let graphText = '🔗 **空间网络结构分析**:\n\n'
    
    // 全局统计
    if (ga.global) {
      graphText += `> 覆盖 ${ga.global.totalGrids} 个空间单元，形成 ${ga.global.totalConnections} 个连接关系，平均连通度 ${ga.global.avgConnectivity}\n\n`
    }
    
    // 枢纽节点
    if (ga.hubs?.length > 0) {
      graphText += '**核心枢纽区域** (高中心性节点):\n'
      ga.hubs.slice(0, 3).forEach((hub, i) => {
        graphText += `${i + 1}. 「${hub.representativePOI}」区域 - ${hub.mainCategory}聚集地，辐射强度 ${(hub.pageRank * 100).toFixed(0)}%\n`
      })
      graphText += '\n'
    }
    
    // 桥梁节点
    if (ga.bridges?.length > 0 && ga.bridges[0].betweenness > 0.3) {
      graphText += '**功能连接点** (桥梁节点):\n'
      ga.bridges.slice(0, 2).forEach((bridge, i) => {
        graphText += `- 「${bridge.representativePOI}」附近 - 连接度 ${(bridge.betweenness * 100).toFixed(0)}%，起到功能衔接作用\n`
      })
      graphText += '\n'
    }
    
    // 社区结构
    if (ga.communities?.length > 0) {
      graphText += '**业态功能区块**:\n'
      ga.communities.slice(0, 4).forEach((comm, i) => {
        graphText += `- 区块 ${i + 1}: 以「${comm.dominantCategory}」为主 (${comm.categoryRatio}%)，覆盖 ${comm.gridCount} 个网格\n`
      })
      graphText += '\n'
    }
    
    // 洞察
    if (ga.insights?.length > 0) {
      graphText += '**网络拓扑洞察**:\n'
      ga.insights.forEach(insight => {
        graphText += `- ${insight.text}\n`
      })
    }
    
    sections.push(graphText)
  }
  
  // 6. 执行统计（简化）
  if (results.stats) {
    const stats = results.stats
    let statsText = '\n---\n📈 '
    const statParts = []
    
    if (stats.total_candidates) {
      statParts.push(`候选 ${stats.total_candidates} 个`)
    }
    if (stats.semantic_rerank_applied) {
      statParts.push('已应用语义排序')
    }
    if (stats.execution_time_ms) {
      statParts.push(`耗时 ${stats.execution_time_ms}ms`)
    }
    
    if (statParts.length > 0) {
      statsText += statParts.join(' | ')
      sections.push(statsText)
    }
  }
  
  const rawContext = sections.join('\n\n')
  return trimContextText(rawContext, writerProfile.maxContextChars)
}

/**
 * 阶段 3 主入口：生成回答（流式）
 * 
 * @param {string} userQuestion - 用户原始问题
 * @param {Object} executorResult - Executor 输出
 * @param {Object} options - 选项
 * @yields {string} 流式文本块
 */
export async function* generateAnswer(userQuestion, executorResult, options = {}) {
  const startTime = Date.now()
  
  console.log('[Writer] 开始生成回答')
  
  const writerProfile = resolveWriterProfile(executorResult, options)

  // 构建精简上下文
  const resultContext = buildResultContext(executorResult, {
    ...options,
    writerProfile
  })
  const systemPrompt = WRITER_SYSTEM_PROMPT.replace('{result_context}', resultContext)
  
  // 检查是否需要澄清
  const queryPlan = executorResult.results?.query_executed
  if (queryPlan?.query_type === 'clarification_needed' && queryPlan?.clarification_question) {
    yield queryPlan.clarification_question
    return
  }
  
  try {
    // 获取 LLM 配置（自动选择本地或云端）
    const { baseUrl, model, apiKey, isLocal } = await getLLMConfig()
    
    console.log(`[Writer] 使用 ${isLocal ? '本地' : '云端'} 模型: ${model} | q=${writerProfile.queryType} | quality=${writerProfile.qualityMode}`)
    
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
          temperature: writerProfile.temperature,
          max_tokens: writerProfile.maxTokens,
          stream: true,
        }),
      })
    
    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
    }
    
    // 流式输出
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let totalTokens = 0
    let streamedOutput = ''
    
    // 过滤 <think> 标签的状态机
    let inThinkTag = false
    let pendingContent = ''
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      buffer += decoder.decode(value, { stream: true })
      
      // 按行解析 SSE
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        
        try {
          const parsed = JSON.parse(data)
          let content = parsed.choices?.[0]?.delta?.content || ''
          
          if (content) {
            // 处理 <think> 标签
            pendingContent += content
            
            // 检查是否进入/退出 think 标签
            if (pendingContent.includes('<think>')) {
              inThinkTag = true
              pendingContent = pendingContent.replace(/<think>/g, '')
            }
            
            if (pendingContent.includes('</think>')) {
              inThinkTag = false
              // 移除 think 标签及其内容
              pendingContent = pendingContent.replace(/[\s\S]*?<\/think>/g, '')
            }
            
            // 如果不在 think 标签内，输出内容
            if (!inThinkTag && pendingContent) {
              yield pendingContent
              streamedOutput += pendingContent
              totalTokens += pendingContent.length
              pendingContent = ''
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
    
    // 输出剩余内容
    if (pendingContent && !inThinkTag) {
      yield pendingContent
      streamedOutput += pendingContent
    }
    
    const validation = validateWriterOutput(streamedOutput, executorResult, {
      autoClean: false,
      addWarning: false
    })

    if (typeof options.onWriterDiagnostics === 'function') {
      options.onWriterDiagnostics({
        query_type: writerProfile.queryType,
        quality_mode: writerProfile.qualityMode,
        hallucination: validation.hallucinationReport
      })
    }

    if (shouldAppendCorrection(validation.hallucinationReport)) {
      const correction = buildConservativeCorrection(executorResult, validation.hallucinationReport)
      yield correction
      streamedOutput += correction
      totalTokens += correction.length
    }

    const duration = Date.now() - startTime
    
    // 估算 token 消耗（中文约 1.5 字符/token，英文约 4 字符/token）
    const estimatedPromptTokens = Math.ceil(systemPrompt.length / 1.5) + Math.ceil(userQuestion.length / 1.5)
    const estimatedCompletionTokens = Math.ceil(totalTokens / 1.5)
    
    // 返回 token 使用统计（通过特殊标记，由调用方捕获）
    // 注意：这不会被 yield 到用户，仅用于内部统计
    const tokenUsage = {
      prompt_tokens: estimatedPromptTokens,
      completion_tokens: estimatedCompletionTokens,
      total_tokens: estimatedPromptTokens + estimatedCompletionTokens
    }
    
    console.log(`[Writer] 完成 (${duration}ms, ~${totalTokens} chars, est. ${tokenUsage.total_tokens} tokens)`)
    
    // 通过 options.onTokenUsage 回调传递 token 统计
    if (options.onTokenUsage && typeof options.onTokenUsage === 'function') {
      options.onTokenUsage(tokenUsage)
    }
    
  } catch (err) {
    console.error('[Writer] 生成失败:', err.message)
    yield `\n\n⚠️ 生成回答时出错: ${err.message}`
  }
}

/**
 * 非流式生成回答（用于测试或批量场景）
 * 
 * @param {string} userQuestion - 用户问题
 * @param {Object} executorResult - Executor 输出
 * @returns {Promise<string>} 完整回答
 */
export async function generateAnswerSync(userQuestion, executorResult) {
  let fullContent = ''
  
  for await (const chunk of generateAnswer(userQuestion, executorResult)) {
    fullContent += chunk
  }
  
  return fullContent
}

/**
 * 构建快速回复（不调用 LLM，用于简单场景）
 * 
 * @param {Object} executorResult - Executor 输出
 * @returns {string} 快速回复
 */
export function buildQuickReply(executorResult) {
  const { results } = executorResult
  
  if (!results) {
    return '抱歉，查询过程中出现问题，请稍后重试。'
  }
  
  if (results.error) {
    return `查询失败: ${results.error}`
  }
  
  if (results.execution_failure || results.error_message) {
    return `⚠️ ${results.error_message || '无法获取位置信息'}`
  }
  
  if (!results.pois || results.pois.length === 0) {
    if (results.anchor) {
      return `在 ${results.anchor.name} 附近未找到符合条件的 POI。`
    }
    return '未找到符合条件的 POI，请尝试调整搜索条件。'
  }
  
  // 简单列表回复
  let reply = ''
  
  if (results.anchor) {
    reply += `在 **${results.anchor.name}** 附近找到 ${results.pois.length} 个结果：\n\n`
  } else {
    reply += `找到 ${results.pois.length} 个结果：\n\n`
  }
  
  reply += '| 名称 | 类别 | 距离 | 评分 |\n'
  reply += '|------|------|------|------|\n'
  
  results.pois.slice(0, 10).forEach(poi => {
    const dist = poi.distance_m > 0 ? `${poi.distance_m}m` : '-'
    const rating = poi.rating ? poi.rating.toFixed(1) : '-'
    reply += `| ${poi.name} | ${poi.category} | ${dist} | ${rating} |\n`
  })
  
  return reply
}

export default {
  generateAnswer,
  generateAnswerSync,
  buildQuickReply,
  buildResultContext,
  detectHallucinations,
  validateWriterOutput
}

// =====================================================
// Phase 1 优化：幻觉检测
// =====================================================

/**
 * 从 Writer 输出中提取提及的 POI 名称
 * 
 * @param {string} writerOutput - Writer 生成的文本
 * @returns {string[]} 提及的 POI 名称列表
 */
function extractMentionedPOIs(writerOutput) {
  if (!writerOutput) return []
  
  const mentioned = []
  
  // 模式 1: 「xxx」格式（中文书名号）
  const pattern1 = /「([^」]+)」/g
  let match
  while ((match = pattern1.exec(writerOutput)) !== null) {
    mentioned.push(match[1])
  }
  
  // 模式 2: **xxx** 格式（加粗）
  const pattern2 = /\*\*([^*]+)\*\*/g
  while ((match = pattern2.exec(writerOutput)) !== null) {
    // 排除一些常见的非 POI 短语
    const text = match[1]
    if (text.length > 2 && text.length < 30 && 
        !text.includes('区域') && !text.includes('分析') && 
        !text.includes('建议') && !text.includes('总结')) {
      mentioned.push(text)
    }
  }
  
  // 模式 3: [ID:xxx] 格式（Grounded Output）
  const pattern3 = /\[ID:([^\]]+)\]/g
  while ((match = pattern3.exec(writerOutput)) !== null) {
    mentioned.push(`ID:${match[1]}`)
  }
  
  // 去重
  return [...new Set(mentioned)]
}

/**
 * 检测 Writer 输出中的幻觉
 * 
 * 幻觉定义：提及了 Executor 结果中不存在的 POI
 * 
 * @param {string} writerOutput - Writer 生成的文本
 * @param {Object} executorResult - Executor 输出
 * @returns {Object} { hasHallucination: boolean, hallucinations: string[], validMentions: string[] }
 */
export function detectHallucinations(writerOutput, executorResult) {
  const result = {
    hasHallucination: false,
    hallucinations: [],
    validMentions: [],
    totalMentions: 0
  }
  
  if (!writerOutput || !executorResult?.results) {
    return result
  }
  
  // 提取 Writer 提及的 POI
  const mentionedPOIs = extractMentionedPOIs(writerOutput)
  result.totalMentions = mentionedPOIs.length
  
  if (mentionedPOIs.length === 0) {
    return result
  }
  
  // 构建有效 POI 名称集合
  const validNames = new Set()
  const validIds = new Set()
  
  // 从 pois 中提取
  if (executorResult.results.pois) {
    executorResult.results.pois.forEach(poi => {
      if (poi.name) validNames.add(poi.name.toLowerCase())
      if (poi.id) validIds.add(String(poi.id))
    })
  }
  
  // 从 landmarks 中提取
  if (executorResult.results.landmarks) {
    executorResult.results.landmarks.forEach(lm => {
      if (lm.name) validNames.add(lm.name.toLowerCase())
    })
  }
  
  // 从 graph_analysis.hubs 中提取
  if (executorResult.results.graph_analysis?.hubs) {
    executorResult.results.graph_analysis.hubs.forEach(hub => {
      if (hub.representativePOI) validNames.add(hub.representativePOI.toLowerCase())
    })
  }
  
  // 从 area_profile.dominant_categories 中提取示例
  if (executorResult.results.area_profile?.dominant_categories) {
    executorResult.results.area_profile.dominant_categories.forEach(cat => {
      if (cat.examples) {
        cat.examples.forEach(ex => validNames.add(ex.toLowerCase()))
      }
    })
  }
  
  // 检查每个提及的 POI
  mentionedPOIs.forEach(mention => {
    const mentionLower = mention.toLowerCase()
    
    // 检查是否为 ID 引用
    if (mention.startsWith('ID:')) {
      const id = mention.slice(3)
      if (validIds.has(id)) {
        result.validMentions.push(mention)
      } else {
        result.hallucinations.push(mention)
      }
      return
    }
    
    // 检查是否存在（模糊匹配）
    let found = false
    for (const validName of validNames) {
      // 完全匹配
      if (validName === mentionLower) {
        found = true
        break
      }
      // 包含关系（如 "武汉大学" 包含 "武大"）
      if (validName.includes(mentionLower) || mentionLower.includes(validName)) {
        found = true
        break
      }
    }
    
    if (found) {
      result.validMentions.push(mention)
    } else {
      // 可能是幻觉，但也可能是通用描述词
      // 排除一些常见的非 POI 词
      const commonWords = ['附近', '区域', '中心', '广场', '商业', '餐饮', '交通']
      if (!commonWords.some(w => mentionLower.includes(w))) {
        result.hallucinations.push(mention)
      }
    }
  })
  
  result.hasHallucination = result.hallucinations.length > 0
  
  if (result.hasHallucination) {
    console.warn(`[Writer] 检测到疑似幻觉 (${result.hallucinations.length} 处):`, result.hallucinations)
  }
  
  return result
}

/**
 * 验证并清理 Writer 输出
 * 
 * @param {string} writerOutput - Writer 生成的文本
 * @param {Object} executorResult - Executor 输出
 * @param {Object} options - 选项
 * @returns {Object} { cleanedOutput: string, warnings: string[], hallucinationReport: Object }
 */
export function validateWriterOutput(writerOutput, executorResult, options = {}) {
  const { autoClean = false, addWarning = true } = options
  
  const hallucinationReport = detectHallucinations(writerOutput, executorResult)
  let cleanedOutput = writerOutput
  const warnings = []
  
  if (hallucinationReport.hasHallucination) {
    if (autoClean) {
      // 自动移除幻觉内容（简单实现：标记为待验证）
      hallucinationReport.hallucinations.forEach(h => {
        cleanedOutput = cleanedOutput.replace(
          new RegExp(`「${h}」|\\*\\*${h}\\*\\*`, 'g'),
          `~~${h}~~`
        )
      })
      warnings.push(`已标记 ${hallucinationReport.hallucinations.length} 处待验证内容`)
    } else if (addWarning) {
      warnings.push(`⚠️ 回答中可能包含未经验证的地点名称: ${hallucinationReport.hallucinations.join(', ')}`)
    }
  }
  
  return {
    cleanedOutput,
    warnings,
    hallucinationReport
  }
}
