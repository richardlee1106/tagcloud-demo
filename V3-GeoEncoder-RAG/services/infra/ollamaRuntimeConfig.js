function toFinitePort(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10)
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= 65535) {
    return numeric
  }
  return fallback
}

function normalizeHost(value) {
  const raw = String(value || '').trim()
  if (!raw) return '127.0.0.1'
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    || '127.0.0.1'
}

function parseEndpointFromBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    return {
      host: normalizeHost(url.hostname),
      port: toFinitePort(url.port, 22114)
    }
  } catch {
    return null
  }
}

const envBaseEndpoint = parseEndpointFromBaseUrl(process.env.OLLAMA_BASE_URL)
const initialEndpoint = Object.freeze({
  host: normalizeHost(process.env.OLLAMA_HOST || envBaseEndpoint?.host || '127.0.0.1'),
  port: toFinitePort(process.env.OLLAMA_PORT || envBaseEndpoint?.port, 22114)
})

let runtimeEndpoint = { ...initialEndpoint }

function normalizeEndpoint(endpoint = {}) {
  return {
    host: normalizeHost(endpoint.host ?? runtimeEndpoint.host ?? initialEndpoint.host),
    port: toFinitePort(endpoint.port ?? runtimeEndpoint.port ?? initialEndpoint.port, initialEndpoint.port)
  }
}

export function getOllamaEndpoint() {
  return { ...runtimeEndpoint }
}

export function setOllamaEndpoint(endpoint = {}) {
  runtimeEndpoint = normalizeEndpoint(endpoint)
  return getOllamaEndpoint()
}

export function resetOllamaEndpoint() {
  runtimeEndpoint = { ...initialEndpoint }
  return getOllamaEndpoint()
}

export function getOllamaNativeBaseUrl() {
  const endpoint = getOllamaEndpoint()
  return `http://${endpoint.host}:${endpoint.port}`
}

export function getOllamaOpenAIBaseUrl() {
  return `${getOllamaNativeBaseUrl()}/v1`
}

export function getOllamaLaunchCandidates({ fallbackPorts = [] } = {}) {
  const endpoint = getOllamaEndpoint()
  const candidates = []
  const seen = new Set()

  const pushCandidate = (host, port) => {
    const normalizedHost = normalizeHost(host)
    const normalizedPort = toFinitePort(port, initialEndpoint.port)
    const key = `${normalizedHost}:${normalizedPort}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({
      host: normalizedHost,
      port: normalizedPort
    })
  }

  pushCandidate(endpoint.host, endpoint.port)
  fallbackPorts.forEach((port) => pushCandidate(endpoint.host, port))

  return candidates
}

export const OLLAMA_DEFAULT_ENDPOINT = initialEndpoint
export const OLLAMA_FALLBACK_PORTS = Object.freeze([22114, 11434, 22115, 22116])

export default {
  getOllamaEndpoint,
  getOllamaLaunchCandidates,
  getOllamaNativeBaseUrl,
  getOllamaOpenAIBaseUrl,
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_FALLBACK_PORTS,
  resetOllamaEndpoint,
  setOllamaEndpoint
}
