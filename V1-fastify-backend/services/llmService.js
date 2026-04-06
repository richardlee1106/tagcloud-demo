/**
 * LLM 服务配置
 *
 * 支持本地 LMStudio 和远程 LLM API
 * 默认配置：qwen3.5-2b-claude-4.6-opus-reasoning-distilled @ http://127.0.0.1:1234
 *
 * Author: Sisyphus
 * Date: 2026-03-20
 */

// LLM 配置
export const LLM_CONFIG = {
  // 本地 LMStudio（默认）
  local: {
    baseUrl: process.env.LLM_BASE_URL || 'http://127.0.0.1:1234/v1',
    model: process.env.LLM_MODEL || 'qwen3.5-2b-claude-4.6-opus-reasoning-distilled',
    embeddingModel: process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5',
  },
  // 远程 API（备用）
  remote: {
    baseUrl: process.env.REMOTE_LLM_BASE_URL || '',
    apiKey: process.env.REMOTE_LLM_API_KEY || '',
    model: process.env.REMOTE_LLM_MODEL || '',
  },
  // 默认使用本地
  useLocal: process.env.USE_LOCAL_LLM !== 'false',
};

/**
 * 获取当前 LLM 配置
 */
export function getLLMConfig() {
  if (LLM_CONFIG.useLocal) {
    return {
      baseUrl: LLM_CONFIG.local.baseUrl,
      model: LLM_CONFIG.local.model,
      embeddingModel: LLM_CONFIG.local.embeddingModel,
    };
  }
  return {
    baseUrl: LLM_CONFIG.remote.baseUrl,
    model: LLM_CONFIG.remote.model,
    apiKey: LLM_CONFIG.remote.apiKey,
  };
}

// 默认超时时间（毫秒）
const DEFAULT_TIMEOUT = 30000;
// 最大重试次数
const MAX_RETRIES = 2;
// 重试延迟（毫秒）
const RETRY_DELAY = 1000;

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url, options, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 调用 LLM Chat Completion（带重试和超时）
 *
 * @param {Array} messages - 消息数组
 * @param {Object} options - 配置选项
 * @returns {Promise<string>} - LLM 响应
 */
export async function callLLM(messages, options = {}) {
  const config = getLLMConfig();
  const {
    temperature = 0.3,
    maxTokens = 2048,
    stream = false,
    timeout = DEFAULT_TIMEOUT,
    retries = MAX_RETRIES,
  } = options;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `${config.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream,
          }),
        },
        timeout
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (!data.choices || !data.choices[0]) {
        throw new Error('Invalid LLM response format');
      }

      return data.choices[0].message.content;

    } catch (error) {
      lastError = error;

      // 超时或网络错误时重试
      if (error.name === 'AbortError') {
        console.warn(`[LLM] Request timeout (attempt ${attempt + 1}/${retries + 1})`);
      } else if (error.cause?.code === 'ECONNREFUSED') {
        console.warn(`[LLM] Connection refused (attempt ${attempt + 1}/${retries + 1})`);
      } else {
        // 其他错误直接抛出
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
 * 生成 Embedding
 *
 * @param {string|Array<string>} texts - 输入文本
 * @returns {Promise<Array>} - Embedding 向量
 */
export async function generateEmbedding(texts) {
  const config = getLLMConfig();
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
  // 移除思考标签 (DeepSeek/Qwen 风格)
  let cleaned = response.replace(/olleyball[\s\S]*?<\/think>/g, '');
  cleaned = cleaned.replace(/olleyball/g, '');

  // 移除 markdown 代码块
  cleaned = cleaned.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1');

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
  { patterns: ['餐厅', '饭店', '美食', '吃的', '吃饭', '餐馆', '小吃'], category: '餐饮' },
  { patterns: ['酒店', '宾馆', '住宿', '旅馆', '民宿'], category: '住宿' },
  { patterns: ['景点', '公园', '旅游', '景区', '名胜', '古迹'], category: '景点' },
  { patterns: ['医院', '诊所', '药店', '医疗', '看病'], category: '医疗' },
  { patterns: ['学校', '大学', '学院', '教育', '培训机构'], category: '教育' },
  { patterns: ['超市', '商场', '购物', '便利店', '商店'], category: '购物' },
  { patterns: ['银行', 'ATM', '金融', '存钱', '取钱'], category: '金融' },
  { patterns: ['加油站', '充电站', '汽车服务', '洗车', '修车'], category: '汽车服务' },
  { patterns: ['健身房', '运动', '体育', '游泳', '羽毛球'], category: '运动健身' },
  { patterns: ['咖啡馆', '咖啡', '奶茶', '茶饮', '饮品'], category: '咖啡茶饮' },
  { patterns: ['电影院', 'KTV', '网吧', '游戏', '娱乐'], category: '娱乐休闲' },
];

/**
 * 从用户查询中提取类别（排除地点名部分）
 */
function extractCategoryFromQuery(userQuery, placeName = null) {
  // 如果有地点名，从查询中移除地点名后再匹配类别
  // 这样可以避免"华中科技大学"中的"大学"被误匹配为"教育"类别
  let searchQuery = userQuery;
  if (placeName) {
    searchQuery = userQuery.replace(placeName, '');
  }

  for (const { patterns, category } of CATEGORY_KEYWORDS) {
    for (const pattern of patterns) {
      if (searchQuery.includes(pattern)) {
        return category;
      }
    }
  }
  return null;
}

/**
 * 从用户查询中提取地点名和半径
 */
function extractFromQuery(userQuery) {
  // 匹配地点（支持更多关键词）
  const placeMatch = userQuery.match(/^(.+?)(?:附近|周边|旁边|周围|边上|隔壁)/);

  // 匹配半径
  const radiusKm = userQuery.match(/(\d+)\s*(?:公里|千米|km)/i);
  const radiusM = userQuery.match(/(\d+)\s*(?:米|m)(?!公里|千米)/i);

  const place_name = placeMatch ? placeMatch[1].trim() : null;
  const radius_m = radiusKm ? parseInt(radiusKm[1]) * 1000 : (radiusM ? parseInt(radiusM[1]) : 500);

  // 先提取地点名，再提取类别（排除地点名干扰）
  const category = extractCategoryFromQuery(userQuery, place_name);

  return { place_name, radius_m, category };
}

/**
 * 解析空间查询意图
 *
 * @param {string} userQuery - 用户查询
 * @returns {Promise<Object>} - 解析结果
 */
export async function parseSpatialIntent(userQuery) {
  // 输入验证和清洗
  if (!userQuery || typeof userQuery !== 'string') {
    return {
      place_name: null,
      radius_m: 500,
      category: null,
      is_spatial_query: false,
    };
  }

  // 截断过长输入（防止上下文溢出）
  const MAX_QUERY_LENGTH = 500;
  const sanitizedQuery = userQuery.trim().slice(0, MAX_QUERY_LENGTH);

  // 检测潜在恶意输入（SQL注入关键词，但排除中文常见词）
  const suspiciousPatterns = [
    /;\s*--/,           // ; -- 注释
    /\/\*/,             // /* 注释开始
    /\*\/\s*;/,         // */ ; 组合
    /xp_\w+/i,          // SQL 扩展存储过程
    /exec\s*\(\s*['"]/i, // exec('
    /union\s+(all\s+)?select\b/i, // union select
    /drop\s+table\b/i,  // drop table
    /insert\s+into\b/i, // insert into
    /delete\s+from\b/i, // delete from
    /update\s+\w+\s+set\b/i, // update set
  ];
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitizedQuery)) {
      console.warn('[LLM] Suspicious input detected, using fallback extraction');
      return {
        ...extractFromQuery(sanitizedQuery),
        is_spatial_query: true,
      };
    }
  }

  const response = await callLLM([
    {
      role: 'system',
      content: '你是JSON输出器。只输出JSON，禁止任何其他文字。禁止解释。禁止分析。输出格式：{"place_name":"xxx","radius_m":500,"category":"xxx或null"}'
    },
    {
      role: 'user',
      content: `${sanitizedQuery}

提取：地点名、半径(米)、类别。只输出JSON。`
    }
  ], {
    temperature: 0,
    maxTokens: 80,
  });

  console.log('[LLM] Raw response:', response);

  // 先用正则提取作为兜底
  const fallbackResult = extractFromQuery(sanitizedQuery);

  // 解析 JSON
  try {
    const jsonStr = extractJsonFromResponse(response);
    const parsed = JSON.parse(jsonStr);

    // 确定 place_name（优先使用 LLM 结果）
    const place_name = parsed.place_name || fallbackResult.place_name;

    // 如果 LLM 没有提取出类别，用正则补充（排除地点名干扰）
    let category = parsed.category;
    if (!category || category === 'null') {
      category = extractCategoryFromQuery(userQuery, place_name);
    }

    return {
      place_name,
      radius_m: parsed.radius_m || fallbackResult.radius_m,
      category,
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
 *
 * @param {string} userQuery - 用户查询
 * @param {Array} results - 检索结果
 * @returns {Promise<string>} - LLM 生成的回答
 */
export async function generateAnswer(userQuery, results) {
  // 构建简洁的 POI 上下文
  const poiContext = results.map((p, i) => {
    const name = p.name || '未知';
    const category = p.category || '未分类';
    const distance = p.distance_m ? `${Math.round(p.distance_m)}m` : '';
    const score = p.fused_score ? `(分数:${p.fused_score.toFixed(2)})` : '';
    return `${i + 1}. ${name} [${category}] ${distance} ${score}`;
  }).join('\n');

  const prompt = `用户问：${userQuery}

根据以下搜索结果回答用户问题。要求：
1. 不要虚构不存在的地点
2. 使用 Markdown 表格展示结果
3. 表格包含：名称、类别、距离、简要推荐理由
4. 最后给出 1-2 句总结推荐

## 检索到的 POI 数据 (共 ${results.length} 条)
${poiContext}

请给出简洁、友好的回答：`;

  const response = await callLLM([{ role: 'user', content: prompt }], {
    temperature: 0.7,
    maxTokens: 1024,
  });

  // 移除思考标签
  return response.replace(/olleyball[\s\S]*?<\/think>/g, '').replace(/olleyball/g, '').trim();
}

export default {
  LLM_CONFIG,
  getLLMConfig,
  callLLM,
  generateEmbedding,
  parseSpatialIntent,
  generateAnswer,
};
