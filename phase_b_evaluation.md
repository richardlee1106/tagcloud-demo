# 阶段 B 计划评估报告

> **评估对象**：[空间规划器前台渐进式实施计划](file:///d:/AAA_Edu/TagCloud/vite-project/docs/plans/2026-03-27-空间规划器前台渐进式实施计划.md) — 阶段 B「定义 planner_line 的契约」
>
> **核心目标**：让 V3 从"靠规则兜答案"变成"LLM 规划 → 空间编码器取证 → 后端协调执行"

---

## 一、总体判断

> [!IMPORTANT]
> 阶段 B 的方向完全正确，这是整个改造中**最关键的基础设施层**。但 Codex 的计划在几个关键点上**不够深入、边界太松**，如果就这样直接开始写代码，很容易滑入"形式上有 schema，实际上还是规则在驱动"的陷阱。

### 评分总览

| 维度 | 评分 | 核心判断 |
|------|------|---------|
| 方向正确性 | ⭐⭐⭐⭐⭐ | 完全对齐核心目标 |
| 架构粒度 | ⭐⭐⭐☆☆ | schema 字段设计偏粗，缺执行语义 |
| 与现有代码的衔接 | ⭐⭐☆☆☆ | 计划几乎没分析现有代码，衔接方案空白 |
| 可实施性 | ⭐⭐⭐☆☆ | 目录和文件列表清晰，但关键细节缺失 |
| 风险识别 | ⭐⭐☆☆☆ | 未识别出最致命的几个坑 |

---

## 二、做对了什么

### 2.1 三层契约分离思路清晰

计划把契约拆成 3 个层次完全正确：

```
B1: 规划输出 schema（LLM → 后端）
B2: 执行层 schema（后端 → 空间能力层）
B3: 证据回填 schema（后端 → LLM）
```

这个分层对应了核心目标的三段式流水线，是后续所有阶段的基石。

### 2.2 `task_type` 枚举合理

```
nearby_lookup | area_overview | support_gap_analysis | site_suitability | region_comparison
```

与现有 [intentService.js](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/ai/intentService.js) 中 `TASK_TYPE_VALUES`（第300-306行）完全一致，说明没有拍脑袋发明新概念，可以做到平滑迁移。

### 2.3 `stop_conditions` 设计有远见

```json
{
  "max_rounds": 1,
  "max_queries": 4,
  "min_evidence_items": 5
}
```

这是为阶段 D（多轮规划）预留的接口，在阶段 B 只约束为 `max_rounds: 1`，很克制。

### 2.4 产出文件列表明确

```
plannerSchema.js  — 数据结构定义
plannerPrompts.js — LLM prompt 模板
planValidator.js  — 校验逻辑
ADR 文档          — 架构决策记录
```

目录清晰、职责分明，开箱即可建。

---

## 三、关键问题和风险

### 🔴 问题 1：`steps` 字段定义太弱 — 这是整个计划最大的短板

计划中给出的 `steps` 示例：

```json
"steps": [
  {
    "step_id": "resolve_anchor",
    "tool": "spatial_core.resolve_anchor",
    "input": {}
  }
]
```

**问题在哪**：

1. **`tool` 字段只有一个示例**，没有列出 `spatial_core` 应该暴露哪些可调用的能力（tool catalog）。但实际上，V3 当前已有的空间能力远不止"锚点解析"，至少包括：

   | 能力 | 现有实现位置 | 对应 tool 名称（建议） |
   |------|-------------|----------------------|
   | 锚点解析 | `intentService.js` `extractPlaceNameFromQuery` | `resolve_anchor` |
   | 近邻 POI 检索 | `spatialSearchOrchestrator.js` | `search_nearby_pois` |
   | FAISS 向量检索 | `faissIndex.js` | `vector_search` |
   | 宏观 cell 分析 | `macroTaskExecutor.js` | `macro_cell_analysis` |
   | 空间编码器查询 | `queryEmbeddingService.js` / `runtimeSpatialAugmenter.js` | `spatial_encode` |
   | 业态桶统计 | `supportEvidenceUtils.js` | `support_bucket_stats` |
   | 空间几何构建 | `spatialEvidenceService.js` | `build_boundary` / `build_clusters` |

2. **`input: {}` 是空的**。如果不定义每个 tool 的输入 schema，LLM 不知道怎么填参数，后端也没法校验。这会直接导致"表面上 planner 在规划，实际上 LLM 在瞎猜参数"。

3. **没有 `output` schema**。每个 step 执行完应该返回什么结构的数据？下一个 step 怎么引用上一个 step 的结果？这些都没有约定。

> [!WARNING]
> **如果不补齐 tool catalog + input/output schema，阶段 B 本身就会变成一个半成品**——有框架但没内容，到阶段 C 时会被迫回来补。

**建议修正**：

```json
"steps": [
  {
    "step_id": "s1_resolve",
    "tool": "spatial_core.resolve_anchor",
    "input": { "place_name": "武汉大学" },
    "expect_output": ["anchor_lon", "anchor_lat", "resolved_name"]
  },
  {
    "step_id": "s2_search",
    "tool": "spatial_core.search_nearby_pois",
    "input": {
      "anchor": "$ref:s1_resolve.anchor_lon,$ref:s1_resolve.anchor_lat",
      "radius_m": 1200,
      "category_filter": "餐饮美食",
      "limit": 30
    },
    "expect_output": ["pois", "total_count"]
  }
]
```

关键增补：
- 每个 tool 有明确的 `input` schema
- 支持 `$ref:step_id.field` 做步骤间数据传递
- `expect_output` 声明预期产出，便于校验

---

### 🔴 问题 2：`spatial_core` 作为独立能力层，计划中完全没有落地方案

计划第82-96行描述了 `spatial_core` 应包含的能力：

> - 空间编码器客户端
> - FAISS / PostGIS 检索
> - 表层几何/边界/热点构建
> - POI enrich
> - 宏观 cell 查询
> - 证据规范化

**但在阶段 B 的具体文件列表中，没有任何关于 `spatial_core` 的产出**。只列了 `planner_line/` 下的文件。

现有代码的问题是：这些空间能力**散落在多个模块中，且带有强烈的 rules_line 假设**（比如 `chatPipeline.js` 786行中直接引用 `rules_line/ai/supportEvidenceUtils.js`）。

如果不先把 `spatial_core` 抽出来：
- `planner_line` 要么重新调用 `rules_line` 的代码（违反隔离原则）
- 要么重写一遍（浪费且容易引入 bug）

> [!IMPORTANT]
> **建议在阶段 B 中增加 `spatial_core` 接口层的定义**，至少定义出每个能力的调用签名（function signature），不需要在 B 阶段实现搬迁，但必须明确"将来 planner_line 会通过什么接口调用空间能力"。

建议增加产出文件：

```
V3-GeoEncoder-RAG/services/spatial_core/
├── index.js              # 统一导出
├── spatialToolCatalog.js  # tool catalog：name → handler 映射
├── toolSchemas.js         # 每个 tool 的 input/output JSON schema
└── README.md             # 接口契约说明
```

---

### 🟡 问题 3：证据回填 schema（B3）缺少"证据血统追踪"

B3 列出了 evidence bundle 应包含的字段：

```
anchors, nearby_pois, representative_pois, support_buckets,
support_bucket_metrics, population_metrics, boundary/cluster/region,
uncertainty, execution_trace
```

这个列表基本覆盖了现有 [chatPipeline.js buildSpatialEvidence()](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js#L531-L771) 的全部输出字段，方向是对的。

**但缺少一个关键维度：证据的来源标注（provenance）**。

当 LLM 拿到 evidence bundle 去生成回答时，它需要知道：
- 这个 `support_buckets` 是从空间编码器的宏观分析来的，还是从简单的 POI 类别统计来的？
- 这个 `boundary` 是凸包算法算的，还是 EULUC 地块得来的？
- 证据的置信度如何？

没有 provenance 标注，LLM 可能会把低质量证据当作确定性事实来写结论。

**建议每个证据块增加**：

```json
{
  "support_buckets": [...],
  "support_buckets_meta": {
    "source": "macro_cell_analysis | poi_category_stats | spatial_encoder",
    "confidence": 0.82,
    "sample_size": 47,
    "generated_by_step": "s3_macro"
  }
}
```

这同时也为阶段 D（多轮规划）的"证据不足判断"提供了决策依据。

---

### 🟡 问题 4：`answer_frame` 设计过于简略

```json
"answer_frame": {
  "style": "comparison | gap | overview | lookup",
  "must_ground_in_evidence": true
}
```

`must_ground_in_evidence: true` 是好的约束，但 `style` 这个字段跟 `task_type` 高度重复。如果 `answer_frame` 只是 `task_type` 的别名，它就没有存在价值。

**`answer_frame` 真正应该解决的问题是**：控制 LLM 最终回答的结构和粒度。建议加入：

```json
"answer_frame": {
  "style": "comparison",
  "must_ground_in_evidence": true,
  "required_sections": ["配套对比", "核心差异", "建议"],
  "max_length_hint": "medium",
  "tone": "analytical",
  "forbidden_claims": ["不能凭猜测声称某处'缺少'某类业态"]
}
```

特别是 `forbidden_claims` —— 这是防止 LLM 瞎编缺口（当前 `spatialAnswerService.js` 用了大量硬编码模板来控制的问题）的关键机制。

---

### 🟡 问题 5：验收标准太模糊

计划的验收标准：

> 1. Planner 输出 schema 稳定
> 2. 不依赖旧 task-specific answer 规则也能表达"怎么查"
> 3. 至少能对 10 题中的每一题生成结构合法的查询计划

第 3 条是唯一可量化的标准，但"结构合法"的定义缺失。

**建议改为**：

| 验收项 | 量化标准 | 验证方法 |
|--------|---------|---------|
| Schema 可解析 | 10/10 题输出通过 `planValidator.js` | 自动化测试 |
| Tool 引用合法 | 10/10 题的 steps 中所有 tool name 均在 catalog 中 | 自动化测试 |
| Input 完整性 | 10/10 题的每个 step input 字段不缺必填项 | 自动化测试 |
| 非规则依赖 | planner 生成的 plan **不引用** rules_line 中任何模块 | 代码审查 |
| 人工审查 | 10 题计划由人工标注为"合理" ≥ 8 题 | 人工标注 |

---

## 四、与现有代码的冲突和衔接点

这是计划中**完全缺失**的部分。我基于代码审查补充如下：

### 4.1 现有代码中已有的"准 planner"能力

| 现有模块 | 做了什么 | 未来去向建议 |
|---------|---------|-------------|
| [intentService.js](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/ai/intentService.js) (52KB) | 意图解析 + 锚点提取 + task_type 推断 | `spatial_core` 保留锚点提取能力；task_type 推断交给 LLM planner |
| [spatialAnswerService.js](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/ai/spatialAnswerService.js) (56KB) | 基于规则的确定性回答生成 | **逐步废弃**，被 `answerSynthesis.js` 替代 |
| [chatPipeline.js](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/ai/chatPipeline.js) (29KB) | 构建空间证据（evidence bundle） | 重构为 `spatial_core`，被 `planExecutor` 调用 |
| [spatialEvidenceService.js](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/retrieval/spatialEvidenceService.js) (34KB) | 几何构建、边界计算、区域分析 | 直接迁入 `spatial_core` |
| [macroTaskExecutor.js](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/retrieval/macroTaskExecutor.js) (25KB) | 宏观 cell 查询 | 迁入 `spatial_core` |
| [spatialSearchOrchestrator.js](file:///d:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/services/rules_line/retrieval/spatialSearchOrchestrator.js) (28KB) | POI 检索编排 | 迁入 `spatial_core` |

### 4.2 最大衔接风险

> [!CAUTION]
> `chatPipeline.js` 中的 `buildSpatialEvidence()` 函数（第531-771行）是当前系统的**核心数据汇聚点**——它同时 import 了 `rules_line` 和 `retrieval` 层的代码。如果阶段 B 只定义 schema 而不先理清这个函数的依赖关系，阶段 C 在实现 `planExecutor` 时会遇到巨大的依赖纠缠。

**建议**：在阶段 B 增加一个子任务——画出 `buildSpatialEvidence()` 的数据流图，标注每个数据源的归属（应该放到 `spatial_core` 还是留在 `planner_line`）。

---

## 五、修订建议汇总

### 对阶段 B 的修正（按优先级排序）

| 优先级 | 修正项 | 原因 |
|--------|--------|------|
| P0 | 补齐 **tool catalog** — 定义 `spatial_core` 暴露的所有可调用能力及其 input/output schema | 没有这个，planner 的 `steps` 字段无从填起 |
| P0 | 补齐 **step 间数据引用机制**（`$ref` 或等效方案） | 没有这个，多步计划无法串联 |
| P1 | 增加 `spatial_core/toolSchemas.js` 作为阶段 B 产出 | 这是 planner 和 executor 之间的桥梁 |
| P1 | 证据 bundle 增加 **provenance 元数据** | 防止 LLM 把低质量证据当事实 |
| P2 | 细化验收标准为**可自动化检测**的量化指标 | 模糊标准 = 无法判断是否完成 |
| P2 | 增加 `buildSpatialEvidence` 数据流分析子任务 | 为阶段 C 扫清依赖障碍 |
| P3 | `answer_frame` 增加 `forbidden_claims` 等控制字段 | 替代 `spatialAnswerService.js` 中 56KB 硬编码模板的核心机制 |

### 建议修正后的阶段 B 文件产出

```
V3-GeoEncoder-RAG/services/planner_line/
├── plannerSchema.js        # planner 输出的完整 JSON schema
├── plannerPrompts.js       # LLM system prompt + few-shot 示例
├── planValidator.js        # schema 校验 + tool name 合法性检查
└── evidenceBundleSchema.js # evidence bundle 的结构定义（含 provenance）

V3-GeoEncoder-RAG/services/spatial_core/
├── toolCatalog.js          # tool name → description + input/output schema
├── toolSchemas.js          # 每个 tool 的 JSON schema 定义
└── README.md               # 接口契约说明

docs/architecture/
├── adr-llm-as-spatial-planner.md  # 架构决策记录
└── spatial-evidence-dataflow.md   # buildSpatialEvidence 数据流分析
```

---

## 六、结论

> [!TIP]
> **一句话结论**：方向完全正确，但需要把"契约"真正定义到**可执行的精度**，而不是停留在"先有个 JSON 框架"的层面。

阶段 B 是整个改造的地基。如果这一步只产出一个"大概长这样"的 schema 示例，到阶段 C 写 `planExecutor` 时会发现：
1. LLM 不知道能调什么 tool → 只能猜
2. tool 之间数据传不动 → 只能硬编码
3. 证据质量无从判断 → LLM 回答质量没保障

**最终又会退回到"补规则"**。

计划中反复强调的底线——**"能交给规划器解决的问题，就不要继续往规则里堆"**——要落地，关键就在于阶段 B 的契约是否足够精确，精确到 LLM 只需看 tool catalog 就知道"我能问什么、怎么问、会拿回什么"。
