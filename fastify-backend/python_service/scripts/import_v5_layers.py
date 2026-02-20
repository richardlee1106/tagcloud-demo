"""
将三份矢量面数据导入 PostGIS。

目标表：
  1. wuhan_road_blocks  — 路网闭合地块 (43515 条)
  2. wuhan_osm_aoi      — OSM AOI 合并面 (35384 条)
  3. wuhan_euluc         — EULUC 用地 (38422 条)

每张表自动：
  - 创建 geometry 列 (SRID=4326)
  - 建立 GIST 空间索引
  - 建立属性索引

用法：
  python import_v5_layers.py
"""

from __future__ import annotations

import json
import os
import sys
import time

import psycopg2
from psycopg2.extras import execute_values
from shapely.geometry import shape

# ---------- 数据库配置 ----------
DSN = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", "123456"),
    "dbname": os.getenv("POSTGRES_DATABASE", "geoloom"),
}

# ---------- 源文件路径 ----------
DATA_DIR = r"d:\AAA_Edu\TagCloud\vite-project\newdata"

LAYERS = [
    {
        "file": os.path.join(DATA_DIR, "路网转面处理后的未知地块.geojson"),
        "table": "wuhan_road_blocks",
        "columns": [
            ("block_id", "INTEGER"),          # 来自 OBJECTID
            ("shape_length", "DOUBLE PRECISION"),
            ("shape_area", "DOUBLE PRECISION"),
        ],
        "extract": lambda props: (
            int(props.get("OBJECTID", 0)),
            float(props.get("Shape_Length", 0)),
            float(props.get("Shape_Area", 0)),
        ),
        "extra_indexes": [
            "CREATE INDEX IF NOT EXISTS idx_{table}_block_id ON {table} (block_id);",
        ],
    },
    {
        "file": os.path.join(DATA_DIR, "OSM_AOI_merge.geojson"),
        "table": "wuhan_osm_aoi",
        "columns": [
            ("aoi_id", "INTEGER"),            # 来自 OBJECTID
            ("osm_id", "TEXT"),
            ("code", "INTEGER"),
            ("name", "TEXT"),                  # AOI 名称（如"沙湖"、"光谷广场"）
            ("type", "TEXT"),                  # 中文类别（如"水域"、"公园"）
        ],
        "extract": lambda props: (
            int(props.get("OBJECTID", 0)),
            str(props.get("osm_id", "")),
            int(props.get("code", 0)),
            str(props.get("name", "") or ""),
            str(props.get("type", "") or ""),
        ),
        "extra_indexes": [
            "CREATE INDEX IF NOT EXISTS idx_{table}_name ON {table} (name);",
            "CREATE INDEX IF NOT EXISTS idx_{table}_type ON {table} (type);",
            "CREATE INDEX IF NOT EXISTS idx_{table}_aoi_id ON {table} (aoi_id);",
        ],
    },
    {
        "file": os.path.join(DATA_DIR, "EULUC用地情况.geojson"),
        "table": "wuhan_euluc",
        "columns": [
            ("euluc_id", "INTEGER"),          # 来自 OBJECTID
            ("land_type", "TEXT"),             # 来自"类别"
            ("shape_length", "DOUBLE PRECISION"),
            ("shape_area", "DOUBLE PRECISION"),
        ],
        "extract": lambda props: (
            int(props.get("OBJECTID", 0)),
            str(props.get("类别", "") or ""),
            float(props.get("Shape_Length", 0)),
            float(props.get("Shape_Area", 0)),
        ),
        "extra_indexes": [
            "CREATE INDEX IF NOT EXISTS idx_{table}_land_type ON {table} (land_type);",
            "CREATE INDEX IF NOT EXISTS idx_{table}_euluc_id ON {table} (euluc_id);",
        ],
    },
]

BATCH_SIZE = 500  # 每批插入量


def _read_geojson(filepath: str):
    """读取 GeoJSON 文件，返回 feature 列表。"""
    print(f"  读取文件: {filepath}")
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    features = data.get("features", [])
    print(f"  要素数量: {len(features)}")
    return features


def _ensure_table(conn, layer: dict):
    """创建表（如已存在则先删除），并建立索引。"""
    table = layer["table"]
    col_defs = ", ".join(f"{name} {dtype}" for name, dtype in layer["columns"])

    with conn.cursor() as cur:
        cur.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
        cur.execute(f"""
            CREATE TABLE {table} (
                id SERIAL PRIMARY KEY,
                {col_defs},
                geom GEOMETRY(Polygon, 4326)
            );
        """)
        # GIST 空间索引
        cur.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_geom ON {table} USING GIST (geom);")
        # 额外属性索引
        for idx_sql in layer.get("extra_indexes", []):
            cur.execute(idx_sql.format(table=table))
    conn.commit()
    print(f"  表 {table} 创建完成，索引已建立")


def _insert_features(conn, layer: dict, features: list):
    """批量导入要素到 PostGIS。"""
    table = layer["table"]
    extract_fn = layer["extract"]
    col_names = [name for name, _ in layer["columns"]]
    placeholders = ", ".join(["%s"] * len(col_names)) + ", ST_GeomFromText(%s, 4326)"
    insert_sql = f"INSERT INTO {table} ({', '.join(col_names)}, geom) VALUES ({placeholders})"

    inserted = 0
    skipped = 0
    batch = []

    for feat in features:
        geom = feat.get("geometry")
        props = feat.get("properties", {})
        if geom is None:
            skipped += 1
            continue

        try:
            shapely_geom = shape(geom)
            if shapely_geom.is_empty:
                skipped += 1
                continue
            # 确保是 Polygon (MultiPolygon 取最大的)
            if shapely_geom.geom_type == "MultiPolygon":
                shapely_geom = max(shapely_geom.geoms, key=lambda g: g.area)
            if shapely_geom.geom_type != "Polygon":
                skipped += 1
                continue
            wkt = shapely_geom.wkt
        except Exception:
            skipped += 1
            continue

        values = extract_fn(props)
        batch.append((*values, wkt))

        if len(batch) >= BATCH_SIZE:
            with conn.cursor() as cur:
                cur.executemany(insert_sql, batch)
            conn.commit()
            inserted += len(batch)
            batch = []
            sys.stdout.write(f"\r  已插入: {inserted}")
            sys.stdout.flush()

    # 剩余
    if batch:
        with conn.cursor() as cur:
            cur.executemany(insert_sql, batch)
        conn.commit()
        inserted += len(batch)

    print(f"\r  已插入: {inserted}, 跳过: {skipped}")
    return inserted


def _analyze_table(conn, table: str):
    """运行 ANALYZE 更新统计信息，优化空间查询。"""
    with conn.cursor() as cur:
        cur.execute(f"ANALYZE {table};")
    conn.commit()
    print(f"  ANALYZE {table} 完成")


def main():
    print("=" * 60)
    print("Composite V5 数据入库脚本")
    print("=" * 60)

    conn = psycopg2.connect(**DSN)
    try:
        for layer in LAYERS:
            table = layer["table"]
            filepath = layer["file"]
            print(f"\n{'─' * 40}")
            print(f"[{table}]")

            if not os.path.isfile(filepath):
                print(f"  ⚠ 文件不存在: {filepath}, 跳过")
                continue

            features = _read_geojson(filepath)
            _ensure_table(conn, layer)

            t0 = time.time()
            count = _insert_features(conn, layer, features)
            elapsed = time.time() - t0
            print(f"  耗时: {elapsed:.1f}s ({count / max(elapsed, 0.01):.0f} 条/秒)")

            _analyze_table(conn, table)

        # 验证统计
        print(f"\n{'═' * 60}")
        print("入库验证:")
        with conn.cursor() as cur:
            for layer in LAYERS:
                table = layer["table"]
                cur.execute(f"SELECT COUNT(*) FROM {table};")
                row_count = cur.fetchone()[0]
                cur.execute(f"SELECT COUNT(*) FROM {table} WHERE geom IS NOT NULL;")
                geom_count = cur.fetchone()[0]
                print(f"  {table}: {row_count} 行, {geom_count} 条有效几何")

    finally:
        conn.close()

    print("\n✅ 全部入库完成！")


if __name__ == "__main__":
    main()
