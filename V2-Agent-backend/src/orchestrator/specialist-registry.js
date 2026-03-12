export function createSpecialistRegistry({ definitions = [] } = {}) {
  const specialists = new Map()

  function register(definition = {}) {
    const id = String(definition.id || '').trim()
    if (!id) {
      throw new Error('invalid_specialist_id')
    }

    if (typeof definition.run !== 'function') {
      throw new Error(`invalid_specialist_runner:${id}`)
    }

    const supportsObjectives = Array.isArray(definition.supports_objectives)
      ? definition.supports_objectives
      : ['*']

    specialists.set(id, {
      id,
      run: definition.run,
      supports_objectives: supportsObjectives,
      timeout_ms: Number(definition.timeout_ms || 0) || null,
      fallback_policy: definition.fallback_policy ?? null
    })

    return id
  }

  function listKnownSpecialists() {
    return Array.from(specialists.keys())
  }

  function resolve(task = {}) {
    const specialistId = String(task.specialist_id || '').trim()
    const definition = specialists.get(specialistId)
    if (!definition) {
      throw new Error(`unknown_specialist:${specialistId}`)
    }

    const objective = String(task?.objectiveContract?.objective || '').trim()
    const supports = definition.supports_objectives
    const supportsAll = supports.includes('*')
    const supportsObjective = objective ? supports.includes(objective) : true
    if (!supportsAll && !supportsObjective) {
      throw new Error(`unsupported_objective:${specialistId}:${objective || 'unknown'}`)
    }

    return definition
  }

  async function runTask(task = {}) {
    const definition = resolve(task)
    return definition.run({
      groundingResult: task.groundingResult,
      objectiveContract: task.objectiveContract,
      specialistTask: task
    })
  }

  for (const definition of definitions) {
    register(definition)
  }

  return {
    register,
    resolve,
    runTask,
    listKnownSpecialists
  }
}
