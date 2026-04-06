# V4 Chat UI Clarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 V4 聊天入口从开发态参数面板收敛成普通用户能直接理解和使用的聊天界面。

**Architecture:** 保留现有 `AiChat.vue` 的 V4 能力与状态轮询逻辑，不改后端协议，只重组头部信息层级和欢迎区文案。默认界面只展示用户可理解的状态摘要，provider/model/session/dependency 统一收进可展开的运行详情。

**Tech Stack:** Vue 3 `<script setup>`、Vitest、Vue Test Utils、现有 V4 样式系统

---

### Task 1: 为“默认隐藏技术细节”写失败测试

**Files:**
- Modify: `src/components/__tests__/AiChatV4.spec.js`

**Steps:**
1. 新增断言，要求 V4 初始渲染时显示用户向状态摘要和“查看运行详情”入口。
2. 断言 provider id、model id、dependency key、session id 默认不直接出现在界面。
3. 运行单测，确认先红。

### Task 2: 重构 V4 头部层级

**Files:**
- Modify: `src/components/AiChat.vue`

**Steps:**
1. 新增 V4 运行详情展开状态。
2. 将顶部参数标签改为用户向摘要文案。
3. 把 provider/model/session/dependencies 移入折叠详情面板，并做人类可读文案映射。

### Task 3: 收敛欢迎区文案与信息密度

**Files:**
- Modify: `src/components/AiChat.vue`

**Steps:**
1. 把欢迎标题与描述改成用户任务导向。
2. 减少欢迎区元信息数量，避免继续像参数看板。
3. 保留高频入口，但让说明更像“怎么问”而不是“系统在做什么”。

### Task 4: 回归验证

**Files:**
- Modify: `src/components/__tests__/AiChatV4.spec.js`
- Modify: `src/components/AiChat.vue`

**Steps:**
1. 跑 V4 组件单测，确认绿。
2. 如有需要，补充展开详情后的断言，确保隐藏/展开都成立。
3. 整体检查文案与层级是否符合“默认给用户看，技术细节按需看”。
