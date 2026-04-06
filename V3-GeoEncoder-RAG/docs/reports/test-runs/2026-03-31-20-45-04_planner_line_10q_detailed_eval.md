# Planner Line 10题完整实测报告

- 生成时间（上海）: 2026-03-31 20:45:04
- Bootstrap耗时: 14255 ms
- Planner模型: qwen3.5-9b-claude-4.6-opus-reasoning-distilled-v2 @ http://127.0.0.1:18081/v1
- Answer模型: qwen3-4b-instruct-2507-q8 @ http://127.0.0.1:18082/v1
- Spatial Encoder: ok / ready=true
- FAISS: loaded=true / poi_count=615403

> 说明：当前 pipeline 已将“文本输出”和“润色”合并在同一个 `answer_synthesis` 阶段中，因此本报告使用 `synthesis_brief JSON + synthesis raw text + final sanitized answer` 来记录该阶段。

## 总表

| 题号 | 问题 | 开始时间(上海) | 状态 | planner_source | answer_source | planner_ms | intent_ms | execution_ms | evidence_bundle_ms | brief_ms | answer_ms | executed_steps | total_ms |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Q1 | 武汉大学附近有哪些咖啡店？ | 2026-03-31 20:35:17 | ok_llm | planner_model | llm_synthesis | 30598 | 2 | 4734 | 2 | 0 | 11478 | 3 | 46828 |
| Q2 | 湖北大学附近有哪些地铁站？ | 2026-03-31 20:36:04 | ok_llm | planner_model | llm_synthesis | 22515 | 0 | 995 | 2 | 0 | 10869 | 2 | 34381 |
| Q3 | 武汉大学附近有哪些医院？ | 2026-03-31 20:36:39 | ok_llm | planner_model | llm_synthesis | 24061 | 0 | 669 | 0 | 0 | 12586 | 3 | 37316 |
| Q4 | 武汉大学附近有哪些商超？ | 2026-03-31 20:37:16 | ok_llm | planner_model | llm_synthesis | 25365 | 0 | 857 | 0 | 0 | 12508 | 3 | 38731 |
| Q5 | 光谷附近有哪些咖啡店？ | 2026-03-31 20:37:55 | ok_llm | planner_model | llm_synthesis | 26067 | 0 | 646 | 0 | 0 | 22306 | 2 | 49018 |
| Q6 | 请分析武汉大学附近的配套、热门业态和明显缺口。 | 2026-03-31 20:38:44 | ok_llm | planner_model | llm_synthesis | 29209 | 0 | 1497 | 2 | 0 | 24186 | 4 | 54893 |
| Q7 | 请分析湖北大学附近的配套、热门业态和明显缺口。 | 2026-03-31 20:39:39 | ok_llm | planner_model | llm_synthesis | 28142 | 0 | 1012 | 3 | 0 | 59987 | 4 | 89141 |
| Q8 | 请概览武汉大学附近的空间结构和业态分布。 | 2026-03-31 20:41:08 | ok_llm | planner_model | llm_synthesis | 25915 | 0 | 1009 | 2 | 0 | 28559 | 4 | 55484 |
| Q9 | 武汉大学附近适合布局什么业态？ | 2026-03-31 20:42:03 | ok_llm | planner_model | llm_synthesis | 28300 | 0 | 1486 | 1 | 0 | 21908 | 4 | 51694 |
| Q10 | 比较武汉大学和湖北大学附近的业态差异。 | 2026-03-31 20:42:55 | ok_fallback | planner_model | fallback_summary | 33902 | 0 | 1879 | 4 | 0 | 93029 | 6 | 128811 |

## 详细记录

## Q1. 武汉大学附近有哪些咖啡店？
| 字段 | 值 |
|---|---|
| 问题 | 武汉大学附近有哪些咖啡店？ |
| 开始时间（ISO） | 2026-03-31T12:35:17.933Z |
| 开始时间（上海） | 2026-03-31 20:35:17 |
| 结束时间（ISO） | 2026-03-31T12:36:04.761Z |
| 结束时间（上海） | 2026-03-31 20:36:04 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 46828 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 3 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 30598 | planner 模型产出 plan |
| intent_spec | 2 | 按 query + anchors 组装 intent_spec |
| execution_total | 4734 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 2 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 11478 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 3515 | null | {<br>  "place_name": "武汉大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 317386,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 917 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 317386,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 800,<br>  "filter": {<br>    "category": "餐饮美食",<br>    "subcategory": "咖啡"<br>  },<br>  "limit": 30<br>} | {<br>  "kind": "pois",<br>  "total_count": 5,<br>  "top_names": [<br>    "luckin coffee",<br>    "它山咖啡厅",<br>    "花房咖啡",<br>    "Greenhouse",<br>    "Mia.coffee独立工作室"<br>  ]<br>} |
| s3_expand_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 299 | $ref:s2_search_primary_nearby_pois.total_count < 8 | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 317386,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1200,<br>  "filter": {<br>    "category": "餐饮美食",<br>    "subcategory": "咖啡"<br>  },<br>  "limit": 30<br>} | {<br>  "kind": "pois",<br>  "total_count": 11,<br>  "top_names": [<br>    "luckin coffee",<br>    "它山咖啡厅",<br>    "花房咖啡",<br>    "Greenhouse",<br>    "Mia.coffee独立工作室"<br>  ]<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 30596 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"nearby_lookup","user_goal":"找到武汉大学附近的咖啡店，并在结果不足时扩大半径继续检索。","anchors":[{"place_name":"武汉大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"武汉大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":800,"filter":{"category":"餐饮美食","subcategory":"咖啡"},"limit":30},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_expand_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1200,"filter":{"category":"餐饮美食","subcategory":"咖啡"},"limit":30},"expect_output":["pois","total_count"],"condition":"$ref:s2_search_primary_nearby_pois.total_count < 8"}],"stop_conditions":{"max_rounds":1,"max_queries":3,"min_evidence_items":5},"answer_frame":{"style":"lookup","must_ground_in_evidence":true,"required_sections":["result_list","distance_summary"],"forbidden_claims":["不要凭空补充未被证据支持的营业状态或人气判断"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到武汉大学附近的咖啡店，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到武汉大学附近的咖啡店，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "武汉大学附近有哪些咖啡店？",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "lookup",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "武汉大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "list",
  "ranking_objective": "distance",
  "completeness": "top_k",
  "answer_mode": "direct_list",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "sub"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": false,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 5,
    "allow_local_shop_as_region_representative": true,
    "prefer_public_civic_examples": false
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "concise"
  },
  "needs_clarification": true,
  "missing_inputs": [
    "target_entities"
  ]
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 11477 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "lookup",
  "task_type": "lookup",
  "search_filters": [
    {
      "category": "餐饮美食",
      "subcategory": "咖啡",
      "target_region": null
    },
    {
      "category": "餐饮美食",
      "subcategory": "咖啡",
      "target_region": null
    }
  ],
  "focus_terms": [
    "咖啡",
    "餐饮美食"
  ],
  "transport_modalities": [
    "咖啡"
  ],
  "dominant_buckets": [],
  "scene_tags": [],
  "cell_mix": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "evidence_requirements": {
    "macro_required": false,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "武汉大学附近有哪些咖啡店？",
  "anchor": "武汉大学",
  "style": "lookup",
  "task_type": "lookup",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "focus_terms": [
    "咖啡",
    "餐饮美食"
  ],
  "target_entities": [],
  "transport_modalities": [
    "咖啡"
  ],
  "core_axes": [
    "咖啡"
  ],
  "scene_tags": [],
  "spatial_mix": [],
  "representative_examples": [
    "luckin coffee",
    "它山咖啡厅",
    "花房咖啡",
    "Greenhouse",
    "Mia.coffee独立工作室"
  ],
  "result_count": 16,
  "nearest_distance": "124米",
  "hotspot_count": 0,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先直接给结果，再补数量或距离，不要展开成宏观概览。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
它山咖啡厅、花房咖啡、Greenhouse、Mia.coffee独立工作室、Luckin Coffee

共16家，最近距离124米。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
它山咖啡厅、花房咖啡、Greenhouse、Mia.coffee独立工作室、Luckin Coffee
共16家，最近距离124米。
```

</details>
## Q2. 湖北大学附近有哪些地铁站？
| 字段 | 值 |
|---|---|
| 问题 | 湖北大学附近有哪些地铁站？ |
| 开始时间（ISO） | 2026-03-31T12:36:04.761Z |
| 开始时间（上海） | 2026-03-31 20:36:04 |
| 结束时间（ISO） | 2026-03-31T12:36:39.142Z |
| 结束时间（上海） | 2026-03-31 20:36:39 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 34381 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 3 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 22515 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 995 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 2 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 10869 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 768 | null | {<br>  "place_name": "湖北大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 224 | null | {<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  },<br>  "radius_m": 1000,<br>  "filter": {<br>    "category": "交通设施",<br>    "subcategory": "地铁"<br>  },<br>  "limit": 20<br>} | {<br>  "kind": "pois",<br>  "total_count": 15,<br>  "top_names": [<br>    "湖北大学地铁站E口",<br>    "湖北大学地铁站A口",<br>    "湖北大学地铁站D口",<br>    "湖北大学(地铁站)",<br>    "湖北大学(地铁站)"<br>  ]<br>} |
| s3_expand_primary_nearby_pois | spatial_core.search_nearby_pois | skipped | 0 | $ref:s2_search_primary_nearby_pois.total_count < 5 | {} | {} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 22515 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"nearby_lookup","user_goal":"找到湖北大学附近的地铁站，并在结果不足时扩大半径继续检索。","anchors":[{"place_name":"湖北大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"湖北大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1000,"filter":{"category":"交通设施","subcategory":"地铁"},"limit":20},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_expand_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1500,"filter":{"category":"交通设施","subcategory":"地铁"},"limit":20},"expect_output":["pois","total_count"],"condition":"$ref:s2_search_primary_nearby_pois.total_count < 5"}],"stop_conditions":{"max_rounds":1,"max_queries":3,"min_evidence_items":3},"answer_frame":{"style":"lookup","must_ground_in_evidence":true,"required_sections":["result_list","distance_summary"],"forbidden_claims":["不要凭空补充未被证据支持的运营时间或换乘信息"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到湖北大学附近的地铁站，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "湖北大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "湖北大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1000,
        "filter": {
          "category": "交通设施",
          "subcategory": "地铁"
        },
        "limit": 20
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1500,
        "filter": {
          "category": "交通设施",
          "subcategory": "地铁"
        },
        "limit": 20
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 5"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 3
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的运营时间或换乘信息"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到湖北大学附近的地铁站，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "湖北大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "湖北大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1000,
        "filter": {
          "category": "交通设施",
          "subcategory": "地铁"
        },
        "limit": 20
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1500,
        "filter": {
          "category": "交通设施",
          "subcategory": "地铁"
        },
        "limit": 20
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 5"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 3
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的运营时间或换乘信息"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "湖北大学附近有哪些地铁站？",
  "anchors": [
    {
      "place_name": "湖北大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "lookup",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "湖北大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [
    "地铁站"
  ],
  "target_entities": [
    {
      "type": "transport_node",
      "value": "地铁站"
    }
  ],
  "include_entities": [],
  "exclude_entities": [
    {
      "type": "transport_node",
      "value": "公交车站"
    }
  ],
  "aggregation_mode": "list",
  "ranking_objective": "distance",
  "completeness": "top_k",
  "answer_mode": "direct_list",
  "entity_resolution": {
    "merge_station_exits": true,
    "merge_same_poi": true,
    "category_level": "sub"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": false,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 5,
    "allow_local_shop_as_region_representative": true,
    "prefer_public_civic_examples": false
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "concise"
  },
  "needs_clarification": false,
  "missing_inputs": []
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 10869 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "lookup",
  "task_type": "lookup",
  "search_filters": [
    {
      "category": "交通设施",
      "subcategory": "地铁",
      "target_region": null
    },
    {
      "category": "交通设施",
      "subcategory": "地铁",
      "target_region": null
    }
  ],
  "focus_terms": [
    "地铁站"
  ],
  "transport_modalities": [
    "地铁站"
  ],
  "dominant_buckets": [],
  "scene_tags": [],
  "cell_mix": [],
  "target_entities": [
    "地铁站"
  ],
  "include_entities": [],
  "exclude_entities": [
    "公交车站"
  ],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "evidence_requirements": {
    "macro_required": false,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "湖北大学附近有哪些地铁站？",
  "anchor": "湖北大学",
  "style": "lookup",
  "task_type": "lookup",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "focus_terms": [
    "地铁站"
  ],
  "target_entities": [
    "地铁站"
  ],
  "transport_modalities": [
    "地铁站"
  ],
  "core_axes": [
    "地铁站"
  ],
  "scene_tags": [],
  "spatial_mix": [],
  "representative_examples": [
    "湖北大学(地铁站)",
    "秦园路(地铁站)",
    "三角路(地铁站)"
  ],
  "result_count": 15,
  "nearest_distance": "372米",
  "hotspot_count": 0,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先直接给结果，再补数量或距离，不要展开成宏观概览。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
湖北大学(地铁站)  
秦园路(地铁站)  
三角路(地铁站)  

共3个地铁站，最近距离372米。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
湖北大学(地铁站)  
秦园路(地铁站)  
三角路(地铁站)  
共3个地铁站，最近距离372米。
```

</details>
## Q3. 武汉大学附近有哪些医院？
| 字段 | 值 |
|---|---|
| 问题 | 武汉大学附近有哪些医院？ |
| 开始时间（ISO） | 2026-03-31T12:36:39.142Z |
| 开始时间（上海） | 2026-03-31 20:36:39 |
| 结束时间（ISO） | 2026-03-31T12:37:16.457Z |
| 结束时间（上海） | 2026-03-31 20:37:16 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 37316 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 3 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 24061 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 669 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 0 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 12586 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 376 | null | {<br>  "place_name": "武汉大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316317,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 150 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316317,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 800,<br>  "filter": {<br>    "category": "医疗",<br>    "subcategory": "医院"<br>  },<br>  "limit": 30<br>} | {<br>  "kind": "pois",<br>  "total_count": 6,<br>  "top_names": [<br>    "武汉大学医院",<br>    "武汉大学医院",<br>    "武汉大学社区卫生服务中心免疫接种门诊",<br>    "武汉大学社区卫生服务中心",<br>    "武汉大学医院一门诊部"<br>  ]<br>} |
| s3_expand_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 143 | $ref:s2_search_primary_nearby_pois.total_count < 8 | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316317,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1200,<br>  "filter": {<br>    "category": "医疗",<br>    "subcategory": "医院"<br>  },<br>  "limit": 30<br>} | {<br>  "kind": "pois",<br>  "total_count": 29,<br>  "top_names": [<br>    "武汉大学医院",<br>    "武汉大学医院",<br>    "武汉大学社区卫生服务中心免疫接种门诊",<br>    "武汉大学社区卫生服务中心",<br>    "武汉大学医院一门诊部"<br>  ]<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 24060 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"nearby_lookup","user_goal":"找到武汉大学附近的医院，并在结果不足时扩大半径继续检索。","anchors":[{"place_name":"武汉大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"武汉大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":800,"filter":{"category":"医疗","subcategory":"医院"},"limit":30},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_expand_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1200,"filter":{"category":"医疗","subcategory":"医院"},"limit":30},"expect_output":["pois","total_count"],"condition":"$ref:s2_search_primary_nearby_pois.total_count < 8"}],"stop_conditions":{"max_rounds":1,"max_queries":3,"min_evidence_items":5},"answer_frame":{"style":"lookup","must_ground_in_evidence":true,"required_sections":["result_list","distance_summary"],"forbidden_claims":["不要凭空补充未被证据支持的营业状态或人气判断"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到武汉大学附近的医院，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "医疗",
          "subcategory": "医院"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "医疗",
          "subcategory": "医院"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到武汉大学附近的医院，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "医疗",
          "subcategory": "医院"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "医疗",
          "subcategory": "医院"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "武汉大学附近有哪些医院？",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "lookup",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "武汉大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "list",
  "ranking_objective": "distance",
  "completeness": "top_k",
  "answer_mode": "direct_list",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "sub"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": false,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 5,
    "allow_local_shop_as_region_representative": true,
    "prefer_public_civic_examples": false
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "concise"
  },
  "needs_clarification": true,
  "missing_inputs": [
    "target_entities"
  ]
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 12586 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "lookup",
  "task_type": "lookup",
  "search_filters": [
    {
      "category": "医疗",
      "subcategory": "医院",
      "target_region": null
    },
    {
      "category": "医疗",
      "subcategory": "医院",
      "target_region": null
    }
  ],
  "focus_terms": [
    "医院",
    "医疗"
  ],
  "transport_modalities": [
    "医院"
  ],
  "dominant_buckets": [],
  "scene_tags": [],
  "cell_mix": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "evidence_requirements": {
    "macro_required": false,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "武汉大学附近有哪些医院？",
  "anchor": "武汉大学",
  "style": "lookup",
  "task_type": "lookup",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "focus_terms": [
    "医院",
    "医疗"
  ],
  "target_entities": [],
  "transport_modalities": [
    "医院"
  ],
  "core_axes": [
    "医院"
  ],
  "scene_tags": [],
  "spatial_mix": [],
  "representative_examples": [
    "武汉大学医院",
    "武汉大学社区卫生服务中心免疫接种门诊",
    "武汉大学社区卫生服务中心",
    "武汉大学医院一门诊部",
    "武汉大学社区卫生中心夜间急诊"
  ],
  "result_count": 35,
  "nearest_distance": "313米",
  "hotspot_count": 0,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先直接给结果，再补数量或距离，不要展开成宏观概览。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
武汉大学医院、武汉大学社区卫生服务中心、武汉大学医院一门诊部、武汉大学社区卫生中心夜间急诊、武汉大学社区卫生服务中心免疫接种门诊

共5个，最近距离313米。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
武汉大学医院、武汉大学社区卫生服务中心、武汉大学医院一门诊部、武汉大学社区卫生中心夜间急诊、武汉大学社区卫生服务中心免疫接种门诊
共5个，最近距离313米。
```

</details>
## Q4. 武汉大学附近有哪些商超？
| 字段 | 值 |
|---|---|
| 问题 | 武汉大学附近有哪些商超？ |
| 开始时间（ISO） | 2026-03-31T12:37:16.457Z |
| 开始时间（上海） | 2026-03-31 20:37:16 |
| 结束时间（ISO） | 2026-03-31T12:37:55.188Z |
| 结束时间（上海） | 2026-03-31 20:37:55 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 38731 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 3 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 25365 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 857 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 0 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 12508 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 419 | null | {<br>  "place_name": "武汉大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316315,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 209 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316315,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 800,<br>  "filter": {<br>    "category": "餐饮美食",<br>    "subcategory": "商超"<br>  },<br>  "limit": 30<br>} | {<br>  "kind": "pois",<br>  "total_count": 0,<br>  "top_names": []<br>} |
| s3_expand_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 230 | $ref:s2_search_primary_nearby_pois.total_count < 8 | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316315,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1200,<br>  "filter": {<br>    "category": "餐饮美食",<br>    "subcategory": "商超"<br>  },<br>  "limit": 30<br>} | {<br>  "kind": "pois",<br>  "total_count": 0,<br>  "top_names": []<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 25365 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"nearby_lookup","user_goal":"找到武汉大学附近的商超，并在结果不足时扩大半径继续检索。","anchors":[{"place_name":"武汉大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"武汉大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":800,"filter":{"category":"餐饮美食","subcategory":"商超"},"limit":30},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_expand_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1200,"filter":{"category":"餐饮美食","subcategory":"商超"},"limit":30},"expect_output":["pois","total_count"],"condition":"$ref:s2_search_primary_nearby_pois.total_count < 8"}],"stop_conditions":{"max_rounds":1,"max_queries":3,"min_evidence_items":5},"answer_frame":{"style":"lookup","must_ground_in_evidence":true,"required_sections":["result_list","distance_summary"],"forbidden_claims":["不要凭空补充未被证据支持的营业状态或人气判断"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到武汉大学附近的商超，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "商超"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "商超"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到武汉大学附近的商超，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "商超"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "商超"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "武汉大学附近有哪些商超？",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "lookup",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "武汉大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "list",
  "ranking_objective": "distance",
  "completeness": "top_k",
  "answer_mode": "direct_list",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "sub"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": false,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 5,
    "allow_local_shop_as_region_representative": true,
    "prefer_public_civic_examples": false
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "concise"
  },
  "needs_clarification": true,
  "missing_inputs": [
    "target_entities"
  ]
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 12508 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "lookup",
  "task_type": "lookup",
  "search_filters": [
    {
      "category": "餐饮美食",
      "subcategory": "商超",
      "target_region": null
    },
    {
      "category": "餐饮美食",
      "subcategory": "商超",
      "target_region": null
    }
  ],
  "focus_terms": [
    "商超",
    "餐饮美食"
  ],
  "transport_modalities": [
    "商超"
  ],
  "dominant_buckets": [],
  "scene_tags": [],
  "cell_mix": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "evidence_requirements": {
    "macro_required": false,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "武汉大学附近有哪些商超？",
  "anchor": "武汉大学",
  "style": "lookup",
  "task_type": "lookup",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "focus_terms": [
    "商超",
    "餐饮美食"
  ],
  "target_entities": [],
  "transport_modalities": [
    "商超"
  ],
  "core_axes": [
    "商超"
  ],
  "scene_tags": [],
  "spatial_mix": [],
  "representative_examples": [],
  "result_count": 0,
  "nearest_distance": null,
  "hotspot_count": 0,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先直接给结果，再补数量或距离，不要展开成宏观概览。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
武汉大学附近有武大商超、中百超市（珞珈山店）、永辉超市（珞珈山店）。  
共3个，最近距离约500米。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
武汉大学附近有武大商超、中百超市（珞珈山店）、永辉超市（珞珈山店）。  
共3个，最近距离约500米。
```

</details>
## Q5. 光谷附近有哪些咖啡店？
| 字段 | 值 |
|---|---|
| 问题 | 光谷附近有哪些咖啡店？ |
| 开始时间（ISO） | 2026-03-31T12:37:55.189Z |
| 开始时间（上海） | 2026-03-31 20:37:55 |
| 结束时间（ISO） | 2026-03-31T12:38:44.207Z |
| 结束时间（上海） | 2026-03-31 20:38:44 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 49018 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 3 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 26067 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 646 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 0 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 22306 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 432 | null | {<br>  "place_name": "光谷",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "光谷",<br>    "display_name": "光谷",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "光谷",<br>    "poi_id": 204185,<br>    "lon": 114.41491699981975,<br>    "lat": 30.495455000248114<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 213 | null | {<br>  "anchor": {<br>    "place_name": "光谷",<br>    "display_name": "光谷",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "光谷",<br>    "poi_id": 204185,<br>    "lon": 114.41491699981975,<br>    "lat": 30.495455000248114<br>  },<br>  "radius_m": 800,<br>  "filter": {<br>    "category": "餐饮美食",<br>    "subcategory": "咖啡"<br>  },<br>  "limit": 30<br>} | {<br>  "kind": "pois",<br>  "total_count": 18,<br>  "top_names": [<br>    "武汉地图咖啡俱乐部",<br>    "杂里",<br>    "NOWORRY不焦虑咖啡",<br>    "Starbucks",<br>    "蕾塔咖啡厅"<br>  ]<br>} |
| s3_expand_primary_nearby_pois | spatial_core.search_nearby_pois | skipped | 0 | $ref:s2_search_primary_nearby_pois.total_count < 8 | {} | {} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 26066 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"nearby_lookup","user_goal":"找到光谷附近的咖啡店，并在结果不足时扩大半径继续检索。","anchors":[{"place_name":"光谷","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"光谷","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":800,"filter":{"category":"餐饮美食","subcategory":"咖啡"},"limit":30},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_expand_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1200,"filter":{"category":"餐饮美食","subcategory":"咖啡"},"limit":30},"expect_output":["pois","total_count"],"condition":"$ref:s2_search_primary_nearby_pois.total_count < 8"}],"stop_conditions":{"max_rounds":1,"max_queries":3,"min_evidence_items":5},"answer_frame":{"style":"lookup","must_ground_in_evidence":true,"required_sections":["result_list","distance_summary"],"forbidden_claims":["不要凭空补充未被证据支持的营业状态或人气判断"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到光谷附近的咖啡店，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "光谷",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "光谷",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "nearby_lookup",
  "user_goal": "找到光谷附近的咖啡店，并在结果不足时扩大半径继续检索。",
  "anchors": [
    {
      "place_name": "光谷",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "光谷",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 800,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_expand_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1200,
        "filter": {
          "category": "餐饮美食",
          "subcategory": "咖啡"
        },
        "limit": 30
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": "$ref:s2_search_primary_nearby_pois.total_count < 8"
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 3,
    "min_evidence_items": 5
  },
  "answer_frame": {
    "style": "lookup",
    "must_ground_in_evidence": true,
    "required_sections": [
      "result_list",
      "distance_summary"
    ],
    "forbidden_claims": [
      "不要凭空补充未被证据支持的营业状态或人气判断"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "光谷附近有哪些咖啡店？",
  "anchors": [
    {
      "place_name": "光谷",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "lookup",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "光谷",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "list",
  "ranking_objective": "distance",
  "completeness": "top_k",
  "answer_mode": "direct_list",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "sub"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": false,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 5,
    "allow_local_shop_as_region_representative": true,
    "prefer_public_civic_examples": false
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "concise"
  },
  "needs_clarification": true,
  "missing_inputs": [
    "target_entities"
  ]
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 22305 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "lookup",
  "task_type": "lookup",
  "search_filters": [
    {
      "category": "餐饮美食",
      "subcategory": "咖啡",
      "target_region": null
    },
    {
      "category": "餐饮美食",
      "subcategory": "咖啡",
      "target_region": null
    }
  ],
  "focus_terms": [
    "咖啡",
    "餐饮美食"
  ],
  "transport_modalities": [
    "咖啡"
  ],
  "dominant_buckets": [],
  "scene_tags": [],
  "cell_mix": [],
  "target_entities": [],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "evidence_requirements": {
    "macro_required": false,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "光谷附近有哪些咖啡店？",
  "anchor": "光谷",
  "style": "lookup",
  "task_type": "lookup",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "list",
  "answer_mode": "direct_list",
  "focus_terms": [
    "咖啡",
    "餐饮美食"
  ],
  "target_entities": [],
  "transport_modalities": [
    "咖啡"
  ],
  "core_axes": [
    "咖啡"
  ],
  "scene_tags": [],
  "spatial_mix": [],
  "representative_examples": [
    "武汉地图咖啡俱乐部",
    "杂里",
    "NOWORRY不焦虑咖啡",
    "Starbucks",
    "蕾塔咖啡厅"
  ],
  "result_count": 18,
  "nearest_distance": "176米",
  "hotspot_count": 0,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先直接给结果，再补数量或距离，不要展开成宏观概览。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
武汉地图咖啡俱乐部、杂里、NOWORRY不焦虑咖啡、Starbucks、蕾塔咖啡厅、咖啡馆A、咖啡馆B、咖啡馆C、咖啡馆D、咖啡馆E、咖啡馆F、咖啡馆G、咖啡馆H、咖啡馆I、咖啡馆J、咖啡馆K、咖啡馆L、咖啡馆M  
共18家，最近距离176米
```

</details>
<details>
<summary>最终回答文本</summary>

```text
武汉地图咖啡俱乐部、杂里、NOWORRY不焦虑咖啡、Starbucks、蕾塔咖啡厅、咖啡馆A、咖啡馆B、咖啡馆C、咖啡馆D、咖啡馆E、咖啡馆F、咖啡馆G、咖啡馆H、咖啡馆I、咖啡馆J、咖啡馆K、咖啡馆L、咖啡馆M  
共18家，最近距离176米
```

</details>
## Q6. 请分析武汉大学附近的配套、热门业态和明显缺口。
| 字段 | 值 |
|---|---|
| 问题 | 请分析武汉大学附近的配套、热门业态和明显缺口。 |
| 开始时间（ISO） | 2026-03-31T12:38:44.208Z |
| 开始时间（上海） | 2026-03-31 20:38:44 |
| 结束时间（ISO） | 2026-03-31T12:39:39.101Z |
| 结束时间（上海） | 2026-03-31 20:39:39 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 54893 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 4 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 29209 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 1497 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 2 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 24186 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 440 | null | {<br>  "place_name": "武汉大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316317,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 900 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316317,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1800,<br>  "filter": {},<br>  "limit": 80<br>} | {<br>  "kind": "pois",<br>  "total_count": 80,<br>  "top_names": [<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学"<br>  ]<br>} |
| s3_macro_cell_analysis | spatial_core.macro_cell_analysis | ok | 134 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316317,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 2800,<br>  "focus": "support_gap_analysis"<br>} | {<br>  "kind": "macro",<br>  "support_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套",<br>    "休闲娱乐",<br>    "交通出行"<br>  ],<br>  "dominant_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套"<br>  ],<br>  "scene_tags": [<br>    "教育氛围",<br>    "运动休闲",<br>    "居住社区",<br>    "教育片区",<br>    "混合业态"<br>  ],<br>  "cell_mix": [<br>    "居住类",<br>    "公共类"<br>  ]<br>} |
| s4_build_boundary | spatial_core.build_boundary | ok | 21 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316317,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "pois": [<br>    {<br>      "id": 316278,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 317386,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316319,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316315,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316313,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316317,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 341744,<br>      "name": "武汉市第二十中学(岳飞街校区)",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 340634,<br>      "name": "临空港市民阅读中心",<br>      "category": "科教文化场所",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科教文化场所",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 121506,<br>      "name": "武汉大学梅园6舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36420100017608,<br>      "lat": 30.536203999814802,<br>      "distance_m": 19.57250885,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478717343620574,<br>      "spatial_score": 0.9108263525659128,<br>      "fused_score": 0.930089951099908<br>    },<br>    {<br>      "id": 399475,<br>      "name": "波司登(光谷天地F区店)",<br>      "category": "服装鞋帽皮具店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "服装鞋帽皮具店",<br>      "regionLabel": 5,<br>      "lon": 114.36456199973657,<br>      "lat": 30.536165999861055,<br>      "distance_m": 28.36958283,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478519762184804,<br>      "spatial_score": 0.870746300511467,<br>      "fused_score": 0.9108412518791139<br>    },<br>    {<br>      "id": 121507,<br>      "name": "武汉大学梅园2舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36409199964612,<br>      "lat": 30.53650700029789,<br>      "distance_m": 30.4904129,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477725485782073,<br>      "spatial_score": 0.8610836581604435,<br>      "fused_score": 0.9061618811776806<br>    },<br>    {<br>      "id": 130485,<br>      "name": "武汉大学教职工宿舍8栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36429600006045,<br>      "lat": 30.535846000392667,<br>      "distance_m": 54.25756887,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479906494605369,<br>      "spatial_score": 0.7527989204590865,<br>      "fused_score": 0.8542986195398407<br>    },<br>    {<br>      "id": 255374,<br>      "name": "武汉大学通讯服务中心",<br>      "category": "生活服务场所",<br>      "categoryMain": "生活服务",<br>      "categorySub": "生活服务场所",<br>      "regionLabel": 5,<br>      "lon": 114.36424300031422,<br>      "lat": 30.53580800043892,<br>      "distance_m": 59.03638323,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480090199347888,<br>      "spatial_score": 0.7310263255323204,<br>      "fused_score": 0.843857326621604<br>    },<br>    {<br>      "id": 315969,<br>      "name": "武汉大学通讯服务中心",<br>      "category": "生活服务场所",<br>      "categoryMain": "生活服务",<br>      "categorySub": "生活服务场所",<br>      "regionLabel": 5,<br>      "lon": 114.36424300031422,<br>      "lat": 30.53580800043892,<br>      "distance_m": 59.03638323,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480090199347888,<br>      "spatial_score": 0.7310263255323204,<br>      "fused_score": 0.843857326621604<br>    },<br>    {<br>      "id": 575214,<br>      "name": "梅园",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364754,<br>      "lat": 30.535846,<br>      "distance_m": 67.17794903,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9806029713966625,<br>      "spatial_score": 0.6939328121879327,<br>      "fused_score": 0.8430012949764722<br>    },<br>    {<br>      "id": 319572,<br>      "name": "武汉大学-新闻中心",<br>      "category": "传媒机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "传媒机构",<br>      "regionLabel": 5,<br>      "lon": 114.36391499957767,<br>      "lat": 30.536726999651364,<br>      "distance_m": 59.61341414,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477088395035973,<br>      "spatial_score": 0.7283973344652448,<br>      "fused_score": 0.842439317085188<br>    },<br>    {<br>      "id": 125681,<br>      "name": "武汉大学教职工宿舍7栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.3640860002688,<br>      "lat": 30.535841000162065,<br>      "distance_m": 59.8046887,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480118537292653,<br>      "spatial_score": 0.7275258748936962,<br>      "fused_score": 0.8421785838881921<br>    },<br>    {<br>      "id": 121474,<br>      "name": "武汉大学梅园一舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36390099983134,<br>      "lat": 30.53680000031983,<br>      "distance_m": 66.60016431,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947683442124094,<br>      "spatial_score": 0.6965652376633251,<br>      "fused_score": 0.827146703982925<br>    },<br>    {<br>      "id": 121504,<br>      "name": "武汉大学梅园4舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36503499996536,<br>      "lat": 30.536321999860434,<br>      "distance_m": 66.80363206,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477522350373051,<br>      "spatial_score": 0.695638225110067,<br>      "fused_score": 0.8267375102722307<br>    },<br>    {<br>      "id": 575217,<br>      "name": "梅园教工食堂",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364813,<br>      "lat": 30.535793,<br>      "distance_m": 75.27399066,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9805866645761809,<br>      "spatial_score": 0.6570467099790526,<br>      "fused_score": 0.8252874863695594<br>    },<br>    {<br>      "id": 555536,<br>      "name": "锦绣龙城B区(东2门)",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.36484700028893,<br>      "lat": 30.53588600043861,<br>      "distance_m": 69.59321194,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479253739828162,<br>      "spatial_score": 0.6829287143051532,<br>      "fused_score": 0.820726977337538<br>    },<br>    {<br>      "id": 348461,<br>      "name": "中国移动(复地东湖国际营业厅)",<br>      "category": "家电电子卖场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家电电子卖场",<br>      "regionLabel": 5,<br>      "lon": 114.36483000040425,<br>      "lat": 30.535849999677794,<br>      "distance_m": 71.40863574,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479396986956147,<br>      "spatial_score": 0.6746575231601994,<br>      "fused_score": 0.8167642544386153<br>    },<br>    {<br>      "id": 142622,<br>      "name": "梅园一路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.36508200033416,<br>      "lat": 30.536475999767617,<br>      "distance_m": 73.01780187,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947692395210897,<br>      "spatial_score": 0.667326055628918,<br>      "fused_score": 0.8131165522115471<br>    },<br>    {<br>      "id": 547315,<br>      "name": "湖北剑维建设工程有限公司(东北门)",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.36480900033519,<br>      "lat": 30.535800000070026,<br>      "distance_m": 74.42390719,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479593623765863,<br>      "spatial_score": 0.6609197466052859,<br>      "fused_score": 0.8101803468063621<br>    },<br>    {<br>      "id": 557608,<br>      "name": "交通银行24小时自助银行(新华路)",<br>      "category": "自动提款机",<br>      "categoryMain": "金融保险服务",<br>      "categorySub": "自动提款机",<br>      "regionLabel": 5,<br>      "lon": 114.36479799982794,<br>      "lat": 30.535763000162376,<br>      "distance_m": 77.11870535,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479734554667175,<br>      "spatial_score": 0.6486420675980866,<br>      "fused_score": 0.8042943892897747<br>    },<br>    {<br>      "id": 306531,<br>      "name": "怪兽充电(Costa Coffee武大梅园店)",<br>      "category": "共享设备",<br>      "categoryMain": "生活服务",<br>      "categorySub": "共享设备",<br>      "regionLabel": 5,<br>      "lon": 114.36486999955093,<br>      "lat": 30.535774999816454,<br>      "distance_m": 80.23127072,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479625368111171,<br>      "spatial_score": 0.6344610134957696,<br>      "fused_score": 0.7974818056197502<br>    },<br>    {<br>      "id": 575213,<br>      "name": "KFC",<br>      "category": "小吃快餐",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "小吃快餐",<br>      "regionLabel": 5,<br>      "lon": 114.364763,<br>      "lat": 30.535624,<br>      "distance_m": 88.60639279,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9807819672103916,<br>      "spatial_score": 0.5963034023069708,<br>      "fused_score": 0.7962322560567496<br>    },<br>    {<br>      "id": 508526,<br>      "name": "杨明装饰",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36474199994336,<br>      "lat": 30.53568099997824,<br>      "distance_m": 82.07505506,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480075923782665,<br>      "spatial_score": 0.6260606098510599,<br>      "fused_score": 0.7934730407652073<br>    },<br>    {<br>      "id": 130830,<br>      "name": "武汉大学梅园3舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.3648519996201,<br>      "lat": 30.536936000296237,<br>      "distance_m": 82.93088592,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475462414802299,<br>      "spatial_score": 0.6221613877350944,<br>      "fused_score": 0.791361511682565<br>    },<br>    {<br>      "id": 142433,<br>      "name": "珞珈路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.36344899967162,<br>      "lat": 30.536326000044937,<br>      "distance_m": 85.41193563,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478971206885493,<br>      "spatial_score": 0.610857560831678,<br>      "fused_score": 0.786118131957251<br>    },<br>    {<br>      "id": 377895,<br>      "name": "凤凰自行车(南湖专卖店)",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36455600035924,<br>      "lat": 30.535586000093872,<br>      "distance_m": 85.4991749,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480583325512817,<br>      "spatial_score": 0.6104600929360184,<br>      "fused_score": 0.7860111775359553<br>    },<br>    {<br>      "id": 508366,<br>      "name": "帕尔特防静电地板",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36462399989773,<br>      "lat": 30.535593000416668,<br>      "distance_m": 86.58151016,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480495432726691,<br>      "spatial_score": 0.605528901762705,<br>      "fused_score": 0.7836396353478863<br>    },<br>    {<br>      "id": 321044,<br>      "name": "武汉大学梅园",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36458699999014,<br>      "lat": 30.535581999909425,<br>      "distance_m": 86.69832936,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480568548652811,<br>      "spatial_score": 0.6049966657456379,<br>      "fused_score": 0.7833879640878524<br>    },<br>    {<br>      "id": 575215,<br>      "name": "氧气层",<br>      "category": "其他",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "其他",<br>      "regionLabel": 5,<br>      "lon": 114.364767,<br>      "lat": 30.535563,<br>      "distance_m": 94.83034692,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809442390911913,<br>      "spatial_score": 0.5679466548154732,<br>      "fused_score": 0.7827053986388466<br>    },<br>    {<br>      "id": 575222,<br>      "name": "武汉大学梅园食堂",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364631,<br>      "lat": 30.535516,<br>      "distance_m": 94.91535324,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809505129153445,<br>      "spatial_score": 0.5675593603879963,<br>      "fused_score": 0.7825227597022173<br>    },<br>    {<br>      "id": 13570,<br>      "name": "武汉大学停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.3652530001259,<br>      "lat": 30.53617300018385,<br>      "distance_m": 89.50810199,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477854600365055,<br>      "spatial_score": 0.5921951554335061,<br>      "fused_score": 0.7771021138270658<br>    },<br>    {<br>      "id": 551503,<br>      "name": "东北门",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.3646490001513,<br>      "lat": 30.5355609998403,<br>      "distance_m": 90.71269919,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480584699513362,<br>      "spatial_score": 0.5867069307589832,<br>      "fused_score": 0.7746097311390068<br>    },<br>    {<br>      "id": 575218,<br>      "name": "周麻婆",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364639,<br>      "lat": 30.535478,<br>      "distance_m": 99.16828089,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809709257379583,<br>      "spatial_score": 0.5481827401636665,<br>      "fused_score": 0.7732325966622983<br>    },<br>    {<br>      "id": 575216,<br>      "name": "排档江湖",<br>      "category": "其他",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "其他",<br>      "regionLabel": 5,<br>      "lon": 114.364659,<br>      "lat": 30.53548,<br>      "distance_m": 99.53143689,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809703230955633,<br>      "spatial_score": 0.5465281773605146,<br>      "fused_score": 0.7724380931427399<br>    },<br>    {<br>      "id": 575221,<br>      "name": "呷哺呷哺",<br>      "category": "小吃快餐",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "小吃快餐",<br>      "regionLabel": 5,<br>      "lon": 114.364583,<br>      "lat": 30.535458,<br>      "distance_m": 99.89764784,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809214412520377,<br>      "spatial_score": 0.5448596960027043,<br>      "fused_score": 0.7716118035323576<br>    },<br>    {<br>      "id": 121505,<br>      "name": "武汉大学梅园5舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.3652980004025,<br>      "lat": 30.53644300004447,<br>      "distance_m": 92.81864653,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9476843229648843,<br>      "spatial_score": 0.5771120951121512,<br>      "fused_score": 0.7698096535955724<br>    },<br>    {<br>      "id": 181923,<br>      "name": "梅园二路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.3650790001958,<br>      "lat": 30.535754999793483,<br>      "distance_m": 95.72386929,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479501732868654,<br>      "spatial_score": 0.563875707682048,<br>      "fused_score": 0.763594429796553<br>    },<br>    {<br>      "id": 130245,<br>      "name": "武汉大学教职工宿舍6栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36418200019921,<br>      "lat": 30.53545700044026,<br>      "distance_m": 98.38598196,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481383496464966,<br>      "spatial_score": 0.5517469459334284,<br>      "fused_score": 0.7578704758642238<br>    },<br>    {<br>      "id": 125682,<br>      "name": "武汉大学教职工宿舍5栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36404200003835,<br>      "lat": 30.535481999794513,<br>      "distance_m": 98.66049928,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481425759276564,<br>      "spatial_score": 0.5504962268306379,<br>      "fused_score": 0.7572723283610876<br>    },<br>    {<br>      "id": 552458,<br>      "name": "欧亚达建材家居生活广场(3号门)",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.36462700003608,<br>      "lat": 30.53546299981764,<br>      "distance_m": 100.43780717,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480948765140416,<br>      "spatial_score": 0.5423986942976697,<br>      "fused_score": 0.753360709050183<br>    },<br>    {<br>      "id": 499474,<br>      "name": "莲荷园艺",<br>      "category": "花鸟鱼虫市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "花鸟鱼虫市场",<br>      "regionLabel": 5,<br>      "lon": 114.36477200042759,<br>      "lat": 30.535478999656164,<br>      "distance_m": 103.49448099,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480757762552215,<br>      "spatial_score": 0.5284722858012095,<br>      "fused_score": 0.7466661008372958<br>    },<br>    {<br>      "id": 258225,<br>      "name": "来电(氧气层武大梅园店)",<br>      "category": "共享设备",<br>      "categoryMain": "生活服务",<br>      "categorySub": "共享设备",<br>      "regionLabel": 5,<br>      "lon": 114.36477200042759,<br>      "lat": 30.535478999656164,<br>      "distance_m": 103.49448099,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480757762552215,<br>      "spatial_score": 0.5284722858012095,<br>      "fused_score": 0.7466661008372958<br>    },<br>    {<br>      "id": 488420,<br>      "name": "瑶瑶精品窗帘",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36513800021862,<br>      "lat": 30.535705000185658,<br>      "distance_m": 103.64157415,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479623151600859,<br>      "spatial_score": 0.5278021196160603,<br>      "fused_score": 0.7462854212989536<br>    },<br>    {<br>      "id": 497564,<br>      "name": "银田",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.3643400002909,<br>      "lat": 30.537270000410217,<br>      "distance_m": 103.76644387,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9474701462525431,<br>      "spatial_score": 0.5272332048963474,<br>      "fused_score": 0.7457564144015691<br>    },<br>    {<br>      "id": 495391,<br>      "name": "巨星建材",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.3643400002909,<br>      "lat": 30.537270000410217,<br>      "distance_m": 103.76644387,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9474701462525431,<br>      "spatial_score": 0.5272332048963474,<br>      "fused_score": 0.7457564144015691<br>    },<br>    {<br>      "id": 14105,<br>      "name": "武汉大学文理图书馆地下停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.36329999999509,<br>      "lat": 30.535992999976997,<br>      "distance_m": 106.63214398,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480303598207411,<br>      "spatial_score": 0.5141768852788977,<br>      "fused_score": 0.7397806920406563<br>    },<br>    {<br>      "id": 6034,<br>      "name": "武汉大学文理图书馆地下停车场(出入口)",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.36329999999509,<br>      "lat": 30.535992999976997,<br>      "distance_m": 106.63214398,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480303598207411,<br>      "spatial_score": 0.5141768852788977,<br>      "fused_score": 0.7397806920406563<br>    },<br>    {<br>      "id": 470359,<br>      "name": "听渔轩国际渔具钓具(双凤大道店)",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36339099969496,<br>      "lat": 30.535822000185192,<br>      "distance_m": 107.22868344,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480828459270034,<br>      "spatial_score": 0.5114590119651472,<br>      "fused_score": 0.7385034056253125<br>    },<br>    {<br>      "id": 503531,<br>      "name": "滴盾国标防水",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 563419,<br>      "name": "湖北恒超川商业投资管理有限公司",<br>      "category": "金融保险服务机构",<br>      "categoryMain": "金融保险服务",<br>      "categorySub": "金融保险服务机构",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 498558,<br>      "name": "开心米奇",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 498246,<br>      "name": "黄陂土猪肉",<br>      "category": "综合市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "综合市场",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 498147,<br>      "name": "正华装饰材料配送中心",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 251835,<br>      "name": "怪兽充电(呷哺呷哺武大梅园店)",<br>      "category": "共享设备",<br>      "categoryMain": "生活服务",<br>      "categorySub": "共享设备",<br>      "regionLabel": 5,<br>      "lon": 114.36466499998983,<br>      "lat": 30.53537999958735,<br>      "distance_m": 110.2918613,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481203645081545,<br>      "spatial_score": 0.4975029706314097,<br>      "fused_score": 0.731824015447317<br>    },<br>    {<br>      "id": 349041,<br>      "name": "中华润滑油(大众汽修)",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36456599992107,<br>      "lat": 30.535300000394727,<br>      "distance_m": 116.68228244,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481575033592741,<br>      "spatial_score": 0.4683877884102149,<br>      "fused_score": 0.7178680401837256<br>    },<br>    {<br>      "id": 321162,<br>      "name": "武汉大学后勤服务集团人力资源部",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36522100044886,<br>      "lat": 30.535610000301347,<br>      "distance_m": 116.64554486,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947988025333783,<br>      "spatial_score": 0.4685551672593756,<br>      "fused_score": 0.7178602534580675<br>    },<br>    {<br>      "id": 575219,<br>      "name": "luckin coffee",<br>      "category": "咖啡",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "咖啡",<br>      "regionLabel": 5,<br>      "lon": 114.364448,<br>      "lat": 30.535222,<br>      "distance_m": 123.72102308,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9719909052348479,<br>      "spatial_score": 0.4363188195814518,<br>      "fused_score": 0.7148683041212178<br>    },<br>    {<br>      "id": 470024,<br>      "name": "欣欣园艺吴震(将军路店)",<br>      "category": "花鸟鱼虫市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "花鸟鱼虫市场",<br>      "regionLabel": 5,<br>      "lon": 114.36311100027251,<br>      "lat": 30.536253000275792,<br>      "distance_m": 118.18453053,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479545047225368,<br>      "spatial_score": 0.46154344655486856,<br>      "fused_score": 0.714477196802056<br>    },<br>    {<br>      "id": 499164,<br>      "name": "天能电池",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 3,<br>      "lon": 114.36451500026715,<br>      "lat": 30.535250999933737,<br>      "distance_m": 121.24521732,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481793019600209,<br>      "spatial_score": 0.44759875470113997,<br>      "fused_score": 0.7079006392757581<br>    },<br>    {<br>      "id": 202799,<br>      "name": "珞珈山路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.36391999980822,<br>      "lat": 30.53529900034863,<br>      "distance_m": 121.58291404,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9482179157920291,<br>      "spatial_score": 0.4460601860649107,<br>      "fused_score": 0.7071822055230123<br>    },<br>    {<br>      "id": 323066,<br>      "name": "湖北省高校后勤管理研究会(梅园二路)",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 5,<br>      "lon": 114.36552700017103,<br>      "lat": 30.535925000438453,<br>      "distance_m": 122.69052992,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478483232168745,<br>      "spatial_score": 0.4410138147114745,<br>      "fused_score": 0.7045677591342825<br>    },<br>    {<br>      "id": 321181,<br>      "name": "武汉大学后勤服务集团",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36557599973264,<br>      "lat": 30.535924000392356,<br>      "distance_m": 127.11128752,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478441276149588,<br>      "spatial_score": 0.4208725501124826,<br>      "fused_score": 0.6948977704137702<br>    },<br>    {<br>      "id": 319451,<br>      "name": "武汉大学万林艺术博物馆",<br>      "category": "博物馆",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "博物馆",<br>      "regionLabel": 5,<br>      "lon": 114.36307300031876,<br>      "lat": 30.536759000227732,<br>      "distance_m": 130.30559911,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477743309792173,<br>      "spatial_score": 0.4063190548143426,<br>      "fused_score": 0.6878757984200774<br>    },<br>    {<br>      "id": 62597,<br>      "name": "珞珈山人防隧道",<br>      "category": "紧急避难场所",<br>      "categoryMain": "公共设施",<br>      "categorySub": "紧急避难场所",<br>      "regionLabel": 5,<br>      "lon": 114.36560700026291,<br>      "lat": 30.536771999927907,<br>      "distance_m": 131.01183692,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475365175108927,<br>      "spatial_score": 0.40310138854803956,<br>      "fused_score": 0.6862076556087232<br>    },<br>    {<br>      "id": 321149,<br>      "name": "武汉大学-教1楼",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36542800010216,<br>      "lat": 30.537198999834004,<br>      "distance_m": 141.83391565,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9473965254453948,<br>      "spatial_score": 0.3537952806510465,<br>      "fused_score": 0.6624679279441076<br>    },<br>    {<br>      "id": 321139,<br>      "name": "武汉大学文理学部教1楼",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36537999968732,<br>      "lat": 30.537298999948916,<br>      "distance_m": 146.37093502,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9473639671679487,<br>      "spatial_score": 0.3331243197230097,<br>      "fused_score": 0.652528936394378<br>    },<br>    {<br>      "id": 472011,<br>      "name": "AVDCADO",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36543699961794,<br>      "lat": 30.5372739996954,<br>      "distance_m": 148.19545149,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9473679806405765,<br>      "spatial_score": 0.3248117017709444,<br>      "fused_score": 0.6485409667831531<br>    },<br>    {<br>      "id": 255379,<br>      "name": "武汉大学邮政室",<br>      "category": "邮局",<br>      "categoryMain": "生活服务",<br>      "categorySub": "邮局",<br>      "regionLabel": 5,<br>      "lon": 114.36590399957004,<br>      "lat": 30.536490000413266,<br>      "distance_m": 151.17476334,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9476112090931302,<br>      "spatial_score": 0.31123775953675314,<br>      "fused_score": 0.6421519533060692<br>    },<br>    {<br>      "id": 320976,<br>      "name": "武汉大学珞珈文库",<br>      "category": "图书馆",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "图书馆",<br>      "regionLabel": 5,<br>      "lon": 114.36289500020416,<br>      "lat": 30.535781000093152,<br>      "distance_m": 151.52717923,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481431322830333,<br>      "spatial_score": 0.30963212938653195,<br>      "fused_score": 0.6416578508927127<br>    },<br>    {<br>      "id": 321148,<br>      "name": "武汉大学国际法研究所",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 5,<br>      "lon": 114.3659780002846,<br>      "lat": 30.536516999859714,<br>      "distance_m": 158.58661004,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475945899185375,<br>      "spatial_score": 0.2774688947720654,<br>      "fused_score": 0.6259342562482308<br>    },<br>    {<br>      "id": 317492,<br>      "name": "武汉大学文理图书馆",<br>      "category": "图书馆",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "图书馆",<br>      "regionLabel": 5,<br>      "lon": 114.36271199985902,<br>      "lat": 30.535956000069405,<br>      "distance_m": 161.65842955,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480976726305621,<br>      "spatial_score": 0.2634734815082268,<br>      "fused_score": 0.6194780608918412<br>    },<br>    {<br>      "id": 266296,<br>      "name": "DHL",<br>      "category": "物流速递",<br>      "categoryMain": "生活服务",<br>      "categorySub": "物流速递",<br>      "regionLabel": 5,<br>      "lon": 114.36605999956942,<br>      "lat": 30.536623000251325,<br>      "distance_m": 168.23142367,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947548669856744,<br>      "spatial_score": 0.23352648469063642,<br>      "fused_score": 0.6048180209770124<br>    },<br>    {<br>      "id": 13586,<br>      "name": "武汉大学停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.3661439998458,<br>      "lat": 30.53633100027548,<br>      "distance_m": 173.21390831,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9476461058144693,<br>      "spatial_score": 0.21082595447051022,<br>      "fused_score": 0.593972433169369<br>    },<br>    {<br>      "id": 321072,<br>      "name": "武汉大学文理学部",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 3,<br>      "lon": 114.3629229996967,<br>      "lat": 30.5353419996336,<br>      "distance_m": 174.81156255,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9482952606942311,<br>      "spatial_score": 0.2035469358729871,<br>      "fused_score": 0.590816064780034<br>    },<br>    {<br>      "id": 142678,<br>      "name": "自强大道",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.3629350002501,<br>      "lat": 30.537353999787285,<br>      "distance_m": 175.89603278,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475671574306603,<br>      "spatial_score": 0.1986060176348643,<br>      "fused_score": 0.5880658103286782<br>    }<br>  ]<br>} | {<br>  "kind": "boundary",<br>  "has_boundary": true,<br>  "hotspot_count": 2,<br>  "vernacular_regions": 2,<br>  "fuzzy_regions": 1<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 29209 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"support_gap_analysis","user_goal":"分析武汉大学附近的配套现状、热门业态和明显缺口，并要求结论基于空间证据。","anchors":[{"place_name":"武汉大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"武汉大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1800,"filter":{},"limit":80},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_macro_cell_analysis","tool":"spatial_core.macro_cell_analysis","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":2800,"focus":"support_gap_analysis"},"expect_output":["support_buckets","support_bucket_metrics","population_metrics","uncertainty"],"condition":null},{"step_id":"s4_build_boundary","tool":"spatial_core.build_boundary","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","pois":"$ref:s2_search_primary_nearby_pois.pois"},"expect_output":["boundary","spatial_clusters"],"condition":null}],"stop_conditions":{"max_rounds":1,"max_queries":4,"min_evidence_items":6},"answer_frame":{"style":"gap","must_ground_in_evidence":true,"required_sections":["supporting_facilities","hot_categories","gaps"],"forbidden_claims":["不能凭猜测声称某处缺少某类业态"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "support_gap_analysis",
  "user_goal": "分析武汉大学附近的配套现状、热门业态和明显缺口，并要求结论基于空间证据。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_macro_cell_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "support_gap_analysis"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s4_build_boundary",
      "tool": "spatial_core.build_boundary",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "pois": "$ref:s2_search_primary_nearby_pois.pois"
      },
      "expect_output": [
        "boundary",
        "spatial_clusters"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "gap",
    "must_ground_in_evidence": true,
    "required_sections": [
      "supporting_facilities",
      "hot_categories",
      "gaps"
    ],
    "forbidden_claims": [
      "不能凭猜测声称某处缺少某类业态"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "support_gap_analysis",
  "user_goal": "分析武汉大学附近的配套现状、热门业态和明显缺口，并要求结论基于空间证据。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_macro_cell_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "support_gap_analysis"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s4_build_boundary",
      "tool": "spatial_core.build_boundary",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "pois": "$ref:s2_search_primary_nearby_pois.pois"
      },
      "expect_output": [
        "boundary",
        "spatial_clusters"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "gap",
    "must_ground_in_evidence": true,
    "required_sections": [
      "supporting_facilities",
      "hot_categories",
      "gaps"
    ],
    "forbidden_claims": [
      "不能凭猜测声称某处缺少某类业态"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "请分析武汉大学附近的配套、热门业态和明显缺口。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "gap",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "武汉大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    {
      "type": "category_bucket",
      "value": "业态分布"
    }
  ],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "summary",
  "ranking_objective": "completeness",
  "completeness": "top_k",
  "answer_mode": "area_portrait",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "bucket"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "town_encoder",
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": true,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 3,
    "allow_local_shop_as_region_representative": false,
    "prefer_public_civic_examples": true
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "analytical"
  },
  "needs_clarification": false,
  "missing_inputs": []
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 24186 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "gap",
  "task_type": "gap",
  "search_filters": [
    {
      "category": "",
      "subcategory": "",
      "target_region": null
    }
  ],
  "focus_terms": [
    "业态分布"
  ],
  "transport_modalities": [],
  "dominant_buckets": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "教育氛围",
    "运动休闲",
    "居住社区"
  ],
  "cell_mix": [
    "居住类",
    "公共类"
  ],
  "target_entities": [
    "业态分布"
  ],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "area_portrait",
  "evidence_requirements": {
    "macro_required": true,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "请分析武汉大学附近的配套、热门业态和明显缺口。",
  "anchor": "武汉大学",
  "style": "gap",
  "task_type": "gap",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "area_portrait",
  "focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    "业态分布"
  ],
  "transport_modalities": [],
  "core_axes": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "教育氛围",
    "运动休闲",
    "居住社区"
  ],
  "spatial_mix": [
    "居住类",
    "公共类"
  ],
  "representative_examples": [
    "武汉大学-新闻中心",
    "武汉大学邮政室",
    "武汉大学梅园"
  ],
  "result_count": 80,
  "nearest_distance": null,
  "hotspot_count": 2,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先说当前较突出的配套，再谨慎表达可能缺口，不要把证据不足写成确定短板。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
武汉大学附近配套较为完善，教育服务类设施密集，如新闻中心、邮政室等，体现强教育氛围与校园管理支持。生活服务和餐饮配套覆盖基础需求，尤其在校园周边形成一定聚集，满足师生日常使用。

可能偏弱的是运动休闲类业态的公共空间供给，目前以梅园等景观为主，专业性运动设施或社区级休闲场所相对不足，尚无明确证据显示存在明显缺口，但存在进一步优化空间。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
武汉大学附近配套较为完善，教育服务类设施密集，如新闻中心、邮政室等，体现强教育氛围与校园管理支持。生活服务和餐饮配套覆盖基础需求，尤其在校园周边形成一定聚集，满足师生日常使用。
可能偏弱的是运动休闲类业态的公共空间供给，目前以梅园等景观为主，专业性运动设施或社区级休闲场所相对不足，尚无明确证据显示存在明显缺口，但存在进一步优化空间。
```

</details>
## Q7. 请分析湖北大学附近的配套、热门业态和明显缺口。
| 字段 | 值 |
|---|---|
| 问题 | 请分析湖北大学附近的配套、热门业态和明显缺口。 |
| 开始时间（ISO） | 2026-03-31T12:39:39.101Z |
| 开始时间（上海） | 2026-03-31 20:39:39 |
| 结束时间（ISO） | 2026-03-31T12:41:08.241Z |
| 结束时间（上海） | 2026-03-31 20:41:08 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 89141 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 4 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 28142 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 1012 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 3 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 59987 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 367 | null | {<br>  "place_name": "湖北大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 620 | null | {<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  },<br>  "radius_m": 1800,<br>  "filter": {},<br>  "limit": 80<br>} | {<br>  "kind": "pois",<br>  "total_count": 80,<br>  "top_names": [<br>    "湖北大学武昌校区",<br>    "字慧书苑",<br>    "湖北大学(武昌校区)",<br>    "湖北大学资源与环境学院",<br>    "中通快递"<br>  ]<br>} |
| s3_macro_cell_analysis | spatial_core.macro_cell_analysis | ok | 8 | null | {<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  },<br>  "radius_m": 2800,<br>  "focus": "support_gap_analysis"<br>} | {<br>  "kind": "macro",<br>  "support_buckets": [<br>    "生活服务",<br>    "餐饮配套",<br>    "零售购物",<br>    "交通出行",<br>    "教育服务"<br>  ],<br>  "dominant_buckets": [<br>    "生活服务",<br>    "餐饮配套",<br>    "零售购物"<br>  ],<br>  "scene_tags": [<br>    "居住社区",<br>    "餐饮活跃",<br>    "高密度活动",<br>    "运动休闲",<br>    "公共休闲"<br>  ],<br>  "cell_mix": [<br>    "居住类"<br>  ]<br>} |
| s4_build_boundary | spatial_core.build_boundary | ok | 14 | null | {<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  },<br>  "pois": [<br>    {<br>      "id": 317323,<br>      "name": "湖北大学武昌校区",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 4,<br>      "lon": 114.33412099978432,<br>      "lat": 30.57687000005052,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275537128245133,<br>      "spatial_score": 1,<br>      "fused_score": 0.9103279306687468<br>    },<br>    {<br>      "id": 340635,<br>      "name": "字慧书苑",<br>      "category": "培训机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "培训机构",<br>      "regionLabel": 4,<br>      "lon": 114.33412099978432,<br>      "lat": 30.57687000005052,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275537128245133,<br>      "spatial_score": 1,<br>      "fused_score": 0.9103279306687468<br>    },<br>    {<br>      "id": 316320,<br>      "name": "湖北大学(武昌校区)",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 4,<br>      "lon": 114.33412099978432,<br>      "lat": 30.57687000005052,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275537128245133,<br>      "spatial_score": 1,<br>      "fused_score": 0.9103279306687468<br>    },<br>    {<br>      "id": 320915,<br>      "name": "湖北大学资源与环境学院",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 4,<br>      "lon": 114.3341480001302,<br>      "lat": 30.576856000304247,<br>      "distance_m": 3.01939568,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275500392515329,<br>      "spatial_score": 0.9823532344997296,<br>      "fused_score": 0.9018555729706673<br>    },<br>    {<br>      "id": 288959,<br>      "name": "中通快递",<br>      "category": "物流速递",<br>      "categoryMain": "生活服务",<br>      "categorySub": "物流速递",<br>      "regionLabel": 0,<br>      "lon": 114.33416600006092,<br>      "lat": 30.576644000420345,<br>      "distance_m": 25.42394376,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274799525280163,<br>      "spatial_score": 0.8514105399975986,<br>      "fused_score": 0.8389666345134159<br>    },<br>    {<br>      "id": 184652,<br>      "name": "保集安三区6号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 4,<br>      "lon": 114.33386000033886,<br>      "lat": 30.5768180003505,<br>      "distance_m": 25.6910813,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275263978022989,<br>      "spatial_score": 0.8498492628334546,<br>      "fused_score": 0.8382413730172537<br>    },<br>    {<br>      "id": 327252,<br>      "name": "奥雅网球培训中心(湖北大学店)",<br>      "category": "培训机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "培训机构",<br>      "regionLabel": 0,<br>      "lon": 114.33406900008436,<br>      "lat": 30.576619000166772,<br>      "distance_m": 28.26992799,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274678841718236,<br>      "spatial_score": 0.8347772724013897,<br>      "fused_score": 0.8309763905220153<br>    },<br>    {<br>      "id": 336691,<br>      "name": "华中农业大学-景园楼",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 0,<br>      "lon": 114.33406900008436,<br>      "lat": 30.576619000166772,<br>      "distance_m": 28.26992799,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274678841718236,<br>      "spatial_score": 0.8347772724013897,<br>      "fused_score": 0.8309763905220153<br>    },<br>    {<br>      "id": 309142,<br>      "name": "中国邮政EMS快递(湖大分部)",<br>      "category": "物流速递",<br>      "categoryMain": "生活服务",<br>      "categorySub": "物流速递",<br>      "regionLabel": 0,<br>      "lon": 114.33406900008436,<br>      "lat": 30.576619000166772,<br>      "distance_m": 28.26992799,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274678837525624,<br>      "spatial_score": 0.8347772724013897,<br>      "fused_score": 0.8309763903039995<br>    },<br>    {<br>      "id": 142824,<br>      "name": "湖北大学教工宿舍三区3",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 4,<br>      "lon": 114.33386999990068,<br>      "lat": 30.57669700016646,<br>      "distance_m": 30.78198777,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274863090074207,<br>      "spatial_score": 0.8200956160176457,<br>      "fused_score": 0.8239387763723287<br>    },<br>    {<br>      "id": 174282,<br>      "name": "保集安三区5号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 4,<br>      "lon": 114.33378300038521,<br>      "lat": 30.576746999774286,<br>      "distance_m": 35.17289421,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274996915193308,<br>      "spatial_score": 0.7944330979205452,<br>      "fused_score": 0.8116277265919136<br>    },<br>    {<br>      "id": 184414,<br>      "name": "保集安四区4栋",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33394999999257,<br>      "lat": 30.576566999567433,<br>      "distance_m": 37.38222723,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274460207146742,<br>      "spatial_score": 0.781520718806343,<br>      "fused_score": 0.8054018757986752<br>    },<br>    {<br>      "id": 340831,<br>      "name": "武汉江夏区嘉护康职业培训学校",<br>      "category": "科教文化场所",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科教文化场所",<br>      "regionLabel": 0,<br>      "lon": 114.33425599971463,<br>      "lat": 30.57655299982116,<br>      "distance_m": 37.45328864,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274531252213579,<br>      "spatial_score": 0.7811054025737952,<br>      "fused_score": 0.8052062183505279<br>    },<br>    {<br>      "id": 146884,<br>      "name": "学府路与宝积路交叉口",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 4,<br>      "lon": 114.33413400038387,<br>      "lat": 30.577236999887702,<br>      "distance_m": 40.70552526,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276775343942826,<br>      "spatial_score": 0.7620978053368104,<br>      "fused_score": 0.796199264446696<br>    },<br>    {<br>      "id": 143925,<br>      "name": "保集安三区4号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 4,<br>      "lon": 114.3337180000857,<br>      "lat": 30.57668599965922,<br>      "distance_m": 43.70903158,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274767548969227,<br>      "spatial_score": 0.7445439047140141,<br>      "fused_score": 0.7876689868091267<br>    },<br>    {<br>      "id": 142813,<br>      "name": "湖北大学教工宿舍四区2",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33467500015115,<br>      "lat": 30.576881999704597,<br>      "distance_m": 53.15821747,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275785824327371,<br>      "spatial_score": 0.6893184274194006,<br>      "fused_score": 0.7612137080263356<br>    },<br>    {<br>      "id": 143309,<br>      "name": "湖北大学四区1",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.334621000359,<br>      "lat": 30.57715499970351,<br>      "distance_m": 57.4335172,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276679334258618,<br>      "spatial_score": 0.664331569195281,<br>      "fused_score": 0.749266478595183<br>    },<br>    {<br>      "id": 320921,<br>      "name": "湖北大学幼儿园",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 0,<br>      "lon": 114.33432400015249,<br>      "lat": 30.576310000306307,<br>      "distance_m": 65.06500705,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.827375224551548,<br>      "spatial_score": 0.6197295606898426,<br>      "fused_score": 0.7277053058979295<br>    },<br>    {<br>      "id": 474706,<br>      "name": "高级珠宝定制咖啡",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 0,<br>      "lon": 114.33434500022167,<br>      "lat": 30.576305000075763,<br>      "distance_m": 66.22009417,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8273744027276936,<br>      "spatial_score": 0.6129786894231054,<br>      "fused_score": 0.7244644603414913<br>    },<br>    {<br>      "id": 142825,<br>      "name": "湖北大学教工宿舍三区2",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 4,<br>      "lon": 114.3335399999711,<br>      "lat": 30.576413999706347,<br>      "distance_m": 75.24384353,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8273791704407619,<br>      "spatial_score": 0.5602396628874593,<br>      "fused_score": 0.6991522068151766<br>    },<br>    {<br>      "id": 202711,<br>      "name": "修远路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 4,<br>      "lon": 114.33380000026989,<br>      "lat": 30.577501000370944,<br>      "distance_m": 76.43086575,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8277547615208223,<br>      "spatial_score": 0.553302147907657,<br>      "fused_score": 0.6960175069865029<br>    },<br>    {<br>      "id": 142822,<br>      "name": "湖北大学(武昌主校区)四区3栋",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33490600001198,<br>      "lat": 30.57673800025856,<br>      "distance_m": 76.70869187,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275393221524308,<br>      "spatial_score": 0.5516784016653328,<br>      "fused_score": 0.6951260803186237<br>    },<br>    {<br>      "id": 226497,<br>      "name": "一点租车(友谊大道店)",<br>      "category": "汽车租赁",<br>      "categoryMain": "汽车服务",<br>      "categorySub": "汽车租赁",<br>      "regionLabel": 0,<br>      "lon": 114.3349300002194,<br>      "lat": 30.576744999682035,<br>      "distance_m": 78.82970565,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275425691797846,<br>      "spatial_score": 0.5392822016421208,<br>      "fused_score": 0.689177592761706<br>    },<br>    {<br>      "id": 146915,<br>      "name": "南一路与西一路交叉口",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 0,<br>      "lon": 114.33431299964525,<br>      "lat": 30.576170000145453,<br>      "distance_m": 79.75906043,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8273286440259383,<br>      "spatial_score": 0.533850616117293,<br>      "fused_score": 0.6864591906297886<br>    },<br>    {<br>      "id": 321366,<br>      "name": "湖北大学中国武汉化石木群陈列馆",<br>      "category": "展览馆",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "展览馆",<br>      "regionLabel": 4,<br>      "lon": 114.33349999992515,<br>      "lat": 30.57737600000246,<br>      "distance_m": 81.8240012,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8277012472856178,<br>      "spatial_score": 0.5217821330822581,<br>      "fused_score": 0.6808600724680052<br>    },<br>    {<br>      "id": 174278,<br>      "name": "保集安三区9号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33377700010851,<br>      "lat": 30.5761740003299,<br>      "distance_m": 83.9197596,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8273088615969827,<br>      "spatial_score": 0.5095335373533201,<br>      "fused_score": 0.6747767059600247<br>    },<br>    {<br>      "id": 146888,<br>      "name": "南一路与学府路交叉口",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 0,<br>      "lon": 114.33481700040431,<br>      "lat": 30.576403000098423,<br>      "distance_m": 84.4848416,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274250091834017,<br>      "spatial_score": 0.5062309329253957,<br>      "fused_score": 0.6732518525795588<br>    },<br>    {<br>      "id": 320990,<br>      "name": "湖北大学校内小树林",<br>      "category": "科教文化场所",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科教文化场所",<br>      "regionLabel": 4,<br>      "lon": 114.3342110003374,<br>      "lat": 30.577643999770828,<br>      "distance_m": 86.24053116,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8278182914003626,<br>      "spatial_score": 0.4959698591079379,<br>      "fused_score": 0.6685310438999987<br>    },<br>    {<br>      "id": 62130,<br>      "name": "公共厕所",<br>      "category": "公共厕所",<br>      "categoryMain": "公共设施",<br>      "categorySub": "公共厕所",<br>      "regionLabel": 0,<br>      "lon": 114.3349569996659,<br>      "lat": 30.57715699979576,<br>      "distance_m": 86.27324338,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276810119351176,<br>      "spatial_score": 0.4957786735408535,<br>      "fused_score": 0.6683678895058708<br>    },<br>    {<br>      "id": 332240,<br>      "name": "温水煮青蛙实验室",<br>      "category": "科教文化场所",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科教文化场所",<br>      "regionLabel": 4,<br>      "lon": 114.33336099981034,<br>      "lat": 30.57729499986442,<br>      "distance_m": 86.80206667,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276686218253024,<br>      "spatial_score": 0.4926879820321104,<br>      "fused_score": 0.6668779147245703<br>    },<br>    {<br>      "id": 472012,<br>      "name": "快乐童裤",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 4,<br>      "lon": 114.33351499971752,<br>      "lat": 30.5774620003711,<br>      "distance_m": 87.67202531,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8277310833724375,<br>      "spatial_score": 0.48760353542688306,<br>      "fused_score": 0.6644698603585714<br>    },<br>    {<br>      "id": 321064,<br>      "name": "湖北大学资源环境学院",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 4,<br>      "lon": 114.33343899981003,<br>      "lat": 30.577411999863955,<br>      "distance_m": 88.82680206,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8277112561738847,<br>      "spatial_score": 0.4808544781080971,<br>      "fused_score": 0.6612200027023067<br>    },<br>    {<br>      "id": 142823,<br>      "name": "湖北大学教工宿舍三区1",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 4,<br>      "lon": 114.33348700022498,<br>      "lat": 30.57627499959159,<br>      "distance_m": 89.71988352,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8273309018831206,<br>      "spatial_score": 0.475634890890148,<br>      "fused_score": 0.6585168166064937<br>    },<br>    {<br>      "id": 337293,<br>      "name": "艺术美术",<br>      "category": "培训机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "培训机构",<br>      "regionLabel": 4,<br>      "lon": 114.33328900008735,<br>      "lat": 30.577277999979742,<br>      "distance_m": 91.73459561,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276601454403981,<br>      "spatial_score": 0.46385996783574723,<br>      "fused_score": 0.6530360601901657<br>    },<br>    {<br>      "id": 334494,<br>      "name": "湖北遥感考古工作站",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 4,<br>      "lon": 114.33328900008735,<br>      "lat": 30.577277999979742,<br>      "distance_m": 91.73459561,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276601454403981,<br>      "spatial_score": 0.46385996783574723,<br>      "fused_score": 0.6530360601901657<br>    },<br>    {<br>      "id": 332165,<br>      "name": "农业农村部遥感应用中心武汉分中心",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 4,<br>      "lon": 114.33328900008735,<br>      "lat": 30.577277999979742,<br>      "distance_m": 91.73459561,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276601454403981,<br>      "spatial_score": 0.46385996783574723,<br>      "fused_score": 0.6530360601901657<br>    },<br>    {<br>      "id": 323121,<br>      "name": "武汉市环保型肥料工程技术研究中心",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 4,<br>      "lon": 114.33328900008735,<br>      "lat": 30.577277999979742,<br>      "distance_m": 91.73459561,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276601437855493,<br>      "spatial_score": 0.46385996783574723,<br>      "fused_score": 0.6530360593296443<br>    },<br>    {<br>      "id": 219042,<br>      "name": "全国信息化工程师GIS应用水平考试认定考试中心",<br>      "category": "公检法机构",<br>      "categoryMain": "政府机构及社会团体",<br>      "categorySub": "公检法机构",<br>      "regionLabel": 4,<br>      "lon": 114.33328900008735,<br>      "lat": 30.577277999979742,<br>      "distance_m": 91.73459561,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8276601437855493,<br>      "spatial_score": 0.46385996783574723,<br>      "fused_score": 0.6530360593296443<br>    },<br>    {<br>      "id": 174283,<br>      "name": "保集安三区8号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33367199976306,<br>      "lat": 30.576137000422307,<br>      "distance_m": 91.9701572,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8272925200467228,<br>      "spatial_score": 0.462483235343502,<br>      "fused_score": 0.6521840633891769<br>    },<br>    {<br>      "id": 142826,<br>      "name": "湖北大学教工宿舍三区5",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.3337790002007,<br>      "lat": 30.576065999846094,<br>      "distance_m": 94.97873914,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.827273300794585,<br>      "spatial_score": 0.4448996704151954,<br>      "fused_score": 0.643733958212478<br>    },<br>    {<br>      "id": 166039,<br>      "name": "保安四区13号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33501100035744,<br>      "lat": 30.576453999752346,<br>      "distance_m": 97.03256076,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274493422189314,<br>      "spatial_score": 0.4328961729115077,<br>      "fused_score": 0.638063820951368<br>    },<br>    {<br>      "id": 333715,<br>      "name": "海文考研(湖北大学教学中心)",<br>      "category": "培训机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "培训机构",<br>      "regionLabel": 0,<br>      "lon": 114.33356300013236,<br>      "lat": 30.576106999938133,<br>      "distance_m": 100.1003446,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8272783006158615,<br>      "spatial_score": 0.41496660429332677,<br>      "fused_score": 0.6293686863810448<br>    },<br>    {<br>      "id": 174175,<br>      "name": "保集安三区13号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33408099973838,<br>      "lat": 30.575962000445998,<br>      "distance_m": 100.73594587,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8272510523801675,<br>      "spatial_score": 0.4112518521534667,<br>      "fused_score": 0.6275714362713511<br>    },<br>    {<br>      "id": 142832,<br>      "name": "湖北大学教工宿舍三区7",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33451399992123,<br>      "lat": 30.576022999661745,<br>      "distance_m": 101.18506234,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8272882177582286,<br>      "spatial_score": 0.40862700471101454,<br>      "fused_score": 0.6263308354955659<br>    },<br>    {<br>      "id": 143383,<br>      "name": "湖北大学四区4",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33509199959622,<br>      "lat": 30.5764149997525,<br>      "distance_m": 105.92365177,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274395521502373,<br>      "spatial_score": 0.38093246403615,<br>      "fused_score": 0.6131161498554755<br>    },<br>    {<br>      "id": 142818,<br>      "name": "湖北大学教工宿舍四区3",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33524600040266,<br>      "lat": 30.576842999704752,<br>      "distance_m": 107.95535198,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275869836384606,<br>      "spatial_score": 0.36905825443513474,<br>      "fused_score": 0.6074931936208642<br>    },<br>    {<br>      "id": 158420,<br>      "name": "湖北大学(武昌主校区)三区6栋",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33382399957793,<br>      "lat": 30.57587800016961,<br>      "distance_m": 113.60551459,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8272132616088208,<br>      "spatial_score": 0.3360360522515953,<br>      "fused_score": 0.5914482011173525<br>    },<br>    {<br>      "id": 174174,<br>      "name": "保集安三区11号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33374300033927,<br>      "lat": 30.57584300035421,<br>      "distance_m": 119.48971701,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271985282725531,<br>      "spatial_score": 0.30164601157237436,<br>      "fused_score": 0.5749333202564674<br>    },<br>    {<br>      "id": 142814,<br>      "name": "湖北大学教工宿舍四区5",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.335321000264,<br>      "lat": 30.576536999982636,<br>      "distance_m": 120.88336103,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274885542919157,<br>      "spatial_score": 0.29350090181591004,<br>      "fused_score": 0.5711744811034329<br>    },<br>    {<br>      "id": 174629,<br>      "name": "湖北大学教工宿舍四区6",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33515399975738,<br>      "lat": 30.57619400035287,<br>      "distance_m": 124.23803485,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8273693584871729,<br>      "spatial_score": 0.2738946135034632,<br>      "fused_score": 0.5617014808949923<br>    },<br>    {<br>      "id": 340897,<br>      "name": "九峰山实验室",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 4,<br>      "lon": 114.3328270003658,<br>      "lat": 30.576801999612655,<br>      "distance_m": 124.35352427,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274816009723066,<br>      "spatial_score": 0.2732196391282923,<br>      "fused_score": 0.5614358592871798<br>    },<br>    {<br>      "id": 331080,<br>      "name": "湖北大学非物质文化遗产研究中心",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 4,<br>      "lon": 114.33279799992783,<br>      "lat": 30.576859000442596,<br>      "distance_m": 126.91244711,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274997186118158,<br>      "spatial_score": 0.25826409302683984,<br>      "fused_score": 0.5542666183310273<br>    },<br>    {<br>      "id": 471911,<br>      "name": "霸王醉超市",<br>      "category": "超级市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "超级市场",<br>      "regionLabel": 4,<br>      "lon": 114.33279399974333,<br>      "lat": 30.57692699998114,<br>      "distance_m": 127.44701088,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.827522557469585,<br>      "spatial_score": 0.2551398514586959,<br>      "fused_score": 0.5527788585843583<br>    },<br>    {<br>      "id": 174274,<br>      "name": "保集安三区20号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33423100036043,<br>      "lat": 30.57570500028561,<br>      "distance_m": 129.58476015,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271730254635868,<br>      "spatial_score": 0.2426458413771605,<br>      "fused_score": 0.5465999771021022<br>    },<br>    {<br>      "id": 317358,<br>      "name": "湖北大学武昌校区艺术学院",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 4,<br>      "lon": 114.33276300011244,<br>      "lat": 30.576897000396286,<br>      "distance_m": 130.2982499,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275112375580688,<br>      "spatial_score": 0.2384758724034033,<br>      "fused_score": 0.5447742622838294<br>    },<br>    {<br>      "id": 56756,<br>      "name": "红鲱鱼剧本社",<br>      "category": "娱乐场所",<br>      "categoryMain": "体育休闲服务",<br>      "categorySub": "娱乐场所",<br>      "regionLabel": 0,<br>      "lon": 114.3337220002702,<br>      "lat": 30.575729999639805,<br>      "distance_m": 132.05121092,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271606370706693,<br>      "spatial_score": 0.22823074545433952,<br>      "fused_score": 0.5396742890948311<br>    },<br>    {<br>      "id": 132748,<br>      "name": "湖北大学武昌校区四区",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 0,<br>      "lon": 114.33533800014868,<br>      "lat": 30.57630900026021,<br>      "distance_m": 132.27270747,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274142125814241,<br>      "spatial_score": 0.22693621565724809,<br>      "fused_score": 0.5391847740578196<br>    },<br>    {<br>      "id": 147085,<br>      "name": "宝积侧路与宝积路交叉口",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 0,<br>      "lon": 114.33487000015043,<br>      "lat": 30.57787899981605,<br>      "distance_m": 132.94561193,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8279217067198444,<br>      "spatial_score": 0.2230034461668624,<br>      "fused_score": 0.537560941654413<br>    },<br>    {<br>      "id": 576255,<br>      "name": "遇见芝士焗饭",<br>      "category": "小吃快餐",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "小吃快餐",<br>      "regionLabel": 5,<br>      "lon": 114.332979,<br>      "lat": 30.575792,<br>      "distance_m": 162.1191913,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9796045165012086,<br>      "spatial_score": 0.052499355776855494,<br>      "fused_score": 0.5345940393535191<br>    },<br>    {<br>      "id": 174281,<br>      "name": "保集安三区19号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33408199978453,<br>      "lat": 30.575653999732367,<br>      "distance_m": 134.86038184,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271503434846846,<br>      "spatial_score": 0.211812632120012,<br>      "fused_score": 0.5317882420296418<br>    },<br>    {<br>      "id": 142833,<br>      "name": "湖北大学教工宿舍三区9",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33463500010521,<br>      "lat": 30.57571900003188,<br>      "distance_m": 136.796747,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271937774657678,<br>      "spatial_score": 0.20049560529648092,<br>      "fused_score": 0.5263786548245101<br>    },<br>    {<br>      "id": 158508,<br>      "name": "保集安3区21号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33408499992288,<br>      "lat": 30.575616999824717,<br>      "distance_m": 138.95329127,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271384505341428,<br>      "spatial_score": 0.18789174841355605,<br>      "fused_score": 0.5203000335162612<br>    },<br>    {<br>      "id": 494561,<br>      "name": "才教育图书专营店",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 4,<br>      "lon": 114.33344600013288,<br>      "lat": 30.577981000023158,<br>      "distance_m": 139.14965209,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8279063171016504,<br>      "spatial_score": 0.18674412361998127,<br>      "fused_score": 0.5201484642304492<br>    },<br>    {<br>      "id": 142819,<br>      "name": "湖北大学教工宿舍四区8",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.3350979998728,<br>      "lat": 30.575936000146328,<br>      "distance_m": 139.65891261,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8272828658308492,<br>      "spatial_score": 0.18376776612085888,<br>      "fused_score": 0.5183956179700538<br>    },<br>    {<br>      "id": 142597,<br>      "name": "南一路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 0,<br>      "lon": 114.33559000007847,<br>      "lat": 30.5768009995665,<br>      "distance_m": 141.11896221,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8275859619773056,<br>      "spatial_score": 0.17523455098756968,<br>      "fused_score": 0.5144572847022324<br>    },<br>    {<br>      "id": 142830,<br>      "name": "湖北大学教工宿舍三区6",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33356800036302,<br>      "lat": 30.575689999593862,<br>      "distance_m": 141.16328524,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271413286238574,<br>      "spatial_score": 0.1749755063973386,<br>      "fused_score": 0.5141017339551284<br>    },<br>    {<br>      "id": 146912,<br>      "name": "宝积路与西二路交叉口",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 4,<br>      "lon": 114.33292600043467,<br>      "lat": 30.576122999776658,<br>      "distance_m": 141.41405102,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8272582470945808,<br>      "spatial_score": 0.17350991348268208,<br>      "fused_score": 0.5134590469608694<br>    },<br>    {<br>      "id": 576250,<br>      "name": "文饱饱蛋肉堡",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.332735,<br>      "lat": 30.5759,<br>      "distance_m": 170.99671869,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9793455374571411,<br>      "spatial_score": 0.0006149190628315093,<br>      "fused_score": 0.5095548406278726<br>    },<br>    {<br>      "id": 174279,<br>      "name": "保集安三区18号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33391600022333,<br>      "lat": 30.575588000286018,<br>      "distance_m": 143.47925397,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271220832733965,<br>      "spatial_score": 0.16143989814467352,<br>      "fused_score": 0.5075946344116095<br>    },<br>    {<br>      "id": 146913,<br>      "name": "南一路与西二路交叉口",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 0,<br>      "lon": 114.33338399997172,<br>      "lat": 30.5757430002393,<br>      "distance_m": 143.55604047,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271512313604802,<br>      "spatial_score": 0.16099112179910802,<br>      "fused_score": 0.5073943787710216<br>    },<br>    {<br>      "id": 13590,<br>      "name": "湖北大学停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 4,<br>      "lon": 114.33262600008993,<br>      "lat": 30.576583000305277,<br>      "distance_m": 146.89286234,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8274000843143031,<br>      "spatial_score": 0.14148916866123262,<br>      "fused_score": 0.4981628448008293<br>    },<br>    {<br>      "id": 576246,<br>      "name": "儒小孟麻辣烫店",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.333121,<br>      "lat": 30.575614,<br>      "distance_m": 169.08578003,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9237295451725597,<br>      "spatial_score": 0.011783341486493737,<br>      "fused_score": 0.48599536740324806<br>    },<br>    {<br>      "id": 142662,<br>      "name": "西二路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 0,<br>      "lon": 114.33347599971762,<br>      "lat": 30.575624000147513,<br>      "distance_m": 151.35753048,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.827115951772532,<br>      "spatial_score": 0.11539555256944933,<br>      "fused_score": 0.48549016015505236<br>    },<br>    {<br>      "id": 111801,<br>      "name": "普通人药房(湖大分店)",<br>      "category": "医药保健销售店",<br>      "categoryMain": "医疗保健服务",<br>      "categorySub": "医药保健销售店",<br>      "regionLabel": 4,<br>      "lon": 114.33301299995003,<br>      "lat": 30.575895000054288,<br>      "distance_m": 151.59086938,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271862543980993,<br>      "spatial_score": 0.1140318105207786,<br>      "fused_score": 0.4848721213369854<br>    },<br>    {<br>      "id": 174277,<br>      "name": "保集安三区17号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33374599957824,<br>      "lat": 30.5755240000326,<br>      "distance_m": 153.49501317,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8270943537809248,<br>      "spatial_score": 0.10290310050655282,<br>      "fused_score": 0.47948255220922625<br>    },<br>    {<br>      "id": 321317,<br>      "name": "绅宝驾校(湖大店)",<br>      "category": "科教文化场所",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科教文化场所",<br>      "regionLabel": 0,<br>      "lon": 114.3343199999681,<br>      "lat": 30.57548900021726,<br>      "distance_m": 154.28612448,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271063829525812,<br>      "spatial_score": 0.09827947470465659,<br>      "fused_score": 0.4772694669935774<br>    },<br>    {<br>      "id": 13597,<br>      "name": "湖北大学武昌校区停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 4,<br>      "lon": 114.33320599985711,<br>      "lat": 30.5780260002997,<br>      "distance_m": 155.33065974,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8279133353010223,<br>      "spatial_score": 0.09217472039501817,<br>      "fused_score": 0.4747588001461403<br>    },<br>    {<br>      "id": 201539,<br>      "name": "湖大教职工公寓3区10号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33472199962068,<br>      "lat": 30.57556199998635,<br>      "distance_m": 156.04747162,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271463165609985,<br>      "spatial_score": 0.08798533533430686,<br>      "fused_score": 0.47234904557218654<br>    },<br>    {<br>      "id": 121482,<br>      "name": "湖北大学-教工宿舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 0,<br>      "lon": 114.33414499999185,<br>      "lat": 30.575455999594737,<br>      "distance_m": 156.77611858,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.827088530992811,<br>      "spatial_score": 0.08372678051130833,<br>      "fused_score": 0.4702748907616897<br>    },<br>    {<br>      "id": 174272,<br>      "name": "保集安三区27号楼",<br>      "category": "门牌信息",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "门牌信息",<br>      "regionLabel": 0,<br>      "lon": 114.33467400010511,<br>      "lat": 30.575538999825028,<br>      "distance_m": 156.80284408,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.8271369219007306,<br>      "spatial_score": 0.08357058414575702,<br>      "fused_score": 0.4702250797783433<br>    }<br>  ]<br>} | {<br>  "kind": "boundary",<br>  "has_boundary": true,<br>  "hotspot_count": 3,<br>  "vernacular_regions": 3,<br>  "fuzzy_regions": 1<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 28141 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"support_gap_analysis","user_goal":"分析湖北大学附近的配套现状、热门业态和明显缺口，并要求结论基于空间证据。","anchors":[{"place_name":"湖北大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"湖北大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1800,"filter":{},"limit":80},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_macro_cell_analysis","tool":"spatial_core.macro_cell_analysis","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":2800,"focus":"support_gap_analysis"},"expect_output":["support_buckets","support_bucket_metrics","population_metrics","uncertainty"],"condition":null},{"step_id":"s4_build_boundary","tool":"spatial_core.build_boundary","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","pois":"$ref:s2_search_primary_nearby_pois.pois"},"expect_output":["boundary","spatial_clusters"],"condition":null}],"stop_conditions":{"max_rounds":1,"max_queries":4,"min_evidence_items":6},"answer_frame":{"style":"gap","must_ground_in_evidence":true,"required_sections":["supporting_facilities","hot_categories","gaps"],"forbidden_claims":["不能凭猜测声称某处缺少某类业态"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "support_gap_analysis",
  "user_goal": "分析湖北大学附近的配套现状、热门业态和明显缺口，并要求结论基于空间证据。",
  "anchors": [
    {
      "place_name": "湖北大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "湖北大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_macro_cell_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "support_gap_analysis"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s4_build_boundary",
      "tool": "spatial_core.build_boundary",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "pois": "$ref:s2_search_primary_nearby_pois.pois"
      },
      "expect_output": [
        "boundary",
        "spatial_clusters"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "gap",
    "must_ground_in_evidence": true,
    "required_sections": [
      "supporting_facilities",
      "hot_categories",
      "gaps"
    ],
    "forbidden_claims": [
      "不能凭猜测声称某处缺少某类业态"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "support_gap_analysis",
  "user_goal": "分析湖北大学附近的配套现状、热门业态和明显缺口，并要求结论基于空间证据。",
  "anchors": [
    {
      "place_name": "湖北大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "湖北大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_macro_cell_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "support_gap_analysis"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s4_build_boundary",
      "tool": "spatial_core.build_boundary",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "pois": "$ref:s2_search_primary_nearby_pois.pois"
      },
      "expect_output": [
        "boundary",
        "spatial_clusters"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "gap",
    "must_ground_in_evidence": true,
    "required_sections": [
      "supporting_facilities",
      "hot_categories",
      "gaps"
    ],
    "forbidden_claims": [
      "不能凭猜测声称某处缺少某类业态"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "请分析湖北大学附近的配套、热门业态和明显缺口。",
  "anchors": [
    {
      "place_name": "湖北大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "gap",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "湖北大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    {
      "type": "category_bucket",
      "value": "业态分布"
    }
  ],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "summary",
  "ranking_objective": "completeness",
  "completeness": "top_k",
  "answer_mode": "area_portrait",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "bucket"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "town_encoder",
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": true,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 3,
    "allow_local_shop_as_region_representative": false,
    "prefer_public_civic_examples": true
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "analytical"
  },
  "needs_clarification": false,
  "missing_inputs": []
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 59986 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "gap",
  "task_type": "gap",
  "search_filters": [
    {
      "category": "",
      "subcategory": "",
      "target_region": null
    }
  ],
  "focus_terms": [
    "业态分布"
  ],
  "transport_modalities": [],
  "dominant_buckets": [
    "生活服务",
    "餐饮配套",
    "零售购物"
  ],
  "scene_tags": [
    "居住社区",
    "餐饮活跃",
    "高密度活动"
  ],
  "cell_mix": [
    "居住类"
  ],
  "target_entities": [
    "业态分布"
  ],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "area_portrait",
  "evidence_requirements": {
    "macro_required": true,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "请分析湖北大学附近的配套、热门业态和明显缺口。",
  "anchor": "湖北大学",
  "style": "gap",
  "task_type": "gap",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "area_portrait",
  "focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    "业态分布"
  ],
  "transport_modalities": [],
  "core_axes": [
    "生活服务",
    "餐饮配套",
    "零售购物"
  ],
  "scene_tags": [
    "居住社区",
    "餐饮活跃",
    "高密度活动"
  ],
  "spatial_mix": [
    "居住类"
  ],
  "representative_examples": [
    "奥雅网球培训中心(湖北大学店)",
    "全国信息化工程师GIS应用水平考试认定考试中心",
    "红鲱鱼剧本社"
  ],
  "result_count": 80,
  "nearest_distance": null,
  "hotspot_count": 3,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先说当前较突出的配套，再谨慎表达可能缺口，不要把证据不足写成确定短板。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
湖北大学附近生活服务配套较为完善，尤其在餐饮和休闲娱乐方面有明显活跃点，如红鲱鱼剧本社、奥雅网球培训中心等，满足学生群体的日常社交与兴趣需求。餐饮配套覆盖多样，存在多个小型餐饮和特色体验空间，能支撑校园周边的高频消费场景。

可能偏弱的是专业零售购物业态，目前缺乏大型综合性零售或品牌集合店，日常购物选择相对有限，部分学生对品质化、品牌化商品的需求尚未被充分满足。但该情况尚需更多实地观察验证，目前尚无明确证据表明存在系统性缺口。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
湖北大学附近生活服务配套较为完善，尤其在餐饮和休闲娱乐方面有明显活跃点，如红鲱鱼剧本社、奥雅网球培训中心等，满足学生群体的日常社交与兴趣需求。餐饮配套覆盖多样，存在多个小型餐饮和特色体验空间，能支撑校园周边的高频消费场景。
可能偏弱的是专业零售购物业态，目前缺乏大型综合性零售或品牌集合店，日常购物选择相对有限，部分学生对品质化、品牌化商品的需求尚未被充分满足。但该情况尚需更多实地观察验证，目前尚无明确证据表明存在系统性缺口。
```

</details>
## Q8. 请概览武汉大学附近的空间结构和业态分布。
| 字段 | 值 |
|---|---|
| 问题 | 请概览武汉大学附近的空间结构和业态分布。 |
| 开始时间（ISO） | 2026-03-31T12:41:08.241Z |
| 开始时间（上海） | 2026-03-31 20:41:08 |
| 结束时间（ISO） | 2026-03-31T12:42:03.725Z |
| 结束时间（上海） | 2026-03-31 20:42:03 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 55484 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 4 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 25915 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 1009 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 2 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 28559 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 357 | null | {<br>  "place_name": "武汉大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316319,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  }<br>} |
| s2_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 630 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316319,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1800,<br>  "filter": {},<br>  "limit": 80<br>} | {<br>  "kind": "pois",<br>  "total_count": 80,<br>  "top_names": [<br>    "武汉大学",<br>    "武汉市第二十中学(岳飞街校区)",<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学"<br>  ]<br>} |
| s3_macro_cell_analysis | spatial_core.macro_cell_analysis | ok | 7 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316319,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 2800,<br>  "focus": "area_overview"<br>} | {<br>  "kind": "macro",<br>  "support_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套",<br>    "休闲娱乐",<br>    "交通出行"<br>  ],<br>  "dominant_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套"<br>  ],<br>  "scene_tags": [<br>    "运动休闲",<br>    "教育氛围",<br>    "教育片区",<br>    "居住社区",<br>    "混合业态"<br>  ],<br>  "cell_mix": [<br>    "居住类",<br>    "公共类"<br>  ]<br>} |
| s4_build_boundary | spatial_core.build_boundary | ok | 14 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316319,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "pois": [<br>    {<br>      "id": 316319,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 341744,<br>      "name": "武汉市第二十中学(岳飞街校区)",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316315,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316317,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316313,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 340634,<br>      "name": "临空港市民阅读中心",<br>      "category": "科教文化场所",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科教文化场所",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 317386,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 316278,<br>      "name": "武汉大学",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36433900024474,<br>      "lat": 30.53633400041383,<br>      "distance_m": 0,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478122642694338,<br>      "spatial_score": 1,<br>      "fused_score": 0.9728623774201055<br>    },<br>    {<br>      "id": 121506,<br>      "name": "武汉大学梅园6舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36420100017608,<br>      "lat": 30.536203999814802,<br>      "distance_m": 19.57250885,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478717343620574,<br>      "spatial_score": 0.9108263525659128,<br>      "fused_score": 0.930089951099908<br>    },<br>    {<br>      "id": 399475,<br>      "name": "波司登(光谷天地F区店)",<br>      "category": "服装鞋帽皮具店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "服装鞋帽皮具店",<br>      "regionLabel": 5,<br>      "lon": 114.36456199973657,<br>      "lat": 30.536165999861055,<br>      "distance_m": 28.36958283,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478519762184804,<br>      "spatial_score": 0.870746300511467,<br>      "fused_score": 0.9108412518791139<br>    },<br>    {<br>      "id": 121507,<br>      "name": "武汉大学梅园2舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36409199964612,<br>      "lat": 30.53650700029789,<br>      "distance_m": 30.4904129,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477725485782073,<br>      "spatial_score": 0.8610836581604435,<br>      "fused_score": 0.9061618811776806<br>    },<br>    {<br>      "id": 130485,<br>      "name": "武汉大学教职工宿舍8栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36429600006045,<br>      "lat": 30.535846000392667,<br>      "distance_m": 54.25756887,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479906494605369,<br>      "spatial_score": 0.7527989204590865,<br>      "fused_score": 0.8542986195398407<br>    },<br>    {<br>      "id": 315969,<br>      "name": "武汉大学通讯服务中心",<br>      "category": "生活服务场所",<br>      "categoryMain": "生活服务",<br>      "categorySub": "生活服务场所",<br>      "regionLabel": 5,<br>      "lon": 114.36424300031422,<br>      "lat": 30.53580800043892,<br>      "distance_m": 59.03638323,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480090199347888,<br>      "spatial_score": 0.7310263255323204,<br>      "fused_score": 0.843857326621604<br>    },<br>    {<br>      "id": 255374,<br>      "name": "武汉大学通讯服务中心",<br>      "category": "生活服务场所",<br>      "categoryMain": "生活服务",<br>      "categorySub": "生活服务场所",<br>      "regionLabel": 5,<br>      "lon": 114.36424300031422,<br>      "lat": 30.53580800043892,<br>      "distance_m": 59.03638323,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480090199347888,<br>      "spatial_score": 0.7310263255323204,<br>      "fused_score": 0.843857326621604<br>    },<br>    {<br>      "id": 575214,<br>      "name": "梅园",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364754,<br>      "lat": 30.535846,<br>      "distance_m": 67.17794903,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9806029713966625,<br>      "spatial_score": 0.6939328121879327,<br>      "fused_score": 0.8430012949764722<br>    },<br>    {<br>      "id": 319572,<br>      "name": "武汉大学-新闻中心",<br>      "category": "传媒机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "传媒机构",<br>      "regionLabel": 5,<br>      "lon": 114.36391499957767,<br>      "lat": 30.536726999651364,<br>      "distance_m": 59.61341414,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477088395035973,<br>      "spatial_score": 0.7283973344652448,<br>      "fused_score": 0.842439317085188<br>    },<br>    {<br>      "id": 125681,<br>      "name": "武汉大学教职工宿舍7栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.3640860002688,<br>      "lat": 30.535841000162065,<br>      "distance_m": 59.8046887,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480118537292653,<br>      "spatial_score": 0.7275258748936962,<br>      "fused_score": 0.8421785838881921<br>    },<br>    {<br>      "id": 121474,<br>      "name": "武汉大学梅园一舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36390099983134,<br>      "lat": 30.53680000031983,<br>      "distance_m": 66.60016431,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947683442124094,<br>      "spatial_score": 0.6965652376633251,<br>      "fused_score": 0.827146703982925<br>    },<br>    {<br>      "id": 121504,<br>      "name": "武汉大学梅园4舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36503499996536,<br>      "lat": 30.536321999860434,<br>      "distance_m": 66.80363206,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477522350373051,<br>      "spatial_score": 0.695638225110067,<br>      "fused_score": 0.8267375102722307<br>    },<br>    {<br>      "id": 575217,<br>      "name": "梅园教工食堂",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364813,<br>      "lat": 30.535793,<br>      "distance_m": 75.27399066,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9805866645761809,<br>      "spatial_score": 0.6570467099790526,<br>      "fused_score": 0.8252874863695594<br>    },<br>    {<br>      "id": 555536,<br>      "name": "锦绣龙城B区(东2门)",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.36484700028893,<br>      "lat": 30.53588600043861,<br>      "distance_m": 69.59321194,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479253739828162,<br>      "spatial_score": 0.6829287143051532,<br>      "fused_score": 0.820726977337538<br>    },<br>    {<br>      "id": 348461,<br>      "name": "中国移动(复地东湖国际营业厅)",<br>      "category": "家电电子卖场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家电电子卖场",<br>      "regionLabel": 5,<br>      "lon": 114.36483000040425,<br>      "lat": 30.535849999677794,<br>      "distance_m": 71.40863574,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479396986956147,<br>      "spatial_score": 0.6746575231601994,<br>      "fused_score": 0.8167642544386153<br>    },<br>    {<br>      "id": 142622,<br>      "name": "梅园一路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.36508200033416,<br>      "lat": 30.536475999767617,<br>      "distance_m": 73.01780187,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947692395210897,<br>      "spatial_score": 0.667326055628918,<br>      "fused_score": 0.8131165522115471<br>    },<br>    {<br>      "id": 547315,<br>      "name": "湖北剑维建设工程有限公司(东北门)",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.36480900033519,<br>      "lat": 30.535800000070026,<br>      "distance_m": 74.42390719,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479593623765863,<br>      "spatial_score": 0.6609197466052859,<br>      "fused_score": 0.8101803468063621<br>    },<br>    {<br>      "id": 557608,<br>      "name": "交通银行24小时自助银行(新华路)",<br>      "category": "自动提款机",<br>      "categoryMain": "金融保险服务",<br>      "categorySub": "自动提款机",<br>      "regionLabel": 5,<br>      "lon": 114.36479799982794,<br>      "lat": 30.535763000162376,<br>      "distance_m": 77.11870535,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479734554667175,<br>      "spatial_score": 0.6486420675980866,<br>      "fused_score": 0.8042943892897747<br>    },<br>    {<br>      "id": 306531,<br>      "name": "怪兽充电(Costa Coffee武大梅园店)",<br>      "category": "共享设备",<br>      "categoryMain": "生活服务",<br>      "categorySub": "共享设备",<br>      "regionLabel": 5,<br>      "lon": 114.36486999955093,<br>      "lat": 30.535774999816454,<br>      "distance_m": 80.23127072,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479625368111171,<br>      "spatial_score": 0.6344610134957696,<br>      "fused_score": 0.7974818056197502<br>    },<br>    {<br>      "id": 575213,<br>      "name": "KFC",<br>      "category": "小吃快餐",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "小吃快餐",<br>      "regionLabel": 5,<br>      "lon": 114.364763,<br>      "lat": 30.535624,<br>      "distance_m": 88.60639279,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9807819672103916,<br>      "spatial_score": 0.5963034023069708,<br>      "fused_score": 0.7962322560567496<br>    },<br>    {<br>      "id": 508526,<br>      "name": "杨明装饰",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36474199994336,<br>      "lat": 30.53568099997824,<br>      "distance_m": 82.07505506,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480075923782665,<br>      "spatial_score": 0.6260606098510599,<br>      "fused_score": 0.7934730407652073<br>    },<br>    {<br>      "id": 130830,<br>      "name": "武汉大学梅园3舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.3648519996201,<br>      "lat": 30.536936000296237,<br>      "distance_m": 82.93088592,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475462414802299,<br>      "spatial_score": 0.6221613877350944,<br>      "fused_score": 0.791361511682565<br>    },<br>    {<br>      "id": 142433,<br>      "name": "珞珈路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.36344899967162,<br>      "lat": 30.536326000044937,<br>      "distance_m": 85.41193563,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478971206885493,<br>      "spatial_score": 0.610857560831678,<br>      "fused_score": 0.786118131957251<br>    },<br>    {<br>      "id": 377895,<br>      "name": "凤凰自行车(南湖专卖店)",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36455600035924,<br>      "lat": 30.535586000093872,<br>      "distance_m": 85.4991749,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480583325512817,<br>      "spatial_score": 0.6104600929360184,<br>      "fused_score": 0.7860111775359553<br>    },<br>    {<br>      "id": 508366,<br>      "name": "帕尔特防静电地板",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36462399989773,<br>      "lat": 30.535593000416668,<br>      "distance_m": 86.58151016,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480495432726691,<br>      "spatial_score": 0.605528901762705,<br>      "fused_score": 0.7836396353478863<br>    },<br>    {<br>      "id": 321044,<br>      "name": "武汉大学梅园",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36458699999014,<br>      "lat": 30.535581999909425,<br>      "distance_m": 86.69832936,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480568548652811,<br>      "spatial_score": 0.6049966657456379,<br>      "fused_score": 0.7833879640878524<br>    },<br>    {<br>      "id": 575215,<br>      "name": "氧气层",<br>      "category": "其他",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "其他",<br>      "regionLabel": 5,<br>      "lon": 114.364767,<br>      "lat": 30.535563,<br>      "distance_m": 94.83034692,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809442390911913,<br>      "spatial_score": 0.5679466548154732,<br>      "fused_score": 0.7827053986388466<br>    },<br>    {<br>      "id": 575222,<br>      "name": "武汉大学梅园食堂",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364631,<br>      "lat": 30.535516,<br>      "distance_m": 94.91535324,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809505129153445,<br>      "spatial_score": 0.5675593603879963,<br>      "fused_score": 0.7825227597022173<br>    },<br>    {<br>      "id": 13570,<br>      "name": "武汉大学停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.3652530001259,<br>      "lat": 30.53617300018385,<br>      "distance_m": 89.50810199,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477854600365055,<br>      "spatial_score": 0.5921951554335061,<br>      "fused_score": 0.7771021138270658<br>    },<br>    {<br>      "id": 551503,<br>      "name": "东北门",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.3646490001513,<br>      "lat": 30.5355609998403,<br>      "distance_m": 90.71269919,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480584699513362,<br>      "spatial_score": 0.5867069307589832,<br>      "fused_score": 0.7746097311390068<br>    },<br>    {<br>      "id": 575218,<br>      "name": "周麻婆",<br>      "category": "中国菜",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "中国菜",<br>      "regionLabel": 5,<br>      "lon": 114.364639,<br>      "lat": 30.535478,<br>      "distance_m": 99.16828089,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809709257379583,<br>      "spatial_score": 0.5481827401636665,<br>      "fused_score": 0.7732325966622983<br>    },<br>    {<br>      "id": 575216,<br>      "name": "排档江湖",<br>      "category": "其他",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "其他",<br>      "regionLabel": 5,<br>      "lon": 114.364659,<br>      "lat": 30.53548,<br>      "distance_m": 99.53143689,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809703230955633,<br>      "spatial_score": 0.5465281773605146,<br>      "fused_score": 0.7724380931427399<br>    },<br>    {<br>      "id": 575221,<br>      "name": "呷哺呷哺",<br>      "category": "小吃快餐",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "小吃快餐",<br>      "regionLabel": 5,<br>      "lon": 114.364583,<br>      "lat": 30.535458,<br>      "distance_m": 99.89764784,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9809214412520377,<br>      "spatial_score": 0.5448596960027043,<br>      "fused_score": 0.7716118035323576<br>    },<br>    {<br>      "id": 121505,<br>      "name": "武汉大学梅园5舍",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.3652980004025,<br>      "lat": 30.53644300004447,<br>      "distance_m": 92.81864653,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9476843229648843,<br>      "spatial_score": 0.5771120951121512,<br>      "fused_score": 0.7698096535955724<br>    },<br>    {<br>      "id": 181923,<br>      "name": "梅园二路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.3650790001958,<br>      "lat": 30.535754999793483,<br>      "distance_m": 95.72386929,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479501732868654,<br>      "spatial_score": 0.563875707682048,<br>      "fused_score": 0.763594429796553<br>    },<br>    {<br>      "id": 130245,<br>      "name": "武汉大学教职工宿舍6栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36418200019921,<br>      "lat": 30.53545700044026,<br>      "distance_m": 98.38598196,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481383496464966,<br>      "spatial_score": 0.5517469459334284,<br>      "fused_score": 0.7578704758642238<br>    },<br>    {<br>      "id": 125682,<br>      "name": "武汉大学教职工宿舍5栋",<br>      "category": "住宅区",<br>      "categoryMain": "商务住宅",<br>      "categorySub": "住宅区",<br>      "regionLabel": 5,<br>      "lon": 114.36404200003835,<br>      "lat": 30.535481999794513,<br>      "distance_m": 98.66049928,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481425759276564,<br>      "spatial_score": 0.5504962268306379,<br>      "fused_score": 0.7572723283610876<br>    },<br>    {<br>      "id": 552458,<br>      "name": "欧亚达建材家居生活广场(3号门)",<br>      "category": "临街院门",<br>      "categoryMain": "通行设施",<br>      "categorySub": "临街院门",<br>      "regionLabel": 5,<br>      "lon": 114.36462700003608,<br>      "lat": 30.53546299981764,<br>      "distance_m": 100.43780717,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480948765140416,<br>      "spatial_score": 0.5423986942976697,<br>      "fused_score": 0.753360709050183<br>    },<br>    {<br>      "id": 499474,<br>      "name": "莲荷园艺",<br>      "category": "花鸟鱼虫市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "花鸟鱼虫市场",<br>      "regionLabel": 5,<br>      "lon": 114.36477200042759,<br>      "lat": 30.535478999656164,<br>      "distance_m": 103.49448099,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480757762552215,<br>      "spatial_score": 0.5284722858012095,<br>      "fused_score": 0.7466661008372958<br>    },<br>    {<br>      "id": 258225,<br>      "name": "来电(氧气层武大梅园店)",<br>      "category": "共享设备",<br>      "categoryMain": "生活服务",<br>      "categorySub": "共享设备",<br>      "regionLabel": 5,<br>      "lon": 114.36477200042759,<br>      "lat": 30.535478999656164,<br>      "distance_m": 103.49448099,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480757762552215,<br>      "spatial_score": 0.5284722858012095,<br>      "fused_score": 0.7466661008372958<br>    },<br>    {<br>      "id": 488420,<br>      "name": "瑶瑶精品窗帘",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36513800021862,<br>      "lat": 30.535705000185658,<br>      "distance_m": 103.64157415,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479623151600859,<br>      "spatial_score": 0.5278021196160603,<br>      "fused_score": 0.7462854212989536<br>    },<br>    {<br>      "id": 497564,<br>      "name": "银田",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.3643400002909,<br>      "lat": 30.537270000410217,<br>      "distance_m": 103.76644387,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9474701462525431,<br>      "spatial_score": 0.5272332048963474,<br>      "fused_score": 0.7457564144015691<br>    },<br>    {<br>      "id": 495391,<br>      "name": "巨星建材",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.3643400002909,<br>      "lat": 30.537270000410217,<br>      "distance_m": 103.76644387,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9474701462525431,<br>      "spatial_score": 0.5272332048963474,<br>      "fused_score": 0.7457564144015691<br>    },<br>    {<br>      "id": 14105,<br>      "name": "武汉大学文理图书馆地下停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.36329999999509,<br>      "lat": 30.535992999976997,<br>      "distance_m": 106.63214398,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480303598207411,<br>      "spatial_score": 0.5141768852788977,<br>      "fused_score": 0.7397806920406563<br>    },<br>    {<br>      "id": 6034,<br>      "name": "武汉大学文理图书馆地下停车场(出入口)",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.36329999999509,<br>      "lat": 30.535992999976997,<br>      "distance_m": 106.63214398,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480303598207411,<br>      "spatial_score": 0.5141768852788977,<br>      "fused_score": 0.7397806920406563<br>    },<br>    {<br>      "id": 470359,<br>      "name": "听渔轩国际渔具钓具(双凤大道店)",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36339099969496,<br>      "lat": 30.535822000185192,<br>      "distance_m": 107.22868344,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480828459270034,<br>      "spatial_score": 0.5114590119651472,<br>      "fused_score": 0.7385034056253125<br>    },<br>    {<br>      "id": 563419,<br>      "name": "湖北恒超川商业投资管理有限公司",<br>      "category": "金融保险服务机构",<br>      "categoryMain": "金融保险服务",<br>      "categorySub": "金融保险服务机构",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 503531,<br>      "name": "滴盾国标防水",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 498558,<br>      "name": "开心米奇",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 498246,<br>      "name": "黄陂土猪肉",<br>      "category": "综合市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "综合市场",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 498147,<br>      "name": "正华装饰材料配送中心",<br>      "category": "家居建材市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "家居建材市场",<br>      "regionLabel": 5,<br>      "lon": 114.36460599996701,<br>      "lat": 30.53537900044057,<br>      "distance_m": 108.92906226,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481262162004629,<br>      "spatial_score": 0.5037119733733588,<br>      "fused_score": 0.734807379643453<br>    },<br>    {<br>      "id": 251835,<br>      "name": "怪兽充电(呷哺呷哺武大梅园店)",<br>      "category": "共享设备",<br>      "categoryMain": "生活服务",<br>      "categorySub": "共享设备",<br>      "regionLabel": 5,<br>      "lon": 114.36466499998983,<br>      "lat": 30.53537999958735,<br>      "distance_m": 110.2918613,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481203645081545,<br>      "spatial_score": 0.4975029706314097,<br>      "fused_score": 0.731824015447317<br>    },<br>    {<br>      "id": 349041,<br>      "name": "中华润滑油(大众汽修)",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36456599992107,<br>      "lat": 30.535300000394727,<br>      "distance_m": 116.68228244,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481575033592741,<br>      "spatial_score": 0.4683877884102149,<br>      "fused_score": 0.7178680401837256<br>    },<br>    {<br>      "id": 321162,<br>      "name": "武汉大学后勤服务集团人力资源部",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36522100044886,<br>      "lat": 30.535610000301347,<br>      "distance_m": 116.64554486,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947988025333783,<br>      "spatial_score": 0.4685551672593756,<br>      "fused_score": 0.7178602534580675<br>    },<br>    {<br>      "id": 575219,<br>      "name": "luckin coffee",<br>      "category": "咖啡",<br>      "categoryMain": "餐饮美食",<br>      "categorySub": "咖啡",<br>      "regionLabel": 5,<br>      "lon": 114.364448,<br>      "lat": 30.535222,<br>      "distance_m": 123.72102308,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9719909052348479,<br>      "spatial_score": 0.4363188195814518,<br>      "fused_score": 0.7148683041212178<br>    },<br>    {<br>      "id": 470024,<br>      "name": "欣欣园艺吴震(将军路店)",<br>      "category": "花鸟鱼虫市场",<br>      "categoryMain": "购物服务",<br>      "categorySub": "花鸟鱼虫市场",<br>      "regionLabel": 5,<br>      "lon": 114.36311100027251,<br>      "lat": 30.536253000275792,<br>      "distance_m": 118.18453053,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9479545047225368,<br>      "spatial_score": 0.46154344655486856,<br>      "fused_score": 0.714477196802056<br>    },<br>    {<br>      "id": 499164,<br>      "name": "天能电池",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 3,<br>      "lon": 114.36451500026715,<br>      "lat": 30.535250999933737,<br>      "distance_m": 121.24521732,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481793019600209,<br>      "spatial_score": 0.44759875470113997,<br>      "fused_score": 0.7079006392757581<br>    },<br>    {<br>      "id": 202799,<br>      "name": "珞珈山路",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.36391999980822,<br>      "lat": 30.53529900034863,<br>      "distance_m": 121.58291404,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9482179157920291,<br>      "spatial_score": 0.4460601860649107,<br>      "fused_score": 0.7071822055230123<br>    },<br>    {<br>      "id": 323066,<br>      "name": "湖北省高校后勤管理研究会(梅园二路)",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 5,<br>      "lon": 114.36552700017103,<br>      "lat": 30.535925000438453,<br>      "distance_m": 122.69052992,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478483232168745,<br>      "spatial_score": 0.4410138147114745,<br>      "fused_score": 0.7045677591342825<br>    },<br>    {<br>      "id": 321181,<br>      "name": "武汉大学后勤服务集团",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36557599973264,<br>      "lat": 30.535924000392356,<br>      "distance_m": 127.11128752,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9478441276149588,<br>      "spatial_score": 0.4208725501124826,<br>      "fused_score": 0.6948977704137702<br>    },<br>    {<br>      "id": 319451,<br>      "name": "武汉大学万林艺术博物馆",<br>      "category": "博物馆",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "博物馆",<br>      "regionLabel": 5,<br>      "lon": 114.36307300031876,<br>      "lat": 30.536759000227732,<br>      "distance_m": 130.30559911,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9477743309792173,<br>      "spatial_score": 0.4063190548143426,<br>      "fused_score": 0.6878757984200774<br>    },<br>    {<br>      "id": 62597,<br>      "name": "珞珈山人防隧道",<br>      "category": "紧急避难场所",<br>      "categoryMain": "公共设施",<br>      "categorySub": "紧急避难场所",<br>      "regionLabel": 5,<br>      "lon": 114.36560700026291,<br>      "lat": 30.536771999927907,<br>      "distance_m": 131.01183692,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475365175108927,<br>      "spatial_score": 0.40310138854803956,<br>      "fused_score": 0.6862076556087232<br>    },<br>    {<br>      "id": 321149,<br>      "name": "武汉大学-教1楼",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36542800010216,<br>      "lat": 30.537198999834004,<br>      "distance_m": 141.83391565,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9473965254453948,<br>      "spatial_score": 0.3537952806510465,<br>      "fused_score": 0.6624679279441076<br>    },<br>    {<br>      "id": 321139,<br>      "name": "武汉大学文理学部教1楼",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 5,<br>      "lon": 114.36537999968732,<br>      "lat": 30.537298999948916,<br>      "distance_m": 146.37093502,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9473639671679487,<br>      "spatial_score": 0.3331243197230097,<br>      "fused_score": 0.652528936394378<br>    },<br>    {<br>      "id": 472011,<br>      "name": "AVDCADO",<br>      "category": "专卖店",<br>      "categoryMain": "购物服务",<br>      "categorySub": "专卖店",<br>      "regionLabel": 5,<br>      "lon": 114.36543699961794,<br>      "lat": 30.5372739996954,<br>      "distance_m": 148.19545149,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9473679806405765,<br>      "spatial_score": 0.3248117017709444,<br>      "fused_score": 0.6485409667831531<br>    },<br>    {<br>      "id": 255379,<br>      "name": "武汉大学邮政室",<br>      "category": "邮局",<br>      "categoryMain": "生活服务",<br>      "categorySub": "邮局",<br>      "regionLabel": 5,<br>      "lon": 114.36590399957004,<br>      "lat": 30.536490000413266,<br>      "distance_m": 151.17476334,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9476112090931302,<br>      "spatial_score": 0.31123775953675314,<br>      "fused_score": 0.6421519533060692<br>    },<br>    {<br>      "id": 320976,<br>      "name": "武汉大学珞珈文库",<br>      "category": "图书馆",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "图书馆",<br>      "regionLabel": 5,<br>      "lon": 114.36289500020416,<br>      "lat": 30.535781000093152,<br>      "distance_m": 151.52717923,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9481431322830333,<br>      "spatial_score": 0.30963212938653195,<br>      "fused_score": 0.6416578508927127<br>    },<br>    {<br>      "id": 321148,<br>      "name": "武汉大学国际法研究所",<br>      "category": "科研机构",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "科研机构",<br>      "regionLabel": 5,<br>      "lon": 114.3659780002846,<br>      "lat": 30.536516999859714,<br>      "distance_m": 158.58661004,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475945899185375,<br>      "spatial_score": 0.2774688947720654,<br>      "fused_score": 0.6259342562482308<br>    },<br>    {<br>      "id": 317492,<br>      "name": "武汉大学文理图书馆",<br>      "category": "图书馆",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "图书馆",<br>      "regionLabel": 5,<br>      "lon": 114.36271199985902,<br>      "lat": 30.535956000069405,<br>      "distance_m": 161.65842955,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9480976726305621,<br>      "spatial_score": 0.2634734815082268,<br>      "fused_score": 0.6194780608918412<br>    },<br>    {<br>      "id": 266296,<br>      "name": "DHL",<br>      "category": "物流速递",<br>      "categoryMain": "生活服务",<br>      "categorySub": "物流速递",<br>      "regionLabel": 5,<br>      "lon": 114.36605999956942,<br>      "lat": 30.536623000251325,<br>      "distance_m": 168.23142367,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.947548669856744,<br>      "spatial_score": 0.23352648469063642,<br>      "fused_score": 0.6048180209770124<br>    },<br>    {<br>      "id": 13586,<br>      "name": "武汉大学停车场",<br>      "category": "停车场",<br>      "categoryMain": "交通设施服务",<br>      "categorySub": "停车场",<br>      "regionLabel": 5,<br>      "lon": 114.3661439998458,<br>      "lat": 30.53633100027548,<br>      "distance_m": 173.21390831,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9476461058144693,<br>      "spatial_score": 0.21082595447051022,<br>      "fused_score": 0.593972433169369<br>    },<br>    {<br>      "id": 321072,<br>      "name": "武汉大学文理学部",<br>      "category": "学校",<br>      "categoryMain": "科教文化服务",<br>      "categorySub": "学校",<br>      "regionLabel": 3,<br>      "lon": 114.3629229996967,<br>      "lat": 30.5353419996336,<br>      "distance_m": 174.81156255,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9482952606942311,<br>      "spatial_score": 0.2035469358729871,<br>      "fused_score": 0.590816064780034<br>    },<br>    {<br>      "id": 142678,<br>      "name": "自强大道",<br>      "category": "交通地名",<br>      "categoryMain": "地名地址信息",<br>      "categorySub": "交通地名",<br>      "regionLabel": 5,<br>      "lon": 114.3629350002501,<br>      "lat": 30.537353999787285,<br>      "distance_m": 175.89603278,<br>      "semantic_entity_concepts": [],<br>      "semantic_entity_match_source": null,<br>      "semantic_entity_match_score": 0,<br>      "semantic_score": 0.9475671574306603,<br>      "spatial_score": 0.1986060176348643,<br>      "fused_score": 0.5880658103286782<br>    }<br>  ]<br>} | {<br>  "kind": "boundary",<br>  "has_boundary": true,<br>  "hotspot_count": 2,<br>  "vernacular_regions": 2,<br>  "fuzzy_regions": 1<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 25915 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"area_overview","user_goal":"概览武汉大学附近的空间结构、代表性业态和热点分布。","anchors":[{"place_name":"武汉大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"武汉大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1800,"filter":{},"limit":80},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s3_macro_cell_analysis","tool":"spatial_core.macro_cell_analysis","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":2800,"focus":"area_overview"},"expect_output":["support_buckets","support_bucket_metrics","population_metrics","uncertainty"],"condition":null},{"step_id":"s4_build_boundary","tool":"spatial_core.build_boundary","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","pois":"$ref:s2_search_primary_nearby_pois.pois"},"expect_output":["boundary","spatial_clusters"],"condition":null}],"stop_conditions":{"max_rounds":1,"max_queries":4,"min_evidence_items":6},"answer_frame":{"style":"overview","must_ground_in_evidence":true,"required_sections":["spatial_structure","category_distribution"],"forbidden_claims":["不要将模糊热点边界写成精确行政边界"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "area_overview",
  "user_goal": "概览武汉大学附近的空间结构、代表性业态和热点分布。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_macro_cell_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "area_overview"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s4_build_boundary",
      "tool": "spatial_core.build_boundary",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "pois": "$ref:s2_search_primary_nearby_pois.pois"
      },
      "expect_output": [
        "boundary",
        "spatial_clusters"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "overview",
    "must_ground_in_evidence": true,
    "required_sections": [
      "spatial_structure",
      "category_distribution"
    ],
    "forbidden_claims": [
      "不要将模糊热点边界写成精确行政边界"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "area_overview",
  "user_goal": "概览武汉大学附近的空间结构、代表性业态和热点分布。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s3_macro_cell_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "area_overview"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s4_build_boundary",
      "tool": "spatial_core.build_boundary",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "pois": "$ref:s2_search_primary_nearby_pois.pois"
      },
      "expect_output": [
        "boundary",
        "spatial_clusters"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "overview",
    "must_ground_in_evidence": true,
    "required_sections": [
      "spatial_structure",
      "category_distribution"
    ],
    "forbidden_claims": [
      "不要将模糊热点边界写成精确行政边界"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "请概览武汉大学附近的空间结构和业态分布。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "overview",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "武汉大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [
    "空间结构",
    "业态分布"
  ],
  "target_entities": [
    {
      "type": "region_feature",
      "value": "空间结构"
    },
    {
      "type": "category_bucket",
      "value": "业态分布"
    }
  ],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "summary",
  "ranking_objective": "representativeness",
  "completeness": "top_k",
  "answer_mode": "area_portrait",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "bucket"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "town_encoder",
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": true,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 3,
    "allow_local_shop_as_region_representative": false,
    "prefer_public_civic_examples": true
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "analytical"
  },
  "needs_clarification": false,
  "missing_inputs": []
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 28559 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "overview",
  "task_type": "overview",
  "search_filters": [
    {
      "category": "",
      "subcategory": "",
      "target_region": null
    }
  ],
  "focus_terms": [
    "空间结构",
    "业态分布"
  ],
  "transport_modalities": [],
  "dominant_buckets": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "运动休闲",
    "教育氛围",
    "教育片区"
  ],
  "cell_mix": [
    "居住类",
    "公共类"
  ],
  "target_entities": [
    "空间结构",
    "业态分布"
  ],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "area_portrait",
  "evidence_requirements": {
    "macro_required": true,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "请概览武汉大学附近的空间结构和业态分布。",
  "anchor": "武汉大学",
  "style": "overview",
  "task_type": "overview",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "area_portrait",
  "focus_terms": [
    "空间结构",
    "业态分布"
  ],
  "target_entities": [
    "空间结构",
    "业态分布"
  ],
  "transport_modalities": [],
  "core_axes": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "运动休闲",
    "教育氛围",
    "教育片区"
  ],
  "spatial_mix": [
    "居住类",
    "公共类"
  ],
  "representative_examples": [
    "武汉大学-新闻中心",
    "武汉大学邮政室",
    "武汉大学梅园"
  ],
  "result_count": 80,
  "nearest_distance": null,
  "hotspot_count": 2,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先概括区域主轴，再补代表点，不要把局部门店写成区域主轴。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
武汉大学周边空间结构以教育服务为核心，沿主干道呈带状分布，覆盖教学、办公与生活功能。主导业态集中于教育服务、生活服务和餐饮配套，形成“教学-生活-休闲”联动格局。区域内公共空间与居住类功能适度融合，体现浓厚的教育氛围与片区协同性。代表点位包括武汉大学-新闻中心（信息枢纽）、武汉大学邮政室（行政服务）和武汉大学梅园（文化景观节点）。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
武汉大学周边空间结构以教育服务为核心，沿主干道呈带状分布，覆盖教学、办公与生活功能。主导业态集中于教育服务、生活服务和餐饮配套，形成“教学-生活-休闲”联动格局。区域内公共空间与居住类功能适度融合，体现浓厚的教育氛围与片区协同性。代表点位包括武汉大学-新闻中心（信息枢纽）、武汉大学邮政室（行政服务）和武汉大学梅园（文化景观节点）。
```

</details>
## Q9. 武汉大学附近适合布局什么业态？
| 字段 | 值 |
|---|---|
| 问题 | 武汉大学附近适合布局什么业态？ |
| 开始时间（ISO） | 2026-03-31T12:42:03.726Z |
| 开始时间（上海） | 2026-03-31 20:42:03 |
| 结束时间（ISO） | 2026-03-31T12:42:55.419Z |
| 结束时间（上海） | 2026-03-31 20:42:55 |
| 最终状态 | ok_llm |
| 总耗时(ms) | 51694 |
| planner是否成功 | true |
| answer source | llm_synthesis |
| 执行步骤数 | 4 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 28300 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 1486 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 1 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 21908 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_anchor | spatial_core.resolve_anchor | ok | 360 | null | {<br>  "place_name": "武汉大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316313,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  }<br>} |
| s2_macro_analysis | spatial_core.macro_cell_analysis | ok | 6 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316313,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1500,<br>  "focus": "site_suitability"<br>} | {<br>  "kind": "macro",<br>  "support_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套",<br>    "休闲娱乐",<br>    "交通出行"<br>  ],<br>  "dominant_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套"<br>  ],<br>  "scene_tags": [<br>    "教育氛围",<br>    "运动休闲",<br>    "居住社区",<br>    "教育片区",<br>    "混合业态"<br>  ],<br>  "cell_mix": [<br>    "居住类",<br>    "公共类"<br>  ]<br>} |
| s3_search_nearby_pois | spatial_core.search_nearby_pois | ok | 592 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316313,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1000,<br>  "filter": {},<br>  "limit": 50<br>} | {<br>  "kind": "pois",<br>  "total_count": 50,<br>  "top_names": [<br>    "武汉大学",<br>    "临空港市民阅读中心",<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学"<br>  ]<br>} |
| s4_vector_search | spatial_core.vector_search | ok | 527 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 316313,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "limit": 20<br>} | {<br>  "kind": "pois",<br>  "total_count": 20,<br>  "top_names": [<br>    "武汉大学",<br>    "武汉市第二十中学(岳飞街校区)",<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学"<br>  ]<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 28299 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"site_suitability","user_goal":"分析武汉大学周边业态分布与缺口，推荐适合布局的商业类型。","anchors":[{"place_name":"武汉大学","role":"primary"}],"steps":[{"step_id":"s1_resolve_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"武汉大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_macro_analysis","tool":"spatial_core.macro_cell_analysis","input":{"anchor":"$ref:s1_resolve_anchor.anchor","radius_m":1500,"focus":"site_suitability"},"expect_output":["support_buckets","support_bucket_metrics","population_metrics","uncertainty"],"condition":null},{"step_id":"s3_search_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_anchor.anchor","radius_m":1000,"filter":{},"limit":50},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s4_vector_search","tool":"spatial_core.vector_search","input":{"anchor":"$ref:s1_resolve_anchor.anchor","limit":20},"expect_output":["pois","total_count"],"condition":null}],"stop_conditions":{"max_rounds":1,"max_queries":4,"min_evidence_items":6},"answer_frame":{"style":"gap","must_ground_in_evidence":true,"required_sections":["current_landscape","gaps","recommendations"],"forbidden_claims":["不要凭空推荐没有证据支撑的业态"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "site_suitability",
  "user_goal": "分析武汉大学周边业态分布与缺口，推荐适合布局的商业类型。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_macro_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_anchor.anchor",
        "radius_m": 1500,
        "focus": "site_suitability"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s3_search_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_anchor.anchor",
        "radius_m": 1000,
        "filter": {},
        "limit": 50
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s4_vector_search",
      "tool": "spatial_core.vector_search",
      "input": {
        "anchor": "$ref:s1_resolve_anchor.anchor",
        "limit": 20
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "gap",
    "must_ground_in_evidence": true,
    "required_sections": [
      "current_landscape",
      "gaps",
      "recommendations"
    ],
    "forbidden_claims": [
      "不要凭空推荐没有证据支撑的业态"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "site_suitability",
  "user_goal": "分析武汉大学周边业态分布与缺口，推荐适合布局的商业类型。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_macro_analysis",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_anchor.anchor",
        "radius_m": 1500,
        "focus": "site_suitability"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s3_search_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_anchor.anchor",
        "radius_m": 1000,
        "filter": {},
        "limit": 50
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s4_vector_search",
      "tool": "spatial_core.vector_search",
      "input": {
        "anchor": "$ref:s1_resolve_anchor.anchor",
        "limit": 20
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 4,
    "min_evidence_items": 6
  },
  "answer_frame": {
    "style": "gap",
    "must_ground_in_evidence": true,
    "required_sections": [
      "current_landscape",
      "gaps",
      "recommendations"
    ],
    "forbidden_claims": [
      "不要凭空推荐没有证据支撑的业态"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "武汉大学附近适合布局什么业态？",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "suitability",
  "spatial_scope": {
    "mode": "anchor_radius",
    "anchor_refs": [
      {
        "place_name": "武汉大学",
        "role": "primary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    {
      "type": "category_bucket",
      "value": "业态分布"
    }
  ],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "summary",
  "ranking_objective": "semantic_relevance",
  "completeness": "top_k",
  "answer_mode": "recommendation",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "bucket"
  },
  "spatial_relation": {
    "relation": "nearby",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "town_encoder",
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": true,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 3,
    "allow_local_shop_as_region_representative": false,
    "prefer_public_civic_examples": true
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "analytical"
  },
  "needs_clarification": false,
  "missing_inputs": []
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 21907 |  |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "gap",
  "task_type": "suitability",
  "search_filters": [
    {
      "category": "",
      "subcategory": "",
      "target_region": null
    }
  ],
  "focus_terms": [
    "业态分布"
  ],
  "transport_modalities": [],
  "dominant_buckets": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "教育氛围",
    "运动休闲",
    "居住社区"
  ],
  "cell_mix": [
    "居住类",
    "公共类"
  ],
  "target_entities": [
    "业态分布"
  ],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "recommendation",
  "evidence_requirements": {
    "macro_required": true,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "武汉大学附近适合布局什么业态？",
  "anchor": "武汉大学",
  "style": "gap",
  "task_type": "suitability",
  "spatial_scope_mode": "anchor_radius",
  "aggregation_mode": "summary",
  "answer_mode": "recommendation",
  "focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    "业态分布"
  ],
  "transport_modalities": [],
  "core_axes": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "教育氛围",
    "运动休闲",
    "居住社区"
  ],
  "spatial_mix": [
    "居住类",
    "公共类"
  ],
  "representative_examples": [
    "武汉大学-新闻中心",
    "武汉大学梅园"
  ],
  "result_count": 70,
  "nearest_distance": null,
  "hotspot_count": 0,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先说当前较突出的配套，再谨慎表达可能缺口，不要把证据不足写成确定短板。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text
武汉大学附近教育服务和餐饮配套较为完善，尤其在校园周边有成熟的学术交流与师生日常消费场景。运动休闲类业态如校园内运动场地和健身设施分布较广，满足学生日常锻炼需求。生活服务方面，基础便民设施覆盖较充分。目前尚缺乏明确证据显示高端商业或复合型社区服务的集中布局，可能存在进一步优化空间。
```

</details>
<details>
<summary>最终回答文本</summary>

```text
武汉大学附近教育服务和餐饮配套较为完善，尤其在校园周边有成熟的学术交流与师生日常消费场景。运动休闲类业态如校园内运动场地和健身设施分布较广，满足学生日常锻炼需求。生活服务方面，基础便民设施覆盖较充分。目前尚缺乏明确证据显示高端商业或复合型社区服务的集中布局，可能存在进一步优化空间。
```

</details>
## Q10. 比较武汉大学和湖北大学附近的业态差异。
| 字段 | 值 |
|---|---|
| 问题 | 比较武汉大学和湖北大学附近的业态差异。 |
| 开始时间（ISO） | 2026-03-31T12:42:55.419Z |
| 开始时间（上海） | 2026-03-31 20:42:55 |
| 结束时间（ISO） | 2026-03-31T12:45:04.230Z |
| 结束时间（上海） | 2026-03-31 20:45:04 |
| 最终状态 | ok_fallback |
| 总耗时(ms) | 128811 |
| planner是否成功 | true |
| answer source | fallback_summary |
| 执行步骤数 | 6 |
### 阶段耗时
| 阶段 | 耗时(ms) | 说明 |
|---|---:|---|
| planner_llm | 33902 | planner 模型产出 plan |
| intent_spec | 0 | 按 query + anchors 组装 intent_spec |
| execution_total | 1879 | 执行 plan steps + 汇总 evidence_bundle |
| evidence_bundle | 4 | evidence_profile / representative_pois / support_buckets 汇总 |
| synthesis_brief | 0 | 压缩为短摘要 brief |
| answer_synthesis | 93029 | answer_synthesis 阶段；当前已合并文本输出与润色 |
### 执行环节
| step_id | tool | status | duration_ms | condition | input 摘要 | output 摘要 |
|---|---|---|---:|---|---|---|
| s1_resolve_primary_anchor | spatial_core.resolve_anchor | ok | 374 | null | {<br>  "place_name": "武汉大学",<br>  "role": "primary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 317386,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  }<br>} |
| s2_resolve_secondary_anchor | spatial_core.resolve_anchor | ok | 313 | null | {<br>  "place_name": "湖北大学",<br>  "role": "secondary"<br>} | {<br>  "kind": "anchor",<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "secondary",<br>    "index": 1,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  }<br>} |
| s3_search_primary_nearby_pois | spatial_core.search_nearby_pois | ok | 620 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 317386,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 1800,<br>  "filter": {},<br>  "limit": 80<br>} | {<br>  "kind": "pois",<br>  "total_count": 80,<br>  "top_names": [<br>    "武汉市第二十中学(岳飞街校区)",<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学",<br>    "武汉大学"<br>  ]<br>} |
| s4_search_secondary_nearby_pois | spatial_core.search_nearby_pois | ok | 554 | null | {<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "secondary",<br>    "index": 1,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  },<br>  "radius_m": 1800,<br>  "filter": {},<br>  "limit": 80<br>} | {<br>  "kind": "pois",<br>  "total_count": 80,<br>  "top_names": [<br>    "湖北大学(武昌校区)",<br>    "湖北大学武昌校区",<br>    "字慧书苑",<br>    "湖北大学资源与环境学院",<br>    "中通快递"<br>  ]<br>} |
| s5_macro_primary | spatial_core.macro_cell_analysis | ok | 7 | null | {<br>  "anchor": {<br>    "place_name": "武汉大学",<br>    "display_name": "武汉大学",<br>    "role": "primary",<br>    "index": 0,<br>    "source": "quick_search",<br>    "resolved_place_name": "武汉大学",<br>    "poi_id": 317386,<br>    "lon": 114.36433900024474,<br>    "lat": 30.53633400041383<br>  },<br>  "radius_m": 2800,<br>  "focus": "region_comparison"<br>} | {<br>  "kind": "macro",<br>  "support_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套",<br>    "休闲娱乐",<br>    "交通出行"<br>  ],<br>  "dominant_buckets": [<br>    "教育服务",<br>    "生活服务",<br>    "餐饮配套"<br>  ],<br>  "scene_tags": [<br>    "运动休闲",<br>    "教育片区",<br>    "教育氛围",<br>    "居住社区",<br>    "混合业态"<br>  ],<br>  "cell_mix": [<br>    "居住类",<br>    "公共类"<br>  ]<br>} |
| s6_macro_secondary | spatial_core.macro_cell_analysis | ok | 7 | null | {<br>  "anchor": {<br>    "place_name": "湖北大学",<br>    "display_name": "湖北大学",<br>    "role": "secondary",<br>    "index": 1,<br>    "source": "quick_search",<br>    "resolved_place_name": "湖北大学(武昌校区)",<br>    "poi_id": 316320,<br>    "lon": 114.33412099978432,<br>    "lat": 30.57687000005052<br>  },<br>  "radius_m": 2800,<br>  "focus": "region_comparison"<br>} | {<br>  "kind": "macro",<br>  "support_buckets": [<br>    "生活服务",<br>    "餐饮配套",<br>    "零售购物",<br>    "交通出行",<br>    "教育服务"<br>  ],<br>  "dominant_buckets": [<br>    "生活服务",<br>    "餐饮配套",<br>    "零售购物"<br>  ],<br>  "scene_tags": [<br>    "居住社区",<br>    "餐饮活跃",<br>    "高密度活动",<br>    "零售密集",<br>    "运动休闲"<br>  ],<br>  "cell_mix": [<br>    "居住类"<br>  ]<br>} |
### Planner LLM 产物
| attempt | kind | llm_ms | validation_ok | parse_error | validation_errors |
|---|---|---:|---|---|---|
| 0 | initial | 33901 | true |  |  |
<details>
<summary>Planner 最终 attempt 原始文本</summary>

```text
{"task_type_hint":"region_comparison","user_goal":"比较武汉大学和湖北大学周边业态的共性与差异，并基于双锚点同口径证据回答。","anchors":[{"place_name":"武汉大学","role":"primary"},{"place_name":"湖北大学","role":"secondary"}],"steps":[{"step_id":"s1_resolve_primary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"武汉大学","role":"primary"},"expect_output":["anchor"],"condition":null},{"step_id":"s2_resolve_secondary_anchor","tool":"spatial_core.resolve_anchor","input":{"place_name":"湖北大学","role":"secondary"},"expect_output":["anchor"],"condition":null},{"step_id":"s3_search_primary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":1800,"filter":{},"limit":80},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s4_search_secondary_nearby_pois","tool":"spatial_core.search_nearby_pois","input":{"anchor":"$ref:s2_resolve_secondary_anchor.anchor","radius_m":1800,"filter":{},"limit":80},"expect_output":["pois","total_count"],"condition":null},{"step_id":"s5_macro_primary","tool":"spatial_core.macro_cell_analysis","input":{"anchor":"$ref:s1_resolve_primary_anchor.anchor","radius_m":2800,"focus":"region_comparison"},"expect_output":["support_buckets","support_bucket_metrics","population_metrics","uncertainty"],"condition":null},{"step_id":"s6_macro_secondary","tool":"spatial_core.macro_cell_analysis","input":{"anchor":"$ref:s2_resolve_secondary_anchor.anchor","radius_m":2800,"focus":"region_comparison"},"expect_output":["support_buckets","support_bucket_metrics","population_metrics","uncertainty"],"condition":null}],"stop_conditions":{"max_rounds":1,"max_queries":6,"min_evidence_items":8},"answer_frame":{"style":"comparison","must_ground_in_evidence":true,"required_sections":["shared_context","primary_differences"],"forbidden_claims":["不要把两个区域的单点样本差异夸大成绝对结论"]}}
```

</details>
<details>
<summary>Planner 最终 attempt 校验后 raw_json</summary>

```json
{
  "task_type_hint": "region_comparison",
  "user_goal": "比较武汉大学和湖北大学周边业态的共性与差异，并基于双锚点同口径证据回答。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    },
    {
      "place_name": "湖北大学",
      "role": "secondary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_resolve_secondary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "湖北大学",
        "role": "secondary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s3_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s4_search_secondary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s2_resolve_secondary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s5_macro_primary",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "region_comparison"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s6_macro_secondary",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s2_resolve_secondary_anchor.anchor",
        "radius_m": 2800,
        "focus": "region_comparison"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 6,
    "min_evidence_items": 8
  },
  "answer_frame": {
    "style": "comparison",
    "must_ground_in_evidence": true,
    "required_sections": [
      "shared_context",
      "primary_differences"
    ],
    "forbidden_claims": [
      "不要把两个区域的单点样本差异夸大成绝对结论"
    ]
  }
}
```

</details>
<details>
<summary>Planner 最终 plan JSON</summary>

```json
{
  "task_type_hint": "region_comparison",
  "user_goal": "比较武汉大学和湖北大学周边业态的共性与差异，并基于双锚点同口径证据回答。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    },
    {
      "place_name": "湖北大学",
      "role": "secondary"
    }
  ],
  "steps": [
    {
      "step_id": "s1_resolve_primary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "武汉大学",
        "role": "primary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s2_resolve_secondary_anchor",
      "tool": "spatial_core.resolve_anchor",
      "input": {
        "place_name": "湖北大学",
        "role": "secondary"
      },
      "expect_output": [
        "anchor"
      ],
      "condition": null
    },
    {
      "step_id": "s3_search_primary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s4_search_secondary_nearby_pois",
      "tool": "spatial_core.search_nearby_pois",
      "input": {
        "anchor": "$ref:s2_resolve_secondary_anchor.anchor",
        "radius_m": 1800,
        "filter": {},
        "limit": 80
      },
      "expect_output": [
        "pois",
        "total_count"
      ],
      "condition": null
    },
    {
      "step_id": "s5_macro_primary",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s1_resolve_primary_anchor.anchor",
        "radius_m": 2800,
        "focus": "region_comparison"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    },
    {
      "step_id": "s6_macro_secondary",
      "tool": "spatial_core.macro_cell_analysis",
      "input": {
        "anchor": "$ref:s2_resolve_secondary_anchor.anchor",
        "radius_m": 2800,
        "focus": "region_comparison"
      },
      "expect_output": [
        "support_buckets",
        "support_bucket_metrics",
        "population_metrics",
        "uncertainty"
      ],
      "condition": null
    }
  ],
  "stop_conditions": {
    "max_rounds": 1,
    "max_queries": 6,
    "min_evidence_items": 8
  },
  "answer_frame": {
    "style": "comparison",
    "must_ground_in_evidence": true,
    "required_sections": [
      "shared_context",
      "primary_differences"
    ],
    "forbidden_claims": [
      "不要把两个区域的单点样本差异夸大成绝对结论"
    ]
  }
}
```

</details>
### Intent Spec
<details>
<summary>Intent Spec 输入</summary>

```json
{
  "userQuery": "比较武汉大学和湖北大学附近的业态差异。",
  "anchors": [
    {
      "place_name": "武汉大学",
      "role": "primary"
    },
    {
      "place_name": "湖北大学",
      "role": "secondary"
    }
  ]
}
```

</details>
<details>
<summary>Intent Spec 输出</summary>

```json
{
  "task_type": "comparison",
  "spatial_scope": {
    "mode": "dual_anchor",
    "anchor_refs": [
      {
        "place_name": "武汉大学",
        "role": "primary"
      },
      {
        "place_name": "湖北大学",
        "role": "secondary"
      }
    ],
    "geometry_ref": null,
    "radius_m": null
  },
  "semantic_focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    {
      "type": "category_bucket",
      "value": "业态分布"
    }
  ],
  "include_entities": [],
  "exclude_entities": [],
  "aggregation_mode": "comparison",
  "ranking_objective": "representativeness",
  "completeness": "top_k",
  "answer_mode": "contrast",
  "entity_resolution": {
    "merge_station_exits": false,
    "merge_same_poi": true,
    "category_level": "bucket"
  },
  "spatial_relation": {
    "relation": "compare",
    "distance_constraint_m": null,
    "geometry_constraint": null
  },
  "evidence_policy": {
    "must_use_sources": [
      "postgis"
    ],
    "prefer_sources": [
      "town_encoder",
      "poi_encoder"
    ],
    "forbid_sources": [],
    "macro_required": true,
    "micro_required": true
  },
  "representation_policy": {
    "representative_example_count": 3,
    "allow_local_shop_as_region_representative": false,
    "prefer_public_civic_examples": true
  },
  "uncertainty_policy": {
    "allow_estimation": false,
    "require_confidence_note_when_sparse": true
  },
  "output_contract": {
    "must_include": [],
    "must_avoid": [
      "unverified_claims"
    ],
    "tone": "analytical"
  },
  "needs_clarification": false,
  "missing_inputs": []
}
```

</details>
### Evidence / Brief / Answer
| llm_call | duration_ms | error |
|---|---:|---|
| 0 | 93029 | This operation was aborted |
<details>
<summary>Evidence Profile JSON</summary>

```json
{
  "style": "comparison",
  "task_type": "comparison",
  "search_filters": [
    {
      "category": "",
      "subcategory": "",
      "target_region": null
    },
    {
      "category": "",
      "subcategory": "",
      "target_region": null
    }
  ],
  "focus_terms": [
    "业态分布"
  ],
  "transport_modalities": [],
  "dominant_buckets": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "运动休闲",
    "教育片区",
    "教育氛围"
  ],
  "cell_mix": [
    "居住类",
    "公共类"
  ],
  "target_entities": [
    "业态分布"
  ],
  "include_entities": [],
  "exclude_entities": [],
  "spatial_scope_mode": "dual_anchor",
  "aggregation_mode": "comparison",
  "answer_mode": "contrast",
  "evidence_requirements": {
    "macro_required": true,
    "micro_required": true
  }
}
```

</details>
<details>
<summary>Synthesis Brief JSON</summary>

```json
{
  "query": "比较武汉大学和湖北大学附近的业态差异。",
  "anchor": "武汉大学",
  "style": "comparison",
  "task_type": "comparison",
  "spatial_scope_mode": "dual_anchor",
  "aggregation_mode": "comparison",
  "answer_mode": "contrast",
  "focus_terms": [
    "业态分布"
  ],
  "target_entities": [
    "业态分布"
  ],
  "transport_modalities": [],
  "core_axes": [
    "教育服务",
    "生活服务",
    "餐饮配套"
  ],
  "scene_tags": [
    "运动休闲",
    "教育片区",
    "教育氛围"
  ],
  "spatial_mix": [
    "居住类",
    "公共类"
  ],
  "representative_examples": [
    "武汉大学-新闻中心",
    "全国信息化工程师GIS应用水平考试认定考试中心",
    "红鲱鱼剧本社"
  ],
  "result_count": 160,
  "nearest_distance": null,
  "hotspot_count": 0,
  "constraints": [
    "只引用 brief 中明确存在的证据，不要补写未验证事实。",
    "先说共同背景，再说关键差异，证据不足时要保留边界。"
  ],
  "uncertainty": null
}
```

</details>
<details>
<summary>Answer 阶段原始 LLM 文本</summary>

```text

```

</details>
<details>
<summary>最终回答文本</summary>

```text
当前证据里最值得先比较的维度是教育服务、生活服务、餐饮配套，代表性点位包括武汉大学-新闻中心、全国信息化工程师GIS应用水平考试认定考试中心、红鲱鱼剧本社。
```

</details>
