# -*- coding: utf-8 -*-
"""
POI 空间编码器服务

加载训练好的 UltimateSpatialEncoder 模型，提供：
1. 批量 embedding 生成
2. 空间重排（Spatial Rerank）
3. 方向预测
4. 区域分类

Author: Sisyphus
Date: 2026-03-20
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch

# 添加项目根目录到 sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
import sys
sys.path.insert(0, str(PROJECT_ROOT))

from spatial_encoder.v26_GLM.ultimate_encoder import build_ultimate_encoder
from spatial_encoder.v26_GLM.config_v26_pro import DEFAULT_PRO_CONFIG


class POIEncoderService:
    """
    POI 空间编码器服务

    用法：
        service = POIEncoderService(model_path="path/to/best_model.pt")
        embeddings = service.encode_batch(poi_features)
        reranked = service.rerank(query_embedding, candidates, anchor)
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        device: Optional[str] = None,
    ):
        """
        初始化编码器服务

        Args:
            model_path: 模型权重路径（默认使用 POI encoder）
            device: 推理设备（默认自动选择）
        """
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.config = DEFAULT_PRO_CONFIG
        self.embedding_dim = self.config.model.embedding_dim  # 352

        # 加载模型
        self.model = build_ultimate_encoder(self.config)

        if model_path is None:
            # 默认模型路径（多个可能的位置）
            possible_paths = [
                PROJECT_ROOT / "spatial_encoder" / "v26_GLM" / "saved_models" / "poi_encoder" / "best_model.pt",
                Path(__file__).resolve().parents[4] / "spatial_encoder" / "v26_GLM" / "saved_models" / "poi_encoder" / "best_model.pt",
                Path("D:/AAA_Edu/TagCloud/vite-project/spatial_encoder/v26_GLM/saved_models/poi_encoder/best_model.pt"),
            ]
            for p in possible_paths:
                if p.exists():
                    model_path = str(p)
                    break

        if os.path.exists(model_path):
            print(f"[POIEncoder] Loading model from {model_path}")
            state_dict = torch.load(model_path, map_location="cpu", weights_only=False)
            # 处理可能的嵌套 state_dict
            if "model_state_dict" in state_dict:
                state_dict = state_dict["model_state_dict"]
            self.model.load_state_dict(state_dict, strict=False)
            print(f"[POIEncoder] Model loaded successfully")
        else:
            print(f"[POIEncoder] Warning: Model not found at {model_path}, using random weights")

        self.model.eval().to(self.device)
        for p in self.model.parameters():
            p.requires_grad_(False)

        print(f"[POIEncoder] Service ready on {self.device}, embedding_dim={self.embedding_dim}")

    def encode_features(
        self,
        point_features: np.ndarray,
        line_features: np.ndarray,
        polygon_features: np.ndarray,
        direction_features: np.ndarray,
        batch_size: int = 1024,
    ) -> np.ndarray:
        """
        批量编码 POI 特征为 embedding

        Args:
            point_features: [N, 32]
            line_features: [N, 16]
            polygon_features: [N, 16]
            direction_features: [N, 8]
            batch_size: 批次大小

        Returns:
            embeddings: [N, 352] L2 归一化
        """
        N = len(point_features)
        embeddings = []

        for i in range(0, N, batch_size):
            pt = torch.tensor(point_features[i:i+batch_size], dtype=torch.float32).to(self.device)
            ln = torch.tensor(line_features[i:i+batch_size], dtype=torch.float32).to(self.device)
            pg = torch.tensor(polygon_features[i:i+batch_size], dtype=torch.float32).to(self.device)
            dr = torch.tensor(direction_features[i:i+batch_size], dtype=torch.float32).to(self.device)

            with torch.no_grad():
                emb, _, _, _ = self.model.forward_simple(pt, ln, pg, dr)

            embeddings.append(emb.cpu().numpy())

        return np.vstack(embeddings)

    def encode_from_db_records(
        self,
        records: List[Dict],
        batch_size: int = 512,
    ) -> np.ndarray:
        """
        从数据库记录构建特征并编码

        Args:
            records: 数据库查询结果，包含必要字段
            batch_size: 批次大小

        Returns:
            embeddings: [N, 352]
        """
        features = [self._build_features(r) for r in records]
        point_features = np.array([f[0] for f in features])
        line_features = np.array([f[1] for f in features])
        polygon_features = np.array([f[2] for f in features])
        direction_features = np.array([f[3] for f in features])

        return self.encode_features(
            point_features, line_features, polygon_features, direction_features,
            batch_size=batch_size,
        )

    def _build_features(self, record: Dict) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        从数据库记录构建 72 维特征

        特征构建策略与 data_loader_poi.py 一致
        """
        # 坐标归一化参数（武汉三镇）
        LNG_MIN, LNG_MAX = 113.70, 114.65
        LAT_MIN, LAT_MAX = 30.39, 30.79
        CITY_CENTER_LNG, CITY_CENTER_LAT = 114.305, 30.593

        lon = float(record.get("lon", record.get("longitude", 114.3)))
        lat = float(record.get("lat", record.get("latitude", 30.6)))

        norm_lng = (lon - LNG_MIN) / (LNG_MAX - LNG_MIN)
        norm_lat = (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)

        # ---- point_features [32] ----
        point_features = np.zeros(32, dtype=np.float32)
        point_features[0] = norm_lng
        point_features[1] = norm_lat
        # 其他特征暂用零填充（实际使用时应从 DB 加载完整特征）

        # ---- line_features [16] ----
        line_features = np.zeros(16, dtype=np.float32)
        line_features[0] = norm_lng
        line_features[1] = norm_lat

        # ---- polygon_features [16] ----
        polygon_features = np.zeros(16, dtype=np.float32)
        polygon_features[0] = norm_lng
        polygon_features[1] = norm_lat

        # ---- direction_features [8] ----
        dx = lon - CITY_CENTER_LNG
        dy = lat - CITY_CENTER_LAT
        angle = np.arctan2(dy, dx)
        direction = int((angle + np.pi) / (np.pi / 4)) % 8
        direction_features = np.zeros(8, dtype=np.float32)
        direction_features[direction] = 1.0

        return point_features, line_features, polygon_features, direction_features

    def spatial_rerank(
        self,
        query_embedding: np.ndarray,
        candidates: List[Dict],
        anchor: Optional[Dict] = None,
        spatial_weight: float = 0.5,
        semantic_weight: float = 0.5,
        top_k: int = 20,
    ) -> List[Dict]:
        """
        空间重排：结合语义相似度和空间距离

        Args:
            query_embedding: 查询 embedding [352]
            candidates: 候选 POI 列表（需含 spatial_embedding 或坐标）
            anchor: 锚点坐标 {"lon": ..., "lat": ...}
            spatial_weight: 空间分数权重
            semantic_weight: 语义分数权重
            top_k: 返回数量

        Returns:
            reranked: 重排后的 POI 列表
        """
        if not candidates:
            return []

        # 计算语义相似度
        query_vec = torch.tensor(query_embedding, dtype=torch.float32).to(self.device)
        query_vec = query_vec / (query_vec.norm() + 1e-8)

        semantic_scores = []
        for c in candidates:
            if "spatial_embedding" in c and c["spatial_embedding"] is not None:
                emb = torch.tensor(c["spatial_embedding"], dtype=torch.float32)
                emb = emb / (emb.norm() + 1e-8)
                score = torch.dot(query_vec.cpu(), emb).item()
            else:
                score = 0.0
            semantic_scores.append(score)

        # 计算空间分数
        spatial_scores = []
        if anchor:
            anchor_lon = anchor.get("lon", anchor.get("longitude", 114.3))
            anchor_lat = anchor.get("lat", anchor.get("latitude", 30.6))

            max_dist = max(
                (c.get("distance_m", c.get("distance_meters", 1000)) for c in candidates),
                default=1000
            )

            for c in candidates:
                dist = c.get("distance_m", c.get("distance_meters", 1000))
                # 距离越近分数越高
                spatial_scores.append(1.0 - dist / max_dist)
        else:
            spatial_scores = [0.5] * len(candidates)

        # 融合分数
        fused_scores = [
            spatial_weight * s + semantic_weight * sem
            for s, sem in zip(spatial_scores, semantic_scores)
        ]

        # 排序
        indexed = list(zip(candidates, fused_scores))
        indexed.sort(key=lambda x: x[1], reverse=True)

        # 添加分数信息
        reranked = []
        for c, score in indexed[:top_k]:
            reranked.append({
                **c,
                "spatial_score": score,
                "semantic_score": semantic_scores[candidates.index(c)] if c in candidates else 0,
            })

        return reranked

    def predict_direction(self, lon: float, lat: float) -> Tuple[int, np.ndarray]:
        """
        预测相对城市中心的方向

        Args:
            lon: 经度
            lat: 纬度

        Returns:
            direction: 0-7（东、东南、南、西南、西、西北、北、东北）
            probs: 方向概率分布 [8]
        """
        features = self._build_features({"lon": lon, "lat": lat})
        pt = torch.tensor(features[0], dtype=torch.float32).unsqueeze(0).to(self.device)
        ln = torch.tensor(features[1], dtype=torch.float32).unsqueeze(0).to(self.device)
        pg = torch.tensor(features[2], dtype=torch.float32).unsqueeze(0).to(self.device)
        dr = torch.tensor(features[3], dtype=torch.float32).unsqueeze(0).to(self.device)

        with torch.no_grad():
            _, dir_pred, _, _ = self.model.forward_simple(pt, ln, pg, dr)

        probs = torch.softmax(dir_pred, dim=-1).squeeze(0).cpu().numpy()
        direction = int(np.argmax(probs))

        return direction, probs

    def predict_region(self, lon: float, lat: float) -> Tuple[int, np.ndarray]:
        """
        预测功能区域类别

        Args:
            lon: 经度
            lat: 纬度

        Returns:
            region: 0-5（居住、商业、工业、教育、公共、自然）
            probs: 区域概率分布 [6]
        """
        features = self._build_features({"lon": lon, "lat": lat})
        pt = torch.tensor(features[0], dtype=torch.float32).unsqueeze(0).to(self.device)
        ln = torch.tensor(features[1], dtype=torch.float32).unsqueeze(0).to(self.device)
        pg = torch.tensor(features[2], dtype=torch.float32).unsqueeze(0).to(self.device)
        dr = torch.tensor(features[3], dtype=torch.float32).unsqueeze(0).to(self.device)

        with torch.no_grad():
            _, _, reg_pred, _ = self.model.forward_simple(pt, ln, pg, dr)

        probs = torch.softmax(reg_pred, dim=-1).squeeze(0).cpu().numpy()
        region = int(np.argmax(probs))

        return region, probs


# 单例模式
_encoder_service: Optional[POIEncoderService] = None


def get_encoder_service(model_path: Optional[str] = None) -> POIEncoderService:
    """获取编码器服务单例"""
    global _encoder_service
    if _encoder_service is None:
        _encoder_service = POIEncoderService(model_path)
    return _encoder_service


if __name__ == "__main__":
    # 测试
    service = POIEncoderService()

    # 测试方向预测
    lon, lat = 114.35, 30.55
    direction, probs = service.predict_direction(lon, lat)
    print(f"Direction at ({lon}, {lat}): {direction}, probs: {probs}")

    # 测试区域预测
    region, probs = service.predict_region(lon, lat)
    print(f"Region at ({lon}, {lat}): {region}, probs: {probs}")
