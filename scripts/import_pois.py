# -*- coding: utf-8 -*-
"""
快速导入 POI 数据到 PostGIS

用法：
  python scripts/import_pois.py

数据源：d:/AAA_Edu/TagCloud/POI.geojson
目标表：pois
"""

import json
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

# 数据库连接配置
DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", "5300")),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", "123456"),
    "dbname": os.getenv("POSTGRES_DATABASE", "geoloom"),
}

POI_FILE = Path("d:/AAA_Edu/TagCloud/POI.geojson")


def create_pois_table(conn):
    """创建 pois 表"""
    sql = """
    DROP TABLE IF EXISTS pois CASCADE;
    
    CREATE TABLE pois (
        id SERIAL PRIMARY KEY,
        object_id INTEGER,
        name TEXT,
        category_main TEXT,
        category_sub TEXT,
        longitude DOUBLE PRECISION,
        latitude DOUBLE PRECISION,
        province TEXT,
        city TEXT,
        district TEXT,
        properties JSONB,
        geom GEOMETRY(Point, 4326)
    );
    
    CREATE INDEX idx_pois_geom ON pois USING GIST(geom);
    CREATE INDEX idx_pois_category ON pois(category_main);
    CREATE INDEX idx_pois_district ON pois(district);
    """
    
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print("Created pois table with indexes")


def import_pois(conn, batch_size=5000):
    """导入 POI 数据"""
    print(f"Loading POI data from {POI_FILE}...")
    
    with open(POI_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    features = data.get('features', [])
    total = len(features)
    print(f"Found {total} POIs")
    
    # 准备批量插入
    rows = []
    for i, feat in enumerate(features):
        props = feat.get('properties', {})
        geom = feat.get('geometry', {})
        coords = geom.get('coordinates', [0, 0])
        
        row = (
            props.get('OBJECTID'),
            props.get('名称'),
            props.get('大类'),
            props.get('中类'),
            props.get('经度', coords[0]),
            props.get('纬度', coords[1]),
            props.get('省份'),
            props.get('城市'),
            props.get('区域'),
            json.dumps(props),
            f"SRID=4326;POINT({coords[0]} {coords[1]})",
        )
        rows.append(row)
        
        if len(rows) >= batch_size:
            insert_batch(conn, rows)
            print(f"  Imported {i+1}/{total} POIs...")
            rows = []
    
    if rows:
        insert_batch(conn, rows)
    
    print(f"Successfully imported {total} POIs")


def insert_batch(conn, rows):
    """批量插入数据"""
    sql = """
    INSERT INTO pois (
        object_id, name, category_main, category_sub,
        longitude, latitude, province, city, district,
        properties, geom
    ) VALUES %s
    """
    
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()


def main():
    print("Connecting to database...")
    conn = psycopg2.connect(**DB_CONFIG)
    
    try:
        create_pois_table(conn)
        import_pois(conn)
        
        # 验证
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM pois")
            count = cur.fetchone()[0]
            print(f"\nFinal count: {count} POIs in database")
            
            cur.execute("SELECT category_main, COUNT(*) FROM pois GROUP BY category_main ORDER BY COUNT(*) DESC LIMIT 10")
            print("\nTop 10 categories:")
            for row in cur.fetchall():
                print(f"  {row[0]}: {row[1]}")
    
    finally:
        conn.close()
        print("\nDone!")


if __name__ == "__main__":
    main()
