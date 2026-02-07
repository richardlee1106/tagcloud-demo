"""PostGIS 仓储层。

目标：
- 封装 Python 计算服务访问数据库的最小查询集合。
- 严格与现有 `pois` schema 对齐，不新增业务列依赖。
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg2
from psycopg2.extras import RealDictCursor


class POIRepository:
    """POI 数据访问对象。"""

    def __init__(self) -> None:
        self._dsn = {
            "host": os.getenv("POSTGRES_HOST", "localhost"),
            "port": int(os.getenv("POSTGRES_PORT", "5432")),
            "user": os.getenv("POSTGRES_USER", "postgres"),
            "password": os.getenv("POSTGRES_PASSWORD", "123456"),
            "dbname": os.getenv("POSTGRES_DATABASE", "geoloom"),
        }

    @contextmanager
    def _connect(self):
        """数据库连接上下文。"""
        conn = psycopg2.connect(**self._dsn)
        try:
            yield conn
        finally:
            conn.close()

    @staticmethod
    def _normalize_point(raw: Any) -> Optional[Tuple[float, float]]:
        """将输入点规整为 (lon, lat)。"""
        if raw is None:
            return None

        if isinstance(raw, (list, tuple)) and len(raw) >= 2:
            try:
                return float(raw[0]), float(raw[1])
            except (TypeError, ValueError):
                return None

        if isinstance(raw, dict):
            lon = raw.get("lon", raw.get("lng", raw.get("longitude")))
            lat = raw.get("lat", raw.get("latitude"))
            if lon is None or lat is None:
                return None
            try:
                return float(lon), float(lat)
            except (TypeError, ValueError):
                return None

        return None

    @classmethod
    def _boundary_wkt(cls, boundary: Iterable[Any] | None) -> Optional[str]:
        """?????????? WKT?"""
        # ????? boundary=null??????? NoneType ?????
        if not isinstance(boundary, (list, tuple)):
            return None

        points: List[Tuple[float, float]] = []
        for raw in boundary:
            point = cls._normalize_point(raw)
            if point is not None:
                points.append(point)

        if len(points) < 3:
            return None

        if points[0] != points[-1]:
            points.append(points[0])

        coord_text = ", ".join(f"{lon} {lat}" for lon, lat in points)
        return f"POLYGON(({coord_text}))"

    @classmethod
    def _viewport_wkt(cls, viewport: Any) -> Optional[str]:
        """将 bbox 视口转换为 WKT 多边形。"""
        if not isinstance(viewport, (list, tuple)) or len(viewport) < 4:
            return None

        try:
            min_lon, min_lat, max_lon, max_lat = map(float, viewport[:4])
        except (TypeError, ValueError):
            return None

        return (
            "POLYGON(("
            f"{min_lon} {min_lat}, "
            f"{max_lon} {min_lat}, "
            f"{max_lon} {max_lat}, "
            f"{min_lon} {max_lat}, "
            f"{min_lon} {min_lat}"
            "))"
        )

    def fetch_pois(
        self,
        *,
        spatial_context: Dict[str, Any],
        categories: List[str],
        terms: List[str],
        limit: int = 5000,
    ) -> List[Dict[str, Any]]:
        """按空间约束 + 类别/文本过滤查询 POI。"""
        # 中文注释：容错处理，防止上游传入 null / 非对象导致字段访问异常。
        if not isinstance(spatial_context, dict):
            spatial_context = {}

        boundary_wkt = self._boundary_wkt(spatial_context.get("boundary"))
        viewport_wkt = self._viewport_wkt(spatial_context.get("viewport"))

        center = self._normalize_point(spatial_context.get("center"))
        radius = float(spatial_context.get("radius", 0) or 0)

        where_parts: List[str] = []
        params: List[Any] = []
        order_sql = "ORDER BY p.id ASC"

        # 关键守卫：必须有空间约束，避免误触全表扫描。
        if boundary_wkt:
            where_parts.append("ST_Within(p.geom, ST_GeomFromText(%s, 4326))")
            params.append(boundary_wkt)
            # 中文注释：边界查询按边界中心做 KNN 排序，避免 LIMIT 截断只落在某个类目。
            order_sql = "ORDER BY p.geom <-> ST_Centroid(ST_GeomFromText(%s, 4326)) ASC"
        elif viewport_wkt:
            where_parts.append("ST_Within(p.geom, ST_GeomFromText(%s, 4326))")
            params.append(viewport_wkt)
            # 中文注释：视口查询同样使用中心点排序，保证“全类目”场景结果更具代表性。
            order_sql = "ORDER BY p.geom <-> ST_Centroid(ST_GeomFromText(%s, 4326)) ASC"
        elif center and radius > 0:
            where_parts.append(
                "ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)"
            )
            params.extend([center[0], center[1], radius])
            # 中文注释：圆形搜索按圆心邻近度排序，贴合“附近”语义预期。
            order_sql = "ORDER BY p.geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326) ASC"
        else:
            return []

        normalized_categories = [c.strip() for c in (categories or []) if isinstance(c, str) and c.strip()]
        if normalized_categories:
            cat_parts = []
            for cat in normalized_categories:
                cat_parts.append(
                    "(p.category_big ILIKE %s OR p.category_mid ILIKE %s OR p.category_small ILIKE %s OR p.type ILIKE %s)"
                )
                wildcard = f"%{cat}%"
                params.extend([wildcard, wildcard, wildcard, wildcard])
            where_parts.append("(" + " OR ".join(cat_parts) + ")")

        normalized_terms = [t.strip() for t in (terms or []) if isinstance(t, str) and t.strip()]
        if normalized_terms:
            term_parts = []
            for term in normalized_terms:
                term_parts.append(
                    "(p.name ILIKE %s OR p.address ILIKE %s OR p.category_small ILIKE %s OR p.type ILIKE %s)"
                )
                wildcard = f"%{term}%"
                params.extend([wildcard, wildcard, wildcard, wildcard])
            where_parts.append("(" + " OR ".join(term_parts) + ")")

        # 中文注释：补齐排序子句参数，复用已校验输入，避免重复解析几何对象。
        if order_sql.startswith("ORDER BY p.geom <-> ST_Centroid"):
            params.append(boundary_wkt or viewport_wkt)
        elif order_sql.startswith("ORDER BY p.geom <-> ST_SetSRID") and center:
            params.extend([center[0], center[1]])

        sql = """
            SELECT
                p.id,
                p.name,
                p.address,
                p.type,
                p.category_big,
                p.category_mid,
                p.category_small,
                NULL::double precision AS rating,
                ST_X(p.geom) AS lon,
                ST_Y(p.geom) AS lat
            FROM pois p
            WHERE
        """ + " AND ".join(where_parts) + f" {order_sql} LIMIT %s"

        params.append(int(limit))

        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(sql, params)
                rows = cursor.fetchall()

        return [dict(row) for row in rows]


    def fetch_pois_by_wkt(
        self,
        *,
        boundary_wkt: str,
        categories: List[str] | None = None,
        limit: int = 12000,
    ) -> List[Dict[str, Any]]:
        """Query POIs inside a boundary WKT for region comparison."""
        if not isinstance(boundary_wkt, str) or not boundary_wkt.strip():
            return []

        where_parts: List[str] = ["ST_Within(p.geom, ST_GeomFromText(%s, 4326))"]
        params: List[Any] = [boundary_wkt.strip()]

        normalized_categories = [c.strip() for c in (categories or []) if isinstance(c, str) and c.strip()]
        if normalized_categories:
            cat_parts = []
            for cat in normalized_categories:
                cat_parts.append(
                    "(p.category_big ILIKE %s OR p.category_mid ILIKE %s OR p.category_small ILIKE %s OR p.type ILIKE %s)"
                )
                wildcard = f"%{cat}%"
                params.extend([wildcard, wildcard, wildcard, wildcard])
            where_parts.append("(" + " OR ".join(cat_parts) + ")")

        sql = """
            SELECT
                p.id,
                p.name,
                p.address,
                p.type,
                p.category_big,
                p.category_mid,
                p.category_small,
                NULL::double precision AS rating,
                ST_X(p.geom) AS lon,
                ST_Y(p.geom) AS lat
            FROM pois p
            WHERE
        """ + " AND ".join(where_parts) + " ORDER BY p.geom <-> ST_Centroid(ST_GeomFromText(%s, 4326)) ASC LIMIT %s"

        # 中文注释：区域对比也按边界中心做空间排序，降低导入顺序对统计结论的干扰。
        params.append(boundary_wkt.strip())
        params.append(int(limit))

        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(sql, params)
                rows = cursor.fetchall()

        return [dict(row) for row in rows]
