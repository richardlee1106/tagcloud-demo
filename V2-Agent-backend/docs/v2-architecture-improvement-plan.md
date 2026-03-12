# V2 架构改进方案

> 日期：2026-03-09
> 范围：`V2-Agent-backend`

## 一、当前问题总结

| 问题 | 根因 |
|------|------|
| 无真正多Agent并行 | `Promise.resolve().then()` 是假并行，只是放入微任务队列 |
| 代码大量重复 | 6个 objective 处理函数结构相同，只有 specialist 调用不同 |
| 非真正 LLM RAG | Narrative 生成是模板填充，不是 LLM 实时推理 |
| 快速响应是"假快" | 靠预设模板和硬编码"快速路径"，不是架构优化 |

---

## 二、正确的架构设计

### 1. 真正的 "一个中枢 + 多个 Agent 并行"

```
                    ┌─────────────────────────────────────┐
                    │         Task Orchestrator           │
                    │         (唯一中枢入口)              │
                    └─────────────────────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │ Data Grounding│      │ Data Grounding│      │ Data Grounding│
   │    Agent      │      │    Agent      │      │    Agent      │
   │  (并行执行)   │      │  (并行执行)   │      │  (并行执行)   │
   └──────────────┘      └──────────────┘      └──────────────┘
            │                      │                      │
            └──────────────────────┼──────────────────────┘
                                   ▼
                    ┌─────────────────────────────────────┐
                    │       Specialist Agents 聚合        │
                    │  Dominant + Hotspot + Opportunity   │
                    │         (真正并行，Promise.all)     │
                    └─────────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │        LLM Narrative Agent          │
                    │      (动态生成，非模板填充)         │
                    └─────────────────────────────────────┘
```

**关键实现：**

```javascript
// 真并行 - 使用 Promise.all
async function runSpecialistsInParallel(agentConfigs) {
  const tasks = agentConfigs.map(config => () => specialistAgent.dispatch(config))
  return Promise.all(tasks.map(task => task()))  // 真正的并行执行
}

// 或者更彻底：使用 Worker Threads
// 每个 Agent 运行在独立 Worker 中，真正利用多核 CPU
```

---

### 2. LLM-Driven 路由决策

**当前（规则驱动）：**
```javascript
function inferObjective(normalizedQuery) {
  if (includesAny(query, KEYWORDS.buffer)) return 'buffer_export_workflow'
  // ... 更多 if-else
}
```

**应该（LLM 驱动）：**
```javascript
async function routeObjectiveWithLLM(query, viewport, context) {
  const llmResponse = await llm.chat({
    messages: [
      { role: 'system', content: ROUTING_PROMPT },
      { role: 'user', content: `Query: ${query}\nViewport: ${JSON.stringify(viewport)}` }
    ]
  })

  return parseLLMJsonResponse(llmResponse)  // { objective, confidence, reasoning }
}
```

---

### 3. LLM Narrative 生成（非模板填充）

**当前（模板填充）：**
```javascript
function buildNarrative(groundingResult) {
  return `该区域共有 ${count} 个 POI，主要业态为 ${topIndustry}...`
}
```

**应该（LLM 实时生成）：**
```javascript
async function generateNarrativeWithLLM(context) {
  const prompt = buildNarrativePrompt(context)  // 动态构建 prompt
  // prompt 包含：grounding 数据、specialist 结果、quality decision

  const narrative = await llm.chat({
    messages: [
      { role: 'system', content: NARRATIVE_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7  // 允许一定创造性
  })

  return parseNarrativeResponse(narrative)
}
```

---

## 三、优化全链路时延的架构策略

| 阶段 | 当前问题 | 优化策略 |
|------|----------|----------|
| **路由决策** | 同步规则匹配 | LLM 路由可异步，后台预加载 |
| **数据检索** | 串行等待 | 并行查多个数据源 (POI + 热区 + 机会点) |
| **Agent 执行** | 假并行 | 真并行 + Worker Threads |
| **Narrative 生成** | 模板填充（快但质量低） | 预生成 + LLM 增量优化 |
| **缓存策略** | 仅有结果缓存 | 增加 **Prompt 缓存** + **Embedding 缓存** |

---

## 四、推荐的分层架构

```
┌────────────────────────────────────────────────────────────┐
│                      API Layer                             │
│         POST /api/v2/analysis (SSE Stream)               │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                   Router (LLM-Driven)                     │
│    - Objective 分类                                       │
│    - Agent 组合策略                                      │
│    - Fallback 决策                                       │
└────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌─────────┐   ┌─────────┐   ┌─────────┐
        │ Grounding│   │ Grounding│   │ Grounding│
        │ Agent A │   │ Agent B │   │ Agent C │
        └─────────┘   └─────────┘   └─────────┘
              │             │             │
              └─────────────┼─────────────┘
                            ▼
        ┌─────────────────────────────────┐
        │     Specialist Pool (并行)      │
        │  Dominant | Hotspot | Opp      │
        └─────────────────────────────────┘
                            │
                            ▼
        ┌─────────────────────────────────┐
        │    LLM Narrative Composer       │
        │   (动态生成，非模板填充)        │
        └─────────────────────────────────┘
                            │
                            ▼
        ┌─────────────────────────────────┐
        │      Quality Guard Agent        │
        │   (评估可信度，决策是否返回)    │
        └─────────────────────────────────┘
```

---

## 五、时延预算分配建议

假设目标是 **3秒内返回 fast.result**：

| 环节 | 时延预算 | 优化手段 |
|------|----------|----------|
| LLM 路由决策 | 300ms | 路由结果缓存（相同 query 复用） |
| 并行数据检索 | 500ms | PostGIS 连接池 + 查询优化 |
| Specialist 并行 | 800ms | 真并行 + Worker Threads |
| LLM Narrative | 1000ms | **预生成策略**（见下） |
| 其他开销 | 400ms | - |

**预生成策略（实现"快"的真正来源）：**

1. **历史 query 预路由**：后台定期用常见 query 调用 LLM 路由，结果存入缓存
2. **热门区域预检索**：常用 viewport 的数据预加载到内存
3. **预生成 Narrative**：相同 objective + grounding 结果 → 预生成 Narrative 缓存

---

## 六、总结

V2 架构的核心问题不是"没有实现功能"，而是**架构模式选错**：

| 当前实现 | 应该改进为 |
|----------|------------|
| 规则引擎 | LLM-Driven |
| 假并行 | 真并行 (Promise.all + Worker Threads) |
| 模板填充 | LLM 动态生成 |
| 快速响应靠预设 | 预生成 + 缓存优化 |

---

## 七、后续行动建议

1. **短期**：修复 `runSpecialistsInParallel` 的假并行问题
2. **中期**：重构 TaskOrchestrator，消除重复代码，抽象通用逻辑
3. **长期**：引入 LLM 驱动路由和 Narrative 生成，配合预生成缓存策略实现真正的快速响应
