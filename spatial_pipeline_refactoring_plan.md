# [给 AI 开发助手的重构指令] 空间计算管线 v5 模糊认知边界架构升级 (分期执行版)

你好，AI 助手。我们需要对现有的 spatial_pipeline (v5) 进行架构与算子级别的重构。
当前系统会将诸如“光谷商圈”、“江汉路片区”、“武汉大学科教文化区”等具有用户强认知、但无官方定义的“模糊泛化边界”视为脏数据并粗暴拦截。
本次重构的宗旨是：**结果可靠，过程严谨，链路顺畅**。

为了防止代码库过大导致重构出现“幻觉”和顾此失彼，本次重构**严格划分为四个阶段（Phases）独立执行**。请仔细阅览各阶段的执行清单，并在我指定开始某一阶段时，独立完成该范围的修改。

---

## 🟢 PHASE 1: 数据基座解绑 (The Foundation)

**核心目标：** 解决数据库查询层的“隐性截断与向心坍缩”，确保所有在分析选区内（无论多远）的 POI 都能进入算法层，不丢失边缘辐射特征。
**涉及文件：** [db/repository.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/db/repository.py), [pipeline/spatial_pipeline.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py)

1. **移除“向心坍缩”的距离排序陷阱 (`ORDER BY Distance`)**：
   * **现状**：在 [db/repository.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/db/repository.py) 的 SQL 构造中，如果启用了 `order_by_distance`，会通过 `ORDER BY p.geom <-> ST_Centroid(...)` 使得 POI 按距离中心点正序排列。
   * **动作**：针对生成片区（模糊边界提取）的查询类型，我们**不能剔除边缘点**。在 [spatial_pipeline.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py) 获取 POI 时，若业务为生成大片区，应当显式关闭中心距离排序（或在 SQL 层保证 `LIMIT` 足够大时不发生边缘裁剪）。
2. **释放硬性配额 `LIMIT` 截断**：
   * **现状**：在 [spatial_pipeline.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py) 主循环里 `fetch_limit` 默认仅为 8000。这对于大尺度的“江汉路片区/武汉大学区”根本不够，导致超出 8000 的点全部丢失。
   * **动作**：如果是区域生成请求，应在 [spatial_pipeline.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py) 动态调大 [limit](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py#1346-1357) (如 25000) 并且配合上一步关闭 `order_by_distance`。如果点位数量过大，考虑预聚合策略，但最底线是不能盲目进行 `top K` 距离截断。

---

## 🟡 PHASE 2: 核心组装与边缘泛化 (The Geometry)

**核心目标：** 解除人为设置的宏观地名封锁，改变块状包络策略为合并外溢，并实现平滑的地理视觉体验。
**涉及文件：** [pipeline/block_assembler.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/block_assembler.py), [pipeline/spatial_pipeline.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py)

1. **净化“宏观地名词典”的误杀**：
   * **动作**：修改 [block_assembler.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/block_assembler.py) 顶部的 `_MACRO_GEO_NAMES`。将“光谷”、“东西湖”、“汉阳”、“汉口”等具有强烈大中观商圈认知属性的名词**移除黑名单**。只保留省、市级别真正无意义的极宽泛名词。
   * **保送机制**：避开对以“片区/活力带”为后缀命名的极低置信度打压逻辑。
2. **组装策略：从“物理劫持”走向“全域联结 (Union)”**：
   * **动作**：重构 [assemble_block_boundaries](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/block_assembler.py#524-752)。当发现高权重的官方 AOI 面（如武汉大学）时，废弃直接替换 `boundary_polygon = override_polygon` 的强卡死逻辑。
   * **替换为**：`boundary_polygon = unary_union([override_polygon, *周边高关联的_road_blocks_polygons])`。利用 Shapely 的 `ST_Union` 生成**“核心主体 + 外延支撑点”的全包络泛化边界**。
3. **消除视口截断强行切削 (Viewport Clipping)**：
   * **动作**：排查 [spatial_pipeline.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py)。如果在最终边界生成之前调用了 [_clip_polygon_to_constraint](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py#742-756)，必须**屏蔽或短路**该操作。用户屏幕的视口 [viewport](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/db/repository.py#108-128) 仅用来查库，在出图多边形边界时绝不能被视口方框给切削成直角。
4. **边缘形态学平滑 (Morphological Polishing)**：
   * **动作**：对于由 `unary_union` 拼接出来的“多积木”几何体，边缘容易出现微小内凹缝隙和尖刺（马路缝隙）。在转出为 geoJSON 前，使用 Shapely 的特性进行闭运算：`polygon.buffer(0.0003, resolution=4).buffer(-0.0003, resolution=4)`，填补碎片，使片区轮廓圆滑柔和。

---

## 🔴 PHASE 3: 语义解耦与形态包容 (The Polish)

**核心目标：** 解决线型商业带被置信度评分系统误杀的问题，并将短平快的 Python 返回与沉重的 LLM 同步请求解绑。
**涉及文件：** [pipeline/confidence_scorer.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/confidence_scorer.py), [pipeline/vlm_reviewer.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/vlm_reviewer.py), [pipeline/semantic_reasoner.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/semantic_reasoner.py)

1. **修正在打分体系中对“活力带”的歧视 (Compactness Penalty)**：
   * **现状**：启发式评分算法中，如果是“沿江风景带”或“长条形主干道商业”，会因为 [compactness](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/vlm_reviewer.py#53-69) (致密度/圆形度) 极低而被认定为“辣鸡边界”。
   * **动作**：修改 [_heuristic_visual_score](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/vlm_reviewer.py#71-94) 或前置判断逻辑，若 `semantic_reasoner` 探测到该片区偏向线型、沿街或活力带类型（包含 road_fit 高分），则**降低 Compactness 的扣分权重**。允许长宽比失衡但形态有理有据的区域拿到高置信度。
2. **纯净流打断与阻塞分离**：
   * **动作**：梳理 [spatial_pipeline.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py)。确保诸如“XX光谷商圈”这样的名称提炼在 [semantic_reasoner.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/semantic_reasoner.py) 内部靠高性能 Counter 和词频完全秒切生成（< 10ms）。
   * **预留**：移除主循环中 [_call_remote_vlm](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/vlm_reviewer.py#117-178) 和 [_govern_region_names](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/spatial_pipeline.py#396-461) 导致的同步阻塞（等待模型接口长达 3 秒的卡顿）。保证管线在算出核心 GeoJSON 及启发式评分后，直接通过 `yield / return` 给前端先极速下发初稿渲染。

---

## 🟣 PHASE 4: 多模态视觉感知重构 (The Vision)

**核心目标：** 将沉重的 VLM 机制剥离至前/后端异步并发，并彻底发掘 VLM (如 qwen3.5-4b) 在地图 OCR 地标提取及人文洞察构建中的潜力，取代干瘪机械的同步分数返回。
**涉及文件：** [pipeline/vlm_reviewer.py](file:///d:/AAA_Edu/TagCloud/vite-project/fastify-backend/python_service/pipeline/vlm_reviewer.py), UI/Node层架构预留

1. **VLM OCR 地标与边界锚点勘探**：
   * **场景升级**：不再仅仅让 VLM 返回一个“road_fit=0.6”的数字。
   * **动作规划**：重新设计 Prompt。当把发光的“商圈边界”配合地图底图快照丢给 VLM 时，要求模型利用 OCR 读取边界内及边缘**显眼的大地标文字**（如：“大洋百货”、“光谷步行街”）。通过对比 Python 后端算出的商圈命名，由 VLM 双重验证该多边形是否真正锁死了核心的图面锚点。
2. **环境肌理感知与人文洞见 (Contextual Insight)**：
   * **场景升级**：让大模型发光发热，做其最擅长的概念融合与推演。
   * **动作规划**：VLM 和推理模型在接到地图快照与底层 POI 类别占比（如商业 45%，教育 32%）后，进行宏观环境分析判断（如依山傍水、高架阻断等）。最后，输出一段富有同理心和城市设计专业感的一段**人类可读业务评述**。（示例：“该片区沿干道延展，凭借水面生态截断形成了内聚的文创商业特区。”）
3. **架构闭环 (异步长响应呈现)**：
   * **动作规划**：这段 VLM/LLM 的请求作为从前端（或 Fastify 单独挂起的后台任务）发起的二次异步请求。页面上对应区域采用骨架屏加载（Skeleton Loading）。待模型生成 OCR 洞察与评述后，在不卡界面渲染的前提下柔和展现（Fade In），实现真正的“空间智能体感”。

---

### 结语

由于任务复杂度极高，包含地理运算逻辑和架构性能隐患。在执行代码生成和改写时，请先思考你正在执行哪一个 PHASE。如收到开发者指令，请以 `PHASE X` 作为检查锚点。
