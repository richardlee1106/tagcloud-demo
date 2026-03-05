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
const WRITER_SYSTEM_PROMPT = `你是 GeoLoom 地理助手，帮用户看懂地图上的 POI 数据。
请只使用 {result_context} 中的结构化证据来回答。

## 语气要求
- 像一个熟悉本地的朋友在聊天，不要像写论文
- 用"这一带"、"周边"、"沿着…走"这样的口语化表达
- 避免出现"聚类"、"密度梯度"、"功能分区"、"置信度"等学术术语
- 如果数据中有知名地标（大学、公园、商圈、地铁站），优先提及，这些是用户的参照物

## 硬性规则
- 只基于证据回答，不编造 POI、数字或地名
- 仅当 mode=region_comparison 且有对比数据时才提多选区对比
- 不要提及 vernacular_regions 或 fuzzy_regions（这些是内部数据结构）
- 如果 source_policy.category_source 是 all_categories，说明分析覆盖了所有类别
- 如果 source_policy.category_source 是 ui_selector，说明只看了用户筛选的类别
- 当证据不足时，坦诚说明而不是硬凑内容
- 不要输出“Thinking Process”“思考过程”“分析步骤”或任何中间推理文本
- 只输出最终可读答案，不要展示草稿、迭代过程、提示词或自我对话

## 输出格式
1) 用 1-2 句话直接回答用户的问题
2) 然后用 2-3 个小节展开，每节用 **加粗标题**
3) 如果有实用建议，用 1-3 条要点，要具体可操作
4) 表格只在确实能帮助理解时使用（比如对比不同区域）
5) 总长度控制在 300-500 字，不要写太长
6) 用中文回答
`

const DEFAULT_WRITER_CONTEXT_LIMIT = 9000
const DEFAULT_WRITER_OUTPUT_LIMIT = 2200
const ENABLE_WRITER_CORRECTION = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.WRITER_APPEND_CORRECTION || 'false').trim().toLowerCase()
)

// /ΰȫתֹԤ쳣
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
function resolveWriterQueryType(executorResult, options = {}) {
  const rawType = executorResult?.results?.query_executed?.query_type
    || executorResult?.results?.query_executed?.task?.query_type
    || executorResult?.results?.stats?.query_type
    || executorResult?.query_plan?.query_type
    || executorResult?.query_plan?.task?.query_type
    || options?.queryType
    || options?.query_type
    || 'poi_search'
  return String(rawType || '').trim().toLowerCase() || 'poi_search'
}

function resolveWriterProfile(executorResult, options = {}) {
  const queryType = resolveWriterQueryType(executorResult, options)

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

// ֻƻþռȽϸʱ׷ӾƫشƵϡ
function shouldAppendCorrection(report) {
  if (!ENABLE_WRITER_CORRECTION) return false
  if (!report?.hasHallucination) return false
  const totalMentions = report.totalMentions || 0
  if (totalMentions === 0) return false

  const ratio = report.hallucinations.length / totalMentions
  return report.hallucinations.length >= 2 && ratio >= 0.35
}

function buildConservativeCorrection(executorResult, report) {
  const results = executorResult?.results || {}
  const topPois = Array.isArray(results.pois) ? results.pois.slice(0, 5) : []
  const stats = results.stats || {}

  const lines = [
    '',
    '---',
    'NOTICE: verification checklist'
  ]

  if (topPois.length > 0) {
    lines.push('Top 5 verifiable POIs:')
    topPois.forEach((poi, idx) => {
      const category = poi.category || poi.type || 'unknown'
      lines.push(`${idx + 1}. ${poi.name || 'unnamed POI'} (${category})`)
    })
  } else {
    lines.push('No directly verifiable POI details in current result.')
  }

  if (Number.isFinite(stats.total_candidates)) {
    lines.push(`- candidates: ${stats.total_candidates}`)
  }
  if (Number.isFinite(stats.execution_time_ms)) {
    lines.push(`- runtime: ${stats.execution_time_ms}ms`)
  }
  if (report?.hallucinations?.length) {
    lines.push(`- entities_to_verify: ${report.hallucinations.join(', ')}`)
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
    sections.push(`Execution Error: ${results.error_message || 'Unable to resolve spatial context.'}`)
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
      // 兼容 Python pipeline 格式 (dominantCategories) 和 Node 格式
      const domCats = h.dominantCategories || h.dominant_categories
      if (Array.isArray(domCats) && domCats.length > 0) {
        hotspotText += `${domCats[0].category}聚集区 `;
      }
      hotspotText += `(密度: ${Math.round(h.density * 100) / 100}, 包含 ${h.poiCount || h.poi_count || 0} 个POI)\n`;
      if (h.center) {
        hotspotText += `- 中心位置: ${h.center.lat?.toFixed(4)}, ${h.center.lon?.toFixed(4)}\n`;
      }
    });
    sections.push(hotspotText);
  }

  // 5.1 H3 空间聚合摘要 (Python pipeline 输出 spatial_clusters.h3_summary)
  const h3Cells = results.spatial_clusters?.h3_summary
  if (Array.isArray(h3Cells) && h3Cells.length > 0) {
    let h3Text = '🗺️ **空间网格聚合分析**:\n'
    h3Text += `共 ${h3Cells.length} 个活跃网格\n\n`
    h3Text += '**高密度网格 (Top 5)**:\n'
    h3Cells.slice(0, 5).forEach((cell, i) => {
      h3Text += `- 网格 ${i + 1}: ${cell.count} 个POI，主导业态: ${cell.dominant_category}\n`
    })
    sections.push(h3Text)
  }
  
  // 6. 语义功能区（Vernacular Regions）
  if (results.vernacular_regions?.length > 0) {
    let regionText = '📍 **语义功能区识别**:\n';
    results.vernacular_regions.forEach((vr, i) => {
      if (vr.regions && vr.regions.length > 0) {
        regionText += `\n**${vr.category}功能区**:\n`;
        vr.regions.forEach((r, ri) => {
          regionText += `- 子区域 ${ri + 1}: 置信度 ${Math.round(r.confidence * 100)}%, 包含 ${r.poiCount} 个POI\n`;
        });
      } else {
        const name = vr.name || `${vr.dominant_category || vr.theme || '综合'}区域`;
        const poiCount = vr.poi_count || vr.poiCount || 0;
        const membership = vr.membership;
        const score = membership?.score ?? vr.score;
        const level = membership?.level ?? vr.level ?? '';

        regionText += `\n**${name}** (${poiCount} POI)`;
        if (score !== undefined) {
          regionText += ` — 置信度 ${Math.round(score * 100)}%`;
        }
        if (level) {
          const levelMap = { core: '核心区', transition: '过渡区', periphery: '边缘区' };
          regionText += ` [${levelMap[level] || level}]`;
        }
        regionText += '\n';

        if (membership) {
          const factors = [];
          if (membership.density > 0.5) factors.push(`密度${(membership.density * 100).toFixed(0)}%`);
          if (membership.purity > 0.5) factors.push(`纯度${(membership.purity * 100).toFixed(0)}%`);
          if (membership.compactness > 0.5) factors.push(`紧凑度${(membership.compactness * 100).toFixed(0)}%`);
          if (factors.length > 0) {
            regionText += `  - 主要特征: ${factors.join(', ')}\n`;
          }
        }

        if (vr.center) {
          regionText += `  - 中心: ${vr.center.lat?.toFixed(4)}, ${vr.center.lon?.toFixed(4)}\n`;
        }
      }
    });
    sections.push(regionText);
  }

  // 7. 模糊区域 (Fuzzy Regions) - 仅 Narrative Mode 使用，主路由跳过
  // fuzzy_regions 数据仍通过 SSE 事件推送给前端 NarrativeMode.vue，
  // 但不注入 Writer prompt，避免干扰主路由的回答质量。
  
  // 4. POI 列表（核心数据）- 仅当不是纯区域分析时显示
  const skipPoiList = results.stats?.skip_poi_search === true
  
  if (!skipPoiList && results.pois?.length > 0) {
    const poiDisplayLimit = writerProfile.poiDisplayLimit
    const displayPOIs = results.pois.slice(0, poiDisplayLimit)

    let poiText = `📍 **检索结果** (${results.pois.length} 条${results.pois.length > poiDisplayLimit ? `，显示前 ${poiDisplayLimit} 条` : ''}):\n\n`
    
    // Phase 2 优化：Grounded Generation - 为每个 POI 添加可追溯 ID
    displayPOIs.forEach((poi, i) => {
      const dist = poi.distance_m > 0 ? `${poi.distance_m}m` : ''
      const cat = poi.category_small || poi.category_mid || poi.category_big || poi.category || poi.type || ''
      const info = [cat, dist].filter(Boolean).join(' | ')
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
  
  // 5.5 VLM 地图 OCR 提取的地名
  if (results.stats?.vlm_extracted_texts?.length > 0) {
    let ocrText = '👁️ **地图视觉分析 (OCR提取)**:\n'
    ocrText += `- 画面中识别到的地名/标志物: ${results.stats.vlm_extracted_texts.join('、')}\n`
    sections.push(ocrText)
  }

  // 5.6 空间推理（Phase 4A 双模型并行上下文）
  const anchorLandmarks = Array.isArray(results.stats?.vlm_anchor_landmarks)
    ? results.stats.vlm_anchor_landmarks
    : []
  const anchorAliases = Array.isArray(results.stats?.vlm_anchor_aliases)
    ? results.stats.vlm_anchor_aliases
    : []
  const spatialPriors = results.stats?.llm_spatial_priors && typeof results.stats.llm_spatial_priors === 'object'
    ? results.stats.llm_spatial_priors
    : {}
  const reasoningSummary = String(spatialPriors.summary || '').trim()
  const boostedCount = Number.isFinite(Number(results.stats?.anchor_boosted_poi_count))
    ? Number(results.stats.anchor_boosted_poi_count)
    : 0
  const injectedCount = Number.isFinite(Number(results.stats?.anchor_injected_poi_count))
    ? Number(results.stats.anchor_injected_poi_count)
    : 0

  if (anchorLandmarks.length > 0 || anchorAliases.length > 0 || reasoningSummary || boostedCount > 0 || injectedCount > 0) {
    let reasoningText = '🧠 **空间推理**:\n'
    if (anchorLandmarks.length > 0) {
      reasoningText += `- 视觉识别锚点: ${anchorLandmarks.join('、')}\n`
    }
    if (anchorAliases.length > 0) {
      reasoningText += `- 视觉别名补充: ${anchorAliases.join('、')}\n`
    }
    if (reasoningSummary) {
      reasoningText += `- 推理判断: ${reasoningSummary}\n`
    }
    if (boostedCount > 0 || injectedCount > 0) {
      reasoningText += `- 对边界/聚类的影响: 候选重排命中 ${boostedCount} 个，锚点补充 ${injectedCount} 个\n`
    }
    sections.push(reasoningText)
  }

  // 6. 执行统计（简化）
  if (results.stats) {
    const stats = results.stats
    let statsText = '\n---\n📈 '
    const statParts = []
    
    if (stats.total_candidates) {
      statParts.push(`候选 ${stats.total_candidates} 个`)
    }
    if (stats.cluster_count > 0) {
      statParts.push(`${stats.cluster_count} 个聚类`)
    }
    if (stats.h3_cell_count > 0) {
      statParts.push(`${stats.h3_cell_count} 个H3网格`)
    }
    if (stats.candidate_source) {
      statParts.push(`数据源: ${stats.candidate_source === 'db' ? 'PostGIS' : stats.candidate_source}`)
    }
    if (stats.direction_applied && stats.direction) {
      statParts.push(`方向过滤: ${stats.direction}`)
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

function normalizeStreamContentChunk(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((item) => normalizeStreamContentChunk(item)).join('')
  }
  if (!value || typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  if (Array.isArray(value.parts)) {
    return value.parts.map((item) => normalizeStreamContentChunk(item)).join('')
  }
  return ''
}

function stripThinkTags(text = '') {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()
}

function isLeadingReasoningTranscript(text = '') {
  const probe = String(text || '').trimStart()
  if (!probe) return false
  return /^(thinking process|thought process|reasoning process|思考过程|推理过程|分析过程|let'?s think)\s*[:：]?/i.test(probe)
}

function isReasoningHeadingOnly(text = '') {
  const probe = String(text || '').trimStart()
  if (!probe) return false
  return /^(\d+\.\s*)?\*{0,2}\s*(analyze the request|evaluate data|drafting content|final polish)\s*[:：]?/i.test(probe)
}

const REASONING_SECTION_MARKERS = [
  'analyze the request',
  'evaluate data',
  'evaluate data & constraints',
  'drafting content',
  'refining for tone',
  'final polish',
  'revised draft',
  'final plan'
]

function isReasoningTranscript(text = '') {
  const probe = String(text || '').trim()
  if (!probe) return false

  if (isLeadingReasoningTranscript(probe) || isReasoningHeadingOnly(probe)) {
    return true
  }

  const lowered = probe.toLowerCase()
  const markerHitCount = REASONING_SECTION_MARKERS.reduce(
    (count, marker) => (lowered.includes(marker) ? count + 1 : count),
    0
  )
  const hasReasoningLabel = /(thinking process|thought process|reasoning process|思考过程|推理过程|分析步骤)/i.test(probe)
  if (hasReasoningLabel && markerHitCount >= 1) return true
  return markerHitCount >= 3
}

function sanitizeRecoveredWriterOutput(text = '') {
  const cleaned = stripThinkTags(text)
  if (!cleaned) return ''
  if (isReasoningTranscript(cleaned)) {
    return ''
  }
  return cleaned
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
    let rawFallbackContent = ''
    
    // 过滤 <think> 标签的状态机
    // 策略：在 think 标签内的内容直接丢弃，不累积
    let inThinkTag = false
    let pendingContent = ''
    let suppressReasoningOutput = false
    
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
          const choice = parsed?.choices?.[0] || {}
          const delta = choice?.delta && typeof choice.delta === 'object' ? choice.delta : {}
          const content = normalizeStreamContentChunk(delta.content)
            || normalizeStreamContentChunk(choice?.message?.content)
            || normalizeStreamContentChunk(choice?.text)
            || normalizeStreamContentChunk(parsed?.output_text)
          const reasoningContent = normalizeStreamContentChunk(delta.reasoning_content)
            || normalizeStreamContentChunk(delta.text)
          
          if (content) {
            pendingContent += content
            rawFallbackContent += content
            
            // 循环处理可能存在多个 think 标签的情况
            let safety = 0
            while (safety++ < 20) {
              if (!inThinkTag) {
                // 当前在 think 外部
                const openIdx = pendingContent.indexOf('<think>')
                if (openIdx === -1) {
                  // 没有 <think>，全部输出
                  break
                }
                // 输出 <think> 之前的内容
                const beforeThink = pendingContent.slice(0, openIdx)
                if (beforeThink) {
                  const reasoningLike = !streamedOutput && isReasoningTranscript(beforeThink)
                  if (reasoningLike || suppressReasoningOutput) {
                    suppressReasoningOutput = true
                    rawFallbackContent += beforeThink
                  } else {
                    yield beforeThink
                    streamedOutput += beforeThink
                    totalTokens += beforeThink.length
                  }
                }
                // 进入 think 状态，丢弃 <think> 标签
                inThinkTag = true
                pendingContent = pendingContent.slice(openIdx + 7) // 7 = '<think>'.length
              } else {
                // 当前在 think 内部
                const closeIdx = pendingContent.indexOf('</think>')
                if (closeIdx === -1) {
                  // 还没看到闭合标签，保留末尾可能是 '</think>' 前缀的部分
                  const THINK_CLOSE = '</think>'
                  let keepTail = 0
                  for (let prefixLen = Math.min(pendingContent.length, THINK_CLOSE.length - 1); prefixLen >= 1; prefixLen--) {
                    if (pendingContent.endsWith(THINK_CLOSE.slice(0, prefixLen))) {
                      keepTail = prefixLen
                      break
                    }
                  }
                  pendingContent = keepTail > 0 ? pendingContent.slice(-keepTail) : ''
                  break
                }
                // 找到闭合标签，丢弃 think 内容和闭合标签
                inThinkTag = false
                pendingContent = pendingContent.slice(closeIdx + 8) // 8 = '</think>'.length
              }
            }
            
            // 输出 think 外部的剩余内容
            // 注意：保留可能是 '<think>' 不完整前缀的末尾，避免跨 chunk 标签被截断
            if (!inThinkTag && pendingContent) {
              const THINK_OPEN = '<think>'
              let holdBack = 0
              // 检查 pendingContent 末尾是否可能是 '<think>' 的前缀（如 '<', '<t', '<th', '<thi', '<thin', '<think'）
              for (let prefixLen = Math.min(pendingContent.length, THINK_OPEN.length - 1); prefixLen >= 1; prefixLen--) {
                if (pendingContent.endsWith(THINK_OPEN.slice(0, prefixLen))) {
                  holdBack = prefixLen
                  break
                }
              }
              const outputPart = holdBack > 0 ? pendingContent.slice(0, -holdBack) : pendingContent
              if (outputPart) {
                const reasoningLike = !streamedOutput && isReasoningTranscript(outputPart)
                if (reasoningLike || suppressReasoningOutput) {
                  suppressReasoningOutput = true
                  rawFallbackContent += outputPart
                } else {
                  yield outputPart
                  streamedOutput += outputPart
                  totalTokens += outputPart.length
                }
              }
              pendingContent = holdBack > 0 ? pendingContent.slice(-holdBack) : ''
            }
          } else if (reasoningContent) {
            // 忽略 reasoning_content，防止模型将中间推理回退到最终输出。
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
    
    // 输出剩余内容
    if (pendingContent && !inThinkTag) {
      const reasoningLike = !streamedOutput && isReasoningTranscript(pendingContent)
      if (reasoningLike || suppressReasoningOutput) {
        suppressReasoningOutput = true
        rawFallbackContent += pendingContent
      } else {
        yield pendingContent
        streamedOutput += pendingContent
        totalTokens += pendingContent.length
      }
    }

    if (!String(streamedOutput || '').trim()) {
      let recoveredOutput = ''
      try {
        const nonStreamResponse = await fetch(`${baseUrl}/chat/completions`, {
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
            stream: false
          })
        })

        if (nonStreamResponse.ok) {
          const nonStreamJson = await nonStreamResponse.json()
          const nonStreamChoice = nonStreamJson?.choices?.[0] || {}
          recoveredOutput = normalizeStreamContentChunk(nonStreamChoice?.message?.content)
            || normalizeStreamContentChunk(nonStreamChoice?.text)
            || normalizeStreamContentChunk(nonStreamJson?.output_text)
          recoveredOutput = sanitizeRecoveredWriterOutput(recoveredOutput)
        }
      } catch (fallbackErr) {
        console.warn(`[Writer] non-stream recovery failed: ${fallbackErr?.message || 'unknown'}`)
      }

      if (!recoveredOutput && rawFallbackContent) {
        recoveredOutput = sanitizeRecoveredWriterOutput(rawFallbackContent)
      }

      if (recoveredOutput) {
        yield recoveredOutput
        streamedOutput += recoveredOutput
        totalTokens += recoveredOutput.length
      }
    }
    
    const validation = validateWriterOutput(streamedOutput, executorResult, {
      autoClean: false,
      addWarning: false,
      enforceMarkdownContract: true
    })

    if (typeof options.onWriterDiagnostics === 'function') {
      options.onWriterDiagnostics({
        query_type: writerProfile.queryType,
        quality_mode: writerProfile.qualityMode,
        hallucination: validation.hallucinationReport,
        markdown_contract: validation.markdownContract
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
    
    if (totalTokens === 0) {
      console.warn(`[Writer] ⚠️ 输出为空！inThinkTag=${inThinkTag}, pendingContent.length=${pendingContent.length}, 可能模型整体输出被 <think> 包裹`)
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
    return '抱歉，查询出错了，请稍后再试。'
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
    const category = poi.category_small
      || poi.category_mid
      || poi.category_big
      || poi.category
      || poi.type
      || poi.properties?.category_small
      || poi.properties?.category_mid
      || poi.properties?.category_big
      || poi.properties?.category
      || poi.properties?.type
      || '未分类'
    reply += `| ${poi.name} | ${category} | ${dist} | ${rating} |\n`
  })
  
  return reply
}

export default {
  generateAnswer,
  generateAnswerSync,
  buildQuickReply,
  buildResultContext,
  detectHallucinations,
  normalizeMarkdownStructure,
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

  const descriptorKeywords = [
    '区域', '分析', '建议', '总结', '扎堆', '周边', '机会点', '联动', '群体', '热点',
    '核心', '特征', '主导', '活力', '片区', '业态', '可达性', '风险', '覆盖', '指数',
    '策略', '趋势', '结论', '模板'
  ]

  const isLikelyPoiMention = (text = '') => {
    const probe = String(text || '').trim()
    if (!probe) return false
    if (probe.length < 2 || probe.length > 40) return false
    if (/[：:]/.test(probe)) return false
    if (/[🌟💡⭐️🔥📍]/u.test(probe)) return false
    if (descriptorKeywords.some((keyword) => probe.includes(keyword))) return false
    return true
  }
  
  // 模式 1: 「xxx」格式（中文书名号）
  const pattern1 = /「([^」]+)」/g
  let match
  while ((match = pattern1.exec(writerOutput)) !== null) {
    if (isLikelyPoiMention(match[1])) {
      mentioned.push(match[1].trim())
    }
  }
  
  // 模式 2: **xxx** 格式（加粗）
  const pattern2 = /\*\*([^*]+)\*\*/g
  while ((match = pattern2.exec(writerOutput)) !== null) {
    const text = String(match[1] || '').trim()
    if (isLikelyPoiMention(text)) {
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
  const validCategories = new Set()

  const collectCategory = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return
    validCategories.add(normalized)
  }
  
  // 从 pois 中提取
  if (executorResult.results.pois) {
    executorResult.results.pois.forEach(poi => {
      if (poi.name) validNames.add(poi.name.toLowerCase())
      if (poi.id) validIds.add(String(poi.id))
      collectCategory(poi.category_small || poi.category_mid || poi.category_big || poi.category || poi.type)
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
      collectCategory(cat.category)
      if (cat.examples) {
        cat.examples.forEach(ex => validNames.add(ex.toLowerCase()))
      }
    })
  }

  const hotspotEntries = executorResult.results.spatial_clusters?.hotspots || []
  hotspotEntries.forEach((hotspot) => {
    const domCats = hotspot?.dominantCategories || hotspot?.dominant_categories || []
    if (Array.isArray(domCats)) {
      domCats.forEach((cat) => collectCategory(cat?.category || cat?.name))
    }
  })

  const descriptorWords = ['区域', '分析', '建议', '活动', '业态', '分布', '交通', '周边', '热点', '机会点', '特征', '核心', '联动', '群体']

  const shouldIgnorePotentialHallucination = (mentionLower = '') => {
    if (!mentionLower) return true
    if (descriptorWords.some((word) => mentionLower.includes(word))) return true
    if (validCategories.has(mentionLower)) return true
    for (const category of validCategories) {
      if (category && (mentionLower.includes(category) || category.includes(mentionLower))) {
        return true
      }
    }
    return false
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
      if (!shouldIgnorePotentialHallucination(mentionLower)) {
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

function detectMarkdownContractIssues(markdown = '') {
  const content = String(markdown || '')
  const issues = []
  if (/^\s*#{1,6}\s*\*+/m.test(content)) {
    issues.push('heading_prefix_asterisk')
  }
  if (/^\s*#{1,6}.*\*{2,}\s*$/m.test(content)) {
    issues.push('heading_suffix_asterisk')
  }
  if (/^\s*\*{3,}\s*\S+/m.test(content)) {
    issues.push('asterisk_heading_mixed')
  }
  return issues
}

function normalizeHeadingLine(line = '') {
  const raw = String(line || '')
  if (!raw.trim()) return ''

  const pureAsteriskHeadingMatch = raw.match(/^\s*\*{3,}\s*(.+?)\s*\*{0,}\s*$/)
  if (pureAsteriskHeadingMatch) {
    const title = String(pureAsteriskHeadingMatch[1] || '').replace(/^\*+|\*+$/g, '').trim()
    return title ? `### ${title}` : ''
  }

  const markdownHeadingMatch = raw.match(/^(\s*#{1,6})\s*(.+)$/)
  if (!markdownHeadingMatch) return raw

  const level = markdownHeadingMatch[1].trim()
  const cleanedTitle = String(markdownHeadingMatch[2] || '')
    .replace(/^\*+/, '')
    .replace(/\*+$/, '')
    .trim()

  return cleanedTitle ? `${level} ${cleanedTitle}` : `${level}`
}

export function normalizeMarkdownStructure(markdown = '') {
  const lines = String(markdown || '').split(/\r?\n/)
  const normalizedLines = lines.map((line) => normalizeHeadingLine(line))
  return normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
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
  const { autoClean = false, addWarning = true, enforceMarkdownContract = false } = options
  
  const hallucinationReport = detectHallucinations(writerOutput, executorResult)
  let cleanedOutput = writerOutput
  const warnings = []
  const markdownContract = {
    enabled: enforceMarkdownContract === true,
    normalized: false,
    issues: []
  }
  
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

  if (enforceMarkdownContract === true) {
    const issues = detectMarkdownContractIssues(cleanedOutput)
    const normalizedMarkdown = normalizeMarkdownStructure(cleanedOutput)
    const normalizedChanged = normalizedMarkdown !== cleanedOutput
    if (normalizedChanged) {
      cleanedOutput = normalizedMarkdown
    }
    if (issues.length > 0 && addWarning) {
      warnings.push('已对回答进行 Markdown 结构规范化处理。')
    }
    markdownContract.issues = issues
    markdownContract.normalized = normalizedChanged
  }
  
  return {
    cleanedOutput,
    warnings,
    hallucinationReport,
    markdownContract
  }
}
