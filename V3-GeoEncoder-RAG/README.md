# V3-GeoEncoder-RAG

空间编码器 RAG 服务模块 - L6 空间智能体 MVP

## 目录结构

```
V3-GeoEncoder-RAG/
├── services/                         # Node.js 运行时模块
│   ├── ai/                           # 聊天、意图、LLM、流式回答
│   ├── retrieval/                    # 向量检索、RAG 组装、空间编排
│   ├── data/                         # 数据访问与前端空间数据查询
│   ├── infra/                        # Ollama、编码器进程、基础设施适配
│   ├── diagnostics/                  # 调试与追踪
│   ├── legacy/                       # 备份/临时补丁遗留文件
│   └── __tests__/                    # 按子域拆分的 Vitest 测试
├── python/                           # Python 空间编码器与测试
│   ├── poi_encoder_service.py
│   ├── services/
│   └── tests/
├── scripts/                          # 一次性脚本与运维脚本
│   ├── cache/                        # 缓存构建
│   ├── data-prep/                    # 数据导入/清洗/补标/embedding 生成
│   ├── evaluation/                   # 平台评估与能力探索
│   └── testing/                      # 一次性测试脚本
├── tests/                            # 手工测试脚本与样例请求
├── docs/                             # 规格说明、报告、计划
├── config/                           # 本地模型/运行配置
└── logs/                             # 本地运行日志
```

## 快速开始

### 1. 数据库准备

```bash
# 添加 spatial_embedding 列
cd D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG
python scripts/data-prep/add_spatial_embedding.py

# 生成 embedding（565K POI，约 10 分钟）
python scripts/data-prep/generate_spatial_embeddings.py --batch 1000

# 构建本地缓存，加快启动
node scripts/cache/build_embedding_cache.js
```

### 2. 启动服务

```bash
# 启动独立 V3 服务
cd D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG
npm run start
```

### 3. API 使用

#### LLM 驱动的空间问答

```bash
curl -X POST http://localhost:3300/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "武汉大学附近500米内有哪些咖啡馆？", "topK": 10}'
```

#### 流式聊天

```bash
curl -X POST http://localhost:3300/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"武汉大学附近适合学习的咖啡店有哪些？"}]}'
```

## LLM 配置

默认使用本地 LMStudio：

- **地址**: http://127.0.0.1:1234
- **模型**: qwen3.5-2b-claude-4.6-opus-reasoning-distilled

可通过环境变量覆盖：

```bash
LLM_BASE_URL=http://127.0.0.1:1234/v1
LLM_MODEL=qwen3.5-2b-claude-4.6-opus-reasoning-distilled
```

## 混合检索架构

```
用户查询
    ↓
LLM 意图解析
    ↓
地理编码（地名→坐标）
    ↓
空间过滤（PostGIS）
    ↓
空间重排（POI encoder embedding）
    ↓
LLM 答案生成
    ↓
返回结果
```

## 性能指标

| 指标 | 值 |
|------|-----|
| POI 总数 | 565,672 |
| Embedding 维度 | 352 |
| 混合检索延迟 | ~500ms |
| LLM 意图解析延迟 | ~1-2s |

## Git 提交记录

- `221ffd2`: L6 MVP 混合检索完成
- `b1fd391`: 修复混合检索 API 列名问题
- `93cec16`: 添加混合检索和空间重排 API 端点
- `74ba144`: L6 MVP 开发 - 混合检索架构
