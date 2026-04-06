# -*- coding: utf-8 -*-
"""
数据库 Schema 扩展：添加 spatial_embedding 列

为 pois 表添加 352 维空间 embedding 存储支持。

运行：
    python scripts/data-prep/add_spatial_embedding.py

Author: Sisyphus
Date: 2026-03-20
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

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


def add_spatial_embedding_column():
    """添加 spatial_embedding 列"""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # 检查 pgvector 是否可用
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.commit()
            has_pgvector = True
            print("[DB] pgvector extension enabled")
        except Exception as e:
            conn.rollback()
            has_pgvector = False
            print(f"[DB] pgvector not available, using float[] fallback: {e}")

        # 添加 spatial_embedding 列（如果不存在）
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'pois' AND column_name = 'spatial_embedding'
        """)

        if cur.fetchone() is None:
            if has_pgvector:
                cur.execute("""
                    ALTER TABLE pois
                    ADD COLUMN spatial_embedding vector(352)
                """)
                print("[DB] Added spatial_embedding column (vector(352))")
            else:
                cur.execute("""
                    ALTER TABLE pois
                    ADD COLUMN spatial_embedding float[]
                """)
                print("[DB] Added spatial_embedding column (float[])")
        else:
            print("[DB] spatial_embedding column already exists")

        # 创建索引（仅 pgvector 支持 HNSW）
        if has_pgvector:
            cur.execute("""
                SELECT indexname
                FROM pg_indexes
                WHERE tablename = 'pois' AND indexname = 'pois_spatial_embedding_idx'
            """)

            if cur.fetchone() is None:
                print("[DB] Creating HNSW index on spatial_embedding...")
                cur.execute("""
                    CREATE INDEX pois_spatial_embedding_idx
                    ON pois
                    USING hnsw (spatial_embedding vector_cosine_ops)
                    WITH (m = 16, ef_construction = 64)
                """)
                print("[DB] HNSW index created")
            else:
                print("[DB] HNSW index already exists")
        else:
            # 对于 float[]，创建 GIN 索引（有限支持）
            print("[DB] Skipping index creation for float[] (use FAISS in application layer)")

        conn.commit()
        print("[DB] Schema migration completed successfully")

    except Exception as e:
        conn.rollback()
        print(f"[DB] Migration failed: {e}")
        raise
    finally:
        cur.close()
        conn.close()


def check_status():
    """检查当前状态"""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 统计总数
        cur.execute("SELECT COUNT(*) as total FROM pois")
        total = cur.fetchone()["total"]

        # 统计已生成 embedding 的数量
        cur.execute("SELECT COUNT(*) as with_emb FROM pois WHERE spatial_embedding IS NOT NULL")
        with_emb = cur.fetchone()["with_emb"]

        print(f"\n[Status]")
        print(f"  Total POIs: {total:,}")
        print(f"  With spatial_embedding: {with_emb:,} ({with_emb/total*100:.1f}%)")
        print(f"  Missing: {total - with_emb:,}")

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Add spatial_embedding column to pois table")
    parser.add_argument("--check", action="store_true", help="Only check status, don't migrate")
    args = parser.parse_args()

    if args.check:
        check_status()
    else:
        add_spatial_embedding_column()
        check_status()
