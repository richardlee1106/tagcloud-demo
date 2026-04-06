import { getToolCatalog } from '../spatial_core/toolCatalog.js'
import { TASK_TYPE_TO_ANSWER_STYLE } from './plannerTypes.js'

export const PLANNER_OUTPUT_CONTRACT = [
  '只输出一个合法 JSON 对象。',
  '不要输出 markdown，不要输出解释，不要输出思考过程。',
  '所有字段必须使用 snake_case。',
  '单锚点和双锚点统一放入 anchors[]。',
  'steps 是唯一执行描述。'
].join('\n')

export const PLANNER_FEW_SHOT_EXAMPLES = Object.freeze([
  {
    user_query: '武汉大学附近有哪些咖啡店？',
    why_this_plan: '单锚点 nearby lookup，先 resolve_anchor，再 search_nearby_pois；如果结果太少，再通过 condition 触发扩搜。',
    assistant_plan: {
      task_type_hint: 'nearby_lookup',
      user_goal: '找到武汉大学附近的咖啡店，并在结果不足时扩大半径继续检索。',
      anchors: [
        {
          place_name: '武汉大学',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '武汉大学',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's2_search_primary_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 800,
            filter: {
              category: '餐饮美食',
              subcategory: '咖啡'
            },
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's3_expand_primary_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 1200,
            filter: {
              category: '餐饮美食',
              subcategory: '咖啡'
            },
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: '$ref:s2_search_primary_nearby_pois.total_count < 8'
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 3,
        min_evidence_items: 5
      },
      answer_frame: {
        style: 'lookup',
        must_ground_in_evidence: true,
        required_sections: ['result_list', 'distance_summary'],
        forbidden_claims: ['不要凭空补充未被证据支持的营业状态或人气判断']
      }
    }
  },
  {
    user_query: '请分析武汉大学附近的配套、热门业态和明显缺口。',
    why_this_plan: 'support_gap_analysis 要明确用 gap 风格回答，并同时收集 nearby、macro、boundary 三类证据。',
    assistant_plan: {
      task_type_hint: 'support_gap_analysis',
      user_goal: '分析武汉大学附近的配套现状、热门业态和明显缺口，并要求结论基于空间证据。',
      anchors: [
        {
          place_name: '武汉大学',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '武汉大学',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's2_search_primary_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 1800,
            filter: {},
            limit: 80
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's3_macro_cell_analysis',
          tool: 'spatial_core.macro_cell_analysis',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 2800,
            focus: 'support_gap_analysis'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        },
        {
          step_id: 's4_build_boundary',
          tool: 'spatial_core.build_boundary',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            pois: '$ref:s2_search_primary_nearby_pois.pois'
          },
          expect_output: ['boundary', 'spatial_clusters'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 4,
        min_evidence_items: 6
      },
      answer_frame: {
        style: 'gap',
        must_ground_in_evidence: true,
        required_sections: ['supporting_facilities', 'hot_categories', 'gaps'],
        forbidden_claims: ['不能凭猜测声称某处缺少某类业态']
      }
    }
  },
  {
    user_query: '请概览武汉大学附近的空间结构和业态分布。',
    why_this_plan: 'overview 不是单纯 nearby list，需要 nearby 结果 + macro_cell_analysis + build_boundary 共同构成证据。',
    assistant_plan: {
      task_type_hint: 'area_overview',
      user_goal: '概览武汉大学附近的空间结构、代表性业态和热点分布。',
      anchors: [
        {
          place_name: '武汉大学',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '武汉大学',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's2_search_primary_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 1800,
            filter: {},
            limit: 80
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's3_macro_cell_analysis',
          tool: 'spatial_core.macro_cell_analysis',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 2800,
            focus: 'area_overview'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        },
        {
          step_id: 's4_build_boundary',
          tool: 'spatial_core.build_boundary',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            pois: '$ref:s2_search_primary_nearby_pois.pois'
          },
          expect_output: ['boundary', 'spatial_clusters'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 4,
        min_evidence_items: 6
      },
      answer_frame: {
        style: 'overview',
        must_ground_in_evidence: true,
        required_sections: ['spatial_structure', 'category_distribution'],
        forbidden_claims: ['不要将模糊热点边界写成精确行政边界']
      }
    }
  },
  {
    user_query: '比较武汉大学和湖北大学附近的业态差异。',
    why_this_plan: '双锚点 comparison 的关键是并行 resolve 两个 anchors，再以同口径分别采集 nearby 和 macro 证据。',
    assistant_plan: {
      task_type_hint: 'region_comparison',
      user_goal: '比较武汉大学和湖北大学周边业态的共性与差异，并基于双锚点同口径证据回答。',
      anchors: [
        {
          place_name: '武汉大学',
          role: 'primary'
        },
        {
          place_name: '湖北大学',
          role: 'secondary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '武汉大学',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's2_resolve_secondary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '湖北大学',
            role: 'secondary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's3_search_primary_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 1800,
            filter: {},
            limit: 80
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's4_search_secondary_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s2_resolve_secondary_anchor.anchor',
            radius_m: 1800,
            filter: {},
            limit: 80
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's5_macro_primary',
          tool: 'spatial_core.macro_cell_analysis',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 2800,
            focus: 'region_comparison'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        },
        {
          step_id: 's6_macro_secondary',
          tool: 'spatial_core.macro_cell_analysis',
          input: {
            anchor: '$ref:s2_resolve_secondary_anchor.anchor',
            radius_m: 2800,
            focus: 'region_comparison'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 6,
        min_evidence_items: 8
      },
      answer_frame: {
        style: 'comparison',
        must_ground_in_evidence: true,
        required_sections: ['shared_context', 'primary_differences'],
        forbidden_claims: ['不要把两个区域的单点样本差异夸大成绝对结论']
      }
    }
  },
  // B2 fix: site_suitability few-shot — covers the 5th task_type_hint
  {
    user_query: '光谷广场附近适合开什么类型的店？',
    why_this_plan: 'site_suitability 本质是 gap analysis 的变体，先 resolve_anchor，再 macro_cell 分析周边业态密度，再 search_nearby_pois 找具体 POI 验证缺口。',
    assistant_plan: {
      task_type_hint: 'site_suitability',
      user_goal: '分析光谷广场周边业态分布与缺口，推荐适合布局的商业类型。',
      anchors: [
        {
          place_name: '光谷广场',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '光谷广场',
            role: 'primary'
          },
          expect_output: ['anchor'],
          condition: null
        },
        {
          step_id: 's2_macro_analysis',
          tool: 'spatial_core.macro_cell_analysis',
          input: {
            anchor: '$ref:s1_resolve_anchor.anchor',
            radius_m: 1500,
            focus: 'site_suitability'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        },
        {
          step_id: 's3_search_nearby_pois',
          tool: 'spatial_core.search_nearby_pois',
          input: {
            anchor: '$ref:s1_resolve_anchor.anchor',
            radius_m: 1000,
            filter: {},
            limit: 50
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's4_vector_search',
          tool: 'spatial_core.vector_search',
          input: {
            anchor: '$ref:s1_resolve_anchor.anchor',
            limit: 20
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 4,
        min_evidence_items: 6
      },
      answer_frame: {
        style: 'gap',
        must_ground_in_evidence: true,
        required_sections: ['current_landscape', 'gaps', 'recommendations'],
        forbidden_claims: ['不要凭空推荐没有证据支撑的业态']
      }
    }
  }
])

function buildToolCatalogSection() {
  const catalog = getToolCatalog()

  return Object.values(catalog)
    .map((tool) => [
      `- ${tool.tool_name}`,
      `  - description: ${tool.description}`,
      `  - planning_notes: ${tool.planning_notes}`,
      `  - reliability: ${tool.reliability}`
    ].join('\n'))
    .join('\n')
}

function buildRuntimeToolCatalogSection() {
  const catalog = getToolCatalog()

  return Object.values(catalog)
    .map((tool) => tool.tool_name)
    .join('、')
}

function selectSingleRuntimeExample(userQuery = '') {
  const normalizedQuery = String(userQuery || '').trim()
  const examplesByTask = new Map(
    PLANNER_FEW_SHOT_EXAMPLES.map((example) => [example.assistant_plan.task_type_hint, example])
  )

  if (/(比较|对比|差异|区别|相比|相较|vs|VS)/u.test(normalizedQuery)) {
    return [examplesByTask.get('region_comparison')].filter(Boolean)
  }

  if (/(配套|热门业态|缺口|短板|不足|空白)/u.test(normalizedQuery)) {
    return [examplesByTask.get('support_gap_analysis')].filter(Boolean)
  }

  if (/(适合布局|适合开什么店|适合做什么|选址|什么业态|适合开)/u.test(normalizedQuery)) {
    return [examplesByTask.get('site_suitability')].filter(Boolean)
  }

  if (/(概览|概况|空间结构|业态分布|整体|总体)/u.test(normalizedQuery)) {
    return [examplesByTask.get('area_overview')].filter(Boolean)
  }

  return [examplesByTask.get('nearby_lookup')].filter(Boolean)
}

function selectFewShotExamples(userQuery = '', { promptProfile = 'full' } = {}) {
  if (String(promptProfile || '').trim() === 'runtime') {
    return selectSingleRuntimeExample(userQuery)
  }

  const normalizedQuery = String(userQuery || '').trim()
  const examplesByTask = new Map(
    PLANNER_FEW_SHOT_EXAMPLES.map((example) => [example.assistant_plan.task_type_hint, example])
  )

  const selected = []
  const pushExample = (taskTypeHint) => {
    const example = examplesByTask.get(taskTypeHint)
    if (!example) return
    if (!selected.includes(example)) {
      selected.push(example)
    }
  }

  // Always keep one canonical nearby example to anchor the format.
  pushExample('nearby_lookup')

  if (/(比较|对比|差异|区别|相比|相较|vs|VS)/u.test(normalizedQuery)) {
    pushExample('region_comparison')
    return selected
  }

  if (/(配套|热门业态|缺口|短板|不足|空白)/u.test(normalizedQuery)) {
    pushExample('support_gap_analysis')
    return selected
  }

  if (/(适合布局|适合开什么店|适合做什么|选址|什么业态|适合开)/u.test(normalizedQuery)) {
    pushExample('site_suitability')
    return selected
  }

  if (/(概览|概况|空间结构|业态分布|整体|总体)/u.test(normalizedQuery)) {
    pushExample('area_overview')
    return selected
  }

  // Default second example gives the model one macro task shape without overloading context.
  pushExample('area_overview')
  return selected
}

function buildFewShotMessages(examples = [], { promptProfile = 'full' } = {}) {
  const useRuntimeFormat = String(promptProfile || '').trim() === 'runtime'

  return examples.flatMap((example) => ([
    {
      role: 'user',
      content: useRuntimeFormat
        ? String(example.user_query || '').trim()
        : `用户问题：${example.user_query}`
    },
    {
      role: 'assistant',
      content: useRuntimeFormat
        ? JSON.stringify(example.assistant_plan)
        : JSON.stringify(example.assistant_plan, null, 2)
    }
  ]))
}

export function buildPlannerSystemPrompt({ promptProfile = 'full' } = {}) {
  const styleMappingText = Object.entries(TASK_TYPE_TO_ANSWER_STYLE)
    .map(([taskType, style]) => `${taskType} -> ${style}`)
    .join('；')

  if (String(promptProfile || '').trim() === 'runtime') {
    return [
      '你是 Geo RAG planner，只负责输出结构化 plan JSON。',
      '只输出一个合法 JSON 对象；不要 markdown、解释或思考过程。',
      '所有字段必须使用 snake_case；单锚点和双锚点统一放入 anchors[]；steps 是唯一执行描述。',
      `answer_frame.style 映射规则：${styleMappingText}。`,
      'steps.condition 只能用 $ref:step_id.field 引用已有步骤输出。',
      'search_nearby_pois 的 planner 输入只允许 anchor、radius_m、filter、limit。',
      '不要输出 query_embedding、semantic_weight、spatial_weight、lon、lat 等内部实现参数。',
      `可用工具：${buildRuntimeToolCatalogSection()}。`
    ].join('\n')
  }

  return [
    '你是 Geo RAG planner，不负责直接回答用户，而负责把用户问题翻译成结构化查询计划。',
    PLANNER_OUTPUT_CONTRACT,
    `answer_frame.style 映射规则：${styleMappingText}。`,
    'search_nearby_pois 必须围绕 PostGIS 参数设计：anchor + radius_m + filter + limit。',
    '不要在 planner-facing input 中暴露 query_embedding、semantic_weight、spatial_weight、lon、lat 等内部实现参数。',
    'condition 当前只是预留字符串字段；可以写简单条件表达式，但必须通过 $ref:step_id.field 引用已有步骤输出。',
    'answer_frame 必须明确回答风格，并要求回答基于证据。',
    '可用工具如下：',
    buildToolCatalogSection()
  ].join('\n')
}

export function buildPlannerPromptBundle({
  user_query: userQuery,
  prompt_profile: promptProfile = 'full'
} = {}) {
  const systemPrompt = buildPlannerSystemPrompt({ promptProfile })
  const selectedFewShotExamples = selectFewShotExamples(userQuery, {
    promptProfile
  })
  const userPrompt = String(promptProfile || '').trim() === 'runtime'
    ? [
      '按相同 schema 生成 plan。',
      `用户问题：${String(userQuery || '').trim()}`
    ].join('\n')
    : [
        '请根据当前工具目录和 planner schema，生成一个结构化 plan。',
        PLANNER_OUTPUT_CONTRACT,
        `用户问题：${String(userQuery || '').trim()}`
      ].join('\n')
  const messages = [
    { role: 'system', content: systemPrompt },
    ...buildFewShotMessages(selectedFewShotExamples, { promptProfile }),
    { role: 'user', content: userPrompt }
  ]

  return {
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    few_shot_examples: [...selectedFewShotExamples],
    output_contract: PLANNER_OUTPUT_CONTRACT,
    messages
  }
}

export default {
  PLANNER_FEW_SHOT_EXAMPLES,
  PLANNER_OUTPUT_CONTRACT,
  buildPlannerPromptBundle,
  buildPlannerSystemPrompt
}
