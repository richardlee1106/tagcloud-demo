/**
 * LLM 鏈嶅姟妯″潡
 * 
 * 绛栫暐锛氭湰鍦颁紭鍏堬紝浜戠鍏滃簳
 * 1. 棣栧厛灏濊瘯璋冪敤鏈湴 LM Studio (http://localhost:1234/v1)
 * 2. 濡傛灉鏈湴涓嶅彲鐢紝鑷姩鍒囨崲鍒颁簯绔?GLM-4.5-air
 */

import 'dotenv/config'

// 鏈湴 LM Studio 閰嶇疆
const LOCAL_CONFIG = {
  baseUrl: 'http://localhost:1234/v1',
  model: process.env.LOCAL_LLM_MODEL || process.env.LLM_MODEL || 'qwen3-4b-instruct-2507',
  timeout: 5000,  // 5绉掕秴鏃舵娴?
}

// 浜戠鏅鸿氨 GLM 閰嶇疆
const CLOUD_CONFIG = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4.5-air',
  embeddingModel: 'embedding-3', // 鏅鸿氨鏈€鏂?Embedding 妯″瀷
  apiKey: process.env.GLM_API_KEY || '',
}

// 缂撳瓨鏈湴鏈嶅姟鐘舵€侊紙閬垮厤姣忔閮芥娴嬶級
let localAvailable = null
let lastCheckTime = 0
const CHECK_INTERVAL = 30000  // 30???????

// ?????????????? > ????
const LOCAL_MODEL_PREFERENCES = [
  process.env.LOCAL_CHAT_MODEL,
  process.env.LOCAL_LLM_MODEL,
  process.env.LLM_MODEL
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
    'stt'
  ]

  const preferredTokens = [
    'instruct',
    'chat',
    'qwen',
    'glm',
    'deepseek',
    'llama',
    'mistral',
    'gemma',
    'yi',
    'baichuan'
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

  // 1) ?????????????????????
  for (const preferred of LOCAL_MODEL_PREFERENCES) {
    const p = preferred.toLowerCase()
    const exact = candidates.find((m) => m.id.toLowerCase() === p)
    if (exact) return exact.id

    const partial = candidates.find((m) => m.id.toLowerCase().includes(p))
    if (partial) return partial.id
  }

  // 2) ???????? chat/instruct????
  const scored = candidates
    .map((m) => {
      const id = m.id.toLowerCase()
      const score = preferredTokens.reduce((acc, token) => {
        return acc + (id.includes(token) ? 1 : 0)
      }, 0)
      return { id: m.id, score }
    })
    .sort((a, b) => b.score - a.score)

  return scored[0]?.id || candidates[0].id
}

/**
 * ???? LM Studio ????????????? chat ??? ID
 * @returns {Promise<boolean>}
 */
async function checkLocalAvailable() {
  const now = Date.now()

  // ???????30????????
  if (localAvailable !== null && (now - lastCheckTime) < CHECK_INTERVAL) {
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
        console.log(`[LLM] Local LM Studio is ready, selected chat model: ${selectedModel}`)
      } else {
        console.log('[LLM] No suitable local chat model found; keep configured default model')
      }
    }

    return localAvailable
  } catch (err) {
    localAvailable = false
    lastCheckTime = now
    console.log('[LLM] Local LM Studio unavailable, fallback to cloud GLM')
    return false
  }
}

export async function getLLMConfig() {
  const isLocal = await checkLocalAvailable()
  
  if (isLocal) {
    return {
      baseUrl: LOCAL_CONFIG.baseUrl,
      model: LOCAL_CONFIG.model,
      apiKey: '',  // 鏈湴涓嶉渶瑕?API Key
      isLocal: true,
    }
  } else {
    return {
      baseUrl: CLOUD_CONFIG.baseUrl,
      model: CLOUD_CONFIG.model,
      apiKey: CLOUD_CONFIG.apiKey,
      isLocal: false,
    }
  }
}

/**
 * 鑾峰彇褰撳墠搴斾娇鐢ㄧ殑 Embedding 閰嶇疆
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
  } else {
    return {
      baseUrl: CLOUD_CONFIG.baseUrl,
      model: CLOUD_CONFIG.embeddingModel,
      apiKey: CLOUD_CONFIG.apiKey,
      isLocal: false,
    }
  }
}

/**
 * 璋冪敤 LLM Chat Completions API锛堣嚜鍔ㄩ€夋嫨鏈湴/浜戠锛?
 * 
 * @param {Object} options
 */
export async function callLLM(options) {
  const config = await getLLMConfig()
  
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }
  
  console.log(`[LLM] 浣跨敤 ${config.isLocal ? '鏈湴' : '浜戠'} 妯″瀷: ${config.model}`)
  
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
      console.log('[LLM] 鏈湴璋冪敤澶辫触锛屽垏鎹㈠埌浜戠鍏滃簳...')
      localAvailable = false
      return callLLM(options)
    }
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
  }
  
  return response
}

/**
 * 鐢熸垚鏂囨湰鍚戦噺锛堢粺涓€鏈湴/浜戠閫昏緫锛?
 * @param {string|string[]} input 杈撳叆鏂囨湰
 */
export async function generateEmbedding(input) {
  const config = await getEmbeddingConfig()
  
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }
  
  try {
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        input: input,
      }),
    })
    
    if (!response.ok) {
      if (config.isLocal) {
        console.log('[LLM] 鏈湴 Embedding 澶辫触锛屽垏鎹㈠埌浜戠...')
        localAvailable = false
        return generateEmbedding(input)
      }
      throw new Error(`Embedding API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (Array.isArray(input)) {
        return data.data.map(item => item.embedding)
    }
    return data.data?.[0]?.embedding
  } catch (err) {
    console.error('[LLM] Embedding 鐢熸垚澶辫触:', err.message)
    return null
  }
}

/**
 * 寮哄埗鍒锋柊鏈湴鍙敤鎬ф娴?
 */
export function refreshLocalStatus() {
  localAvailable = null
  lastCheckTime = 0
}

/**
 * 鑾峰彇褰撳墠娲诲姩鐨?Provider 淇℃伅
 */
export async function getActiveProviderInfo() {
  const isLocal = await checkLocalAvailable()
  return {
    provider: isLocal ? 'local' : 'glm',
    providerName: isLocal ? 'Local LM Studio' : 'GLM'
  }
}

export default {
  getLLMConfig,
  getEmbeddingConfig,
  callLLM,
  generateEmbedding,
  refreshLocalStatus,

  getActiveProviderInfo
}


