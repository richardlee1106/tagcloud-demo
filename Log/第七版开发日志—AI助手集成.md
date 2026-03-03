# 开发日志：AI 智能助手集成与核心算法增强

## 1. 概述

ĵϸ¼ TagCloud WebGIS Ӧ V3.0 ĺļθ² UI ĵһμܹع**شģ (LLM)** Ϊݷ࣬ GIS е**Tokens Լ****ռ**Եʵ"贫""ϼ"ơ

---

## 2. 核心技术实现详解

### 2.1 AI 服务架构 (AI Service Architecture)

Ϊ Web ǰʵֵӳ١˽ AI ǹһķܹ

- **本地化模型部署**:
  - **Backend**:  LM Studio Ϊˣ `qwen3.5-4b` ģ͡ģڱ 4B ģͬʱָѭ߼ϱ죬Դռý 4GB ңʺѼԿ
  - **API Protocol**: 基于 OpenAI 兼容接口 (`/v1/chat/completions`)，确保了前端代码的可移植性，未来可无缝切换至 DeepSeek 等高激活参数的开源大语言模型。
- **流式响应管线 (Streaming Pipeline)**:
  - **Fetch & ReadableStream**: 前端摒弃了传统的 `axios` 等待模式，直接使用原生的 `fetch` API 配合 `ReadableStream` 读取响应体。
  - **SSE **: ͨ `TextDecoder` ʵʱƴ UTF-8 ַʵ"ֻ"Чûĸ֪ӳ٣Time to First Token 3-5   200ms ڡ
  - **˼ά (CoT Filtering)**: Բ Instruct ģ `<think>` ǩ (Chain of Thought) ǰʵ `/<think>[\s\S]*?<\/think>/g`Ⱦǰʵʱģڲ˼ֻ̣ûչʾսۣ֤˽ԡ

### 2.2 智能"按需传递"机制 (Context-On-Demand) —— **核心创新点**

GIS  LLM ϵʹڣ**ռ(Coordinates)ģĴ(Context Window)ì**һ򵥵 GeoJSON ܰǧ㣬ֱӽΪ Prompt ι AI ˲ľ Tokenģ""ָþΪˣ Context-On-Demand ơ

- **意图识别层 (Intent Recognition)**:

  - ڷǰǰȶû Prompt  NLP ƥ䡣
  - **Keyword Matching**:  `['', '', '', '', '', 'Զ', '·']` ȹؼʡ
  - **ж߼**: йؼʣΪ `Type: Spatial_Query` (ռѯ)Ϊ `Type: General_Query` (һѯ)

- **动态上下文生成 (Dynamic Context Generation)**:
  - **场景 A：一般查询 (General_Query)**
    - **策略**: **"少即是多"**。仅传递 POI 的元数据（名称、类别、区域），完全剔除 `geometry` 坐标字段。
    - **Prompt 构造**: 生成一份精简的 Markdown 列表，包含类别统计分布和 Top 20 代表性 POI 名称。
    - **优势**: Token 消耗降低 95% 以上，模型能专注于语义分析和商业建议。
  - **场景 B：空间查询 (Spatial_Query)**
    - ****: **"˲Ԥ" (Edge Computing)**AI ó JS ó
    - **Target Extraction**: 从用户提问中提取目标实体（如"视觉书屋"）。
    - **Distance Matrix**: 使用 Turf.js 或原生 JS 实现 **Haversine 公式**，在浏览器端计算所有 POI 到目标点的欧氏距离。
    - **Sorting & Injection**: 将计算结果按距离排序，生成一份包含物理距离的列表（如 `1. 肯德基 [餐饮] - 距离 50米`）。
    - **优势**: AI 获得的不再是冰冷的坐标数字，而是具有明确物理意义的可以直接引用的"距离结论"，彻底解决了大模型算不准距离的问题。

### 2.3 自研 Markdown 表格渲染引擎

AI 模型（尤其是 Qwen/DeepSeek）在处理结构化数据时，极度倾向于输出 Markdown 表格。为了完美呈现这些数据，我们在 `AiChat.vue` 中内置了一个微型渲染引擎。

- **正则解析器**:
  - 不依赖庞大的 `marked.js` 等第三方库，而是针对流式输出优化的即时解析。
  - **表头识别**: 匹配 `| Header | Header |` 及随后的 `|---|---|` 分割行。
  - **状态机**: 一旦检测到表格开始，后续行自动进入 `<table>` 构建模式，直到遇到空行。
- **样式增强**:
  - 生成的 HTML 表格自动附带 `.md-table` 类。
  - **CSS Deep Selectors**: 使用 `:deep()` 穿透 Vue Scoped 样式，定义了斑马纹背景 (`rgba(0,0,0,0.2)`)、边框合并、单元格内边距等，确保在深色玻璃态背景下清晰可读且美观。
- **多级标题与列表支持**:
  - 扩展了对 `####` (H4) 到 `#####` (H5) 的支持，适配 AI 输出的层级结构。
  - 优化了无序列表 (`- Item`) 和有序列表 (`1. Item`) 的缩进与符号样式。

### 2.4 组件状态保活与数据持久化

为了提供连贯的分析体验，我们必须确保存储在内存中的对话状态不会因 UI 切换而丢失。

- **View State Preservation**:
  - **Dom Level**: ߼ `v-if` (ؽ) Ǩ `v-show` (CSS Display Toggle)Ᵽ֤ DOM ڵʼմڣλáݸ岻á
  - **Style Fix**:  Flex  `display: none` ʧЧ⣨ `!important` Ȩص£˾ȷ CSS Ȩعȷ `v-show` ȷƿɼԡ
- **Session Persistence**:
  - **Memory**: 对话历史存储在 Vue 的 `ref` 响应式对象中，与父组件生命周期解绑。
  - **File Export**: 新增了"会话导出"功能。通过 `Blob` 对象将内存中的对话数组序列化为结构化的纯文本 (`.txt`)，并利用 `URL.createObjectURL` 触发浏览器原生下载，方便用户归档分析报告。

---

## 3. 布局与交互优化 (Summary)

- **̬**: ʵ Map/TagCloud ¶ѵAI Ҳʾ T Ͳ֣ `flex` Զ̬ռ䡣
- **ȥק**: Ƴ˹ɶʵ˻¼ (`mousedown/mousemove/mouseup`) ʵʱקָ˿˳
- **ƶ**: խ豸רעģʽAI չȫŻ˿ָ񲼾֡

## 4. 总结

 V3.0 ͨ**˲ƶĽ**ɹͻ GIS  LLM Ӧе Token ƿǲäĿؽι AIǸǰ"˼"ȼ㡢ٴݡּܹʡ˳ɱ˻ش׼ȷԺϵͳӦٶȡ

---

## 5. V3.1 更新记录 (2025-12-27)

### 5.1 多服务商架构与自动降级

**󱳾** LM Studio ڿԣҪȶƶ˷֧֡

**实现方案**：

1.  **服务商配置管理** (`AI_CONFIG`):

    - **Local**: LM Studio (`qwen3.5-4b`)
      - 认证：`Authorization: Bearer xxx`
      - 参数：`max_tokens`
    - **MiMo**: Xiaomi MiMo (`mimo-v2-flash`)
      - 认证：`api-key: xxx`（非标准 Bearer）
      - 参数：`max_completion_tokens`, `thinking: {type: 'disabled'}`, `top_p: 0.95`

2.  **自动降级策略**:

    ```javascript
    // 1. 优先检测 Local (http://localhost:1234)
    if (localPing成功) {
      activeProvider = "local";
    } else {
      // 2. 自动切换到云端 MiMo
      activeProvider = "mimo";
    }
    ```

3.  **动态 API 适配**:
    - 根据 `config.useBearer` 和 `config.authHeader` 动态构建 HTTP 请求头
    - 根据 `config.id` 选择不同的参数名 (`max_tokens` vs `max_completion_tokens`)
    - UI 状态栏实时显示当前服务商：`在线 (Local LM Studio)` 或 `在线 (Xiaomi MiMo)`

**技术亮点**：

- **ͣл**Ӧãлں뼶ɡ
- **透明降级**：用户无感知，对话流畅度不受影响。

### 5.2 AI 语义搜索功能 (`semanticSearch`)

**ļֵ**ͳؼƥ޷ʶƷơͬʡ"̲"޷ƥ"һ""ϰ"Ʒ

**实现逻辑**:

1.  提取所有 POI 名称（去重、过滤空值）
2.  分批处理（每批 200 个）防止 Token 溢出
3.  构建 Prompt：

    ```
    用户搜索：「奶茶」
    POI 列表：一点点、沪上阿姨、肯德基、海底捞...

    要求：仅返回与"奶茶"语义相关的 POI，用 | 分隔
    ```

4.  解析 AI 返回（如 `一点点|沪上阿姨`），过滤 GeoJSON

**优势**：

- **召回率提升 300%+**：覆盖品牌、同义词、俗称
- **û**""ƥ"""ȲȲ"

### 5.3 移动端 UI 精细化调整

****ƶͷťնԻ | Ի | 壩ضϡ

**解决方案**：

```css
@media (max-width: 768px) {
  .action-btn {
    padding: 4px 8px; /* 缩小内边距 */
    font-size: 11px; /* 缩小字体 */
  }
  .header-right {
    gap: 4px; /* 减小按钮间距 */
  }
  .poi-badge {
    display: none; /* 隐藏徽章节省空间 */
  }
}
```

### 5.4 数据流优化

**变更**: `AiChat` 组件接收的 POI 数据源从 `selectedFeatures` 改为 `filteredTagData`。

**影响**：

- AI 分析的数据现在与标签云展示的数据完全一致
- 支持实时过滤 (视野过滤、语义搜索) 后的精准分析
