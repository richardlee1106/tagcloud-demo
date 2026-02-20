# -*- coding: utf-8 -*-
"""Composite V5 地块级边界组装器。

职责：
  1. 接收 BBOX，从 PostGIS 获取三层面（地块/AOI/EULUC）和空间连接后的 POI
  2. 对 POI_final 进行 HDBSCAN 聚类
  3. 每个聚类 → 提取所属地块 ID → ST_Union 地块面 → 贴合路网的片区边界
  4. 回退策略：地块面 → AOI 面 → EULUC 面
  5. 片区命名：AOI.name > semantic_anchor > EULUC.类别 > LLM
  6. 低置信度名称黑名单过滤
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from shapely.geometry import MultiPoint, Point, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree


# ────────────────────────────────────────────────────────────
# 低置信度名称黑名单（不适合作为"片区名"的 POI 名称/AOI 名称关键词）
# ────────────────────────────────────────────────────────────
_LOW_CONFIDENCE_NAME_KEYWORDS: frozenset = frozenset((
    "停车场", "公厠", "公共厠所", "卫生间", "垃圾站", "垃圾回收",
    "配电房", "变电站", "水泵房", "泵站", "加油站",
    "居民楼", "住宅楼", "宿舍", "小区门卫", "保安室",
    "快递柜", "自动售货机", "ATM", "取款机",
    "停车位", "充电桩", "充电站",
    "公交站", "公交站台",
))

# 宏观地名黑名单：省/市/区/历史区域名不应作为片区锨点
_MACRO_GEO_NAMES: frozenset = frozenset((
    # 省级
    "湖北", "湖南", "广东", "江苏", "浙江", "山东", "四川", "河南", "河北",
    "安徽", "福建", "江西", "陕西", "山西", "吉林", "辽宁", "云南", "贵州",
    "甘肃", "青海", "内蒙古", "广西", "西藏", "新疆", "宁夏", "海南",
    "黑龙江", "北京", "上海", "天津", "重庆",
    # 武汉相关
    "武汉", "武汉市", "汉口", "武昌", "汉阳",
    "洪山", "青山", "江夏", "汉南", "硅口",
    "东西湖", "武汉开发区", "光谷",
    # 通用极宽泛的名称
    "中国", "中华", "全国",
    "有限公司", "股份", "集团",
))

# 低置信度 AOI type（不适合作为片区代表性类别的面类型）
_LOW_CONFIDENCE_AOI_TYPES: frozenset = frozenset({
    "停车场", "水域", "居住区", "草地",
})

# 低置信度 EULUC 用地类型
_LOW_CONFIDENCE_LAND_TYPES: frozenset = frozenset({
    "居住用地", "河流湖泊",
})


@dataclass
class ClusterDistrict:
    """一个聚类片区的完整信息。"""
    cluster_id: int
    name: str                          # 片区名称
    name_source: str                   # 命名来源（aoi_name/semantic_anchor/land_type/llm/fallback）
    name_confidence: float             # 命名置信度 [0, 1]
    boundary_geojson: Dict[str, Any]   # GeoJSON Polygon
    boundary_method: str               # 边界生成方法
    center: Tuple[float, float]        # 片区中心 (lon, lat)
    poi_count: int
    block_ids: List[int]               # 涉及的路网地块 ID
    dominant_aoi_name: str             # 主导 AOI 名称
    dominant_aoi_type: str             # 主导 AOI 类别
    dominant_land_type: str            # 主导 EULUC 用地
    pois: List[Dict[str, Any]] = field(default_factory=list)


def _is_low_confidence_name(name: str) -> bool:
    """判断名称是否命中低置信度黑名单（含宏观地名过滤）。"""
    if not name:
        return True
    normalized = name.strip().lower()
    if len(normalized) < 2:
        return True
    # 过滤纯数字、'None'、'null' 等无效值
    if normalized in ("none", "null", "undefined", ""):
        return True
    if normalized.replace(".", "").replace("-", "").isdigit():
        return True
    # 宏观地名过滤
    stripped = name.strip()
    if stripped in _MACRO_GEO_NAMES:
        return True
    # 关键词过滤
    return any(kw in normalized for kw in _LOW_CONFIDENCE_NAME_KEYWORDS)


def _extract_dominant(values: List[str], blacklist: Set[str] | None = None) -> Tuple[str, int]:
    """从列表中提取出现最多且不在黑名单中的值，自动排除无效值。"""
    # 过滤空值、'None'、纯数字
    cleaned = [
        v.strip() for v in values
        if v and v.strip() and v.strip().lower() not in ("none", "null", "undefined")
    ]
    counter = Counter(cleaned)
    if blacklist:
        # 先尝试排除黑名单，若排除后无候选则保留全部
        filtered = {k: v for k, v in counter.items() if k not in blacklist}
        if filtered:
            counter = Counter(filtered)
    if not counter:
        return "", 0
    top, count = counter.most_common(1)[0]
    return top, count


def _extract_name_fragments(poi_names: List[str], *, min_len: int = 2, max_len: int = 6, max_names: int = 100) -> Counter:
    """从 POI 名称中提取 CJK 子串频次统计，限制最多处理 max_names 个名称以避免大聚类性能问题。"""
    fragment_counter: Counter = Counter()
    for raw_name in poi_names[:max_names]:
        if not raw_name:
            continue
        # 仅提取中文字符部分
        cjk = "".join(ch for ch in raw_name if "\u4e00" <= ch <= "\u9fff")
        if len(cjk) < min_len:
            continue
        upper = min(max_len, len(cjk))
        for size in range(min_len, upper + 1):
            for start in range(0, len(cjk) - size + 1):
                frag = cjk[start:start + size]
                if frag not in _LOW_CONFIDENCE_NAME_KEYWORDS:
                    fragment_counter[frag] += 1
    return fragment_counter


def _resolve_district_name(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_aoi_name: str,
    dominant_aoi_type: str,
    dominant_land_type: str,
) -> Tuple[str, str, float]:
    """为一个聚类片区确定最终名称。

    返回: (name, source, confidence)
    """
    # 优先级 1：AOI 面的 name 字段（如"沙湖"、"光谷广场"）
    if dominant_aoi_name and not _is_low_confidence_name(dominant_aoi_name):
        suffix = "片区"
        # 利用 EULUC 用地类型丰富后缀
        if dominant_land_type and dominant_land_type not in _LOW_CONFIDENCE_LAND_TYPES:
            type_suffix_map = {
                "教育用地": "科教片区",
                "商业服务用地": "商业片区",
                "商务办公用地": "商务片区",
                "工业用地": "产业园片区",
                "公园与绿地用地": "生态片区",
                "体育与文化用地": "文体片区",
                "医疗卫生用地": "医疗片区",
                "行政办公用地": "行政片区",
                "交通枢纽用地": "交通枢纽片区",
            }
            suffix = type_suffix_map.get(dominant_land_type, "片区")
        name = f"{dominant_aoi_name}{suffix}"
        return name, "aoi_name", min(1.0, 0.75 + 0.15 * (1 if dominant_land_type else 0))

    # 优先级 2：POI 名称高频子串（语义锚点）
    poi_names = [str(p.get("name", "")).strip() for p in cluster_pois if str(p.get("name", "")).strip()]
    fragments = _extract_name_fragments(poi_names)
    if fragments:
        # 取出现次数 >= 3 且长度 >= 2 的最高频片段
        candidates = [(frag, count) for frag, count in fragments.most_common(10) if count >= 3 and len(frag) >= 2]
        if candidates:
            best_frag, best_count = candidates[0]
            support_ratio = best_count / max(1, len(poi_names))
            if support_ratio >= 0.15:
                suffix = "片区"
                if dominant_land_type and dominant_land_type not in _LOW_CONFIDENCE_LAND_TYPES:
                    type_suffix_map = {
                        "教育用地": "科教片区",
                        "商业服务用地": "商业片区",
                        "商务办公用地": "商务片区",
                        "工业用地": "产业园片区",
                        "公园与绿地用地": "生态片区",
                    }
                    suffix = type_suffix_map.get(dominant_land_type, "片区")
                name = f"{best_frag}{suffix}"
                confidence = min(1.0, 0.45 + 0.30 * support_ratio + 0.10 * min(len(best_frag), 4) / 4)
                return name, "semantic_anchor", confidence

    # 优先级 3：EULUC 用地类型
    if dominant_land_type and dominant_land_type not in _LOW_CONFIDENCE_LAND_TYPES:
        name = f"{dominant_land_type}片区"
        return name, "land_type", 0.40

    # 优先级 4：AOI type 兜底
    if dominant_aoi_type and dominant_aoi_type not in _LOW_CONFIDENCE_AOI_TYPES:
        name = f"{dominant_aoi_type}片区"
        return name, "aoi_type_fallback", 0.30

    return "未命名片区", "fallback", 0.10


def assemble_block_boundaries(
    *,
    cluster_labels: List[int],
    pois: List[Dict[str, Any]],
    road_blocks: List[Dict[str, Any]],
    osm_aoi_features: List[Dict[str, Any]],
    euluc_features: List[Dict[str, Any]],
) -> List[ClusterDistrict]:
    """从聚类结果 + 三层面数据组装贴合路网的片区边界。

    核心算法：
      1. 每个 cluster 的 POI → 提取 block_id 集合
      2. 从 road_blocks 中找到这些地块 → ST_Union → 片区边界
      3. 如果地块面覆盖不足，回退到 AOI 面 / EULUC 面
      4. 确定片区名称
    """
    if not pois or not cluster_labels:
        return []

    # 预构建地块几何索引：block_id → Shapely Polygon
    block_geom_map: Dict[int, Polygon] = {}
    for rb in road_blocks:
        geojson_str = rb.get("geometry_geojson")
        block_id = rb.get("block_id")
        if not geojson_str or block_id is None:
            continue
        try:
            geojson = json.loads(geojson_str) if isinstance(geojson_str, str) else geojson_str
            poly = shape(geojson)
            if poly.is_valid and not poly.is_empty:
                block_geom_map[int(block_id)] = poly
        except Exception:
            continue

    # 预构建 AOI 几何索引（使用 STRtree 加速回退查询）
    aoi_polys: List[Polygon] = []
    aoi_meta: List[Tuple[str, str]] = []  # (name, type)
    for aoi in osm_aoi_features:
        geojson_str = aoi.get("geometry_geojson")
        if not geojson_str:
            continue
        try:
            geojson = json.loads(geojson_str) if isinstance(geojson_str, str) else geojson_str
            poly = shape(geojson)
            if poly.is_valid and not poly.is_empty:
                aoi_polys.append(poly)
                aoi_meta.append((str(aoi.get("name", "")), str(aoi.get("type", ""))))
        except Exception:
            continue
    aoi_tree = STRtree(aoi_polys) if aoi_polys else None

    # 预构建 EULUC 几何索引
    euluc_polys: List[Polygon] = []
    euluc_types: List[str] = []
    for eu in euluc_features:
        geojson_str = eu.get("geometry_geojson")
        if not geojson_str:
            continue
        try:
            geojson = json.loads(geojson_str) if isinstance(geojson_str, str) else geojson_str
            poly = shape(geojson)
            if poly.is_valid and not poly.is_empty:
                euluc_polys.append(poly)
                euluc_types.append(str(eu.get("land_type", "")))
        except Exception:
            continue
    euluc_tree = STRtree(euluc_polys) if euluc_polys else None

    # 按聚类分组
    unique_labels = sorted(set(lab for lab in cluster_labels if lab >= 0))
    districts: List[ClusterDistrict] = []

    # 预处理：语义聚合（同一 AOI name 下的多聚类应当合并，解决跨地块大型机构如大学被拆分的问题）
    cluster_pois_map = {
        cid: [pois[i] for i, lab in enumerate(cluster_labels) if lab == cid and i < len(pois)]
        for cid in unique_labels
    }

    aoi_merges = {}
    for cid, c_pois in cluster_pois_map.items():
        if len(c_pois) < 3:
            continue
        aoi_names = [p.get("aoi_name") for p in c_pois if p.get("aoi_name")]
        if not aoi_names:
            continue
        most_common_aoi, count = Counter(aoi_names).most_common(1)[0]
        # 如果该 AOI 占比 >= 40% 且不是泛称，则标记该聚类为此 AOI
        if count / len(c_pois) >= 0.40 and not _is_low_confidence_name(most_common_aoi):
            aoi_merges.setdefault(most_common_aoi, []).append(cid)

    # 生成最终的聚合聚类库 (保存 cid 以便后续使用)
    merged_cluster_data: List[Tuple[int, List[Dict[str, Any]]]] = []
    processed_cids = set()
    for aoi_name, cids in aoi_merges.items():
        if len(cids) > 1:
            merged_pois = []
            for cid in cids:
                merged_pois.extend(cluster_pois_map[cid])
                processed_cids.add(cid)
            merged_cluster_data.append((cids[0], merged_pois))  # 使用第一个cid作为代表

    for cid, c_pois in cluster_pois_map.items():
        if cid not in processed_cids:
            merged_cluster_data.append((cid, c_pois))

    for cluster_id, cluster_pois in merged_cluster_data:
        if len(cluster_pois) < 3:
            continue

        # 提取坐标
        coords = [
            (float(p["lon"]), float(p["lat"]))
            for p in cluster_pois
            if p.get("lon") is not None and p.get("lat") is not None
        ]
        if len(coords) < 3:
            continue

        # 提取该聚类 POI 所属的 block_id 集合
        block_ids = [
            int(p["block_id"])
            for p in cluster_pois
            if p.get("block_id") is not None
        ]
        unique_block_ids = list(set(block_ids))

        # ─── 策略 1：路网地块面 union ───
        boundary_polygon: Polygon | None = None
        boundary_method = "unknown"

        if unique_block_ids:
            block_polys = [
                block_geom_map[bid]
                for bid in unique_block_ids
                if bid in block_geom_map
            ]
            if block_polys:
                try:
                    merged = unary_union(block_polys)
                    if merged.geom_type == "MultiPolygon":
                        # 取面积最大的连通部分
                        merged = max(merged.geoms, key=lambda g: g.area)
                    if merged.is_valid and not merged.is_empty and merged.geom_type == "Polygon":
                        boundary_polygon = merged
                        boundary_method = "road_block_union_v5"
                except Exception:
                    pass

        # ─── 策略 2：AOI 面回退（使用 STRtree 空间索引加速）───
        if boundary_polygon is None and aoi_tree is not None:
            centroid = MultiPoint(coords).centroid
            candidate_indices = aoi_tree.query(centroid)
            for idx in candidate_indices:
                if aoi_polys[idx].contains(centroid):
                    boundary_polygon = aoi_polys[idx]
                    boundary_method = "aoi_fallback_v5"
                    break

        # ─── 策略 3：EULUC 面回退（使用 STRtree 空间索引加速）───
        if boundary_polygon is None and euluc_tree is not None:
            centroid = MultiPoint(coords).centroid if not boundary_polygon else centroid
            candidate_indices = euluc_tree.query(centroid)
            for idx in candidate_indices:
                if euluc_polys[idx].contains(centroid):
                    boundary_polygon = euluc_polys[idx]
                    boundary_method = "euluc_fallback_v5"
                    break

        # ─── 策略 4：凸包兜底（最后手段）───
        if boundary_polygon is None:
            try:
                hull = MultiPoint(coords).convex_hull
                if hull.geom_type == "Polygon" and not hull.is_empty:
                    boundary_polygon = hull
                    boundary_method = "convex_hull_last_resort_v5"
            except Exception:
                continue

        if boundary_polygon is None:
            continue

        # 计算中心
        cx = sum(c[0] for c in coords) / len(coords)
        cy = sum(c[1] for c in coords) / len(coords)

        # 提取主导语义信息
        aoi_names = [str(p.get("aoi_name", "")).strip() for p in cluster_pois if str(p.get("aoi_name", "")).strip()]
        aoi_types = [str(p.get("aoi_type", "")).strip() for p in cluster_pois if str(p.get("aoi_type", "")).strip()]
        land_types = [str(p.get("land_type", "")).strip() for p in cluster_pois if str(p.get("land_type", "")).strip()]

        dominant_aoi_name, _ = _extract_dominant(aoi_names, blacklist=None)
        dominant_aoi_type, _ = _extract_dominant(aoi_types, blacklist=_LOW_CONFIDENCE_AOI_TYPES)
        dominant_land_type, _ = _extract_dominant(land_types, blacklist=_LOW_CONFIDENCE_LAND_TYPES)

        # 确定名称
        name, name_source, name_confidence = _resolve_district_name(
            cluster_pois=cluster_pois,
            dominant_aoi_name=dominant_aoi_name,
            dominant_aoi_type=dominant_aoi_type,
            dominant_land_type=dominant_land_type,
        )

        districts.append(ClusterDistrict(
            cluster_id=cluster_id,
            name=name,
            name_source=name_source,
            name_confidence=round(name_confidence, 4),
            boundary_geojson=mapping(boundary_polygon),
            boundary_method=boundary_method,
            center=(round(cx, 6), round(cy, 6)),
            poi_count=len(cluster_pois),
            block_ids=unique_block_ids,
            dominant_aoi_name=dominant_aoi_name,
            dominant_aoi_type=dominant_aoi_type,
            dominant_land_type=dominant_land_type,
            pois=cluster_pois,
        ))

    return districts
