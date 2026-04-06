# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供代码仓库协作指导。

**编码要求**：所有中文内容（注释、字符串、文档）必须使用 UTF-8 编码，防止乱码。

---

## 快速参考

### 启动服务
```bash
# 一键启动（Windows）
start.bat

# 或手动启动：
npm run dev:stack           # 前端 + 后端（推荐）
npm run dev                 # 仅前端（端口 5173）
cd V1-fastify-backend && npm run dev:stack  # 仅后端（端口 3200）
```

### 健康检查
```bash
curl http://127.0.0.1:3200/health
curl http://127.0.0.1:3200/api/ai/status
```

### 运行测试
```bash
npm test                    # 运行所有测试
npm run test:watch          # 监听模式
npx vitest run path/to/test.spec.js  # 运行单个测试
```

### 训练空间编码器
```bash
cd spatial_encoder/v26_GLM
python train_v26_mlp.py --sample 0.1 --epochs 50   # 快速测试（10%数据）
python train_v26_mlp.py --sample 1.0               # 全量训练
python evaluate_v26_pro.py                          # 运行评估
```

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 (Vue 3 + Vite)                       │
│  src/ - 组件、视图、Composables、Services                    │
│  端口 5173 → 代理 /api/* 到后端:3200                         │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/SSE
┌───────────────────────────▼─────────────────────────────────┐
│               后端 (Fastify, 端口 3200)                       │
│  V1-fastify-backend/                                         │
│  ├── routes/     - API 端点 (ai, jobs, spatial, search)     │
│  ├── services/   - 数据库、向量库、队列、gRPC 客户端          │
│  └── workers/    - 后台任务处理                              │
└───────────────────────────┬─────────────────────────────────┘
                            │ gRPC
┌───────────────────────────▼─────────────────────────────────┐
│                Python 服务 (gRPC)                            │
│  V1-fastify-backend/python_service/                         │
│  - AI 推理、空间计算                                         │
└─────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│               PostgreSQL + PostGIS + pgvector                │
│  - POI 数据、空间索引、向量嵌入                              │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构
```
├── src/                    # Vue 3 前端
│   ├── components/         # Vue 组件 (AiChat, MapContainer 等)
│   ├── composables/        # Vue composables (ai/, 空间逻辑)
│   ├── services/           # API 客户端服务
│   ├── utils/              # 工具函数
│   └── views/              # 页面视图
├── V1-fastify-backend/     # Node.js 后端（端口 3200）
│   ├── routes/             # Fastify 路由处理器
│   ├── services/           # 核心服务（数据库、队列、gRPC）
│   ├── workers/            # BullMQ 任务处理器
│   ├── python_service/     # Python gRPC 服务
│   └── sql/                # 数据库脚本
├── spatial_encoder/        # 空间编码器实验
│   ├── v26_GLM/            # 当前版本 (V2.6 Pro)
│   ├── v24/                # V2.4（稳定版）
│   └── api/                # 编码器 API 服务
└── docs/                   # 架构文档、计划
```

---

## 核心目标

**构建"空间到语义的桥梁"**：训练空间编码器，将 POI 空间关系编码为稠密向量，使 LLM 能够理解空间拓扑而非仅处理文本描述。

### 空间智能等级

| 等级 | 描述 | 指标 | 状态 |
|------|------|------|------|
| L1 | 空间感知 | Pearson>0.90, Spearman>0.85 | ✅ 达成 |
| L2 | 空间查询 | Overlap>40% | ✅ 达成 |
| L3 | 空间理解 | DirMatch>40%, Region F1>35% | ⚠️ 部分达成 |
| L4 | 空间推理 | Range IoU>70% | ❌ MLP天花板（~27%）|

**当前成果**：L2 完全达成（Pearson=0.964, Overlap=40.1%, DirMatch=69.9%, RegionF1=25.5%, RangeIoU=27.0%）

### 解决方案：混合检索架构

**设计理念**：Range IoU 27% 说明 embedding 学到了**语义空间**而非简单复制地理坐标。混合检索结合两者优势。

```
┌─────────────────────────────────────────────────────────┐
│  混合检索 = Embedding 语义检索 + 空间过滤                │
│                                                         │
│  Step 1: Embedding 检索 → 召回语义相似 POI (Recall 60%) │
│  Step 2: 空间过滤 → 保留 radius 范围内 (Precision 100%) │
│  Step 3: 重排序 → 结合语义和空间得分 (F1 70-80%)        │
└─────────────────────────────────────────────────────────┘
```

**关键文件**：`spatial_encoder/v26_GLM/hybrid_search.py`

**测试结果**：
| 指标 | 纯语义检索 | 混合检索 | 提升 |
|------|-----------|---------|------|
| Intra-class Recall | 41.2% | **54.4%** | +13.2% |
| Spatial Precision | - | **100%** | - |

---

## 开发命令

### 前端
```bash
npm run dev              # 启动开发服务器（端口 5173）
npm run build            # 生产构建
npm run preview          # 预览生产构建
npm test                 # 运行测试
```

### 后端（V1-fastify-backend）
```bash
npm run dev              # 开发模式（热重载）
npm run dev:stack        # 完整栈（后端 + Python 服务）
npm run python:grpc      # 启动 Python gRPC 服务
npm run worker:spatial   # 启动后台 Worker
npm run kpi:report       # 生成 KPI 报告
npm run template:weights # 重算模板权重
```

### 空间编码器
```bash
cd spatial_encoder/v26_GLM
python train_v26_mlp.py --sample 0.1 --epochs 50  # 快速验证
python train_v26_mlp.py --sample 1.0              # 全量训练
python evaluate_v26_pro.py                         # 评估套件
python test_memory_config.py                       # GPU 显存测试
python hybrid_search.py                            # 混合检索测试
```

---

## 关键文件

| 模块 | 路径 |
|------|------|
| V2.6 Pro 配置 | `spatial_encoder/v26_GLM/config_v26_pro.py` |
| V2.6 Pro 编码器 | `spatial_encoder/v26_GLM/encoder_v26_mlp.py` |
| V2.6 Pro 训练 | `spatial_encoder/v26_GLM/train_v26_mlp.py` |
| V2.6 Pro 评估 | `spatial_encoder/v26_GLM/evaluate_v26_pro.py` |
| 混合检索引擎 | `spatial_encoder/v26_GLM/hybrid_search.py` |
| 后端入口 | `V1-fastify-backend/server.js` |
| AI 路由 | `V1-fastify-backend/routes/ai/index.js` |
| 前端 AI 面板 | `src/components/AiChat.vue` |
| 主布局 | `src/MainLayout.vue` |

---

## API 端点

### AI
- `POST /api/ai/chat` - AI 聊天补全
- `GET /api/ai/status` - 服务状态
- `GET /api/ai/models` - 可用模型

### 空间
- `POST /api/spatial/query` - 空间查询
- `POST /api/spatial/fetch` - 获取空间数据
- `GET /api/search/quick` - 快速搜索

### 任务
- `POST /api/jobs/narrative` - 创建叙事任务
- `GET /api/jobs/:job_id/stream` - SSE 流

---

## V2.6 Pro 配置

针对 RTX 5060 Laptop 8GB 优化：

```python
# config_v26_pro.py
hidden_dim = 640
embedding_dim = 352
num_encoder_layers = 10
batch_size = 16384
K_neighbors = 85
epochs = 80
learning_rate = 3e-4
```

**GPU 利用率**：~90%（7.2GB/8GB）

---

## 实验方法论

### 渐进式验证

```
Phase 1: 单区域/小样本 → 验证参数合理性
Phase 2: 多区域/多样本 → 验证泛化能力
Phase 3: 10% → 30% → 60% → 100% → 全量验证
```

### 验收标准

| 阶段 | 目标 |
|------|------|
| Phase 1 | 达成率 >70%, Pearson >0.7 |
| Phase 2 | 3/3 区域通过 |
| Phase 3 | 无显著性能下降 |

### 关键教训

1. **数据决定上限**：武汉 POI 的 Silhouette 上限为 0.32-0.38
2. **维度诅咒**：高维嵌入（64维）vs 2维真实空间 → ~30% 邻居重叠率
3. **稳定性 > 绝对值**：稳定的 86% 优于波动的 12-91%
4. **标签泄露**：切勿将 category 同时作为输入和标签

---

## 故障排查

### `ERR_CONNECTION_REFUSED http://127.0.0.1:3200`
后端未启动。执行：
```bash
cd V1-fastify-backend && npm run dev:stack
```

### GPU 显存溢出（OOM）
- 检查 K_neighbors（推荐：8GB 显存用 85）
- 检查 batch_size（推荐：16384）
- 使用 K 近邻采样损失替代全矩阵计算

### Silhouette 为负数
区域内 POI 分布均匀时正常。使用采样数据验证。

### Silhouette 过高（>0.95）
可能存在标签泄露。检查输入特征是否包含标签信息。

---

## 环境配置

### Node.js
```bash
npm install  # 前端依赖
cd V1-fastify-backend && npm install  # 后端依赖
```

### Python
```bash
pip install torch scikit-learn matplotlib psycopg2-binary h3 faiss-cpu
```

### 数据库
- PostgreSQL + PostGIS 扩展
- pgvector 扩展用于向量操作

---

## 相关文档

- `CHANGELOG.md` - 详细实验历史和结果
- `README.md` - 项目概览和快速开始
- `docs/` - 架构规划和技术文档

---

**最后更新**：2026-03-18（P4-Phase3 完整优化：元数据支持、自适应权重、FAISS加速，批量检索 0.8ms/query）
