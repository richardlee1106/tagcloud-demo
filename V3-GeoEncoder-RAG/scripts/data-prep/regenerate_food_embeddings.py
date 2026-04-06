# -*- coding: utf-8 -*-
"""
为餐饮美食 POI 重新生成高质量 embedding

使用 POIDataLoader 的完整特征构建：
- point_features [32]: 坐标 + K-NN类别分布 + 自身类别
- line_features [16]: 坐标 + 道路密度/等级
- polygon_features [16]: 坐标 + 地块类型
- direction_features [8]: 相对城市中心方向

Author: Sisyphus
Date: 2026-03-21
"""

import os
import sys
import time
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor
from sklearn.neighbors import BallTree

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

# ============================================================
# 常量定义
# ============================================================

# 三镇坐标范围
LNG_MIN, LNG_MAX = 113.70, 114.65
LAT_MIN, LAT_MAX = 30.39, 30.79

# 城市中心（武汉）
CITY_CENTER_LNG = 114.305
CITY_CENTER_LAT = 30.593

# 高德 POI 大类列表（16 维）
POI_CATEGORY_LIST = [
    "购物服务", "生活服务", "科教文化服务", "医疗保健服务",
    "政府机构及社会团体", "交通设施服务", "体育休闲服务", "商务住宅",
    "住宿服务", "公司企业", "金融保险服务", "公共设施",
    "汽车服务", "汽车维修", "汽车销售", "风景名胜",
    "餐饮美食",  # 新增
]
CATEGORY_TO_IDX = {c: i for i, c in enumerate(POI_CATEGORY_LIST[:16])}  # 只用前16个

# 道路等级（5 维）
ROAD_CLASS_LIST = ["primary", "secondary", "tertiary", "residential", "unclassified"]
ROAD_CLASS_TO_IDX = {c: i for i, c in enumerate(ROAD_CLASS_LIST)}

# 地块类型（11 维）
LANDUSE_TYPE_LIST = [
    "居住用地", "商业服务用地", "工业用地", "物流仓储用地",
    "道路交通设施用地", "公用设施用地", "绿地与广场用地",
    "医疗卫生用地", "教育用地", "河流湖泊", "公园与绿地用地",
]
LANDUSE_TO_IDX = {t: i for i, t in enumerate(LANDUSE_TYPE_LIST)}


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "15432")),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "123456"),
        database=os.getenv("POSTGRES_DATABASE", "geoloom"),
    )


def _norm_coord(lng: float, lat: float) -> Tuple[float, float]:
    return (
        (lng - LNG_MIN) / (LNG_MAX - LNG_MIN),
        (lat - LAT_MIN) / (LAT_MAX - LAT_MIN),
    )


def _direction_onehot(lng: float, lat: float) -> np.ndarray:
    dx = lng - CITY_CENTER_LNG
    dy = lat - CITY_CENTER_LAT
    angle = math.atan2(dy, dx)
    direction = int((angle + math.pi) / (math.pi / 4)) % 8
    feat = np.zeros(8, dtype=np.float32)
    feat[direction] = 1.0
    return feat


def load_all_pois(cur) -> List[Dict]:
    """加载所有 POI 用于 K-NN 计算"""
    print("Loading all POIs for K-NN...")
    cur.execute("""
        SELECT id, ST_X(geom) as lon, ST_Y(geom) as lat, category_main
        FROM pois
        WHERE geom IS NOT NULL
    """)
    return [dict(r) for r in cur.fetchall()]


def load_roads(cur) -> Tuple[List, List]:
    """加载道路数据"""
    print("Loading roads...")
    cur.execute("""
        SELECT ST_Y(ST_Centroid(geom)) AS lat,
               ST_X(ST_Centroid(geom)) AS lng,
               fclass
        FROM roads
        WHERE geom IS NOT NULL
    """)
    rows = cur.fetchall()
    coords = [[r['lat'], r['lng']] for r in rows]
    classes = [r['fclass'] for r in rows]
    print(f"  Loaded {len(coords):,} roads")
    return coords, classes


def load_landuse_for_pois(cur, poi_ids: List[int]) -> Dict[int, Optional[Tuple[str, float]]]:
    """加载地块数据"""
    print("Loading landuse...")
    cur.execute("""
        SELECT p.id, l.land_type, l.area_sqm
        FROM pois p
        JOIN landuse l ON ST_Within(p.geom, l.geom)
        WHERE p.id = ANY(%s)
        ORDER BY p.id, l.area_sqm ASC
    """, (poi_ids,))

    result = {}
    for row in cur.fetchall():
        poi_id, land_type, area = row['id'], row['land_type'], row['area_sqm']
        if poi_id not in result:
            result[poi_id] = (land_type, area)

    print(f"  Landuse mapped for {len(result):,} POIs")
    return result


def build_features_for_poi(
    poi: Dict,
    all_pois: List[Dict],
    neighbor_indices: np.ndarray,
    road_tree: Optional[BallTree],
    road_classes: List[str],
    landuse_map: Dict,
    road_radius_deg: float = 0.005,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """为单个 POI 构建完整特征"""

    lng, lat = poi["lon"], poi["lat"]
    norm_lng, norm_lat = _norm_coord(lng, lat)

    # ---- point_features [32] ----
    point_features = np.zeros(32, dtype=np.float32)
    point_features[0] = norm_lng
    point_features[1] = norm_lat

    # K 近邻计数
    k_count = max(len(neighbor_indices) - 1, 0)
    point_features[2] = np.log1p(k_count) / 10.0

    # K 近邻类别分布 [3:19]
    cat_counts = np.zeros(16, dtype=np.float32)
    for ni in neighbor_indices:
        if ni >= len(all_pois):
            continue
        neighbor = all_pois[ni]
        if neighbor["id"] == poi["id"]:
            continue
        cat = neighbor["category_main"]
        if cat in CATEGORY_TO_IDX:
            cat_counts[CATEGORY_TO_IDX[cat]] += 1

    if k_count > 0:
        cat_dist = cat_counts / k_count
    else:
        cat_dist = cat_counts
    point_features[3:19] = cat_dist

    # 类别熵 [19]
    nz = cat_dist[cat_dist > 0]
    if len(nz) > 1:
        point_features[19] = float(-np.sum(nz * np.log(nz + 1e-8)))

    # 自身类别 one-hot [20:32]
    own_cat = poi.get("category_main", "")
    if own_cat in CATEGORY_TO_IDX and CATEGORY_TO_IDX[own_cat] < 12:
        point_features[20 + CATEGORY_TO_IDX[own_cat]] = 1.0

    # ---- line_features [16] ----
    line_features = np.zeros(16, dtype=np.float32)
    line_features[0] = norm_lng
    line_features[1] = norm_lat

    if road_tree is not None:
        q = np.radians([[lat, lng]])
        road_idx = road_tree.query_radius(q, r=road_radius_deg * np.pi / 180.0)[0]
        road_count = len(road_idx)
        line_features[2] = np.log1p(road_count) / 5.0

        rc_counts = np.zeros(5, dtype=np.float32)
        for ri in road_idx:
            if ri < len(road_classes):
                rc = road_classes[ri]
                if rc in ROAD_CLASS_TO_IDX:
                    rc_counts[ROAD_CLASS_TO_IDX[rc]] += 1
        if road_count > 0:
            line_features[3:8] = rc_counts / road_count

    # ---- polygon_features [16] ----
    polygon_features = np.zeros(16, dtype=np.float32)
    polygon_features[0] = norm_lng
    polygon_features[1] = norm_lat

    lu_info = landuse_map.get(poi["id"])
    if lu_info:
        lu_type, lu_area = lu_info
        polygon_features[2] = min(lu_area / 1e6, 10.0)
        if lu_type in LANDUSE_TO_IDX:
            polygon_features[3 + LANDUSE_TO_IDX[lu_type]] = 1.0

    # ---- direction_features [8] ----
    direction_features = _direction_onehot(lng, lat)

    return point_features, line_features, polygon_features, direction_features


def regenerate_embeddings():
    """重新生成餐饮美食 POI 的 embedding"""

    print("\n" + "="*60)
    print("重新生成餐饮美食 POI Embedding（完整特征）")
    print("="*60)

    # 加载编码器服务
    sys.path.insert(0, str(PROJECT_ROOT))
    from python.poi_encoder_service import POIEncoderService

    service = POIEncoderService()

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. 加载所有 POI 用于 K-NN
        all_pois = load_all_pois(cur)
        N_all = len(all_pois)
        print(f"  Total POIs: {N_all:,}")

        # 构建 BallTree
        print("Building BallTree for K-NN...")
        coords_rad = np.radians([[p["lat"], p["lon"]] for p in all_pois])
        tree = BallTree(coords_rad, metric="haversine")

        # 2. 加载道路
        road_coords, road_classes = load_roads(cur)
        road_tree = None
        if len(road_coords) > 0:
            road_tree = BallTree(np.radians(road_coords), metric="haversine")

        # 3. 查询需要更新的餐饮 POI
        cur.execute("""
            SELECT id, name, ST_X(geom) as lon, ST_Y(geom) as lat, category_main, category_sub
            FROM pois
            WHERE category_main = '餐饮美食'
            ORDER BY id
        """)
        food_pois = cur.fetchall()
        print(f"\nFood POIs to update: {len(food_pois):,}")

        if not food_pois:
            print("No food POIs to update")
            return

        # 4. 加载地块（分批）
        food_ids = [p["id"] for p in food_pois]
        landuse_map = load_landuse_for_pois(cur, food_ids)

        # 5. 批量处理
        batch_size = 500
        total = len(food_pois)
        updated = 0
        start_time = time.time()

        # K-NN 参数
        radius_m = 500.0
        radius_rad = radius_m / 6371000.0

        for i in range(0, total, batch_size):
            batch = food_pois[i:i+batch_size]

            # 构建 POI 索引映射
            poi_id_to_idx = {p["id"]: j for j, p in enumerate(all_pois)}

            # 批量构建特征
            point_features_list = []
            line_features_list = []
            polygon_features_list = []
            direction_features_list = []

            for poi in batch:
                # 找到 POI 在 all_pois 中的索引
                poi_idx = poi_id_to_idx.get(poi["id"])
                if poi_idx is None:
                    # 如果找不到，使用默认特征
                    pt, ln, pg, dr = build_features_for_poi(
                        poi, [], [], road_tree, road_classes, landuse_map
                    )
                else:
                    # K-NN 查询
                    q = np.radians([[poi["lat"], poi["lon"]]])
                    neighbor_indices = tree.query_radius(q, r=radius_rad)[0]

                    pt, ln, pg, dr = build_features_for_poi(
                        poi, all_pois, neighbor_indices, road_tree, road_classes, landuse_map
                    )

                point_features_list.append(pt)
                line_features_list.append(ln)
                polygon_features_list.append(pg)
                direction_features_list.append(dr)

            # 转换为数组
            point_features = np.array(point_features_list)
            line_features = np.array(line_features_list)
            polygon_features = np.array(polygon_features_list)
            direction_features = np.array(direction_features_list)

            # 生成 embedding
            embeddings = service.encode_features(
                point_features, line_features, polygon_features, direction_features,
                batch_size=256,
            )

            # 更新数据库
            for j, poi in enumerate(batch):
                emb_list = embeddings[j].tolist()
                cur.execute(
                    "UPDATE pois SET spatial_embedding = %s WHERE id = %s",
                    (emb_list, poi["id"]),
                )

            conn.commit()
            updated += len(batch)

            # 进度
            elapsed = time.time() - start_time
            rate = updated / elapsed if elapsed > 0 else 0
            eta = (total - updated) / rate if rate > 0 else 0
            print(f"  {updated:,}/{total:,} ({updated/total*100:.1f}%) - {rate:.1f}/s - ETA: {eta/60:.1f}min")

        elapsed = time.time() - start_time
        print(f"\nCompleted! {updated:,} POIs updated in {elapsed:.1f}s")

    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    regenerate_embeddings()
