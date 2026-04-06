import { normalizeRefinedResultEvidence } from '../refinedResultEvidence'

describe('normalizeRefinedResultEvidence V4 extensions', () => {
  it('extracts evidence view and tool calls from refined_result payload', () => {
    const normalized = normalizeRefinedResultEvidence({
      trace_id: 'trace_phase3_frontend',
      tool_calls: [
        { skill: 'postgis', action: 'resolve_anchor', status: 'done' }
      ],
      results: {
        evidence_view: {
          type: 'poi_list',
          anchor: { displayName: '武汉大学' },
          items: [{ name: 'luckin coffee' }],
          meta: { radiusM: 800 }
        },
        stats: { query_type: 'nearby_poi' }
      }
    })

    expect(normalized.evidenceView).toMatchObject({
      type: 'poi_list'
    })
    expect(normalized.toolCalls).toHaveLength(1)
  })
})
