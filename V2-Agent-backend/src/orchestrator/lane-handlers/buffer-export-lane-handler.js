export function createBufferExportLaneHandler({
  handle
} = {}) {
  if (typeof handle !== 'function') {
    throw new Error('buffer_export_lane_handler_requires_handle')
  }

  return {
    handle
  }
}
