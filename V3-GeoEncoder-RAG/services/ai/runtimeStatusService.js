function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '')
}

function normalizeModelList(items = []) {
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      return String(item.id || item.name || item.model || '').trim()
    })
    .filter(Boolean)
}

function uniqueModels(...groups) {
  return [...new Set(groups.flat().filter(Boolean))]
}

export function buildModelsEndpoint(baseUrl = '') {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return ''
  return normalized.endsWith('/v1')
    ? `${normalized}/models`
    : `${normalized}/v1/models`
}

export async function probeOpenAICompatibleService({
  baseUrl = '',
  configuredModel = '',
  timeoutMs = 2000
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedConfiguredModel = String(configuredModel || '').trim()

  if (!normalizedBaseUrl) {
    return {
      configured: false,
      available: false,
      baseUrl: '',
      configuredModel: normalizedConfiguredModel,
      models: [],
      error: 'base_url_missing'
    }
  }

  const endpoint = buildModelsEndpoint(normalizedBaseUrl)

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (!response.ok) {
      return {
        configured: true,
        available: false,
        baseUrl: normalizedBaseUrl,
        configuredModel: normalizedConfiguredModel,
        models: [],
        error: `http_${response.status}`
      }
    }

    const data = await response.json()
    const discoveredModels = normalizeModelList(data?.data || data?.models || [])
    const models = uniqueModels(discoveredModels, normalizedConfiguredModel ? [normalizedConfiguredModel] : [])

    return {
      configured: true,
      available: true,
      baseUrl: normalizedBaseUrl,
      configuredModel: normalizedConfiguredModel,
      models,
      error: null
    }
  } catch (error) {
    return {
      configured: true,
      available: false,
      baseUrl: normalizedBaseUrl,
      configuredModel: normalizedConfiguredModel,
      models: [],
      error: error?.name === 'TimeoutError' ? 'timeout' : (error?.message || 'probe_failed')
    }
  }
}

export async function resolveChatRuntimeStatus({
  env = process.env,
  ollamaStatus = {}
} = {}) {
  const useOllama = String(env?.USE_OLLAMA || '').trim().toLowerCase() !== 'false'
  const plannerModel = String(env?.PLANNER_MODEL || '').trim()
  const plannerBaseUrl = String(env?.PLANNER_BASE_URL || '').trim()
  const answerSynthesisModel = String(env?.ANSWER_SYNTHESIS_MODEL || '').trim()
  const answerSynthesisBaseUrl = String(env?.ANSWER_SYNTHESIS_BASE_URL || '').trim()

  const [planner, answerSynthesis] = await Promise.all([
    probeOpenAICompatibleService({
      baseUrl: plannerBaseUrl,
      configuredModel: plannerModel
    }),
    probeOpenAICompatibleService({
      baseUrl: answerSynthesisBaseUrl,
      configuredModel: answerSynthesisModel
    })
  ])

  const ollamaModels = normalizeModelList(ollamaStatus?.models || [])
  const ollamaDefaultModel = String(ollamaStatus?.defaultModel || '').trim()
  const online = useOllama
    ? Boolean(ollamaStatus?.running)
    : Boolean(planner.available || answerSynthesis.available)
  const ready = useOllama
    ? Boolean(ollamaStatus?.running)
    : Boolean(planner.available && answerSynthesis.available)
  const provider = useOllama ? 'ollama' : 'llama.cpp'
  const models = useOllama
    ? uniqueModels(ollamaModels, ollamaDefaultModel ? [ollamaDefaultModel] : [])
    : uniqueModels(planner.models, answerSynthesis.models)
  const model = useOllama
    ? (ollamaDefaultModel || models[0] || null)
    : (planner.configuredModel || answerSynthesis.configuredModel || models[0] || null)

  return {
    provider,
    useOllama,
    online,
    ready,
    model,
    models,
    planner,
    answerSynthesis
  }
}

export default {
  buildModelsEndpoint,
  probeOpenAICompatibleService,
  resolveChatRuntimeStatus
}
