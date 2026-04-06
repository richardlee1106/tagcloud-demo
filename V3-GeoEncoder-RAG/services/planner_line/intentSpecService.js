import { resolveEntityIntentFromText } from '../ai/entityOntology.js'
import {
  ENTITY_FOCUS_LIBRARY,
  createBaseIntentSpec,
  createTaskDefaults,
  mergeFocusProfiles
} from './intentSpec.js'

const TASK_SIGNAL_PATTERNS = Object.freeze({
  comparison: /(对比|比较|差异|区别|相比|相较|vs|VS)/u,
  suitability: /(适合|选址|布局|推荐开|开什么|做什么生意)/u,
  gap: /(缺口|短板|不足|空白|缺什么|还缺)/u,
  overview: /(概览|概况|概述|整体|总体|空间结构|业态分布|画像)/u,
  lookup: /(有哪些|哪里有|有什么|列出|清单|名单)/u
})

const GEOMETRY_SCOPE_PATTERNS = /(这个圈|圈里|圈内|框选|选区|多边形|polygon|bbox)/iu
const COMPLETENESS_PATTERNS = /(所有|全部|完整|都有哪些|逐一|穷举)/u
const RADIUS_PATTERN = /(\d+(?:\.\d+)?)\s*(km|公里|千米|m|米)/iu
const NEARBY_PATTERN = /(附近|周边|周围|旁边|一带|内)/u
const LEAD_IN_PATTERN = /^(?:请|请帮我|帮我|麻烦你|麻烦您|请概览|概览|请概述|概述|请概况|概况|请分析|分析|请看看|看看|请问)\s*/u

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizeAnchor(anchor = null, index = 0) {
  if (!anchor) return null

  const placeName = normalizeText(
    typeof anchor === 'string'
      ? anchor
      : anchor.place_name || anchor.placeName || anchor.display_name || anchor.displayName
  )

  if (!placeName) return null

  return {
    place_name: placeName,
    role: normalizeText(
      typeof anchor === 'object'
        ? anchor.role
        : null
    ) || (index === 0 ? 'primary' : index === 1 ? 'secondary' : `anchor_${index + 1}`)
  }
}

function normalizeAnchors({ anchor = null, anchors = [] } = {}) {
  const rawAnchors = Array.isArray(anchors) && anchors.length > 0
    ? anchors
    : anchor
      ? [anchor]
      : []

  const normalized = rawAnchors
    .map((item, index) => normalizeAnchor(item, index))
    .filter(Boolean)

  const deduped = []
  const seen = new Set()
  for (const item of normalized) {
    const key = item.place_name
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return deduped
}

function extractRadiusMeters({ userQuery = '', radius_m: explicitRadius = null } = {}) {
  const numericExplicitRadius = Number(explicitRadius)
  if (Number.isFinite(numericExplicitRadius) && numericExplicitRadius > 0) {
    return Math.round(numericExplicitRadius)
  }

  const match = normalizeText(userQuery).match(RADIUS_PATTERN)
  if (!match) return null

  const numeric = Number(match[1])
  if (!Number.isFinite(numeric) || numeric <= 0) return null

  const unit = String(match[2] || '').toLowerCase()
  if (unit === 'km' || unit === '公里' || unit === '千米') {
    return Math.round(numeric * 1000)
  }

  return Math.round(numeric)
}

function stripLeadIn(text = '') {
  return normalizeText(text).replace(LEAD_IN_PATTERN, '').trim()
}

function extractAnchorFromQuery(userQuery = '') {
  const normalizedQuery = stripLeadIn(userQuery)
  if (!normalizedQuery || GEOMETRY_SCOPE_PATTERNS.test(normalizedQuery)) return null

  const match = normalizedQuery.match(/([\u4e00-\u9fa5A-Za-z0-9·()（）-]{2,40}?)(?:附近|周边|周围|旁边|一带)/u)
  if (!match) return null

  const anchorName = normalizeText(match[1])
  if (!anchorName) return null

  return {
    place_name: anchorName,
    role: 'primary'
  }
}

function containsAlias(text = '', aliases = []) {
  const normalizedText = normalizeText(text).toLowerCase()
  return (Array.isArray(aliases) ? aliases : []).some((alias) => normalizedText.includes(String(alias || '').trim().toLowerCase()))
}

function resolveExplicitFocusProfiles(targets = []) {
  const profiles = []
  for (const target of Array.isArray(targets) ? targets : []) {
    const normalizedTarget = normalizeText(target)
    if (!normalizedTarget) continue

    const profile = ENTITY_FOCUS_LIBRARY[normalizedTarget]
    if (profile) {
      profiles.push(profile)
    }
  }
  return profiles
}

function resolveQueryFocusProfiles(userQuery = '') {
  const profiles = []
  const seen = new Set()

  for (const [concept, profile] of Object.entries(ENTITY_FOCUS_LIBRARY)) {
    if (!containsAlias(userQuery, profile.aliases)) continue
    if (seen.has(concept)) continue
    seen.add(concept)
    profiles.push(profile)
  }

  const semanticIntent = resolveEntityIntentFromText(userQuery)
  const primaryConcept = normalizeText(semanticIntent?.primaryConcept)
  if (primaryConcept && ENTITY_FOCUS_LIBRARY[primaryConcept] && !seen.has(primaryConcept)) {
    profiles.push(ENTITY_FOCUS_LIBRARY[primaryConcept])
  }

  return profiles
}

function determineTaskType({
  userQuery = '',
  explicitTaskType = null,
  hasGeometry = false,
  anchorCount = 0,
  focusTerms = []
} = {}) {
  const normalizedTaskType = normalizeText(explicitTaskType)
  if (normalizedTaskType) return normalizedTaskType

  const query = normalizeText(userQuery)
  if (TASK_SIGNAL_PATTERNS.comparison.test(query) || anchorCount > 1) return 'comparison'
  if (TASK_SIGNAL_PATTERNS.suitability.test(query)) return 'suitability'
  if (TASK_SIGNAL_PATTERNS.gap.test(query)) return 'gap'
  if (TASK_SIGNAL_PATTERNS.overview.test(query)) return 'overview'

  if (hasGeometry && /(分布|结构|概览|画像)/u.test(query)) {
    return 'overview'
  }

  if (focusTerms.includes('公共交通') && !TASK_SIGNAL_PATTERNS.lookup.test(query)) {
    return 'overview'
  }

  return 'lookup'
}

function determineAggregationMode({
  taskType = 'lookup',
  userQuery = '',
  hasGeometry = false,
  explicitAggregationMode = null
} = {}) {
  const normalizedExplicitAggregationMode = normalizeText(explicitAggregationMode)
  if (normalizedExplicitAggregationMode) return normalizedExplicitAggregationMode

  const query = normalizeText(userQuery)

  if (taskType === 'comparison') return 'comparison'
  if (taskType === 'lookup') return 'list'
  if (hasGeometry && /(分布|结构)/u.test(query)) return 'distribution'

  return createTaskDefaults(taskType).aggregation_mode
}

function determineRankingObjective({
  taskType = 'lookup',
  explicitRankingObjective = null
} = {}) {
  const normalizedExplicitRankingObjective = normalizeText(explicitRankingObjective)
  if (normalizedExplicitRankingObjective) return normalizedExplicitRankingObjective
  return createTaskDefaults(taskType).ranking_objective
}

function determineCompleteness({
  userQuery = '',
  explicitCompleteness = null
} = {}) {
  const normalizedExplicitCompleteness = normalizeText(explicitCompleteness)
  if (normalizedExplicitCompleteness) return normalizedExplicitCompleteness
  return COMPLETENESS_PATTERNS.test(userQuery) ? 'exhaustive' : 'top_k'
}

function determineAnswerMode({
  taskType = 'lookup',
  explicitAnswerMode = null
} = {}) {
  const normalizedExplicitAnswerMode = normalizeText(explicitAnswerMode)
  if (normalizedExplicitAnswerMode) return normalizedExplicitAnswerMode
  return createTaskDefaults(taskType).answer_mode
}

function buildSpatialScope({
  userQuery = '',
  geometry = null,
  anchors = [],
  radiusM = null
} = {}) {
  if (geometry) {
    return {
      mode: 'geometry',
      anchor_refs: [],
      geometry_ref: 'inline_geometry',
      radius_m: null
    }
  }

  const normalizedAnchors = Array.isArray(anchors) ? anchors : []
  if (normalizedAnchors.length > 1) {
    return {
      mode: 'dual_anchor',
      anchor_refs: normalizedAnchors,
      geometry_ref: null,
      radius_m: radiusM
    }
  }

  if (normalizedAnchors.length === 1 || NEARBY_PATTERN.test(userQuery)) {
    return {
      mode: 'anchor_radius',
      anchor_refs: normalizedAnchors,
      geometry_ref: null,
      radius_m: radiusM
    }
  }

  return {
    mode: 'region',
    anchor_refs: normalizedAnchors,
    geometry_ref: null,
    radius_m: radiusM
  }
}

function buildSpatialRelation({
  taskType = 'lookup',
  geometry = null,
  radiusM = null
} = {}) {
  if (geometry) {
    return {
      relation: 'inside',
      distance_constraint_m: null,
      geometry_constraint: 'strict_inside'
    }
  }

  if (taskType === 'comparison') {
    return {
      relation: 'compare',
      distance_constraint_m: radiusM,
      geometry_constraint: null
    }
  }

  return {
    relation: 'nearby',
    distance_constraint_m: radiusM,
    geometry_constraint: null
  }
}

function buildMissingInputs({
  spatialScope = {},
  taskType = 'lookup',
  targetEntities = [],
  geometry = null
} = {}) {
  const missingInputs = []

  if (spatialScope.mode === 'geometry' && !geometry) {
    missingInputs.push('geometry')
  }

  if (
    spatialScope.mode !== 'geometry' &&
    (!Array.isArray(spatialScope.anchor_refs) || spatialScope.anchor_refs.length === 0) &&
    taskType !== 'region'
  ) {
    missingInputs.push('anchor_or_geometry')
  }

  if (taskType === 'comparison' && (!Array.isArray(spatialScope.anchor_refs) || spatialScope.anchor_refs.length < 2)) {
    missingInputs.push('comparison_anchor')
  }

  if (taskType === 'lookup' && (!Array.isArray(targetEntities) || targetEntities.length === 0)) {
    missingInputs.push('target_entities')
  }

  return missingInputs
}

function mergeEntityResolution(base = {}, extension = {}) {
  return {
    ...base,
    ...extension
  }
}

export function createIntentSpecService({
  resolveSemanticIntent = resolveEntityIntentFromText
} = {}) {
  return {
    buildIntentSpec({
      userQuery = '',
      geometry = null,
      anchor = null,
      anchors = [],
      radius_m = null,
      targetEntity = null,
      targetEntities = [],
      taskType = null,
      aggregationMode = null,
      rankingObjective = null,
      completeness = null,
      answerMode = null
    } = {}) {
      const explicitTargets = [
        ...targetEntities,
        ...(targetEntity ? [targetEntity] : [])
      ]
        .map((item) => normalizeText(item))
        .filter(Boolean)

      const normalizedAnchors = normalizeAnchors({
        anchor: anchor || extractAnchorFromQuery(userQuery),
        anchors
      })

      const queryProfiles = resolveQueryFocusProfiles(userQuery)
      const explicitProfiles = resolveExplicitFocusProfiles(explicitTargets)
      const semanticIntent = resolveSemanticIntent(userQuery)
      const semanticPrimaryConcept = normalizeText(semanticIntent?.primaryConcept)
      const semanticProfile = semanticPrimaryConcept ? ENTITY_FOCUS_LIBRARY[semanticPrimaryConcept] : null

      const focusProfiles = [
        ...explicitProfiles,
        ...queryProfiles,
        ...(semanticProfile ? [semanticProfile] : [])
      ]

      const mergedProfiles = mergeFocusProfiles(focusProfiles)
      const radiusM = extractRadiusMeters({ userQuery, radius_m })
      const task_type = determineTaskType({
        userQuery,
        explicitTaskType: taskType,
        hasGeometry: Boolean(geometry),
        anchorCount: normalizedAnchors.length,
        focusTerms: mergedProfiles.focus_terms
      })
      const spatial_scope = buildSpatialScope({
        userQuery,
        geometry,
        anchors: normalizedAnchors,
        radiusM
      })
      const aggregation_mode = determineAggregationMode({
        taskType: task_type,
        userQuery,
        hasGeometry: Boolean(geometry),
        explicitAggregationMode: aggregationMode
      })
      const ranking_objective = determineRankingObjective({
        taskType: task_type,
        explicitRankingObjective: rankingObjective
      })
      const completenessValue = determineCompleteness({
        userQuery,
        explicitCompleteness: completeness
      })
      const answer_mode = determineAnswerMode({
        taskType: task_type,
        explicitAnswerMode: answerMode
      })
      const target_entities = mergedProfiles.target_entities
      const missing_inputs = buildMissingInputs({
        spatialScope: spatial_scope,
        taskType: task_type,
        targetEntities: target_entities,
        geometry
      })
      const needs_clarification = missing_inputs.length > 0

      return createBaseIntentSpec({
        task_type,
        spatial_scope,
        semantic_focus_terms: mergedProfiles.focus_terms,
        target_entities,
        include_entities: mergedProfiles.include_entities,
        exclude_entities: mergedProfiles.exclude_entities,
        aggregation_mode,
        ranking_objective,
        completeness: completenessValue,
        answer_mode,
        entity_resolution: mergeEntityResolution(
          {
            merge_station_exits: false,
            merge_same_poi: true,
            category_level: task_type === 'lookup' ? 'sub' : 'bucket'
          },
          mergedProfiles.entity_resolution
        ),
        spatial_relation: buildSpatialRelation({
          taskType: task_type,
          geometry,
          radiusM
        }),
        evidence_policy: task_type === 'overview' && mergedProfiles.focus_terms.includes('公共交通')
          ? {
              macro_required: true,
              micro_required: true
            }
          : {},
        needs_clarification,
        missing_inputs
      })
    }
  }
}

export default {
  createIntentSpecService
}
