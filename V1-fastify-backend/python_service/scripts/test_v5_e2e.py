"""端到端测试：BBOX → 空间连接 → 聚类 → 地块边界组装 → 命名。"""
import sys, time, json
sys.path.insert(0, ".")

from db.repository import POIRepository
from algorithms.hdbscan_cluster import cluster_points
from pipeline.block_assembler import assemble_block_boundaries

repo = POIRepository()

# 测试区域：光谷-关山大道片区
bbox = "POLYGON((114.36 30.47, 114.44 30.47, 114.44 30.53, 114.36 30.53, 114.36 30.47))"

print("=" * 60)
print("Composite V5 端到端测试")
print("=" * 60)

# Step 1: 获取三层面
t0 = time.time()
road_blocks = repo.fetch_road_blocks(bbox_wkt=bbox, limit=5000)
osm_aoi = repo.fetch_osm_aoi(bbox_wkt=bbox, limit=3000)
euluc = repo.fetch_euluc(bbox_wkt=bbox, limit=3000)
t1 = time.time()
print(f"\n[Step 1] 三层面查询: {t1-t0:.2f}s")
print(f"  road_blocks: {len(road_blocks)}")
print(f"  osm_aoi: {len(osm_aoi)}")
print(f"  euluc: {len(euluc)}")

# Step 2: 空间连接 POI
t2 = time.time()
pois = repo.spatial_join_pois(clip_wkt=bbox, limit=3000)
t3 = time.time()
print(f"\n[Step 2] 空间连接 POI: {len(pois)} 条, {t3-t2:.2f}s")

if len(pois) < 10:
    print("POI 太少，无法聚类")
    sys.exit(0)

# Step 3: HDBSCAN 聚类
coords = [(float(p["lon"]), float(p["lat"])) for p in pois if p.get("lon") and p.get("lat")]
t4 = time.time()
result = cluster_points(coords, min_cluster_size=8, min_samples=4, adaptive=True)
t5 = time.time()
print(f"\n[Step 3] HDBSCAN 聚类: {result.cluster_count} 个簇, 噪声 {result.noise_count}, {t5-t4:.2f}s")

# Step 4: 地块边界组装
t6 = time.time()
districts = assemble_block_boundaries(
    cluster_labels=result.labels,
    pois=pois,
    road_blocks=road_blocks,
    osm_aoi_features=osm_aoi,
    euluc_features=euluc,
)
t7 = time.time()
print(f"\n[Step 4] 地块边界组装: {len(districts)} 个片区, {t7-t6:.2f}s")

# 输出结果
for d in districts:
    geom_type = d.boundary_geojson.get("type", "?")
    coord_count = len(d.boundary_geojson.get("coordinates", [[]])[0]) if geom_type == "Polygon" else 0
    print(f"\n  片区 #{d.cluster_id}: {d.name}")
    print(f"    命名来源: {d.name_source}, 置信度: {d.name_confidence}")
    print(f"    边界方法: {d.boundary_method}")
    print(f"    POI 数量: {d.poi_count}")
    print(f"    涉及地块: {len(d.block_ids)} 个")
    print(f"    中心: {d.center}")
    print(f"    主导 AOI: {d.dominant_aoi_name} ({d.dominant_aoi_type})")
    print(f"    主导用地: {d.dominant_land_type}")
    print(f"    边界顶点: {coord_count}")

total = t7 - t0
print(f"\n{'=' * 60}")
print(f"总耗时: {total:.2f}s")
print(f"{'=' * 60}")

# 导出为 GeoJSON 供 QGIS 检视
output = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": d.boundary_geojson,
            "properties": {
                "name": d.name,
                "name_source": d.name_source,
                "name_confidence": d.name_confidence,
                "boundary_method": d.boundary_method,
                "poi_count": d.poi_count,
                "block_count": len(d.block_ids),
                "dominant_aoi": d.dominant_aoi_name,
                "dominant_aoi_type": d.dominant_aoi_type,
                "dominant_land_type": d.dominant_land_type,
            },
        }
        for d in districts
    ],
}

out_path = r"d:\AAA_Edu\TagCloud\vite-project\newdata\v5_test_districts.geojson"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f"\n已导出测试结果: {out_path}")
