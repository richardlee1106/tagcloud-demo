#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据导出脚本：从PostGIS导出实验区域数据
用于GNN+Transformer空间编码器训练
"""

import json
import psycopg2
import networkx as nx
import numpy as np
from pathlib import Path

# 实验区域：光谷核心 3km×3km
EXPERIMENT_BBOX = {
    'min_lon': 114.395,
    'max_lon': 114.425,
    'min_lat': 30.4865,
    'max_lat': 30.5135,
    'name': 'guanggu_core'
}

DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'user': 'postgres',
    'password': '123456',
    'database': 'geoloom'
}

OUTPUT_DIR = Path(__file__).parent / 'experiment_data'


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def make_envelope():
    b = EXPERIMENT_BBOX
    return f"ST_MakeEnvelope({b['min_lon']}, {b['min_lat']}, {b['max_lon']}, {b['max_lat']}, 4326)"


def export_pois(conn):
    """导出POI数据"""
    print("导出POI数据...")

    sql = f"""
    SELECT
        p.id,
        p.name,
        p.category_big,
        p.category_mid,
        p.category_small,
        ST_X(p.geom) as lon,
        ST_Y(p.geom) as lat,
        p.land_use_type,
        p.aoi_type,
        p.aoi_name,
        p.nearest_road_class,
        p.nearest_road_dist_m,
        p.poi_density_500m,
        p.category_entropy_500m,
        p.road_block_id,
        p.street_block_id
    FROM pois p
    WHERE p.geom && {make_envelope()}
    ORDER BY p.id
    """

    cursor = conn.cursor()
    cursor.execute(sql)

    pois = []
    for row in cursor.fetchall():
        pois.append({
            'id': row[0],
            'name': row[1],
            'category_big': row[2],
            'category_mid': row[3],
            'category_small': row[4],
            'lon': float(row[5]),
            'lat': float(row[6]),
            'land_use_type': row[7],
            'aoi_type': row[8],
            'aoi_name': row[9],
            'nearest_road_class': row[10],
            'nearest_road_dist_m': float(row[11]) if row[11] else 0.0,
            'poi_density_500m': int(row[12]) if row[12] else 0,
            'category_entropy_500m': float(row[13]) if row[13] else 0.0,
            'road_block_id': int(row[14]) if row[14] else None,
            'street_block_id': int(row[15]) if row[15] else None
        })

    print(f"  导出 {len(pois)} 个POI")
    return pois


def export_road_blocks(conn):
    """导出路网地块数据"""
    print("导出路网地块数据...")

    sql = f"""
    SELECT
        rb.id,
        rb.block_id,
        rb.shape_area,
        rb.poi_count,
        rb.dominant_category,
        rb.category_entropy,
        rb.poi_categories,
        rb.street_block_id,
        ST_AsGeoJSON(rb.geom) as geom_json
    FROM wuhan_road_blocks rb
    WHERE rb.geom && {make_envelope()}
    ORDER BY rb.id
    """

    cursor = conn.cursor()
    cursor.execute(sql)

    blocks = []
    for row in cursor.fetchall():
        blocks.append({
            'id': row[0],
            'block_id': row[1],
            'area_sqm': float(row[2]) if row[2] else 0.0,
            'poi_count': int(row[3]) if row[3] else 0,
            'dominant_category': row[4],
            'category_entropy': float(row[5]) if row[5] else 0.0,
            'poi_categories': row[6],
            'street_block_id': int(row[7]) if row[7] else None,
            'geom': json.loads(row[8]) if row[8] else None
        })

    print(f"  导出 {len(blocks)} 个路网地块")
    return blocks


def export_roads(conn):
    """导出路网数据（用于GNN图构建）"""
    print("导出路网数据...")

    sql = f"""
    SELECT
        r.id,
        r.properties->>'name' as name,
        r.properties->>'fclass' as road_class,
        r.properties->>'oneway' as oneway,
        (r.properties->>'maxspeed')::int as maxspeed,
        ST_Length(r.geom::geography) as length_m,
        ST_AsGeoJSON(r.geom) as geom_json
    FROM wuhan_roads r
    WHERE r.geom && {make_envelope()}
    ORDER BY r.id
    """

    cursor = conn.cursor()
    cursor.execute(sql)

    roads = []
    for row in cursor.fetchall():
        roads.append({
            'id': row[0],
            'name': row[1],
            'road_class': row[2],
            'oneway': row[3],
            'maxspeed': int(row[4]) if row[4] else 0,
            'length_m': float(row[5]) if row[5] else 0.0,
            'geom': json.loads(row[6]) if row[6] else None
        })

    print(f"  导出 {len(roads)} 条道路")
    return roads


def export_aois(conn):
    """导出AOI数据"""
    print("导出AOI数据...")

    sql = f"""
    SELECT
        a.id,
        a.name,
        a.type,
        a.area_sqm,
        ST_AsGeoJSON(a.geom) as geom_json
    FROM wuhan_osm_aoi a
    WHERE a.geom && {make_envelope()}
    ORDER BY a.id
    """

    cursor = conn.cursor()
    cursor.execute(sql)

    aois = []
    for row in cursor.fetchall():
        aois.append({
            'id': row[0],
            'name': row[1],
            'type': row[2],
            'area_sqm': float(row[3]) if row[3] else 0.0,
            'geom': json.loads(row[4]) if row[4] else None
        })

    print(f"  导出 {len(aois)} 个AOI")
    return aois


def compute_block_adjacency(blocks):
    """计算地块邻接关系"""
    print("计算地块邻接关系...")

    # 使用几何相交判断邻接
    # 这里简化处理，实际应该用PostGIS的ST_Touches

    adjacencies = []
    n = len(blocks)

    # 存储每个地块的边界框
    bboxes = {}
    for block in blocks:
        if block['geom'] and block['geom']['type'] == 'Polygon':
            coords = block['geom']['coordinates'][0]
            lons = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            bboxes[block['id']] = {
                'min_lon': min(lons),
                'max_lon': max(lons),
                'min_lat': min(lats),
                'max_lat': max(lats)
            }

    # 简化：边界框接近的地块视为邻接
    threshold = 0.0005  # 约50米

    for i, block_a in enumerate(blocks):
        if block_a['id'] not in bboxes:
            continue
        bbox_a = bboxes[block_a['id']]

        for j, block_b in enumerate(blocks):
            if i >= j:
                continue
            if block_b['id'] not in bboxes:
                continue
            bbox_b = bboxes[block_b['id']]

            # 检查边界框是否接近
            if (abs(bbox_a['min_lon'] - bbox_b['max_lon']) < threshold or
                abs(bbox_a['max_lon'] - bbox_b['min_lon']) < threshold or
                abs(bbox_a['min_lat'] - bbox_b['max_lat']) < threshold or
                abs(bbox_a['max_lat'] - bbox_b['min_lat']) < threshold):

                # 还需要检查是否有重叠
                if (bbox_a['min_lon'] <= bbox_b['max_lon'] and
                    bbox_a['max_lon'] >= bbox_b['min_lon'] and
                    bbox_a['min_lat'] <= bbox_b['max_lat'] and
                    bbox_a['max_lat'] >= bbox_b['min_lat']):
                    adjacencies.append({
                        'source': block_a['id'],
                        'target': block_b['id']
                    })

    print(f"  找到 {len(adjacencies)} 对邻接关系")
    return adjacencies


def build_category_mapping(pois):
    """构建类别到索引的映射"""
    categories = set()
    for poi in pois:
        if poi['category_big']:
            categories.add(poi['category_big'])

    cat_to_idx = {cat: idx for idx, cat in enumerate(sorted(categories))}
    cat_to_idx['<UNKNOWN>'] = len(cat_to_idx)

    return cat_to_idx


def build_landuse_mapping(pois):
    """构建土地利用类型映射"""
    landuses = set()
    for poi in pois:
        if poi['land_use_type']:
            landuses.add(poi['land_use_type'])

    lu_to_idx = {lu: idx for idx, lu in enumerate(sorted(landuses))}
    lu_to_idx['<UNKNOWN>'] = len(lu_to_idx)

    return lu_to_idx


def save_data(pois, blocks, roads, aois, adjacencies):
    """保存数据到文件"""
    OUTPUT_DIR.mkdir(exist_ok=True)

    # 保存原始JSON
    print("保存数据文件...")

    with open(OUTPUT_DIR / 'pois.json', 'w', encoding='utf-8') as f:
        json.dump(pois, f, ensure_ascii=False, indent=2)

    with open(OUTPUT_DIR / 'road_blocks.json', 'w', encoding='utf-8') as f:
        json.dump(blocks, f, ensure_ascii=False, indent=2)

    with open(OUTPUT_DIR / 'roads.json', 'w', encoding='utf-8') as f:
        json.dump(roads, f, ensure_ascii=False, indent=2)

    with open(OUTPUT_DIR / 'aois.json', 'w', encoding='utf-8') as f:
        json.dump(aois, f, ensure_ascii=False, indent=2)

    with open(OUTPUT_DIR / 'block_adjacencies.json', 'w', encoding='utf-8') as f:
        json.dump(adjacencies, f, ensure_ascii=False, indent=2)

    # 保存映射
    cat_mapping = build_category_mapping(pois)
    lu_mapping = build_landuse_mapping(pois)

    with open(OUTPUT_DIR / 'category_mapping.json', 'w', encoding='utf-8') as f:
        json.dump(cat_mapping, f, ensure_ascii=False, indent=2)

    with open(OUTPUT_DIR / 'landuse_mapping.json', 'w', encoding='utf-8') as f:
        json.dump(lu_mapping, f, ensure_ascii=False, indent=2)

    # 保存元数据
    metadata = {
        'experiment_area': EXPERIMENT_BBOX,
        'export_time': __import__('datetime').datetime.now().isoformat(),
        'counts': {
            'pois': len(pois),
            'road_blocks': len(blocks),
            'roads': len(roads),
            'aois': len(aois),
            'adjacencies': len(adjacencies)
        },
        'category_count': len(cat_mapping),
        'landuse_count': len(lu_mapping)
    }

    with open(OUTPUT_DIR / 'metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"数据已保存到 {OUTPUT_DIR}")


def main():
    print("=" * 50)
    print("GNN+Transformer实验数据导出")
    print(f"实验区域: {EXPERIMENT_BBOX['name']}")
    print(f"范围: [{EXPERIMENT_BBOX['min_lon']}, {EXPERIMENT_BBOX['min_lat']}] - [{EXPERIMENT_BBOX['max_lon']}, {EXPERIMENT_BBOX['max_lat']}]")
    print("=" * 50)

    conn = get_connection()

    try:
        pois = export_pois(conn)
        blocks = export_road_blocks(conn)
        roads = export_roads(conn)
        aois = export_aois(conn)
        adjacencies = compute_block_adjacency(blocks)

        save_data(pois, blocks, roads, aois, adjacencies)

        print("\n" + "=" * 50)
        print("导出完成！")
        print("=" * 50)

    finally:
        conn.close()


if __name__ == '__main__':
    main()
