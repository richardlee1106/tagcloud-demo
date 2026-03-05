# 源策略与全类目抽样修复验证报告

- 时间: 2026-02-07
- Ŀ: ԼʱһĿռƫбȶ⡣

## 修复点
- `fastify-backend/python_service/db/repository.py`: 空间过滤在无锚点场景改为按几何中心 KNN 排序（`geom <-> ST_Centroid(...)`）。
- `fastify-backend/python_service/db/repository.py`: 区域对比的 WKT 查询同步使用中心排序，避免 LIMIT 被导入顺序主导。
- `fastify-backend/services/database.js`: 为 `/api/spatial/fetch` 的边界查询增加中心 KNN 排序，保持结果空间代表性。

## 回归验证结果
- `/api/jobs/narrative` 四种 sourcePolicy 场景均返回成功，且类别源标记正确： `all_categories` / `ui_selector`
- no_area_no_cat: count=500, distinct=17, source=all_categories
- area_no_cat: count=500, distinct=15, source=all_categories
- no_area_with_cat: count=500, distinct=2, source=ui_selector
- area_with_cat: count=500, distinct=1, source=ui_selector
- `/api/spatial/fetch` (`categories=["中餐厅"]`, bbox): count=1000
- `node fastify-backend/scripts/smoke_jobs_flow.js`: pass (pois=500, regions=10)

## 结论
主路由在“全类目 + 视口/选区”场景下不再出现单一类目极端偏斜，类别约束与空间约束可正常叠加生效。
