/**
 * LLM 服务配置
 *
 * 支持本地 Ollama 和 LM Studio
 * 默认配置：qwen3.5-4b-reasoning @ runtime Ollama endpoint
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

import { getOllamaNativeBaseUrl, getOllamaOpenAIBaseUrl } from '../infra/ollamaRuntimeConfig.js'

// LLM 配置（本地 Ollama）
export const LLM_CONFIG = {
  ollama: {
    model: process.env.OLLAMA_MODEL || 'qwen3.5-4b-reasoning',
    reasoningModel: process.env.OLLAMA_REASONING_MODEL || 'qwen3.5-4b-reasoning',
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'bge-base-zh-v1.5',
  },
  lmstudio: {
    baseUrl: process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1',
    model: process.env.LMSTUDIO_MODEL || 'qwen3.5-0.8b',
    embeddingModel: process.env.LMSTUDIO_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5',
  },
  remote: {
    baseUrl: process.env.REMOTE_LLM_BASE_URL || '',
    apiKey: process.env.REMOTE_LLM_API_KEY || '',
    model: process.env.REMOTE_LLM_MODEL || '',
  },
  useOllama: process.env.USE_OLLAMA !== 'false',
};

/**
 * 检查 Ollama 服务是否可用
 */
async function checkOllamaAvailable() {
  try {
    const response = await fetch(`${getOllamaNativeBaseUrl()}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 获取当前 LLM 配置
 * 优先级：Ollama > LM Studio > Remote
 */
export async function getLLMConfig(options = {}) {
  const requestedModel = String(options?.model || '').trim() || null
  const requestedBaseUrl = String(options?.baseUrl || '').trim() || null
  const requestedApiKey = String(options?.apiKey || '').trim() || null

  if (requestedBaseUrl) {
    const fallbackModel = requestedModel
      || LLM_CONFIG.remote.model
      || LLM_CONFIG.ollama.model
      || LLM_CONFIG.lmstudio.model
    console.log('[LLM] Using custom base URL:', fallbackModel);
    return {
      baseUrl: requestedBaseUrl,
      model: fallbackModel,
      embeddingModel: LLM_CONFIG.ollama.embeddingModel,
      ...(requestedApiKey ? { apiKey: requestedApiKey } : {}),
      provider: 'custom',
    };
  }

  if (LLM_CONFIG.useOllama) {
    const available = await checkOllamaAvailable();
    if (available) {
      const model = requestedModel || LLM_CONFIG.ollama.model
      console.log('[LLM] Using Ollama:', model);
      return {
        baseUrl: process.env.OLLAMA_BASE_URL || getOllamaOpenAIBaseUrl(),
        model,
        embeddingModel: LLM_CONFIG.ollama.embeddingModel,
        provider: 'ollama',
      };
    }
    console.log('[LLM] Ollama not available, falling back to LM Studio');
  }

  try {
    const response = await fetch('http://127.0.0.1:1234/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const model = requestedModel || LLM_CONFIG.lmstudio.model
      console.log('[LLM] Using LM Studio:', model);
      return {
        baseUrl: LLM_CONFIG.lmstudio.baseUrl,
        model,
        embeddingModel: LLM_CONFIG.lmstudio.embeddingModel,
        provider: 'lmstudio',
      };
    }
  } catch {
    // LM Studio 不可用
  }

  if (LLM_CONFIG.remote.baseUrl) {
    const model = requestedModel || LLM_CONFIG.remote.model
    console.log('[LLM] Using remote API:', model);
    return {
      baseUrl: LLM_CONFIG.remote.baseUrl,
      model,
      apiKey: LLM_CONFIG.remote.apiKey,
      provider: 'remote',
    };
  }

  throw new Error('No LLM provider available');
}

// 默认超时时间（毫秒）
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;
const ANSWER_REFERENCE_LIMIT = 8;

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryWithReasoningModel(errorText = '') {
  const normalized = String(errorText || '').toLowerCase()
  return normalized.includes('model') && normalized.includes('not found')
}

function stripThinkBlocks(content = '') {
  return String(content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim()
}

/**
 * 调用 LLM Chat Completion（带重试和超时）
 */
export async function callLLM(messages, options = {}) {
  const config = await getLLMConfig(options);
  const {
    model = null,
    temperature = 0.3,
    maxTokens = 2048,
    timeout = DEFAULT_TIMEOUT,
    retries = MAX_RETRIES,
  } = options;
  const preferredModel = model || config.model
  const fallbackReasoningModel = config.provider === 'ollama'
    ? String(process.env.OLLAMA_REASONING_MODEL || LLM_CONFIG.ollama.reasoningModel || '').trim()
    : ''

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      let activeModel = preferredModel

      let response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: activeModel,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (
          fallbackReasoningModel &&
          activeModel !== fallbackReasoningModel &&
          shouldRetryWithReasoningModel(errorText)
        ) {
          console.warn(`[LLM] Model ${activeModel} unavailable, retrying with reasoning model ${fallbackReasoningModel}`)
          activeModel = fallbackReasoningModel
          response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: activeModel,
              messages,
              temperature,
              max_tokens: maxTokens,
              stream: false,
            }),
            signal: controller.signal,
          });
        }

        if (!response.ok) {
          throw new Error(`LLM API error: ${response.status} - ${errorText}`);
        }
      }

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!data.choices || !data.choices[0]) {
        throw new Error('Invalid LLM response format');
      }

      // 过滤思考标签
      const content = stripThinkBlocks(data.choices[0].message.content);
      return content;

    } catch (error) {
      lastError = error;

      if (error.name === 'AbortError') {
        console.warn(`[LLM] Request timeout (attempt ${attempt + 1}/${retries + 1})`);
      } else if (error.cause?.code === 'ECONNREFUSED') {
        console.warn(`[LLM] Connection refused (attempt ${attempt + 1}/${retries + 1})`);
      } else {
        throw error;
      }

      if (attempt < retries) {
        await delay(RETRY_DELAY * (attempt + 1));
      }
    }
  }

  throw lastError || new Error('LLM request failed after retries');
}

/**
 * 流式调用 LLM（过滤思考标签）
 *
 * @param {Array} messages - 消息数组
 * @param {Function} onChunk - 回调函数 (stage, content)
 * @param {Object} options - 选项
 */
export async function callLLMStream(messages, onChunk, options = {}) {
  const config = await getLLMConfig();
  const { temperature = 0.7, maxTokens = 1024, timeout = 60000 } = options;

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  console.log(`[LLM Stream] Model: ${config.model}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // 累积完整内容
  let accumulated = '';
  // 已输出的长度
  let outputLen = 0;

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;

        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (!delta) continue;

          accumulated += delta;

          // 过滤思考标签后的干净内容
          const clean = stripThinkBlocks(accumulated);

          // 只输出新增部分
          if (clean.length > outputLen) {
            const newChunk = clean.slice(outputLen);
            onChunk('answer', newChunk);
            outputLen = clean.length;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    // 返回过滤后的最终内容
    return stripThinkBlocks(accumulated);

  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 生成 Embedding
 */
export async function generateEmbedding(texts) {
  const config = await getLLMConfig();
  const input = Array.isArray(texts) ? texts : [texts];

  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.embeddingModel,
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.data || !data.data[0]) {
    throw new Error('Invalid embedding response format');
  }

  return Array.isArray(texts)
    ? data.data.map(d => d.embedding)
    : data.data[0].embedding;
}

/**
 * 从 LLM 响应中提取 JSON 对象
 */
function extractJsonFromResponse(response) {
  // 移除 markdown 代码块
  let cleaned = response.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1');

  // 尝试提取 JSON 对象
  const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return cleaned.trim();
}

/**
 * 类别关键词映射表
 */
const CATEGORY_KEYWORDS = [
  { patterns: ['餐厅', '饭店', '美食', '吃的', '吃饭', '餐馆', '小吃', '好吃的', '中国菜'], category: '餐饮', dbSupported: true },
  { patterns: ['火锅', '烧烤', '串串', '麻辣烫'], category: '火锅', dbSupported: true },
  { patterns: ['快餐', '外卖', '便当'], category: '快餐', dbSupported: true },
  { patterns: ['咖啡', '奶茶', '茶饮', '饮品', '喝咖啡', '喝奶茶'], category: '咖啡', dbSupported: true },
  { patterns: ['甜品', '蛋糕', '烘焙'], category: '甜品', dbSupported: true },
  { patterns: ['酒店', '宾馆', '住宿', '旅馆', '民宿'], category: '住宿', dbSupported: true },
  { patterns: ['景点', '公园', '旅游', '景区', '名胜', '古迹', '好玩', '玩'], category: '景点', dbSupported: true },
  { patterns: ['医院', '诊所', '药店', '医疗', '看病'], category: '医疗', dbSupported: true },
  { patterns: ['学校', '大学', '学院', '教育', '培训机构'], category: '教育', dbSupported: true },
  { patterns: ['超市', '商场', '购物', '便利店', '商店'], category: '购物', dbSupported: true },
  { patterns: ['银行', 'ATM', '金融', '存钱', '取钱'], category: '金融', dbSupported: true },
  { patterns: ['加油站', '充电站', '汽车服务', '洗车', '修车'], category: '汽车服务', dbSupported: true },
  { patterns: ['健身房', '运动', '体育', '游泳', '羽毛球'], category: '运动健身', dbSupported: true },
  { patterns: ['电影院', 'KTV', '网吧', '游戏', '娱乐'], category: '娱乐休闲', dbSupported: true },
];

/**
 * 检查类别是否在数据库中有对应项
 */
export function isCategoryDbSupported(category) {
  if (!category) return true;
  for (const item of CATEGORY_KEYWORDS) {
    if (item.category === category) {
      return item.dbSupported;
    }
  }
  return false;
}

/**
 * 从用户查询中提取类别
 */
function extractCategoryFromQuery(userQuery, placeName = null) {
  let searchQuery = userQuery;
  if (placeName) {
    searchQuery = userQuery.replace(placeName, '');
  }

  for (const { patterns, category, dbSupported } of CATEGORY_KEYWORDS) {
    for (const pattern of patterns) {
      if (searchQuery.includes(pattern)) {
        return { category, dbSupported };
      }
    }
  }
  return { category: null, dbSupported: true };
}

/**
 * 从用户查询中提取地点名和半径
 */
function extractFromQuery(userQuery) {
  const placeMatch = userQuery.match(/(?:我想在|在)?(.+?)(?:附近|周边|旁边|周围|边上|隔壁|那边)/);
  const radiusKm = userQuery.match(/(\d+)\s*(?:公里|千米|km)/i);
  const radiusM = userQuery.match(/(\d+)\s*(?:米|m)(?!公里|千米)/i);

  let place_name = placeMatch ? placeMatch[1].trim() : null;

  if (place_name) {
    place_name = place_name
      .replace(/^(我想找|找|找个|找一家|去|去个|有没有)/, '')
      .replace(/^(环境安静)?(适合)?(约会|聚餐|吃饭|休息|玩|玩玩|逛逛)?$/, '')
      .trim();
  }

  const radius_m = radiusKm ? parseInt(radiusKm[1]) * 1000 : (radiusM ? parseInt(radiusM[1]) : 500);
  const { category, dbSupported } = extractCategoryFromQuery(userQuery, place_name);

  return { place_name, radius_m, category, dbSupported };
}

/**
 * 解析空间查询意图
 */
export async function parseSpatialIntent(userQuery) {
  if (!userQuery || typeof userQuery !== 'string') {
    return {
      place_name: null,
      radius_m: 500,
      category: null,
      is_spatial_query: false,
    };
  }

  const MAX_QUERY_LENGTH = 500;
  const sanitizedQuery = userQuery.trim().slice(0, MAX_QUERY_LENGTH);

  const response = await callLLM([
    {
      role: 'system',
      content: `你是空间查询解析器。从用户输入中提取地点名、半径、类别。
规则：
1. 地点名：提取用户提到的具体地点，忽略"我想在"、"找"等干扰词
2. 半径：提取数字+单位，默认500米
3. 类别：餐厅/酒店/景点/咖啡等，若无则为null
只输出JSON，格式：{"place_name":"xxx","radius_m":500,"category":"xxx或null"}`
    },
    {
      role: 'user',
      content: userQuery
    }
  ], {
    temperature: 0,
    maxTokens: 80,
  });

  console.log('[LLM] Raw response:', response);

  const fallbackResult = extractFromQuery(userQuery);

  try {
    const jsonStr = extractJsonFromResponse(response);
    const parsed = JSON.parse(jsonStr);

    const place_name = parsed.place_name || fallbackResult.place_name;

    let category = parsed.category;
    let dbSupported = true;
    if (!category || category === 'null') {
      const catResult = extractCategoryFromQuery(userQuery, place_name);
      category = catResult.category;
      dbSupported = catResult.dbSupported;
    } else {
      dbSupported = isCategoryDbSupported(category);
    }

    return {
      place_name,
      radius_m: parsed.radius_m || fallbackResult.radius_m,
      category,
      dbSupported,
      is_spatial_query: true,
    };
  } catch (e) {
    console.error('[LLM] Intent parse failed:', e.message);
    return {
      ...fallbackResult,
      is_spatial_query: true,
    };
  }
}

/**
 * 根据检索结果生成回答
 */
export async function generateAnswer(userQuery, results, categoryWarning = null, intentDesc = null) {
  if (!results || results.length === 0) {
    return '抱歉，在指定范围内没有找到相关的地点。您可以尝试扩大搜索范围或更换地点。';
  }

  const poiContext = results.map((p, i) => {
    const name = p.name || '未知';
    const category = p.category || '未分类';
    const distance = p.distance_m ? `${Math.round(p.distance_m)}m` : '';
    const score = p.fused_score ? `(分数:${p.fused_score.toFixed(2)})` : '';
    return `${i + 1}. ${name} [${category}] ${distance} ${score}`;
  }).join('\n');

  let prompt = `用户问：${userQuery}

根据以下搜索结果回答用户问题。要求：
1. 不要虚构不存在的地点
2. 使用 Markdown 表格展示结果
3. 表格包含：名称、类别、距离、简要推荐理由
4. 最后给出 1-2 句总结推荐`;

  if (intentDesc) {
    prompt += `\n5. 考虑用户意图：${intentDesc}`;
  }

  if (categoryWarning) {
    prompt += `\n5. 在回答开头说明：${categoryWarning}`;
  }

  prompt += `

## 检索到的 POI 数据 (共 ${results.length} 条)
${poiContext}

请给出简洁、友好的回答：`;

  const response = await callLLM([{ role: 'user', content: prompt }], {
    temperature: 0.7,
    maxTokens: 1024,
  });

  return response.trim();
}

/**
 * 获取小模型配置（用于意图理解、关键词提取、普通聊天）
 */
export async function getSmallLLMConfig() {
  const config = await getLLMConfig();
  // 使用 lfm2.5-1.2b 模型避免 qwen 系列的思考标签问题
  return {
    ...config,
    model: process.env.SMALL_LLM_MODEL || 'lfm2.5-1.2b',
  };
}

/**
 * 空间推理（简化版）
 */
export async function spatialReasoning(query, results, intent, anchor, onThinking, onComplete) {
  // 简化实现：直接返回摘要
  const summary = `分析完成：找到 ${results?.length || 0} 个相关地点`;
  if (onComplete) onComplete(summary);
  return { summary };
}

export function buildSpatialAnswerFallback(query, results = [], options = {}) {
  const { requestedCategory = null } = options;
  const normalizedResults = Array.isArray(results) ? results.filter(Boolean).slice(0, ANSWER_REFERENCE_LIMIT) : [];

  if (normalizedResults.length === 0) {
    return '抱歉，当前空间检索结果里没有找到可直接回答这个问题的地点。您可以尝试扩大范围，或换一个更具体的地点再试试。';
  }

  const lines = normalizedResults.map((item, index) => {
    const name = item?.name || `结果${index + 1}`;
    const category = item?.category ? `（${item.category}）` : '';
    const distance = Number.isFinite(Number(item?.distance_m)) ? `，约${Math.round(Number(item.distance_m))}米` : '';
    return `${index + 1}. ${name}${category}${distance}`;
  });

  const prefix = requestedCategory
    ? `根据当前空间检索，先给您列出离“${query}”最相关的${requestedCategory}候选：`
    : `根据当前空间检索，先给您列出离“${query}”最相关的地点候选：`;

  return `${prefix}\n${lines.join('\n')}\n如果您愿意，我还可以继续按距离、类别或步行范围帮您缩小结果。`;
}

/**
 * 流式答案生成
 */
export async function generateAnswerStream(query, results, onChunk, options = {}) {
  const {
    intentDesc,
    requestedCategory = null,
    temperature = 0.7,
    maxTokens = 1024,
    streamImpl = callLLMStream
  } = options;

  const poiContext = results?.slice(0, 5).map(r =>
    `- ${r.name} (${r.category || '未知'}): 距离 ${r.distance_m?.toFixed(0) || '?'}米`
  ).join('\n') || '无相关数据';

  const prompt = `你是武汉三镇的地理智能助手。

用户问题：${query}
检索意图：${intentDesc || '空间邻近查询'}
目标类别：${requestedCategory || '未限定'}

参考数据：
${poiContext}

回答要求：
1. 只能依据上面的参考数据回答，禁止编造未出现在数据里的站点、商圈、线路或距离。
2. 如果参考数据与用户问题不匹配，要直接说明“当前检索结果里没有明确命中该类别”，不要猜测。
3. 优先按距离组织答案，保持简洁。`;

  const finalText = await streamImpl([
    { role: 'system', content: '你是武汉三镇的地理智能助手，请简洁友好地回答问题。' },
    { role: 'user', content: prompt }
  ], (stage, content) => {
    if (stage === 'answer' && content) {
      onChunk(content);
    }
  }, { temperature, maxTokens });

  return typeof finalText === 'string' ? stripThinkBlocks(finalText) : '';
}

export default {
  LLM_CONFIG,
  getLLMConfig,
  getSmallLLMConfig,
  callLLM,
  callLLMStream,
  generateEmbedding,
  parseSpatialIntent,
  generateAnswer,
  generateAnswerStream,
  spatialReasoning,
  buildSpatialAnswerFallback,
  isCategoryDbSupported,
};
