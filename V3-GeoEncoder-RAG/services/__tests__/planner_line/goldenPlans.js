export const STANDARD_10Q_GOLDEN_PLANS = [
  {
    case_id: 'q1_nearby_coffee_wuhan_university',
    user_query: '武汉大学附近有哪些咖啡店？',
    plan: {
      task_type_hint: 'nearby_lookup',
      user_goal: '找到武汉大学附近可步行到达的咖啡店，并返回足够的候选结果。',
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
    case_id: 'q2_nearby_metro_hubei_university',
    user_query: '湖北大学附近有哪些地铁站？',
    plan: {
      task_type_hint: 'nearby_lookup',
      user_goal: '找到湖北大学附近的地铁站，并优先给出步行半径内的站点。',
      anchors: [
        {
          place_name: '湖北大学',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '湖北大学',
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
            radius_m: 1200,
            filter: {
              category: '交通设施服务',
              subcategory: '地铁站'
            },
            limit: 20
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 2,
        min_evidence_items: 3
      },
      answer_frame: {
        style: 'lookup',
        must_ground_in_evidence: true,
        required_sections: ['result_list'],
        forbidden_claims: ['不要臆测尚未建设或未在证据中的地铁线路']
      }
    }
  },
  {
    case_id: 'q3_nearby_hospital_wuhan_university',
    user_query: '武汉大学附近有哪些医院？',
    plan: {
      task_type_hint: 'nearby_lookup',
      user_goal: '找到武汉大学附近的医院，并优先返回距离较近的医疗点。',
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
            radius_m: 1500,
            filter: {
              category: '医疗保健服务'
            },
            limit: 25
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 2,
        min_evidence_items: 4
      },
      answer_frame: {
        style: 'lookup',
        must_ground_in_evidence: true,
        required_sections: ['result_list'],
        forbidden_claims: ['不要把药店、诊所和综合医院混写成同一种设施']
      }
    }
  },
  {
    case_id: 'q4_nearby_supermarket_wuhan_university',
    user_query: '武汉大学附近有哪些商超？',
    plan: {
      task_type_hint: 'nearby_lookup',
      user_goal: '找到武汉大学附近的商超和便利零售设施。',
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
            radius_m: 1200,
            filter: {
              category: '购物服务',
              subcategory: '商超'
            },
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 2,
        min_evidence_items: 5
      },
      answer_frame: {
        style: 'lookup',
        must_ground_in_evidence: true,
        required_sections: ['result_list'],
        forbidden_claims: ['不要把学校内楼栋或服务中心误写成商超']
      }
    }
  },
  {
    case_id: 'q5_nearby_coffee_optics_valley',
    user_query: '光谷附近有哪些咖啡店？',
    plan: {
      task_type_hint: 'nearby_lookup',
      user_goal: '围绕光谷这一稳定地名锚点查找附近的咖啡店。',
      anchors: [
        {
          place_name: '光谷',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '光谷',
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
            radius_m: 1500,
            filter: {
              category: '餐饮美食',
              subcategory: '咖啡'
            },
            limit: 30
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 2,
        min_evidence_items: 5
      },
      answer_frame: {
        style: 'lookup',
        must_ground_in_evidence: true,
        required_sections: ['result_list'],
        forbidden_claims: ['不要把整片商圈概念直接等同于单一 POI']
      }
    }
  },
  {
    case_id: 'q6_support_gap_wuhan_university',
    user_query: '请分析武汉大学附近的配套、热门业态和明显缺口。',
    plan: {
      task_type_hint: 'support_gap_analysis',
      user_goal: '基于武汉大学周边的真实空间证据，分析配套现状、热门业态和明显缺口。',
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
            radius_m: 1500,
            filter: {},
            limit: 60
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's3_macro_cell_analysis',
          tool: 'spatial_core.macro_cell_analysis',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 2500,
            focus: 'support_gap_analysis'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 3,
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
    case_id: 'q7_support_gap_hubei_university',
    user_query: '请分析湖北大学附近的配套、热门业态和明显缺口。',
    plan: {
      task_type_hint: 'support_gap_analysis',
      user_goal: '基于湖北大学周边证据分析配套现状、热门业态和明显缺口。',
      anchors: [
        {
          place_name: '湖北大学',
          role: 'primary'
        }
      ],
      steps: [
        {
          step_id: 's1_resolve_primary_anchor',
          tool: 'spatial_core.resolve_anchor',
          input: {
            place_name: '湖北大学',
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
            radius_m: 1500,
            filter: {},
            limit: 60
          },
          expect_output: ['pois', 'total_count'],
          condition: null
        },
        {
          step_id: 's3_macro_cell_analysis',
          tool: 'spatial_core.macro_cell_analysis',
          input: {
            anchor: '$ref:s1_resolve_primary_anchor.anchor',
            radius_m: 2500,
            focus: 'support_gap_analysis'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 3,
        min_evidence_items: 6
      },
      answer_frame: {
        style: 'gap',
        must_ground_in_evidence: true,
        required_sections: ['supporting_facilities', 'hot_categories', 'gaps'],
        forbidden_claims: ['不能用单个 POI 的印象替代整个区域的结构性结论']
      }
    }
  },
  {
    case_id: 'q8_overview_wuhan_university',
    user_query: '请概览武汉大学附近的空间结构和业态分布。',
    plan: {
      task_type_hint: 'area_overview',
      user_goal: '概览武汉大学附近的空间结构、代表性业态和区域底色。',
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
    case_id: 'q9_site_suitability_wuhan_university',
    user_query: '武汉大学附近适合布局什么业态？',
    plan: {
      task_type_hint: 'site_suitability',
      user_goal: '基于武汉大学周边现状判断更适合补充哪些业态，而不是直接拍脑袋推荐。',
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
            radius_m: 1500,
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
            radius_m: 2500,
            focus: 'site_suitability'
          },
          expect_output: ['support_buckets', 'support_bucket_metrics', 'population_metrics', 'uncertainty'],
          condition: null
        }
      ],
      stop_conditions: {
        max_rounds: 1,
        max_queries: 3,
        min_evidence_items: 6
      },
      answer_frame: {
        style: 'gap',
        must_ground_in_evidence: true,
        required_sections: ['current_baseline', 'recommended_categories'],
        forbidden_claims: ['不能在没有证据时断言某类业态一定盈利']
      }
    }
  },
  {
    case_id: 'q10_region_comparison_wuhan_vs_hubei_university',
    user_query: '比较武汉大学和湖北大学附近的业态差异。',
    plan: {
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
  }
]

export function getGoldenPlanCases() {
  return STANDARD_10Q_GOLDEN_PLANS.map((item) => ({
    ...item
  }))
}
