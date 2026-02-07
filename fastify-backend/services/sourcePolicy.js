/**
 * 源策略工具集。
 *
 * 目标：
 * 1) 统一选区/类别/视窗的约束判定规则。
 * 2) 让 JobRunner / Executor / spatial/fetch 使用同一份逻辑。
 * 3) 任何入口都能稳定产出可解释的 source_policy 快照。
 */

/**
 * 安全解析布尔值。
 * 支持 boolean 与字符串形式（true/false/1/0/on/off/yes/no）。
 */
function toBoolean(value, fallback = null) {
  if (typeof value === 'boolean') return value
  if (value === null || value === undefined || value === '') return fallback

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

/**
 * 归一化前端类别选择器数据，输出最终叶子类列表。
 * 兼容：['咖啡店'] 与 [['餐饮', '咖啡店']] 两种结构。
 */
export function normalizeSelectedCategories(selectedCategories = []) {
  if (!Array.isArray(selectedCategories) || selectedCategories.length === 0) {
    return []
  }

  const normalized = []
  for (const item of selectedCategories) {
    if (Array.isArray(item) && item.length > 0) {
      const leaf = item[item.length - 1]
      if (typeof leaf === 'string' && leaf.trim()) {
        normalized.push(leaf.trim())
      }
      continue
    }

    if (typeof item === 'string' && item.trim()) {
      normalized.push(item.trim())
    }
  }

  return [...new Set(normalized)]
}

/**
 * 判断是否存在“自定义空间约束”。
 * 命中条件：polygon / circle / regions 任意一种存在。
 */
export function hasCustomAreaSelection(spatialContext = {}, options = {}) {
  const mode = String(spatialContext?.mode || '').toLowerCase()
  const hasPolygon = Array.isArray(spatialContext?.boundary) && spatialContext.boundary.length >= 3
  const hasCircle = Boolean(spatialContext?.center) && mode === 'circle'

  const spatialRegions = Array.isArray(spatialContext?.regions) && spatialContext.regions.length > 0
  const optionRegions = Array.isArray(options?.regions) && options.regions.length > 0

  return hasPolygon || hasCircle || spatialRegions || optionRegions
}

/**
 * 解析并执行 source policy。
 *
 * 规则（UI 约束开启时）：
 * - 有选区 + 有类别：按“空间 ∩ 类别”筛选。
 * - 有选区 + 无类别：选区内全类别。
 * - 无选区 + 有类别：视窗内所选类别。
 * - 无选区 + 无类别：视窗内全类别。
 */
export function resolveSourcePolicy(queryPlan = {}, spatialContext = {}, options = {}) {
  const sourcePolicyInput = options?.sourcePolicy || {}

  const selectedFromOptions = options?.selectedCategories
  const selectedFromPolicy = sourcePolicyInput.selectedCategories ?? sourcePolicyInput.selected_categories
  const selectedCategories = normalizeSelectedCategories(
    selectedFromOptions ?? selectedFromPolicy ?? []
  )

  const enforceUiConstraints =
    toBoolean(sourcePolicyInput.enforceUiConstraints, null) ??
    toBoolean(sourcePolicyInput.enforce_ui_constraints, null) ??
    true

  const hasCategoryFilter =
    toBoolean(sourcePolicyInput.hasCategoryFilter, null) ??
    toBoolean(sourcePolicyInput.has_category_filter, null) ??
    selectedCategories.length > 0

  const hasCustomArea =
    toBoolean(sourcePolicyInput.hasCustomArea, null) ??
    toBoolean(sourcePolicyInput.has_custom_area, null) ??
    hasCustomAreaSelection(spatialContext, options)

  if (!enforceUiConstraints) {
    return {
      queryPlan,
      policy: {
        enforce_ui_constraints: false,
        selected_categories: selectedCategories,
        has_category_filter: hasCategoryFilter,
        has_custom_area: hasCustomArea,
        category_source: 'planner_only',
        geometry_source: hasCustomArea ? 'custom_area' : 'viewport_fallback'
      }
    }
  }

  const nextPlan = {
    ...queryPlan,
    categories: Array.isArray(queryPlan?.categories) ? [...queryPlan.categories] : []
  }

  if (hasCategoryFilter && selectedCategories.length > 0) {
    nextPlan.categories = selectedCategories

    if (!nextPlan.semantic_query || typeof nextPlan.semantic_query !== 'string') {
      nextPlan.semantic_query = selectedCategories.join(' ')
    }
  } else {
    nextPlan.categories = []
  }

  const categorySource = hasCategoryFilter && selectedCategories.length > 0
    ? 'ui_selector'
    : 'all_categories'

  return {
    queryPlan: nextPlan,
    policy: {
      enforce_ui_constraints: true,
      selected_categories: selectedCategories,
      has_category_filter: hasCategoryFilter,
      has_custom_area: hasCustomArea,
      category_source: categorySource,
      geometry_source: hasCustomArea ? 'custom_area' : 'viewport_fallback'
    }
  }
}

export default {
  normalizeSelectedCategories,
  hasCustomAreaSelection,
  resolveSourcePolicy
}
