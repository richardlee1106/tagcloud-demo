#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出GeoJSON格式数据，用于GIS可视化
支持多个实验区域
"""

import json
import psycopg2
from pathlib import Path

# 三个实验区域
EXPERIMENT_AREAS = {
    'guanggu_core': {
        'name': '光谷核心',
        'type': '商业居住混合',
        'bbox': {
            'min_lon': 114.395,
            'max_lon': 114.425,
            'min_lat': 30.4865,
            'max_lat': 30.5135,
        }
    },
    'wuda_area': {
        'name': '武大周边',
        'type': '高校科教区',
        'bbox': {
            'min_lon': 114.34,
            'max_lon': 114.37,
            'min_lat': 30.53,
            'max_lat': 30.56,
        }
    },
    'zhongjia_cun': {
        'name': '汉阳钟家村',
        'type': '居住商业混合老城区',
        'bbox': {
            'min_lon': 114.20,
            'max_lon': 114.24,
            'min_lat': 30.535,
            'max_lat': 30.575,
        }
    }
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


def make_envelope(bbox):
    return f"ST_MakeEnvelope({bbox['min_lon']}, {bbox['min_lat']}, {bbox['max_lon']}, {bbox['max_lat']}, 4326)"


def export_pois_geojson(conn, area_key, area_info):
    """导出POI为GeoJSON"""
    bbox = area_info['bbox']
    area_name = area_info['name']
    print(f"  导出 {area_name} POI...")

    sql = f"""
    SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
            json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(p.geom)::json,
                'properties', json_build_object(
                    'id', p.id,
                    'name', p.name,
                    'category_big', p.category_big,
                    'category_mid', p.category_mid,
                    'category_small', p.category_small,
                    'land_use_type', p.land_use_type,
                    'aoi_type', p.aoi_type,
                    'aoi_name', p.aoi_name,
                    'nearest_road_class', p.nearest_road_class,
                    'nearest_road_dist_m', ROUND(p.nearest_road_dist_m::numeric, 1),
                    'poi_density_500m', p.poi_density_500m,
                    'category_entropy', ROUND(p.category_entropy_500m::numeric, 3),
                    'road_block_id', p.road_block_id
                )
            )
        )
    )::text as geojson
    FROM pois p
    WHERE p.geom && {make_envelope(bbox)}
    """

    cursor = conn.cursor()
    cursor.execute(sql)
    result = cursor.fetchone()[0]

    geojson = json.loads(result)

    # 创建区域子目录
    area_dir = OUTPUT_DIR / area_key
    area_dir.mkdir(exist_ok=True)

    with open(area_dir / 'pois.geojson', 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"    {len(geojson['features'])} 个POI -> {area_dir / 'pois.geojson'}")
    return len(geojson['features'])


def export_road_blocks_geojson(conn, area_key, area_info):
    """导出路网地块为GeoJSON"""
    bbox = area_info['bbox']
    area_name = area_info['name']
    print(f"  导出 {area_name} 路网地块...")

    sql = f"""
    SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
            json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(rb.geom)::json,
                'properties', json_build_object(
                    'id', rb.id,
                    'block_id', rb.block_id,
                    'area_sqm', ROUND(rb.shape_area::numeric),
                    'poi_count', rb.poi_count,
                    'dominant_category', rb.dominant_category,
                    'category_entropy', ROUND(rb.category_entropy::numeric, 3),
                    'street_block_id', rb.street_block_id
                )
            )
        )
    )::text as geojson
    FROM wuhan_road_blocks rb
    WHERE rb.geom && {make_envelope(bbox)}
    """

    cursor = conn.cursor()
    cursor.execute(sql)
    result = cursor.fetchone()[0]

    geojson = json.loads(result)
    area_dir = OUTPUT_DIR / area_key

    with open(area_dir / 'road_blocks.geojson', 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"    {len(geojson['features'])} 个地块 -> {area_dir / 'road_blocks.geojson'}")
    return len(geojson['features'])


def export_roads_geojson(conn, area_key, area_info):
    """导出路网为GeoJSON"""
    bbox = area_info['bbox']
    area_name = area_info['name']
    print(f"  导出 {area_name} 路网...")

    sql = f"""
    SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
            json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(r.geom)::json,
                'properties', json_build_object(
                    'id', r.id,
                    'name', r.properties->>'name',
                    'road_class', r.properties->>'fclass',
                    'oneway', r.properties->>'oneway',
                    'maxspeed', (r.properties->>'maxspeed')::int
                )
            )
        )
    )::text as geojson
    FROM wuhan_roads r
    WHERE r.geom && {make_envelope(bbox)}
    """

    cursor = conn.cursor()
    cursor.execute(sql)
    result = cursor.fetchone()[0]

    geojson = json.loads(result)
    area_dir = OUTPUT_DIR / area_key

    with open(area_dir / 'roads.geojson', 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"    {len(geojson['features'])} 条道路 -> {area_dir / 'roads.geojson'}")
    return len(geojson['features'])


def export_aois_geojson(conn, area_key, area_info):
    """导出AOI为GeoJSON"""
    bbox = area_info['bbox']
    area_name = area_info['name']
    print(f"  导出 {area_name} AOI...")

    sql = f"""
    SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
            json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(a.geom)::json,
                'properties', json_build_object(
                    'id', a.id,
                    'name', a.name,
                    'type', a.type,
                    'area_sqm', ROUND(a.area_sqm::numeric)
                )
            )
        )
    )::text as geojson
    FROM wuhan_osm_aoi a
    WHERE a.geom && {make_envelope(bbox)}
    """

    cursor = conn.cursor()
    cursor.execute(sql)
    result = cursor.fetchone()[0]

    geojson = json.loads(result)
    area_dir = OUTPUT_DIR / area_key

    with open(area_dir / 'aois.geojson', 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"    {len(geojson['features'])} 个AOI -> {area_dir / 'aois.geojson'}")
    return len(geojson['features'])


def export_landuse_geojson(conn, area_key, area_info):
    """导出土地利用为GeoJSON"""
    bbox = area_info['bbox']
    area_name = area_info['name']
    print(f"  导出 {area_name} 土地利用...")

    sql = f"""
    SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
            json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(e.geom)::json,
                'properties', json_build_object(
                    'id', e.id,
                    'land_type', e.land_type
                )
            )
        )
    )::text as geojson
    FROM wuhan_euluc e
    WHERE e.geom && {make_envelope(bbox)}
    """

    cursor = conn.cursor()
    cursor.execute(sql)
    result = cursor.fetchone()[0]

    geojson = json.loads(result)
    area_dir = OUTPUT_DIR / area_key

    with open(area_dir / 'landuse.geojson', 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"    {len(geojson['features'])} 个地块 -> {area_dir / 'landuse.geojson'}")
    return len(geojson['features'])


def main():
    print("=" * 60)
    print("导出GeoJSON数据 - 三个实验区域")
    print("=" * 60)

    OUTPUT_DIR.mkdir(exist_ok=True)

    conn = get_connection()

    try:
        stats = {}

        for area_key, area_info in EXPERIMENT_AREAS.items():
            print(f"\n{'='*50}")
            print(f"区域: {area_info['name']} ({area_info['type']})")
            bbox = area_info['bbox']
            print(f"范围: [{bbox['min_lon']}, {bbox['min_lat']}] - [{bbox['max_lon']}, {bbox['max_lat']}]")
            print(f"{'='*50}")

            area_dir = OUTPUT_DIR / area_key
            area_dir.mkdir(exist_ok=True)

            poi_count = export_pois_geojson(conn, area_key, area_info)
            block_count = export_road_blocks_geojson(conn, area_key, area_info)
            road_count = export_roads_geojson(conn, area_key, area_info)
            aoi_count = export_aois_geojson(conn, area_key, area_info)
            landuse_count = export_landuse_geojson(conn, area_key, area_info)

            stats[area_key] = {
                'name': area_info['name'],
                'type': area_info['type'],
                'pois': poi_count,
                'road_blocks': block_count,
                'roads': road_count,
                'aois': aoi_count,
                'landuse': landuse_count
            }

        # 汇总
        print("\n" + "=" * 60)
        print("导出完成！汇总：")
        print("=" * 60)
        print(f"{'区域':<15} {'类型':<15} {'POI':>8} {'地块':>8} {'道路':>8}")
        print("-" * 60)
        for area_key, s in stats.items():
            print(f"{s['name']:<15} {s['type']:<15} {s['pois']:>8} {s['road_blocks']:>8} {s['roads']:>8}")
        print("=" * 60)

        # 保存元数据
        metadata = {
            'areas': EXPERIMENT_AREAS,
            'stats': stats
        }
        with open(OUTPUT_DIR / 'metadata.json', 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    finally:
        conn.close()


if __name__ == '__main__':
    main()
