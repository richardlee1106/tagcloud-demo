import { SPATIAL_TOOL_NAMES } from './toolSchemas.js'

export const SPATIAL_TOOL_CATALOG = Object.freeze({
  'spatial_core.resolve_anchor': {
    tool_name: 'spatial_core.resolve_anchor',
    handler_key: 'resolve_anchor',
    description: '使用 PostGIS 模糊地名解析与现有锚点解析逻辑，将 place_name 解析为结构化 anchor 对象。',
    planning_notes: '优先用于 place_name -> anchor 的解析。B2/B3 期间意图推断职责仍可能由 infer_intent_legacy 承接。',
    reliability: 'high_with_legacy_dependency'
  },
  'spatial_core.search_nearby_pois': {
    tool_name: 'spatial_core.search_nearby_pois',
    handler_key: 'search_nearby_pois',
    description: 'PostGIS-first 的近邻 POI 检索工具：先做半径过滤，再在内部做编码器排序增强。',
    planning_notes: 'planner 只能提供 anchor + radius_m + filter + limit。embedding 仅是内部排序增强，不能作为精确距离或范围查询参数暴露给 planner。',
    reliability: 'high_postgis_backbone'
  },
  'spatial_core.vector_search': {
    tool_name: 'spatial_core.vector_search',
    handler_key: 'vector_search',
    description: '面向语义相似度排序的向量检索能力，用于 PostGIS 之外的语义近邻补充。',
    planning_notes: '适合表达“像什么”，不适合表达“多少米内”。',
    reliability: 'semantic_only'
  },
  'spatial_core.macro_cell_analysis': {
    tool_name: 'spatial_core.macro_cell_analysis',
    handler_key: 'macro_cell_analysis',
    description: '调用 cell 级空间编码器做宏观区域结构、support buckets 与区域对比分析。',
    planning_notes: '适合 area_overview、support_gap_analysis、region_comparison、site_suitability 等宏观题。',
    reliability: 'high_for_macro_patterns'
  },
  'spatial_core.spatial_encode': {
    tool_name: 'spatial_core.spatial_encode',
    handler_key: 'spatial_encode',
    description: '对 anchor 或点位做空间 enrichment，例如方向、区域分类等补充信息。',
    planning_notes: '属于 enrichment 工具，不是主检索骨架。',
    reliability: 'high_for_enrichment'
  },
  'spatial_core.build_boundary': {
    tool_name: 'spatial_core.build_boundary',
    handler_key: 'build_boundary',
    description: '基于已命中的空间结果构建 boundary、hotspots 与空间聚类摘要。',
    planning_notes: '适合作为 overview 类问题的后处理步骤，而不是独立事实来源。',
    reliability: 'medium_with_coupling'
  },
  'spatial_core.infer_intent_legacy': {
    tool_name: 'spatial_core.infer_intent_legacy',
    handler_key: 'infer_intent_legacy',
    description: '过渡期 legacy 意图理解工具，用于承接 task_type / facets / anchor_mode 的旧逻辑。',
    planning_notes: '仅在阶段 C/E 迁移完成前作为兜底使用，未来应逐步废弃。',
    reliability: 'transitional_only'
  }
})

export function getToolCatalog() {
  return SPATIAL_TOOL_CATALOG
}

export function getToolDefinition(toolName) {
  return SPATIAL_TOOL_CATALOG[toolName] || null
}

export function listToolNames() {
  return [...SPATIAL_TOOL_NAMES]
}

export default {
  SPATIAL_TOOL_CATALOG,
  getToolCatalog,
  getToolDefinition,
  listToolNames
}
