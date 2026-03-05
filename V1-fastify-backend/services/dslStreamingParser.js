const STREAMING_PARSER_STATE_ORDER = Object.freeze({
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4
})

export const STREAMING_PARSER_STATES = Object.freeze({
  S0: 'S0',
  S1: 'S1',
  S2: 'S2',
  S3: 'S3',
  S4: 'S4'
})

export const STREAMING_PARSER_EVENTS = Object.freeze({
  SCOPE_READY: 'scope-ready',
  ENTITIES_READY: 'entities-ready',
  DSL_COMPLETE: 'dsl-complete'
})

export const STREAMING_PARSER_ERROR_CODES = Object.freeze({
  TRUNCATED: 'planner_stream_truncated',
  MALFORMED: 'planner_stream_malformed'
})

function isWhitespace(char) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function toStringChunk(chunk) {
  if (chunk === null || chunk === undefined) return ''
  return String(chunk)
}

function moveStateForward(currentState, nextState) {
  const currentOrder = STREAMING_PARSER_STATE_ORDER[currentState] ?? 0
  const nextOrder = STREAMING_PARSER_STATE_ORDER[nextState] ?? 0
  return nextOrder > currentOrder ? nextState : currentState
}

function analyzeJsonBalance(text = '') {
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

function classifyParseFailure(text = '', error) {
  const message = String(error?.message || '')
  const lower = message.toLowerCase()
  const balance = analyzeJsonBalance(text)
  const truncatedDetected =
    lower.includes('unexpected end') ||
    lower.includes('end of json input') ||
    balance.in_string ||
    balance.brace_depth > 0 ||
    balance.bracket_depth > 0

  return {
    truncated_detected: truncatedDetected,
    parse_error: truncatedDetected ? null : (message || 'parse_error'),
    error_code: truncatedDetected
      ? STREAMING_PARSER_ERROR_CODES.TRUNCATED
      : STREAMING_PARSER_ERROR_CODES.MALFORMED
  }
}

function scanDslSignals(text = '') {
  let structuralDepth = 0
  let inString = false
  let escape = false

  let rootExpectingKey = false
  let rootWaitingColon = false
  let rootWaitingValue = false
  let capturingRootKey = false
  let rootKeyBuffer = ''
  let lastRootKey = null

  let scopeTracking = false
  let scopeStartDepth = 0
  let scopeClosed = false

  let entitiesTracking = false
  let entitiesDepth = 0
  let entitiesExpectingKey = false
  let entitiesWaitingColon = false
  let entitiesWaitingValue = false
  let capturingEntitiesKey = false
  let entitiesKeyBuffer = ''
  let lastEntitiesKey = null

  let categoriesTracking = false
  let categoriesStartDepth = 0
  let categoriesClosed = false

  let rootStarted = false
  let rootClosed = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escape) {
        escape = false
        if (capturingRootKey) rootKeyBuffer += char
        if (capturingEntitiesKey) entitiesKeyBuffer += char
        continue
      }
      if (char === '\\') {
        escape = true
        if (capturingRootKey) rootKeyBuffer += char
        if (capturingEntitiesKey) entitiesKeyBuffer += char
        continue
      }
      if (char === '"') {
        inString = false
        if (capturingRootKey) {
          capturingRootKey = false
          lastRootKey = rootKeyBuffer
          rootKeyBuffer = ''
          rootWaitingColon = true
          rootExpectingKey = false
        } else if (capturingEntitiesKey) {
          capturingEntitiesKey = false
          lastEntitiesKey = entitiesKeyBuffer
          entitiesKeyBuffer = ''
          entitiesWaitingColon = true
          entitiesExpectingKey = false
        }
        continue
      }
      if (capturingRootKey) rootKeyBuffer += char
      if (capturingEntitiesKey) entitiesKeyBuffer += char
      continue
    }

    if (rootWaitingValue && !isWhitespace(char)) {
      if (lastRootKey === 'scope' && char === '{') {
        scopeTracking = true
        scopeStartDepth = structuralDepth
      }
      if (lastRootKey === 'entities' && char === '{') {
        entitiesTracking = true
        entitiesDepth = structuralDepth
      }
      rootWaitingValue = false
    }

    if (entitiesTracking && entitiesWaitingValue && !isWhitespace(char)) {
      if (lastEntitiesKey === 'categories' && char === '[') {
        categoriesTracking = true
        categoriesStartDepth = structuralDepth
      }
      entitiesWaitingValue = false
    }

    if (char === '"') {
      inString = true
      if (structuralDepth === 1 && rootExpectingKey) {
        capturingRootKey = true
        rootKeyBuffer = ''
      } else if (entitiesTracking && structuralDepth === entitiesDepth + 1 && entitiesExpectingKey) {
        capturingEntitiesKey = true
        entitiesKeyBuffer = ''
      }
      continue
    }

    if (char === '{') {
      structuralDepth += 1
      if (structuralDepth === 1) {
        rootStarted = true
        rootExpectingKey = true
        rootWaitingColon = false
        rootWaitingValue = false
        lastRootKey = null
      }
      if (entitiesTracking && structuralDepth === entitiesDepth + 1) {
        entitiesExpectingKey = true
        entitiesWaitingColon = false
        entitiesWaitingValue = false
        lastEntitiesKey = null
      }
      continue
    }

    if (char === '}') {
      structuralDepth -= 1
      if (scopeTracking && structuralDepth === scopeStartDepth) {
        scopeTracking = false
        scopeClosed = true
      }
      if (entitiesTracking && structuralDepth === entitiesDepth) {
        entitiesTracking = false
        entitiesExpectingKey = false
        entitiesWaitingColon = false
        entitiesWaitingValue = false
        lastEntitiesKey = null
      }
      if (rootStarted && structuralDepth === 0) {
        rootClosed = true
      }
      if (structuralDepth < 0) structuralDepth = 0
      continue
    }

    if (char === '[') {
      structuralDepth += 1
      continue
    }

    if (char === ']') {
      structuralDepth -= 1
      if (categoriesTracking && structuralDepth === categoriesStartDepth) {
        categoriesTracking = false
        categoriesClosed = true
      }
      if (structuralDepth < 0) structuralDepth = 0
      continue
    }

    if (structuralDepth === 1 && rootWaitingColon && char === ':') {
      rootWaitingColon = false
      rootWaitingValue = true
      continue
    }

    if (structuralDepth === 1 && char === ',') {
      rootExpectingKey = true
      rootWaitingColon = false
      rootWaitingValue = false
      lastRootKey = null
      continue
    }

    if (entitiesTracking && structuralDepth === entitiesDepth + 1 && entitiesWaitingColon && char === ':') {
      entitiesWaitingColon = false
      entitiesWaitingValue = true
      continue
    }

    if (entitiesTracking && structuralDepth === entitiesDepth + 1 && char === ',') {
      entitiesExpectingKey = true
      entitiesWaitingColon = false
      entitiesWaitingValue = false
      lastEntitiesKey = null
    }
  }

  return {
    scope_closed: scopeClosed,
    entities_categories_closed: categoriesClosed,
    root_closed: rootClosed
  }
}

function buildEvent(type, state, chunkIndex) {
  return {
    type,
    state,
    chunk_index: Number.isInteger(chunkIndex) ? chunkIndex : null,
    ts: Date.now()
  }
}

export function createDslStreamingParser(options = {}) {
  const onEvent = typeof options?.onEvent === 'function' ? options.onEvent : null

  let state = STREAMING_PARSER_STATES.S0
  let chunkIndex = -1
  let text = ''
  let finished = false
  let lastResult = null

  let scopeEventEmitted = false
  let entitiesEventEmitted = false
  let completeEventEmitted = false

  const events = []

  const emitEvent = (type, nextState) => {
    state = moveStateForward(state, nextState)
    const event = buildEvent(type, state, chunkIndex)
    events.push(event)
    if (onEvent) {
      try {
        onEvent(event)
      } catch {
      }
    }
  }

  const processSignals = () => {
    const signals = scanDslSignals(text)

    if (signals.scope_closed && !scopeEventEmitted) {
      scopeEventEmitted = true
      emitEvent(STREAMING_PARSER_EVENTS.SCOPE_READY, STREAMING_PARSER_STATES.S1)
    }

    if (signals.entities_categories_closed && !entitiesEventEmitted) {
      entitiesEventEmitted = true
      emitEvent(STREAMING_PARSER_EVENTS.ENTITIES_READY, STREAMING_PARSER_STATES.S2)
    }

    if (signals.root_closed && !completeEventEmitted) {
      completeEventEmitted = true
      emitEvent(STREAMING_PARSER_EVENTS.DSL_COMPLETE, STREAMING_PARSER_STATES.S3)
    }
  }

  return {
    push(chunk) {
      if (finished) return this.snapshot()
      chunkIndex += 1
      text += toStringChunk(chunk)
      processSignals()
      return this.snapshot()
    },

    finish() {
      if (finished) return lastResult
      finished = true
      processSignals()

      try {
        const parsedDsl = JSON.parse(text)
        if (!completeEventEmitted) {
          completeEventEmitted = true
          emitEvent(STREAMING_PARSER_EVENTS.DSL_COMPLETE, STREAMING_PARSER_STATES.S3)
        }
        state = moveStateForward(state, STREAMING_PARSER_STATES.S3)
        lastResult = {
          ok: true,
          state,
          chunk_count: Math.max(0, chunkIndex + 1),
          char_count: text.length,
          truncated_detected: false,
          parse_error: null,
          error_code: null,
          parsed_dsl: parsedDsl,
          events: events.slice()
        }
        return lastResult
      } catch (error) {
        const classification = classifyParseFailure(text, error)
        lastResult = {
          ok: false,
          state,
          chunk_count: Math.max(0, chunkIndex + 1),
          char_count: text.length,
          truncated_detected: classification.truncated_detected,
          parse_error: classification.parse_error,
          error_code: classification.error_code,
          parsed_dsl: null,
          events: events.slice()
        }
        return lastResult
      }
    },

    enterExecuting() {
      if (!finished) {
        this.finish()
      }

      if (!lastResult || lastResult.ok !== true) {
        return this.snapshot()
      }

      state = moveStateForward(state, STREAMING_PARSER_STATES.S4)
      lastResult = {
        ...lastResult,
        state
      }
      return this.snapshot()
    },

    snapshot() {
      return {
        state,
        chunk_count: Math.max(0, chunkIndex + 1),
        char_count: text.length,
        events: events.slice()
      }
    }
  }
}

export function parseStreamingDslChunks(chunks = [], options = {}) {
  const parser = createDslStreamingParser(options)
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    parser.push(chunk)
  }
  return parser.finish()
}

export default {
  STREAMING_PARSER_STATES,
  STREAMING_PARSER_EVENTS,
  STREAMING_PARSER_ERROR_CODES,
  createDslStreamingParser,
  parseStreamingDslChunks
}
