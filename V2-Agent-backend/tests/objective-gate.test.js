import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyArtifactPolicy,
  applyLatencyGate,
  buildSpecialistTaskPlan,
  computeMissingMustCoverSections
} from '../src/runtime/objective-gate.js'

test('builds specialist task plan by merging routing selection and must_cover sections', () => {
  const tasks = buildSpecialistTaskPlan({
    routingOutput: {
      objective: 'area_briefing',
      selected_agents: ['hotspots']
    },
    objectiveContract: {
      must_cover: ['dominant_industries', 'hotspots', 'opportunity_points']
    },
    fallbackSpecialistsByObjective: {
      area_briefing: ['hotspots']
    },
    groundingResult: { coverage: { status: 'sufficient' } }
  })

  assert.deepEqual(
    tasks.map((task) => task.specialist_id),
    ['hotspots', 'dominant_industries', 'opportunity_points']
  )
})

test('reports missing must_cover sections from specialist outputs', () => {
  const missing = computeMissingMustCoverSections({
    objectiveContract: {
      must_cover: ['dominant_industries', 'hotspots', 'opportunity_points']
    },
    specialistResults: [
      { section_type: 'hotspots' }
    ]
  })

  assert.deepEqual(missing.sort(), ['dominant_industries', 'opportunity_points'].sort())
})

test('applies latency gate and disables deep lane when elapsed exceeds budget', () => {
  const decision = applyLatencyGate({
    qualityDecision: {
      decision: 'pass',
      reason_codes: [],
      required_disclaimers: [],
      allowed_output: {
        can_emit_fast: true,
        can_emit_deep: true,
        can_claim_artifact: false
      },
      next_action: 'continue'
    },
    objectiveContract: {
      latency_budget_ms: 1000
    },
    elapsedMs: 1800
  })

  assert.equal(decision.allowed_output.can_emit_deep, false)
  assert.equal(decision.reason_codes.includes('latency_budget_exceeded'), true)
  assert.equal(decision.next_action, 'continue_with_constraints')
})

test('removes artifact payload when objective policy does not require artifacts', () => {
  const payload = applyArtifactPolicy({
    payload: {
      objective: 'area_briefing',
      artifact: {
        path: 'artifacts/a.geojson'
      }
    },
    objectiveContract: {
      artifact_policy: {
        artifact_required: false
      }
    }
  })

  assert.equal(payload.artifact, undefined)
  assert.equal(payload.objective, 'area_briefing')
})
