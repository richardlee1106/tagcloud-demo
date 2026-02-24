"""֤ V5 ռѯ"""
import sys
sys.path.insert(0, ".")
from db.repository import POIRepository

repo = POIRepository()

# 用光谷片区做测试 BBOX
bbox = "POLYGON((114.38 30.48, 114.43 30.48, 114.43 30.52, 114.38 30.52, 114.38 30.48))"

# 测试三层面查询
blocks = repo.fetch_road_blocks(bbox_wkt=bbox, limit=50)
print(f"road_blocks: {len(blocks)} 条")
if blocks:
    print(f"  示例 block_id: {blocks[0].get('block_id')}")

aoi = repo.fetch_osm_aoi(bbox_wkt=bbox, limit=50)
print(f"osm_aoi: {len(aoi)} 条")
if aoi:
    print(f"  示例 name={aoi[0].get('name')}, type={aoi[0].get('type')}")

euluc = repo.fetch_euluc(bbox_wkt=bbox, limit=50)
print(f"euluc: {len(euluc)} 条")
if euluc:
    print(f"  示例 land_type={euluc[0].get('land_type')}")

# 测试空间连接
pois = repo.spatial_join_pois(clip_wkt=bbox, limit=20)
print(f"spatial_join_pois: {len(pois)} 条")
if pois:
    p = pois[0]
    print(f"  name={p.get('name')}, block_id={p.get('block_id')}, aoi_name={p.get('aoi_name')}, aoi_type={p.get('aoi_type')}, land_type={p.get('land_type')}")
