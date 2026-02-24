import { describe, it, expect } from 'vitest'
import { validateSSEEventPayload } from '../../../shared/sseEventSchema.js'

describe('sseEventSchema', () => {
  it('accepts valid stage payload', () => {
    const result = validateSSEEventPayload('stage', { name: 'planner_done' })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects invalid stage payload', () => {
    const result = validateSSEEventPayload('stage', { step: 'planner_done' })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('skips unknown event schema', () => {
    const result = validateSSEEventPayload('custom_event', { any: 'payload' })
    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
  })
})
