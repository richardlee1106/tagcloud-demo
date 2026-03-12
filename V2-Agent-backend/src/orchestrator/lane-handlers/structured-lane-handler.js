export function createStructuredLaneHandler({
  handle
} = {}) {
  if (typeof handle !== 'function') {
    throw new Error('structured_lane_handler_requires_handle')
  }

  return {
    handle
  }
}
