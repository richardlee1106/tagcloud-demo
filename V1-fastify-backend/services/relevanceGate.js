import { getLLMConfig } from './llm.js'

const CJK_PATTERN = /[\u4e00-\u9fff]/

const GEO_HINT_KEYWORDS = [
  'spatial',
  'geo',
  'geospatial',
  'location',
  'map',
  'poi',
  'nearby',
  'distance',
  'route',
  'region',
  'district',
  'analysis',
  'geographic',
  '\u5730\u7406', // 地理
  '\u7a7a\u95f4', // 空间
  '\u5730\u56fe', // 地图
  '\u4f4d\u7f6e', // 位置
  '\u9644\u8fd1', // 附近
  '\u5468\u8fb9', // 周边
  '\u533a\u57df', // 区域
  '\u9009\u5740', // 选址
  '\u5206\u6790', // 分析
  '\u5206\u5e03', // 分布
  '\u5546\u4e1a', // 商业
  '\u4ea4\u901a', // 交通
  '\u70ed\u529b', // 热力
  '\u7f51\u683c', // 网格
  '\u53ef\u8fbe\u6027' // 可达性
]

const ONLY_SYMBOL_OR_DIGIT_PATTERN = /^[\d_.,!?~\-+=/\\|@#$%^&*()[\]{}:;"'`]+$/
const SHORT_ALNUM_NOISE_PATTERN = /^[a-z0-9]+$/i

const GEO_RELEVANCE_PROMPT = [
  'You are an input gate for a geospatial analysis assistant.',
  'Classify whether the user input is related to geospatial analysis.',
  'Related examples: place/location/nearby/distance/map/POI/region distribution/site selection/urban business analysis.',
  'Not related examples: random gibberish, noise text, pure symbols, irrelevant chit-chat.',
  'Return JSON only:',
  '{ "is_geo_related": true, "confidence": "high", "reason": "short_reason" }'
].join('\n')

export const IRRELEVANT_FRIENDLY_REPLY =
  '\u4f60\u597d\uff01\u6211\u662f Geoloom\uff0c\u5f88\u9ad8\u5174\u89c1\u5230\u4f60\uff01\n\n' +
  '\u770b\u8d77\u6765\u4f60\u53d1\u9001\u4e86\u4e00\u4e2a\u95ee\u9898\uff0c\u4f46\u8fd9\u4e2a\u95ee\u9898\u4f3c\u4e4e\u4e0e\u5730\u7406\u7a7a\u95f4\u5206\u6790\u4e0d\u592a\u76f8\u5173\u5462\u3002\n\n' +
  '\u6211\u53ef\u4ee5\u5e2e\u4f60\u5206\u6790\uff1a\u7a7a\u95f4\u5206\u6790\u3001\u6570\u636e\u53ef\u89c6\u5316\u3001\u667a\u80fd\u95ee\u7b54\u3001\u5546\u4e1a\u6d1e\u5bdf...'

function extractJson(content = '') {
  if (!content) return null
  const cleaned = String(content)
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function parseBooleanLabel(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', 'related', 'relevant', 'geo_related', '\u76f8\u5173', '\u662f'].includes(normalized)) return true
  if (['false', 'no', 'unrelated', 'irrelevant', 'not_related', 'not_relevant', '\u4e0d\u76f8\u5173', '\u5426'].includes(normalized)) return false
  return null
}

export function hasGeoHintKeyword(text = '') {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return false
  return GEO_HINT_KEYWORDS.some((kw) => normalized.includes(kw))
}

export function isLikelyNoiseInput(text = '') {
  const compact = String(text || '').trim().replace(/\s+/g, '')
  if (!compact) return true

  if (ONLY_SYMBOL_OR_DIGIT_PATTERN.test(compact)) return true
  if (/^(.)\1{4,}$/u.test(compact)) return true
  if (SHORT_ALNUM_NOISE_PATTERN.test(compact) && compact.length <= 12) return true

  return false
}

export function shouldHardBlockInput(text = '') {
  const normalized = String(text || '').trim()
  if (!normalized) return true

  const compact = normalized.replace(/\s+/g, '')
  if (isLikelyNoiseInput(compact)) return true

  if (hasGeoHintKeyword(normalized)) return false

  const hasCjk = CJK_PATTERN.test(normalized)
  if (!hasCjk && /^[a-z0-9_-]+$/i.test(compact) && compact.length <= 16) {
    return true
  }

  if (!hasCjk && compact.length >= 12 && compact.length <= 64) {
    const lower = compact.toLowerCase()
    const uniqueRatio = new Set(lower.split('')).size / lower.length
    if (uniqueRatio <= 0.28 && !/[?.!]/.test(compact)) {
      return true
    }
  }

  return false
}

export async function classifyGeoRelevance(text = '', context = {}) {
  const normalized = String(text || '').trim()
  if (!normalized) {
    return {
      isGeoRelated: false,
      confidence: 'high',
      reason: 'empty_question',
      source: 'rule',
      tokenUsage: null
    }
  }

  if (shouldHardBlockInput(normalized)) {
    return {
      isGeoRelated: false,
      confidence: 'high',
      reason: 'hard_rule_block',
      source: 'rule',
      tokenUsage: null
    }
  }

  if (hasGeoHintKeyword(normalized)) {
    return {
      isGeoRelated: true,
      confidence: 'high',
      reason: 'geo_keyword_hint',
      source: 'rule',
      tokenUsage: null
    }
  }

  try {
    const { baseUrl, model, apiKey } = await getLLMConfig()
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: GEO_RELEVANCE_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              question: normalized,
              hasSelectedArea: Boolean(context?.hasSelectedArea),
              poiCount: Number(context?.poiCount || 0)
            })
          }
        ],
        temperature: 0,
        max_tokens: 80
      })
    })

    if (!response.ok) {
      throw new Error(`relevance_api_error:${response.status}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content || ''
    const parsed = extractJson(content) || {}
    const rawLabel = parsed.is_geo_related ?? parsed.is_related ?? parsed.related
    const llmDecision = parseBooleanLabel(rawLabel)

    if (llmDecision === null) {
      throw new Error('relevance_parse_error')
    }

    const confidenceRaw = String(parsed.confidence || '').trim().toLowerCase()
    const confidence = ['high', 'medium', 'low'].includes(confidenceRaw) ? confidenceRaw : 'medium'
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 120)
      : 'llm_gate'

    return {
      isGeoRelated: llmDecision,
      confidence,
      reason,
      source: 'llm',
      tokenUsage: data?.usage || null
    }
  } catch (err) {
    const hasCjk = CJK_PATTERN.test(normalized)
    return {
      isGeoRelated: hasCjk,
      confidence: 'low',
      reason: `fallback:${err.message}`,
      source: 'heuristic',
      tokenUsage: null
    }
  }
}

export default {
  IRRELEVANT_FRIENDLY_REPLY,
  hasGeoHintKeyword,
  isLikelyNoiseInput,
  shouldHardBlockInput,
  classifyGeoRelevance
}

