import test from 'node:test'
import assert from 'node:assert/strict'

import { createAgentEventHub } from '../src/orchestrator/agent-event-hub.js'

test('dispatches requests to subscribed agent handlers', async () => {
  const hub = createAgentEventHub()
  const seen = []

  hub.events.on('agent.request.start', (event) => {
    seen.push(`start:${event.topic}:${event.agent_id}`)
  })
  hub.events.on('agent.request.done', (event) => {
    seen.push(`done:${event.topic}:${event.agent_id}`)
  })

  hub.subscribe('topic.test', async ({ value }) => ({ doubled: value * 2 }), { agentId: 'math-agent' })

  const result = await hub.request('topic.test', { value: 21 })
  assert.equal(result.doubled, 42)
  assert.deepEqual(seen, ['start:topic.test:math-agent', 'done:topic.test:math-agent'])
  assert.deepEqual(hub.listSubscribers(), [{ topic: 'topic.test', agent_id: 'math-agent' }])
})

test('throws when no handler or ambiguous handlers exist', async () => {
  const hub = createAgentEventHub()

  await assert.rejects(() => hub.request('topic.none', {}), /event_handler_missing/)

  hub.subscribe('topic.dup', async () => 1, { agentId: 'a1' })
  hub.subscribe('topic.dup', async () => 2, { agentId: 'a2' })
  await assert.rejects(() => hub.request('topic.dup', {}), /event_handler_ambiguous/)
})
