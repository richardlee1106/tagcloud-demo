import test from 'node:test'
import assert from 'node:assert/strict'

import { createIntentRouterAgent } from '../src/agents/intent-router-agent.js'
import { createLlmRouterAgent } from '../src/agents/llm-router-agent.js'

test('uses llm routing decision when objective is allowlisted', async () => {
  const router = createIntentRouterAgent({
    llmRouterAgent: {
      async decide() {
        return {
          objective: 'hotspot_analysis',
          confidence: 0.93,
          selected_agents: ['hotspots'],
          reasoning: 'hotspot keywords dominate'
        }
      }
    }
  })

  const routing = await router.route({
    query: 'Give me a 30s briefing of this area with hotspots',
    viewport: {
      zoom: 15,
      bbox: [114.30, 30.52, 114.36, 30.57]
    }
  })

  assert.equal(routing.objective, 'hotspot_analysis')
  assert.equal(routing.execution_path, 'new_agent')
  assert.equal(routing.routing_source, 'llm')
  assert.deepEqual(routing.selected_agents, ['hotspots'])
  assert.equal(routing.llm_reasoning, 'hotspot keywords dominate')
})

test('falls back to rule routing when llm decision is invalid', async () => {
  const router = createIntentRouterAgent({
    llmRouterAgent: {
      async decide() {
        return {
          objective: 'totally_invalid_objective',
          confidence: 0.99,
          selected_agents: ['hotspots']
        }
      }
    }
  })

  const routing = await router.route({
    query: 'Give me a 30s briefing of this area: dominant industries, hotspots, and opportunity points.',
    viewport: {
      zoom: 15,
      bbox: [114.30, 30.52, 114.36, 30.57]
    }
  })

  assert.equal(routing.objective, 'area_briefing')
  assert.equal(routing.execution_path, 'new_agent')
  assert.equal(routing.routing_source, 'rule')
  assert.deepEqual(routing.selected_agents, ['dominant_industries', 'hotspots', 'opportunity_points'])
})

test('passes session history into the llm router prompt', async () => {
  let capturedUserPrompt = ''
  const router = createLlmRouterAgent({
    llmGateway: {
      async chat({ userPrompt }) {
        capturedUserPrompt = userPrompt
        return {
          text: JSON.stringify({
            objective: 'area_briefing',
            confidence: 0.87,
            selected_agents: ['dominant_industries', 'hotspots'],
            reasoning: 'history narrows the intent'
          })
        }
      }
    }
  })

  const decision = await router.decide({
    query: 'Then focus on the hotspots only.',
    viewport: {
      zoom: 15,
      bbox: [114.30, 30.52, 114.36, 30.57]
    },
    history: [
      { role: 'user', content: 'Give me a 30s briefing of this area.' },
      { role: 'assistant', content: 'The area is strong in food and retail.' }
    ],
    fallbackRouting: {
      objective: 'area_briefing',
      confidence: 0.76,
      legacy_hint: 'micro-poi-summary',
      routing_features: {
        matched_keywords: {}
      }
    }
  })

  assert.equal(decision.objective, 'area_briefing')
  assert.match(capturedUserPrompt, /Conversation history:/)
  assert.match(capturedUserPrompt, /Give me a 30s briefing of this area\./)
  assert.match(capturedUserPrompt, /The area is strong in food and retail\./)
})
