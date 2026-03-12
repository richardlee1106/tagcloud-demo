import test from 'node:test'
import assert from 'node:assert/strict'

import { createAgentEventHub } from '../src/orchestrator/agent-event-hub.js'
import { createOrchestrationKernel } from '../src/orchestrator/orchestration-kernel.js'

test('uses provided deep scheduler and event hub dispatch', async () => {
  const calls = []
  const eventHub = createAgentEventHub()
  eventHub.subscribe('topic.route', async (input) => {
    calls.push(`routed:${input.query}`)
    return { objective: 'area_briefing' }
  }, { agentId: 'routing-agent' })

  const kernel = createOrchestrationKernel({
    scheduleDeepLane(task) {
      calls.push('scheduled')
      return task()
    },
    eventHub
  })

  await kernel.enqueueDeepLane(async () => {
    calls.push('ran')
  })

  const routing = await kernel.dispatch('topic.route', { query: 'hello' })

  assert.deepEqual(calls, ['scheduled', 'ran', 'routed:hello'])
  assert.equal(routing.objective, 'area_briefing')
  assert.deepEqual(kernel.listAgentSubscribers(), [
    { topic: 'topic.route', agent_id: 'routing-agent' }
  ])
})
