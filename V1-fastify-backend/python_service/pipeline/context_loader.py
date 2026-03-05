# -*- coding: utf-8 -*-
"""Road/Landuse context loading and normalization helpers."""

from __future__ import annotations

from typing import Any, Callable, Dict, List

from shapely.geometry import Polygon, shape
from shapely.strtree import STRtree


def normalize_road_geometries(
    *,
    rows: List[Dict[str, Any]],
    safe_json_loads: Callable[[Any, Any], Any],
) -> List[Any]:
    """Normalize road rows into a flat LineString geometry list."""
    road_geometries: List[Any] = []
    for row in rows:
        raw_geometry = (
            row.get("geometry_geojson")
            or row.get("geom_geojson")
            or row.get("geometry")
            or row.get("geom")
        )
        geometry_geojson = safe_json_loads(raw_geometry, None)
        if not isinstance(geometry_geojson, dict):
            continue

        try:
            geometry = shape(geometry_geojson)
        except Exception:
            continue

        if geometry is None or geometry.is_empty:
            continue

        geom_type = str(getattr(geometry, "geom_type", ""))
        if geom_type in {"LineString", "LinearRing"}:
            road_geometries.append(geometry)
        elif geom_type == "MultiLineString":
            for part in geometry.geoms:
                if not part.is_empty:
                    road_geometries.append(part)
        elif geom_type == "GeometryCollection":
            for part in geometry.geoms:
                part_type = str(getattr(part, "geom_type", ""))
                if part.is_empty:
                    continue
                if part_type in {"LineString", "LinearRing"}:
                    road_geometries.append(part)
                elif part_type == "MultiLineString":
                    for nested in part.geoms:
                        if not nested.is_empty:
                            road_geometries.append(nested)

    return road_geometries


def landuse_boundary_weight(
    *,
    properties: Any,
    safe_json_loads: Callable[[Any, Any], Any],
) -> float:
    """Estimate boundary reliability from land-use labels/properties."""
    props = safe_json_loads(properties, {})
    text_values: List[str] = []

    if isinstance(props, dict):
        for key, value in props.items():
            if isinstance(key, str) and key.strip():
                text_values.append(key.strip().lower())
            if isinstance(value, str) and value.strip():
                text_values.append(value.strip().lower())
    elif isinstance(props, str) and props.strip():
        text_values.append(props.strip().lower())

    joined = " ".join(text_values)
    if not joined:
        return 0.72

    strong_keywords = (
        "\u6c34\u57df",
        "\u6cb3",
        "\u6e56",
        "wetland",
        "water",
        "reservoir",
        "\u4ea4\u901a",
        "\u9053\u8def",
        "\u94c1\u8def",
        "road",
        "rail",
        "\u5de5\u4e1a",
        "industrial",
        "\u516c\u56ed",
        "\u7eff\u5730",
        "park",
        "green",
    )
    medium_keywords = (
        "\u4f4f\u5b85",
        "\u5c45\u4f4f",
        "\u5546\u4e1a",
        "\u5546\u670d",
        "\u529e\u516c",
        "mixed",
        "educat",
        "\u516c\u5171",
        "\u516c\u5171\u670d\u52a1",
        "\u7528\u5730",
        "land",
        "farm",
        "agric",
    )

    if any(keyword in joined for keyword in strong_keywords):
        return 0.92
    if any(keyword in joined for keyword in medium_keywords):
        return 0.80
    return 0.72


def normalize_landuse_geometries(
    *,
    rows: List[Dict[str, Any]],
    safe_json_loads: Callable[[Any, Any], Any],
    clamp01: Callable[[float], float],
    landuse_label_text: Callable[[Any], str],
    niche_type_from_landuse_label: Callable[[str], str],
) -> Dict[str, List[Any]]:
    """Normalize land-use rows into boundary and semantic context features."""
    boundary_geometries: List[Any] = []
    boundary_weights: List[float] = []
    semantic_features: List[Dict[str, Any]] = []

    for row in rows:
        raw_geometry = (
            row.get("geometry_geojson")
            or row.get("geom_geojson")
            or row.get("geometry")
            or row.get("geom")
        )
        geometry_geojson = safe_json_loads(raw_geometry, None)
        if not isinstance(geometry_geojson, dict):
            continue

        try:
            geometry = shape(geometry_geojson)
        except Exception:
            continue

        if geometry is None or geometry.is_empty:
            continue

        weight = landuse_boundary_weight(
            properties=row.get("properties"),
            safe_json_loads=safe_json_loads,
        )
        label_text = landuse_label_text(row.get("properties"))
        niche_type = niche_type_from_landuse_label(label_text)
        polygons: List[Polygon] = []
        geom_type = str(getattr(geometry, "geom_type", ""))
        if geom_type == "Polygon":
            polygons = [geometry]
        elif geom_type == "MultiPolygon":
            polygons = [part for part in geometry.geoms if isinstance(part, Polygon) and not part.is_empty]
        elif geom_type == "GeometryCollection":
            for part in geometry.geoms:
                part_type = str(getattr(part, "geom_type", ""))
                if part.is_empty:
                    continue
                if part_type == "Polygon":
                    polygons.append(part)
                elif part_type == "MultiPolygon":
                    polygons.extend(
                        [nested for nested in part.geoms if isinstance(nested, Polygon) and not nested.is_empty]
                    )

        for polygon in polygons:
            if polygon.is_empty:
                continue
            boundary = polygon.boundary
            if boundary is None or boundary.is_empty:
                continue
            boundary_geometries.append(boundary)
            normalized_weight = clamp01(float(weight))
            boundary_weights.append(normalized_weight)
            semantic_features.append(
                {
                    "geometry": polygon,
                    "bounds": tuple(polygon.bounds),
                    "label": label_text,
                    "niche_type": niche_type,
                    "semantic_weight": normalized_weight,
                }
            )

    return {
        "boundary_geometries": boundary_geometries,
        "boundary_weights": boundary_weights,
        "semantic_features": semantic_features,
    }


def load_road_context(
    *,
    repository: Any,
    spatial_context: Dict[str, Any],
    query_type: str,
    enabled: bool,
    fetch_limit: int,
    normalize_road_geometries_func: Callable[[List[Dict[str, Any]]], List[Any]],
) -> Dict[str, Any]:
    """Fetch and build road spatial context bundle."""
    road_rows: List[Dict[str, Any]] = []
    road_geometries: List[Any] = []
    road_index: STRtree | None = None
    road_source = "disabled"

    if enabled and query_type != "graph_reasoning":
        fetch_roads_fn = getattr(repository, "fetch_roads", None)
        if callable(fetch_roads_fn):
            try:
                road_rows = fetch_roads_fn(
                    spatial_context=spatial_context,
                    limit=fetch_limit,
                )
                road_geometries = normalize_road_geometries_func(road_rows)
                if road_geometries:
                    road_index = STRtree(road_geometries)
                    road_source = "wuhan_roads"
                else:
                    road_source = "empty"
            except Exception:
                road_rows = []
                road_geometries = []
                road_index = None
                road_source = "error"
        else:
            road_source = "repository_unsupported"

    return {
        "rows": road_rows,
        "geometries": road_geometries,
        "index": road_index,
        "source": road_source,
    }


def load_landuse_context(
    *,
    repository: Any,
    spatial_context: Dict[str, Any],
    query_type: str,
    enabled: bool,
    fetch_limit: int,
    normalize_landuse_geometries_func: Callable[[List[Dict[str, Any]]], Dict[str, List[Any]]],
) -> Dict[str, Any]:
    """Fetch and build landuse spatial context bundle."""
    landuse_rows: List[Dict[str, Any]] = []
    landuse_geometries: List[Any] = []
    landuse_weights: List[float] = []
    landuse_semantic_features: List[Dict[str, Any]] = []
    landuse_index: STRtree | None = None
    landuse_source = "disabled"

    if enabled and query_type != "graph_reasoning":
        fetch_landuse_fn = getattr(repository, "fetch_landuse", None)
        if callable(fetch_landuse_fn):
            try:
                landuse_rows = fetch_landuse_fn(
                    spatial_context=spatial_context,
                    limit=fetch_limit,
                )
                landuse_bundle = normalize_landuse_geometries_func(landuse_rows)
                landuse_geometries = list(landuse_bundle.get("boundary_geometries") or [])
                landuse_weights = list(landuse_bundle.get("boundary_weights") or [])
                landuse_semantic_features = list(landuse_bundle.get("semantic_features") or [])
                if landuse_geometries:
                    landuse_index = STRtree(landuse_geometries)
                    landuse_source = "wuhan_landuse"
                else:
                    landuse_source = "empty"
            except Exception:
                landuse_rows = []
                landuse_geometries = []
                landuse_weights = []
                landuse_semantic_features = []
                landuse_index = None
                landuse_source = "error"
        else:
            landuse_source = "repository_unsupported"

    return {
        "rows": landuse_rows,
        "geometries": landuse_geometries,
        "weights": landuse_weights,
        "semantic_features": landuse_semantic_features,
        "index": landuse_index,
        "source": landuse_source,
    }

