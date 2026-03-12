# 2026-03-05 V2 空间智能体 + WebGIS 实施规格书（AI完全实施蓝图・机器单源真相版）

## 开篇导向（创建意图与预期结果）

- **创建意图**：构建一套与 V1 完全独立、彻底 AI-Native 的 Spatial Agent + WebGIS 架构，用“确定性 Chain + 不确定性 Agent + 真实 GIS 工具执行”替代现有的臃肿慢链路与黑盒式文本推理，实现极简、高效、可控的空间智能。
- **最终预期结果**：交付一个可持续迭代的 V2 工程体系，满足 Fast Lane `P95 <= 10s`、Deep Lane 可持久化补全、全链路可解释、可观测、可回放、可自动诊断，最终能在科研级严谨度上实现“固定输入必然产生可重现的空间计算证据”。
- **方向硬约束（不可妥协的铁律）**：
  - V2 **绝对禁止**沿用 V1 的“默认调用模糊边界工具”逻辑；仅当 DSL 明确声明所需能力且安全检查通过时，才允许调用物理算子。
  - V2 采用纯 GIS Agent 思想：按业务语义与拓扑限制动态组装执行流计算图，而非死板的单线流水线。
  - LLM **仅限于**“意图理解 + DSL 翻译 + 行动策略规划 + 结果叙述”，**严禁**大模型直接生成 SQL/代码并在生产环境中不经安全沙箱和 schema 检查直接执行。
  - 首批基础能力域工具包限定为：`clip`（裁剪）、`buffer`（缓冲区）、`merge`（合并）。
  - 执行引擎必须进行“多策略降级”：若空间分析计算失败，必须返回可用的降级中间几何成果或简报，绝不允许返回笼统的 `500 Server Error`。
  - “当前区域”语义解析具有强优先序：显式绘制的 AOI > 地图视窗 (Viewport) > 地名提取边界。
  - 输出规范必须包含**数据血缘（Data Lineage）**：包括输入源版本、算子流水线、执行耗时、核心参数、置信度等，使得输出对人类或评估模型均“可验算”。
  - 机器优先的诊断体系：所有的错误日志打包为 JSON 格式的 `Incident Bundle`，交由专用诊断 Agent 解析并提供代码修复与调参建议。

## 0. 使用说明（给未来 AI 会话与执行宿主）

### 0.1 文档定位

- 本文档是 V2 系统的**单一事实来源（Single Source of Truth, SSOT）**，包含架构约束、包管理规定、执行策略和实施步骤。
- **用途**：在全新的 AI 会话窗口中，赋予 AI 完整的上下文和实施路径指引，确保它不会随意发挥或引入无用、臃肿的第三方概念（如 LangChain/Dify）。
- **要求**：执行时强制与 V1 源码保持物理与逻辑隔离。所有的架构落步必须通过指定的门禁测试（Gate Checks）。

### 0.2 零上下文“一键回车”启动指令（请拷贝至新会话）

```text
[SYSTEM: STRICT EXECUTION MODE INITIATED]
你现在是 V2 空间智能体架构的首席 AI 工程师。请全面读取《2026-03-05 V2 空间智能体 + WebGIS 实施规格书（AI完全实施蓝图）》。

执行纪律声明：
1) 工程限制：基于 pnpm worker + uv 构建多语言 monorepo。禁用 Dify/LangChain，LLM 调用强制使用 Vercel AI SDK (TS) 或 Instructor (Py)。
2) 质量门禁：所有生成的 JSON、YAML、API 必须自带 Schema 并生成对应 Zod/Pydantic 校验代码。
3) 自驱推进（Self-Driven）：**赋予你自驱执行与校验权限**。请主动按照 P0 到 P4 的阶段顺序执行。每个 Phase 代码编写完成后，你必须主动调用命令行（CLI）运行对应的门禁验证脚本。若输出成功（绿灯），无需等待我的人工确认，请自动开始下一个 Phase；若测试失败（红灯），请自行检视日志、修复代码并重试，直至通过。

现在，请回答：“我已经清楚了解 V2 目标与约束，正式启动自驱执行模式。立刻开始 P0（契约与包管理环境初始化）的搭建。” —— 并立即主动输出目录结构并开始实施。
```

---

## 1. 基础设施与核心技术栈规范（严管盲区）

为防止 AI 执行过程中自作主张乱配环境，进行以下强制工程包与框架绑定。

### 1.1 包管理与工程结构组织 (Monorepo)

- **物理工程强隔离（防污染）**：**必须**在现成的独立目录 `V2-Agent-backend/` 中进行开发。要求采用**彻底的物理目录隔离**，绝不允许直接在当前 V1 的代码里仅仅通过添加一个路由前缀（逻辑隔离）来混编。
- **前端与控制面（TypeScript 侧）**：
  - 包管理：必须使用 **`pnpm`**。
  - Monorepo 体系：推荐使用 **`Turborepo`**。
  - HTTP 框架：统一使用 **`Fastify`**（禁止用冗重的 Express 或 NestJS 以保证性能极简）。
  - 核心类型校验：强制使用 **`Zod`** 并导出为公用的 JSON Schema。
- **工具与科学计算面（Python 侧）**：
  - 包管理：强制使用 **`uv`** 或 **`Poetry`**，管理 `pyproject.toml`。
  - HTTP 与工具路由：统一使用 **`FastAPI`**。
  - 类型与校验约束：强制使用 **`Pydantic V2`**。

### 1.2 LLM 交互与大模型基建层限制

- **禁用臃肿框架**：生产核心执行链路 **严禁** 依赖 LangChain、LlamaIndex 或 Dify 作为编排层。
- **可接受的 LLM 客户端/路由**：
  - TS 侧：使用原生官方 SDK 或轻量级的 **`Vercel AI SDK`**（利用其 `generateObject` / `streamObject` 完成 JSON 提取与工具调用规划）。
  - PY 侧：只允许使用 **`Instructor`** 配合 Pydantic 来实现确定性结构化提取，或官方 OpenAI/Anthropic SDK。
- **速率限制与熔断降级 (Rate Limiting & Fallback)**：
  - LLM 客户端必须实现 `Circuit Breaker` 模式。当首选大模型超时 (>5s) 或过载，必须平滑切至备用低延迟模型（如：GPT-4o 熔断 -> 切换至 GPT-4o-mini 或 Claude-3.5-haiku 继续执行）。

### 1.3 Prompt (提示词) 生命周期与隔离

- **Prompt As Code (防污染)**：绝对禁止将大模型提示词长文本硬编码散落在庞杂的业务 JS/PY 代码里。
- **实施标准**：所有 prompt 必须存在一个独立的配置文件或系统目录（如 `packages/policy-kernel/prompts`），与模型版本号及期望输出的 DSL Schema 版本绑定。支持在独立控制台热重载与回放调优。

### 1.4 分布式锁与并发边界边界

- **并发控制问题防范**：Deep Lane 的补全状态机在并发操作共享的 `trace_id` 时可能发生条件竞争。
- **强制使用**：分布式状态的读写修改，必须并且仅能通过 **Redis Redlock** 策略或者将状态变更封装在原子级的 **Redis Lua 脚本** 内向。绝对禁止在未加锁的情况下先 GET 状态，内存修改后再 SET。

### 1.5 租户上下文与数据墙透传（Tenancy & Security）

- **上下文传播**：`API-Gateway` 收到的请求必须提取 `user_id` / `session_id` / `role`，统一封装进不可变上下文对象 (`RequestContext`) 并携带这层鉴权令牌 (`Bearer` 或 `jwt`) 一路传递到内部的 Python 工具面。
- 绝不允许任何脱离用户隔离机制执行的无限制全局 GIS 操作。

---

## 2. 工具能力层定义与 DSL 控制

### 2.1 Chain / Agent 双重边界

| 维度 | Chain（控制面：确定性流） | Agent（执行面：动态性探索） |
|---|---|---|
| 执行者 | TypeScript Fastify 微服务 | TypeScript Runtime 协调 Python 算子 |
| 主要职责 | 意图拆解、拦截高危行为、编译生成 DSL 预处理图 (Plan Graph) | 基于 DSL 限制圈定物理工具链列表，在有限预算内穷举和规划调用图，监控节点状态 |
| 边界限制 | 不能直接发起网络请求调用物理 GIS 服务，不能读写磁盘 | 严禁 Agent 脱离已编译完毕的 DSL Plan Graph 去“自发拓展”原意图中不存在的目标 |
| 失败模式 | Schema Check 失败立刻阻断或使用低频模板降级 | 计算节点超时则触发重试；重试耗尽触发局部节点算子降维（不再尝试高精度提取，采用粗颗粒度返回） |

### 2.2 核心 DSL 正式规范抽象 (v0 演示)

让整个智能体“说话算话”的基石是强类型 DSL 结构体：

```json
{
  "dsl_version": "dsl.v0.1",
  "trace_id": "tx_fa33bc88",
  "intent_type": "spatial_ops_chain",
  "auth_context": {"user_idx": "u_99181", "scopes": ["gis:read"]},
  "scope": {
    "aoi_source": "viewport",
    "crs": "EPSG:4326"
  },
  "pipeline": [
    {"op": "clip", "args": {"source_layer": "poi_dataset", "mask_type": "current_aoi"}},
    {"op": "buffer", "args": {"distance": 50, "unit": "m", "resolution": "medium"}},
    {"op": "merge", "args": {"dissolve": true}}
  ],
  "constraints": {
    "deadline_ms": 10000,
    "max_retries": 1,
    "lane_target": "fast"
  }
}
```

---

## 3. Tool Registry 与算子服务规范 (Python 侧)

为杜绝黑盒工具和无架构扩建，必须遵守接入法则。

### 3.1 强制的 Tool Descriptor 结构

每个接入进图谱的工具必须有严格的物理签名约束。

```json
{
  "tool_id": "boundary.buffer_op.standard",
  "version": "1.0.0",
  "capability": ["buffer_generation", "proximity"],
  "input_schema_ref": "schema://tools/boundary.buffer/input/v1",
  "output_schema_ref": "schema://tools/boundary.buffer/output/v1",
  "timeout_ms_default": 2000,
  "timeout_ms_max": 5000,
  "idempotent": true,
  "side_effect": "none",
  "sla_tier": "T2" // 表示如果耗尽直接退役抛弃即可
}
```

### 3.2 级联代码范式：任何新算子的目录形态必须长这样

```text
tools/boundary/buffer_op/standard-v1/
  ├── tool.yaml             # Descriptor 描述
  ├── schemas/
  │   ├── input.v1.json
  │   └── output.v1.json
  ├── handler.py            # GIS 计算核心逻辑所在
  ├── adapter.py            # 与外层 gRPC 或 API 通信的包装
  └── tests/                # [强制要素] 必须包含 happy_path 以及极端异常边界检验代码
```

---

## 4. 双通道状态机与异步补全设计

### 4.1 严谨的状态流转管道

利用 Redis 管理 Trace 生命周期的流转：

- `S0_RECEIVED` → `S1_CHAIN_PLANNED`
- Fast 取向：`S1` → `S2_FAST_RUNNING` → `S3_FAST_DONE`
- Deep 取向：如果 `S2` 超时即刻截断 -> 落库返回中间成果给前台，自动转入后台 `S4_DEEP_QUEUED`
- Deep 运行态：`S5_DEEP_RUNNING` → `S6_DEEP_PARTIAL` (多批次回传前台 SSE 缝合补丁) → `S7_DEEP_DONE`
- 全局降级兜底：`S8_TERMINAL_DEGRADED` (当两次重试并降速仍然报错时触及)

### 4.2 前端对齐一致性与冲突阻断

- SSE/WS 增量返回，每次抛回事件携带 `result_version_id`。
- 如果前端已经持有 `result_version_id=5` 的数据视图，即使迟到了一个 `version=4` 的 SSE 补丁，也坚决阻断不覆盖，实现“数据展示永远单调向前”。
- Plan Graph 被规划如果出现”循环依赖回路”（环图），后台必须主动击穿报错拒绝并记录为设计 Bug 进行后续调试，严防服务死循环引发的 CPU 100%。

---

## 5. 预算调峰与分级限流系统

### 5.1 强制时间预算控制

- **Fast Lane（10 秒死线）**：
  - 0s - 1.2s：大模型意图拆解 + DSL组装
  - 1.2s - 3.2s：知识 Context 检索（如果需要）
  - 3.2s - 8.0s：物理 Tool GIS 逻辑执行（预留约5秒纯计算时间）
  - 8.0s - 9.5s：合成校验、叙述者渲染文本
  - 9.5s - 10.0s：兜底容错缓冲地带。
  - **到达 10s 如果未决，强制输出已算完的半成品或者安全提醒并静默转到 Deep Lane。**

### 5.2 L1/L2/L3 全局多级防脏缓存

缓存主键公式（严格隔离脏读）：
`cache_key = hash( dsl_ast_normalized_string + data_version_hash + tool_version + request_user_context )`
确保工具逻辑更新、地图源数据变化、甚至是相同语意更换了用户都能强制击穿，返回独有结果。

---

## 6. 机器优先诊断 (AI-Operated Diagnostics)

不再用 `console.log("here")`。全链条采用结构化机器日志，旨在产生一个可让未来的 AI 独立修复 Bug 的工作环境。

- 只有触发了 `Error` 或者性能退化 `ttfb > 12s`。整个 Trace 会将所有关联组件打印的上下文合称为一个大离线的 `span_trace_bundle.json`。
- 该 Bundle 被放置在硬盘目录：`observability/incidents/open/YYYY-MM-DD/<trace_id>.json`
- 未来的离线纠错 AI 可以直接读取该目录，精准分析并产出代码重构方案。

---

## 7. AI 工程师分阶段落地工作台（执行指南）

所有构建必须通过**红绿灯机制流转**：红灯代表门禁失败需重构，绿灯才能进行下一个 Phase 构建。

### 阶段 0：工程起底与契约基石 (P0)

- **目标：** 初始化物理隔离的 `V2-Agent-backend/`，配置带有 `pnpm` (TS) 和 `uv` (Py) 的正确 Monorepo。输出完整可校验的 System Prompt，DSL Context，Tools Envelope JSON Schema。
- **系统变量规范**：必须产出 `.env.example`，强制包含以下基础运行的必填字段清单：`LLM_API_KEY`、`REDIS_URL`、`PG_VECTOR_URI`、`GATEWAY_PORT`、`PYTHON_SERVICE_PORT`、`JWT_SECRET`。
- **实施指令：** “AI，请在指定的新建工作区生成所有的 Schema `.json` 文件、`.env.example` 和最外层包管理文件，并建立核心模块的目录存根，禁止写业务代码。”
- **门禁验证：**主动运行 `pnpm install`（预期终端输出 `Done...`，且无严重 peer dependecy 报错）和 `uv sync`（预期输出 `Resolved xxx packages...` 成功锁定环境）。主动编写一个简单的测试载入 `.env.example` 检验变量完备性。

### 阶段 1：Fast Lane 快速骨架搭建 (P1)

- **目标：** 在不用复杂大模型的情形下，串通 API-Gateway -> 编排引擎 -> 路由转发 -> Tools 假数据 -> 组装返回。
- **实施指令：** “AI，请通过 `Fastify` 和 `FastAPI` 实现刚才约定的骨架，并硬编码一个假 DSL 验证两端通信。配置 Redis 接入控制状态流转框架。跑通时限在 1s 以内的快速反馈。验证链路安全闭环无死锁。”

### 阶段 2：智核植入与工具接入 (P2)

- **目标：** 使用 `Vercel AI SDK`/`Instructor` 真实植入提示字，进行 DSL 与人话语义间的编解码。实现首批工具（Clip/Buffer）。
- **实施指令：** “现在接入真实的 LLM 算力池。解析真实字符串 -> 发出真实的 Buffer 求值（利用 Python `shapely` 或 `geopandas`） -> 获得合法 `GeoJSON` -> 使用 TS `Narrator` 将数据解说拼装发送 SSE 给客户端。”

### 阶段 3：深水区降级处理与深网 (P3)

- **目标：** 攻克 Deep Lane 和超时逻辑，补全大计算量缓存，部署事件队列消费机制。
- **实施指令：** “请在运行时引入超时抛出功能，模拟一个计算耗时高达 20 秒的任务，展示 Fast Lane 在逼近 10 秒硬边界时的『优雅打断、退还中间件并移交后台排队 S4 状态』能力代码。”

### 阶段 4：观测性护城河 (P4)

- **目标：** 集成前卫的结构化日志（如 `pino` TS端 / `structlog` Py端），自动落盘 `incident bundle`。
- **实施指令：** “编写捕获错误与超时栈踪迹的中间件，验证只要有异常跑出，必定生成一个让大模型一眼看出病因的 JSON Bundle。”

---

## 8. 全景交付与收口验收要求

1. V2 项目完全剥离运行并具有自身唯一的 `start_v2_system.sh`。
2. 当输入“将地图画面中心点的全部商铺计算 500m 缓冲区” —— TS 快速返回提取出 DSL，PY 精确算出范围多边形并序列化，LLM 总结这花了 3 秒且数据来源于源 POI 数据集。
3. 全系统所有变量声明包含完整的 Type / Model 定义。不会出现隐匿引发系统性崩溃的 Any 类型。
4. 全系统在并发压力测试下没有出现由 Redis 状态竞争导致的内存泄漏死锁。

**文档就绪，请让负责开发环境搭建的 AI 特工查阅此处并基于此规格书正式启动工作流。**
