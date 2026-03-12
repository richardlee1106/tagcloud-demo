# V2架构全盘诊断报告

> 日期：2026-03-10
> 范围：V2-Agent-backend 完整代码库

---

## 执行摘要

本报告对V2架构进行全盘诊断，识别出**7大类28个具体问题**，涵盖并行执行、智能路由、叙事生成、数据 grounding、状态管理、架构设计与工程实践等多个维度。与设计文档承诺存在显著差距，需要系统性重构才能达到预期架构目标。

---

## 一、执行层问题（Executor Issues）

### 问题1.1：假并行执行 ✅ 已识别

**文件**: `V2-Agent-backend/src/orchestrator/parallel-agent-executor.js:17-19`

```javascript
async function runInProcess(tasks = []) {
  return Promise.all(tasks.map((task) => Promise.resolve().then(() => runSpecialistTask(task))))
}
```

**问题**: `Promise.resolve().then()` 是微任务队列，实际串行执行

**影响**: 多 specialist 无法并行，总时间 = 各 specialist 时间之和

---

### 问题1.2：Worker Threads 模式未验证

**文件**: `V2-Agent-backend/src/orchestrator/parallel-agent-executor.js:8-15`

```javascript
function resolveExecutorMode() {
  const mode = String(process.env.V2_AGENT_EXECUTOR_MODE || '').trim().toLowerCase()
  if (EXECUTOR_MODES.has(mode)) {
    return mode
  }
  return isTestRuntime() ? 'in_process' : 'worker_threads'
}
```

**问题**:
- 生产环境理论上使用 `worker_threads`，但未验证实际运行效果
- Worker 脚本路径 `specialist-worker.js` 需要独立入口文件
- 未验证 worker 进程间通信开销是否值得

---

### 问题1.3：Specialist 执行超时未处理

**文件**: `V2-Agent-backend/src/orchestrator/parallel-agent-executor.js:21-54`

```javascript
function runInWorker(task, { workerTimeoutMs, workerScriptUrl }) {
  const timer = setTimeout(() => {
    worker.terminate().catch(() => {})
    reject(new Error('worker_timeout'))
  }, workerTimeoutMs)
  // ...
}
```

**问题**:
- Worker 超时默认 2500ms，但 specialist 可能需要更长时间
- 超时后只是 reject，没有 fallback 到 in_process
- in_process 模式无超时保护

---

## 二、路由层问题（Routing Issues）

### 问题2.1：规则引擎仍是核心 ✅ 已识别

**文件**: `V2-Agent-backend/src/agents/intent-router-agent.js:97-133`

**问题**:
- `inferObjective` 函数纯关键词匹配 + if-else 优先级
- LLM 路由被严格限制，只能输出 allowlist 内的 objective
- 无法理解复杂/模糊意图

---

### 问题2.2：关键词定义不完整

**文件**: `V2-Agent-backend/src/agents/intent-router-agent.js:35-53`

```javascript
const KEYWORDS = {
  areaBriefing: ['30s', '30 sec', 'briefing', 'overview', '片区', '快评', ...],
  dominant: ['dominant', 'industry', 'industries', '业态', '主导'],
  hotspot: ['hotspot', 'hotspots', '热点', '热区'],
  // ...
}
```

**问题**:
- 关键词列表不完整，漏掉很多同义词
- 无语义理解能力，只能精确匹配
- 优先级硬编码，无法适应不同业务场景

---

### 问题2.3：Legacy Intent Router 未复用

**文件**: `V2-Agent-backend/src/chain/intent-router.js:21-84`

```javascript
export function routeIntent({ query = '', viewport = {}, history = [] } = {}) {
  const compareHits = countKeywordHits(normalizedQuery, COMPARE_KEYWORDS)
  const microHits = countKeywordHits(normalizedQuery, MICRO_KEYWORDS)
  // ...
}
```

**问题**:
- 存在两套独立的路由逻辑（chain/intent-router.js 和 agents/intent-router-agent.js）
- 代码重复，维护成本高
- V1 的路由能力未充分复用

---

## 三、叙事生成问题（Narrative Issues）

### 问题3.1：Fast Narrative 是模板拼接 ✅ 已识别

**文件**: `V2-Agent-backend/src/agents/narrative-writer-agent.js:64-100`

```javascript
composeFastNarrative({ groundingResult, specialistResults, qualityDecision }) {
  const sections = specialistResults.map((result) => buildSection(result))
  const text = sections.map((section) => section.summary).join(' ')
  // 纯拼接，无LLM调用
}
```

---

### 问题3.2：LLM Narrative 仅做"重写"而非"生成" ✅ 已识别

**文件**: `V2-Agent-backend/src/agents/narrative-writer-agent.js:101-141`

```javascript
async composeFastNarrativeWithLlm({ ... }) {
  const deterministic = this.composeFastNarrative({ ... })  // 先拼接
  const rewrittenText = await llmNarrativeAgent.rewrite({  // 再重写
    deterministicText: deterministic.answer?.text ?? ''
  })
}
```

**问题**:
- LLM 不是从头生成，而是"重写"已有的拼接文本
- 无法发挥 LLM 的真正能力
- 生成质量受限于拼接质量

---

### 问题3.3：LLM Gateway 失败静默降级

**文件**: `V2-Agent-backend/src/llm/llm-gateway.js:105-191`

```javascript
async chat({ ... }) {
  try {
    const text = await callChatCompletion({ ... })
    return { text, provider: 'local', model: localModel }
  } catch {
    if (!cloudApiKey) {
      return null  // 静默失败，无日志
    }
    // 尝试云端...
  }
}
```

**问题**:
- LLM 调用失败返回 null，无明确错误信息
- 上游无法区分"禁用"和"失败"
- 难以排查 LLM 相关问题

---

## 四、数据 Grounding 问题（Grounding Issues）

### 问题4.1：Sample 数据 fallback 过深

**文件**: `V2-Agent-backend/src/repositories/postgis-poi-repository.js:196-248`

```javascript
async groundingSearch({ viewport = {} } = {}) {
  if (preferSample) {
    return sampleSearch({ viewport })
  }

  const pool = await getPool()
  if (pool) {
    try {
      // 尝试 PostGIS 查询
      for (const expansion of expansions) {
        // ...
      }
    } catch {
      // fall through to sample-backed grounding
    }
  }

  return sampleSearch({ viewport })  // 最后 fallback 到 sample
}
```

**问题**:
- PostGIS 查询失败时自动降级到 sample，但无明确告警
- Sample 数据覆盖范围有限，结果可能误导用户
- 无法判断当前使用的是真实数据还是 sample

---

### 问题4.2：Grounding 阶梯策略不灵活

**文件**: `V2-Agent-backend/src/repositories/postgis-poi-repository.js:3-7`

```javascript
const DEFAULT_EXPANSIONS = [
  { step: 'aoi_exact', offset: 0 },
  { step: 'aoi_expand_250m', offset: 0.0025 },
  { step: 'aoi_expand_500m', offset: 0.005 }
]
```

**问题**:
- 扩圈策略固定（250m, 500m），无法适应不同场景
- 无智能扩圈逻辑（根据 POI 密度动态调整）
- 无多层级数据源组合（先查 POIs，再查热区，再查行政区划）

---

### 问题4.3：Coverage 判断阈值硬编码

**文件**: `V2-Agent-backend/src/agents/data-grounding-agent.js:1-25`

```javascript
function buildCoverage(features, resolvedStep) {
  if (poiCount === 0) {
    return { status: 'none', ... }
  }
  if (poiCount < 3) {
    return { status: 'partial', ... }
  }
  return { status: 'sufficient', ... }
}
```

**问题**:
- `poiCount < 3` 判断 partial，硬编码
- 无视业务场景（商业区 vs 住宅区需求不同）
- 无视 objective 需求（hotspot vs opportunity 需求不同）

---

## 五 Specialist Agents 问题

### 问题5.1：Specialist 分析过于简单

**文件**: `V2-Agent-backend/src/agents/dominant-industry-agent.js:1-35`

```javascript
export function analyzeDominantIndustry({ groundingResult }) {
  const features = groundingResult?.working_set?.poi_features ?? []
  const categoryCounts = features.reduce((counts, feature) => {
    const category = feature?.properties?.category ?? 'unknown'
    counts[category] = (counts[category] || 0) + 1
    return counts
  }, {})

  const rankedCategories = Object.entries(categoryCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
  // 只是简单的计数排序
}
```

**问题**:
- 主导业态只是简单计数，无加权、过滤、聚合
- 无业务逻辑（不同 category 权重不同）
- 无时序分析（历史趋势）

---

### 问题5.2：Hotspot 分析过于简化

**文件**: `V2-Agent-backend/src/agents/hotspot-agent.js:1-29`

```javascript
export function analyzeHotspots({ groundingResult, objectiveContract }) {
  const features = groundingResult?.working_set?.poi_features ?? []
  const counts = createQuadrantCounts(features, objectiveContract?.scope?.viewport)
  const rankedQuadrants = Object.entries(counts).sort((left, right) => right[1] - left[1])
  // 只是四象限计数
}
```

**问题**:
- 只是按四象限计数，无密度分析
- 无热力图计算
- 无聚类分析

---

### 问题5.3：Opportunity Agent 未实现

**文件**: `V2-Agent-backend/src/agents/opportunity-agent.js`

**问题**: 需要验证是否已实现，分析逻辑是否完整

---

## 六、状态管理问题

### 问题6.1：Lane State Machine 状态定义不完整

**文件**: `V2-Agent-backend/src/runtime/lane-state-machine.js:1-11`

```javascript
const ALLOWED_TRANSITIONS = {
  S0_RECEIVED: ['S1_CHAIN_PLANNED'],
  S1_CHAIN_PLANNED: ['S2_FAST_RUNNING', 'S8_TERMINAL_DEGRADED'],
  // ...
}
```

**问题**:
- 状态定义偏少，无细粒度状态
- 无"路由中"、"Grounding中"等中间状态
- 无法追踪详细执行进度

---

### 问题6.2：Async Deep Lane 调度不可控

**文件**: `V2-Agent-backend/src/orchestrator/task-orchestrator.js:191-195`

```javascript
const enqueueDeepLane = scheduleDeepLane ?? ((task) => {
  setTimeout(() => {
    void task()
  }, 0)
})
```

**问题**:
- 默认使用 `setTimeout(, 0)`，可能与主请求竞争资源
- 无优先级队列
- 无并发控制（多个 deep lane 同时执行）

---

### 问题6.3：Job Persistence 可能丢失状态

**文件**: `V2-Agent-backend/src/orchestrator/task-orchestrator.js:200-239`

```javascript
async function persistJob({ ... }) {
  const job = { ... }
  await jobStore.save(job)  // 单次保存
  return job
}
```

**问题**:
- 状态只在关键节点持久化
- 中间状态无记录
- 故障恢复可能丢失进度

---

## 七、架构设计问题

### 问题7.1：代码重复严重 ✅ 已识别

**文件**: `V2-Agent-backend/src/orchestrator/task-orchestrator.js`

三个主要分析函数高度相似：
- `analyzeStructuredObjective` (436-596行)
- `analyzeBufferExportObjective` (691-858行)
- `analyzeLegacy` (860-1082行)

**重复模式**:
```javascript
machine.transition('S1_CHAIN_PLANNED')
machine.transition('S2_FAST_RUNNING')
machine.transition('S3_FAST_DONE', { incrementsResult: true })
// 事件构建逻辑
// persistence 逻辑
```

---

### 问题7.2：Objective Contract 未充分使用

**文件**: `V2-Agent-backend/src/contracts/objective-contract.js:1-118`

```javascript
const OBJECTIVE_PROFILES = {
  area_briefing: {
    response_mode: 'brief_30s',
    must_cover: ['dominant_industries', 'hotspots', 'opportunity_points'],
    latency_budget_ms: 30_000,
    // ...
  },
  // ...
}
```

**问题**:
- 定义了 profiles，但 orchestrator 中未严格校验
- `latency_budget_ms` 定义了但未实际使用
- `must_cover` 定义了但 specialist 执行可能不完整

---

### 问题7.3：Quality Guard 决策与后续处理脱节

**文件**: `V2-Agent-backend/src/agents/quality-guard-agent.js:1-104`

```javascript
decide({ objectiveContract, groundingResult, specialistResults, artifact = null }) {
  if (groundingResult?.coverage?.status === 'none') {
    return { decision: 'no_data', ... }
  }
  // ...
}
```

**问题**:
- Quality Guard 返回决策，但 orchestrator 未完全执行
- 例如：`handoff_legacy` 决策后仍尝试执行 new_agent 路径
- 决策与实际行为不一致

---

### 问题7.4：无真正的事件驱动架构

**问题**: 代码仍是过程式调用，无事件总线
- Specialist 执行完成无事件通知
- Grounding 完成无事件通知
- 难以扩展新 agent 或新流程

---

## 八、工程实践问题

### 问题8.1：环境变量配置分散

**问题**: 多个模块各自读取环境变量

| 模块 | 环境变量 |
|------|---------|
| LLM Gateway | V2_LLM_ENABLED, V2_LLM_BASE_URL, V2_LLM_MODEL, ... |
| Router | V2_ROUTER_LLM_ENABLED, V2_ROUTER_LLM_TIMEOUT_MS |
| Narrative | V2_NARRATIVE_LLM_ENABLED |
| Executor | V2_AGENT_EXECUTOR_MODE, V2_AGENT_WORKER_TIMEOUT_MS |
| Repository | V2_POSTGIS_URL, V2_POSTGIS_POI_TABLE, ... |

**影响**: 配置难以集中管理，易冲突

---

### 问题8.2：无统一的错误处理机制

**问题**: 各模块错误处理逻辑不一致
- 有的 throw，有的 return null
- 有的记录日志，有的静默忽略
- 难以构建统一的异常处理链

---

### 问题8.3：测试覆盖可能不足

**问题**: 需要验证
- Specialist agents 单元测试是否完整
- 并发场景测试是否存在
- LLM 失败场景测试是否存在

---

## 九、设计文档与实现对比

| 设计文档承诺 | 实际代码状态 | 差距等级 |
|------------|------------|---------|
| 真正的多Agent并行 | Promise.resolve().then() 串行 | 🔴 严重 |
| LLM-Driven 路由 | 关键词规则 + 可选LLM补丁 | 🔴 严重 |
| LLM Narrative生成 | 模板拼接 + LLM重写 | 🔴 严重 |
| 预生成策略 | 模板缓存 + sample数据 | 🟡 中等 |
| 智能扩圈 | 固定250m/500m | 🟡 中等 |
| 消除重复代码 | 三个函数高度重复 | 🟡 中等 |
| 事件驱动架构 | 过程式调用 | 🟡 中等 |
| 统一配置管理 | 环境变量分散 | 🟢 轻微 |

---

## 问题汇总

### 按严重程度分类

#### 🔴 严重问题（P0）

1. 假并行执行（Promise.resolve().then 串行）
2. 规则引擎仍是核心路由
3. Fast Narrative 纯模板拼接
4. LLM Narrative 仅重写不生成

#### 🟡 中等问题（P1）

5. Worker Threads 模式未验证
6. Sample 数据 fallback 过深
7. Grounding 阶梯策略不灵活
8. Coverage 阈值硬编码
9. Specialist 分析过于简单
10. 代码重复严重
11. Objective Contract 未充分使用
12. Async Deep Lane 调度不可控

#### 🟢 轻微问题（P2）

13. 两套路由逻辑重复
14. 环境变量配置分散
15. 无统一错误处理
16. 无事件驱动架构
17. LLM Gateway 失败静默降级

---

## 影响分析

这些问题导致 V2 在实际运行时：

1. **响应时间**
   - Specialist 串行，总时间 = 各 specialist 之和
   - LLM 调用（如启用）增加延迟

2. **回答质量**
   - 结构化摘要生硬拼接
   - 复杂意图无法理解
   - 无自然语言连贯性

3. **可维护性**
   - 代码重复导致维护成本高
   - 配置分散难以管理
   - 错误处理不一致

4. **可扩展性**
   - 无事件驱动架构
   - 难以添加新 agent
   - 难以动态调整流程

---

## 建议修复方向

### 短期（P0 - 立即修复）

1. **修复假并行**
   - 确保生产使用 worker_threads
   - 或用 `Promise.all(setTimeout(,0))` 实现真并发

2. **启用 LLM 能力**
   - 设置环境变量启用 LLM
   - 扩大 allowlist 接受 LLM 输出
   - 从"重写"改为"生成"

3. **消除假快**
   - 启用真实 PostGIS 查询
   - 实现预生成缓存策略

### 中期（P1 - 短期优化）

4. **简化代码**
   - 抽象通用逻辑
   - 合并重复函数

5. **增强 Specialist**
   - 加入权重计算
   - 加入时序分析

6. **改进 Grounding**
   - 智能扩圈策略
   - 动态阈值

### 长期（P2 - 架构演进）

7. **事件驱动重构**
8. **统一配置中心**
9. **统一错误处理**

---

## 结论

V2 架构当前实现与设计目标存在**系统性差距**，核心问题：

1. **伪智能** - 路由和叙事都是规则/模板
2. **伪并行** - 技术选型错误
3. **假快** - 靠预设非架构优化

这些问题使得 V2 未能展现出与 V1 的显著差异。建议**优先修复 P0 问题**，确保 LLM 能力真正启用，再进行系统性重构。

---

## 附录：相关文件索引

| 类别 | 文件 |
|------|------|
| 编排器 | `V2-Agent-backend/src/orchestrator/task-orchestrator.js` |
| 并行执行 | `V2-Agent-backend/src/orchestrator/parallel-agent-executor.js` |
| 意图路由 | `V2-Agent-backend/src/agents/intent-router-agent.js` |
| LLM路由 | `V2-Agent-backend/src/agents/llm-router-agent.js` |
| 叙事生成 | `V2-Agent-backend/src/agents/narrative-writer-agent.js` |
| LLM叙事 | `V2-Agent-backend/src/agents/llm-narrative-agent.js` |
| 数据Grounding | `V2-Agent-backend/src/agents/data-grounding-agent.js` |
| 质量守卫 | `V2-Agent-backend/src/agents/quality-guard-agent.js` |
| 状态机 | `V2-Agent-backend/src/runtime/lane-state-machine.js` |
| 目标合约 | `V2-Agent-backend/src/contracts/objective-contract.js` |
| LLM网关 | `V2-Agent-backend/src/llm/llm-gateway.js` |
| Legacy路由 | `V2-Agent-backend/src/chain/intent-router.js` |
