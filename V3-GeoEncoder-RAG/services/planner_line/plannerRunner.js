import { synthesizeAnswer as defaultSynthesizeAnswer } from './answerSynthesis.js'
import { createPlanExecutor } from './planExecutor.js'
import { createPlannerService } from './plannerService.js'
import { createIntentSpecService } from './intentSpecService.js'
import { createSpatialCoreToolRunner } from '../spatial_core/defaultHandlers.js'

function isCoordinatePair(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}

function closeRing(ring = []) {
  if (!Array.isArray(ring) || ring.length < 3) return null
  const normalized = ring
    .filter(isCoordinatePair)
    .map((pair) => [Number(pair[0]), Number(pair[1])])

  if (normalized.length < 3) return null

  const [firstLon, firstLat] = normalized[0]
  const [lastLon, lastLat] = normalized[normalized.length - 1]
  if (firstLon !== lastLon || firstLat !== lastLat) {
    normalized.push([firstLon, firstLat])
  }

  return normalized
}

function buildInlineGeometryFromSpatialContext(spatialContext = null) {
  const boundaryRing = closeRing(spatialContext?.boundary)
  if (boundaryRing) {
    return {
      type: 'Polygon',
      coordinates: [boundaryRing]
    }
  }

  return null
}

function normalizePlanAnchors(plan = {}) {
  return (Array.isArray(plan?.anchors) ? plan.anchors : [])
    .map((anchor) => ({
      place_name: String(anchor?.place_name || '').trim(),
      role: String(anchor?.role || '').trim() || 'primary'
    }))
    .filter((anchor) => anchor.place_name)
}

function buildIntentSpecInput({ userQuery = '', plan = {}, spatialContext = null } = {}) {
  const geometry = buildInlineGeometryFromSpatialContext(spatialContext)
  const anchors = normalizePlanAnchors(plan)

  return {
    userQuery,
    ...(geometry ? { geometry } : {}),
    anchors
  }
}

export async function runSingleRoundPlannerQuery(userQuery, {
  planningService = createPlannerService(),
  intentSpecService = createIntentSpecService(),
  executor = createPlanExecutor({
    toolRunner: createSpatialCoreToolRunner()
  }),
  synthesizeAnswer = defaultSynthesizeAnswer,
  planningOptions = {},
  spatialContext = null
} = {}) {
  const planning = await planningService.planQuery(userQuery, planningOptions)

  if (!planning?.ok || !planning?.plan) {
    return {
      ok: false,
      stage: 'planning',
      planning
    }
  }

  try {
    const intentSpec = typeof intentSpecService?.buildIntentSpec === 'function'
      ? intentSpecService.buildIntentSpec(
          buildIntentSpecInput({
            userQuery,
            plan: planning.plan,
            spatialContext
          })
        )
      : null

    const execution = await executor.executePlan(planning.plan, {
      user_query: userQuery,
      intent_spec: intentSpec
    })

    const synthesis = await synthesizeAnswer({
      user_query: userQuery,
      plan: planning.plan,
      evidence_bundle: execution.evidence_bundle
    })

    return {
      ok: true,
      planning,
      execution,
      synthesis
    }
  } catch (error) {
    return {
      ok: false,
      stage: 'execution',
      planning,
      error: error instanceof Error ? error.message : String(error || '')
    }
  }
}

export default {
  runSingleRoundPlannerQuery
}
