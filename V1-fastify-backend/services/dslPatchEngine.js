import { validateDslPolicyRules } from './dslPolicyRules.js'

const SUPPORTED_PATCH_OPS = new Set(['add', 'remove', 'replace'])

const PATCH_WHITELIST_EXACT = new Set([
  '/entities/categories',
  '/entities/keywords',
  '/output_contract/include_writer_text',
  '/output_contract/max_items'
])

const PATCH_BLACKLIST_EXACT = new Set([
  '/trace_id',
  '/session_id'
])

const PATCH_BLACKLIST_PREFIX = [
  '/policy',
  '/uncertainty',
  '/routing'
]

const PATCH_REBUILD_EXACT = new Set([
  '/task/query_type',
  '/entities/anchor'
])

const PATCH_REBUILD_PREFIX = [
  '/scope'
]

const CONSTRAINTS_PATCHABLE_FIELDS = new Set([
  'rating_min',
  'rating_max',
  'distance_max_m',
  'direction',
  'open_now',
  'result_limit',
  'latency_budget_ms',
  'token_budget',
  'max_region_outputs'
])

function normalizeText(value) {
  return String(value || '').trim()
}

function deepClone(value) {
  if (value == null) return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

function normalizePointer(path) {
  const normalized = normalizeText(path)
  if (!normalized.startsWith('/')) return null
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.replace(/\/+$/, '')
  }
  return normalized
}

function isPathMatch(path, candidate) {
  if (path === candidate) return true
  return path.startsWith(`${candidate}/`)
}

function decodePointerSegment(rawSegment) {
  return String(rawSegment || '').replace(/~1/g, '/').replace(/~0/g, '~')
}

function splitPointer(path) {
  if (path === '/') return ['']
  return path
    .slice(1)
    .split('/')
    .map((segment) => decodePointerSegment(segment))
}

function isArrayIndex(segment) {
  return /^[0-9]+$/.test(String(segment || ''))
}

function resolveParentContainer(target, pointerSegments = []) {
  if (!target || typeof target !== 'object') return { ok: false, reason: 'target_not_object' }
  if (pointerSegments.length === 0) return { ok: false, reason: 'missing_segments' }

  let cursor = target
  for (let i = 0; i < pointerSegments.length - 1; i += 1) {
    const segment = pointerSegments[i]

    if (Array.isArray(cursor)) {
      if (!isArrayIndex(segment)) {
        return { ok: false, reason: `invalid_array_index:${segment}` }
      }
      const index = Number(segment)
      if (index < 0 || index >= cursor.length) {
        return { ok: false, reason: `array_index_out_of_range:${segment}` }
      }
      cursor = cursor[index]
      continue
    }

    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { ok: false, reason: `missing_path:${segment}` }
    }
    cursor = cursor[segment]
    if (cursor == null || typeof cursor !== 'object') {
      if (i < pointerSegments.length - 2) {
        return { ok: false, reason: `intermediate_not_container:${segment}` }
      }
    }
  }

  return {
    ok: true,
    container: cursor,
    key: pointerSegments[pointerSegments.length - 1]
  }
}

function classifyPatchPath(path) {
  if (PATCH_BLACKLIST_EXACT.has(path) || PATCH_BLACKLIST_PREFIX.some((prefix) => isPathMatch(path, prefix))) {
    return {
      allowed: false,
      reason: 'blacklist',
      fix_hint: 'Patch path is forbidden by blacklist. Use revision.mode=rebuild for policy/risk/routing updates.'
    }
  }

  if (PATCH_REBUILD_EXACT.has(path) || PATCH_REBUILD_PREFIX.some((prefix) => isPathMatch(path, prefix))) {
    return {
      allowed: false,
      reason: 'rebuild_required',
      fix_hint: 'Patch path requires revision.mode=rebuild. Rebuild the DSL for scope/query_type/anchor changes.'
    }
  }

  if (PATCH_WHITELIST_EXACT.has(path)) {
    return { allowed: true, reason: 'whitelist_exact' }
  }

  if (isPathMatch(path, '/entities/categories') || isPathMatch(path, '/entities/keywords')) {
    return { allowed: true, reason: 'whitelist_array' }
  }

  if (isPathMatch(path, '/constraints')) {
    const segments = splitPointer(path)
    if (segments.length < 2) {
      return {
        allowed: false,
        reason: 'constraints_too_broad',
        fix_hint: 'Patch /constraints/* must target a specific field instead of wildcard-like root path.'
      }
    }
    const field = segments[1]
    if (!CONSTRAINTS_PATCHABLE_FIELDS.has(field)) {
      return {
        allowed: false,
        reason: 'constraints_field_not_allowed',
        fix_hint: 'Patch path not allowed for constraints. Use field-level whitelist only.'
      }
    }
    return { allowed: true, reason: 'constraints_whitelist' }
  }

  return {
    allowed: false,
    reason: 'not_in_whitelist',
    fix_hint: 'Patch path is outside whitelist. Use revision.mode=rebuild for unsupported paths.'
  }
}

function applySinglePatchOp(target, op, opIndex) {
  const operation = normalizeText(op?.op).toLowerCase()
  const normalizedPath = normalizePointer(op?.path)

  if (!normalizedPath) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{
        path: 'revision.patch_ops',
        message: `patch_ops[${opIndex}] has invalid path "${op?.path || ''}".`
      }],
      fix_hint: 'Each patch op path must be a valid JSON Pointer string like "/entities/categories".'
    }
  }

  if (!SUPPORTED_PATCH_OPS.has(operation)) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{
        path: normalizedPath,
        message: `Unsupported patch op "${operation}" at patch_ops[${opIndex}].`
      }],
      fix_hint: 'Only RFC6902 subset add/remove/replace is supported in revision.patch_ops.'
    }
  }

  const pathClass = classifyPatchPath(normalizedPath)
  if (!pathClass.allowed) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{
        path: normalizedPath,
        message: `Patch path "${normalizedPath}" is rejected (${pathClass.reason}).`
      }],
      fix_hint: pathClass.fix_hint
    }
  }

  if ((operation === 'add' || operation === 'replace') && !Object.prototype.hasOwnProperty.call(op, 'value')) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{
        path: normalizedPath,
        message: `patch_ops[${opIndex}] with op="${operation}" requires a value.`
      }],
      fix_hint: 'Provide a "value" for add/replace patch operations.'
    }
  }

  const segments = splitPointer(normalizedPath)
  const parent = resolveParentContainer(target, segments)
  if (!parent.ok) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{
        path: normalizedPath,
        message: `Patch path "${normalizedPath}" cannot be resolved (${parent.reason}).`
      }],
      fix_hint: 'Ensure patch path points to an existing parent container in base DSL.'
    }
  }

  const container = parent.container
  const key = parent.key
  const opValue = deepClone(op?.value)

  if (Array.isArray(container)) {
    if (operation === 'add') {
      if (key === '-') {
        container.push(opValue)
        return { ok: true }
      }
      if (!isArrayIndex(key)) {
        return {
          ok: false,
          error_code: 'dsl_semantic_invalid',
          errors: [{ path: normalizedPath, message: `Invalid array index "${key}" for add.` }],
          fix_hint: 'Use numeric array index or "-" when patching arrays.'
        }
      }
      const index = Number(key)
      if (index < 0 || index > container.length) {
        return {
          ok: false,
          error_code: 'dsl_semantic_invalid',
          errors: [{ path: normalizedPath, message: `Array index out of range for add: ${index}.` }],
          fix_hint: 'For add operation, array index must be within [0, length].'
        }
      }
      container.splice(index, 0, opValue)
      return { ok: true }
    }

    if (!isArrayIndex(key)) {
      return {
        ok: false,
        error_code: 'dsl_semantic_invalid',
        errors: [{ path: normalizedPath, message: `Invalid array index "${key}" for ${operation}.` }],
        fix_hint: 'Use numeric index when applying remove/replace on arrays.'
      }
    }
    const index = Number(key)
    if (index < 0 || index >= container.length) {
      return {
        ok: false,
        error_code: 'dsl_semantic_invalid',
        errors: [{ path: normalizedPath, message: `Array index out of range for ${operation}: ${index}.` }],
        fix_hint: 'remove/replace on arrays requires existing index in range.'
      }
    }

    if (operation === 'remove') {
      container.splice(index, 1)
      return { ok: true }
    }
    container[index] = opValue
    return { ok: true }
  }

  if (!container || typeof container !== 'object') {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{ path: normalizedPath, message: `Patch parent is not an object/array.` }],
      fix_hint: 'Patch path parent must be an object or array.'
    }
  }

  if (operation === 'add') {
    container[key] = opValue
    return { ok: true }
  }

  if (!Object.prototype.hasOwnProperty.call(container, key)) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{ path: normalizedPath, message: `Path "${normalizedPath}" does not exist for ${operation}.` }],
      fix_hint: 'remove/replace requires an existing target path.'
    }
  }

  if (operation === 'remove') {
    delete container[key]
    return { ok: true }
  }

  container[key] = opValue
  return { ok: true }
}

function mergePatchedDsl(patchedDsl, currentDsl, patchOps = []) {
  const merged = deepClone(patchedDsl)

  if (currentDsl?.trace_id) {
    merged.trace_id = currentDsl.trace_id
  }
  if (Object.prototype.hasOwnProperty.call(currentDsl || {}, 'session_id')) {
    merged.session_id = currentDsl.session_id ?? null
  }
  if (currentDsl?.context_binding && typeof currentDsl.context_binding === 'object') {
    merged.context_binding = deepClone(currentDsl.context_binding)
  }
  if (currentDsl?.streaming_hints && typeof currentDsl.streaming_hints === 'object') {
    merged.streaming_hints = deepClone(currentDsl.streaming_hints)
  }

  merged.revision = {
    ...(merged.revision && typeof merged.revision === 'object' ? merged.revision : {}),
    ...(currentDsl?.revision && typeof currentDsl.revision === 'object' ? currentDsl.revision : {}),
    mode: 'patch',
    patch_ops: deepClone(patchOps)
  }

  return merged
}

function touchedBudgetConstraintPath(path = '') {
  return path === '/constraints/latency_budget_ms' || path === '/constraints/token_budget'
}

export function applyDslPatch({
  baseDsl,
  currentDsl,
  patchOps = []
} = {}) {
  if (!baseDsl || typeof baseDsl !== 'object' || Array.isArray(baseDsl)) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{
        path: 'revision.base_trace_id',
        message: 'Patch mode requires a valid base DSL snapshot.'
      }],
      fix_hint: 'Switch revision.mode to "rebuild" when base DSL snapshot is missing.'
    }
  }

  if (!Array.isArray(patchOps) || patchOps.length === 0) {
    return {
      ok: false,
      error_code: 'dsl_semantic_invalid',
      errors: [{
        path: 'revision.patch_ops',
        message: 'Patch mode requires non-empty patch_ops.'
      }],
      fix_hint: 'Provide at least one add/remove/replace patch op or switch to revision.mode=rebuild.'
    }
  }

  const candidate = deepClone(baseDsl)
  const touchedPaths = []
  for (let i = 0; i < patchOps.length; i += 1) {
    const op = patchOps[i]
    const normalizedPath = normalizePointer(op?.path)
    const applyResult = applySinglePatchOp(candidate, op, i)
    if (!applyResult.ok) {
      return applyResult
    }
    if (normalizedPath) {
      touchedPaths.push(normalizedPath)
    }
  }

  if (touchedPaths.some((path) => touchedBudgetConstraintPath(path))) {
    const policyResult = validateDslPolicyRules(candidate)
    if (!policyResult.ok) {
      return {
        ok: false,
        error_code: 'dsl_semantic_invalid',
        errors: policyResult.errors,
        fix_hint: policyResult.fix_hint
          || 'Patched constraints budget is inconsistent with policy.budget_tier. Use rebuild or keep policy/constraints aligned.'
      }
    }
  }

  return {
    ok: true,
    patched_dsl: mergePatchedDsl(candidate, currentDsl, patchOps),
    diagnostics: {
      patch_ops_applied: patchOps.length,
      touched_paths: touchedPaths
    }
  }
}

export default {
  applyDslPatch
}
