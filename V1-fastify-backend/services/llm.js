/**
 * LLM 服务模块
 *
 * 策略：本地优先，云端兜底
 * 1. 先尝试调用本地 LM Studio（http://localhost:1234/v1）
 * 2. 本地不可用时，自动切换到云端 GLM
 */

import 'dotenv/config'

// 本地 LM Studio 配置
const LOCAL_CONFIG = {
  baseUrl: 'http://localhost:1234/v1',
  model: process.env.LOCAL_LLM_MODEL || process.env.LLM_MODEL || 'qwen3.5-2b',
  timeout: 5000, // 5 秒超时检测
}

// 云端 GLM 配置
const CLOUD_CONFIG = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4.5-air',
  embeddingModel: 'embedding-3', // 智谱 Embedding 模型
  apiKey: process.env.GLM_API_KEY || '',
}

// 本地可用性缓存（避免每次都探测）
let localAvailable = null
let lastCheckTime = 0
const CHECK_INTERVAL = 30000 // 30 秒

// 模型偏好优先级：显式配置 > 自动选择
const LOCAL_MODEL_PREFERENCES = [
  process.env.LOCAL_CHAT_MODEL,
  process.env.LOCAL_LLM_MODEL,
  process.env.LLM_MODEL,
].filter(Boolean)

function selectBestLocalChatModel(modelList = []) {
  if (!Array.isArray(modelList) || modelList.length === 0) {
    return null
  }

  const blockedTokens = [
    'embed',
    'embedding',
    'rerank',
    'ocr',
    'asr',
    'whisper',
    'tts',
    'stt',
  ]

  const preferredTokens = [
    'vl',
    'vision',
    'instruct',
    'chat',
    'qwen',
    'glm',
    'deepseek',
    'llama',
    'mistral',
    'gemma',
    'yi',
    'baichuan',
  ]

  const candidates = modelList
    .map((m) => ({ raw: m, id: String(m?.id || '').trim() }))
    .filter((m) => m.id.length > 0)
    .filter((m) => {
      const id = m.id.toLowerCase()
      return !blockedTokens.some((token) => id.includes(token))
    })

  if (candidates.length === 0) {
    return null
  }

  // 1) 优先匹配环境变量中指定的模型
  for (const preferred of LOCAL_MODEL_PREFERENCES) {
    const p = preferred.toLowerCase()
    const exact = candidates.find((m) => m.id.toLowerCase() === p)
    if (exact) return exact.id

    const partial = candidates.find((m) => m.id.toLowerCase().includes(p))
    if (partial) return partial.id
  }

  // 2) 退化到关键词打分（优先识别多模态/视觉大模型）
  const scored = candidates
    .map((m) => {
      const id = m.id.toLowerCase()
      let score = 0
      
      // 视觉模型加高分
      if (id.includes('vl') || id.includes('vision') || id.includes('llava')) {
        score += 10
      }
      
      score += preferredTokens.reduce((acc, token) => {
        return acc + (id.includes(token) ? 1 : 0)
      }, 0)
      
      return { id: m.id, score }
    })
    .sort((a, b) => b.score - a.score)

  return scored[0]?.id || candidates[0].id
}

/**
 * 检测 LM Studio 可用性并自动选择聊天模型
 * @returns {Promise<boolean>}
 */
async function checkLocalAvailable() {
  const now = Date.now()

  // 30 秒内复用缓存
  if (localAvailable !== null && now - lastCheckTime < CHECK_INTERVAL) {
    return localAvailable
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), LOCAL_CONFIG.timeout)

    const response = await fetch(`${LOCAL_CONFIG.baseUrl}/models`, {
      method: 'GET',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    localAvailable = response.ok
    lastCheckTime = now

    if (localAvailable) {
      const data = await response.json()
      const selectedModel = selectBestLocalChatModel(data?.data || [])

      if (selectedModel) {
        LOCAL_CONFIG.model = selectedModel
        console.log(`[LLM] Local LM Studio 可用，选择模型: ${selectedModel}`)
      } else {
        console.log('[LLM] 未找到合适本地聊天模型，继续使用默认模型')
      }
    }

    return localAvailable
  } catch (err) {
    localAvailable = false
    lastCheckTime = now
    console.log('[LLM] Local LM Studio 不可用，回退到云端 GLM')
    return false
  }
}

export async function getLLMConfig() {
  const isLocal = await checkLocalAvailable()

  if (isLocal) {
    return {
      baseUrl: LOCAL_CONFIG.baseUrl,
      model: LOCAL_CONFIG.model,
      apiKey: '', // 本地无需 API Key
      isLocal: true,
    }
  }

  return {
    baseUrl: CLOUD_CONFIG.baseUrl,
    model: CLOUD_CONFIG.model,
    apiKey: CLOUD_CONFIG.apiKey,
    isLocal: false,
  }
}

/**
 * 获取当前 Embedding 配置
 */
export async function getEmbeddingConfig() {
  const isLocal = await checkLocalAvailable()

  if (isLocal) {
    return {
      baseUrl: LOCAL_CONFIG.baseUrl,
      model: process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5',
      apiKey: '',
      isLocal: true,
    }
  }

  return {
    baseUrl: CLOUD_CONFIG.baseUrl,
    model: CLOUD_CONFIG.embeddingModel,
    apiKey: CLOUD_CONFIG.apiKey,
    isLocal: false,
  }
}

/**
 * 调用 Chat Completions（自动选择本地/云端）
 * @param {Object} options
 */
export async function callLLM(options) {
  const config = await getLLMConfig()

  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }

  console.log(`[LLM] 使用 ${config.isLocal ? '本地' : '云端'} 模型: ${config.model}`)

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1500,
      stream: options.stream ?? false,
    }),
  })

  if (!response.ok) {
    if (config.isLocal) {
      console.log('[LLM] 本地调用失败，切换到云端兜底...')
      localAvailable = false
      return callLLM(options)
    }
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
  }

  return response
}

/**
 * 生成文本向量（统一本地/云端逻辑）
 * @param {string|string[]} input 输入文本
 */
export async function generateEmbedding(input) {
  const config = await getEmbeddingConfig()

  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }

  try {
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        input,
      }),
    })

    if (!response.ok) {
      if (config.isLocal) {
        console.log('[LLM] 本地 Embedding 调用失败，切换到云端...')
        localAvailable = false
        return generateEmbedding(input)
      }
      throw new Error(`Embedding API error: ${response.status}`)
    }

    const data = await response.json()

    if (Array.isArray(input)) {
      return data.data.map((item) => item.embedding)
    }
    return data.data?.[0]?.embedding
  } catch (err) {
    console.error('[LLM] Embedding 生成失败:', err.message)
    return null
  }
}

/**
 * 强制刷新本地可用性缓存
 */
export function refreshLocalStatus() {
  localAvailable = null
  lastCheckTime = 0
}

/**
 * 获取当前活动 Provider 信息
 */
export async function getActiveProviderInfo() {
  const isLocal = await checkLocalAvailable()
  return {
    provider: isLocal ? 'local' : 'glm',
    providerName: isLocal ? 'Local LM Studio' : 'GLM',
  }
}

export default {
  getLLMConfig,
  getEmbeddingConfig,
  callLLM,
  generateEmbedding,
  refreshLocalStatus,
  getActiveProviderInfo,
}

