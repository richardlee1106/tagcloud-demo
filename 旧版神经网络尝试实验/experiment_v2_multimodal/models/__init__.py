# -*- coding: utf-8 -*-
"""
V2 多模态空间编码器模型
"""

from .poi_encoder import POITransformerEncoder, POIGraphEncoder
from .road_encoder import RoadGNNEncoder, RoadAwarePOIEncoder, RoadGraphBuilder
from .aoi_encoder import AOIPolygonEncoder, AOIConvEncoder, AOIQueryEncoder
from .fusion import (
    ConcatFusion,
    GatingFusion,
    AttentionFusion,
    CrossModalAttention,
    get_fusion_module,
)

__all__ = [
    "POITransformerEncoder",
    "POIGraphEncoder",
    "RoadGNNEncoder",
    "RoadAwarePOIEncoder",
    "RoadGraphBuilder",
    "AOIPolygonEncoder",
    "AOIConvEncoder",
    "AOIQueryEncoder",
    "ConcatFusion",
    "GatingFusion",
    "AttentionFusion",
    "CrossModalAttention",
    "get_fusion_module",
]
