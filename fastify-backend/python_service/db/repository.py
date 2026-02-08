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

    @classmethod
    def _region_spatial_clauses(cls, regions: Any) -> Tuple[List[str], List[Any]]:
        """将多选区上下文转换为 SQL 空间子句（OR 并集）。"""
        if not isinstance(regions, (list, tuple)):
            return [], []

        clauses: List[str] = []
        params: List[Any] = []

        for region in regions:
            if not isinstance(region, dict):
                continue

            # 中文注释：优先使用前端预生成的 boundaryWKT，避免重复几何序列化导致精度漂移。
            region_wkt = region.get("boundaryWKT", region.get("wkt"))
            if isinstance(region_wkt, str) and region_wkt.strip():
                clauses.append("ST_Within(p.geom, ST_GeomFromText(%s, 4326))")
                params.append(region_wkt.strip())
                continue

            geometry = region.get("geometry")
            geometry_type = ""
            if isinstance(geometry, dict):
                geometry_type = str(geometry.get("type", "")).lower()

            if geometry_type == "polygon":
                ring = geometry.get("coordinates", [None])[0]
                polygon_wkt = cls._boundary_wkt(ring)
                if polygon_wkt:
                    clauses.append("ST_Within(p.geom, ST_GeomFromText(%s, 4326))")
                    params.append(polygon_wkt)
                    continue

            if geometry_type == "multipolygon":
                polygons = geometry.get("coordinates")
                if isinstance(polygons, (list, tuple)):
                    for poly in polygons:
                        if not isinstance(poly, (list, tuple)) or len(poly) == 0:
                            continue
                        polygon_wkt = cls._boundary_wkt(poly[0])
                        if polygon_wkt:
                            clauses.append("ST_Within(p.geom, ST_GeomFromText(%s, 4326))")
                            params.append(polygon_wkt)
                if clauses:
                    continue

            # 中文注释：圆形选区用中心点 + 半径表达，保持与前端 Circle 交互一致。
            center = None
            radius = 0.0
            if geometry_type == "point" and isinstance(geometry, dict):
                center = cls._normalize_point(geometry.get("coordinates"))
                try:
                    radius = float(geometry.get("radius", region.get("radius", 0)) or 0)
                except (TypeError, ValueError):
                    radius = 0.0

            if center is None:
                center = cls._normalize_point(region.get("center"))
            if radius <= 0:
                try:
                    radius = float(region.get("radius", 0) or 0)
                except (TypeError, ValueError):
                    radius = 0.0

            if center and radius > 0:
                clauses.append(
                    "ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)"
                )
                params.extend([center[0], center[1], radius])

        return clauses, params

    def fetch_pois(
        self,
        *,
        spatial_context: Dict[str, Any],
        categories: List[str],
        terms: List[str],
        limit: int = 5000,
        order_by_distance: bool = True,
    ) -> List[Dict[str, Any]]:
        """????? + ??/?????? POI?"""
        # Debug: log entry with spatial_context info
        import sys
        print(f"[POSTGIS_DEBUG] fetch_pois called", flush=True, file=sys.stderr)
        print(f"[POSTGIS_DEBUG] spatial_context keys: {list(spatial_context.keys()) if spatial_context else 'None'}", flush=True, file=sys.stderr)
        print(f"[POSTGIS_DEBUG] spatial_context: {spatial_context}", flush=True, file=sys.stderr)
        print(f"[POSTGIS_DEBUG] categories: {categories}", flush=True, file=sys.stderr)
        print(f"[POSTGIS_DEBUG] terms: {terms}", flush=True, file=sys.stderr)
        # ???????????????? null / ?????????????
        if not isinstance(spatial_context, dict):
            print(f"[POSTGIS_DEBUG] Warning: spatial_context is not dict, resetting to {{}}", flush=True, file=sys.stderr)
            spatial_context = {}

        boundary_wkt = self._boundary_wkt(spatial_context.get("boundary"))
        viewport_wkt = self._viewport_wkt(spatial_context.get("viewport"))
        region_clauses, region_params = self._region_spatial_clauses(spatial_context.get("regions"))

        center = self._normalize_point(spatial_context.get("center"))
        radius = float(spatial_context.get("radius", 0) or 0)

        where_parts: List[str] = []
        params: List[Any] = []
        order_sql = "ORDER BY p.id ASC" if order_by_distance else ""

        # ??????????????????????
        if region_clauses:
            # ???????????? OR ???????????????????????
            where_parts.append("(" + " OR ".join(region_clauses) + ")")
            params.extend(region_params)
            if order_by_distance:
                order_sql = "ORDER BY p.id ASC"
        elif boundary_wkt:
            # ??????? && ????????? ST_Within ????????????? CPU ???
            where_parts.append("p.geom && ST_GeomFromText(%s, 4326)")
            params.append(boundary_wkt)
            where_parts.append("ST_Within(p.geom, ST_GeomFromText(%s, 4326))")
            params.append(boundary_wkt)
            # ????????????????? KNN?????????????????
            if order_by_distance:
                order_sql = "ORDER BY p.geom <-> ST_Centroid(ST_GeomFromText(%s, 4326)) ASC"
        elif viewport_wkt:
            # ????????????????? + ????????????????
            where_parts.append("p.geom && ST_GeomFromText(%s, 4326)")
            params.append(viewport_wkt)
            where_parts.append("ST_Within(p.geom, ST_GeomFromText(%s, 4326))")
            params.append(viewport_wkt)
            if order_by_distance:
                order_sql = "ORDER BY p.geom <-> ST_Centroid(ST_GeomFromText(%s, 4326)) ASC"
        elif center and radius > 0:
            where_parts.append(
                "ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)"
            )
            params.extend([center[0], center[1], radius])
            # ?????????????????????????????
            if order_by_distance:
                order_sql = "ORDER BY p.geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326) ASC"
        else:
            print(f"[POSTGIS_DEBUG] No spatial constraint matched - returning empty", flush=True, file=sys.stderr)
            print(f"[POSTGIS_DEBUG] boundary_wkt: {boundary_wkt is not None}, viewport_wkt: {viewport_wkt is not None}, region_clauses: {len(region_clauses)}, center: {center is not None}, radius: {radius}", flush=True, file=sys.stderr)
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

        # ?????????????????????????????????
        if order_by_distance and order_sql.startswith("ORDER BY p.geom <-> ST_Centroid"):
            params.append(boundary_wkt or viewport_wkt)
        elif order_by_distance and order_sql.startswith("ORDER BY p.geom <-> ST_SetSRID") and center:
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
        
        # Debug: log SQL execution
        print(f"[POSTGIS_DEBUG] Executing SQL with {len(where_parts)} WHERE clauses, limit={limit}", flush=True, file=sys.stderr)
        print(f"[POSTGIS_DEBUG] SQL WHERE: {' AND '.join(where_parts)[:200]}...", flush=True, file=sys.stderr)

        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(sql, params)
                rows = cursor.fetchall()
        
        print(f"[POSTGIS_DEBUG] Query returned {len(rows)} rows", flush=True, file=sys.stderr)
        return [dict(row) for row in rows]


    def fetch_pois_by_wkt(
        self,
        *,
        boundary_wkt: str,
        categories: List[str] | None = None,
        limit: int = 12000,
        order_by_distance: bool = True,
    ) -> List[Dict[str, Any]]:
        """Query POIs inside a boundary WKT for region comparison."""
        if not isinstance(boundary_wkt, str) or not boundary_wkt.strip():
            return []

        # ??????? && ?????? within???????????????????
        where_parts: List[str] = [
            "p.geom && ST_GeomFromText(%s, 4326)",
            "ST_Within(p.geom, ST_GeomFromText(%s, 4326))",
        ]
        params: List[Any] = [boundary_wkt.strip(), boundary_wkt.strip()]

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

        order_sql = "ORDER BY p.geom <-> ST_Centroid(ST_GeomFromText(%s, 4326)) ASC" if order_by_distance else ""

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

        # ????????????????? centroid ????????? SQL ????????
        if order_by_distance:
            params.append(boundary_wkt.strip())
        params.append(int(limit))

        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(sql, params)
                rows = cursor.fetchall()

        return [dict(row) for row in rows]
