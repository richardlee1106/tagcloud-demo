import { runSingleRoundPlannerQuery } from './plannerRunner.js'
import { synthesizeAnswer } from './answerSynthesis.js'

function pickLatestUserQuery(messages = []) {
  const normalizedMessages = Array.isArray(messages) ? messages : []
  for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
    const message = normalizedMessages[index]
    if (message?.role !== 'user') continue
    const content = String(message?.content || '').trim()
    if (content) return content
  }
  return ''
}

function buildRunnerOptions({ synthesisMode = 'fallback' } = {}) {
  return {
    synthesizeAnswer: synthesisMode === 'llm'
      ? synthesizeAnswer
      : async (payload) => synthesizeAnswer({
          ...payload,
          llmCall: null
        }),
    planningOptions: {
      max_repairs: 1,
      prompt_profile: 'runtime',
      llm_options: {
        temperature: 0,
        maxTokens: 1024,
        timeout: Number(process.env.PLANNER_EVAL_TIMEOUT_MS || 180000),
        retries: Number(process.env.PLANNER_EVAL_RETRIES || 0)
      }
    }
  }
}

export function createPlannerDemoService({
  runSingleRoundPlannerQuery: runSingleRoundPlannerQueryImpl = runSingleRoundPlannerQuery
} = {}) {
  return {
    async runChatRequest({ messages = [], options = {} } = {}) {
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('messages is required')
      }

      const query = pickLatestUserQuery(messages)
      if (!query) {
        throw new Error('user message is required')
      }

      const synthesisMode = String(options?.synthesisMode || 'fallback').trim().toLowerCase() || 'fallback'
      const result = await runSingleRoundPlannerQueryImpl(
        query,
        {
          synthesisMode,
          spatialContext: options?.spatialContext || null,
          ...buildRunnerOptions({ synthesisMode })
        }
      )

      return {
        success: Boolean(result?.ok),
        backend: 'planner_line_prototype',
        query,
        answer: {
          text: result?.synthesis?.answer || null,
          source: result?.synthesis?.source || null
        },
        planning: {
          source: result?.planning?.source || null,
          plan: result?.planning?.plan || null,
          attempts: result?.planning?.attempts || []
        },
        execution: {
          trace: result?.execution?.execution_trace || null,
          evidence_bundle: result?.execution?.evidence_bundle || null
        },
        stage: result?.stage || null,
        error: result?.error || null
      }
    }
  }
}

export default {
  createPlannerDemoService
}
