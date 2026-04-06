# V4 GEO Agent 原子 Skills 接口规范

> 这份文档是 [2026-04-01-v4-geo-agent-最新上下文与研究方案.md](D:/AAA_Edu/TagCloud/vite-project/docs/plans/2026-04-01-v4-geo-agent-%E6%9C%80%E6%96%B0%E4%B8%8A%E4%B8%8B%E6%96%87%E4%B8%8E%E7%A0%94%E7%A9%B6%E6%96%B9%E6%A1%88.md) 的落地补充版。
>
> 如果上一份文档回答的是“方向应该往哪走”，这一份回答的就是：
>
> `这个方向具体该怎么落成可调用、可测试、可扩展的技能接口。`
>
> 目标读者：
> 1. 你自己后续开发时查接口用
> 2. 另一个窗口 AI / 新会话接手者快速进入状态
> 3. 未来做 function calling / MCP skill server 时直接照着实现

---

## 1. 先说最重要的结论

V4 不应该再做成：

`用户问题 -> 判定题型 -> 调专用分析工具 -> 回答`

而应该做成：

`用户问题 -> 强模型理解真实目标 -> 调用少量原子 skills -> 返回真实空间证据 -> 再组织输出`

所以这一份接口规范的核心原则只有一句话：

> **工具只提供底层能力，不提供“配套分析 / 比较分析 / 概览分析”这种题型级能力。**

也就是说：

1. `postgis_skill` 提供几何真相
2. `spatial_encoder_skill` 提供空间语义表示
3. `spatial_vector_skill` 提供候选召回
4. `route_distance_skill` 提供现实可达性
5. 大模型自己决定怎么组合它们

---

## 2. 这份文档解决什么问题

它主要解决 5 个问题：

1. 每个 skill 到底负责什么，不负责什么
2. skill 对外暴露哪些接口
3. 请求和响应长什么样
4. 安全边界怎么做，尤其是 SQL
5. 怎么测试这些 skill 是不是真的支撑起了 Agent 架构

---

## 3. 和 V3 现有模块的关系

当前代码库里已经有不少可复用能力，但边界还不够“原子 Agent 化”。

### 3.1 当前可参考模块

1. [toolCatalog.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/spatial_core/toolCatalog.js)
2. [toolSchemas.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/spatial_core/toolSchemas.js)
3. [toolRunner.js](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/spatial_core/toolRunner.js)
4. [planner_line/README.md](D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/planner_line/README.md)
5. `V3-GeoEncoder-RAG/services/retrieval/*`

### 3.2 当前不直接继承的部分

以下能力可以参考实现细节，但不建议原样搬到 V4 主架构里：

1. `macro_cell_analysis`
2. `build_boundary`
3. `comparison_aggregation` 一类思路
4. `intent_spec -> 固定 workflow` 这条主线

原因不是它们“完全没用”，而是它们太像题型流程节点，不适合作为 Agent 的基础原子能力。

### 3.3 推荐的迁移思路

V3 到 V4 更像“拆能力”，不是“整体搬家”：

1. 把 V3 里有价值的几何查询、锚点解析、向量召回、编码器调用逻辑拆出来
2. 重新挂到 `3+1` 原子 skills 下
3. 让强模型通过 function calling 现场编排
4. 慢慢把 V3 那些厚 planner 节点降级为历史兼容层

---

## 4. V4 Skill 总体设计原则

### 4.1 少而硬，不多而花

技能数量应该少，但每个都是真能力。

错误方向：

1. `analyze_amenity_gap`
2. `analyze_campus_business_mix`
3. `compare_university_neighborhood`

正确方向：

1. `postgis_execute_query`
2. `spatial_vector_search`
3. `route_distance_estimate`

### 4.2 模型负责编排，skill 负责出证据

skill 不应该替模型思考“这题到底是不是配套分析题”。

skill 只回答这种问题：

1. 给我合法 schema
2. 给我真实查询结果
3. 给我语义召回候选
4. 给我路网距离

### 4.3 skill 输出必须结构化、可审计

skill 输出不能是“自由发挥的段落文本”。

至少要满足：

1. 有固定字段
2. 有 `meta`
3. 有 `source`
4. 有 `error_code`
5. 有耗时

### 4.4 默认只读，默认可限流，默认可超时

尤其是 `postgis_skill`，必须在设计阶段就把安全边界写死，不能等接入了强模型再补。

---

## 5. V4 运行时总流程

```text
用户自然语言
  -> 强模型读取 system prompt + tool contracts + schema hints
  -> 决定调用某个原子 skill
  -> skill 返回结构化证据
  -> 强模型判断是否需要继续调用下一个 skill
  -> 当证据足够时输出：
     A. evidence-backed 文本回答
     B. 可选结构化视图
```

### 5.1 一个“最近地铁站”问题的理想链路

示例问题：

`湖北大学最近的地铁站，站口也列出来，并告诉我哪个出口最近。`

推荐链路：

1. 模型先解析“湖北大学”是否需要锚点定位
2. 调 `postgis_skill.resolve_anchor`
3. 调 `postgis_skill.execute_spatial_sql`
   - 查附近地铁站
   - 查每个站的出口点位
4. 调 `route_distance_skill.get_route_distance`
   - 对若干候选站口计算真实步行距离
5. 模型基于返回证据整理表格和结论

这里最重要的是：

> “最近”默认应以真实路网步行距离优先，不应偷换成简单球面直线距离。

如果因为外部路网服务不可用而退化成直线距离，最终回答必须显式提示：

`当前最近结果按直线距离估算，不代表真实步行最短路径。`

---

## 6. 通用接口约定

为了让 4 个 skill 行为一致，先定义统一的调用和返回壳。

### 6.1 通用请求壳

```json
{
  "request_id": "uuid",
  "trace_id": "uuid",
  "caller": "geo_agent_main",
  "query_context": {
    "user_query": "湖北大学最近的地铁站，站口也列出来",
    "session_id": "optional",
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai"
  },
  "payload": {}
}
```

### 6.2 通用响应壳

```json
{
  "ok": true,
  "request_id": "uuid",
  "trace_id": "uuid",
  "skill": "postgis_skill",
  "action": "execute_spatial_sql",
  "latency_ms": 182,
  "data": {},
  "meta": {
    "source": "postgis",
    "confidence": 0.98,
    "degraded": false
  },
  "error": null
}
```

### 6.3 统一错误格式

```json
{
  "ok": false,
  "request_id": "uuid",
  "trace_id": "uuid",
  "skill": "postgis_skill",
  "action": "execute_spatial_sql",
  "latency_ms": 23,
  "data": null,
  "meta": {
    "source": "postgis",
    "confidence": 0.0,
    "degraded": false
  },
  "error": {
    "error_code": "SQL_VALIDATION_FAILED",
    "message": "query contains non-whitelisted table",
    "retryable": true,
    "details": {
      "table": "raw_sensitive_table"
    }
  }
}
```

### 6.4 通用错误码建议

建议所有 skill 共享这套大类错误码：

1. `INVALID_ARGUMENT`
2. `NOT_FOUND`
3. `TIMEOUT`
4. `UPSTREAM_UNAVAILABLE`
5. `VALIDATION_FAILED`
6. `SQL_VALIDATION_FAILED`
7. `UNSUPPORTED_ACTION`
8. `RATE_LIMITED`
9. `DEGRADED_RESULT`

---

## 7. 通用数据类型约定

### 7.1 Geometry 表示

统一建议采用：

1. 内部执行层可用 PostGIS geometry
2. skill 返回层统一转成 `GeoJSON geometry`
3. 日志与调试层可附加 `WKT`

建议返回格式：

```json
{
  "geometry": {
    "type": "Point",
    "coordinates": [114.3442, 30.5847]
  },
  "geometry_wkt": "POINT(114.3442 30.5847)"
}
```

### 7.2 Anchor 表示

```json
{
  "anchor_id": "poi:420106:123456",
  "display_name": "湖北大学",
  "resolved_name": "湖北大学(武昌主校区)",
  "geometry": {
    "type": "Point",
    "coordinates": [114.3221, 30.5842]
  },
  "entity_type": "university",
  "source": "postgis_poi",
  "confidence": 0.96
}
```

### 7.3 Evidence Item 表示

所有 skill 最终返回的证据建议都能被压成一个统一的 `evidence_item`：

```json
{
  "evidence_type": "poi|route|aggregation|semantic_candidate|sql_result",
  "title": "湖北大学附近地铁站出口候选",
  "source_skill": "route_distance_skill",
  "payload": {},
  "confidence": 0.94
}
```

这样未来做 `Evidence View` 的时候就不会每个 skill 各说各话。

---

## 8. Skill 1：`postgis_skill`

### 8.1 它的定位

这是 V4 最关键的硬事实 skill。

它负责：

1. 锚点解析
2. schema 提示
3. 精确空间 SQL 查询
4. 基础几何运算
5. 聚合统计

它不负责：

1. 主观分析
2. 题型判断
3. 自由文本总结
4. 模糊语义“像不像”

### 8.2 推荐暴露的 actions

建议不是暴露成“无限制裸 SQL”，而是暴露成下面 4 个动作：

1. `get_schema_catalog`
2. `resolve_anchor`
3. `validate_spatial_sql`
4. `execute_spatial_sql`

必要时再补：

5. `geometry_ops`

### 8.3 `get_schema_catalog`

用途：

给强模型最小可用的数据库认知，不是把全库细节一股脑塞给模型。

请求：

```json
{
  "payload": {
    "domain": "poi|subway|bus|landuse|admin|all",
    "include_examples": true
  }
}
```

响应示例：

```json
{
  "ok": true,
  "data": {
    "tables": [
      {
        "table_name": "poi",
        "description": "基础 POI 表",
        "columns": [
          { "name": "poi_id", "type": "text" },
          { "name": "name", "type": "text" },
          { "name": "category", "type": "text" },
          { "name": "geom", "type": "geometry(Point,4326)" }
        ]
      }
    ],
    "functions": [
      "ST_DWithin",
      "ST_Distance",
      "ST_Intersects",
      "ST_Contains",
      "ST_Buffer"
    ],
    "query_examples": [
      "查询某点 1000 米内的餐饮 POI",
      "查询某高校附近的地铁站"
    ]
  }
}
```

### 8.4 `resolve_anchor`

用途：

把“湖北大学”“武大”“武汉天地”这类自然语言锚点解析成结构化空间实体。

请求：

```json
{
  "payload": {
    "query_text": "湖北大学",
    "anchor_role": "primary",
    "city_hint": "武汉",
    "limit": 5
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "candidates": [
      {
        "anchor_id": "poi:420106:123456",
        "display_name": "湖北大学",
        "resolved_name": "湖北大学(武昌主校区)",
        "entity_type": "university",
        "geometry": {
          "type": "Point",
          "coordinates": [114.3221, 30.5842]
        },
        "confidence": 0.96
      }
    ],
    "selected_anchor": {
      "anchor_id": "poi:420106:123456",
      "display_name": "湖北大学",
      "resolved_name": "湖北大学(武昌主校区)",
      "entity_type": "university",
      "geometry": {
        "type": "Point",
        "coordinates": [114.3221, 30.5842]
      },
      "confidence": 0.96
    }
  }
}
```

### 8.5 `validate_spatial_sql`

用途：

让模型先校验 SQL 是否安全、是否命中白名单、是否缺 LIMIT，而不是直接执行。

请求：

```json
{
  "payload": {
    "sql": "SELECT name FROM poi WHERE category = '餐饮' LIMIT 20",
    "params": {},
    "intent": "nearby_poi_lookup"
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "normalized_sql": "SELECT name FROM poi WHERE category = $1 LIMIT 20",
    "issues": [],
    "execution_hints": {
      "has_limit": true,
      "estimated_complexity": "low"
    }
  }
}
```

### 8.6 `execute_spatial_sql`

用途：

执行已经过约束校验的只读空间 SQL。

请求：

```json
{
  "payload": {
    "sql": "SELECT name, category, ST_AsGeoJSON(geom) AS geometry FROM poi WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(114.3221,30.5842),4326)::geography, 1000) AND category = '地铁站' LIMIT 20",
    "params": {},
    "result_format": "rows",
    "include_explain": false
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "columns": ["name", "category", "geometry"],
    "rows": [
      {
        "name": "徐家棚站",
        "category": "地铁站",
        "geometry": {
          "type": "Point",
          "coordinates": [114.3201, 30.5888]
        }
      }
    ],
    "row_count": 1
  }
}
```

### 8.7 `geometry_ops`

用途：

把部分高频几何操作包成安全动作，减少模型每次都写 SQL。

建议支持：

1. `buffer`
2. `centroid`
3. `within`
4. `intersects`
5. `distance`

这个 action 的作用不是替代 SQL，而是给模型一个更稳的“几何原子积木”。

### 8.8 SQL 安全约束

这一段必须非常清楚，不然强模型一接进来就会有风险。

#### 允许

1. `SELECT`
2. `WITH ... SELECT`
3. 白名单 PostGIS 函数
4. 白名单表 / 视图
5. 参数化占位符

#### 禁止

1. `INSERT`
2. `UPDATE`
3. `DELETE`
4. `ALTER`
5. `DROP`
6. `CREATE`
7. 多语句执行
8. 非白名单函数
9. 访问敏感表

#### 强制约束

1. 默认 `statement_timeout`
2. 默认 `LIMIT`
3. 默认只读连接
4. SQL AST 校验
5. 记录审计日志

#### 强建议

对于强模型生成的 SQL，不要一步执行到底，建议链路固定成：

`get_schema_catalog -> validate_spatial_sql -> execute_spatial_sql`

---

## 9. Skill 2：`spatial_encoder_skill`

### 9.1 它的定位

这是“空间语义理解器”，不是事实数据库。

它负责：

1. 把空间描述编码成 embedding
2. 把区域、锚点、查询映射到空间语义向量
3. 做相似性评分
4. 帮助模型处理“像什么”“适合什么”“空间气质是否相似”这类问题

它不负责：

1. 精确距离结论
2. 最终商业分析结论
3. 直接给用户可读答案

### 9.2 推荐暴露的 actions

1. `encode_query`
2. `encode_region`
3. `score_similarity`
4. `predict_region_affinity`

### 9.3 `encode_query`

请求：

```json
{
  "payload": {
    "text": "适合学生消费、交通便利、夜间也比较活跃的片区",
    "scope_hint": "武汉主城区"
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "embedding_id": "emb:query:abc123",
    "vector_dim": 352,
    "vector_ref": "internal://embedding/emb:query:abc123"
  }
}
```

### 9.4 `encode_region`

请求：

```json
{
  "payload": {
    "region_spec": {
      "type": "anchor_radius",
      "anchor_id": "poi:420106:123456",
      "radius_m": 1500
    }
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "embedding_id": "emb:region:def456",
    "vector_dim": 352,
    "vector_ref": "internal://embedding/emb:region:def456"
  }
}
```

### 9.5 `score_similarity`

请求：

```json
{
  "payload": {
    "query_vector_ref": "internal://embedding/emb:query:abc123",
    "candidate_vector_refs": [
      "internal://embedding/emb:region:def456",
      "internal://embedding/emb:region:ghi789"
    ]
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "scores": [
      { "candidate_id": "emb:region:def456", "score": 0.82 },
      { "candidate_id": "emb:region:ghi789", "score": 0.67 }
    ]
  }
}
```

### 9.6 `predict_region_affinity`

用途：

给“这个区域更像哪种空间气质 / 更适合哪类场景”一个模型辅助判断。

注意：

这个动作输出只能视为语义辅助证据，不能伪装成确定事实。

---

## 10. Skill 3：`spatial_vector_skill`

### 10.1 它的定位

这是召回层，不是结论层。

它负责：

1. 从向量库找候选
2. 缩小范围
3. 给 PostGIS 精查提供候选集
4. 支持模糊空间语义检索

它不负责：

1. 给出最后精确排名
2. 给出最终空间事实
3. 替代路网距离

### 10.2 推荐暴露的 actions

1. `search_semantic_pois`
2. `search_similar_regions`
3. `search_by_embedding`

### 10.3 `search_semantic_pois`

请求：

```json
{
  "payload": {
    "text": "适合学生社交、轻消费、靠近高校的咖啡店",
    "bbox": [114.20, 30.50, 114.45, 30.65],
    "top_k": 20,
    "filters": {
      "category": "咖啡店"
    }
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "candidates": [
      {
        "poi_id": "poi:420106:998877",
        "name": "某某咖啡",
        "score": 0.84,
        "geometry": {
          "type": "Point",
          "coordinates": [114.3233, 30.5830]
        }
      }
    ],
    "top_k": 20
  }
}
```

### 10.4 `search_similar_regions`

用途：

适合“和武大周边气质相似的片区有哪些”。

请求：

```json
{
  "payload": {
    "region_vector_ref": "internal://embedding/emb:region:def456",
    "top_k": 10,
    "exclude_same_admin_area": false
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "regions": [
      {
        "region_id": "cell:420106:7788",
        "score": 0.87,
        "geometry": {
          "type": "Polygon",
          "coordinates": []
        }
      }
    ]
  }
}
```

### 10.5 为什么它必须和 `postgis_skill` 配合

因为向量召回擅长的是：

1. 找“像”的候选
2. 找“可能相关”的候选

但它不擅长：

1. 证明“最近”
2. 证明“在 1km 内”
3. 证明“哪个站口步行最短”

所以它更像粗筛器，不能直接拿来下最终硬结论。

---

## 11. Skill 4：`route_distance_skill`

### 11.1 它的定位

这个 skill 非常关键，因为很多“最近”问题真正关心的是可达性，不是几何直线。

它负责：

1. 步行距离
2. 驾车距离
3. 骑行时间
4. 路网可达性

它不负责：

1. 锚点解析
2. POI 语义召回
3. 区域画像

### 11.2 推荐暴露的 actions

1. `get_route_distance`
2. `get_travel_time`
3. `get_multi_destination_matrix`

### 11.3 `get_route_distance`

请求：

```json
{
  "payload": {
    "origin": {
      "type": "Point",
      "coordinates": [114.3221, 30.5842]
    },
    "destination": {
      "type": "Point",
      "coordinates": [114.3208, 30.5885]
    },
    "mode": "walking"
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "distance_m": 612,
    "duration_min": 9,
    "mode": "walking",
    "route_polyline": null
  }
}
```

### 11.4 `get_multi_destination_matrix`

用途：

对“湖北大学到多个地铁站出口，哪个最近”这类问题特别有用。

请求：

```json
{
  "payload": {
    "origin": {
      "type": "Point",
      "coordinates": [114.3221, 30.5842]
    },
    "destinations": [
      {
        "id": "exit:A",
        "type": "Point",
        "coordinates": [114.3208, 30.5885]
      },
      {
        "id": "exit:B",
        "type": "Point",
        "coordinates": [114.3214, 30.5892]
      }
    ],
    "mode": "walking"
  }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "results": [
      { "id": "exit:A", "distance_m": 612, "duration_min": 9, "rank": 1 },
      { "id": "exit:B", "distance_m": 701, "duration_min": 10, "rank": 2 }
    ]
  }
}
```

### 11.5 降级策略

如果上游导航服务不可用，可以允许降级为球面距离，但必须同时满足：

1. `meta.degraded = true`
2. `meta.degraded_reason = "routing_service_unavailable"`
3. 最终回答显式说明“当前为直线估算”

---

## 12. Function Calling 契约建议

这一部分就是未来喂给强模型的“工具说明书”骨架。

### 12.1 推荐的暴露方式

推荐暴露成“少量函数 + 明确 action schema”，而不是几百个函数名。

推荐选项 A：

1. `postgis_skill`
2. `spatial_encoder_skill`
3. `spatial_vector_skill`
4. `route_distance_skill`

每个 function 内部用 `action` 区分。

示例：

```json
{
  "name": "postgis_skill",
  "description": "只读空间事实技能。用于 schema、锚点解析、合法空间 SQL 校验与执行。",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": [
          "get_schema_catalog",
          "resolve_anchor",
          "validate_spatial_sql",
          "execute_spatial_sql",
          "geometry_ops"
        ]
      },
      "payload": {
        "type": "object"
      }
    },
    "required": ["action", "payload"]
  }
}
```

### 12.2 为什么不建议一开始就暴露太多函数

因为函数太多会带来 3 个问题：

1. 模型选择成本变高
2. 工具语义容易重叠
3. 接口升级难度变高

所以先按 skill 维度暴露，再在 skill 内分 `action`，是比较稳妥的第一版。

### 12.3 推荐 system prompt 里的硬约束

给强模型的主提示词里，建议明确写死：

1. 涉及“最近 / 多近 / 多远 / 多少米 / 多少分钟”时，优先使用 `postgis_skill` 或 `route_distance_skill`
2. 涉及“像什么 / 相似 / 适合 / 气质 / 场景”时，优先使用 `spatial_encoder_skill` 或 `spatial_vector_skill`
3. 不得把向量召回分数伪装成精确距离
4. 不得把编码器语义评分伪装成确定事实
5. 若证据不足，应继续调用工具，而不是脑补

---

## 13. Evidence View 设计建议

虽然当前主线重点是 skills，但最好现在就把“最终如何压结果”想清楚，不然最后又会回到原始 JSON 直喂模型的毛坯状态。

### 13.1 为什么要加 Evidence View

因为 skill 原始返回通常很碎：

1. SQL rows
2. 向量候选
3. 路网距离矩阵
4. 几何对象

这些如果直接扔给模型，最后文本很容易：

1. 漏字段
2. 混事实
3. 结论跳跃

### 13.2 推荐的最小 Evidence View

#### A. `transport_view`

适合“最近地铁站 / 公交站 / 出口比较”。

建议字段：

1. `anchor`
2. `candidate_stations`
3. `candidate_exits`
4. `distance_basis`
5. `ranked_results`
6. `final_pick`

#### B. `poi_list_view`

适合“附近有哪些医院 / 咖啡店 / 公交站”。

建议字段：

1. `anchor`
2. `search_radius_m`
3. `filters`
4. `poi_rows`
5. `count`

#### C. `comparison_view`

适合“武大和湖大哪个更活跃”。

注意：

这个 view 不是 skill，它只是对多个 skill 证据的 deterministic 压缩层。

#### D. `semantic_candidate_view`

适合“像武大周边的片区有哪些”。

建议字段：

1. `query_semantics`
2. `candidate_regions`
3. `semantic_scores`
4. `hard_filters`
5. `confidence_notes`

---

## 14. 输出层约束

用户最终看到的回答，建议分成两层：

### 14.1 第一层：结构化结论

先给一个尽量 deterministic 的结论骨架。

比如“最近地铁站”题：

1. 先列站点候选
2. 再列出口候选
3. 写明距离判定依据
4. 给出最终最近出口

### 14.2 第二层：自然语言组织

在结构化结论确定后，再让模型组织自然语言。

这样能避免：

1. 证据没齐就直接润色
2. 文本好看但事实混乱
3. 类似“说餐饮活跃，举的却是娱乐设施”这种错位

---

## 15. 测试方案

这一份接口文档必须带测试建议，不然又会变成概念文档。

### 15.1 Skill 单元测试

#### `postgis_skill`

至少要测：

1. schema 返回是否稳定
2. anchor 解析是否有候选与置信度
3. 非法 SQL 是否拦截
4. 漏 `LIMIT` 是否拒绝或自动补
5. 超时 SQL 是否中断

#### `spatial_encoder_skill`

至少要测：

1. 文本编码是否成功
2. 向量维度是否一致
3. 相似度排序是否可复现

#### `spatial_vector_skill`

至少要测：

1. top-k 返回数量
2. bbox filter 是否生效
3. category filter 是否生效

#### `route_distance_skill`

至少要测：

1. 点位合法性
2. 返回距离和时间字段完整性
3. 降级模式标记是否正确

### 15.2 Function Calling 集成测试

重点不是“模型像不像聪明”，而是：

1. 会不会选对 skill
2. 会不会传对参数
3. 失败后会不会修正一次
4. 会不会把语义分数错当硬事实

### 15.3 建议的最小问题集

1. `湖北大学最近的地铁站，站口也列出来，并说明哪个出口最近`
2. `湖北大学附近 1km 内有哪些公交站`
3. `湖北大学附近配套怎么样，餐饮和娱乐分别举例`
4. `和武汉大学周边气质相似的片区有哪些`
5. `比较武汉大学和湖北大学附近的餐饮活跃度`
6. `湖北大学附近适合开咖啡店吗，考虑学生消费和地铁可达性`

### 15.4 核心指标

建议至少记录：

1. `tool_selection_accuracy`
2. `arg_binding_accuracy`
3. `sql_valid_rate`
4. `evidence_grounded_answer_rate`
5. `avg_tool_calls_per_query`
6. `p50_latency_ms`
7. `p95_latency_ms`
8. `degraded_mode_rate`

---

## 16. 推荐的开发落地顺序

如果现在立刻开干，建议顺序不要乱。

### Step 1

先做 `postgis_skill` 的最小闭环：

1. `get_schema_catalog`
2. `resolve_anchor`
3. `validate_spatial_sql`
4. `execute_spatial_sql`

这是因为它最能直接验证：

`自然语言空间问题 -> 真实空间证据`

### Step 2

再做 `route_distance_skill`

这样可以立刻把“最近地铁站 / 最近出口”这类最容易被用户挑刺的问题做扎实。

### Step 3

再接 `spatial_encoder_skill` 和 `spatial_vector_skill`

它们更适合解决：

1. 相似片区
2. 场景适配
3. 语义召回

### Step 4

最后再做 Evidence View 与统一输出层。

因为如果没有前面几个 skill 的稳定证据源，后面的润色只会继续变毛坯。

---

## 17. 对另一个窗口 AI 的明确提醒

如果你是后续接手者，请优先记住这几句话：

1. 不要重新发明一堆“配套分析工具”“比较分析工具”。
2. 优先把底层空间能力做成少量原子 skills。
3. 把 SQL 安全壳设计好，这比多写几个 prompt 更重要。
4. “最近”优先看真实可达性，不要偷换成简单点对点直线距离。
5. 向量召回和编码器评分只能做候选或辅助证据，不能直接伪装成硬事实。
6. 目标是让强模型学会调用空间能力，不是再造一个 planner 文书系统。

---

## 18. 最后一段总结

V4 真正要搭起来的，不是“更多工具”，而是：

> **一个可以被强模型可靠调用的空间能力底座。**

这套底座必须满足四件事：

1. 少量原子 skills
2. 明确请求响应协议
3. 严格安全边界
4. 可追踪、可测试、可审计

只要这四件事立住了，后面不管是：

1. 强模型 function calling
2. MCP 风格外挂 skill server
3. 未来的小模型蒸馏

都会有真正稳固的地基。
