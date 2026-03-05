import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveCriticRoutingPolicy,
  evaluateSyncCriticGate,
  executeSpatialPlanWithFallback
} from '../services/spatialJobRunner.js'

test('resolveCriticRoutingPolicy uses sync critic for critical risk and emulates frontier tier', () => {
  const plan = {
    query_type: 'area_analysis',
    uncertainty: {
      risk_level: 'critical',
      planner_confidence: 0.6,
      clarification: { required: true }
    },
    routing: {
      complexity_score: 8,
      planner_model_tier: 'frontier',
      critic_enabled: true
    }
  }

  const resolved = resolveCriticRoutingPolicy(plan, {})

  assert.equal(resolved.critic_mode, 'sync')
  assert.equal(resolved.frontier_emulated, true)
  assert.equal(resolved.requested_planner_model_tier, 'frontier')
  assert.equal(resolved.effective_planner_model_tier, 'medium')
})

test('resolveCriticRoutingPolicy uses async critic for high risk', () => {
  const resolved = resolveCriticRoutingPolicy(
    {
      query_type: 'area_analysis',
      uncertainty: { risk_level: 'high' },
      routing: { complexity_score: 6 }
    },
    {}
  )

  assert.equal(resolved.critic_mode, 'async')
  assert.equal(resolved.critic_enabled, true)
})

test('resolveCriticRoutingPolicy keeps critic off for low risk when not explicitly enabled', () => {
  const resolved = resolveCriticRoutingPolicy(
    {
      query_type: 'poi_search',
      uncertainty: { risk_level: 'low' },
      routing: { complexity_score: 2 }
    },
    {}
  )

  assert.equal(resolved.critic_mode, 'off')
  assert.equal(resolved.critic_enabled, false)
  assert.equal(resolved.frontier_emulated, false)
})

test('evaluateSyncCriticGate blocks clarification-required plans', () => {
  const decision = evaluateSyncCriticGate({
    queryPlan: {
      query_type: 'area_analysis',
      uncertainty: {
        risk_level: 'critical',
        planner_confidence: 0.42,
        clarification: {
          required: true,
          question: '请确认分析范围'
        }
      }
    },
    criticRouting: {
      critic_mode: 'sync'
    }
  })

  assert.equal(decision.pass, false)
  assert.equal(decision.error_code, 'clarification_needed')
  assert.equal(decision.fix_hint, '请确认分析范围')
})

test('evaluateSyncCriticGate passes non-sync modes without blocking', () => {
  const decision = evaluateSyncCriticGate({
    queryPlan: {
      query_type: 'area_analysis',
      uncertainty: {
        risk_level: 'high',
        planner_confidence: 0.9,
        clarification: {
          required: false,
          question: null
        }
      }
    },
    criticRouting: {
      critic_mode: 'async'
    }
  })

  assert.equal(decision.pass, true)
  assert.equal(decision.error_code, null)
})

test('executeSpatialPlanWithFallback blocks critical low-confidence plan before compute', async () => {
  await assert.rejects(
    executeSpatialPlanWithFallback({
      queryPlan: {
        query_type: 'area_analysis',
        risk_level: 'critical',
        clarification_required: true,
        clarification_question: '请确认分析范围',
        confidence: {
          level: 'critical',
          score: 4
        },
        routing: {
          complexity_score: 8,
          planner_model_tier: 'frontier'
        }
      },
      spatialContext: {
        viewport: [114.30, 30.50, 114.40, 30.60]
      },
      options: {
        mode: 'execute'
      },
      requestId: 'test_critic_block_execute_1'
    }),
    (error) => {
      assert.equal(error?.code, 'clarification_needed')
      return true
    }
  )
})
