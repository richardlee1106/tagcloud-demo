function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function isTestRuntime() {
  const argv = Array.isArray(process.argv) ? process.argv.join(' ') : ''
  return process.env.NODE_ENV === 'test'
    || process.env.VITEST === 'true'
    || argv.includes('vitest')
    || argv.includes('--test')
}

function resolveLlmEnabled() {
  if (process.env.V2_LLM_ENABLED != null) {
    return toBoolean(process.env.V2_LLM_ENABLED, true)
  }
  return !isTestRuntime()
}

function normalizeBaseUrl(rawUrl, fallback) {
  const value = String(rawUrl || fallback || '').trim()
  return value.replace(/\/+$/, '')
}

function cleanModelOutput(text = '') {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()
}

function extractContent(payload = {}) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null
  const content = choice?.message?.content
    ?? choice?.text
    ?? payload?.output_text
    ?? ''

  if (Array.isArray(content)) {
    return cleanModelOutput(content.map((part) => String(part?.text || '')).join(' '))
  }

  return cleanModelOutput(content)
}

function createFailureWarning(code, provider, error) {
  return {
    code,
    provider,
    message: error instanceof Error ? error.message : String(error)
  }
}

function createDegradedResponse(code, provider, error, warnings = []) {
  return {
    text: '',
    degraded: true,
    warnings,
    error: {
      code,
      provider,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function callChatCompletion({
  fetchImpl,
  baseUrl,
  model,
  apiKey = '',
  timeoutMs,
  messages,
  temperature,
  maxTokens
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const headers = {
      'Content-Type': 'application/json'
    }

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        messages
      })
    })

    if (!response.ok) {
      throw new Error(`llm_http_${response.status}`)
    }

    const payload = await response.json()
    const text = extractContent(payload)
    if (!text) {
      throw new Error('llm_empty_output')
    }

    return text
  } finally {
    clearTimeout(timer)
  }
}

export function createLlmGateway({
  fetchImpl = fetch,
  enabled = resolveLlmEnabled(),
  localBaseUrl = normalizeBaseUrl(
    process.env.V2_LLM_BASE_URL || process.env.LOCAL_LLM_BASE_URL,
    'http://localhost:1234/v1'
  ),
  localModel = process.env.V2_LLM_MODEL || process.env.LOCAL_LLM_MODEL || process.env.LLM_MODEL || 'qwen3.5-2b',
  localApiKey = process.env.V2_LLM_API_KEY || process.env.LOCAL_LLM_API_KEY || '',
  localTimeoutMs = Number(process.env.V2_LLM_TIMEOUT_MS || 1800),
  cloudBaseUrl = normalizeBaseUrl(
    process.env.V2_CLOUD_LLM_BASE_URL,
    'https://open.bigmodel.cn/api/paas/v4'
  ),
  cloudModel = process.env.V2_CLOUD_LLM_MODEL || 'glm-4.5-air',
  cloudApiKey = process.env.V2_GLM_API_KEY || process.env.GLM_API_KEY || '',
  cloudTimeoutMs = Number(process.env.V2_CLOUD_LLM_TIMEOUT_MS || 2800),
  onWarning = null
} = {}) {
  return {
    isEnabled() {
      return enabled
    },
    async chat({
      messages = [],
      systemPrompt = '',
      userPrompt = '',
      temperature = 0.2,
      maxTokens = 320,
      timeoutMs = null
    } = {}) {
      if (!enabled) {
        return createDegradedResponse('llm_disabled', 'none', 'LLM gateway disabled.')
      }

      const payloadMessages = Array.isArray(messages) && messages.length > 0
        ? messages
        : [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]

      try {
        const text = await callChatCompletion({
          fetchImpl,
          baseUrl: localBaseUrl,
          model: localModel,
          apiKey: localApiKey,
          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : (Number.isFinite(localTimeoutMs) ? localTimeoutMs : 1800),
          messages: payloadMessages,
          temperature,
          maxTokens
        })

        return {
          text,
          provider: 'local',
          model: localModel,
          warnings: []
        }
      } catch (localError) {
        const localWarning = createFailureWarning('llm_local_unavailable', 'local', localError)
        onWarning?.(localWarning)

        if (!cloudApiKey) {
          return createDegradedResponse('llm_local_unavailable', 'local', localError)
        }

        try {
          const text = await callChatCompletion({
            fetchImpl,
            baseUrl: cloudBaseUrl,
            model: cloudModel,
            apiKey: cloudApiKey,
            timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : (Number.isFinite(cloudTimeoutMs) ? cloudTimeoutMs : 2800),
            messages: payloadMessages,
            temperature,
            maxTokens
          })

          return {
            text,
            provider: 'cloud',
            model: cloudModel,
            warnings: [localWarning]
          }
        } catch (cloudError) {
          const cloudWarning = createFailureWarning('llm_cloud_unavailable', 'cloud', cloudError)
          onWarning?.(cloudWarning)
          return createDegradedResponse(
            'llm_cloud_unavailable',
            'cloud',
            cloudError,
            [localWarning, cloudWarning]
          )
        }
      }
    }
  }
}

export {
  cleanModelOutput,
  extractContent,
  isTestRuntime,
  normalizeBaseUrl,
  resolveLlmEnabled,
  toBoolean
}
