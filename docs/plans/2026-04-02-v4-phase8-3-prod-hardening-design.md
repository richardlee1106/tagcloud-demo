# V4 Phase 8.3 生产级补强设计

> **状态**：已确认，待实施
> **创建时间**：2026-04-02
> **承接阶段**：Phase 8.2 真服务联调验收完成之后
> **本轮目标**：把 V4 从“联调可用”推进到“生产可观测、可回归、可降级、可定位”

---

## 1. 本轮最重要的结论

Phase 8.3 不再重写主链路，而是在现有 `V4-GeoLoom-beta` 的稳定闭环上，补齐四层生产护栏：

1. 10 题固定回归基线
2. 运行时监控与健康指标
3. Redis 短期记忆真连接升格
4. FAISS / 路网 / Python 编码器远程能力生产化接入

本轮坚持一个原则：

> **先让系统“可看见”，再让系统“更强”。**

也就是说，先补观测与回归，再补远程依赖接入。这样每推进一块能力，都能知道到底是增强了，还是悄悄退化了。

---

## 2. 为什么这轮不能直接“先把依赖都接上”

`V4-GeoLoom-beta` 当前已经具备：

1. `MiniMax Anthropic-compatible` 的真实 provider 链路
2. `GeoLoomAgent -> SkillRegistry -> Evidence View -> Renderer` 的主闭环
3. `RemoteFirst + Local Fallback` 形式的 Redis / FAISS / 路网 / Python 编码器桥接
4. `/api/geo/health` 的 degraded dependency 展示

真正缺的不是“能不能调用远程服务”，而是：

1. 没有固定的 10 题生产级回归题库
2. 没有聚合指标，只有单次 `latency_ms`
3. 没有把 SQL 有效率和答案证据落地率沉淀成可观察数字
4. 没有把 MiniMax 真服务与远程依赖串成一套固定验收路径

如果直接去补远程依赖，很容易出现这种情况：

1. 看起来服务都接通了
2. 但不知道性能有没有变差
3. 不知道答案是不是更 grounded
4. 出现 degraded 时也不知道是哪一层开始掉链子

---

## 3. 本轮设计边界

### 3.1 目标内

1. 固定 10 题 E2E 回归基线
2. 监控指标：
   - `p50_latency_ms`
   - `p95_latency_ms`
   - `sql_valid_rate`
   - `evidence_grounded_answer_rate`
3. Redis 短期记忆真连接健康探测与状态升格
4. `FAISS / 路网 / Python 编码器` 的远程生产接入与降级验证
5. `MiniMax` 作为真实编排入口的 smoke / 回归执行模式

### 3.2 目标外

1. 不重写 `GeoLoomAgent` 主控制流
2. 不把当前 `RemoteFirst + Fallback` 抽象推翻重做
3. 不在这轮引入 Prometheus/Grafana 等外部监控系统
4. 不做复杂 dashboard，只先把聚合指标和健康接口打通

---

## 4. MiniMax 在 8.3 的角色

本轮明确把 `MiniMax Anthropic-compatible provider` 定义为：

> **生产编排主入口与真服务回归标准入口。**

具体意味着：

1. 默认编排工作流继续通过 `createDefaultLLMProvider()` 走 `anthropic-compatible` 协议
2. 当 `LLM_BASE_URL` 指向 MiniMax Anthropic 兼容地址时，系统视其为主编排 provider
3. 10 题回归要支持两种模式：
   - `mock/provider-free`：用于稳定测试业务逻辑
   - `MiniMax real-run`：用于真实编排 smoke
4. 生产 smoke 的结论，以 MiniMax 真实返回结果为主，不以纯 mock 通过代替真实可用

这样可以保证：

1. 本地逻辑回归稳定
2. 真服务编排也有固定入口
3. 文档和代码里的“设计选型”不会跟实际运行脱节

---

## 5. 整体实施顺序

本轮采用分层混合推进，而不是一次性重接所有依赖。

### 第 1 层：先立观测基线

先新增轻量运行时指标收集器，把每次请求和每个关键判定事件沉淀成聚合数据。

第一批指标：

1. `request_latency_ms`
2. `sql_validation_attempted`
3. `sql_validation_passed`
4. `evidence_grounded_answers`
5. `answers_total`

然后对外暴露：

1. 聚合统计
2. p50 / p95
3. 各指标的 count / rate

### 第 2 层：固化 10 题回归题库

把 10 题回归从“散落在测试里的例子”升级成显式 fixture：

1. 每题有固定 `query`
2. 每题有固定 `expected_query_type`
3. 每题校验 `evidence_view.type`
4. 每题校验关键实体是否命中
5. 某些题允许 degraded，但要显式声明

### 第 3 层：把 Redis 从“可 fallback”升级到“真实可依赖”

当前 `RedisShortTermStore` 已经支持 RESP 直连，这轮不重写协议层，而是补：

1. 真连接探测
2. 失败状态可观测
3. TTL 行为回归
4. `/api/geo/health` 与指标里的 remote / fallback 区分

### 第 4 层：远程依赖生产化接入

沿用已有抽象，不重写：

1. `RemoteFirstFaissIndex`
2. `RemoteFirstOSMBridge`
3. `RemoteFirstPythonBridge`

这轮补的是：

1. 远程健康状态回写
2. 失败分类
3. 远程成功路径与 fallback 路径的回归覆盖

---

## 6. 指标设计

### 6.1 指标源头

指标尽量靠近事实边界采集，不在前端或文本层猜。

采集位置建议：

1. `GeoLoomAgent.handle()`
   - 请求总时延
   - 是否 provider ready
   - 最终是否有 evidence
2. `executePostgisTemplate()` / SQL 校验壳
   - SQL 校验尝试数
   - SQL 校验通过数
3. `refined_result` 生成前
   - 答案是否 grounded
4. `getHealth()`
   - 当前 degraded dependency 数量

### 6.2 `p50 / p95 latency`

不引入外部监控系统时，先采用进程内滚动窗口实现：

1. 记录最近 N 次请求时延
2. 按排序计算 p50 / p95
3. 对外通过 health 或 metrics 接口暴露

优点：

1. 实现轻
2. 验证快
3. 先解决“看不见”的问题

### 6.3 `sql_valid_rate`

定义：

`sql_valid_rate = passed_sql_validations / total_sql_validation_attempts`

注意：

1. 仅统计真实进入 SQL 校验壳的请求
2. 不把不需要 SQL 的问题算进分母
3. 要保留 `attempted / passed / failed` 原始计数

### 6.4 `evidence_grounded_answer_rate`

第一版先走工程可落地规则，不追求学术完美：

满足以下条件记为 grounded：

1. 返回了非空 `evidence_view`
2. `answer_text` 非空
3. 回答中命中了至少一个 evidence 关键实体：
   - anchor 名
   - poi 名
   - station 名
   - comparison pair 名称

定义：

`evidence_grounded_answer_rate = grounded_answers / total_answers`

这能先挡住最危险的一类问题：

> 有证据但回答完全没引用证据，或者文本飘到了证据外面。

---

## 7. 10 题回归设计

### 7.1 回归题库结构

建议每题用统一结构：

```ts
{
  id: 'q01_nearby_coffee',
  query: '武汉大学附近有哪些咖啡店？',
  expectedQueryType: 'nearby_poi',
  expectedEvidenceType: 'poi_list',
  expectedKeywords: ['武汉大学', '咖啡'],
  allowDegradedDependencies: []
}
```

### 7.2 推荐 10 题覆盖面

1. 附近咖啡店
2. 最近地铁站
3. 最近地铁站出口比较
4. 双地点餐饮比较
5. 双地点地铁分布比较
6. 相似片区召回
7. 明确锚点失败澄清
8. provider 不可用时 deterministic fallback
9. 路网降级时距离提示
10. 语义依赖降级时仍能收敛到安全答案

### 7.3 两套执行模式

#### 模式 A：稳定回归

1. 使用 mock provider / mock remote bridges
2. 目的：保证代码逻辑稳定，不受外部网络影响

#### 模式 B：真实 smoke

1. 使用 MiniMax
2. 使用实际 env 中配置的远程依赖
3. 目的：验证“设计里的真实编排”是否成立

---

## 8. Redis 升格设计

### 8.1 当前状态

当前 `ShortTermMemory` 已支持：

1. store 存在时优先读远程
2. 失败时自动 fallback 到内存
3. health 中可显示 `remote / fallback`

### 8.2 本轮补强点

1. 启动后或首次 health 时主动 `ping`
2. 一旦成功远程写入，状态升级为 `remote`
3. 一旦远程失败，保留 `fallback` 状态并给出 `reason`
4. 补齐真实 TTL 行为测试和连接错误测试

### 8.3 设计原则

Redis 的目标不是“必须强依赖，不行就崩”，而是：

> **优先真连接，失败可降级，降级必须可见。**

---

## 9. 远程依赖生产化设计

### 9.1 FAISS

保留 `RemoteFirstFaissIndex`，补：

1. 远程健康探测状态缓存
2. 远程调用失败原因落地
3. 成功 / fallback 两条路径的固定测试

### 9.2 路网

保留 `RemoteFirstOSMBridge`，补：

1. 远程路线服务成功态验证
2. fallback 时答案必须保留“估算值”语义
3. 对应回归题显式允许 degraded

### 9.3 Python 编码器

保留 `RemoteFirstPythonBridge`，补：

1. 远程健康与编码成功路径
2. fallback 向量路径可观测
3. 相似片区题在远程/降级两种情况下都能闭环

---

## 10. API 设计调整

本轮不重写现有 `/api/geo/health`，只增量补齐：

1. `metrics`
   - `requests_total`
   - `latency_p50_ms`
   - `latency_p95_ms`
   - `sql_valid_rate`
   - `evidence_grounded_answer_rate`
2. `dependencies`
   - 保持现有结构
3. `degraded_dependencies`
   - 保持现有结构

如有必要，可新增：

1. `GET /api/geo/metrics`

但优先增量集成到 health，先减少接口扩散。

---

## 11. 风险与缓释

### 风险 1：指标实现把主链路搞复杂

缓释：

1. 指标收集器保持纯内存、低耦合
2. 不把业务判断散落到各处
3. 以小侵入方式挂在既有边界

### 风险 2：10 题回归过于依赖具体文本

缓释：

1. 优先校验题型、evidence type、关键实体
2. 不对完整自然语言句子做死板匹配

### 风险 3：MiniMax 真服务波动导致测试不稳

缓释：

1. 保留 mock 稳定回归
2. MiniMax 真实模式单独作为 smoke，不混入日常纯单测

### 风险 4：Redis / 远程依赖接入后偶发降级，误判为功能 bug

缓释：

1. 在 health 与 metrics 中清晰区分 `remote / fallback / local`
2. 在回归题里显式声明允许 degraded 的依赖

---

## 12. 实施完成后的验收口径

Phase 8.3 完成后，应至少满足：

1. 10 题固定回归可跑，且能区分稳定模式与 MiniMax 真服务 smoke 模式
2. `/api/geo/health` 能看到 `p50 / p95 latency`
3. `/api/geo/health` 能看到 `sql_valid_rate`
4. `/api/geo/health` 能看到 `evidence_grounded_answer_rate`
5. Redis 真连接成功时显示 `remote`，失败时显示 `fallback`
6. `FAISS / 路网 / Python 编码器` 远程成功与降级路径都有测试覆盖
7. 文档中明确：MiniMax 是当前编排主入口，不只是临时联调 provider

---

## 13. 一句话总结

Phase 8.3 的本质不是“多接几个服务”，而是：

> **让 V4 在继续依赖 MiniMax 做真实编排的前提下，具备生产级的可观测性、可回归性和可降级性。**
