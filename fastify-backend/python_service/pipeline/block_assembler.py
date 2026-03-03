# -*- coding: utf-8 -*-
"""Composite V5 地块级边界组装器。

职责：
  1. 接收 BBOX，从 PostGIS 获取三层面（地块/AOI/EULUC）和空间连接后的 POI
  2. 对 POI_final 进行 HDBSCAN 聚类
  3. 每个聚类 → 提取所属地块 ID → ST_Union 地块面 → 贴合路网的片区边界
  4. ˲ԣؿ  AOI   EULUC 
  5. 片区命名：AOI.name > semantic_anchor > EULUC.类别 > LLM
  6. 低置信度名称黑名单过滤
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from numbers import Integral
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from shapely.geometry import MultiPoint, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree


# ────────────────────────────────────────────────────────────
# ŶƺʺΪ"Ƭ" POI /AOI ƹؼʣ
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
    "", "", "Ϻ", "", "",
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

_REPEATED_NAME_PATTERN = re.compile(r"^(.{2,6})\1+$")
_BUILDING_NAME_PATTERN = re.compile(
    r"(?:\d+|[a-z]\d*)(?:\u53f7\u697c|\u680b|\u5355\u5143|\u5c42|\u5ba4|\u53f7)$",
    flags=re.IGNORECASE,
)
_RESIDENTIAL_NAME_KEYWORDS: Tuple[str, ...] = (
    "\u5c0f\u533a",
    "\u82b1\u56ed",
    "\u661f\u57ce",
    "\u56fd\u9645\u57ce",
    "\u516c\u5bd3",
    "\u4f4f\u5b85",
    "\u5ead\u9662",
    "\u82d1",
)
_AUTHORITY_NAME_KEYWORDS: Tuple[str, ...] = (
    "\u5927\u5b66",
    "\u6821\u533a",
    "\u533b\u9662",
    "\u516c\u56ed",
    "\u666f\u533a",
    "\u4ea7\u4e1a\u56ed",
    "\u5b66\u9662",
)
_GENERIC_REGION_SUFFIXES: Tuple[str, ...] = (
    "\u7247\u533a",
    "\u751f\u6001\u7247\u533a",
    "\u5546\u4e1a\u7247\u533a",
    "\u79d1\u6559\u7247\u533a",
    "\u6d3b\u529b\u5e26",
)

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
    stripped_name = str(name).strip()
    normalized = stripped_name.lower()
    if len(normalized) < 2:
        return True
    # 过滤纯数字、'None'、'null' 等无效值
    if normalized in ("none", "null", "undefined", ""):
        return True
    if normalized.replace(".", "").replace("-", "").isdigit():
        return True

    collapsed = re.sub(r"\s+", "", stripped_name)
    collapsed_for_repeat = collapsed
    for suffix in _GENERIC_REGION_SUFFIXES:
        if collapsed_for_repeat.endswith(suffix):
            collapsed_for_repeat = collapsed_for_repeat[: -len(suffix)] or collapsed_for_repeat

    repeated_match = _REPEATED_NAME_PATTERN.match(collapsed_for_repeat)
    if repeated_match:
        repeated_unit = repeated_match.group(1)
        if repeated_unit in _MACRO_GEO_NAMES or len(repeated_unit) <= 3:
            return True

    if _BUILDING_NAME_PATTERN.search(collapsed):
        return True

    has_residential_hint = any(keyword in collapsed for keyword in _RESIDENTIAL_NAME_KEYWORDS)
    has_authority_hint = any(keyword in collapsed for keyword in _AUTHORITY_NAME_KEYWORDS)
    if has_residential_hint and not has_authority_hint:
        return True

    # 宏观地名过滤
    if stripped_name in _MACRO_GEO_NAMES:
        return True
    for macro_name in _MACRO_GEO_NAMES:
        if collapsed in {
            macro_name,
            f"{macro_name}片区",
            f"{macro_name}活力带",
            f"{macro_name}生态片区",
            f"{macro_name}商业片区",
        }:
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
        # ȳųų޺ѡȫ
        filtered = {k: v for k, v in counter.items() if k not in blacklist}
        if filtered:
            counter = Counter(filtered)
    if not counter:
        return "", 0
    top, count = counter.most_common(1)[0]
    return top, count


def _extract_name_fragments(poi_names: List[str], *, min_len: int = 2, max_len: int = 6, max_names: int = 100) -> Counter:
    """ POI ȡ CJK ӴƵͳƣദ max_names Ա⡣"""
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

    # ȼ 2POI ƸƵӴê㣩
    poi_names = [str(p.get("name", "")).strip() for p in cluster_pois if str(p.get("name", "")).strip()]
    fragments = _extract_name_fragments(poi_names)
    if fragments:
        # ȡִ >= 3 ҳ >= 2 ƵƬ
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


_HIGH_AUTHORITY_AOI_TYPES: frozenset[str] = frozenset(
    {
        "大学",
        "学院",
        "学校",
        "医院",
        "中学",
        "小学",
        "公园",
        "景区",
        "园区",
        "产业园",
        "校园",
        "campus",
        "university",
        "college",
        "hospital",
        "park",
    }
)

_LOW_CONFIDENCE_LAND_TYPE_KEYWORDS: Tuple[str, ...] = (
    "居住",
    "交通枢纽",
    "河流",
    "湖泊",
)

_BLOCK_LAND_COMPATIBILITY: Dict[str, Set[str]] = {
    "教育用地": {"行政办公用地", "商业服务用地"},
    "医疗卫生用地": {"行政办公用地"},
    "公园与绿地用地": {"河流湖泊", "水域"},
    "商业服务用地": {"商务办公用地"},
    "商务办公用地": {"商业服务用地"},
}


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().lower())


def _name_like_match(left: str, right: str) -> bool:
    l_norm = _normalize_text(left)
    r_norm = _normalize_text(right)
    if not l_norm or not r_norm:
        return False
    return l_norm in r_norm or r_norm in l_norm


def _has_authority_hint(name: str, aoi_type: str) -> bool:
    joined = f"{name} {aoi_type}"
    if _is_low_confidence_name(joined):
        return False
    joined_norm = _normalize_text(joined)
    return any(token in joined_norm for token in _HIGH_AUTHORITY_AOI_TYPES)


def _text_anchor_match_count(text: str, tokens: List[str]) -> int:
    text_norm = _normalize_text(text)
    if not text_norm:
        return 0
    matched = 0
    for token in tokens:
        token_norm = _normalize_text(token)
        if token_norm and token_norm in text_norm:
            matched += 1
    return matched


def _is_conflicting_land_type(block_land_type: str, dominant_land_type: str) -> bool:
    block_norm = str(block_land_type or "").strip()
    dominant_norm = str(dominant_land_type or "").strip()
    if not block_norm or not dominant_norm:
        return False
    if block_norm == dominant_norm:
        return False
    if block_norm in dominant_norm or dominant_norm in block_norm:
        return False

    allowed = _BLOCK_LAND_COMPATIBILITY.get(dominant_norm, set())
    if block_norm in allowed:
        return False

    dominant_low_conf = any(keyword in dominant_norm for keyword in _LOW_CONFIDENCE_LAND_TYPE_KEYWORDS)
    if dominant_low_conf:
        return False

    return True


def _filter_supported_block_ids(
    *,
    cluster_pois: List[Dict[str, Any]],
    dominant_land_type: str,
) -> List[int]:
    block_counter: Counter = Counter()
    block_land_samples: Dict[int, List[str]] = {}

    for poi in cluster_pois:
        raw_block_id = poi.get("block_id")
        if raw_block_id is None:
            continue
        try:
            block_id = int(raw_block_id)
        except Exception:
            continue
        block_counter[block_id] += 1
        land = str(poi.get("land_type", "")).strip()
        if land:
            block_land_samples.setdefault(block_id, []).append(land)

    if not block_counter:
        return []

    total = max(1, sum(block_counter.values()))
    # Reject one-off outliers in medium/large clusters, while keeping small clusters stable.
    min_support_count = 2 if total >= 8 else 1
    min_support_ratio = 0.10 if total >= 12 else 0.0

    selected: List[int] = []
    for block_id, count in block_counter.items():
        support_ratio = count / total
        if count >= min_support_count or support_ratio >= min_support_ratio:
            selected.append(block_id)

    if not selected:
        selected = [int(block_counter.most_common(1)[0][0])]

    if dominant_land_type:
        refined: List[int] = []
        for block_id in selected:
            block_land_type, _ = _extract_dominant(block_land_samples.get(block_id, []), blacklist=None)
            if not _is_conflicting_land_type(block_land_type, dominant_land_type):
                refined.append(block_id)
        if refined:
            selected = refined

    return sorted(set(selected))


def _merge_block_geometries(
    *,
    block_ids: List[int],
    block_geom_map: Dict[int, Polygon | MultiPolygon],
) -> Polygon | MultiPolygon | None:
    if not block_ids:
        return None
    block_polys = [block_geom_map[bid] for bid in block_ids if bid in block_geom_map]
    if not block_polys:
        return None
    try:
        merged = unary_union(block_polys)
    except Exception:
        return None

    if merged.is_empty or not merged.is_valid:
        try:
            merged = merged.buffer(0)
        except Exception:
            return None
    if merged.is_empty:
        return None
    if merged.geom_type not in {"Polygon", "MultiPolygon"}:
        return None

    # 温和的拓扑保持简化（约 5m 精度），减少顶点数并消除锯齿
    try:
        simplified = merged.simplify(0.00005, preserve_topology=True)
        if simplified.is_valid and not simplified.is_empty and simplified.geom_type in {"Polygon", "MultiPolygon"}:
            merged = simplified
    except Exception:
        pass

    return merged


def _pick_override_aoi_polygon(
    *,
    aoi_tree: STRtree | None,
    aoi_polys: List[Polygon | MultiPolygon],
    aoi_meta: List[Tuple[str, str]],
    aoi_geom_id_map: Dict[int, int],
    cluster_coords: List[Tuple[float, float]],
    dominant_aoi_name: str,
    vlm_anchor_texts: List[str],
) -> Tuple[Polygon | MultiPolygon | None, str]:
    if aoi_tree is None or not aoi_polys:
        return None, ""
    if not cluster_coords:
        return None, ""

    centroid = MultiPoint(cluster_coords).centroid
    hull = MultiPoint(cluster_coords).convex_hull

    try:
        candidate_indices = list(aoi_tree.query(hull))
    except Exception:
        candidate_indices = []
    if not candidate_indices:
        try:
            candidate_indices = list(aoi_tree.query(centroid))
        except Exception:
            candidate_indices = []
    if not candidate_indices:
        return None, ""

    best_idx: int | None = None
    best_key: Tuple[int, int, float, float] | None = None

    for idx in candidate_indices:
        if isinstance(idx, Integral):
            i = int(idx)
        else:
            i = aoi_geom_id_map.get(id(idx), -1)
        if i < 0 or i >= len(aoi_polys):
            continue
        geom = aoi_polys[i]
        if geom.is_empty:
            continue
        name, aoi_type = aoi_meta[i]
        if _is_low_confidence_name(name):
            continue

        contains_centroid = bool(geom.covers(centroid))
        intersects_cluster = bool(geom.intersects(hull))
        if not intersects_cluster and not contains_centroid:
            continue

        authority = _has_authority_hint(name, aoi_type)
        dominant_match = int(_name_like_match(dominant_aoi_name, name))
        anchor_match = _text_anchor_match_count(f"{name} {aoi_type}", vlm_anchor_texts)
        override_rank = 0
        if authority and dominant_match:
            override_rank = 3
        elif authority and anchor_match > 0:
            override_rank = 2
        elif anchor_match > 0:
            # VLM anchor is allowed to promote AOI override even when AOI type encoding/noise
            # weakens authority detection.
            override_rank = 2
        elif dominant_match:
            override_rank = 1
        if override_rank <= 0:
            continue

        key = (
            override_rank,
            anchor_match,
            float(geom.area),
            1.0 if contains_centroid else 0.0,
        )
        if best_key is None or key > best_key:
            best_key = key
            best_idx = i

    if best_idx is None:
        return None, ""
    return aoi_polys[best_idx], "aoi_override_v5"


def assemble_block_boundaries(
    *,
    cluster_labels: List[int],
    pois: List[Dict[str, Any]],
    road_blocks: List[Dict[str, Any]],
    osm_aoi_features: List[Dict[str, Any]],
    euluc_features: List[Dict[str, Any]],
    vlm_anchor_texts: List[str] | None = None,
) -> List[ClusterDistrict]:
    """Assemble cluster boundaries from road blocks + AOI/EULUC context."""
    if not pois or not cluster_labels:
        return []

    normalized_vlm_anchors = [
        str(text).strip()
        for text in (vlm_anchor_texts or [])
        if isinstance(text, str) and str(text).strip()
    ]

    # Build road block geometry index: block_id -> Polygon/MultiPolygon.
    block_geom_map: Dict[int, Polygon | MultiPolygon] = {}
    for rb in road_blocks:
        geojson_str = rb.get("geometry_geojson")
        block_id = rb.get("block_id")
        if not geojson_str or block_id is None:
            continue
        try:
            geojson = json.loads(geojson_str) if isinstance(geojson_str, str) else geojson_str
            poly = shape(geojson)
            if not poly.is_empty:
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_valid and not poly.is_empty and poly.geom_type in {"Polygon", "MultiPolygon"}:
                    block_geom_map[int(block_id)] = poly
        except Exception:
            continue

    # Build AOI index.
    aoi_polys: List[Polygon | MultiPolygon] = []
    aoi_meta: List[Tuple[str, str]] = []
    for aoi in osm_aoi_features:
        geojson_str = aoi.get("geometry_geojson")
        if not geojson_str:
            continue
        try:
            geojson = json.loads(geojson_str) if isinstance(geojson_str, str) else geojson_str
            poly = shape(geojson)
            if not poly.is_empty:
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_valid and not poly.is_empty and poly.geom_type in {"Polygon", "MultiPolygon"}:
                    aoi_polys.append(poly)
                    aoi_meta.append((str(aoi.get("name", "")), str(aoi.get("type", ""))))
        except Exception:
            continue
    aoi_tree = STRtree(aoi_polys) if aoi_polys else None
    aoi_geom_id_map = {id(geom): idx for idx, geom in enumerate(aoi_polys)}

    # Build EULUC index.
    euluc_polys: List[Polygon | MultiPolygon] = []
    euluc_types: List[str] = []
    for eu in euluc_features:
        geojson_str = eu.get("geometry_geojson")
        if not geojson_str:
            continue
        try:
            geojson = json.loads(geojson_str) if isinstance(geojson_str, str) else geojson_str
            poly = shape(geojson)
            if not poly.is_empty:
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_valid and not poly.is_empty and poly.geom_type in {"Polygon", "MultiPolygon"}:
                    euluc_polys.append(poly)
                    euluc_types.append(str(eu.get("land_type", "")))
        except Exception:
            continue
    euluc_tree = STRtree(euluc_polys) if euluc_polys else None
    euluc_geom_id_map = {id(geom): idx for idx, geom in enumerate(euluc_polys)}

    unique_labels = sorted(set(lab for lab in cluster_labels if lab >= 0))
    districts: List[ClusterDistrict] = []

    for cluster_id in unique_labels:
        cluster_pois = [
            pois[i] for i, lab in enumerate(cluster_labels)
            if lab == cluster_id and i < len(pois)
        ]
        if len(cluster_pois) < 3:
            continue

        coords = [
            (float(p["lon"]), float(p["lat"]))
            for p in cluster_pois
            if p.get("lon") is not None and p.get("lat") is not None
        ]
        if len(coords) < 3:
            continue

        # Dominant semantic identity is calculated before boundary strategy,
        # then used to decide AOI override / block filtering.
        aoi_names = [str(p.get("aoi_name", "")).strip() for p in cluster_pois if str(p.get("aoi_name", "")).strip()]
        aoi_types = [str(p.get("aoi_type", "")).strip() for p in cluster_pois if str(p.get("aoi_type", "")).strip()]
        land_types = [str(p.get("land_type", "")).strip() for p in cluster_pois if str(p.get("land_type", "")).strip()]

        dominant_aoi_name, _ = _extract_dominant(aoi_names, blacklist=None)
        dominant_aoi_type, _ = _extract_dominant(aoi_types, blacklist=_LOW_CONFIDENCE_AOI_TYPES)
        dominant_land_type, _ = _extract_dominant(land_types, blacklist=_LOW_CONFIDENCE_LAND_TYPES)

        candidate_block_ids = _filter_supported_block_ids(
            cluster_pois=cluster_pois,
            dominant_land_type=dominant_land_type,
        )

        boundary_polygon: Polygon | MultiPolygon | None = None
        boundary_method = "unknown"

        # Strategy A (override): if we have high-authority AOI signal, use AOI polygon first.
        override_polygon, override_method = _pick_override_aoi_polygon(
            aoi_tree=aoi_tree,
            aoi_polys=aoi_polys,
            aoi_meta=aoi_meta,
            aoi_geom_id_map=aoi_geom_id_map,
            cluster_coords=coords,
            dominant_aoi_name=dominant_aoi_name,
            vlm_anchor_texts=normalized_vlm_anchors,
        )
        if override_polygon is not None:
            boundary_polygon = override_polygon
            boundary_method = override_method

        # Strategy B: union filtered road blocks.
        if boundary_polygon is None:
            merged = _merge_block_geometries(
                block_ids=candidate_block_ids,
                block_geom_map=block_geom_map,
            )
            if merged is not None:
                boundary_polygon = merged
                boundary_method = "road_block_union_v5"

        # Strategy C: AOI fallback by centroid.
        if boundary_polygon is None and aoi_tree is not None:
            centroid = MultiPoint(coords).centroid
            try:
                candidate_indices = list(aoi_tree.query(centroid))
            except Exception:
                candidate_indices = []
            for idx in candidate_indices:
                if isinstance(idx, Integral):
                    i = int(idx)
                else:
                    i = aoi_geom_id_map.get(id(idx), -1)
                if i < 0 or i >= len(aoi_polys):
                    continue
                poly = aoi_polys[i]
                try:
                    if poly.covers(centroid):
                        boundary_polygon = poly
                        boundary_method = "aoi_fallback_v5"
                        break
                except Exception:
                    continue

        # Strategy D: EULUC fallback by centroid.
        if boundary_polygon is None and euluc_tree is not None:
            centroid = MultiPoint(coords).centroid
            try:
                candidate_indices = list(euluc_tree.query(centroid))
            except Exception:
                candidate_indices = []
            for idx in candidate_indices:
                if isinstance(idx, Integral):
                    i = int(idx)
                else:
                    i = euluc_geom_id_map.get(id(idx), -1)
                if i < 0 or i >= len(euluc_polys):
                    continue
                poly = euluc_polys[i]
                try:
                    if poly.covers(centroid):
                        boundary_polygon = poly
                        boundary_method = "euluc_fallback_v5"
                        break
                except Exception:
                    continue

        # Strategy E: convex hull last resort.
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

        cx = sum(c[0] for c in coords) / len(coords)
        cy = sum(c[1] for c in coords) / len(coords)

        name, name_source, name_confidence = _resolve_district_name(
            cluster_pois=cluster_pois,
            dominant_aoi_name=dominant_aoi_name,
            dominant_aoi_type=dominant_aoi_type,
            dominant_land_type=dominant_land_type,
        )

        districts.append(
            ClusterDistrict(
                cluster_id=cluster_id,
                name=name,
                name_source=name_source,
                name_confidence=round(name_confidence, 4),
                boundary_geojson=mapping(boundary_polygon),
                boundary_method=boundary_method,
                center=(round(cx, 6), round(cy, 6)),
                poi_count=len(cluster_pois),
                block_ids=candidate_block_ids,
                dominant_aoi_name=dominant_aoi_name,
                dominant_aoi_type=dominant_aoi_type,
                dominant_land_type=dominant_land_type,
                pois=cluster_pois,
            )
        )

    return districts


