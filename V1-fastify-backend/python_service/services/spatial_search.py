# -*- coding: utf-8 -*-
"""
空间检索服务：PostGIS 空间过滤 + 向量相似度计算

从 Node.js faissIndex.js 迁移而来，职责：
1. PostGIS 空间过滤（利用 GiST 索引）
2. 向量相似度计算（numpy）
3. 融合排序

Author: Sisyphus
Date: 2026-03-21
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from db.repository import POIRepository


# 类别映射表：用户意图类别 → 数据库类别
CATEGORY_MAPPING = {
    # 餐饮美食
    "餐饮美食": ["餐饮美食"],
    "餐饮": ["餐饮美食"],
    "餐厅": ["餐饮美食"],
    "饭店": ["餐饮美食"],
    "美食": ["餐饮美食"],
    "小吃": ["餐饮美食"],
    "火锅": ["餐饮美食"],
    "烧烤": ["餐饮美食"],
    "快餐": ["餐饮美食"],
    "咖啡": ["餐饮美食"],
    "奶茶": ["餐饮美食"],
    "甜品": ["餐饮美食"],
    # 住宿
    "住宿服务": ["住宿服务"],
    "住宿": ["住宿服务", "酒店住宿"],
    "酒店": ["住宿服务", "酒店住宿"],
    "宾馆": ["住宿服务", "酒店住宿"],
    "旅馆": ["住宿服务", "酒店住宿"],
    "民宿": ["住宿服务", "酒店住宿"],
    # 金融
    "金融保险服务": ["金融保险服务"],
    "银行": ["金融保险服务"],
    "ATM": ["金融保险服务"],
    # 景点
    "风景名胜": ["风景名胜"],
    "景点": ["风景名胜", "旅游景点"],
    "公园": ["风景名胜", "旅游景点"],
    "旅游": ["风景名胜", "旅游景点"],
    # 娱乐
    "体育休闲服务": ["体育休闲服务"],
    "娱乐": ["体育休闲服务", "休闲娱乐"],
    "KTV": ["体育休闲服务", "休闲娱乐"],
    # 教育
    "科教文化服务": ["科教文化服务"],
    "教育": ["科教文化服务"],
    "学校": ["科教文化服务"],
    "大学": ["科教文化服务"],
    # 医疗
    "医疗保健服务": ["医疗保健服务"],
    "医院": ["医疗保健服务"],
    # 购物
    "购物服务": ["购物服务"],
    "购物": ["购物服务", "购物消费"],
    "超市": ["购物服务", "购物消费"],
}


@dataclass
class SearchResult:
    """检索结果"""
    id: int
    name: str
    category: str
    region_label: int
    lon: float
    lat: float
    distance_m: float
    semantic_score: float
    fused_score: float


class SpatialSearchService:
    """空间检索服务"""

    # 数据库列名映射（适配现有 schema）
    CATEGORY_COLUMN = "category_main"  # 主类别列

    def __init__(self, repository: Optional[POIRepository] = None):
        self.repository = repository or POIRepository()
        self._embedding_cache: Dict[int, np.ndarray] = {}
        self._embedding_dim = 352

    def _get_db_categories(self, user_categories: List[str]) -> List[str]:
        """将用户类别映射到数据库类别"""
        db_categories = []
        for cat in user_categories:
            if cat in CATEGORY_MAPPING:
                db_categories.extend(CATEGORY_MAPPING[cat])
            else:
                # 部分匹配
                for key, values in CATEGORY_MAPPING.items():
                    if cat in key or key in cat:
                        db_categories.extend(values)
                        break
        return list(set(db_categories))

    def _cosine_similarity(
        self,
        query_emb: np.ndarray,
        candidate_emb: np.ndarray
    ) -> float:
        """计算余弦相似度"""
        dot = np.dot(query_emb, candidate_emb)
        query_norm = np.linalg.norm(query_emb)
        cand_norm = np.linalg.norm(candidate_emb)
        if query_norm > 0 and cand_norm > 0:
            return float(dot / (query_norm * cand_norm))
        return 0.5

    def search(
        self,
        anchor: Tuple[float, float],
        radius: float,
        query_embedding: Optional[List[float]] = None,
        categories: Optional[List[str]] = None,
        target_region: Optional[int] = None,
        region_filter_mode: str = "boost",
        top_k: int = 20,
        spatial_weight: float = 0.6,
        semantic_weight: float = 0.4,
        region_weight: float = 0.15,
    ) -> List[SearchResult]:
        """
        混合检索：PostGIS 空间过滤 + 向量相似度

        Args:
            anchor: (lon, lat) 锚点坐标
            radius: 检索半径（米）
            query_embedding: 查询向量 (352 维)
            categories: 类别过滤
            target_region: 目标区域类型 (0-5)
            region_filter_mode: boost | strict
            top_k: 返回数量
            spatial_weight: 空间距离权重
            semantic_weight: 语义相似度权重
            region_weight: 区域加分权重

        Returns:
            List[SearchResult]: 检索结果列表
        """
        start_time = time.time()
        lon, lat = anchor

        # 映射类别
        db_categories = self._get_db_categories(categories or [])

        # 构建 SQL
        sql, params = self._build_search_sql(
            lon, lat, radius,
            db_categories,
            target_region if region_filter_mode == "strict" else None
        )

        # 执行查询
        with self.repository._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, params)
                columns = [desc[0] for desc in cursor.description]
                rows = cursor.fetchall()

        candidates = [dict(zip(columns, row)) for row in rows]

        # 如果严格过滤结果太少，回退到不带区域过滤
        if region_filter_mode == "strict" and target_region is not None and len(candidates) < 5:
            fallback_sql, fallback_params = self._build_search_sql(
                lon, lat, radius, db_categories, None
            )
            with self.repository._connect() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(fallback_sql, fallback_params)
                    columns = [desc[0] for desc in cursor.description]
                    fallback_rows = cursor.fetchall()

            for row in fallback_rows:
                row_dict = dict(zip(columns, row))
                if not any(c["id"] == row_dict["id"] for c in candidates):
                    candidates.append(row_dict)

        if not candidates:
            return []

        # 计算语义相似度
        query_emb = np.array(query_embedding, dtype=np.float32) if query_embedding else None

        results = []
        max_dist = max(float(c.get("distance_m", 0)) for c in candidates) if candidates else 1

        for c in candidates:
            distance_m = float(c.get("distance_m", 0))

            # 计算语义相似度
            semantic_score = 0.5
            if query_emb is not None:
                emb = c.get("spatial_embedding")
                if emb is not None:
                    if isinstance(emb, str):
                        try:
                            emb = json.loads(emb)
                        except:
                            emb = None
                    if emb is not None:
                        cand_emb = np.array(emb, dtype=np.float32)
                        semantic_score = self._cosine_similarity(query_emb, cand_emb)

            # 计算空间分数
            spatial_score = 1 - (distance_m / max_dist) if max_dist > 0 else 0.5

            # 区域加分
            region_boost = 0
            if target_region is not None and c.get("region_label") == target_region:
                region_boost = region_weight

            # 融合分数
            fused_score = (
                spatial_weight * spatial_score +
                semantic_weight * semantic_score +
                region_boost
            )

            results.append(SearchResult(
                id=int(c["id"]),
                name=c.get("name", ""),
                category=c.get("category", ""),
                region_label=c.get("region_label", -1) or 0,
                lon=float(c.get("lon", 0)),
                lat=float(c.get("lat", 0)),
                distance_m=distance_m,
                semantic_score=semantic_score,
                fused_score=fused_score,
            ))

        # 排序并返回 top_k
        results.sort(key=lambda x: x.fused_score, reverse=True)
        return results[:top_k]

    def _build_search_sql(
        self,
        lon: float,
        lat: float,
        radius: float,
        categories: List[str],
        target_region: Optional[int],
    ) -> Tuple[str, List[Any]]:
        """构建空间检索 SQL"""
        # 参数按 SQL 中从左到右、从上到下的顺序绑定
        # SELECT 子句中的 ST_MakePoint 会先被绑定

        params: List[Any] = [lon, lat]  # SELECT 中的 distance_m 计算锚点

        where_parts = [
            "ST_DWithin(geom::geography, ST_MakePoint(%s, %s)::geography, %s)"
        ]
        params.extend([lon, lat, radius])  # WHERE 中的锚点和半径

        if categories:
            where_parts.append("category_main = ANY(%s)")
            params.append(categories)

        if target_region is not None:
            where_parts.append("region_label = %s")
            params.append(target_region)

        where_clause = ' AND '.join(where_parts)

        sql = f"""
            SELECT
                id,
                name,
                COALESCE(category_sub, category_main) as category,
                region_label,
                ST_X(geom) AS lon,
                ST_Y(geom) AS lat,
                ST_Distance(geom::geography, ST_MakePoint(%s, %s)::geography) as distance_m,
                spatial_embedding
            FROM pois
            WHERE {where_clause}
            ORDER BY distance_m
            LIMIT 100
        """

        return sql, params


# 全局实例
_spatial_search_service: Optional[SpatialSearchService] = None


def get_spatial_search_service() -> SpatialSearchService:
    """获取空间检索服务单例"""
    global _spatial_search_service
    if _spatial_search_service is None:
        _spatial_search_service = SpatialSearchService()
    return _spatial_search_service
