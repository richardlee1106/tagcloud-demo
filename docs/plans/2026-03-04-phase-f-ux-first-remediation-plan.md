# Phase F UX-First Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复当前空间分析链路与用户交互直觉不一致的问题，确保“视图变化必重算、主导业态符合民生语义、区域识别数量与视图尺度匹配”，并消除 Markdown 输出结构异常。

**Architecture:** 采用“先止损、再重构、后收敛”的三层方案：首先阻断跨视图缓存误命中；其次重构缓存指纹、业态分层与输出契约；最后通过 KPI 门禁和灰度策略稳定上线。整体保持 `spatialJobRunner -> python pipeline -> writer -> AiChat` 主链不变，仅在关键节点加校验与语义约束。

**Tech Stack:** Node.js (Fastify, node:test), Python 3 (pytest), Vue 3 + marked, in-repo telemetry + ops scripts.

---

## 0. 背景与问题归因（基于现网证据）

### 症状 S1：Markdown 结构异常（正文出现 `###**`）
- 直接证据：`TagCloud_Chat_1772633636502.txt` 出现 `###**1...***`、`### **2...***` 等非法/混排 Markdown。
- 触发条件：Writer 目前是自由文本输出，前端直接 `marked.parse` 渲染，缺少“结构契约 + 结果校正”。

### 症状 S2：主导业态偏离业务预期（“充电宝绝对主力”）
- 直接证据：22:13 请求结果中 `充电宝` 计数靠前，且被 Writer 提炼为“绝对主力”。
- 触发条件：
  1. 无 UI 类别筛选时进入 `all_categories`；
  2. `area_analysis + macro_overview` 放宽为全类别抓取；
  3. 主导统计按细粒度类别计数，缺少“衣食住行医疗学习”上卷优先。

### 症状 S3：大视图仅出两处片区
- 直接证据（同日 22:13）：`area_km2=45.777` 但命中 `executor_cache_hit`，最终仅 `SpatialClustersSet=2`。
- 对照证据：同面积附近非缓存请求可产出 `SpatialClustersSet=13`。
- 根因：缓存键在存在 anchor 时只用 `h3_center(res=7)`，没有强绑定 `viewport_hash/viewport_bounds`，导致“小视图结果被大视图复用”。

---

## 1. 修正原则（必须满足）

1. **交互直觉优先**：用户改变视图（范围/形状/缩放）必须触发重算，不允许跨视图复用空间结果。
2. **语义层级优先**：主导业态先按民生一级类（衣食住行医疗学习）判断，再下钻细分类。
3. **结构化输出优先**：Writer 输出必须满足受限格式契约，不允许将结构正确性交给模型“自由发挥”。
4. **证据优先**：结论与建议必须绑定可追溯证据，缺证据时降级为“信息不足”，不允许强结论。
5. **可观测优先**：所有修正项都必须有指标、有告警、有回滚开关。

---

## 2. 目标状态与验收门槛

### 功能门槛
1. 不同视图（即使中心点接近）不得命中同一空间结果缓存。
2. 大视图（例如 >20 km²）分析结果默认不低于 5 个候选片区（除非候选 POI 极低）。
3. “主导业态”默认输出一级民生类，不直接把“充电宝/出入口/楼栋号”判为主导。
4. 回复文本无 `###**` / `***标题` 等结构错误。

### KPI 门槛
1. `cross_view_cache_collision_rate = 0`（灰度与全量阶段均为 0）。
2. `markdown_structure_invalid_rate < 0.1%`。
3. `livelihood_primary_alignment_rate >= 95%`（主导结论命中民生一级类）。
4. `undersegmentation_rate`（大视图低片区数）较当前基线下降 80% 以上。

---

## 3. 分阶段修正方案

### Phase F0（当天止损，低风险）

#### F0-1 缓存止损
- 对 `area_analysis` 临时关闭空间结果缓存，或仅在 `context_binding.viewport_hash` 完全一致时允许命中。
- 若无法立即关缓存：命中缓存后追加“几何一致性二次校验”（面积比例、viewport hash、zoom bucket 任一不符即回源重算）。
- 目标：立即阻断“小视图污染大视图”。

#### F0-2 输出止损
- Writer 输出前追加 Markdown 结构检查器：检测到非法标题/列表混排则自动规范化。
- 建议段落无证据锚点时降级为“待验证建议”，禁止“绝对主力”等绝对化措辞。

#### F0-3 可观测止损
- 新增告警：`executor_cache_hit` 且 `area_km2` 与缓存记录差异超过阈值时告警。
- 在调试信息中显式回传：`cache_hit`, `cache_key_version`, `geometry_match`.

---

### Phase F1（缓存键重构，交互契约修复）

#### F1-1 缓存指纹 V2
- 指纹必须包含：
  1. `context_binding.viewport_hash`（优先）；
  2. `viewport_bounds`（即使存在 anchor 也保留）；
  3. `draw_mode + boundary_digest + regions_digest`；
  4. `map_zoom_bucket`；
  5. `query_type + source_policy + user_question_digest`。
- 引入 `cache_key_version=v2`，与旧键并存一段时间，避免硬切失败。

#### F1-2 命中后防呆
- 命中缓存后执行 `post_hit_guard`：
  - `area_ratio_guard`（请求面积 vs 缓存面积）；
  - `center_distance_guard`（中心偏移）；
  - `viewport_hash_guard`（hash 一致性）。
- 任一失败：`cache_guard_reject=true`，强制回源。

#### F1-3 测试矩阵
- 回归用例（必须新增）：
  1. 小视图 -> 大视图，同中心不同范围，不命中缓存；
  2. 大视图 -> 小视图，不命中缓存；
  3. 同视图重复请求，允许命中；
  4. 不同 query_type 不串缓存。

---

### Phase F2（主导业态语义重构）

#### F2-1 类别双层模型
- 新增一级民生映射层：`衣/食/住/行/医疗/学习/其他`。
- 二级类仍保留用于解释，但“主导业态”先输出一级类占比，再给二级示例。

#### F2-2 低信号类别治理
- 将以下类别默认降权或排除出“主导业态”候选：
  - `充电宝`（归入“行/配套服务”，不单独主导）；
  - `楼栋号/道路名/路口名/出入口/停车场出入口`；
  - 纯设施性标签。
- 保留原始统计用于审计，不直接进入对外“主导结论”。

#### F2-3 意图一致性增强
- 当用户问题包含“主导/主力/活力/机会点”时：
  - 强制应用民生一级类排序；
  - 建议必须绑定证据（POI 类别分布、热点中心、覆盖范围）。
- 缺证据时输出“当前证据不足以给出单一主导业态”。

#### F2-4 测试矩阵
- 样本回放（含本次湖北大学场景）：
  1. 默认场景不再把“充电宝”作为一级主导；
  2. 业务口径输出优先“食/学习/住”等；
  3. 明确交通类查询时允许“行”主导。

---

### Phase F3（几何产出规模与质量修复）

#### F3-1 大视图下限策略
- 针对 `area_analysis` 增加“结果规模下限”：
  - 当 `area_km2 > threshold` 且 `total_candidates > threshold` 时，若 `cluster_count < min_regions` 则触发二次分割策略。
- 二次分割可用：
  1. 多尺度 HDBSCAN 参数重试；
  2. H3 热点网格反推候选片区；
  3. 关闭或放宽 dedup 参数再评估。

#### F3-2 Dedup 审计
- 输出 `v5_region_dedup_before_count / after_count / removed_count` 到前端调试态。
- 当 `removed_ratio` 异常高时标记 `undersegmentation_risk=true`。

#### F3-3 质量约束
- FINAL 前新增 `geometry_quality_gate`：
  - 若触发低分段风险，返回补救标记并追加“需复算/需放宽参数”诊断。

---

### Phase F4（Writer 输出契约化）

#### F4-1 输出协议
- Writer 改为“结构化中间态 + 文本渲染”：
  - 先生成 `sections[]`（title, bullets, evidence_refs）；
  - 再由模板层统一渲染 Markdown。
- 禁止模型直接控制标题层级符号。

#### F4-2 结构校验器
- 渲染前执行：
  1. 标题合法性检查；
  2. 列表/段落分隔检查；
  3. 绝对化词汇检查（无证据时拦截）。

#### F4-3 幻觉与建议治理
- 将现有 `writer_validation.hallucination` 结果接入输出决策：
  - 命中高风险建议时自动改写为“可选探索，不构成结论”。

---

### Phase F5（前端交互增强）

#### F5-1 缓存透明化
- 调试态显示：`cache_hit`, `cache_key_version`, `geometry_match`。
- 用户态可选显示“已基于当前视图重算”/“来自同视图缓存”。

#### F5-2 一键重算
- 增加“强制重算”入口（`skipCache=true`），用于用户自证与排障。

#### F5-3 结果可信度提示
- 当 `undersegmentation_risk=true` 或 `writer_hallucination=true` 时，前端给出轻量提示，不静默展示高置信结论。

---

## 4. 任务拆解（按模块）

### Backend（Node/Fastify）
1. `queryCache.generateQueryFingerprint` 升级到 V2，纳入视图约束强特征。
2. `spatialJobRunner` 增加缓存命中后二次校验与拒绝回源路径。
3. `telemetry` 增加 collision/markdown/undersegmentation 指标。
4. `ops` 补充诊断接口，输出缓存键与命中判定细节。

### Python Pipeline
1. 引入民生一级类映射与主导业态双层统计。
2. 新增低信号类降权策略。
3. 增加大视图分段下限与二次分割机制。
4. 补充 dedup 风险诊断输出。

### Writer + Frontend
1. Writer 输出协议结构化。
2. 前端渲染前 Markdown 结构校验与规范化。
3. UI 增加缓存透明与强制重算入口。

---

## 5. 验证与回归清单

### 核心回放用例（必须）
1. 同一中心点：小视图 -> 大视图 -> 小视图（验证缓存不串）。
2. 湖北大学样例：验证不再输出“充电宝绝对主力”。
3. 大视图样例：验证片区数量不再异常低（>= 5 或给出风险提示）。
4. Markdown 输出样例：验证无 `###**`、`***标题` 混排。

### 自动化测试（建议新增）
1. `queryCacheFingerprint.crossViewCollision.test.mjs`
2. `spatialJobRunner.cachePostHitGuard.test.mjs`
3. `writerMarkdownContract.test.mjs`
4. `python_service/tests/test_livelihood_dominant_ranking.py`
5. `python_service/tests/test_large_view_undersegmentation_guard.py`

---

## 6. 灰度发布与回滚策略

### 灰度顺序
1. 先开 F0（止损）；
2. 小流量开 F1（缓存 V2 + guard）；
3. 稳定后开 F2/F3（语义与几何）；
4. 最后开 F4/F5（输出契约与 UI）。

### 回滚开关（必须保留）
1. `SPATIAL_CACHE_KEY_VERSION=v1|v2`
2. `SPATIAL_CACHE_POST_HIT_GUARD=true|false`
3. `SPATIAL_LIVELIHOOD_RANKING=true|false`
4. `SPATIAL_UNDERSEGMENTATION_GUARD=true|false`
5. `WRITER_MARKDOWN_CONTRACT=true|false`

---

## 7. 交付物

1. 设计与方案文档（本文件）。
2. 修复后对照报告（含 trace 回放前后对比）。
3. KPI 周报新增章节（collision / alignment / undersegmentation）。

---

## 8. 完成定义（DoD）

1. 本次复现链路（22:13 对话）回放通过，且不再命中跨视图旧缓存。
2. 主导业态输出符合“民生一级类优先”。
3. 大视图结果数量达到预期或明确标注风险并触发补救。
4. Markdown 输出结构稳定，无异常标题符号。
5. 新增测试与门禁全部通过，具备一键回滚能力。

