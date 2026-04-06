import { getToolDefinition } from './toolCatalog.js'
import { SPATIAL_TOOL_NAMES, validateToolInputShape } from './toolSchemas.js'

export function createToolRunner({ handlers = {} } = {}) {
  async function runTool({ tool_name: toolName, input = {} } = {}, context = {}) {
    const definition = getToolDefinition(toolName)
    if (!definition) {
      throw new Error(`Unknown tool: ${toolName}`)
    }

    const validation = validateToolInputShape(toolName, input)
    if (!validation.ok) {
      throw new Error(`Invalid tool input for ${toolName}: ${validation.errors.join('; ')}`)
    }

    const handler = handlers[definition.handler_key]
    if (typeof handler !== 'function') {
      throw new Error(`No handler registered for ${toolName} (${definition.handler_key})`)
    }

    const output = await handler(input, context)

    return {
      tool_name: toolName,
      output
    }
  }

  return {
    listTools() {
      return [...SPATIAL_TOOL_NAMES]
    },
    hasTool(toolName) {
      return SPATIAL_TOOL_NAMES.includes(toolName)
    },
    runTool
  }
}

export default {
  createToolRunner
}
