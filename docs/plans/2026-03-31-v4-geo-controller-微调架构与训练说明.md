# V4 Geo Controller 微调架构与训练说明

> **状态说明（2026-04-01 更新）**
> 这份文档现在属于 **过渡方案 / 历史参考文档**。
>
> 它保留的价值主要是：
> 1. 帮助理解当时为什么会想到“小模型微调 + Geo Controller”
> 2. 作为后续可能做蒸馏时的参考材料
>
> 但它 **已经不是当前主线方案**。当前应优先遵循：
>
> 1. [2026-04-01-v4-geo-agent-最新上下文与研究方案.md](D:/AAA_Edu/TagCloud/vite-project/docs/plans/2026-04-01-v4-geo-agent-%E6%9C%80%E6%96%B0%E4%B8%8A%E4%B8%8B%E6%96%87%E4%B8%8E%E7%A0%94%E7%A9%B6%E6%96%B9%E6%A1%88.md)
> 2. [2026-04-01-v4-geo-agent-skills-interface-spec.md](D:/AAA_Edu/TagCloud/vite-project/docs/plans/2026-04-01-v4-geo-agent-skills-interface-spec.md)
>
> 当前最新主线是：
> `强模型大脑 + 原子化空间 skills + function calling + 真实空间证据回传`

> 写给现在脑子有点乱、但已经准备认真推进 V4 的自己。
> 这份文档尽量不用太多“论文腔”，目标只有一个：把事情讲清楚，让后面每一步都有抓手。

---

## 0. 先说结论

V4 的核心变化，不是“换一个更小的模型”这么简单，而是把系统从：

`用户提问 -> planner LLM -> 空间执行 -> answer LLM -> 最终文本`

改成：

`用户提问 -> Geo Controller -> 按需调用空间工具 -> 生成证据视图 -> 直接回答 / 按需润色`

这里最关键的不是“更会写”，而是：

1. **把一个问题变成一次空间行动，而不是先变成一份厚厚的 planner JSON。**
2. **让简单问题尽量只走一条短链路，复杂问题才升格。**
3. **把空间事实留在 PostGIS / 空间编码器 / 向量检索里，不把事实硬塞进模型权重。**

如果这个方向做对了，V4 的价值才会真正成立。否则就算换了模型，系统也只是从“两次 LLM”变成“两次更便宜的 LLM”，体验不会发生质变。

---

## 1. V4 微调后的系统架构

### 1.1 一句话版本

V4 不是“V3 再补一层规则”，而是一个带空间工具调用能力的 **Geo Controller 系统**：

- 它负责理解用户的话；
- 它负责判断该不该调用空间工具；
- 它负责组织空间证据；
- 它默认不再依赖第二个 writer LLM 去“重新加工一次”。

换句话说，V4 想做的不是“更复杂的流水线”，而是“更像一个懂空间的 AI 脑子”。

### 1.2 V4 的核心模块

#### A. Geo Controller

这是 V4 的主角。

它学会的不是“10 个固定题型”，而是：

1. 用户到底要问什么；
2. 这是不是空间问题；
3. 需要调哪些空间工具；
4. 要拿哪些证据；
5. 最后应该怎么回答。

它的输出不是给人看的 planner 报告，而是一个很薄的内部动作表示。可以把它理解成“空间行动指令”。

#### B. Spatial Tools

这些还是 V4 的硬实力来源，暂时不需要被大改：

1. `resolve_anchor`
2. `search_nearby_pois`
3. `macro_cell_analysis`
4. `vector_search`
5. `station/exit grouping`
6. `geometry query`
7. `distance calculation`

这些工具不负责理解用户语言，它们只负责给出真实空间事实。

#### C. Evidence View

这是 V4 非常重要的一层。

它的作用是把原始空间证据，压成“面向回答的证据视图”，而不是直接把一堆 POI JSON 扔给模型。

比如：

- 地铁题，压成 `transport_view`
- POI 查询题，压成 `poi_list_view`
- 配套分析题，压成 `bucket_view`
- 比较题，压成 `comparison_view`

#### D. Renderer

默认回答由 Renderer 负责。

也就是说，很多题不再需要第二个 LLM 去“写一遍文章”，而是：

- 表格怎么排
- 哪些字段必须出现
- 先说结论还是先说明细

都由 Renderer 根据 Evidence View 直接决定。

#### E. Optional Polisher

只有在下面这类情况，才需要再让模型做一次语言润色：

1. 用户明确说“写得自然一点”
2. 用户明确说“写成报告”
3. 用户明确说“帮我详细展开”
4. 当前输出虽然证据正确，但表达太硬

注意：这一步是“可选增强”，不是主链路必经点。

---

## 2. 从用户提问到得到空间结果和文本的完整流程

这一段是 V4 最核心的流程图，我会按“发生了什么”和“这一层为什么存在”两条线一起讲。

### Step 1. 用户提问

例子：

- `湖北大学最近的地铁站，站口也列出来`
- `请分析湖北大学附近的配套、热门业态和明显缺口`
- `比较武汉大学和湖北大学附近的业态差异`

这里用户说的是自然语言，不是结构化 query。

### Step 2. Geo Controller 理解用户真实目标

Geo Controller 在这一层要完成三件事：

1. 判断是不是空间任务
2. 判断任务目标是什么
3. 判断应该调哪些工具

这一步它内部可能会形成一个短动作表示，例如：

```text
TASK transport_lookup
ANCHOR 湖北大学
ENTITY station
INCLUDE_EXITS true
EXPLAIN_DISTANCE true
OPS resolve_anchor -> search_nearby_transport -> aggregate_station_exits -> render_transport_table
LLM_BUDGET none
```

这里最重要的是：**不再先产一份又长又厚的 planner JSON 再说。**

### Step 3. Geo Controller 调用空间工具

如果是地铁题，它可能只调用：

1. `resolve_anchor`
2. `search_nearby_transport`
3. `aggregate_station_exits`

如果是配套题，它可能调用：

1. `resolve_anchor`
2. `search_nearby_pois`
3. `macro_cell_analysis`
4. `bucket_aggregation`

如果是比较题，它可能调用：

1. `resolve_anchor(primary)`
2. `resolve_anchor(secondary)`
3. `macro_cell_analysis(primary)`
4. `macro_cell_analysis(secondary)`
5. `comparison_aggregation`

重点来了：

**V4 不是按“预设 10 个专家路由表”死分，而是 Geo Controller 根据当前语言需求自己决定要调哪些工具。**

### Step 4. 工具返回原始空间证据

这些原始证据来自：

1. PostGIS
2. 空间编码器
3. 向量数据库
4. 聚合器

例如：

- anchor 的真实 POI
- 距离结果
- 站点与出口关系
- bucket 统计
- representative examples

这些是真正可靠的“空间事实”。

### Step 5. 把原始证据压成 Evidence View

这一层是为了避免两种常见灾难：

1. 原始证据太多，模型读不动
2. 原始证据虽然对，但最后写出来时逻辑错位

所以 V4 会先把空间证据压成“回答视图”。

例如地铁题：

```json
{
  "view_type": "transport_view",
  "anchor": "湖北大学(武昌校区)",
  "distance_semantics": "anchor_poi_to_poi_geodesic",
  "station_groups": [
    {
      "station": "湖北大学站",
      "nearest_exit": "E口",
      "nearest_exit_distance_m": 372.1,
      "station_distance_m": 458.0
    }
  ]
}
```

配套题：

```json
{
  "view_type": "bucket_view",
  "anchor": "湖北大学",
  "buckets": [
    { "bucket": "餐饮配套", "examples": ["文饱饱蛋肉堡", "儒小孟麻辣烫店"] },
    { "bucket": "休闲娱乐", "examples": ["红鲱鱼剧本社", "奥雅网球培训中心"] }
  ],
  "gap_candidates": [
    { "bucket": "零售购物", "confidence": "low" }
  ]
}
```

### Step 6. Renderer 直接生成结构化回答

在这一层，系统直接产出：

1. 表格
2. 对照块
3. 简短结论
4. 必要说明

例如地铁题可以直接输出：

- 最近站点表
- 站口距离表
- “最近”的计算说明

这一步默认不需要另一个 writer LLM。

### Step 7. Optional Polisher 按需润色

如果用户需要更自然的语气、更完整的分析、更像报告的表达，再调用同一个模型的轻量模式润色。

重点不是“再重新思考一遍”，而是：

- 不改事实
- 不改证据
- 只改表达

### Step 8. 返回给用户

最终返回的内容分两层：

1. **用户层结果**
   - 看得懂、结构稳、证据不乱
2. **系统层证据**
   - 可以被日志记录和后续验证

这就避免了 V3 的一个核心问题：答案明明是证据生成的，但最后又像是“另一个模型自由发挥出来的”。

---

## 3. V4 和 V3 的逐流程对比

### 3.1 总体对比

| 对比项 | V3 | V4 |
|---|---|---|
| 主入口 | planner LLM | Geo Controller |
| 中间层形态 | 厚 planner JSON + brief | 薄动作表示 + Evidence View |
| 工具调用 | 由 planner 决定，再执行 | 由 controller 直接驱动 |
| 答案生成 | 依赖 answer LLM | 默认 renderer，按需才润色 |
| 简单题链路长度 | 长 | 短 |
| 复杂题链路 | 也长 | 按需升格 |
| 用户感知 | “系统在多次思考、多次加工” | 更像一个 AI 直接完成任务 |

### 3.2 每一步的流程对比与预期效益

| 流程阶段 | V3 在做什么 | V4 在做什么 | 预期效益 |
|---|---|---|---|
| 语言理解 | LLM 先生成 planner JSON | Controller 直接形成动作表示 | 少一层“写文书”的损耗 |
| 路由决策 | planner 再决定工具顺序 | controller 直接做工具调度 | 路径更短，状态更统一 |
| 空间执行 | 这一段本来就不算慢 | 继续保留 | 几乎无负担，继续复用 |
| 证据整理 | brief 比以前好，但仍然偏“回答前摘要” | 先形成 Evidence View | 证据和回答结构更一致 |
| 文本输出 | answer LLM 再生成文本 | renderer 直接回答，polisher 可选 | 大幅减少第二次 LLM 调用 |
| 失败兜底 | fallback_summary | renderer 自带稳定模板，必要时澄清 | 失败面更小 |

### 3.3 对比 V3 的核心收益，不只是“更快”

V4 的收益其实有四种：

#### 1. 时间收益

这是最直观的。

在 2026-03-31 的 10 题实测里，V3 的简单题典型耗时大约是：

- Q2：`34381 ms`
- Q3：`37316 ms`
- Q4：`38731 ms`

主要耗时不在空间检索，而在两次 LLM 阶段。

V4 的目标不是“每题都靠更小模型硬压”，而是：

- 简单题默认不走第二次文本生成
- 尽量让控制层只做一次

因此合理预期是：

| 场景 | V3 | V4 预期 |
|---|---:|---:|
| 简单 lookup（附近有哪些、最近的地铁站） | 30s~40s | 6s~15s |
| 中等分析（配套、概览） | 50s~90s | 12s~25s |
| 复杂比较（双锚点比较） | 90s~130s | 20s~40s |

换算成比例，可以先用一个保守目标去理解：

- **简单题总耗时降到 V3 的 20%~40%**
- **中等题降到 V3 的 25%~50%**
- **复杂题降到 V3 的 30%~60%**

这不是承诺值，而是基于“去掉一大段冗余链路”后的架构预估。

#### 2. 语义一致性收益

V3 容易出现：

- 站级列表 + 出口级距离混写
- 说餐饮配套，却举娱乐点

V4 通过 Evidence View 先把语义关系固化，理论上会更稳。

#### 3. 维护收益

V3 继续补 if/else 只会越补越长。  
V4 的收益是：

- 主逻辑更集中
- 规则更少
- 证据契约更清楚

#### 4. 用户体验收益

V3 用户容易感觉：

- 系统想了两遍
- 写了两遍
- 最后还不一定写对

V4 的目标是让用户感知成：

- 我问一句
- 系统像一个会用空间工具的 AI，直接给我结果

---

## 4. V4 的一个重要边界：模型学什么，不学什么

这个边界如果不想清楚，训练时很容易又回到老路。

### 模型要学的

1. 怎么理解用户空间需求
2. 怎么选工具
3. 怎么绑定参数
4. 怎么判断证据够不够
5. 怎么决定回答结构

### 模型不要学的

1. 真实空间事实
2. 所有 POI 数据
3. 所有距离结果
4. 所有区域统计

原因很简单：

- 空间事实会变
- 数据量很大
- 真正精确的结果应该来自数据库和空间工具

所以 V4 的模型更像一个 **空间控制脑**，不是一个 **空间知识库本体**。

---

## 5. 最后一句给自己打气的话

你现在觉得乱，其实很正常。  
因为这件事确实不是“改几个 prompt”那么简单，它是在把系统从“多段流水线”换成“一个真正懂空间的控制脑”。

但好消息是：

方向已经比之前清楚很多了。  
现在最重要的不是一口气把所有事做完，而是按顺序把第一步踩实。

先把动作格式定下来，后面的路就会顺很多。
