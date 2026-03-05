"""Region comparison helpers for Python spatial pipeline.

This module mirrors the previous Node executor behavior for `region_comparison`
while keeping output shape compatible with existing frontend rendering.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, Iterable, List, Sequence


def _to_str(value: Any) -> str:
    return str(value).strip()


def _normalize_ratio(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return (count / total) * 100.0


def _normalize_poi(raw: Any) -> Dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    props = raw.get("properties") if isinstance(raw.get("properties"), dict) else raw
    return {
        "id": props.get("id", raw.get("id")),
        "name": props.get("name") or "",
        "address": props.get("address") or "",
        "type": props.get("type") or "",
        "category_big": props.get("category_big") or props.get("categoryBig") or props.get("??") or "",
        "category_mid": props.get("category_mid") or props.get("categoryMid") or props.get("??") or "",
        "category_small": props.get("category_small") or props.get("categorySmall") or props.get("??") or "",
        "lon": props.get("lon", props.get("lng", props.get("longitude"))),
        "lat": props.get("lat", props.get("latitude")),
    }


def _matches_category_filters(poi: Dict[str, Any], categories: Sequence[str]) -> bool:
    if not categories:
        return True

    haystacks = [
        _to_str(poi.get("category_big")).lower(),
        _to_str(poi.get("category_mid")).lower(),
        _to_str(poi.get("category_small")).lower(),
        _to_str(poi.get("type")).lower(),
    ]

    for category in categories:
        keyword = _to_str(category).lower()
        if not keyword:
            continue
        if any(keyword in field for field in haystacks):
            return True

    return False


def _primary_category(poi: Dict[str, Any]) -> str:
    return _to_str(
        poi.get("category_small")
        or poi.get("category_mid")
        or poi.get("category_big")
        or poi.get("type")
        or "unknown"
    )


def _major_category(poi: Dict[str, Any]) -> str:
    return _to_str(poi.get("category_big") or "other")


def _top_items(counter: Counter, total: int, limit: int) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for name, count in counter.most_common(limit):
        ratio = _normalize_ratio(count, total)
        result.append(
            {
                "name": name,
                "count": count,
                "ratio": f"{ratio:.1f}%",
                "ratio_value": round(ratio, 2),
            }
        )
    return result


def analyze_single_region(
    region: Dict[str, Any],
    *,
    categories: Sequence[str],
    repository=None,
    per_region_limit: int = 12000,
) -> Dict[str, Any]:
    """Analyze one region and return comparison-ready stats."""
    region_id = region.get("id")
    region_name = _to_str(region.get("name") or f"region-{region_id}")

    region_pois: List[Dict[str, Any]] = []
    source = "none"

    if isinstance(region.get("pois"), list) and region.get("pois"):
        for item in region.get("pois", []):
            poi = _normalize_poi(item)
            if poi is not None and _matches_category_filters(poi, categories):
                region_pois.append(poi)
        source = "payload"

    if not region_pois and repository is not None:
        boundary_wkt = region.get("boundaryWKT") or region.get("boundary_wkt")
        if isinstance(boundary_wkt, str) and boundary_wkt.strip():
            try:
                region_pois = repository.fetch_pois_by_wkt(
                    boundary_wkt=boundary_wkt,
                    categories=list(categories),
                    limit=per_region_limit,
                )
                source = "db"
            except Exception:
                region_pois = []
                source = "db_error"

    total = len(region_pois)
    category_counter: Counter = Counter()
    major_counter: Counter = Counter()

    for poi in region_pois:
        category_counter[_primary_category(poi)] += 1
        major_counter[_major_category(poi)] += 1

    return {
        "id": region_id,
        "name": region_name,
        "poi_count": total,
        "category_distribution": dict(category_counter),
        "major_category_distribution": dict(major_counter),
        "top_categories": _top_items(category_counter, total, limit=10),
        "top_major_categories": _top_items(major_counter, total, limit=5),
        "center": region.get("center"),
        "source": source,
    }


def _build_comparison_summary(
    region_analyses: Sequence[Dict[str, Any]],
    differences: Sequence[Dict[str, Any]],
    similarities: Sequence[Dict[str, Any]],
) -> str:
    names = [item.get("name") or "unknown-region" for item in region_analyses]
    parts = [f"{', '.join(names)} comparison"]

    poi_summary = ", ".join(f"{item.get('name')}({item.get('poi_count', 0)} POIs)" for item in region_analyses)
    if poi_summary:
        parts.append(f"- POI totals: {poi_summary}")

    if differences:
        parts.append(f"- Key differences ({len(differences)})")
        for item in differences[:3]:
            parts.append(f"  - {item.get('description')}")

    if similarities:
        parts.append(f"- Shared patterns ({len(similarities)})")
        for item in similarities[:2]:
            parts.append(f"  - {item.get('description')}")

    return "\n".join(parts)


def compute_region_comparison(
    region_analyses: Sequence[Dict[str, Any]],
    dimensions: Sequence[str] | None = None,
) -> Dict[str, Any] | None:
    """Build cross-region differences and similarities from aggregated stats."""
    if len(region_analyses) < 2:
        return None

    # Phase 1 compares major categories for deterministic and reproducible output.
    all_major_categories = set()
    for analysis in region_analyses:
        all_major_categories.update(analysis.get("major_category_distribution", {}).keys())

    similarities: List[Dict[str, Any]] = []
    differences: List[Dict[str, Any]] = []

    for category in sorted(all_major_categories):
        ratios = []
        for analysis in region_analyses:
            count = int(analysis.get("major_category_distribution", {}).get(category, 0))
            total = int(analysis.get("poi_count", 0))
            ratio = _normalize_ratio(count, total)
            ratios.append(
                {
                    "region": analysis.get("name"),
                    "count": count,
                    "ratio": ratio,
                }
            )

        max_ratio = max(item["ratio"] for item in ratios)
        min_ratio = min(item["ratio"] for item in ratios)
        gap = max_ratio - min_ratio

        ratio_payload = [
            {
                "region": item["region"],
                "count": item["count"],
                "ratio": f"{item['ratio']:.1f}%",
                "ratio_value": round(item["ratio"], 2),
            }
            for item in ratios
        ]

        if gap < 5 and max_ratio > 5:
            similarities.append(
                {
                    "dimension": category,
                    "description": f"{category} share is close across regions ({min_ratio:.1f}% ~ {max_ratio:.1f}%)",
                    "ratios": ratio_payload,
                }
            )
        elif gap >= 5:
            max_item = max(ratios, key=lambda item: item["ratio"])
            min_item = min(ratios, key=lambda item: item["ratio"])
            differences.append(
                {
                    "dimension": category,
                    "description": (
                        f"{max_item['region']} has higher {category} share ({max_item['ratio']:.1f}%) "
                        f"than {min_item['region']} ({min_item['ratio']:.1f}%)"
                    ),
                    "gap": f"{gap:.1f}%",
                    "gap_value": round(gap, 2),
                    "ratios": ratio_payload,
                }
            )

    differences.sort(key=lambda item: item.get("gap_value", 0), reverse=True)

    return {
        "regions_compared": [item.get("name") for item in region_analyses],
        "total_pois_compared": sum(int(item.get("poi_count", 0)) for item in region_analyses),
        "similarities": similarities[:5],
        "differences": differences[:10],
        "summary": _build_comparison_summary(region_analyses, differences, similarities),
        "dimensions": list(dimensions or []),
    }


def analyze_region_set(
    *,
    regions: Iterable[Dict[str, Any]],
    target_region_ids: Sequence[Any],
    categories: Sequence[str],
    repository=None,
    per_region_limit: int = 12000,
) -> List[Dict[str, Any]]:
    """Filter target regions and compute per-region analysis payloads."""
    region_items = [item for item in regions if isinstance(item, dict)]
    target_keys = {_to_str(item) for item in (target_region_ids or []) if _to_str(item)}
    if not target_keys:
        return []

    analyses: List[Dict[str, Any]] = []
    for region in region_items:
        region_key = _to_str(region.get("id"))
        if region_key not in target_keys:
            continue

        analyses.append(
            analyze_single_region(
                region,
                categories=categories,
                repository=repository,
                per_region_limit=per_region_limit,
            )
        )

    return analyses
