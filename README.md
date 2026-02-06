# Spatial-RAG TagCloud v1.0

基于空间增强检索生成（Spatial-RAG）架构的语义态势感知词云系统。

## 🌟 核心理念 (v1.0)

本项目已全面转向以 **PostgreSQL + PostGIS** 为核心的数据管理方案，不再依赖本地大型 GeoJSON 文件。

- **高性能**: 采用 ST_DWithin 等空间引擎函数实现秒级区域检索。
- **智能化**: 集成 LLM 意图解析，支持自然语言直接查询地理实体。
- **自适应**: 动态重心引力词云布局，实时反馈区域语义权重。

## 🛠️ 技术栈

- **Frontend**: Vue 3 (Vite), D3.js, Web Workers
- **Backend**: Fastify, PostgreSQL with PostGIS & pgvector
- **AI**: Local LLM (via LM Studio / Ollama), OpenAI-compatible API

## 🚀 快速开始

### 1. 数据库准备

确保已安装 PostgreSQL 并启用 PostGIS 扩展。
导入数据脚本：

```bash
psql -h localhost -U postgres -d tagcloud -f fastify-backend/scripts/sql/init_database.sql
```

### 2. 后端启动

```bash
cd fastify-backend
npm install
npm start
```

> Note: Local dev uses Fastify `/api/*` via the Vite proxy (http://localhost:3200). The root `/api/ai/*` serverless mocks are for Vercel only.

### 3. 前端启动

```bash
npm install
npm run dev
```

## 📂 目录结构

- `/src`: 前端 Vue 源码
- `/fastify-backend`: 后端服务，包含空间查询与 AI 逻辑
- `/public`: 静态资源（不含大规模地理数据）

## 🛡️ License

MIT
