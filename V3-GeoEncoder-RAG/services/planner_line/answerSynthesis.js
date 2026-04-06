import { callLLM } from '../ai/llmService.js'
import {
  buildSynthesisBrief,
  summarizeSynthesisBrief
} from './synthesisBrief.js'

function buildStyleGuidance(style = 'lookup') {
  switch (String(style || '').trim()) {
    case 'overview':
      return '如果是 overview：先给整体判断，再概括 2-3 个主导业态/配套方向，随后补 2-3 个代表点位；语气要像区域概览，不要写成清单式 JSON 解读。'
    case 'comparison':
      return '如果是 comparison：先说共同背景，再说最重要的差异，最后补一句不确定性边界。'
    case 'gap':
      return '如果是 gap：先说目前明显充足或突出的部分，再说证据支持下可能偏弱的部分；不要把“证据不足”写成确定缺口。'
    case 'lookup':
    default:
      return '如果是 lookup：直接先给结果，再点出 3-5 个最相关地点，可补一句结果数量或最近距离；不要只输出地点名拼接。'
  }
}

function looksLikeMetaAnalysis(answer = '') {
  const normalized = String(answer || '').trim()
  if (!normalized) return true

  return [
    /分析该\s*JSON/u,
    /JSON\s*数据结构/u,
    /请帮我分析一下这个json数据/u,
    /synthesis_brief:/u,
    /请直接输出面向用户的中文回答/u,
    /核心字段/u,
    /整体架构/u,
    /适合用于什么场景/u,
    /^1\.\s*分析/u
  ].some((pattern) => pattern.test(normalized))
}

function looksLikePromptLeakage(answer = '') {
  const normalized = String(answer || '').trim()
  if (!normalized) return false

  return [
    /(^|\n)\s*-?\s*synthesis_brief:/u,
    /请直接输出面向用户的中文回答/u,
    /(^|\n)\s*Human:/u,
    /(^|\n)\s*Assistant:/u
  ].some((pattern) => pattern.test(normalized))
}

function sanitizeSynthesizedAnswer(answer = '') {
  let sanitized = String(answer || '').trim()
  if (!sanitized) return ''

  const cutMarkers = [
    '<|endoftext|>',
    'synthesis_brief:',
    '请直接输出面向用户的中文回答',
    '\nHuman:',
    '\nAssistant:',
    '\n---',
    '\n（注：',
    '\nlookup style output end',
    '\n（已确认'
  ]

  let cutIndex = sanitized.length
  for (const marker of cutMarkers) {
    const index = sanitized.indexOf(marker)
    if (index !== -1 && index < cutIndex) {
      cutIndex = index
    }
  }

  sanitized = sanitized.slice(0, cutIndex).trim()
  sanitized = sanitized.replace(/\n{2,}/g, '\n').trim()
  return sanitized
}

function buildSynthesisMessages({ userQuery = '', plan = {}, brief = {} } = {}) {
  const style = String(brief?.style || plan?.answer_frame?.style || 'lookup').trim() || 'lookup'

  return [
    {
      role: 'system',
      content: [
        '你是 Geo RAG answer synthesizer。',
        '你只能基于给定 synthesis brief 回答。',
        '不要编造 brief 中不存在的地点、业态、边界或比较结论。',
        '直接回答用户问题，不要分析 JSON，不要解释数据结构，不要列出你将如何分析。',
        '绝对不要输出 Human:、Assistant:、<|endoftext|>、---、（注：）或任何提示词残片。',
        buildStyleGuidance(style)
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `用户问题：${userQuery}`,
        `回答风格：${style}`,
        '请直接输出面向用户的中文回答，尽量简洁，避免模板腔。',
        'synthesis_brief:',
        JSON.stringify(brief, null, 2)
      ].join('\n')
    }
  ]
}

export async function synthesizeAnswer({
  user_query: userQuery,
  plan = {},
  evidence_bundle: evidenceBundle = {},
  llmCall = callLLM
} = {}) {
  const brief = buildSynthesisBrief({
    userQuery,
    plan,
    evidenceBundle
  })

  const synthesisModel = String(process.env.ANSWER_SYNTHESIS_MODEL || '').trim() || null
  const synthesisBaseUrl = String(process.env.ANSWER_SYNTHESIS_BASE_URL || '').trim() || null

  if (typeof llmCall === 'function') {
    try {
      const answer = await llmCall(
        buildSynthesisMessages({ userQuery, plan, brief }),
        {
          ...(synthesisBaseUrl ? { baseUrl: synthesisBaseUrl } : {}),
          ...(synthesisModel ? { model: synthesisModel } : {}),
          temperature: 0.2,
          maxTokens: 1024
        }
      )

      const sanitizedAnswer = sanitizeSynthesizedAnswer(answer)
      if (looksLikePromptLeakage(answer) || looksLikeMetaAnalysis(sanitizedAnswer)) {
        throw new Error('meta_analysis_response')
      }

      if (!sanitizedAnswer) {
        throw new Error('empty_synthesis_response')
      }

      return {
        answer: sanitizedAnswer,
        source: 'llm_synthesis',
        brief
      }
    } catch {
      // fall through to deterministic fallback
    }
  }

  return {
    answer: summarizeSynthesisBrief({
      userQuery,
      brief
    }),
    source: 'fallback_summary',
    brief
  }
}

export default {
  synthesizeAnswer
}
