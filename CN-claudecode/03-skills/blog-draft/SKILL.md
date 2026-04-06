---
name: blog-draft
description: Draft a blog post from ideas and resources. Use when users want to write a blog post, create content from research, or draft articles. Guides through research, brainstorming, outlining, and iterative drafting with version control.
---

## 用户输入

```text
$ARGUMENTS
```

你**必须**在继续之前考虑用户输入。用户应提供：
- **想法/主题**：博客文章的主要概念或主题
- **资源**：用于研究的 URL、文件或参考资料（可选但推荐）
- **目标受众**：博客文章面向谁（可选）
- **语气/风格**：正式、非正式、技术性等（可选）

**重要**：如果用户请求更新**现有博客文章**，跳过步骤 0-8，直接从**步骤 9** 开始。先阅读现有草稿文件，然后继续迭代过程。

## 执行流程

按顺序遵循这些步骤。**不要跳过步骤或在需要用户批准的环节擅自继续。**

### 步骤 0：创建项目文件夹

1. 使用格式 `YYYY-MM-DD-short-topic-name` 生成文件夹名称
   - 使用今天的日期
   - 从主题创建一个简短、URL 友好的 slug（小写、连字符、最多 5 个词）

2. 创建文件夹结构：
   ```
   blog-posts/
   └── YYYY-MM-DD-short-topic-name/
       └── resources/
   ```

3. 确认文件夹创建后再继续。

### 步骤 1：研究与资源收集

1. 在博客文章目录中创建 `resources/` 子文件夹

2. 对于每个提供的资源：
   - **URL**：获取并保存关键信息到 `resources/` 作为 markdown 文件
   - **文件**：阅读并在 `resources/` 中总结
   - **主题**：使用网络搜索收集最新信息

3. 每个资源创建一个摘要文件在 `resources/` 中：
   - `resources/source-1-[short-name].md`
   - `resources/source-2-[short-name].md`
   - 等等

4. 每个摘要应包含：
   ```markdown
   # Source: [Title/URL]

   ## Key Points（关键要点）
   - Point 1（要点 1）
   - Point 2（要点 2）

   ## Relevant Quotes/Data（相关引用/数据）
   - Quote or statistic 1（引用或统计数据 1）
   - Quote or statistic 2（引用或统计数据 2）

   ## How This Relates to Topic（与主题的关系）
   Brief explanation of relevance（简要解释相关性）
   ```

5. 向用户呈现研究摘要。

### 步骤 2：头脑风暴与澄清

1. 基于想法和研究资源，呈现：
   - **主要主题**：从研究中识别的主要主题
   - **潜在角度**：博客文章的潜在角度
   - **关键要点**：应涵盖的关键要点
   - **信息空白**：需要澄清的信息空白

2. 问澄清性问题：
   - 你希望读者记住的主要收获是什么？
   - 你想强调研究中的哪些具体要点？
   - 目标长度是多少？（短：500-800 词，中：1000-1500，长：2000+）
   - 有想排除的要点吗？

3. **等待用户回复后再继续。**

### 步骤 3：提出大纲

1. 创建包含以下内容的结构化大纲：

   ```markdown
   # Blog Post Outline: [Title]（博客文章大纲：[标题]）

   ## Meta Information（元信息）
   - **Target Audience（目标受众）**: [who（谁）]
   - **Tone（语气）**: [style（风格）]
   - **Target Length（目标长度）**: [word count（词数）]
   - **Main Takeaway（主要收获）**: [key message（关键信息）]

   ## Proposed Structure（建议结构）

   ### Hook/Introduction（钩子/引言）
   - Opening hook idea（开头钩子想法）
   - Context setting（背景设定）
   - Thesis statement（主题陈述）

   ### Section 1: [Title]（第 1 节：[标题]）
   - Key point A（关键要点 A）
   - Key point B（关键要点 B）
   - Supporting evidence from [source]（来自[来源]的支撑证据）

   ### Section 2: [Title]（第 2 节：[标题]）
   - Key point A（关键要点 A）
   - Key point B（关键要点 B）

   [Continue for all sections...（继续所有章节...）]

   ### Conclusion（结论）
   - Summary of key points（关键要点总结）
   - Call to action or final thought（行动号召或最终想法）

   ## Sources to Cite（要引用的来源）
   - Source 1（来源 1）
   - Source 2（来源 2）
   ```

2. 向用户呈现大纲并**请求批准或修改**。

### 步骤 4：保存已批准的大纲

1. 用户批准大纲后，将其保存到博客文章文件夹中的 `OUTLINE.md`。

2. 确认大纲已保存。

### 步骤 5：提交大纲（如在 git 仓库中）

1. 检查当前目录是否为 git 仓库。

2. 如果是：
   - 暂存新文件：博客文章文件夹、资源和 OUTLINE.md
   - 创建提交，信息：`docs: Add outline for blog post - [topic-name]`
   - 推送到远程

3. 如果不是 git 仓库，跳过此步骤并告知用户。

### 步骤 6：撰写草稿

1. 根据已批准的大纲撰写完整博客文章草稿。

2. 完全按照 OUTLINE.md 中的结构。

3. 包含：
   - 带有钩子的引人入胜引言
   - 清晰的章节标题
   - 来自研究的支撑证据和示例
   - 章节间流畅过渡
   - 强有力结论及收获
   - **引用**：所有比较、数据点、事实声明必须引用原始来源

4. 将草稿保存为博客文章文件夹中的 `draft-v0.1.md`。

5. 格式：
   ```markdown
   # [Blog Post Title]（[博客文章标题]）

   *[Optional: subtitle or tagline]（*[可选：副标题或标语]）

   [Full content with inline citations...（带有行内引用的完整内容...）]

   ---

   ## References（参考资料）
   - [1] Source 1 Title - URL or Citation（来源 1 标题 - URL 或引用）
   - [2] Source 2 Title - URL or Citation（来源 2 标题 - URL 或引用）
   - [3] Source 3 Title - URL or Citation（来源 3 标题 - URL 或引用）
   ```

6. **引用要求**：
   - 每个数据点、统计或比较**必须**有行内引用
   - 使用编号引用 [1]、[2] 等，或命名引用 [Source Name]
   - 将引用链接到末尾的参考资料部分
   - 示例："研究表明 65% 的开发者更喜欢 TypeScript [1]"
   - 示例："React 在渲染速度上比 Vue 快 20% [React Benchmarks 2024]"

### 步骤 7：提交草稿（如在 git 仓库中）

1. 检查是否在 git 仓库中。

2. 如果是：
   - 暂存草稿文件
   - 创建提交，信息：`docs: Add draft v0.1 for blog post - [topic-name]`
   - 推送到远程

3. 如果不是 git 仓库，跳过并告知用户。

### 步骤 8：呈现草稿供审查

1. 向用户呈现草稿内容。

2. 请求反馈：
   - 总体印象如何？
   - 哪些部分需要扩展或缩减？
   - 需要语气调整吗？
   - 有缺失信息吗？
   - 有具体编辑或重写吗？

3. **等待用户回复。**

### 步骤 9：迭代或定稿

**如果用户请求变更：**
1. 记录所有请求的修改
2. 返回步骤 6，并进行以下调整：
   - 递增版本号（v0.2、v0.3 等）
   - 纳入所有反馈
   - 保存为 `draft-v[X.Y].md`
   - 重复步骤 7-8

**如果用户批准：**
1. 确认最终草稿版本
2. 如用户请求，可选择重命名为 `final.md`
3. 总结博客文章创建过程：
   - 创建的版本总数
   - 各版本间的关键变更
   - 最终词数
   - 创建的文件

## 版本追踪

所有草稿都通过增量版本控制保留：
- `draft-v0.1.md` - 初始草稿
- `draft-v0.2.md` - 第一轮反馈后
- `draft-v0.3.md` - 第二轮反馈后
- 等等

这允许追踪博客文章的演变并在需要时回滚。

## 输出文件结构

```
blog-posts/
└── YYYY-MM-DD-topic-name/
    ├── resources/
    │   ├── source-1-name.md
    │   ├── source-2-name.md
    │   └── ...
    ├── OUTLINE.md
    ├── draft-v0.1.md
    ├── draft-v0.2.md（如有迭代）
    └── draft-v0.3.md（如有更多迭代）
```

## 质量提示

- **Hook（钩子）**：以问题、令人惊讶的事实或相关场景开头
- **Flow（流畅）**：每段应连接到下一段
- **Evidence（证据）**：用研究数据支持声明
- **Citations（引用）**：始终引用来源：
  - 所有统计数据和数据点（如 "According to [Source], 75% of..."）
  - 产品、服务或方法之间的比较（如 "X performs 2x faster than Y [Source]"）
  - 关于市场趋势、研究发现或基准的事实声明
  - 使用格式 [Source Name] 或 [Author, Year] 的行内引用
- **Voice（语气）**：始终保持一致的语气
- **Length（长度）**：遵守目标词数
- **Readability（可读性）**：使用短段落，适当使用项目符号
- **CTA（行动号召）**：以明确的行动号召或发人深省的问题结尾

## 备注

- 在规定的检查点始终等待用户批准
- 保留所有草稿版本以供历史记录
- 提供 URL 时使用网络搜索获取最新信息
- 如果资源不足，向用户请求更多或建议额外研究
- 根据目标受众调整语气（技术性、通用性、商业性等）
