import { createHash } from 'crypto'

function toText(value) {
  if (value == null) return ''
  return String(value)
}

export function sha1(value) {
  return createHash('sha1').update(toText(value), 'utf8').digest('hex')
}

export function redactedPreview(value, maxLength = 240) {
  const text = toText(value)
  const compact = text.replace(/\s+/g, ' ').trim()
  const previewText = compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact
  return {
    preview_text: previewText,
    preview_chars: text.length,
    preview_sha1: sha1(text)
  }
}

export function classifySpatialError(message = '') {
  const normalized = toText(message)
    .replace(/^Spatial compute service unavailable:\s*/i, '')
    .trim()

  const modelParallelMatch = normalized.match(/model_parallel_failed:[^:\s]+:[^\s]+(?:[:][^\s]+)*/i)
  if (modelParallelMatch) {
    return {
      error_class: 'model_parallel',
      error_code: modelParallelMatch[0]
    }
  }

  if (/budget_exceeded/i.test(normalized)) {
    return { error_class: 'model_parallel', error_code: 'model_parallel_failed:budget_exceeded' }
  }

  if (/grpc/i.test(normalized)) {
    return { error_class: 'grpc', error_code: 'grpc_compute_error' }
  }

  if (/pipeline/i.test(normalized)) {
    return { error_class: 'pipeline', error_code: 'pipeline_error' }
  }

  return { error_class: 'pipeline', error_code: 'pipeline_error:unknown' }
}

export function buildRootCauseHint(errorCode = '') {
  const code = toText(errorCode)

  if (code.includes('vlm_anchor_response_invalid')) {
    return 'VLM returned non-JSON or schema-mismatched anchor payload.'
  }
  if (code.includes('visual_snapshot_missing')) {
    return 'visualSnapshotDataUrl is missing or empty in request options.'
  }
  if (code.includes('reasoning_response_invalid')) {
    return 'LLM reasoning response is invalid or not parseable as JSON.'
  }
  if (code.includes('budget_exceeded')) {
    return 'Parallel model wall time exceeded modelBudgetMs.'
  }
  if (code.includes('vlm_remote_error')) {
    return 'VLM upstream endpoint returned an explicit remote error.'
  }
  if (code.includes('llm_remote_error') || code.includes('reasoning_remote_error')) {
    return 'Reasoning model upstream endpoint returned an explicit remote error.'
  }
  if (code.includes('model_parallel_failed')) {
    return 'Parallel model execution failed; inspect python_context and model_timing_ms.'
  }
  if (code.includes('grpc_compute_error')) {
    return 'gRPC transport or server-side streaming failed.'
  }
  return 'Inspect stage path, grpc_context, and python_context for root cause.'
}

export function digestSpatialContext(spatialContext = {}) {
  const viewport = Array.isArray(spatialContext?.viewport) ? spatialContext.viewport : []
  const viewportDigest = viewport.length >= 4
    ? viewport
      .slice(0, 4)
      .map((value) => Number(value))
      .map((value) => (Number.isFinite(value) ? value.toFixed(4) : 'NaN'))
      .join(',')
    : null

  return {
    mode: toText(spatialContext?.mode || ''),
    has_boundary: Boolean(spatialContext?.boundary),
    region_count: Array.isArray(spatialContext?.regions) ? spatialContext.regions.length : 0,
    viewport_digest: viewportDigest,
    map_zoom: Number.isFinite(Number(spatialContext?.mapZoom)) ? Number(spatialContext.mapZoom) : null
  }
}

export function digestModelOptions(options = {}) {
  return {
    visualModel: options?.visualModel || null,
    ocrModel: options?.ocrModel || null,
    overviewModel: options?.overviewModel || null,
    overviewEnabled: options?.overviewEnabled ?? null,
    overviewMediumEnabled: options?.overviewMediumEnabled ?? null,
    reasoningModel: options?.reasoningModel || null,
    reasoningEnabled: options?.reasoningEnabled ?? null,
    modelBudgetMs: Number.isFinite(Number(options?.modelBudgetMs)) ? Number(options.modelBudgetMs) : null,
    visualTimeoutMs: Number.isFinite(Number(options?.visualTimeoutMs)) ? Number(options.visualTimeoutMs) : null,
    reasoningTimeoutMs: Number.isFinite(Number(options?.reasoningTimeoutMs)) ? Number(options.reasoningTimeoutMs) : null
  }
}

function normalizeStagePath(stagePath = []) {
  if (!Array.isArray(stagePath)) return []
  return stagePath
    .map((stage) => toText(stage).trim())
    .filter(Boolean)
    .slice(-120)
}

function extractStackPreview(errorLike, maxLength = 1200) {
  const stack = toText(errorLike?.stack || '')
  if (!stack) return null
  return stack.length > maxLength ? `${stack.slice(0, maxLength)}...` : stack
}

function normalizePythonContext(pythonContext) {
  if (!pythonContext || typeof pythonContext !== 'object' || Array.isArray(pythonContext)) {
    return {}
  }

  if (
    typeof pythonContext.preview_text === 'string'
    && Number.isFinite(Number(pythonContext.preview_chars))
    && typeof pythonContext.preview_sha1 === 'string'
  ) {
    const normalized = {
      preview_text: pythonContext.preview_text,
      preview_chars: Number(pythonContext.preview_chars),
      preview_sha1: pythonContext.preview_sha1
    }
    if (typeof pythonContext.parse_stage === 'string' && pythonContext.parse_stage.trim()) {
      normalized.parse_stage = pythonContext.parse_stage.trim()
    }
    return normalized
  }

  return { ...pythonContext }
}

function coerceError(errorLike) {
  if (errorLike instanceof Error) return errorLike
  if (typeof errorLike === 'string') return new Error(errorLike)
  try {
    return new Error(JSON.stringify(errorLike))
  } catch {
    return new Error(toText(errorLike))
  }
}

export function buildFailureDiagnostics({
  error,
  traceId = '',
  sessionId = '',
  mode = '',
  queryType = '',
  stagePath = [],
  spatialContext = {},
  options = {},
  grpcContext = null,
  pythonContext = null,
  stackPreview = null
} = {}) {
  const err = coerceError(error)
  const classified = classifySpatialError(err.message)
  const normalizedStagePath = normalizeStagePath(stagePath)
  const lastStage = normalizedStagePath[normalizedStagePath.length - 1] || null

  const providedCode = toText(err?.code || '')
  const diagnosticsCode = toText(err?.diagnostics?.error_code || '')
  const grpcCode = toText(grpcContext?.error_code || '')
  const errorCode = providedCode || diagnosticsCode || grpcCode || classified.error_code

  const mergedGrpcContext = {
    ...(grpcContext && typeof grpcContext === 'object' ? grpcContext : {}),
    ...(err?.grpc_context && typeof err.grpc_context === 'object' ? err.grpc_context : {})
  }

  const mergedPythonContext = normalizePythonContext(
    pythonContext
    || err?.python_context
    || err?.diagnostics?.python_context
    || null
  )

  const signatureSeed = [
    errorCode,
    lastStage || '',
    toText(mode),
    toText(queryType)
  ].join('|')

  const errorSignature = `fd_${sha1(signatureSeed).slice(0, 16)}`

  return {
    trace_id: toText(traceId),
    session_id: toText(sessionId),
    mode: toText(mode),
    query_type: toText(queryType || ''),
    stage_path: normalizedStagePath,
    last_stage: lastStage,
    stage_count: normalizedStagePath.length,
    error_class: classified.error_class,
    error_code: errorCode,
    error_message: toText(err.message),
    root_cause_hint: buildRootCauseHint(errorCode),
    error_signature: errorSignature,
    model_context: digestModelOptions(options || {}),
    spatial_context_digest: digestSpatialContext(spatialContext || {}),
    grpc_context: mergedGrpcContext,
    python_context: mergedPythonContext,
    stack_preview: stackPreview || extractStackPreview(err)
  }
}

export default {
  sha1,
  redactedPreview,
  classifySpatialError,
  buildRootCauseHint,
  digestSpatialContext,
  digestModelOptions,
  buildFailureDiagnostics
}
