export function createLegacyLaneHandler({
  handle
} = {}) {
  if (typeof handle !== 'function') {
    throw new Error('legacy_lane_handler_requires_handle')
  }

  return {
    handle
  }
}
