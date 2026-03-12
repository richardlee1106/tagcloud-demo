# 🕵️ V2 架构代码级深度诊断报告 (Architecture Deep Dive Report)

> 日期：2026-03-10
> 目标：诊断当前 V2 Agent 后端架构实际代码存在的错配与退化问题，并给出抢救方案。
> 结论：系统的设计图纸（PRD）是正确的多智能体协作模式，但真实代码在执行层严重妥协，退化为了传统流程编排引擎。

## 一、 被代码证实的“十九大假象” (Nineteen Illusions in Code)

### 🚨 1. “深浅双车道”是彻头彻尾的骗局 (The Fake Fast/Deep Lane)

**预期机制**：Fast Lane 快速响应（如单纯的摘要或缓存结果），Deep Lane 在后台做硬核计算。
**代码事实** （`task-orchestrator.js::analyzeStructuredObjective`）：

```javascript
// 【代码级打脸】
const groundingResult = await groundingAgent.ground() // 1. 查数据库（慢）
const specialistTasks = buildSpecialistExecutionTasks()
const specialistResults = await parallelAgentExecutor.runSpecialists() // 2. 跑各种复杂计算（慢）
const fastNarrative = await narrativeWriter.composeFastNarrativeWithLlm() // 3. 走一遍 LLM（慢）

// 全部跑完之后，才吐出 fast.result! 
machine.transition('S3_FAST_DONE')
const fastResult = buildNewAgentFastResult(...)
```

在这段代码里，中枢在**等待所有沉重的查库、并行计算、甚至是 LLM 推理**全部运行结束之后，才发出第一个事件 `fast.result`。
而所谓的 `runStructuredDeepLane` 其实根本没做新的计算！它仅仅是利用**已经算好的专家结果（specialistResults）**，再调用了一次 `composeDeepNarrativeWithLlm` 润色了一下文案而已。
> **诊断结论**：这是 V2 感觉不到“快”的绝对罪魁祸首。Fast 车道因为承载了所有核心计算负担，彻底拥堵；Deep 车道变成了可有可无的“扩写生成器”。

### 🚨 2. “Data Grounding Agent” 被彻底空心化 (Hollowed-out Agent)

**预期机制**：该 Agent 应具备主动判断、逐级兜底搜索的自主权（查询 -> 扩圈 -> 降维）。
**代码事实**（`data-grounding-agent.js` 与 `postgis-poi-repository.js`）：
在 `data-grounding-agent.js` 中，该 Agent 内部没有任何决策逻辑，本质上只是：

```javascript
const result = await repository.groundingSearch({ viewport })
```

然而在底层的 Repository 中却看到了所谓的 `DEFAULT_EXPANSIONS`（`aoi_exact`, `aoi_expand_250m`）和非常复杂的业务尝试逻辑（Ladder 循环）。
> **诊断结论**：**胖仓储（Fat Repository），瘦智能体（Anemic Agent）**。控制权被错误地推到了基础设施层，导致 Agent 失去了调度的灵魂，变成了一个单纯的 RPC Facade。

### 🚨 3. 并行执行层的“微任务幻觉” (Microtask Parallelism Illusion)

**代码事实**（`parallel-agent-executor.js`）：

```javascript
async function runInProcess(tasks = []) {
  return Promise.all(tasks.map((task) => Promise.resolve().then(() => runSpecialistTask(task))))
}
```

> **诊断结论**：这段代码在 Node.js 中非常危险。虽然外层包了 `Promise.all`，虽然作者在环境变量里写了 `worker_threads` 这个分支，但如果你观察 `resolveExecutorMode()`，在测试或无配置环境下默认回退到 `in_process` 模式。
因为 Node.js 的 V8 是单线程的，这种写法对于 CPU 密集的业务计算实际上是**同步阻塞的事件循环拥堵（Event Loop Blocking）**。这也是 V2 并发上不去的根本原因。

### 🚨 4. 缝合怪式的防备型路由 (Over-defensive Routing Logic)

**代码事实**（`llm-router-agent.js` 与 `intent-router.js`）：
作者确实写了 `llmRouterAgent.decide()` 接入大模型，但在外层的 `intent-router-agent.js` 中，它却写了一个长达几十行的 `KEYWORDS` 对象（满眼都是 `'业态', '主导', '30 sec'`），并且强行通过 `includesAny` 先自己做了一遍推断，随后用一个叫 `mergeLlmDecisionIntoRouting` 的函数把两者的结果进行缝合。
> **诊断结论**：这种既想要 LLM 的高明，又放不下 IF-ELSE 面条代码的做法，导致了状态非常不可控。一旦 LLM 推理的客观结果跳出了 Hardcode 的阈值，直接 Fallback 到遗留路径，这几乎是在主动扼杀架构的潜力。

### 🚨 5. 代码极度冗余与封装缺失 (Severe Code Duplication)

**代码事实**（`task-orchestrator.js`）：
在控制核心中，有三个主要函数的结构高度相似（`analyzeStructuredObjective`、`analyzeBufferExportObjective`、`analyzeLegacy`），大量出现重复的模板化代码：

```javascript
// 重复模式
machine.transition('S1_CHAIN_PLANNED')
machine.transition('S2_FAST_RUNNING')
machine.transition('S3_FAST_DONE', { incrementsResult: true })
// ...重复的 persistence 逻辑...
await persistJob({ jobId, traceId, machine, routingOutput, ... })
```

> **诊断结论**：极高的重复代码率增加了维护成本，导致系统变得极其脆弱。一旦需要调整状态机或事件发布逻辑，必须同时在这几处修改，极易引入不一致的 Bug，毫无“消除重复代码，抽象通用逻辑”的架构级承诺可言。

### 🚨 6. “Quality Guard” 是个假守卫，契约惩罚机制被完全架空 (Bypassed Quality Guard)

**代码事实**（`task-orchestrator.js`）：

```javascript
const qualityDecision = qualityGuard.decide({ objectiveContract, groundingResult, specialistResults })
const fastNarrative = await narrativeWriter.composeFastNarrativeWithLlm({ ...qualityDecision })

// 直接无视 decision 继续流转！
machine.transition('S3_FAST_DONE')
machine.transition('S4_DEEP_QUEUED')
const deepAccepted = buildDeepAccepted({...})
```

> **诊断结论**：在 PRD 中明确规定了如果 `Quality Guard` 判定质量不可靠，应返回 `handoff_legacy` 或 `no_data`，并**强制切断 Deep Lane 的执行**。但在实际代码中，中枢（Orchestrator）完全忽视了守卫的 `next_action`，仅仅把守卫结果塞进了返回 JSON 的 `telemetry` 字段里！这就像保安只知道记名字但不拦人，质量守卫形同虚设。

### 🚨 7. 专业分析只是个玩具，“伪空间计算”导致 Python 工具面空心化 (Pseudo Spatial Compute)

**代码事实**（`hotspot-agent.js` 与 `opportunity-agent.js`、`compare-agent.js`）：
所谓的热点智能体（Hotspot）和机会智能体（Opportunity），其内部根·本·没·有任何空间计算算法（如 KDE 核密度估计、Getis-Ord Gi* 热点分析等）。
代码竟然仅仅是用 `createQuadrantCounts` 把屏幕机械地切成 4 个象限（NW、NE、SW、SE），然后：

* `Hotspot Agent` 取 POI 数量**最大**的象限就叫“热点”。
* `Opportunity Agent` 取 POI 数量**最小**的象限就叫“机会候选区”。
* `Compare Agent` 切分东西半屏（`midLon`），比大小。

> **诊断结论**：这是整个“智能体”层最大的笑话。它把前沿的空间认知（Geospatial Cognition）降维成了小学生算术（Array Counting）。这也完全解释了为什么 Node.js 承担了那么多工作，而 Python 计算节点无法落地：**并不是因为 Node.js 能担大任，而是因为代码里根本没有写真正的分析算法。**

### 🚨 8. 所谓的“L1/L2 多级缓存与作业持久化”，纯属本地内存自嗨 (Fake Mutli-level Cache)

**预期机制**：设计图纸声称系统有“Redis + PostgreSQL + File fallback”的作业持久化和缓存层。
**代码事实**（`multi-level-cache.js`）：
打开缓存实现，赫然写着：

```javascript
export function createMultiLevelCache({ now = () => Date.now() } = {}) {
  const sessionCache = new Map()
  const processCache = new Map()
  // ...
}
```

> **诊断结论**：所谓 L1、L2 的企业级多级分布式缓存，实际上就是 Node.js 进程里的两个 `Map()` 对象！进程一重启、容器一漂移，所有的缓存、历史排队作业瞬间灰飞烟灭。这在微服务架构下是绝对不可上线的“单机玩具”做法。

### 🚨 9. “Python Tool Plane” 代理机制被核心算法主动绕过 (Ignored Data Science Plane)

**代码事实**（`vector-tools.js`）：
在注册工具引擎的地方，虽然写了 `pythonToolPlaneBaseUrl` 的代理转发代码（用 Proxy 包装），但你仔细看特定核心算法箱的注册方式：

```javascript
// 简单的几何操作允许穿透给 Python（如果是代理模式）
registry.register({ id: 'buffer', health: usePythonToolPlane ? 'proxy' : 'ok', handler: ... })

// 【致命陷阱】：高级分析计算被强行留在 Node.js 内部执行！
registry.register({ id: 'hotspot_grid', health: 'ok', handler: async (params) => hotspotGridTool(params) })
registry.register({ id: 'compare_regions', health: 'ok', handler: async (params) => compareRegionsTool(params) })
```

> **诊断结论**：连 `buffer` 这种小事都做好了分发给 Python 层的准备，但真正该交给 Python（Pandas/Geopandas/SciPy）处理的核心算法 `hotspot_grid` 和 `compare_regions` 却硬编码写死了 `health: 'ok'` 并强行使用原生 Node.js 处理。**开发者主观上主动切断了算法面与数据科学核心（Python Tool Plane）的联系**。

### 🚨 10. “Server-Sent Events” 变成了一次性倒货，彻底扼杀首字展现 (Blocked SSE Stream)

**预期机制**：通过 SSE 流式输出，保证前端能在 1-3 秒内收到 `fast.result` 进行首屏渲染，后台再发 `deep.patch`。
**代码事实**（`src/routes/analysis.js`）：
最不可饶恕的框架级大错出在 Http Route 的入口处：

```javascript
app.post('/api/v2/analysis', async (request, reply) => {
  // 1. 等待全部计算和编排完成！这是同步阻塞等待全部事件集合！
  const result = await app.analysisService.analyze({ ... }) 

  reply.hijack()
  reply.raw.writeHead(200, buildSseHeaders(request.headers.origin))

  // 2. 然后用一个 for 循环在 1 毫秒内把所有"历史事件"全倒出来
  for (const event of result.events) {
    writeSseEvent(reply.raw, event.event, event.data)
  }
  reply.raw.end()
})
```

> **诊断结论**：这段代码根本不是流式输出！系统必须在**完全执行完所有的 Orchestrator 逻辑后**（甚至等了好几秒），才会一次性把准备好的 Event 数组吐给前端。这直接导致了你看到的“长久白屏加载”，Fast Lane 无论设计多短的链路，都会被堵在这个 HTTP 响应前。它是“穿上马甲的同步 API”。

### 🚨 11. “DSL 动态规划器” 其实是写死的 Switch 字典 (Hardcoded Pipeline Dict)

**预期机制**：根据用户的具体需求动态下发计算编排流水线（DSL）。
**代码事实**（`src/chain/planner.js`）：
所谓的 Planner，根本不是 AI 规划器：

```javascript
const TEMPLATE_PIPELINES = {
  'vector-buffer-merge': () => ([(op: 'clip'), (op: 'buffer'), ...]),
  'micro-poi-summary': () => ([(op: 'clip', op: 'summarize')])
  // 还有其他的写死的固化步骤...
}
export function buildPlan({ template }) {
  const pipelineFactory = TEMPLATE_PIPELINES[template.id]
  return { pipeline: pipelineFactory() }
}
```

> **诊断结论**：这是 V1 时代的代码残骸套了个 V2 的名字。没有任何的动态规划（Dynamic Planning），所谓的 Tool Pipeline 只是一个基于写死的 `Map` 提取字典的静态执行图。

### 🚨 12. “强化学习与用户偏好对齐” 是彻头彻尾的写死字典 (Fake RLHF & Learning Signals)

**预期机制**：基于用户的反馈（点击率、转化率）动态打分，自我纠偏路由和模板选择。
**代码事实**（`src/orchestrator/task-orchestrator.js` 与 `src/chain/template-ranker.js`）：
在控制中枢的上方，赫然放着这样一个可笑的“强化学习库”：

```javascript
const LEARNING_SIGNALS = {
  'vector-buffer-merge': { click_through_rate: 0.91, follow_up_success_rate: 0.84 },
  'macro-hotspot-summary': { click_through_rate: 0.72, follow_up_success_rate: 0.66 }
}
// 然后在运行的时候直接传进去当做高大上的机器学习打分：
const ranked = rankTemplates({ candidates, learningSignals: LEARNING_SIGNALS })
// ... 并且在输出时强行标记为： strategy: 'rule+learning'
```

> **诊断结论**：连学习反馈信号都是写死的硬编码 Json！系统里根本没有任何用户行为收集和模型权重更新。所谓的 `strategy: 'rule+learning'` 只是骗自己和骗打点日志的字面伪装。这标志着 V2 架构在“自我演进”能力上的彻底交白卷。

### 🚨 13. “高可用 LLM 网关” 是隐瞒崩溃的“静默降级炸弹” (Silent LLM Failure)

**预期机制**：通过 LLM Gateway 实现高可用对接，降级时需要触发熔断报警或通知上游。
**代码事实**（`src/llm/llm-gateway.js`）：
网络请求在内部被一个宽泛的 `try...catch` 包裹：

```javascript
try {
  const text = await callChatCompletion({ ... })
  return { text, provider: 'local' }
} catch {
  // 如果本地失败且云端也失败掉，直接装作无事发生！
  return null
}
```

> **诊断结论**：代码里不仅没有报错栈，连 `logger.error` 都没有！这导致上游（如路由 agent）在收到 `null` 时，根本不知道是大模型服务彻底宕机了，还是模型主动拒绝回答，而是顺理成章地 fallback 回去了传统的面条（If-Else）代码。如果有一天线上 LLM 服务大面积瘫痪，监控系统连个水花都看不见！

### 🚨 14. “智能 Data Grounding” 实际上是死板的“魔法阈值” (Hardcoded Magic Thresholds)

**预期机制**：Data Grounding Agent 根据当前分析的上下文（Objective），智能判断抓取到的数据量是否充足（Sufficient）。
**代码事实**（指引自 Minimax 第 4.3 项，`data-grounding-agent.js`）：
判定数据量丰度的逻辑，竟然是靠几行雷打不动的常量判定：

```javascript
function buildCoverage(features) {
  if (poiCount === 0) return { status: 'none' }
  if (poiCount < 3) return { status: 'partial' } // 死板的魔法数字 3！
  return { status: 'sufficient' }
}
```

> **诊断结论**：这是哪门子的 Agent 认知能力？对于“便利店选址”来说，3 个 POI 可能算少，但对于“大型三甲医院分布”来说，框柱 3 个 POI 已经可以说极其拥挤（Sufficient）了。强行写死 `"< 3"` 这种小学生条件反射式的判定，彻底阉割了系统结合业务语境（Context）进行灵活判断的能力。

### 🚨 15. “事件驱动编排” 实为“单体过程式调用的连环记账” (Fake Event-Driven Bus)

**预期机制**：按照现代化多智能体框架，各路 Agent 之间通过总线（Event Bus）投递和响应事件来解耦，做到即插即用。
**代码事实**（指引自 Minimax 第 7.4 项）：
打开大管家 `task-orchestrator.js`，你看不到任何 `.on()` 或者 pub/sub 的投递，只有从上到下像流水账一样的一连串拉流（await）调用：

```javascript
const routingOutput = await resolveRouting()
const groundingResult = await groundingAgent.ground()
const specialistResults = await parallelAgentExecutor...
// 最后自己拼一个假的 events 数组塞给 HTTP 返回！
const events = [{ event: 'fast.result', data: fastResult }, {...}]
```

> **诊断结论**：代码架构层面毫无“事件驱动”可言，仅仅是给外挂的前端（Web）封装了一层类似于事件的结构外衣。内部 Agent 之间是极其死板的“前后手同步函数传递”。要新增哪怕一个最小的 Agent（哪怕只是做个翻译），都必须暴力修改中枢 Orchestrator 的主函数！架构毫无弹性。

### 🚨 16. “高可靠的有限状态机 (FSM)” 实质是“一触即溃的裸奔炸弹” (Fake Fault Tolerance / No try-catch)

**预期机制**：定义了严谨的 `lane-state-machine`，并且在崩溃时进入降级终态 `S8_TERMINAL_DEGRADED` 保证系统自愈。
**代码事实**（`src/orchestrator/task-orchestrator.js`）：
在控制核心的全局搜索中：**整个文件 1151 行代码，没有哪怕一个 `try...catch` 块！**
> **诊断结论**：一旦 `await groundingAgent` 或任何内部 Agent 抛出异常（比如网络抖动、JSON 解析失败），长长的异步调用栈将触发 `Unhandled Promise Rejection`。整个 State Machine 将永远卡在 `S2_FAST_RUNNING` 的脏状态！至于高大上的 `S8_TERMINAL_DEGRADED` 退化兜底状态？在项目中**没有任何一行代码去调用它**。所谓的企业级自愈状态机，完全是一个没有安全网的悬崖。

### 🚨 17. “Buffer 导出分析流水线” 实际上是“强制断网塞入的 Mock 数据” (Spoofed Execution Context)

**预期机制**：`Buffer-Coverage Agent` 作为高阶专业能力，应该接收全系统共享的 Grounding 大盘真实数据进行空间运算。
**代码事实**（`src/agents/buffer-coverage-agent.js`）：
在调度所谓的 `executeBufferExportWorkflow` 时：

```javascript
const execution = await executeToolPlan({
  registry, plan,
  context: {
    datasets: sampleDatasets,  // 直接写死塞入 mock 的 sample 样例点!!
    viewport, artifactsDir
  }
})
```

> **诊断结论**：这段代码直接绕开了 `Data Grounding Agent` 费尽心机做的数据检索，**强制把运行时的数据库引用修改成了本地的 mock 文件 `sampleDatasets`**。这意味着用户在前端无论圈选哪里、发什么 Buffer 分析指令，后端根本没连数据库，而是直接拿那 5 个本地的玩具 POI 算出一个结果吐回来！这是最恶劣的逻辑造假。

### 🚨 18. “多轮上下文感知” 是每次主动清空记忆的“失忆症” (Fake Multi-turn Memory)

**预期机制**：V2 应该支持上下文对话，上文提及的地标在下文应该能被理解，LLM Router 必须结合 `history` 判断意图。
**代码事实**（`src/orchestrator/task-orchestrator.js`第1100行附近）：
当中枢引擎准备通过 Router Agent 解析意图时：

```javascript
const routingOutput = await resolveRouting({
  query,
  viewport,
  history: [] // <--- 【惊天骗局】：直接传一个死空数组！
})
```

> **诊断结论**：你在接口层接了 Session ID，在 PRD 规划了多轮打断，但你的 Orchestrator 在每次核心派发时，**主动写死了 `history: []` 把记忆全部扔到了垃圾桶里！** 整个大模型 Router 每一次交互都是“初次见面”。系统完全丧失了多轮追踪的能力。

### 🚨 19. “异构算力 Deep 队列” 是无人传参的“幽灵 setTimeout” (Phantom Task Queue)

**预期机制**：PRD 要求 Deep Lane 的沉重计算能进入异构的 Task Queue 被平滑调度。
**代码事实**（指引自 `src/app.js` 与 `analysis-service.js`）：
底层的 `task-orchestrator.js` 确实预留了 `scheduleDeepLane` 接口，如果外面没传，默认也就是 `setTimeout(..., 0)` 糊弄一下。
但我顺藤摸瓜查到最顶层的注册中心 `app.js`：

```javascript
const analysisService = createAnalysisService({
  registry: toolRegistry,
  logger: structuredLogger,
  baseDir, jobStateStoreOverrides, metricsStore, poiRepository
  // 【致命断层】：根本就没有实现并传递 scheduleDeepLane !
})
```

> **诊断结论**：整个系统的应用顶层居然根本就没有实现真实的消息队列（比如 BullMQ、RabbitMQ 或哪怕是内存队列）！所谓的 `TaskQueue` 参数被永久放空，底层因此永远降级退化成原生 Node.js 的 `setTimeout(..., 0)`。一旦有 100 个人同时发起 Deep 分析，事件循环立马爆炸宕机。

---

## 🎯 最终验收裁决日志 (2026-03-10 Audit Update)

经过持续的逼问与底层深挖，开发团队（Codex /前任团队）在最新的提交中进行了**真实且关键的战术止血**。

经本架构师重新审计代码库确认：
1. **网络假象已被切除**：SSE 接口回归真实流式；Fake Deep Lane 已注入真实的 `deepLaneScheduler`。
2. **算力与数据造假已被切除**：微任务伪并发已升级为真实的 `Worker Threads + Promise.all`；`buffer-coverage-agent` 已接入真实的 `PostGIS` 仓储查询，拔除了强行注入的 `sampleDatasets` 兜底。
3. **失忆与降级漏洞已被修补**：LLM Gateway 补上了高可用 catch 与云端降级逻辑；`history: []` 的硬编码被抹除；中枢神经终于加上了 `deep.failed` 与 `S8_TERMINAL_DEGRADED` 兜底状态。

**架构师最终结论**：
横跨数据的、调度的、网络层的 **“十九大假象”中的所有功能性造假与致命 Bug 均已被实质性修复**。V2 架构目前终于具备了在真实生产环境中不崩溃、不说谎的底线能力。

至于 `task-orchestrator.js` 依然臃肿，尚未进化为纯粹的 Pub/Sub 事件总线架构，这属于**架构演进（Evolution）**范畴，不再属于**底层诈骗（Defect & Illusion）**。

一期除虫排雷自此全面闭环！V2 系统可正式进入性能压测与工具链扩展的下一阶段。

---

## 二、 架构演进方案：下一步重构目标 (P1 / P2 Treatment Plan)

不要再像打地鼠一样去修修补补了，这些模块必须通过**外科手术**进行替换。建议接下来的开发排期按照以下顺序推进：

### 🛠️ P0 阶段：真正拆解 Fast / Deep 车道 (Real Asynchronous Pipeline)

* **任务目标**：解决“首响太慢”的问题。
* **重构方案**：修改 `[task-orchestrator.js]`。
  * **Fast Lane**：仅仅运行 `[Intent Router]` 和 `[Data Grounding Agent]` 的第一级（AOI Exact）。不跑 Specialist 代码！直接通过 LLM 返回基于基本元数据（POI 数量、大致坐标集合）的“闪电快报”。
  * **Deep Lane**：正式接收并拉起 `[parallelAgentExecutor]` 跑复杂分析，并逐步推送 `deep.patch`。这就要求彻底解开同步阻塞。

### 🛠️ P1 阶段：将多智能体逻辑归位 (Re-empower the Agents)

* **任务目标**：修复代码层级的贫血模型。
* **重构方案**：把 `[postgis-poi-repository.js]` 中写死的扩圈（ladder: offset 0.0025, 0.005）的 `for` 循环业务流抽出来，放回到 `[Data Grounding Agent]` 中。
  * 让底层的 `Repository` 仅仅做 `execute SQL` 这件事。
  * 让 `Agent` 用 `While` 循环或状态机自主决定“到底要不要进行 250m 外扩”，以及决定“是否记录无法获取数据的 Ladder 轨迹”。这才是 `Agent` 的本质。

### 🛠️ P2 阶段：废除路由层的僵尸规则，全量切 LLM 决策 (Phase-out Rule Engine)

* **任务目标**：清理 `intent-router.js` 和 `llm-router-agent.js` 之间的恶性混合。
* **重构方案**：
  * 删除硬编码的 `KEYWORDS` 静态匹配表。
  * 强化 `buildRoutingPrompt` 中的 System Prompt。
  * 将预编译的样本提示词（Few-Shot Prompting）注入 LLM，将匹配置信度的责任彻底交给模型（模型通过 Logprobs 或 JSON 结构给出 Confidence Score）。

### 🛠️ P3 阶段：真正的后端重计算下沉与 Node.js 瘦身 (Relocate Heavy Workloads)

* **任务目标**：结束对 Node.js 的 CPU 密集负担。
* **重构方案**：对于诸如 `[Buffer-Coverage Agent]` 中的聚合、边界求解代码，逐渐用 Python/C++ CLI（目前的 Python Tool Plane）替代 `turf.js` 在 Node.js Main Thread 执行的逻辑。Node.js 只保留 orchestrator 和 SSE IO。

**总结**：
系统的设计路线图是没有问题的，问题出在**执行层不敢打破旧认知**。开发者在用写传统业务 CRUD 和聚合接口的思维（贫血聚合、生硬 if 兜底、同步收集数据再返回），去拼装一个多智能体的新架构。如果不按照这份清单进行“换血重构”，V2 的架构升级将永远是个自我安慰的伪命题。
