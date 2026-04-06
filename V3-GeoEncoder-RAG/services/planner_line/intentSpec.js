function cloneList(items = []) {
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : []
}

function cloneObject(value = {}) {
  return value && typeof value === 'object' ? { ...value } : {}
}

export const INTENT_TASK_TYPES = Object.freeze([
  'lookup',
  'overview',
  'comparison',
  'gap',
  'suitability'
])

export const INTENT_TASK_DEFAULTS = Object.freeze({
  lookup: {
    aggregation_mode: 'list',
    ranking_objective: 'distance',
    completeness: 'top_k',
    answer_mode: 'direct_list',
    evidence_policy: {
      must_use_sources: ['postgis'],
      prefer_sources: ['poi_encoder'],
      forbid_sources: [],
      macro_required: false,
      micro_required: true
    },
    representation_policy: {
      representative_example_count: 5,
      allow_local_shop_as_region_representative: true,
      prefer_public_civic_examples: false
    },
    uncertainty_policy: {
      allow_estimation: false,
      require_confidence_note_when_sparse: true
    },
    output_contract: {
      must_include: [],
      must_avoid: ['unverified_claims'],
      tone: 'concise'
    }
  },
  overview: {
    aggregation_mode: 'summary',
    ranking_objective: 'representativeness',
    completeness: 'top_k',
    answer_mode: 'area_portrait',
    evidence_policy: {
      must_use_sources: ['postgis'],
      prefer_sources: ['town_encoder', 'poi_encoder'],
      forbid_sources: [],
      macro_required: true,
      micro_required: true
    },
    representation_policy: {
      representative_example_count: 3,
      allow_local_shop_as_region_representative: false,
      prefer_public_civic_examples: true
    },
    uncertainty_policy: {
      allow_estimation: false,
      require_confidence_note_when_sparse: true
    },
    output_contract: {
      must_include: [],
      must_avoid: ['unverified_claims'],
      tone: 'analytical'
    }
  },
  comparison: {
    aggregation_mode: 'comparison',
    ranking_objective: 'representativeness',
    completeness: 'top_k',
    answer_mode: 'contrast',
    evidence_policy: {
      must_use_sources: ['postgis'],
      prefer_sources: ['town_encoder', 'poi_encoder'],
      forbid_sources: [],
      macro_required: true,
      micro_required: true
    },
    representation_policy: {
      representative_example_count: 3,
      allow_local_shop_as_region_representative: false,
      prefer_public_civic_examples: true
    },
    uncertainty_policy: {
      allow_estimation: false,
      require_confidence_note_when_sparse: true
    },
    output_contract: {
      must_include: [],
      must_avoid: ['unverified_claims'],
      tone: 'analytical'
    }
  },
  gap: {
    aggregation_mode: 'summary',
    ranking_objective: 'completeness',
    completeness: 'top_k',
    answer_mode: 'area_portrait',
    evidence_policy: {
      must_use_sources: ['postgis'],
      prefer_sources: ['town_encoder', 'poi_encoder'],
      forbid_sources: [],
      macro_required: true,
      micro_required: true
    },
    representation_policy: {
      representative_example_count: 3,
      allow_local_shop_as_region_representative: false,
      prefer_public_civic_examples: true
    },
    uncertainty_policy: {
      allow_estimation: false,
      require_confidence_note_when_sparse: true
    },
    output_contract: {
      must_include: [],
      must_avoid: ['unverified_claims'],
      tone: 'analytical'
    }
  },
  suitability: {
    aggregation_mode: 'summary',
    ranking_objective: 'semantic_relevance',
    completeness: 'top_k',
    answer_mode: 'recommendation',
    evidence_policy: {
      must_use_sources: ['postgis'],
      prefer_sources: ['town_encoder', 'poi_encoder'],
      forbid_sources: [],
      macro_required: true,
      micro_required: true
    },
    representation_policy: {
      representative_example_count: 3,
      allow_local_shop_as_region_representative: false,
      prefer_public_civic_examples: true
    },
    uncertainty_policy: {
      allow_estimation: false,
      require_confidence_note_when_sparse: true
    },
    output_contract: {
      must_include: [],
      must_avoid: ['unverified_claims'],
      tone: 'analytical'
    }
  }
})

export const ENTITY_FOCUS_LIBRARY = Object.freeze({
  '地铁站': {
    aliases: ['地铁站', '地铁口', '地铁', '轨道交通', '轻轨'],
    target_entities: [{ type: 'transport_node', value: '地铁站' }],
    include_entities: [],
    exclude_entities: [{ type: 'transport_node', value: '公交车站' }],
    focus_terms: ['地铁站'],
    entity_resolution: {
      merge_station_exits: true
    }
  },
  '公交车站': {
    aliases: ['公交车站', '公交站', '公交', '巴士站', 'brt'],
    target_entities: [{ type: 'transport_node', value: '公交车站' }],
    include_entities: [],
    exclude_entities: [{ type: 'transport_node', value: '地铁站' }],
    focus_terms: ['公交车站'],
    entity_resolution: {
      merge_station_exits: true
    }
  },
  '公共交通': {
    aliases: ['公共交通', '公共出行'],
    target_entities: [
      { type: 'transport_node', value: '地铁站' },
      { type: 'transport_node', value: '公交车站' }
    ],
    include_entities: [],
    exclude_entities: [],
    focus_terms: ['公共交通'],
    entity_resolution: {
      merge_station_exits: true
    }
  },
  '空间结构': {
    aliases: ['空间结构', '区域结构', '空间格局'],
    target_entities: [{ type: 'region_feature', value: '空间结构' }],
    include_entities: [],
    exclude_entities: [],
    focus_terms: ['空间结构']
  },
  '业态分布': {
    aliases: ['业态分布', '业态', '商业分布'],
    target_entities: [{ type: 'category_bucket', value: '业态分布' }],
    include_entities: [],
    exclude_entities: [],
    focus_terms: ['业态分布']
  }
})

export function createTaskDefaults(taskType = 'lookup') {
  const defaults = INTENT_TASK_DEFAULTS[taskType] || INTENT_TASK_DEFAULTS.lookup
  return {
    aggregation_mode: defaults.aggregation_mode,
    ranking_objective: defaults.ranking_objective,
    completeness: defaults.completeness,
    answer_mode: defaults.answer_mode,
    evidence_policy: cloneObject(defaults.evidence_policy),
    representation_policy: cloneObject(defaults.representation_policy),
    uncertainty_policy: cloneObject(defaults.uncertainty_policy),
    output_contract: {
      ...cloneObject(defaults.output_contract),
      must_include: [...(defaults.output_contract?.must_include || [])],
      must_avoid: [...(defaults.output_contract?.must_avoid || [])]
    }
  }
}

function dedupeEntities(items = []) {
  const seen = new Set()
  const deduped = []

  for (const item of Array.isArray(items) ? items : []) {
    const type = String(item?.type || '').trim()
    const value = String(item?.value || '').trim()
    if (!type || !value) continue
    const key = `${type}:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push({ type, value })
  }

  return deduped
}

export function mergeFocusProfiles(profiles = []) {
  const merged = {
    target_entities: [],
    include_entities: [],
    exclude_entities: [],
    focus_terms: [],
    entity_resolution: {}
  }

  for (const profile of Array.isArray(profiles) ? profiles : []) {
    merged.target_entities.push(...cloneList(profile?.target_entities))
    merged.include_entities.push(...cloneList(profile?.include_entities))
    merged.exclude_entities.push(...cloneList(profile?.exclude_entities))
    merged.focus_terms.push(...(Array.isArray(profile?.focus_terms) ? profile.focus_terms : []))
    merged.entity_resolution = {
      ...merged.entity_resolution,
      ...cloneObject(profile?.entity_resolution)
    }
  }

  return {
    target_entities: dedupeEntities(merged.target_entities),
    include_entities: dedupeEntities(merged.include_entities),
    exclude_entities: dedupeEntities(merged.exclude_entities),
    focus_terms: [...new Set(merged.focus_terms.map((item) => String(item || '').trim()).filter(Boolean))],
    entity_resolution: merged.entity_resolution
  }
}

export function createBaseIntentSpec({
  task_type = 'lookup',
  spatial_scope = {},
  semantic_focus_terms = [],
  target_entities = [],
  include_entities = [],
  exclude_entities = [],
  aggregation_mode = null,
  ranking_objective = null,
  completeness = null,
  answer_mode = null,
  entity_resolution = {},
  spatial_relation = {},
  evidence_policy = {},
  representation_policy = {},
  uncertainty_policy = {},
  output_contract = {},
  needs_clarification = false,
  missing_inputs = []
} = {}) {
  const taskDefaults = createTaskDefaults(task_type)

  return {
    task_type,
    spatial_scope: {
      mode: spatial_scope.mode || 'anchor_radius',
      anchor_refs: cloneList(spatial_scope.anchor_refs),
      geometry_ref: spatial_scope.geometry_ref ?? null,
      radius_m: spatial_scope.radius_m ?? null
    },
    semantic_focus_terms: [...new Set((Array.isArray(semantic_focus_terms) ? semantic_focus_terms : []).map((item) => String(item || '').trim()).filter(Boolean))],
    target_entities: dedupeEntities(target_entities),
    include_entities: dedupeEntities(include_entities),
    exclude_entities: dedupeEntities(exclude_entities),
    aggregation_mode: aggregation_mode || taskDefaults.aggregation_mode,
    ranking_objective: ranking_objective || taskDefaults.ranking_objective,
    completeness: completeness || taskDefaults.completeness,
    answer_mode: answer_mode || taskDefaults.answer_mode,
    entity_resolution: {
      merge_station_exits: false,
      merge_same_poi: true,
      category_level: 'bucket',
      ...taskDefaults.entity_resolution,
      ...cloneObject(entity_resolution)
    },
    spatial_relation: {
      relation: 'nearby',
      distance_constraint_m: spatial_scope.radius_m ?? null,
      geometry_constraint: null,
      ...cloneObject(spatial_relation)
    },
    evidence_policy: {
      ...taskDefaults.evidence_policy,
      ...cloneObject(evidence_policy)
    },
    representation_policy: {
      ...taskDefaults.representation_policy,
      ...cloneObject(representation_policy)
    },
    uncertainty_policy: {
      ...taskDefaults.uncertainty_policy,
      ...cloneObject(uncertainty_policy)
    },
    output_contract: {
      ...taskDefaults.output_contract,
      ...cloneObject(output_contract),
      must_include: [...new Set([
        ...(taskDefaults.output_contract?.must_include || []),
        ...(Array.isArray(output_contract?.must_include) ? output_contract.must_include : [])
      ])],
      must_avoid: [...new Set([
        ...(taskDefaults.output_contract?.must_avoid || []),
        ...(Array.isArray(output_contract?.must_avoid) ? output_contract.must_avoid : [])
      ])]
    },
    needs_clarification: Boolean(needs_clarification),
    missing_inputs: [...new Set((Array.isArray(missing_inputs) ? missing_inputs : []).map((item) => String(item || '').trim()).filter(Boolean))]
  }
}

export default {
  ENTITY_FOCUS_LIBRARY,
  INTENT_TASK_DEFAULTS,
  INTENT_TASK_TYPES,
  createBaseIntentSpec,
  createTaskDefaults,
  mergeFocusProfiles
}
