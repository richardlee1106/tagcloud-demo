"""Run composite_v5 with a bbox geometry and compare against truth geometry.

Supports both GeoJSON and Shapefile (*.shp) inputs.
Each run appends a Chinese tuning log for chain auditing.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from pipeline.overlap_evaluator import (  # noqa: E402
    geometry_bounds_as_viewport,
    load_geometry_from_vector_file,
    overlap_metrics,
    rank_candidates_by_iou,
)
from pipeline.spatial_pipeline import SpatialPipeline  # noqa: E402

PROJECT_ROOT = ROOT_DIR.parents[2]
DEFAULT_CHAIN_LOG = PROJECT_ROOT / "RAG_LOG" / f"V5_重合度调优链路日志_{dt.datetime.now():%Y%m%d}.log"


def _to_bool_text(value: bool) -> str:
    return "是" if bool(value) else "否"


def _resolve_toggle_arg(raw_value: str | None, default_value: bool) -> bool:
    if raw_value is None:
        return default_value
    value = str(raw_value).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default_value


def _append_chain_log(log_path: Path, lines: List[str]) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        for line in lines:
            f.write(line.rstrip() + "\n")


def _build_request(
    *,
    viewport: List[float],
    semantic_query: str,
    categories: List[str],
    strict_bbox: bool,
    query_type: str,
    limit: int,
    cluster_min_cluster_size: int | None,
    cluster_min_samples: int | None,
    allow_single_cluster_fallback: bool,
    road_boundary_enhancement: bool,
    landuse_boundary_enhancement: bool,
    semantic_anchor_hints: List[str],
    anchor_mask_block_overlap_ratio: float | None,
    anchor_mask_support_edge_ratio: float | None,
    anchor_mask_outlier_area_factor: float | None,
    anchor_mask_outlier_overlap_ratio: float | None,
    anchor_mask_use_centroid: bool,
    anchor_mask_use_unfiltered_poi_support: bool,
    water_semantic_mask_enabled: bool,
) -> Dict[str, Any]:
    hints = {
        "semantic_query": semantic_query,
        "query_plan": {
            "query_type": query_type,
            "intent_mode": "macro_overview",
            "need_global_context": True,
            "need_landmarks": True,
            "semantic_anchor_candidates": semantic_anchor_hints,
        },
        "vlm_extracted_texts": list(semantic_anchor_hints),
        "options": {
            "confidenceModel": "composite_v5",
            "strictBbox": bool(strict_bbox),
            "visualReviewEnabled": False,
            "visualRemoteEnabled": False,
            "selfValidationEnabled": True,
            "skgEnabled": True,
            "limit": int(limit),
            "allowSingleClusterFallback": bool(allow_single_cluster_fallback),
            "roadBoundaryEnhancement": bool(road_boundary_enhancement),
            "landuseBoundaryEnhancement": bool(landuse_boundary_enhancement),
            "semanticAnchorHints": semantic_anchor_hints,
            "anchorMaskUseCentroid": bool(anchor_mask_use_centroid),
            "anchorMaskUseUnfilteredPoiSupport": bool(anchor_mask_use_unfiltered_poi_support),
            "waterSemanticMaskEnabled": bool(water_semantic_mask_enabled),
            "sourcePolicy": {
                "has_category_filter": bool(categories),
                "selected_categories": list(categories),
            },
        },
    }
    if anchor_mask_block_overlap_ratio is not None:
        hints["options"]["anchorMaskBlockOverlapRatio"] = float(anchor_mask_block_overlap_ratio)
    if anchor_mask_support_edge_ratio is not None:
        hints["options"]["anchorMaskSupportEdgeRatio"] = float(anchor_mask_support_edge_ratio)
    if anchor_mask_outlier_area_factor is not None:
        hints["options"]["anchorMaskOutlierAreaFactor"] = float(anchor_mask_outlier_area_factor)
    if anchor_mask_outlier_overlap_ratio is not None:
        hints["options"]["anchorMaskOutlierOverlapRatio"] = float(anchor_mask_outlier_overlap_ratio)
    if cluster_min_cluster_size is not None and cluster_min_cluster_size > 0:
        hints["options"]["clusterMinClusterSize"] = int(cluster_min_cluster_size)
    if cluster_min_samples is not None and cluster_min_samples > 0:
        hints["options"]["clusterMinSamples"] = int(cluster_min_samples)

    spatial_context = {
        "viewport": viewport,
        "analysisScale": "street",
        "mode": "",
        "boundary": None,
    }

    return {
        "request_id": f"eval_v5_{int(time.time())}",
        "query_type": query_type,
        "spatial_context": json.dumps(spatial_context, ensure_ascii=False),
        "categories": categories,
        "hints": json.dumps(hints, ensure_ascii=False),
        "mode": "sync",
        "candidates_json": "",
        "execution_profile": "core",
        "dry_run": False,
    }


def _extract_candidate_geometries(results: Dict[str, Any]) -> List[Dict[str, Any]]:
    regions = results.get("vernacular_regions") or []
    if not isinstance(regions, list):
        regions = []

    extracted: List[Dict[str, Any]] = []
    for idx, region in enumerate(regions):
        if not isinstance(region, dict):
            continue

        boundary_geojson = region.get("boundary")
        if not isinstance(boundary_geojson, dict):
            continue

        try:
            geom = shape(boundary_geojson)
            if geom.is_empty:
                continue
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty:
                continue
        except Exception:
            continue

        extracted.append(
            {
                "index": idx,
                "id": region.get("id"),
                "name": region.get("name"),
                "boundary_confidence": float(region.get("boundary_confidence") or 0.0),
                "vitality_score": float(region.get("vitality_score") or 0.0),
                "geometry": geom,
            }
        )

    return extracted


def _safe_union(geoms: List[BaseGeometry]) -> BaseGeometry | None:
    if not geoms:
        return None
    union_geom = unary_union(geoms)
    if union_geom.is_empty:
        return None
    if not union_geom.is_valid:
        union_geom = union_geom.buffer(0)
    return union_geom if not union_geom.is_empty else None


def _write_geojson(
    *,
    output_path: Path,
    bbox_geom: BaseGeometry,
    truth_geom: BaseGeometry,
    best_candidate: Dict[str, Any] | None,
) -> None:
    features: List[Dict[str, Any]] = [
        {
            "type": "Feature",
            "geometry": mapping(bbox_geom),
            "properties": {"role": "bbox_input"},
        },
        {
            "type": "Feature",
            "geometry": mapping(truth_geom),
            "properties": {"role": "truth_boundary"},
        },
    ]

    if best_candidate:
        pred_geom: BaseGeometry = best_candidate["geometry"]
        inter = pred_geom.intersection(truth_geom)
        fp = pred_geom.difference(truth_geom)
        fn = truth_geom.difference(pred_geom)

        features.extend(
            [
                {
                    "type": "Feature",
                    "geometry": mapping(pred_geom),
                    "properties": {
                        "role": "pred_best",
                        "name": best_candidate.get("name"),
                        "iou": float((best_candidate.get("metrics") or {}).get("iou", 0.0)),
                    },
                },
                {
                    "type": "Feature",
                    "geometry": mapping(inter),
                    "properties": {"role": "intersection"},
                },
                {
                    "type": "Feature",
                    "geometry": mapping(fp),
                    "properties": {"role": "false_positive"},
                },
                {
                    "type": "Feature",
                    "geometry": mapping(fn),
                    "properties": {"role": "false_negative"},
                },
            ]
        )

    output = {"type": "FeatureCollection", "features": features}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate composite_v5 overlap against truth geometry")
    parser.add_argument("--bbox-file", required=True, help="BBOX geometry file: .geojson/.json/.shp")
    parser.add_argument("--bbox-feature-index", type=int, default=0, help="Feature index in bbox file")
    parser.add_argument("--truth-file", required=True, help="Truth geometry file: .geojson/.json/.shp")
    parser.add_argument(
        "--truth-feature-index",
        type=int,
        default=-1,
        help="Feature index in truth file, use -1 to union all features",
    )
    parser.add_argument("--name", default="case", help="Case name used in output files")
    parser.add_argument("--semantic-query", default="", help="Semantic query text for planner hints")
    parser.add_argument("--categories", default="", help="Comma-separated categories")
    parser.add_argument(
        "--semantic-anchor-hints",
        default="",
        help="Comma-separated semantic anchor hints, e.g. 湖北大学,沙湖公园",
    )
    parser.add_argument("--query-type", default="area_analysis", help="Pipeline query type")
    parser.add_argument("--limit", type=int, default=8000, help="Max fetch limit")
    parser.add_argument("--strict-bbox", action="store_true", help="Enable strict bbox clip in v5")
    parser.add_argument("--cluster-min-cluster-size", type=int, default=None, help="Override cluster min cluster size")
    parser.add_argument("--cluster-min-samples", type=int, default=None, help="Override cluster min samples")
    parser.add_argument(
        "--allow-single-cluster-fallback",
        action="store_true",
        help="Enable single-cluster fallback in v5",
    )
    parser.add_argument(
        "--road-boundary-enhancement",
        default=None,
        choices=["true", "false"],
        help="Force road boundary enhancement on/off",
    )
    parser.add_argument(
        "--landuse-boundary-enhancement",
        default=None,
        choices=["true", "false"],
        help="Force landuse boundary enhancement on/off",
    )
    parser.add_argument(
        "--anchor-mask-block-overlap-ratio",
        type=float,
        default=None,
        help="Override anchor mask block overlap ratio (0~1)",
    )
    parser.add_argument(
        "--anchor-mask-support-edge-ratio",
        type=float,
        default=None,
        help="Override anchor mask support-edge overlap ratio (0~1)",
    )
    parser.add_argument(
        "--anchor-mask-outlier-area-factor",
        type=float,
        default=None,
        help="Suppress non-centroid mega blocks above median*factor",
    )
    parser.add_argument(
        "--anchor-mask-outlier-overlap-ratio",
        type=float,
        default=None,
        help="Non-centroid outlier must satisfy this overlap ratio",
    )
    parser.add_argument(
        "--anchor-mask-use-centroid",
        default=None,
        choices=["true", "false"],
        help="Enable centroid-inside rule for anchor mask",
    )
    parser.add_argument(
        "--anchor-mask-use-unfiltered-poi-support",
        default=None,
        choices=["true", "false"],
        help="Use unfiltered POIs to补块 for anchor mask",
    )
    parser.add_argument(
        "--water-semantic-mask-enabled",
        default=None,
        choices=["true", "false"],
        help="Enable AOI∩EULUC water semantic mask override",
    )
    parser.add_argument("--target-iou", type=float, default=0.90, help="Target IoU threshold for pass/fail")
    parser.add_argument("--note", default="", help="Manual note for this tuning attempt")
    parser.add_argument(
        "--chain-log-file",
        default=str(DEFAULT_CHAIN_LOG),
        help="Chinese chain log file path",
    )
    parser.add_argument(
        "--output-dir",
        default=str(ROOT_DIR / "scripts" / "eval_output"),
        help="Output directory for json/geojson reports",
    )
    args = parser.parse_args()

    resolved_bbox_file = Path(args.bbox_file).resolve()
    resolved_truth_file = Path(args.truth_file).resolve()

    bbox_geom = load_geometry_from_vector_file(resolved_bbox_file, feature_index=args.bbox_feature_index)
    truth_geom = load_geometry_from_vector_file(resolved_truth_file, feature_index=args.truth_feature_index)
    viewport = geometry_bounds_as_viewport(bbox_geom)

    categories = [item.strip() for item in args.categories.split(",") if item.strip()]
    semantic_anchor_hints = [
        item.strip() for item in args.semantic_anchor_hints.split(",") if item.strip()
    ]
    road_boundary_enhancement = _resolve_toggle_arg(args.road_boundary_enhancement, default_value=True)
    landuse_boundary_enhancement = _resolve_toggle_arg(args.landuse_boundary_enhancement, default_value=True)
    anchor_mask_use_centroid = _resolve_toggle_arg(args.anchor_mask_use_centroid, default_value=True)
    anchor_mask_use_unfiltered_poi_support = _resolve_toggle_arg(
        args.anchor_mask_use_unfiltered_poi_support, default_value=True
    )
    water_semantic_mask_enabled = _resolve_toggle_arg(args.water_semantic_mask_enabled, default_value=True)

    run_id = f"{args.name}_{dt.datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}"
    request = _build_request(
        viewport=viewport,
        semantic_query=args.semantic_query.strip(),
        categories=categories,
        strict_bbox=args.strict_bbox,
        query_type=args.query_type,
        limit=args.limit,
        cluster_min_cluster_size=args.cluster_min_cluster_size,
        cluster_min_samples=args.cluster_min_samples,
        allow_single_cluster_fallback=args.allow_single_cluster_fallback,
        road_boundary_enhancement=road_boundary_enhancement,
        landuse_boundary_enhancement=landuse_boundary_enhancement,
        semantic_anchor_hints=semantic_anchor_hints,
        anchor_mask_block_overlap_ratio=args.anchor_mask_block_overlap_ratio,
        anchor_mask_support_edge_ratio=args.anchor_mask_support_edge_ratio,
        anchor_mask_outlier_area_factor=args.anchor_mask_outlier_area_factor,
        anchor_mask_outlier_overlap_ratio=args.anchor_mask_outlier_overlap_ratio,
        anchor_mask_use_centroid=anchor_mask_use_centroid,
        anchor_mask_use_unfiltered_poi_support=anchor_mask_use_unfiltered_poi_support,
        water_semantic_mask_enabled=water_semantic_mask_enabled,
    )

    pipeline = SpatialPipeline()
    final_payload: Dict[str, Any] | None = None
    stage_events: List[Dict[str, Any]] = []
    for event in pipeline.run(request):
        event_type = str(event.get("type") or "").upper()
        if event_type in {"STAGE", "PROGRESS"}:
            stage_events.append(
                {
                    "type": event_type,
                    "payload": event.get("payload") if isinstance(event.get("payload"), dict) else {},
                }
            )
        if str(event.get("type") or "").upper() == "FINAL":
            final_payload = (event.get("payload") or {}).get("results")
            break

    if not isinstance(final_payload, dict):
        print("[EVAL_V5] No final results returned from pipeline")
        _append_chain_log(
            Path(args.chain_log_file),
            [
                f"[V5链路调优] 时间={dt.datetime.now():%Y-%m-%d %H:%M:%S} 运行ID={run_id}",
                f"[V5链路调优] 案例={args.name} 备注={args.note or '无'}",
                "[V5链路调优] 结果: 管线未返回 FINAL 结果，评估失败",
                "[V5链路调优] ----------------------------------------------------------------",
            ],
        )
        return 2

    candidates = _extract_candidate_geometries(final_payload)
    if not candidates:
        print("[EVAL_V5] Pipeline returned no vernacular regions to evaluate")
        _append_chain_log(
            Path(args.chain_log_file),
            [
                f"[V5链路调优] 时间={dt.datetime.now():%Y-%m-%d %H:%M:%S} 运行ID={run_id}",
                f"[V5链路调优] 案例={args.name} 备注={args.note or '无'}",
                "[V5链路调优] 结果: 未产出 vernacular_regions，无法计算重合度",
                "[V5链路调优] ----------------------------------------------------------------",
            ],
        )
        return 3

    ranked = rank_candidates_by_iou(candidates, truth_geom)
    best = ranked[0] if ranked else None

    union_geom = _safe_union([item["geometry"] for item in candidates])
    union_metrics = overlap_metrics(union_geom, truth_geom) if union_geom is not None else None
    bbox_truth_metrics = overlap_metrics(bbox_geom, truth_geom)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{args.name}_eval.json"
    geojson_path = output_dir / f"{args.name}_compare.geojson"

    stats = final_payload.get("stats") if isinstance(final_payload.get("stats"), dict) else {}
    report = {
        "run_id": run_id,
        "case_name": args.name,
        "input": {
            "bbox_file": str(Path(args.bbox_file).resolve()),
            "bbox_file_resolved": str(resolved_bbox_file),
            "bbox_feature_index": args.bbox_feature_index,
            "truth_file": str(Path(args.truth_file).resolve()),
            "truth_file_resolved": str(resolved_truth_file),
            "truth_feature_index": args.truth_feature_index,
            "viewport": viewport,
            "strict_bbox": bool(args.strict_bbox),
            "query_type": args.query_type,
            "categories": categories,
            "semantic_query": args.semantic_query,
            "semantic_anchor_hints": semantic_anchor_hints,
            "cluster_min_cluster_size": args.cluster_min_cluster_size,
            "cluster_min_samples": args.cluster_min_samples,
            "allow_single_cluster_fallback": bool(args.allow_single_cluster_fallback),
            "road_boundary_enhancement": bool(road_boundary_enhancement),
            "landuse_boundary_enhancement": bool(landuse_boundary_enhancement),
            "anchor_mask_block_overlap_ratio": args.anchor_mask_block_overlap_ratio,
            "anchor_mask_support_edge_ratio": args.anchor_mask_support_edge_ratio,
            "anchor_mask_outlier_area_factor": args.anchor_mask_outlier_area_factor,
            "anchor_mask_outlier_overlap_ratio": args.anchor_mask_outlier_overlap_ratio,
            "anchor_mask_use_centroid": bool(anchor_mask_use_centroid),
            "anchor_mask_use_unfiltered_poi_support": bool(anchor_mask_use_unfiltered_poi_support),
            "water_semantic_mask_enabled": bool(water_semantic_mask_enabled),
            "note": args.note,
            "target_iou": float(args.target_iou),
        },
        "pipeline_stats": {
            "total_candidates": int(stats.get("total_candidates", 0)),
            "cluster_count": int(stats.get("cluster_count", 0)),
            "avg_boundary_confidence": float(stats.get("avg_boundary_confidence", 0.0) or 0.0),
            "avg_boundary_quality_score": float(stats.get("avg_boundary_quality_score", 0.0) or 0.0),
            "boundary_method": stats.get("boundary_method"),
            "boundary_confidence_model": stats.get("boundary_confidence_model"),
            "boundary_quality_model": stats.get("boundary_quality_model"),
        },
        "pipeline_stage_events": stage_events[-30:],
        "bbox_vs_truth": bbox_truth_metrics,
        "best_match": {
            "id": best.get("id") if best else None,
            "name": best.get("name") if best else None,
            "boundary_confidence": float(best.get("boundary_confidence", 0.0)) if best else 0.0,
            "vitality_score": float(best.get("vitality_score", 0.0)) if best else 0.0,
            "metrics": best.get("metrics") if best else None,
        },
        "union_all_predictions_vs_truth": union_metrics,
        "top_matches": [
            {
                "rank": idx + 1,
                "id": item.get("id"),
                "name": item.get("name"),
                "boundary_confidence": float(item.get("boundary_confidence", 0.0)),
                "vitality_score": float(item.get("vitality_score", 0.0)),
                "metrics": item.get("metrics"),
            }
            for idx, item in enumerate(ranked[:10])
        ],
    }
    best_iou = float((((best or {}).get("metrics") or {}).get("iou", 0.0)))
    report["target"] = {
        "target_iou": float(args.target_iou),
        "is_pass": bool(best_iou >= float(args.target_iou)),
        "best_iou": best_iou,
    }

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    _write_geojson(
        output_path=geojson_path,
        bbox_geom=bbox_geom,
        truth_geom=truth_geom,
        best_candidate=best,
    )

    print(f"[EVAL_V5] case={args.name}")
    print(f"[EVAL_V5] viewport={viewport}")
    if best:
        metrics = best.get("metrics") or {}
        print(
            "[EVAL_V5] best="
            f"{best.get('name')} "
            f"IoU={float(metrics.get('iou', 0.0)):.4f} "
            f"Recall={float(metrics.get('recall', 0.0)):.4f} "
            f"Precision={float(metrics.get('precision', 0.0)):.4f} "
            f"Dice={float(metrics.get('dice', 0.0)):.4f}"
        )
    else:
        print("[EVAL_V5] best=None")
    if union_metrics:
        print(
            "[EVAL_V5] union_all="
            f"IoU={float(union_metrics.get('iou', 0.0)):.4f} "
            f"Recall={float(union_metrics.get('recall', 0.0)):.4f} "
            f"Precision={float(union_metrics.get('precision', 0.0)):.4f}"
        )
    print(f"[EVAL_V5] report_json={json_path}")
    print(f"[EVAL_V5] report_geojson={geojson_path}")

    chain_log_lines = [
        f"[V5链路调优] 时间={dt.datetime.now():%Y-%m-%d %H:%M:%S} 运行ID={run_id}",
        f"[V5链路调优] 案例={args.name} 备注={args.note or '无'}",
        f"[V5链路调优] 输入文件 bbox={Path(args.bbox_file).resolve()} truth={Path(args.truth_file).resolve()}",
        f"[V5链路调优] 解析文件 bbox={resolved_bbox_file} truth={resolved_truth_file}",
        f"[V5链路调优] 视口={viewport}",
        (
            "[V5链路调优] 参数 "
            f"strictBbox={_to_bool_text(args.strict_bbox)} "
            f"categories={categories or '[]'} "
            f"semanticQuery={args.semantic_query or '空'} "
            f"semanticAnchorHints={semantic_anchor_hints or '[]'} "
            f"clusterMinClusterSize={args.cluster_min_cluster_size} "
            f"clusterMinSamples={args.cluster_min_samples} "
            f"singleClusterFallback={_to_bool_text(args.allow_single_cluster_fallback)} "
            f"roadEnhance={_to_bool_text(road_boundary_enhancement)} "
            f"landuseEnhance={_to_bool_text(landuse_boundary_enhancement)} "
            f"anchorMaskOverlapRatio={args.anchor_mask_block_overlap_ratio} "
            f"anchorMaskSupportEdgeRatio={args.anchor_mask_support_edge_ratio} "
            f"anchorMaskOutlierAreaFactor={args.anchor_mask_outlier_area_factor} "
            f"anchorMaskOutlierOverlapRatio={args.anchor_mask_outlier_overlap_ratio} "
            f"anchorMaskUseCentroid={_to_bool_text(anchor_mask_use_centroid)} "
            f"anchorMaskUseUnfilteredPoiSupport={_to_bool_text(anchor_mask_use_unfiltered_poi_support)} "
            f"waterSemanticMask={_to_bool_text(water_semantic_mask_enabled)} "
            f"limit={args.limit}"
        ),
        (
            "[V5链路调优] 结果 "
            f"clusterCount={int(stats.get('cluster_count', 0))} "
            f"totalCandidates={int(stats.get('total_candidates', 0))} "
            f"bestName={best.get('name') if best else 'None'} "
            f"bestIoU={best_iou:.4f} "
            f"bestRecall={float((((best or {}).get('metrics') or {}).get('recall', 0.0))):.4f} "
            f"bestPrecision={float((((best or {}).get('metrics') or {}).get('precision', 0.0))):.4f} "
            f"targetIoU={float(args.target_iou):.4f} "
            f"是否达标={'是' if best_iou >= float(args.target_iou) else '否'}"
        ),
        f"[V5链路调优] 报告JSON={json_path}",
        f"[V5链路调优] 对比GeoJSON={geojson_path}",
        "[V5链路调优] ----------------------------------------------------------------",
    ]
    _append_chain_log(Path(args.chain_log_file), chain_log_lines)
    print(f"[EVAL_V5] chain_log={Path(args.chain_log_file)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
