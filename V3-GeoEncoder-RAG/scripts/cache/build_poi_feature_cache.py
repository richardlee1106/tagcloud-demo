# -*- coding: utf-8 -*-
"""
构建 POI 离线同构特征缓存。

目标：
1. 复用训练期 `POIDataLoader` 的 72 维同构特征构建逻辑；
2. 生成 `poi_id -> point/line/polygon/direction` 的本地 `.npz` 缓存；
3. 供 V3 `/encode` exact-anchor 在启动时直接读取，缩小在线/离线特征差距。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT))

from spatial_encoder.v26_GLM.data_loader_poi import POIDataLoader


DEFAULT_OUTPUT_PATH = PROJECT_ROOT / 'V3-GeoEncoder-RAG' / 'cache' / 'poi_feature_cache_v1.npz'


def build_cache(
    output_path: Path,
    *,
    sample_ratio: float = 1.0,
    limit: int | None = None,
) -> None:
    loader = POIDataLoader(k_neighbors=50)
    (
        point_features,
        line_features,
        polygon_features,
        direction_features,
        _coords,
        _region_labels,
        metadata,
        *_,
    ) = loader.load(sample_ratio=sample_ratio, limit=limit)

    if len(metadata) != len(point_features):
        raise ValueError(f'metadata_length_mismatch:{len(metadata)}!={len(point_features)}')

    poi_ids = np.zeros(len(metadata), dtype=np.int64)
    for index, meta in enumerate(metadata):
        raw_poi_id = meta.get('poi_id')
        if raw_poi_id is None:
            raise ValueError(f'missing_poi_id_at_index:{index}')
        poi_ids[index] = int(raw_poi_id)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        output_path,
        poi_ids=poi_ids,
        point_features=np.asarray(point_features, dtype=np.float32),
        line_features=np.asarray(line_features, dtype=np.float32),
        polygon_features=np.asarray(polygon_features, dtype=np.float32),
        direction_features=np.asarray(direction_features, dtype=np.float32),
    )

    print('=' * 72)
    print('POI feature cache build complete')
    print(f'output: {output_path}')
    print(f'rows: {len(poi_ids):,}')
    print(f'point_features: {point_features.shape}')
    print(f'line_features: {line_features.shape}')
    print(f'polygon_features: {polygon_features.shape}')
    print(f'direction_features: {direction_features.shape}')
    print('=' * 72)


def main() -> None:
    parser = argparse.ArgumentParser(description='Build offline POI feature cache for V3 exact-anchor encoding.')
    parser.add_argument(
        '--output',
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help='输出缓存文件路径（默认：V3-GeoEncoder-RAG/cache/poi_feature_cache_v1.npz）',
    )
    parser.add_argument(
        '--sample-ratio',
        type=float,
        default=1.0,
        help='采样比例，默认 1.0（全量）。',
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='限制构建样本数量，便于烟雾测试。',
    )
    args = parser.parse_args()

    if args.sample_ratio <= 0 or args.sample_ratio > 1.0:
        raise ValueError('sample_ratio_must_be_between_0_and_1')
    if args.limit is not None and args.limit <= 0:
        raise ValueError('limit_must_be_positive')

    build_cache(
        args.output,
        sample_ratio=args.sample_ratio,
        limit=args.limit,
    )


if __name__ == '__main__':
    main()
