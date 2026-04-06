export const SPATIAL_TOOL_SCHEMAS = Object.freeze({
  'spatial_core.resolve_anchor': {
    tool_name: 'spatial_core.resolve_anchor',
    handler_key: 'resolve_anchor',
    input_schema: {
      type: 'object',
      required: ['place_name'],
      properties: {
        place_name: { type: 'string', description: '待解析的地名锚点' },
        role: { type: 'string', description: 'anchor 角色，例如 primary / secondary' },
        search_hint: { type: 'string', description: '可选的补充搜索提示' },
        search_radius_m: { type: 'number', description: '可选的地名解析辅助半径' }
      },
      additional_properties: false
    },
    output_schema: {
      type: 'object',
      required: ['anchor'],
      properties: {
        anchor: {
          type: 'object',
          required: ['place_name', 'role'],
          properties: {
            place_name: { type: 'string' },
            display_name: { type: 'string' },
            role: { type: 'string' },
            index: { type: 'number' },
            lon: { type: 'number' },
            lat: { type: 'number' },
            source: { type: 'string' },
            resolved_place_name: { type: 'string' },
            poi_id: { type: ['string', 'number', 'null'] }
          }
        }
      }
    }
  },
  'spatial_core.search_nearby_pois': {
    tool_name: 'spatial_core.search_nearby_pois',
    handler_key: 'search_nearby_pois',
    input_schema: {
      type: 'object',
      required: ['anchor', 'radius_m', 'filter', 'limit'],
      properties: {
        anchor: { type: ['object', 'string'], description: '结构化 anchor 或 $ref' },
        radius_m: { type: 'number', description: 'PostGIS 半径过滤参数（米）' },
        filter: {
          type: 'object',
          required: [],
          properties: {
            category: { type: 'string' },
            subcategory: { type: 'string' },
            target_region: { type: ['number', 'string'] },
            region_filter_mode: { type: 'string' }
          },
          additional_properties: false
        },
        limit: { type: 'number' },
        sort_by: { type: 'string' }
      },
      additional_properties: false
    },
    output_schema: {
      type: 'object',
      required: ['pois', 'total_count'],
      properties: {
        pois: { type: 'array' },
        total_count: { type: 'number' }
      }
    }
  },
  'spatial_core.vector_search': {
    tool_name: 'spatial_core.vector_search',
    handler_key: 'vector_search',
    input_schema: {
      type: 'object',
      required: ['anchor', 'limit'],
      properties: {
        anchor: { type: ['object', 'string'] },
        limit: { type: 'number' },
        filter: {
          type: 'object',
          required: [],
          properties: {
            category: { type: 'string' },
            subcategory: { type: 'string' },
            target_region: { type: ['number', 'string'] }
          },
          additional_properties: false
        },
        target: { type: 'string' }
      },
      additional_properties: false
    },
    output_schema: {
      type: 'object',
      required: ['pois', 'total_count'],
      properties: {
        pois: { type: 'array' },
        total_count: { type: 'number' }
      }
    }
  },
  'spatial_core.macro_cell_analysis': {
    tool_name: 'spatial_core.macro_cell_analysis',
    handler_key: 'macro_cell_analysis',
    input_schema: {
      type: 'object',
      required: ['anchor', 'radius_m', 'focus'],
      properties: {
        anchor: { type: ['object', 'string'] },
        radius_m: { type: 'number' },
        focus: { type: 'string' },
        limit: { type: 'number' }
      },
      additional_properties: false
    },
    output_schema: {
      type: 'object',
      required: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
      properties: {
        support_buckets: { type: 'array' },
        support_bucket_metrics: { type: 'array' },
        population_metrics: { type: ['object', 'null'] },
        uncertainty: { type: ['object', 'null'] }
      }
    }
  },
  'spatial_core.spatial_encode': {
    tool_name: 'spatial_core.spatial_encode',
    handler_key: 'spatial_encode',
    input_schema: {
      type: 'object',
      required: ['anchor'],
      properties: {
        anchor: { type: ['object', 'string'] },
        focus: { type: 'string' }
      },
      additional_properties: false
    },
    output_schema: {
      type: 'object',
      required: ['anchor_context'],
      properties: {
        anchor_context: { type: 'object' }
      }
    }
  },
  'spatial_core.build_boundary': {
    tool_name: 'spatial_core.build_boundary',
    handler_key: 'build_boundary',
    input_schema: {
      type: 'object',
      required: ['anchor', 'pois'],
      properties: {
        anchor: { type: ['object', 'string'] },
        pois: { type: ['array', 'string'] },
        boundary_hint: { type: 'string' }
      },
      additional_properties: false
    },
    output_schema: {
      type: 'object',
      required: ['boundary', 'spatial_clusters'],
      properties: {
        boundary: { type: ['object', 'null'] },
        spatial_clusters: { type: ['array', 'object'] }
      }
    }
  },
  'spatial_core.infer_intent_legacy': {
    tool_name: 'spatial_core.infer_intent_legacy',
    handler_key: 'infer_intent_legacy',
    input_schema: {
      type: 'object',
      required: ['user_query'],
      properties: {
        user_query: { type: 'string' }
      },
      additional_properties: false
    },
    output_schema: {
      type: 'object',
      required: ['intent'],
      properties: {
        intent: { type: 'object' }
      }
    }
  }
})

export const SPATIAL_TOOL_NAMES = Object.freeze(Object.keys(SPATIAL_TOOL_SCHEMAS))

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateObjectShape(path, value, schema, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`)
    return
  }

  for (const key of schema.required || []) {
    if (!(key in value)) {
      errors.push(`${path}.${key} is required`)
    }
  }

  const allowedKeys = Object.keys(schema.properties || {})
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key) && schema.additional_properties === false) {
      errors.push(`${path}.${key} is not allowed`)
    }
  }

  for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
    if (!(key in value)) continue
    if (propertySchema?.type === 'object' && propertySchema.properties) {
      validateObjectShape(`${path}.${key}`, value[key], propertySchema, errors)
    }
  }
}

export function getToolSchema(toolName) {
  return SPATIAL_TOOL_SCHEMAS[toolName] || null
}

export function validateToolInputShape(toolName, input) {
  const schema = getToolSchema(toolName)
  if (!schema) {
    return {
      ok: false,
      errors: [`Unknown tool schema: ${toolName}`]
    }
  }

  const errors = []
  validateObjectShape(`${toolName}.input`, input, schema.input_schema, errors)

  return {
    ok: errors.length === 0,
    errors
  }
}

export default {
  SPATIAL_TOOL_NAMES,
  SPATIAL_TOOL_SCHEMAS,
  getToolSchema,
  validateToolInputShape
}
