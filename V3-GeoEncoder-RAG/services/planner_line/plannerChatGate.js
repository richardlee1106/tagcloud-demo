function normalizeTaskType(value = '') {
  return String(value || '').trim().toLowerCase()
}

function parseTaskWhitelist(raw = '') {
  return new Set(
    String(raw || '')
      .split(',')
      .map((item) => normalizeTaskType(item))
      .filter(Boolean)
  )
}

export function shouldUsePlannerLineChat({
  isSpatialQuery = false,
  intent = {},
  options = {},
  env = process.env
} = {}) {
  if (!isSpatialQuery) return false
  if (options?.plannerLine !== true) return false
  if (String(env?.PLANNER_CHAT_ENABLED || '').trim().toLowerCase() !== 'true') return false

  const whitelist = parseTaskWhitelist(env?.PLANNER_CHAT_TASK_TYPES || 'nearby_lookup')
  const taskType = normalizeTaskType(intent?.taskType || intent?.answerType)

  return whitelist.has(taskType)
}

export default {
  shouldUsePlannerLineChat
}
