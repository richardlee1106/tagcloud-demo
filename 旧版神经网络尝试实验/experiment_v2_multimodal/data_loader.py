# -*- coding: utf-8 -*-
"""
V2 数据加载模块

从PostGIS数据库加载多模态空间数据
"""

import psycopg2
import numpy as np
import torch
from torch_geometric.data import Data as PyGData
from typing import Dict, List, Tuple, Optional


class V2DataLoader:
    """
    V2多模态数据加载器
    """

    def __init__(self, db_config: Dict):
        """
        Args:
            db_config: {
                'host': 'localhost',
                'port': 5432,
                'user': 'postgres',
                'password': 'xxx',
                'database': 'geoloom'
            }
        """
        self.db_config = db_config
        self.conn = None

    def connect(self):
        """建立数据库连接"""
        self.conn = psycopg2.connect(**self.db_config)
        return self.conn

    def close(self):
        """关闭连接"""
        if self.conn:
            self.conn.close()

    def load_pois(self, limit: Optional[int] = None, area_filter: Optional[str] = None) -> Dict:
        """
        加载POI数据

        Args:
            limit: 限制数量（用于测试）
            area_filter: 区域过滤条件，如 "district = '洪山区'"

        Returns:
            dict: {
                'features': np.array [N, F],
                'coords': np.array [N, 2],
                'labels': np.array [N],
                'aoi_ids': np.array [N],
                'road_classes': np.array [N],
                'metadata': dict
            }
        """
        cur = self.conn.cursor()

        # 构建SQL
        sql = """
            SELECT
                id,
                ST_X(geom) as lng,
                ST_Y(geom) as lat,
                category_big,
                category_mid,
                category_small,
                land_use_type,
                nearest_road_class,
                nearest_road_dist_m,
                poi_density_500m,
                category_entropy_500m,
                aoi_id,
                aoi_type,
                street_block_id,
                road_block_id
            FROM pois
            WHERE geom IS NOT NULL
        """

        if area_filter:
            sql += f" AND {area_filter}"

        sql += " ORDER BY id"

        if limit:
            sql += f" LIMIT {limit}"

        cur.execute(sql)
        rows = cur.fetchall()

        print(f"[V2] 加载了 {len(rows)} 个POI")

        # 解析数据
        ids = []
        coords = []
        categories = []
        landuses = []
        road_classes = []
        densities = []
        entropies = []
        aoi_ids = []
        street_block_ids = []

        # 类别映射
        category_map = {}
        landuse_map = {}
        road_class_map = {}

        for row in rows:
            ids.append(row[0])
            coords.append([row[1], row[2]])  # lng, lat

            # 类别
            cat = row[3] if row[3] else 'unknown'
            if cat not in category_map:
                category_map[cat] = len(category_map)
            categories.append(category_map[cat])

            # 土地利用
            lu = row[6] if row[6] else 'unknown'
            if lu not in landuse_map:
                landuse_map[lu] = len(landuse_map)
            landuses.append(landuse_map[lu])

            # 道路等级
            rc = row[7] if row[7] else 'unknown'
            if rc not in road_class_map:
                road_class_map[rc] = len(road_class_map)
            road_classes.append(road_class_map[rc])

            # 数值特征
            densities.append(row[9] if row[9] else 0)
            entropies.append(row[10] if row[10] else 0)

            # 关联ID
            aoi_ids.append(row[11] if row[11] else -1)
            street_block_ids.append(row[13] if row[13] else -1)

        return {
            'ids': np.array(ids),
            'coords': np.array(coords, dtype=np.float32),
            'categories': np.array(categories, dtype=np.int64),
            'landuses': np.array(landuses, dtype=np.int64),
            'road_classes': np.array(road_classes, dtype=np.int64),
            'densities': np.array(densities, dtype=np.float32),
            'entropies': np.array(entropies, dtype=np.float32),
            'aoi_ids': np.array(aoi_ids, dtype=np.int64),
            'street_block_ids': np.array(street_block_ids, dtype=np.int64),
            'metadata': {
                'num_pois': len(rows),
                'num_categories': len(category_map),
                'num_landuses': len(landuse_map),
                'num_road_classes': len(road_class_map),
                'category_map': category_map,
                'landuse_map': landuse_map,
                'road_class_map': road_class_map,
            }
        }

    def load_road_network(self) -> Dict:
        """
        加载道路网络数据

        提取道路交叉口作为节点，道路段作为边
        """
        cur = self.conn.cursor()

        # 提取道路端点作为交叉口节点
        sql = """
            SELECT
                id,
                properties->>'name' as name,
                properties->>'class' as road_class,
                properties->>'fclass' as fclass,
                ST_AsText(geom) as geom_text
            FROM wuhan_roads
            WHERE geom IS NOT NULL
            LIMIT 10000
        """

        cur.execute(sql)
        rows = cur.fetchall()

        print(f"[V2] 加载了 {len(rows)} 条道路")

        # 解析道路几何，提取交叉口
        # 简化处理：提取道路起点和终点作为节点
        nodes = {}
        edges = []

        for row in rows:
            road_id = row[0]
            geom_text = row[4]

            # 解析LINESTRING
            if geom_text and 'LINESTRING' in geom_text:
                # 提取坐标点
                coords_str = geom_text.replace('LINESTRING(', '').replace(')', '')
                coords = []
                for pair in coords_str.split(','):
                    parts = pair.strip().split()
                    if len(parts) >= 2:
                        lng, lat = float(parts[0]), float(parts[1])
                        coords.append((lng, lat))

                if len(coords) >= 2:
                    # 起点和终点作为交叉口
                    start = coords[0]
                    end = coords[-1]

                    # 添加节点
                    start_key = f"{start[0]:.6f}_{start[1]:.6f}"
                    end_key = f"{end[0]:.6f}_{end[1]:.6f}"

                    if start_key not in nodes:
                        nodes[start_key] = len(nodes)
                    if end_key not in nodes:
                        nodes[end_key] = len(nodes)

                    # 添加边
                    edges.append((nodes[start_key], nodes[end_key]))

        print(f"[V2] 提取了 {len(nodes)} 个道路节点, {len(edges)} 条边")

        return {
            'num_nodes': len(nodes),
            'num_edges': len(edges),
            'nodes': nodes,
            'edges': edges,
        }

    def load_aois(self, limit: Optional[int] = None) -> Dict:
        """
        加载AOI数据
        """
        cur = self.conn.cursor()

        sql = """
            SELECT id, name, type, area_sqm, ST_AsText(geom) as geom_text
            FROM wuhan_osm_aoi
            WHERE geom IS NOT NULL
        """

        if limit:
            sql += f" LIMIT {limit}"

        cur.execute(sql)
        rows = cur.fetchall()

        print(f"[V2] 加载了 {len(rows)} 个AOI")

        # AOI类型映射
        type_map = {}
        aois = []

        for row in rows:
            aoi_type = row[2] if row[2] else 'unknown'
            if aoi_type not in type_map:
                type_map[aoi_type] = len(type_map)

            aois.append({
                'id': row[0],
                'name': row[1],
                'type': aoi_type,
                'type_id': type_map[aoi_type],
                'area_sqm': row[3],
                'geom_text': row[4],
            })

        return {
            'aois': aois,
            'num_aois': len(aois),
            'num_types': len(type_map),
            'type_map': type_map,
        }


def build_poi_features(poi_data: Dict) -> torch.Tensor:
    """
    构建POI特征张量

    Args:
        poi_data: load_pois()的返回值

    Returns:
        features: [N, F] 张量
    """
    N = poi_data['metadata']['num_pois']

    # 特征列: category, landuse, road_class, density, entropy
    features = np.column_stack([
        poi_data['categories'],
        poi_data['landuses'],
        poi_data['road_classes'],
        poi_data['densities'],
        poi_data['entropies'],
    ])

    return torch.from_numpy(features).float()


def build_knn_edge_index(coords: np.ndarray, k: int = 10) -> torch.Tensor:
    """
    构建KNN图的边索引

    Args:
        coords: [N, 2] 坐标
        k: 邻居数

    Returns:
        edge_index: [2, E]
    """
    from sklearn.neighbors import kneighbors_graph

    n = len(coords)
    k = min(k, n - 1)

    # KNN图
    adj = kneighbors_graph(coords, n_neighbors=k, mode='connectivity', include_self=False)

    # 转为边索引
    row, col = adj.nonzero()
    edge_index = torch.from_numpy(np.stack([row, col], axis=0)).long()

    return edge_index


if __name__ == "__main__":
    # 测试数据加载
    db_config = {
        'host': 'localhost',
        'port': 5432,
        'user': 'postgres',
        'password': '123456',
        'database': 'geoloom'
    }

    loader = V2DataLoader(db_config)
    loader.connect()

    # 加载POI（限制数量用于测试）
    poi_data = loader.load_pois(limit=5000)
    print(f"POI坐标范围: lng=[{poi_data['coords'][:,0].min():.4f}, {poi_data['coords'][:,0].max():.4f}]")
    print(f"             lat=[{poi_data['coords'][:,1].min():.4f}, {poi_data['coords'][:,1].max():.4f}]")
    print(f"类别数: {poi_data['metadata']['num_categories']}")
    print(f"土地利用类型数: {poi_data['metadata']['num_landuses']}")
    print(f"道路等级数: {poi_data['metadata']['num_road_classes']}")

    # 加载道路网络
    road_data = loader.load_road_network()

    # 加载AOI
    aoi_data = loader.load_aois(limit=1000)

    loader.close()

    print("\\n[V2] 数据加载完成")
