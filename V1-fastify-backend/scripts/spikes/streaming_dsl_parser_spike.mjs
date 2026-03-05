import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import JsonParse from 'jsonparse'

const PARSER_IDS = {
  THIRD_PARTY: 'third_party_jsonparse',
  INTERNAL: 'internal_state_machine'
}

const DEFAULT_SPIKE_SAMPLES = [
  {
    name: 'complete',
    expect_valid: true,
    expect_scope_closed: true,
    chunks: [
      '{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]},"entities":{"categories":["coffee"]}}'
    ]
  },
  {
    name: 'truncated',
    expect_valid: false,
    expect_scope_closed: false,
    chunks: [
      '{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":{"geometry_source":"viewport","viewport":[114.3,30.5'
    ]
  },
  {
    name: 'out_of_order',
    expect_valid: false,
    expect_scope_closed: false,
    chunks: [
      '{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":',
      ',"entities":{"categories":["coffee","bakery"]},"constraints":{"latency_budget_ms":3000},"operators":[]}',
      '{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]}'
    ]
  }
]

const PAYLOAD_VARIANTS = [
  { id: 'small', categories: 3, operators: 2, depth: 1 },
  { id: 'medium', categories: 24, operators: 12, depth: 2 },
  { id: 'large', categories: 120, operators: 36, depth: 3 },
  { id: 'deep', categories: 18, operators: 10, depth: 7 }
]

const CHUNK_PROFILES = [
  { id: 'tiny', pattern: [7, 11, 13, 17, 19] },
  { id: 'mixed', pattern: [64, 9, 128, 24, 80, 33, 57] },
  { id: 'large', pattern: [512, 4096] }
]

const STREAM_CASES = [
  { id: 'complete', expect_valid: true, expect_scope_closed: true },
  { id: 'truncated', expect_valid: false, expect_scope_closed: false },
  { id: 'malformed', expect_valid: false, expect_scope_closed: false },
  { id: 'out_of_order', expect_valid: false, expect_scope_closed: false }
]

function nowMs() {
  return performance.now()
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function safeRate(numerator, denominator) {
  if (!denominator) return 0
  return numerator / denominator
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(safeNumber(value) * factor) / factor
}

function summarizeLatency(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (sorted.length === 0) {
    return {
      count: 0,
      min_ms: 0,
      max_ms: 0,
      avg_ms: 0,
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0
    }
  }
  const getPercentile = (percentile) => {
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1))
    return sorted[index]
  }
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    count: sorted.length,
    min_ms: round(sorted[0]),
    max_ms: round(sorted[sorted.length - 1]),
    avg_ms: round(sum / sorted.length),
    p50_ms: round(getPercentile(50)),
    p95_ms: round(getPercentile(95)),
    p99_ms: round(getPercentile(99))
  }
}

function isWhitespace(char) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function analyzeJsonBalance(text) {
  let inString = false
  let escape = false
  let braceDepth = 0
  let bracketDepth = 0

  for (const char of text) {
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (char === '\\') {
        escape = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') braceDepth += 1
    if (char === '}') braceDepth -= 1
    if (char === '[') bracketDepth += 1
    if (char === ']') bracketDepth -= 1
  }

  return {
    in_string: inString,
    brace_depth: braceDepth,
    bracket_depth: bracketDepth
  }
}

function classifyParseFailure(text, error) {
  const message = String(error?.message || '')
  const lower = message.toLowerCase()
  const balance = analyzeJsonBalance(text)
  const likelyTruncated =
    lower.includes('unexpected end') ||
    lower.includes('end of json input') ||
    balance.in_string ||
    balance.brace_depth > 0 ||
    balance.bracket_depth > 0
  return {
    truncated_detected: likelyTruncated,
    parse_error: likelyTruncated ? null : message || 'parse_error'
  }
}

function detectTopLevelScopeClose(chunks) {
  let structuralDepth = 0
  let inString = false
  let escape = false

  let rootExpectingKey = false
  let waitingForColon = false
  let waitingForValue = false
  let capturingKey = false
  let currentKey = ''
  let lastRootKey = null

  let scopeTracking = false
  let scopeStartDepth = 0
  let scopeClosed = false
  let scopeClosedChunkIndex = null

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = String(chunks[chunkIndex] ?? '')
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index]

      if (inString) {
        if (escape) {
          escape = false
          if (capturingKey) currentKey += char
          continue
        }
        if (char === '\\') {
          escape = true
          if (capturingKey) currentKey += char
          continue
        }
        if (char === '"') {
          inString = false
          if (capturingKey) {
            capturingKey = false
            lastRootKey = currentKey
            currentKey = ''
            waitingForColon = true
            rootExpectingKey = false
          }
          continue
        }
        if (capturingKey) currentKey += char
        continue
      }

      if (waitingForValue && !isWhitespace(char)) {
        if (lastRootKey === 'scope' && char === '{') {
          scopeTracking = true
          scopeStartDepth = structuralDepth
        }
        waitingForValue = false
      }

      if (char === '"') {
        inString = true
        if (structuralDepth === 1 && rootExpectingKey) {
          capturingKey = true
          currentKey = ''
        }
        continue
      }

      if (char === '{') {
        structuralDepth += 1
        if (structuralDepth === 1) {
          rootExpectingKey = true
          waitingForColon = false
          waitingForValue = false
          lastRootKey = null
        }
        continue
      }

      if (char === '}') {
        structuralDepth -= 1
        if (scopeTracking && structuralDepth === scopeStartDepth) {
          scopeTracking = false
          scopeClosed = true
          scopeClosedChunkIndex = chunkIndex
        }
        if (structuralDepth < 0) {
          structuralDepth = 0
        }
        continue
      }

      if (char === '[') {
        structuralDepth += 1
        continue
      }

      if (char === ']') {
        structuralDepth -= 1
        if (scopeTracking && structuralDepth === scopeStartDepth) {
          scopeTracking = false
          scopeClosed = true
          scopeClosedChunkIndex = chunkIndex
        }
        if (structuralDepth < 0) {
          structuralDepth = 0
        }
        continue
      }

      if (structuralDepth === 1 && waitingForColon && char === ':') {
        waitingForColon = false
        waitingForValue = true
        continue
      }

      if (structuralDepth === 1 && char === ',') {
        rootExpectingKey = true
        waitingForColon = false
        waitingForValue = false
        lastRootKey = null
      }
    }
  }

  return {
    scope_closed: scopeClosed,
    scope_closed_chunk_index: scopeClosed ? scopeClosedChunkIndex : null
  }
}

function createBaseResult(parserId, chunks, startMs) {
  return {
    parser_id: parserId,
    ok: false,
    scope_closed: false,
    scope_closed_chunk_index: null,
    truncated_detected: false,
    parse_error: null,
    crash: false,
    unexpected_error: false,
    elapsed_ms: round(nowMs() - startMs),
    chunk_count: chunks.length
  }
}

function finalizeResult(baseResult, startMs, patch) {
  const { __start_ms, ...cleanPatch } = patch || {}
  return {
    ...baseResult,
    ...cleanPatch,
    elapsed_ms: round(nowMs() - startMs)
  }
}

function runThirdPartyParserSync(chunksInput) {
  const startMs = nowMs()
  const chunks = Array.isArray(chunksInput) ? chunksInput.map((chunk) => String(chunk ?? '')) : []
  const scopeSignal = detectTopLevelScopeClose(chunks)
  const text = chunks.join('')
  const baseResult = createBaseResult(PARSER_IDS.THIRD_PARTY, chunks, startMs)

  let rootValue
  try {
    const parser = new JsonParse()
    parser.onValue = function onValue(value) {
      if (this.stack.length === 0) {
        rootValue = value
      }
    }
    for (const chunk of chunks) {
      parser.write(chunk)
    }

    if (rootValue !== undefined) {
      return finalizeResult(baseResult, startMs, {
        ok: true,
        scope_closed: scopeSignal.scope_closed || Boolean(rootValue && typeof rootValue.scope === 'object'),
        scope_closed_chunk_index: scopeSignal.scope_closed
          ? scopeSignal.scope_closed_chunk_index
          : rootValue && typeof rootValue.scope === 'object'
            ? chunks.length - 1
            : null
      })
    }

    const classification = classifyParseFailure(text, new Error('No complete root JSON value parsed'))
    return finalizeResult(baseResult, startMs, {
      ok: classification.truncated_detected,
      truncated_detected: classification.truncated_detected,
      parse_error: classification.parse_error,
      scope_closed: scopeSignal.scope_closed,
      scope_closed_chunk_index: scopeSignal.scope_closed_chunk_index
    })
  } catch (error) {
    const classification = classifyParseFailure(text, error)
    return finalizeResult(baseResult, startMs, {
      ok: classification.truncated_detected,
      truncated_detected: classification.truncated_detected,
      parse_error: classification.parse_error,
      scope_closed: scopeSignal.scope_closed,
      scope_closed_chunk_index: scopeSignal.scope_closed_chunk_index,
      crash: false
    })
  }
}

export async function runThirdPartyParser(chunksInput) {
  return runThirdPartyParserSync(chunksInput)
}

export function runStateMachineParser(chunksInput) {
  const startMs = nowMs()
  const chunks = Array.isArray(chunksInput) ? chunksInput.map((chunk) => String(chunk ?? '')) : []
  const text = chunks.join('')
  const scopeSignal = detectTopLevelScopeClose(chunks)
  const baseResult = createBaseResult(PARSER_IDS.INTERNAL, chunks, startMs)

  try {
    const parsed = JSON.parse(text)
    return finalizeResult(baseResult, startMs, {
      ok: true,
      scope_closed: scopeSignal.scope_closed || Boolean(parsed && typeof parsed.scope === 'object'),
      scope_closed_chunk_index: scopeSignal.scope_closed
        ? scopeSignal.scope_closed_chunk_index
        : parsed && typeof parsed.scope === 'object'
          ? chunks.length - 1
          : null
    })
  } catch (error) {
    const classification = classifyParseFailure(text, error)
    return finalizeResult(baseResult, startMs, {
      ok: classification.truncated_detected,
      truncated_detected: classification.truncated_detected,
      parse_error: classification.parse_error,
      scope_closed: scopeSignal.scope_closed,
      scope_closed_chunk_index: scopeSignal.scope_closed_chunk_index
    })
  }
}

function scoreCandidate(candidate, bestAvgLatencyMs) {
  const reliability =
    candidate.valid_pass_rate * 0.45 +
    candidate.invalid_detection_rate * 0.4 +
    candidate.scope_close_rate * 0.15
  const latencyScore =
    candidate.latency.avg_ms > 0 && bestAvgLatencyMs > 0
      ? Math.min(1, bestAvgLatencyMs / candidate.latency.avg_ms)
      : 0
  const stabilityPenalty = candidate.crash_rate * 1.2 + candidate.unexpected_error_rate * 0.8
  const composite = reliability * 100 * 0.85 + latencyScore * 100 * 0.15 - stabilityPenalty * 100
  return {
    reliability_score: round(reliability * 100),
    latency_score: round(latencyScore * 100),
    stability_penalty: round(stabilityPenalty * 100),
    composite_score: round(composite)
  }
}

function evaluateRunAgainstExpectation(group, runResult) {
  const isValidRun = group.expect_valid === true
  const validPass = isValidRun
    ? runResult.ok === true && runResult.truncated_detected === false && !runResult.parse_error
    : null
  const invalidDetected = isValidRun
    ? null
    : runResult.ok === false || runResult.truncated_detected === true || Boolean(runResult.parse_error)
  const scopePass = group.expect_scope_closed ? runResult.scope_closed === true : null
  return {
    valid_pass: validPass,
    invalid_detected: invalidDetected,
    scope_pass: scopePass
  }
}

function summarizeEvaluations(evaluations, runs) {
  const validChecks = evaluations.filter((item) => item.valid_pass !== null)
  const invalidChecks = evaluations.filter((item) => item.invalid_detected !== null)
  const scopeChecks = evaluations.filter((item) => item.scope_pass !== null)
  const crashCount = runs.filter((run) => run.crash === true).length
  const unexpectedErrorCount = runs.filter((run) => run.unexpected_error === true).length
  const parseErrorCount = runs.filter((run) => Boolean(run.parse_error)).length
  const truncatedCount = runs.filter((run) => run.truncated_detected === true).length
  const latency = summarizeLatency(runs.map((run) => run.elapsed_ms))

  const validPassCount = validChecks.filter((item) => item.valid_pass === true).length
  const invalidDetectedCount = invalidChecks.filter((item) => item.invalid_detected === true).length
  const scopePassCount = scopeChecks.filter((item) => item.scope_pass === true).length

  return {
    total_runs: runs.length,
    valid_expected_runs: validChecks.length,
    valid_pass_count: validPassCount,
    valid_pass_rate: round(safeRate(validPassCount, validChecks.length)),
    invalid_expected_runs: invalidChecks.length,
    invalid_detected_count: invalidDetectedCount,
    invalid_detection_rate: round(safeRate(invalidDetectedCount, invalidChecks.length)),
    scope_expected_runs: scopeChecks.length,
    scope_detected_count: scopePassCount,
    scope_close_rate: round(safeRate(scopePassCount, scopeChecks.length)),
    truncated_detected_count: truncatedCount,
    parse_error_count: parseErrorCount,
    crash_count: crashCount,
    crash_rate: round(safeRate(crashCount, runs.length)),
    unexpected_error_count: unexpectedErrorCount,
    unexpected_error_rate: round(safeRate(unexpectedErrorCount, runs.length)),
    latency
  }
}

function buildOperator(index) {
  if (index % 2 === 0) {
    return {
      type: 'fetch_candidates',
      params: {
        limit: 10 + (index % 10),
        include_closed: index % 3 === 0
      }
    }
  }
  if (index % 3 === 0) {
    return {
      type: 'aggregate_h3',
      params: {
        resolution: 7 + (index % 3),
        metric: 'count'
      }
    }
  }
  return {
    type: 'filter_constraints',
    params: {
      key: 'rating',
      op: '>=',
      value: 3 + (index % 3)
    }
  }
}

function buildDeepNode(level) {
  if (level <= 0) return { marker: 'leaf' }
  return {
    level,
    children: [buildDeepNode(level - 1)]
  }
}

function buildPayload(variant) {
  const categories = Array.from({ length: variant.categories }, (_, index) => `category_${index}`)
  const operators = Array.from({ length: variant.operators }, (_, index) => buildOperator(index))
  return {
    dsl_version: 'spatial_query_v1',
    task: {
      query_type: 'area_analysis',
      intent: variant.id
    },
    scope: {
      geometry_source: 'viewport',
      viewport: [114.31, 30.52, 114.48, 30.67]
    },
    entities: {
      categories
    },
    constraints: {
      latency_budget_ms: 2500,
      token_budget: 2048
    },
    operators,
    analysis: buildDeepNode(variant.depth)
  }
}

function chunkWithPattern(text, pattern) {
  if (!text.length) return ['']
  const chunks = []
  let cursor = 0
  let pointer = 0
  while (cursor < text.length) {
    const requested = pattern[pointer % pattern.length]
    const size = Math.max(1, Math.min(requested, text.length - cursor))
    chunks.push(text.slice(cursor, cursor + size))
    cursor += size
    pointer += 1
  }
  return chunks
}

function ensureChunkCount(chunks, count, text) {
  if (chunks.length >= count) return chunks
  const evenSize = Math.max(1, Math.floor(text.length / count))
  const fallbackPattern = Array.from({ length: count }, () => evenSize)
  return chunkWithPattern(text, fallbackPattern)
}

function buildChunksForCase(jsonText, chunkProfile, streamCaseId) {
  if (streamCaseId === 'complete') {
    return chunkWithPattern(jsonText, chunkProfile.pattern)
  }

  if (streamCaseId === 'truncated') {
    const cut = Math.max(1, Math.floor(jsonText.length * 0.88))
    return chunkWithPattern(jsonText.slice(0, cut), chunkProfile.pattern)
  }

  if (streamCaseId === 'malformed') {
    const marker = '"scope":{'
    const markerIndex = jsonText.indexOf(marker)
    if (markerIndex >= 0) {
      const malformed = `${jsonText.slice(0, markerIndex)}"scope":,${jsonText.slice(markerIndex + '"scope":'.length + 1)}`
      return chunkWithPattern(malformed, chunkProfile.pattern)
    }
    const midpoint = Math.max(1, Math.floor(jsonText.length / 2))
    return chunkWithPattern(`${jsonText.slice(0, midpoint)},,${jsonText.slice(midpoint)}`, chunkProfile.pattern)
  }

  if (streamCaseId === 'out_of_order') {
    const ordered = ensureChunkCount(chunkWithPattern(jsonText, chunkProfile.pattern), 3, jsonText)
    const reordered = ordered.slice()
    const second = reordered.splice(1, 1)[0]
    reordered.push(second)
    return reordered
  }

  return chunkWithPattern(jsonText, chunkProfile.pattern)
}

export function buildRigorousConditionGroups() {
  const groups = []

  for (const payloadVariant of PAYLOAD_VARIANTS) {
    const payload = buildPayload(payloadVariant)
    const payloadJson = JSON.stringify(payload)

    for (const chunkProfile of CHUNK_PROFILES) {
      for (const streamCase of STREAM_CASES) {
        const chunks = buildChunksForCase(payloadJson, chunkProfile, streamCase.id)
        groups.push({
          id: `${payloadVariant.id}__${chunkProfile.id}__${streamCase.id}`,
          payload_scale: payloadVariant.id,
          chunk_profile: chunkProfile.id,
          stream_case: streamCase.id,
          chunk_count: chunks.length,
          byte_length: payloadJson.length,
          expect_valid: streamCase.expect_valid,
          expect_scope_closed: streamCase.expect_scope_closed,
          chunks
        })
      }
    }
  }

  return groups
}

function summarizeCandidateRuns(candidateId, groupRuns) {
  const evaluations = []
  const runs = []
  for (const groupRun of groupRuns) {
    for (const single of groupRun.runs) {
      runs.push(single)
      evaluations.push(evaluateRunAgainstExpectation(groupRun.group, single))
    }
  }

  const summary = summarizeEvaluations(evaluations, runs)
  return {
    candidate_id: candidateId,
    ...summary
  }
}

function buildRecommendation(candidateSummaries) {
  const avgLatencies = candidateSummaries
    .map((candidate) => candidate.latency.avg_ms)
    .filter((value) => value > 0)
  const bestAvgLatencyMs = avgLatencies.length > 0 ? Math.min(...avgLatencies) : 0

  const scored = candidateSummaries.map((candidate) => {
    const score = scoreCandidate(candidate, bestAvgLatencyMs)
    return {
      ...candidate,
      ...score
    }
  })

  scored.sort((left, right) => right.composite_score - left.composite_score)
  const selected = scored[0]

  return {
    selected: selected?.candidate_id ?? null,
    rationale:
      selected == null
        ? 'No candidate available.'
        : `Selected ${selected.candidate_id} based on reliability-first composite score.`,
    ranking: scored.map((candidate, index) => ({
      rank: index + 1,
      candidate_id: candidate.candidate_id,
      composite_score: candidate.composite_score,
      reliability_score: candidate.reliability_score,
      latency_score: candidate.latency_score,
      stability_penalty: candidate.stability_penalty
    })),
    candidates: scored
  }
}

export async function runSpikeComparison(options = {}) {
  const samples = Array.isArray(options.samples) && options.samples.length > 0 ? options.samples : DEFAULT_SPIKE_SAMPLES
  const includeRuns = Boolean(options.include_runs || options.includeRuns)
  const parsers = [
    { candidate_id: PARSER_IDS.THIRD_PARTY, run: runThirdPartyParser },
    { candidate_id: PARSER_IDS.INTERNAL, run: async (chunks) => runStateMachineParser(chunks) }
  ]

  const candidates = []
  for (const parser of parsers) {
    const runs = []
    const evaluations = []
    for (const sample of samples) {
      const runResult = await parser.run(sample.chunks)
      runs.push({
        ...runResult,
        sample_name: sample.name
      })
      evaluations.push(
        evaluateRunAgainstExpectation(
          {
            expect_valid: Boolean(sample.expect_valid),
            expect_scope_closed: Boolean(sample.expect_scope_closed)
          },
          runResult
        )
      )
    }

    const summary = summarizeEvaluations(evaluations, runs)
    candidates.push({
      candidate_id: parser.candidate_id,
      sample_count: samples.length,
      scope_detected_count: summary.scope_detected_count,
      crash_count: summary.crash_count,
      parse_error_count: summary.parse_error_count,
      unexpected_error_count: summary.unexpected_error_count,
      avg_elapsed_ms: summary.latency.avg_ms,
      valid_pass_rate: summary.valid_pass_rate,
      invalid_detection_rate: summary.invalid_detection_rate,
      scope_close_rate: summary.scope_close_rate,
      runs: includeRuns ? runs : undefined
    })
  }

  const recommendation = buildRecommendation(
    candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      total_runs: candidate.sample_count,
      valid_pass_rate: candidate.valid_pass_rate,
      invalid_detection_rate: candidate.invalid_detection_rate,
      scope_close_rate: candidate.scope_close_rate,
      crash_rate: safeRate(candidate.crash_count, candidate.sample_count),
      unexpected_error_rate: safeRate(candidate.unexpected_error_count, candidate.sample_count),
      latency: summarizeLatency([candidate.avg_elapsed_ms])
    }))
  )

  return {
    mode: 'spike',
    generated_at: new Date().toISOString(),
    sample_count: samples.length,
    samples: samples.map((sample) => ({
      name: sample.name,
      chunk_count: sample.chunks.length,
      expect_valid: Boolean(sample.expect_valid),
      expect_scope_closed: Boolean(sample.expect_scope_closed)
    })),
    candidates,
    recommendation: {
      selected: recommendation.selected,
      rationale: recommendation.rationale,
      ranking: recommendation.ranking
    }
  }
}

function buildGroupReport(group, candidateRuns, includeRuns) {
  const evaluations = candidateRuns.map((run) => evaluateRunAgainstExpectation(group, run))
  const summary = summarizeEvaluations(evaluations, candidateRuns)
  return {
    group_id: group.id,
    payload_scale: group.payload_scale,
    chunk_profile: group.chunk_profile,
    stream_case: group.stream_case,
    expect_valid: group.expect_valid,
    expect_scope_closed: group.expect_scope_closed,
    chunk_count: group.chunk_count,
    byte_length: group.byte_length,
    ...summary,
    runs: includeRuns ? candidateRuns : undefined
  }
}

export function runRigorousBenchmark(options = {}) {
  const iterations = Math.max(1, Number.parseInt(options.iterations ?? 12, 10) || 12)
  const warmup = Math.max(0, Number.parseInt(options.warmup ?? 2, 10) || 0)
  const includeRuns = Boolean(options.includeRuns)
  const availableGroups = Array.isArray(options.groups) && options.groups.length > 0 ? options.groups : buildRigorousConditionGroups()
  const groupIdSet = Array.isArray(options.groupIds) && options.groupIds.length > 0 ? new Set(options.groupIds) : null
  const groups = groupIdSet ? availableGroups.filter((group) => groupIdSet.has(group.id)) : availableGroups

  const parserCandidates = [
    { candidate_id: PARSER_IDS.THIRD_PARTY, run: runThirdPartyParserSync },
    { candidate_id: PARSER_IDS.INTERNAL, run: runStateMachineParser }
  ]

  const candidateGroupReports = new Map()
  const candidateRuns = new Map()

  for (const parser of parserCandidates) {
    candidateGroupReports.set(parser.candidate_id, [])
    candidateRuns.set(parser.candidate_id, [])

    for (const group of groups) {
      for (let warm = 0; warm < warmup; warm += 1) {
        parser.run(group.chunks)
      }

      const runs = []
      for (let step = 0; step < iterations; step += 1) {
        runs.push(parser.run(group.chunks))
      }

      candidateRuns.get(parser.candidate_id).push({
        group,
        runs
      })
      candidateGroupReports.get(parser.candidate_id).push(buildGroupReport(group, runs, includeRuns))
    }
  }

  const candidateSummary = parserCandidates.map((parser) =>
    summarizeCandidateRuns(parser.candidate_id, candidateRuns.get(parser.candidate_id))
  )
  const recommendation = buildRecommendation(candidateSummary)

  const groupReports = groups.map((group) => {
    const byCandidate = {}
    for (const parser of parserCandidates) {
      const report = candidateGroupReports
        .get(parser.candidate_id)
        .find((entry) => entry.group_id === group.id)
      byCandidate[parser.candidate_id] = report
    }
    return {
      id: group.id,
      payload_scale: group.payload_scale,
      chunk_profile: group.chunk_profile,
      stream_case: group.stream_case,
      expect_valid: group.expect_valid,
      expect_scope_closed: group.expect_scope_closed,
      by_candidate: byCandidate
    }
  })

  return {
    mode: 'rigorous',
    generated_at: new Date().toISOString(),
    config: {
      iterations,
      warmup,
      include_runs: includeRuns
    },
    total_groups: groups.length,
    group_reports: groupReports,
    candidate_summary: recommendation.candidates,
    recommendation: {
      selected: recommendation.selected,
      rationale: recommendation.rationale,
      ranking: recommendation.ranking
    }
  }
}

function parseCliArgs(argv) {
  const options = {
    mode: 'spike',
    iterations: 12,
    warmup: 2,
    includeRuns: false,
    json: false,
    output: null,
    groupIds: null
  }

  for (const rawArg of argv) {
    const arg = String(rawArg || '')
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--include-runs') {
      options.includeRuns = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg.startsWith('--mode=')) {
      options.mode = arg.slice('--mode='.length)
      continue
    }
    if (arg.startsWith('--iterations=')) {
      options.iterations = Number.parseInt(arg.slice('--iterations='.length), 10)
      continue
    }
    if (arg.startsWith('--warmup=')) {
      options.warmup = Number.parseInt(arg.slice('--warmup='.length), 10)
      continue
    }
    if (arg.startsWith('--groups=')) {
      const value = arg.slice('--groups='.length)
      options.groupIds = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      continue
    }
    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length).trim()
    }
  }

  return options
}

function formatSpikeText(report) {
  const lines = []
  lines.push('Streaming parser spike report')
  lines.push(`generated_at: ${report.generated_at}`)
  lines.push(`sample_count: ${report.sample_count}`)
  lines.push('')
  for (const candidate of report.candidates) {
    lines.push(`candidate: ${candidate.candidate_id}`)
    lines.push(
      `  valid_pass_rate=${candidate.valid_pass_rate} invalid_detection_rate=${candidate.invalid_detection_rate} scope_close_rate=${candidate.scope_close_rate} avg_elapsed_ms=${candidate.avg_elapsed_ms}`
    )
  }
  lines.push('')
  lines.push(`recommended: ${report.recommendation.selected}`)
  lines.push(`reason: ${report.recommendation.rationale}`)
  return lines.join('\n')
}

function formatRigorousText(report) {
  const lines = []
  lines.push('Streaming parser rigorous benchmark report')
  lines.push(`generated_at: ${report.generated_at}`)
  lines.push(`groups: ${report.total_groups}`)
  lines.push(`iterations: ${report.config.iterations}`)
  lines.push(`warmup: ${report.config.warmup}`)
  lines.push('')
  for (const candidate of report.candidate_summary) {
    lines.push(`candidate: ${candidate.candidate_id}`)
    lines.push(
      `  valid_pass_rate=${candidate.valid_pass_rate} invalid_detection_rate=${candidate.invalid_detection_rate} scope_close_rate=${candidate.scope_close_rate}`
    )
    lines.push(
      `  crash_rate=${candidate.crash_rate} unexpected_error_rate=${candidate.unexpected_error_rate} avg_ms=${candidate.latency.avg_ms} p95_ms=${candidate.latency.p95_ms}`
    )
    lines.push(`  composite_score=${candidate.composite_score}`)
  }
  lines.push('')
  lines.push(`recommended: ${report.recommendation.selected}`)
  lines.push(`reason: ${report.recommendation.rationale}`)
  return lines.join('\n')
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.help) {
    const helpText = [
      'Usage:',
      '  node fastify-backend/scripts/spikes/streaming_dsl_parser_spike.mjs [options]',
      '',
      'Options:',
      '  --mode=spike|rigorous',
      '  --iterations=<number>',
      '  --warmup=<number>',
      '  --groups=<group_id_1,group_id_2,...>',
      '  --include-runs',
      '  --json',
      '  --output=<path>',
      '  --help'
    ].join('\n')
    console.log(helpText)
    return
  }

  const mode = String(options.mode || 'spike')
  let report
  if (mode === 'rigorous') {
    report = runRigorousBenchmark({
      iterations: options.iterations,
      warmup: options.warmup,
      includeRuns: options.includeRuns,
      groupIds: options.groupIds
    })
  } else if (mode === 'spike') {
    report = await runSpikeComparison({
      include_runs: options.includeRuns
    })
  } else {
    throw new Error(`Unsupported mode: ${mode}`)
  }

  const outputText = options.json
    ? JSON.stringify(report, null, 2)
    : mode === 'rigorous'
      ? formatRigorousText(report)
      : formatSpikeText(report)

  if (options.output) {
    const outputPath = path.resolve(process.cwd(), options.output)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, outputText, 'utf8')
  }

  console.log(outputText)
}

const isExecutedDirectly = (() => {
  if (!process.argv[1]) return false
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isExecutedDirectly) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
