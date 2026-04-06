# -*- coding: utf-8 -*-
"""
V2.3 空间拓扑编码器

让模型学习空间拓扑关系，而非仅处理坐标数值。
"""

from .config import SpatialEncoderConfig, FeatureSchema
from .models import (
    SpatialTopologyEncoder,
    DistancePreserveLoss,
    NeighborConsistencyLoss,
)

__version__ = "2.3.0"
__all__ = [
    'SpatialEncoderConfig',
    'FeatureSchema',
    'SpatialTopologyEncoder',
    'DistancePreserveLoss',
    'NeighborConsistencyLoss',
]
