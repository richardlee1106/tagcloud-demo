import { describe, expect, it } from 'vitest'

import { shouldUsePlannerLineChat } from '../../planner_line/plannerChatGate.js'

describe('plannerChatGate', () => {
  it('requires explicit opt-in before routing /api/ai/chat to planner_line', () => {
    const result = shouldUsePlannerLineChat({
      isSpatialQuery: true,
      intent: { taskType: 'nearby_lookup' },
      options: {},
      env: {
        PLANNER_CHAT_ENABLED: 'true',
        PLANNER_CHAT_TASK_TYPES: 'nearby_lookup'
      }
    })

    expect(result).toBe(false)
  })

  it('allows whitelisted task types when feature flag and opt-in are enabled', () => {
    const result = shouldUsePlannerLineChat({
      isSpatialQuery: true,
      intent: { taskType: 'nearby_lookup' },
      options: { plannerLine: true },
      env: {
        PLANNER_CHAT_ENABLED: 'true',
        PLANNER_CHAT_TASK_TYPES: 'nearby_lookup,area_overview'
      }
    })

    expect(result).toBe(true)
  })

  it('keeps non-whitelisted task types on the legacy path', () => {
    const result = shouldUsePlannerLineChat({
      isSpatialQuery: true,
      intent: { taskType: 'region_comparison' },
      options: { plannerLine: true },
      env: {
        PLANNER_CHAT_ENABLED: 'true',
        PLANNER_CHAT_TASK_TYPES: 'nearby_lookup'
      }
    })

    expect(result).toBe(false)
  })
})
