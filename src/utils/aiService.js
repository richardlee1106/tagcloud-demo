/**
 * AI 服务模块 - 前端版本（调用后端 API）
 * 
 * 所有敏感配置已移至后端，此模块仅负责：
 * 1. 调用后端 API 接口
 * 2. 处理流式响应
 * 3. 提供前端需要的辅助函数
 */

// 后端 API 基础路径
// 后端 API 基础路径
import { API_BASE_URL } from '../config';
const API_BASE = `${API_BASE_URL}/api/ai`;

// 当前服务商信息（从后端获取）
let currentProvider = {
  online: false,
  provider: null,
  providerName: 'Unknown'
}

// 位置相关关键词（前端判断用，后端也会再次判断）
const LOCATION_KEYWORDS = [
  '距离', '最近', '附近', '周边', '临近', '相邻', '多远', '位置', '坐标',
  '公里', '米', '东', '西', '南', '北', '方向', '路线', '到达',
  '哪里', '在哪', '地址', '经纬度', '空间', '分布位置'
]

/**
 * 检测用户问题是否涉及位置/距离
 * @param {string} userMessage - 用户消息
 * @returns {boolean}
 */
export function isLocationRelatedQuery(userMessage) {
  if (!userMessage) return false
  return LOCATION_KEYWORDS.some(keyword => userMessage.includes(keyword))
}

/**
 * 根据名称查找 POI（支持模糊匹配）
 * @param {Array} features - POI 数组
 * @param {string} name - 要查找的名称
 * @returns {Object|null}
 */
export function findPOIByName(features, name) {
  if (!features || !name) return null
  
  // 精确匹配
  let found = features.find(f => {
    const poiName = f.properties?.['名称'] || f.properties?.name || ''
    return poiName === name
  })
  
  // 模糊匹配
  if (!found) {
    found = features.find(f => {
      const poiName = f.properties?.['名称'] || f.properties?.name || ''
      return poiName.includes(name) || name.includes(poiName)
    })
  }
  
  return found
}

/**
 * 计算两点间距离（Haversine 公式）
 * @param {Array} coord1 - [lon, lat]
 * @param {Array} coord2 - [lon, lat]
 * @returns {number} 距离（米）
 */
export function calculateDistance(coord1, coord2) {
  const R = 6371000 // 地球半径（米）
  const lat1 = coord1[1] * Math.PI / 180
  const lat2 = coord2[1] * Math.PI / 180
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  
  return R * c
}

/**
 * 格式化 POI 上下文（简化版，用于显示）
 * 实际处理已移至后端
 * @param {Array} features - GeoJSON Feature 数组
 * @param {string} userMessage - 用户消息
 * @returns {string}
 */
export function formatPOIContext(features, userMessage = '') {
  if (!features || features.length === 0) {
    return '当前没有选中任何 POI 数据。'
  }
  return `已选中 ${features.length} 个 POI 数据`
}

/**
 * 构建系统提示词（已移至后端，此函数仅为兼容性保留）
 * @param {string} poiContext - POI 上下文信息
 * @param {boolean} isLocationQuery - 是否为位置相关查询
 * @returns {string}
 */
export function buildSystemPrompt(poiContext, isLocationQuery = false) {
  // 实际 system prompt 在后端构建
  return ''
}

/**
 * 发送聊天请求（流式）- 调用后端 API
 * @param {Array} messages - 消息历史
 * @param {Function} onChunk - 每次收到新内容时的回调 (text: string) => void
 * @param {Object} options - 可选配置
 * @param {Array} poiFeatures - POI 数据（将发送到后端处理）
 * @returns {Promise<string>} 完整的 AI 回复
 */
/**
 * 发送聊天请求（流式）- 调用后端 API
 * @param {Array} messages - 消息历史
 * @param {Function} onChunk - 每次收到新内容时的回调 (text: string) => void
 * @param {Object} options - 可选配置
 * @param {Array} poiFeatures - POI 数据（将发送到后端处理）
 * @param {Function} onMeta - [新增] 接收元数据的回调 (type: string, data: any) => void
 * @returns {Promise<string>} 完整的 AI 回复
 */
export async function sendChatMessageStream(messages, onChunk, options = {}, poiFeatures = [], onMeta = null) {
  console.log('[AI Frontend] 调用后端 API，POI 数量:', poiFeatures.length)

  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages,
      poiFeatures,
      options
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI 请求失败: ${response.status} - ${error}`)
  }

  // 获取当前使用的服务商
  const provider = response.headers.get('X-AI-Provider')
  const providerName = response.headers.get('X-AI-Provider-Name')
  if (provider) {
    currentProvider.provider = provider
    currentProvider.providerName = providerName || (provider === 'local' ? 'Local LM Studio' : 'Cloud AI (GLM)')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''
  let currentEvent = null // 跟踪当前 SSE 事件类型

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue // 跳过空行

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }

      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          if (currentEvent === 'pois') {
             const pois = JSON.parse(data)
             console.log('[AI Frontend] 收到后端下发的 POI 数据:', pois.length)
             if (onMeta) onMeta('pois', pois)
             currentEvent = null
             continue
          }

          if (currentEvent === 'stage') {
             const stageData = JSON.parse(data)
             console.log('[AI Frontend] 收到阶段更新:', stageData.name)
             if (onMeta) onMeta('stage', stageData.name)
             currentEvent = null
             continue
          }

          if (currentEvent === 'boundary') {
             const boundary = JSON.parse(data)
             if (onMeta) onMeta('boundary', boundary)
             currentEvent = null
             continue
          }

          if (currentEvent === 'spatial_clusters') {
             const clusters = JSON.parse(data)
             if (onMeta) onMeta('spatial_clusters', clusters)
             currentEvent = null
             continue
          }

          if (currentEvent === 'vernacular_regions') {
             const regions = JSON.parse(data)
             if (onMeta) onMeta('vernacular_regions', regions)
             currentEvent = null
             continue
          }

          if (currentEvent === 'fuzzy_regions') {
             const fuzzy = JSON.parse(data)
             if (onMeta) onMeta('fuzzy_regions', fuzzy)
             currentEvent = null
             continue
          }

          if (currentEvent === 'progress') {
             const progress = JSON.parse(data)
             if (onMeta) onMeta('progress', progress)
             currentEvent = null
             continue
          }

          if (currentEvent === 'partial') {
             const partial = JSON.parse(data)
             if (onMeta) onMeta('partial', partial)
             currentEvent = null
             continue
          }

          if (currentEvent === 'refined_result') {
             const refined = JSON.parse(data)
             if (onMeta) onMeta('refined_result', refined)
             currentEvent = null
             continue
          }

          // 默认为 message chunk
          const parsed = JSON.parse(data)
          
          // 如果后端直接发的 { content: '...' } 格式 (index.js 修改后)
          if (parsed.content !== undefined) {
             const delta = parsed.content
             fullContent += delta
             onChunk(delta)
             continue
          }

          // 兼容 OpenAI 格式
          const choice = parsed.choices?.[0]
          const delta = choice?.delta?.content || choice?.text || ''
          
          if (delta) {
             fullContent += delta
             onChunk(delta)
          } else if (parsed.error) {
             console.error('[AI Stream Error]', parsed.error)
             onChunk(`\n[系统错误: ${parsed.error.message || '未知错误'}]\n`)
          }
        } catch (e) {
          console.warn('[AI Stream Parse Error]', e, line)
        }
        // 重置 event（通常 event 只对下一行 data 有效）
        currentEvent = null
      }
    }
  }

  fullContent = fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  return fullContent
}

/**
 * 发送聊天请求（非流式）- 兼容性保留
 * @param {Array} messages - 消息历史 [{role, content}, ...]
 * @param {Object} options - 可选配置
 * @returns {Promise<string>} AI 回复内容
 */
export async function sendChatMessage(messages, options = {}) {
  let result = ''
  await sendChatMessageStream(messages, (chunk) => {
    result += chunk
  }, options)
  return result
}

/**
 * 快速搜索（简单名词查询，绕过 LLM）
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 搜索选项
 * @returns {Promise<{ success: boolean, isComplex: boolean, pois: Array }>}
 */
export async function quickSearch(keyword, options = {}) {
  const { spatialContext, colorIndex = 0 } = options;
  const kw = keyword.trim();
  
  console.log(`[QuickSearch] 快速搜索: "${kw}"`);
  console.log(`[QuickSearch] 空间上下文:`, spatialContext);
  
  // 构建查询参数
  const params = new URLSearchParams({ q: kw, limit: '100' });
  
  // ========== 核心业务逻辑 ==========
  // 1. 有选区（多边形/圆形）→ 必须在选区内搜索
  // 2. 无选区 → 使用当前地图视野 (viewport) 作为边界
  // 3. 任何情况都必须有空间约束，不允许全库搜索
  
  let hasGeometry = false;
  
  // 优先级1: 用户绘制的多边形选区
  if (spatialContext?.boundary && spatialContext.boundary.length >= 3) {
    const points = spatialContext.boundary;
    const closedPoints = [...points];
    // 确保多边形闭合
    if (points[0][0] !== points[points.length-1][0] || points[0][1] !== points[points.length-1][1]) {
      closedPoints.push(points[0]);
    }
    const wktPoints = closedPoints.map(p => `${p[0]} ${p[1]}`).join(', ');
    params.set('geometry', `POLYGON((${wktPoints}))`);
    hasGeometry = true;
    console.log(`[QuickSearch] 使用多边形选区 (${points.length} 点)`);
  }
  // 优先级2: 地图视野 bbox
  else if (spatialContext?.viewport && Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) {
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport;
    // 将 bbox 转换为 WKT Polygon
    const bboxWkt = `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`;
    params.set('geometry', bboxWkt);
    hasGeometry = true;
    console.log(`[QuickSearch] 使用地图视野 bbox`);
  }
  
  // 添加中心点（用于距离排序）
  if (spatialContext?.center) {
    params.set('lat', spatialContext.center.lat);
    params.set('lon', spatialContext.center.lon);
  } else if (spatialContext?.viewport) {
    // 使用视野中心
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport;
    params.set('lat', ((minLat + maxLat) / 2).toString());
    params.set('lon', ((minLon + maxLon) / 2).toString());
  }
  
  // 如果没有空间约束，警告并返回空结果
  if (!hasGeometry) {
    console.warn(`[QuickSearch] 警告: 没有空间边界约束，拒绝执行全库搜索`);
    return {
      success: true,
      isComplex: false,
      pois: [],
      warning: '请先绘制选区或确保地图视野有效'
    };
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/search/quick?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`搜索失败: ${response.status}`);
    }
    
    const data = await response.json();
    
    // 如果后端判断是复杂查询，返回标记
    if (data.isComplex) {
      return {
        success: true,
        isComplex: true,
        pois: []
      };
    }
    
    // 设置颜色索引
    const pois = (data.pois || []).map(poi => {
      if (poi.properties) {
        poi.properties._groupIndex = colorIndex;
      }
      return poi;
    });
    
    console.log(`[QuickSearch] 快速搜索完成: ${pois.length} 条, ${data.duration_ms}ms`);
    
    return {
      success: true,
      isComplex: false,
      expandedTerms: data.expandedTerms,
      pois
    };
  } catch (err) {
    console.error('[QuickSearch] 错误:', err);
    return {
      success: false,
      isComplex: false,
      error: err.message,
      pois: []
    };
  }
}

/**
 * 智能语义搜索 - 自动路由到快速搜索或 RAG Pipeline
 * @param {string} keyword - 用户搜索关键词
 * @param {Array} features - (已弃用，保留参数兼容性)
 * @param {Object} options - 可选配置 { spatialContext: ..., colorIndex: ... }
 * @returns {Promise<{ pois: Array, isComplex: boolean, needsAiAssistant: boolean }>}
 */
export async function semanticSearch(keyword, features = [], options = {}) {
  if (!keyword || !keyword.trim()) {
    return { pois: [], isComplex: false, needsAiAssistant: false };
  }

  const kw = keyword.trim();
  console.log(`[AI Search] 语义搜索: "${kw}"`);

  // 1. 先尝试快速搜索
  const quickResult = await quickSearch(kw, options);
  
  // 2. 如果后端判断是复杂查询，需要走 AI 助手
  if (quickResult.isComplex) {
    console.log(`[AI Search] 复杂查询，需要 AI 助手处理`);
    return {
      pois: [],
      isComplex: true,
      needsAiAssistant: true
    };
  }
  
  // 3. 快速搜索成功
  if (quickResult.success && quickResult.pois.length > 0) {
    return {
      pois: quickResult.pois,
      isComplex: false,
      needsAiAssistant: false,
      expandedTerms: quickResult.expandedTerms
    };
  }
  
  // 4. 快速搜索无结果，降级到 RAG Pipeline
  console.log(`[AI Search] 快速搜索无结果，尝试 RAG Pipeline`);
  
  let matchedPOIs = [];

  // 复用 RAG 管道进行搜索
  await sendChatMessageStream(
    [{ role: 'user', content: kw }],
    (chunk) => {
       // 忽略文本响应流，只关注结果
    }, 
    {
      ...options,
      isSearchOnly: true // 标记为纯搜索模式
    },
    [], // 不传前端 POI，强制走后端检索
    (type, data) => {
      if (type === 'pois' && Array.isArray(data)) {
         matchedPOIs = data;
      }
    }
  );

  console.log(`[AI Search] RAG 搜索完成，找到 ${matchedPOIs.length} 个结果`);
  
  // 转换为 GeoJSON Feature 格式 (如果后端返回的是 raw object)
  const pois = matchedPOIs.map(p => {
    // 如果已经是 Feature 结构就不动，否则包装一下
    if (p.type === 'Feature') {
        // 确保颜色正确
        if (!p.properties) p.properties = {};
        p.properties._groupIndex = options.colorIndex !== undefined ? options.colorIndex : 0;
        return p;
    }
    
    return {
       type: 'Feature',
       properties: {
          id: p.id,
          '名称': p.name,
          '小类': p.category,
          '地址': p.address,
          // 0 = 红色(默认), 4 = 紫色(AI推荐)
          _groupIndex: options.colorIndex !== undefined ? options.colorIndex : 0 
       },
       geometry: {
          type: 'Point',
          coordinates: [p.lon, p.lat]
       }
    };
  });
  
  return {
    pois,
    isComplex: false,
    needsAiAssistant: false
  };
}

/**
 * 检查 AI 服务可用性 - 调用后端 API
 * @returns {Promise<boolean>}
 */
export async function checkAIService() {
  try {
    const response = await fetch(`${API_BASE}/status`)
    if (!response.ok) {
      currentProvider.online = false
      return false
    }
    
    const data = await response.json()
    currentProvider = data
    console.log(`[AI] 服务状态: ${data.providerName} (${data.provider})`)
    return data.online
  } catch (e) {
    console.error('[AI] 服务检查失败:', e)
    currentProvider.online = false
    return false
  }
}

/**
 * 获取当前服务商信息
 */
export function getCurrentProviderInfo() {
  return {
    id: currentProvider.provider,
    name: currentProvider.providerName,
    apiBase: API_BASE,
    modelId: currentProvider.provider === 'local' ? 'qwen3-4b-instruct-2507' : 'mimo-v2-flash'
  }
}

/**
 * 获取可用模型列表 - 调用后端 API
 * @returns {Promise<Array>}
 */
export async function getAvailableModels() {
  try {
    const response = await fetch(`${API_BASE}/models`)
    if (!response.ok) return []
    const data = await response.json()
    return data.models || []
  } catch {
    return []
  }
}
