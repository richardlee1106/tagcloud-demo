# -*- coding: utf-8 -*-
"""
批量生成 POI spatial_embedding

为所有 POI 生成 352 维空间 embedding 并存入数据库。

运行：
    python -m V1-fastify-backend.python_service.scripts.generate_spatial_embeddings --batch 1000

Author: Sisyphus
Date: 2026-03-20
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path

import numpy as np

# 添加项目路径
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

import psycopg2
from psycopg2.extras import RealDictCursor


def get_db_connection():
    """获取数据库连接"""
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "15432")),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "123456"),
        database=os.getenv("POSTGRES_DATABASE", "geoloom"),
    )


# 坐标归一化参数（武汉三镇）
LNG_MIN, LNG_MAX = 113.70, 114.65
LAT_MIN, LAT_MAX = 30.39, 30.79
CITY_CENTER_LNG, CITY_CENTER_LAT = 114.305, 30.593


def build_features_from_record(record: dict) -> np.ndarray:
    """
    从数据库记录构建 72 维特征

    Returns:
        features: [72] 拼接后的特征向量
    """
    lon = float(record.get("lon", record.get("longitude", 114.3)))
    lat = float(record.get("lat", record.get("latitude", 30.6)))

    norm_lng = (lon - LNG_MIN) / (LNG_MAX - LNG_MIN)
    norm_lat = (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)

    # ---- point_features [32] ----
    point_features = np.zeros(32, dtype=np.float32)
    point_features[0] = norm_lng
    point_features[1] = norm_lat
    # TODO: 从 DB 加载完整的 K-NN 类别分布等特征

    # ---- line_features [16] ----
    line_features = np.zeros(16, dtype=np.float32)
    line_features[0] = norm_lng
    line_features[1] = norm_lat

    # ---- polygon_features [16] ----
    polygon_features = np.zeros(16, dtype=np.float32)
    polygon_features[0] = norm_lng
    polygon_features[1] = norm_lat

    # ---- direction_features [8] ----
    dx = lon - CITY_CENTER_LNG
    dy = lat - CITY_CENTER_LAT
    angle = math.atan2(dy, dx)
    direction = int((angle + math.pi) / (math.pi / 4)) % 8
    direction_features = np.zeros(8, dtype=np.float32)
    direction_features[direction] = 1.0

    return np.concatenate([point_features, line_features, polygon_features, direction_features])


def main(batch_size: int = 500, limit: int = None):
    """批量生成并存储 spatial_embedding"""
    import torch

    # 加载编码器服务
    sys.path.insert(0, str(PROJECT_ROOT / "V1-fastify-backend"))
    from python_service.pipeline.poi_encoder_service import POIEncoderService
    service = POIEncoderService()

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 统计总数
        cur.execute("SELECT COUNT(*) as total FROM pois WHERE spatial_embedding IS NULL")
        total = cur.fetchone()["total"]
        if limit:
            total = min(total, limit)

        print(f"[Embedding] {total:,} POIs to process")

        processed = 0
        start_time = time.time()

        while processed < total:
            # 分批读取
            sql = f"""
                SELECT id, name, ST_X(geom) AS lon, ST_Y(geom) AS lat
                FROM pois
                WHERE spatial_embedding IS NULL
                ORDER BY id
                LIMIT {batch_size}
            """
            cur.execute(sql)
            batch = cur.fetchall()

            if not batch:
                break

            # 构建特征
            features = np.array([build_features_from_record(r) for r in batch])
            point_features = features[:, :32]
            line_features = features[:, 32:48]
            polygon_features = features[:, 48:64]
            direction_features = features[:, 64:72]

            # 生成 embedding
            embeddings = service.encode_features(
                point_features, line_features, polygon_features, direction_features,
                batch_size=256,
            )

            # 批量更新
            for i, record in enumerate(batch):
                emb_list = embeddings[i].tolist()
                cur.execute(
                    "UPDATE pois SET spatial_embedding = %s WHERE id = %s",
                    (emb_list, record["id"]),
                )

            conn.commit()
            processed += len(batch)

            # 进度
            elapsed = time.time() - start_time
            rate = processed / elapsed
            eta = (total - processed) / rate if rate > 0 else 0
            print(f"[Embedding] {processed:,}/{total:,} ({processed/total*100:.1f}%) - {rate:.1f}/s - ETA: {eta/60:.1f}min")

        elapsed = time.time() - start_time
        print(f"[Embedding] Completed! {processed:,} POIs in {elapsed:.1f}s ({processed/elapsed:.1f}/s)")

    except Exception as e:
        conn.rollback()
        print(f"[Embedding] Error: {e}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate spatial embeddings for POIs")
    parser.add_argument("--batch", type=int, default=500, help="Batch size for processing")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of POIs to process")
    args = parser.parse_args()

    main(batch_size=args.batch, limit=args.limit)
