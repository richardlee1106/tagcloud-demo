import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useAiStreamDispatcher } from '../useAiStreamDispatcher.js'
import { normalizeRefinedResultEvidence } from '../../../utils/refinedResultEvidence.js'

function setupDispatcher() {
  const messagesRef = ref([{ role: 'assistant', content: '' }])
  const extractedPOIsRef = ref([])
  const emit = vi.fn()

  const dispatcher = useAiStreamDispatcher({
    messagesRef,
    extractedPOIsRef,
    emit,
    normalizeRefinedResultEvidence,
    toEmbeddedIntentMode: () => ''
  })

  return {
    dispatcher,
    emit,
    messagesRef
  }
}

describe('useAiStreamDispatcher prefetch debug fields', () => {
  it('stores prefetch debug info from stats event', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'stats',
      data: {
        prefetch_degraded: true,
        prefetch_wasted: false,
        prefetch_overlap_delta_ms: -42
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'macro'
    })

    expect(messagesRef.value[0].prefetchDebug).toEqual({
      degraded: true,
      wasted: false,
      overlapDeltaMs: -42,
      status: 'degraded'
    })
  })

  it('stores prefetch debug info from refined_result event', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'refined_result',
      data: {
        results: {
          stats: {
            prefetch_degraded: false,
            prefetch_wasted: true,
            prefetch_overlap_delta_ms: -120
          }
        }
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'macro'
    })

    expect(messagesRef.value[0].prefetchDebug).toEqual({
      degraded: false,
      wasted: true,
      overlapDeltaMs: -120,
      status: 'wasted'
    })
  })

  it('stores intent preview data for visible V4 routing feedback', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'intent_preview',
      data: {
        displayAnchor: '武汉大学',
        targetCategory: '咖啡',
        needsClarification: false
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'micro'
    })

    expect(messagesRef.value[0].intentPreview).toEqual(expect.objectContaining({
      displayAnchor: '武汉大学',
      targetCategory: '咖啡',
      needsClarification: false
    }))
    expect(messagesRef.value[0].thinkingMessage).toContain('武汉大学')
  })

  it('stores sessionId from the V4 trace event for continued conversation reuse', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'trace',
      data: {
        trace_id: 'trace_v4_101',
        session_id: 'sess_v4_101'
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'micro'
    })

    expect(messagesRef.value[0].traceId).toBe('trace_v4_101')
    expect(messagesRef.value[0].sessionId).toBe('sess_v4_101')
  })

  it('marks the message as completed when done event arrives', () => {
    const { dispatcher, messagesRef } = setupDispatcher()
    messagesRef.value[0].isThinking = true

    dispatcher.dispatchMetaEvent({
      type: 'done',
      data: {
        duration_ms: 88,
        trace_id: 'trace_v4_001'
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'micro'
    })

    expect(messagesRef.value[0].pipelineCompleted).toBe(true)
    expect(messagesRef.value[0].isThinking).toBe(false)
    expect(messagesRef.value[0].traceId).toBe('trace_v4_001')
  })

  it('stores evidence view and tool calls from refined_result', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'refined_result',
      data: {
        tool_calls: [
          { skill: 'postgis', action: 'resolve_anchor', status: 'done' }
        ],
        results: {
          evidence_view: {
            type: 'transport',
            anchor: { displayName: '武汉大学' },
            items: [{ name: '小洪山地铁站A口' }],
            meta: {}
          },
          stats: {
            query_type: 'nearest_station'
          }
        }
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'micro'
    })

    expect(messagesRef.value[0].evidenceView).toMatchObject({
      type: 'transport'
    })
    expect(messagesRef.value[0].toolCalls).toHaveLength(1)
  })
})
