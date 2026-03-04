import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STREAMING_PARSER_ERROR_CODES,
  STREAMING_PARSER_EVENTS,
  STREAMING_PARSER_STATES,
  createDslStreamingParser
} from '../services/dslStreamingParser.js'

test('dslStreamingParser emits scope/entities/dsl_complete events in order', () => {
  const events = []
  const parser = createDslStreamingParser({
    onEvent: (event) => events.push(event)
  })

  parser.push('{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]},')
  parser.push('"entities":{"categories":["coffee","bakery"]},"constraints":{"latency_budget_ms":1800}}')

  const result = parser.finish()

  assert.equal(result.ok, true)
  assert.equal(result.error_code, null)
  assert.equal(result.state, STREAMING_PARSER_STATES.S3)
  assert.equal(result.parsed_dsl?.scope?.geometry_source, 'viewport')
  assert.equal(result.parsed_dsl?.entities?.categories?.length, 2)
  assert.deepEqual(
    events.map((event) => event.type),
    [
      STREAMING_PARSER_EVENTS.SCOPE_READY,
      STREAMING_PARSER_EVENTS.ENTITIES_READY,
      STREAMING_PARSER_EVENTS.DSL_COMPLETE
    ]
  )
})

test('dslStreamingParser marks truncated stream with dedicated error code', () => {
  const parser = createDslStreamingParser()
  parser.push('{"dsl_version":"spatial_query_v1","scope":{"geometry_source":"viewport","viewport":[114.3,30.5')

  const result = parser.finish()

  assert.equal(result.ok, false)
  assert.equal(result.truncated_detected, true)
  assert.equal(result.parse_error, null)
  assert.equal(result.error_code, STREAMING_PARSER_ERROR_CODES.TRUNCATED)
})

test('dslStreamingParser marks malformed stream with dedicated error code', () => {
  const parser = createDslStreamingParser()
  parser.push('{"dsl_version":"spatial_query_v1","scope":')
  parser.push(',"entities":{"categories":["coffee"]}}')
  parser.push('{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]}')

  const result = parser.finish()

  assert.equal(result.ok, false)
  assert.equal(result.truncated_detected, false)
  assert.equal(typeof result.parse_error, 'string')
  assert.equal(result.error_code, STREAMING_PARSER_ERROR_CODES.MALFORMED)
})

test('dslStreamingParser can transition from S3 to S4 when execution starts', () => {
  const parser = createDslStreamingParser()
  parser.push('{"dsl_version":"spatial_query_v1","task":{"query_type":"area_analysis"},"scope":{"geometry_source":"viewport","viewport":[114.3,30.5,114.4,30.6]},')
  parser.push('"entities":{"categories":["coffee"]}}')

  const finished = parser.finish()
  assert.equal(finished.ok, true)
  assert.equal(finished.state, STREAMING_PARSER_STATES.S3)

  const executing = parser.enterExecuting()
  assert.equal(executing.state, STREAMING_PARSER_STATES.S4)
})
