import test from 'node:test'
import assert from 'node:assert/strict'

import { createLlmQualityJudgeAgent } from '../src/agents/llm-quality-judge-agent.js'

test('returns normalized llm judge decision', async () => {
  const judge = createLlmQualityJudgeAgent({
    enabled: true,
    llmGateway: {
      async chat() {
        return {
          text: JSON.stringify({
            recommended_decision: 'conditional',
            should_downgrade: true,
            can_emit_deep: false,
            confidence: 0.87,
            judge_reason: 'Evidence is sparse for one section.'
          })
        }
      }
    }
  })

  const decision = await judge.judge({
    query: 'area briefing',
    objectiveContract: {
      objective: 'area_briefing',
      must_cover: ['dominant_industries', 'hotspots', 'opportunity_points']
    },
    groundingResult: {
      coverage: {
        status: 'sufficient'
      }
    },
    specialistResults: []
  })

  assert.equal(decision.recommended_decision, 'conditional')
  assert.equal(decision.should_downgrade, true)
  assert.equal(decision.can_emit_deep, false)
  assert.equal(decision.confidence, 0.87)
})
