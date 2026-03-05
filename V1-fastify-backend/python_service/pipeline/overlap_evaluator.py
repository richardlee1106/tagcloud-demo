from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union


def _load_json(path: str | Path) -> Dict[str, Any]:
    file_path = Path(path)
    with file_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _extract_geojson_geometry(geojson_obj: Dict[str, Any], feature_index: int = 0) -> Dict[str, Any]:
    geo_type = str(geojson_obj.get("type") or "")

    if geo_type == "FeatureCollection":
        features = geojson_obj.get("features") or []
        if not isinstance(features, list) or not features:
            raise ValueError("FeatureCollection has no features")
        if feature_index < 0 or feature_index >= len(features):
            raise ValueError(f"feature_index out of range: {feature_index}")
        feature = features[feature_index]
        geometry = (feature or {}).get("geometry")
        if not isinstance(geometry, dict):
            raise ValueError("Feature geometry is missing")
        return geometry

    if geo_type == "Feature":
        geometry = geojson_obj.get("geometry")
        if not isinstance(geometry, dict):
            raise ValueError("Feature geometry is missing")
        return geometry

    if geo_type:
        return geojson_obj

    raise ValueError("Unsupported GeoJSON structure")


def load_geometry_from_geojson_file(path: str | Path, feature_index: int = 0) -> BaseGeometry:
    payload = _load_json(path)
    if feature_index >= 0:
        geom_json = _extract_geojson_geometry(payload, feature_index=feature_index)
        geom = shape(geom_json)
    else:
        geo_type = str(payload.get("type") or "")
        if geo_type != "FeatureCollection":
            geom_json = _extract_geojson_geometry(payload, feature_index=0)
            geom = shape(geom_json)
        else:
            features = payload.get("features") or []
            geoms = []
            for feature in features:
                geometry = (feature or {}).get("geometry")
                if not isinstance(geometry, dict):
                    continue
                g = shape(geometry)
                if g.is_empty:
                    continue
                if not g.is_valid:
                    g = g.buffer(0)
                if not g.is_empty:
                    geoms.append(g)
            if not geoms:
                raise ValueError("FeatureCollection has no valid geometry")
            geom = unary_union(geoms)
    if geom.is_empty:
        raise ValueError("Geometry is empty")
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.is_empty:
        raise ValueError("Geometry became empty after validation")
    return geom


def load_geometry_from_shapefile(path: str | Path, feature_index: int = 0) -> BaseGeometry:
    try:
        import shapefile  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime guard
        raise RuntimeError("pyshp 未安装，无法读取 SHP 文件") from exc

    shp_path = Path(path)
    reader = shapefile.Reader(str(shp_path))
    shapes = reader.shapes()
    if not shapes:
        raise ValueError(f"SHP has no shapes: {shp_path}")
    if feature_index >= 0:
        if feature_index >= len(shapes):
            raise ValueError(f"feature_index out of range: {feature_index}")
        geom_json = shapes[feature_index].__geo_interface__
        geom = shape(geom_json)
    else:
        geoms = []
        for shp in shapes:
            g = shape(shp.__geo_interface__)
            if g.is_empty:
                continue
            if not g.is_valid:
                g = g.buffer(0)
            if not g.is_empty:
                geoms.append(g)
        if not geoms:
            raise ValueError(f"SHP has no valid geometry: {shp_path}")
        geom = unary_union(geoms)
    if geom.is_empty:
        raise ValueError("SHP geometry is empty")
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.is_empty:
        raise ValueError("Geometry became empty after validation")
    return geom


def load_geometry_from_vector_file(path: str | Path, feature_index: int = 0) -> BaseGeometry:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix in {".geojson", ".json"}:
        return load_geometry_from_geojson_file(file_path, feature_index=feature_index)
    if suffix == ".shp":
        return load_geometry_from_shapefile(file_path, feature_index=feature_index)
    raise ValueError(f"Unsupported vector format: {file_path}")


def geometry_bounds_as_viewport(geometry: BaseGeometry) -> List[float]:
    minx, miny, maxx, maxy = geometry.bounds
    return [float(minx), float(miny), float(maxx), float(maxy)]


def overlap_metrics(pred_geom: BaseGeometry, truth_geom: BaseGeometry) -> Dict[str, float]:
    if pred_geom.is_empty or truth_geom.is_empty:
        return {
            "pred_area": 0.0,
            "truth_area": 0.0,
            "intersection_area": 0.0,
            "union_area": 0.0,
            "iou": 0.0,
            "precision": 0.0,
            "recall": 0.0,
            "dice": 0.0,
        }

    pred = pred_geom if pred_geom.is_valid else pred_geom.buffer(0)
    truth = truth_geom if truth_geom.is_valid else truth_geom.buffer(0)

    if pred.is_empty or truth.is_empty:
        return {
            "pred_area": 0.0,
            "truth_area": 0.0,
            "intersection_area": 0.0,
            "union_area": 0.0,
            "iou": 0.0,
            "precision": 0.0,
            "recall": 0.0,
            "dice": 0.0,
        }

    intersection = pred.intersection(truth)
    union = pred.union(truth)

    pred_area = float(pred.area)
    truth_area = float(truth.area)
    inter_area = float(intersection.area)
    union_area = float(union.area)

    iou = inter_area / union_area if union_area > 0 else 0.0
    precision = inter_area / pred_area if pred_area > 0 else 0.0
    recall = inter_area / truth_area if truth_area > 0 else 0.0
    denom = pred_area + truth_area
    dice = (2.0 * inter_area / denom) if denom > 0 else 0.0

    return {
        "pred_area": pred_area,
        "truth_area": truth_area,
        "intersection_area": inter_area,
        "union_area": union_area,
        "iou": float(iou),
        "precision": float(precision),
        "recall": float(recall),
        "dice": float(dice),
    }


def rank_candidates_by_iou(
    candidates: List[Dict[str, Any]],
    truth_geom: BaseGeometry,
) -> List[Dict[str, Any]]:
    ranked: List[Dict[str, Any]] = []
    for candidate in candidates:
        geom = candidate.get("geometry")
        if geom is None:
            continue
        metrics = overlap_metrics(geom, truth_geom)
        ranked.append({**candidate, "metrics": metrics})

    ranked.sort(
        key=lambda item: (
            float((item.get("metrics") or {}).get("iou", 0.0)),
            float((item.get("metrics") or {}).get("recall", 0.0)),
            float((item.get("metrics") or {}).get("precision", 0.0)),
        ),
        reverse=True,
    )
    return ranked
