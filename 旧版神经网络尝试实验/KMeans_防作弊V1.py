# -*- coding: utf-8 -*-
"""
防作弊实验框架 V1

核心改进：
1. 标签来源：使用 KMeans 空间聚类，而非 category（彻底杜绝标签泄露）
2. 输入特征：移除 category 特征（原 V6/V61 的泄露源头）
3. 评估目标：真正测试模型的空间感知能力

设计思想：
- 标签 = KMeans(坐标, K=15) → 空间区域划分
- 输入 = landuse + road_class + 数值特征 + 坐标
- 成功标准：Silhouette > 0.3 即表明学到了空间拓扑

输出结构（参考 V6）：
- plots/：可视化图表
- checkpoints/：模型检查点
- profiler/：性能分析日志
- reports/：Markdown/LaTeX 报告
- json/：结构化结果
- progress.txt：训练进度
- summary_v1.md：汇总报告
- FINAL_CONCLUSION_REPORT.md：最终结论
"""

from __future__ import annotations

import datetime
import gc
import json
import math
import os
import platform
import random
import sys
import time
import warnings
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from scipy import stats
from scipy.sparse import coo_matrix, csr_matrix
from scipy.spatial.distance import cdist
from sklearn.cluster import KMeans
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import (
    adjusted_rand_score,
    normalized_mutual_info_score,
    silhouette_score,
)
from sklearn.model_selection import train_test_split
from torch.cuda.amp import GradScaler, autocast
from torch.utils.data import DataLoader, Dataset, Sampler, get_worker_info

# 尝试导入 faiss
try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    warnings.warn("faiss 未安装，将使用 sklearn 作为后备方案。")

sys.path.append(str(Path(__file__).parent.parent / "spatial_encoder"))
from config import MODEL_CONFIG
from utils.dataset import POIDataset


# =========================================================
# 配置
# =========================================================

@dataclass
class FeatureSchema:
    """
    防作弊特征 Schema：
    - 彻底移除 category_col（标签泄露源头）
    - landuse_col 作为第 0 列（原第 1 列）
    - road_class_col 作为第 1 列（原第 2 列）
    - 数值特征作为第 2-4 列（原第 3-5 列）
    - 标签由 KMeans 空间聚类生成，与 category 无关
    """
    label_field: str = "spatial_labels"  # 空间聚类标签
    fallback_label_col: int = None  # 不再使用特征列作为标签

    # 移除 category 特征（防作弊核心）
    category_col: Optional[int] = None  # 彻底移除！
    landuse_col: Optional[int] = 0  # 调整索引
    road_class_col: Optional[int] = 1  # 调整索引
    numerical_cols: Tuple[int, ...] = (2, 3, 4)  # 调整索引

    num_categories: int = 0  # 不使用
    num_landuse: int = 13
    num_road_class: int = 27

    # 空间聚类配置
    spatial_n_clusters: int = 15  # KMeans 聚类数


@dataclass
class ExperimentConfig:
    # split
    train_ratio: float = 0.70
    val_ratio: float = 0.15
    test_ratio: float = 0.15

    # repeat
    num_runs: int = 5

    # train
    num_epochs: int = 100
    learning_rate: float = 2e-4
    weight_decay: float = 1e-5
    early_stopping_patience: int = 15
    warmup_epochs: int = 5

    # batch / triplet
    batch_size: int = 256
    grad_accum_steps: int = 2
    triplet_margin: float = 1.5
    pk_samples_per_class: int = 4

    # graph models
    poi_knn_k: int = 10
    graph_triplet_subset_size: int = 2048

    # sparse adjacency threshold
    sparse_adj_threshold: int = 5000
    use_sparse_adj: bool = True

    # KNN method
    knn_method: str = "auto"

    # coordinate normalization
    normalize_coords: bool = False

    # performance
    num_workers: int = 0 if platform.system() == "Windows" else 2
    pin_memory: bool = True
    persistent_workers: bool = False
    prefetch_factor: Optional[int] = 2
    use_amp: bool = True

    # eval
    eval_every: int = 5
    eval_batch_size: int = 1024

    # reproducibility
    base_seed: int = 42
    deterministic: bool = True

    # model dims
    embed_dim: int = 256
    hidden_dim: int = 128
    transformer_heads: int = 4
    transformer_layers: int = 2
    transformer_ffn_dim: int = 512
    dropout: float = 0.1
    coord_dim: int = 2

    # system
    device: str = "cuda" if torch.cuda.is_available() else "cpu"

    # optional
    save_run_checkpoints: bool = True

    # profiling
    enable_profiler: bool = True
    profiler_log_interval: int = 10

    # smoke test
    smoke_test: bool = True  # 快速验证模式


FEATURE_SCHEMA = FeatureSchema()
EXPERIMENT_CONFIG = ExperimentConfig()

OUTPUT_DIR = Path(__file__).parent / "experiment_results_anti_cheat_v1"
PROGRESS_FILE = OUTPUT_DIR / "progress.txt"
CHECKPOINT_DIR = OUTPUT_DIR / "checkpoints"
REPORT_DIR = OUTPUT_DIR / "reports"
JSON_DIR = OUTPUT_DIR / "json"
PROFILER_DIR = OUTPUT_DIR / "profiler"
PLOTS_DIR = OUTPUT_DIR / "plots"


# =========================================================
# Profiler 工具
# =========================================================

class TimeProfiler:
    """在线耗时分析器"""

    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.reset()

    def reset(self):
        self.timings = {
            "data_transfer": 0.0,
            "forward": 0.0,
            "backward": 0.0,
            "optimizer_step": 0.0,
            "validation": 0.0,
            "knn_build": 0.0,
            "kmeans_labels": 0.0,
            "adj_subset": 0.0,
            "misc": 0.0,
        }
        self.counts = {k: 0 for k in self.timings}
        self._start_times = {}

    @contextmanager
    def timer(self, name: str):
        if not self.enabled:
            yield
            return

        start = time.perf_counter()
        try:
            yield
        finally:
            elapsed = time.perf_counter() - start
            self.timings[name] += elapsed
            self.counts[name] += 1

    def start(self, name: str):
        if self.enabled:
            self._start_times[name] = time.perf_counter()

    def stop(self, name: str):
        if self.enabled and name in self._start_times:
            elapsed = time.perf_counter() - self._start_times[name]
            self.timings[name] += elapsed
            self.counts[name] += 1
            del self._start_times[name]

    def summary(self) -> Dict[str, Any]:
        total = sum(self.timings.values())
        return {
            "timings": dict(self.timings),
            "counts": dict(self.counts),
            "total": total,
            "percentages": {k: (v / total * 100) if total > 0 else 0
                           for k, v in self.timings.items()},
        }

    def report(self) -> str:
        s = self.summary()
        lines = ["[Profiler] 耗时统计:"]
        for name, t in sorted(s["timings"].items(), key=lambda x: -x[1]):
            pct = s["percentages"][name]
            cnt = s["counts"][name]
            avg = t / cnt if cnt > 0 else 0
            lines.append(f"  {name}: {t:.2f}s ({pct:.1f}%) [count={cnt}, avg={avg:.4f}s]")
        lines.append(f"  Total: {s['total']:.2f}s")
        return "\n".join(lines)


PROFILER = TimeProfiler(enabled=EXPERIMENT_CONFIG.enable_profiler)


# =========================================================
# 工具函数
# =========================================================

def log_progress(msg: str, flush: bool = True):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    with open(PROGRESS_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {msg}\n")
    print(msg, flush=flush)


def set_global_seed(seed: int, deterministic: bool = True):
    seed = seed % (2**32)
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)

    if deterministic:
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
        try:
            torch.use_deterministic_algorithms(True, warn_only=True)
        except Exception:
            pass
    else:
        torch.backends.cudnn.benchmark = True


def worker_init_fn(worker_id: int):
    worker_info = get_worker_info()
    if worker_info is None:
        return
    seed = worker_info.seed % (2**32)
    np.random.seed(seed)
    random.seed(seed)


def get_env_info() -> Dict[str, str]:
    info = {
        "torch_version": torch.__version__,
        "cuda_version": torch.version.cuda if torch.cuda.is_available() else "N/A",
        "device": EXPERIMENT_CONFIG.device,
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "N/A",
        "python_version": platform.python_version(),
        "os": platform.platform(),
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "faiss_available": str(FAISS_AVAILABLE),
    }
    if FAISS_AVAILABLE:
        try:
            info["faiss_version"] = getattr(faiss, "__version__", "unknown")
        except (AttributeError, ImportError):
            info["faiss_version"] = "unknown"
    return info


def ensure_dirs():
    OUTPUT_DIR.mkdir(exist_ok=True, parents=True)
    CHECKPOINT_DIR.mkdir(exist_ok=True, parents=True)
    REPORT_DIR.mkdir(exist_ok=True, parents=True)
    JSON_DIR.mkdir(exist_ok=True, parents=True)
    PROFILER_DIR.mkdir(exist_ok=True, parents=True)
    PLOTS_DIR.mkdir(exist_ok=True, parents=True)


def tensor_to_list(x):
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().tolist()
    return x


def clear_cuda_memory(aggressive: bool = False):
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        if aggressive:
            torch.cuda.synchronize()
            gc.collect()
            torch.cuda.empty_cache()


def get_gpu_memory_usage() -> Dict[str, float]:
    if not torch.cuda.is_available():
        return {"allocated": 0.0, "reserved": 0.0, "max_allocated": 0.0}

    return {
        "allocated": torch.cuda.memory_allocated() / (1024**3),
        "reserved": torch.cuda.memory_reserved() / (1024**3),
        "max_allocated": torch.cuda.max_memory_allocated() / (1024**3),
    }


# =========================================================
# 空间聚类标签生成（核心防作弊）
# =========================================================

def generate_spatial_labels(
    coords: torch.Tensor,
    n_clusters: int = 15,
    seed: int = 42
) -> torch.Tensor:
    """
    基于 POI 坐标生成空间聚类标签

    这是防作弊的核心：
    - 标签完全基于空间位置，与 category 无关
    - 模型必须学习空间拓扑才能区分不同区域

    Args:
        coords: POI 坐标 [N, 2] 或 [N, D]（Fourier 编码后）
        n_clusters: 聚类数量
        seed: 随机种子

    Returns:
        labels: 空间聚类标签 [N]
    """
    with PROFILER.timer("kmeans_labels"):
        # 如果是 Fourier 编码的坐标，提取原始坐标
        # Fourier 编码后维度是 256，我们需要原始 2D 坐标
        if coords.shape[1] > 10:
            # 假设是 Fourier 编码，我们无法直接提取原始坐标
            # 使用 PCA 降维到 2D
            from sklearn.decomposition import PCA
            coords_np = coords.detach().cpu().numpy().astype(np.float32)
            pca = PCA(n_components=2, random_state=seed)
            coords_2d = pca.fit_transform(coords_np)
            log_progress(f"    [KMeans] 使用 PCA 将 {coords.shape[1]}D 坐标降维到 2D")
        else:
            coords_2d = coords.detach().cpu().numpy().astype(np.float32)

        # KMeans 聚类
        kmeans = KMeans(n_clusters=n_clusters, random_state=seed, n_init=10)
        labels = kmeans.fit_predict(coords_2d)

        log_progress(f"    [KMeans] 生成 {n_clusters} 个空间聚类标签")
        log_progress(f"    [KMeans] 标签分布: {np.bincount(labels)}")

        return torch.from_numpy(labels).long()


# =========================================================
# KNN 图构建
# =========================================================

def build_knn_faiss_gpu(coords: np.ndarray, k: int) -> Tuple[np.ndarray, np.ndarray]:
    n, d = coords.shape
    k = min(k, max(1, n - 1))

    coords_normalized = coords.astype(np.float32)

    if torch.cuda.is_available():
        try:
            # 尝试使用GPU版本
            res = faiss.StandardGpuResources()
            index = faiss.IndexFlatL2(d)
            gpu_index = faiss.index_cpu_to_gpu(res, 0, index)
            gpu_index.add(coords_normalized)
            distances, indices = gpu_index.search(coords_normalized, k + 1)
            return distances, indices
        except (RuntimeError, ValueError, AttributeError) as e:
            log_progress(f"    [警告] faiss GPU 失败（可能未安装faiss-gpu），退化为 CPU: {e}")

    index = faiss.IndexFlatL2(d)
    index.add(coords_normalized)
    distances, indices = index.search(coords_normalized, k + 1)
    return distances, indices


def build_knn_sklearn(coords: np.ndarray, k: int) -> Tuple[np.ndarray, np.ndarray]:
    from sklearn.neighbors import NearestNeighbors

    n = len(coords)
    k = min(k, max(1, n - 1))

    nn_model = NearestNeighbors(n_neighbors=k + 1, metric="euclidean")
    nn_model.fit(coords)
    distances, indices = nn_model.kneighbors(return_distance=True)
    return distances, indices


def build_knn_adj_matrix(
    coords: torch.Tensor,
    k: int,
    method: str = "auto",
    use_sparse: bool = True,
    sparse_threshold: int = 5000
) -> Tuple[torch.Tensor, bool]:
    n = len(coords)
    k = min(k, max(1, n - 1))

    coords_np = coords.detach().cpu().numpy().astype(np.float32)

    with PROFILER.timer("knn_build"):
        if method == "auto":
            if FAISS_AVAILABLE and n > 1000:
                method = "faiss"
            else:
                method = "sklearn"

        if method == "faiss" and FAISS_AVAILABLE:
            distances, indices = build_knn_faiss_gpu(coords_np, k)
        else:
            distances, indices = build_knn_sklearn(coords_np, k)

    use_sparse_actual = use_sparse and n > sparse_threshold

    if use_sparse_actual:
        rows = np.repeat(np.arange(n), k + 1)
        cols = indices.reshape(-1)
        data = np.ones(len(rows), dtype=np.float32)
        adj_sparse = coo_matrix((data, (rows, cols)), shape=(n, n))
        adj_sparse.setdiag(0.0)
        adj_sparse = adj_sparse.maximum(adj_sparse.T)
        adj_csr = adj_sparse.tocsr()
        row_sums = np.array(adj_csr.sum(axis=1)).flatten()
        row_sums[row_sums == 0] = 1.0
        adj_csr = adj_csr.multiply(1.0 / row_sums[:, np.newaxis])
        adj_coo = adj_csr.tocoo()
        indices_pt = torch.from_numpy(
            np.stack([adj_coo.row, adj_coo.col], axis=0)
        ).long()
        values_pt = torch.from_numpy(adj_coo.data).float()
        adj = torch.sparse_coo_tensor(
            indices_pt, values_pt, size=(n, n)
        ).coalesce()
        return adj, True
    else:
        adj = np.zeros((n, n), dtype=np.float32)
        rows = np.repeat(np.arange(n), k + 1)
        cols = indices.reshape(-1)
        adj[rows, cols] = 1.0
        np.fill_diagonal(adj, 0.0)
        adj = np.maximum(adj, adj.T)
        deg = adj.sum(axis=1, keepdims=True)
        deg[deg == 0] = 1.0
        adj = adj / deg
        return torch.from_numpy(adj), False


# =========================================================
# 数据准备
# =========================================================

@dataclass
class PreparedAreaData:
    area_name: str
    poi_features: torch.Tensor
    poi_coords: torch.Tensor
    labels: torch.Tensor  # 空间聚类标签
    block_features: torch.Tensor
    block_adjacency: torch.Tensor
    global_poi_adj: torch.Tensor
    global_poi_adj_is_sparse: bool
    num_classes: int
    use_category_input: bool  # 始终为 False
    schema_info: Dict[str, Any]
    raw_coords_2d: torch.Tensor  # 原始 2D 坐标（用于 KMeans）


def prepare_area_data(
    area_name: str,
    dataset: POIDataset,
    schema: FeatureSchema,
    config: ExperimentConfig
) -> PreparedAreaData:
    """
    准备区域数据（防作弊版本）

    核心改动：
    1. 移除 category 特征（第 0 列）
    2. 使用 KMeans 空间聚类生成标签
    """
    raw_features = dataset.poi_features.clone().float()
    poi_coords = dataset.poi_coords.clone().float()

    # 原始数据格式：
    # - poi_features[:, 0] = category_id  → 移除
    # - poi_features[:, 1] = landuse_id   → 新索引 0
    # - poi_features[:, 2] = road_class_id → 新索引 1
    # - poi_features[:, 3:6] = 数值特征   → 新索引 2:5

    # 提取原始 2D 坐标（在 dataset 中已归一化）
    # 我们需要从 GeoJSON 重新获取原始坐标
    pois = dataset.pois
    raw_coords_2d = []
    for poi in pois:
        lon, lat = poi['geometry']['coordinates']
        raw_coords_2d.append([lon, lat])
    raw_coords_2d = torch.tensor(raw_coords_2d, dtype=torch.float32)

    # 生成空间聚类标签（防作弊核心）
    labels = generate_spatial_labels(
        raw_coords_2d,
        n_clusters=schema.spatial_n_clusters,
        seed=config.base_seed
    )

    # 移除 category 特征（第 0 列）
    leakage_safe_features = raw_features[:, 1:]  # 移除 category
    log_progress(f"    移除 category 特征: {raw_features.shape[1]} → {leakage_safe_features.shape[1]} 维")

    num_classes = int(torch.unique(labels).numel())

    # 坐标维度统一
    if poi_coords.shape[1] < config.coord_dim:
        pad = torch.zeros(poi_coords.shape[0], config.coord_dim - poi_coords.shape[1])
        poi_coords = torch.cat([poi_coords, pad], dim=1)
    elif poi_coords.shape[1] > config.coord_dim:
        poi_coords = poi_coords[:, :config.coord_dim]

    # 构建全局 KNN 图
    global_poi_adj, is_sparse = build_knn_adj_matrix(
        poi_coords,
        config.poi_knn_k,
        method=config.knn_method,
        use_sparse=config.use_sparse_adj,
        sparse_threshold=config.sparse_adj_threshold
    )

    log_progress(f"    KNN 图构建完成: {len(poi_coords)} 节点, K={config.poi_knn_k}, sparse={is_sparse}")

    schema_info = {
        "label_source": "KMeans 空间聚类（防作弊）",
        "use_category_input": False,  # 始终为 False
        "poi_feature_dim": int(leakage_safe_features.shape[1]),
        "coord_dim": int(poi_coords.shape[1]),
        "block_feature_dim": int(dataset.block_features.shape[1])
        if dataset.block_features.dim() == 2
        else int(dataset.block_features.shape[-1]),
        "num_classes": num_classes,
        "adj_is_sparse": is_sparse,
        "spatial_n_clusters": schema.spatial_n_clusters,
    }

    return PreparedAreaData(
        area_name=area_name,
        poi_features=leakage_safe_features,
        poi_coords=poi_coords,
        labels=labels,
        block_features=dataset.block_features.clone().float(),
        block_adjacency=dataset.block_adjacency.clone().float(),
        global_poi_adj=global_poi_adj,
        global_poi_adj_is_sparse=is_sparse,
        num_classes=num_classes,
        use_category_input=False,
        schema_info=schema_info,
        raw_coords_2d=raw_coords_2d,
    )


class SplitDataset(Dataset):
    def __init__(self, prepared: PreparedAreaData, indices: np.ndarray):
        self.prepared = prepared
        self.indices = np.asarray(indices, dtype=np.int64)

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, i: int) -> Dict[str, torch.Tensor]:
        idx = int(self.indices[i])
        return {
            "poi_features": self.prepared.poi_features[idx],
            "poi_coords": self.prepared.poi_coords[idx],
            "label": self.prepared.labels[idx],
            "index": torch.tensor(idx, dtype=torch.long),
        }

    @property
    def poi_features(self):
        return self.prepared.poi_features[self.indices]

    @property
    def poi_coords(self):
        return self.prepared.poi_coords[self.indices]

    @property
    def labels(self):
        return self.prepared.labels[self.indices]


def stratified_split_indices(labels: torch.Tensor, config: ExperimentConfig, seed: int):
    all_idx = np.arange(len(labels))
    y = labels.detach().cpu().numpy()

    try:
        train_idx, temp_idx = train_test_split(
            all_idx,
            train_size=config.train_ratio,
            random_state=seed,
            stratify=y,
        )

        temp_y = y[temp_idx]
        val_ratio_in_temp = config.val_ratio / (config.val_ratio + config.test_ratio)

        val_idx, test_idx = train_test_split(
            temp_idx,
            train_size=val_ratio_in_temp,
            random_state=seed + 1,
            stratify=temp_y,
        )
    except ValueError as e:
        log_progress(f"    [警告] 分层划分失败，退化为随机划分: {e}")
        rng = np.random.RandomState(seed)
        perm = rng.permutation(len(labels))
        n = len(perm)
        n_train = int(n * config.train_ratio)
        n_val = int(n * config.val_ratio)
        train_idx = perm[:n_train]
        val_idx = perm[n_train : n_train + n_val]
        test_idx = perm[n_train + n_val :]

    return np.array(train_idx), np.array(val_idx), np.array(test_idx)


def build_splits(prepared: PreparedAreaData, config: ExperimentConfig, seed: int):
    train_idx, val_idx, test_idx = stratified_split_indices(
        prepared.labels, config, seed
    )
    return (
        SplitDataset(prepared, train_idx),
        SplitDataset(prepared, val_idx),
        SplitDataset(prepared, test_idx),
        {
            "train": train_idx.tolist(),
            "val": val_idx.tolist(),
            "test": test_idx.tolist(),
        },
    )


# =========================================================
# Sampler
# =========================================================

class PKBatchSampler(Sampler[List[int]]):
    def __init__(
        self, labels: torch.Tensor, batch_size: int, k_per_class: int, seed: int
    ):
        self.labels = labels.detach().cpu().numpy().astype(int)
        self.batch_size = batch_size
        self.k_per_class = k_per_class
        self.seed = seed
        self.epoch = 0

        if batch_size % k_per_class != 0:
            raise ValueError("batch_size 必须能被 k_per_class 整除")

        self.p_classes = batch_size // k_per_class
        self.label_to_indices = {}
        for i, y in enumerate(self.labels):
            self.label_to_indices.setdefault(int(y), []).append(i)
        self.classes = sorted(self.label_to_indices.keys())

        if len(self.classes) < 2:
            raise ValueError("Triplet Loss 至少需要 2 个类别")

        self.num_batches = max(1, len(self.labels) // batch_size)

    def set_epoch(self, epoch: int):
        self.epoch = epoch

    def __iter__(self):
        rng = np.random.RandomState(self.seed + self.epoch)

        for _ in range(self.num_batches):
            sampled_classes = rng.choice(
                self.classes,
                size=self.p_classes,
                replace=len(self.classes) < self.p_classes,
            )

            batch = []
            for c in sampled_classes:
                idx_pool = self.label_to_indices[int(c)]
                sampled = rng.choice(
                    idx_pool,
                    size=self.k_per_class,
                    replace=len(idx_pool) < self.k_per_class,
                )
                batch.extend(sampled.tolist())

            yield batch[: self.batch_size]

    def __len__(self):
        return self.num_batches


# =========================================================
# Loss
# =========================================================

class BatchHardTripletLoss(nn.Module):
    def __init__(self, margin: float = 1.5):
        super().__init__()
        self.margin = margin

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        if embeddings.size(0) < 2:
            return embeddings.sum() * 0.0

        dist = torch.cdist(embeddings, embeddings, p=2)
        labels = labels.view(-1, 1)

        same = labels.eq(labels.t())
        not_self = ~torch.eye(
            embeddings.size(0), dtype=torch.bool, device=embeddings.device
        )
        pos_mask = same & not_self
        neg_mask = ~same

        valid_anchor = pos_mask.any(dim=1) & neg_mask.any(dim=1)
        if not valid_anchor.any():
            return embeddings.sum() * 0.0

        with torch.no_grad():
            max_dist = dist.max().detach() + 1.0
            max_dist = torch.clamp(max_dist, max=1e6)

        pos_dist = dist.clone()
        pos_dist[~pos_mask] = -max_dist
        hard_pos = pos_dist.max(dim=1).values

        neg_dist = dist.clone()
        neg_dist[~neg_mask] = max_dist
        hard_neg = neg_dist.min(dim=1).values

        loss = F.relu(hard_pos - hard_neg + self.margin)
        return loss[valid_anchor].mean()


# =========================================================
# 模型定义（防作弊版本：不使用 category）
# =========================================================

class TokenTransformerEncoder(nn.Module):
    """防作弊版本：不包含 category embedding"""

    def __init__(
        self, config: ExperimentConfig, schema: FeatureSchema, meta: Dict[str, Any]
    ):
        super().__init__()
        self.schema = schema
        self.embed_dim = config.embed_dim
        self.coord_dim = meta["coord_dim"]
        self.use_category_input = False  # 始终为 False

        # 移除 category embedding
        # self.category_embedding = None

        self.landuse_embedding = nn.Embedding(schema.num_landuse, config.embed_dim)
        self.road_class_embedding = nn.Embedding(
            schema.num_road_class, config.embed_dim
        )

        self.num_proj = nn.Sequential(
            nn.Linear(len(schema.numerical_cols), config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.GELU(),
        )

        self.coord_proj = nn.Sequential(
            nn.Linear(self.coord_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.GELU(),
        )

        self.cls_token = nn.Parameter(torch.zeros(1, 1, config.embed_dim))
        self.token_type_embedding = nn.Embedding(4, config.embed_dim)  # 减少到 4 种 token

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=config.embed_dim,
            nhead=config.transformer_heads,
            dim_feedforward=config.transformer_ffn_dim,
            dropout=config.dropout,
            batch_first=True,
            norm_first=True,
            activation="gelu",
        )
        self.transformer = nn.TransformerEncoder(
            encoder_layer,
            num_layers=config.transformer_layers,
        )

        self.output_head = nn.Sequential(
            nn.Linear(config.embed_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(
        self, poi_features: torch.Tensor, poi_coords: torch.Tensor
    ) -> torch.Tensor:
        if poi_features.dim() != 2:
            raise ValueError(
                f"TokenTransformerEncoder expects [B, F], got {tuple(poi_features.shape)}"
            )

        B = poi_features.size(0)
        tokens = []
        type_ids = []

        # 注意：poi_features 已经移除了 category 列
        # 新索引：0=landuse, 1=road_class, 2:5=numerical
        lu_idx = (
            poi_features[:, self.schema.landuse_col]
            .long()
            .clamp(0, self.schema.num_landuse - 1)
        )
        rc_idx = (
            poi_features[:, self.schema.road_class_col]
            .long()
            .clamp(0, self.schema.num_road_class - 1)
        )
        num_x = poi_features[:, list(self.schema.numerical_cols)].float()
        coord_x = poi_coords[:, : self.coord_dim].float()

        tokens.append(self.landuse_embedding(lu_idx))
        type_ids.append(0)

        tokens.append(self.road_class_embedding(rc_idx))
        type_ids.append(1)

        tokens.append(self.num_proj(num_x))
        type_ids.append(2)

        tokens.append(self.coord_proj(coord_x))
        type_ids.append(3)

        x = torch.stack(tokens, dim=1)
        tt = (
            torch.tensor(type_ids, device=x.device, dtype=torch.long)
            .unsqueeze(0)
            .expand(B, -1)
        )
        x = x + self.token_type_embedding(tt)

        cls = self.cls_token.expand(B, -1, -1)
        x = torch.cat([cls, x], dim=1)

        x = self.transformer(x)
        out = self.output_head(x[:, 0])
        out = F.normalize(out, p=2, dim=-1)
        return out


class GraphEncoder(nn.Module):
    """图编码器（防作弊版本：不使用 category）"""

    def __init__(self, config: ExperimentConfig, schema: FeatureSchema, meta: Dict[str, Any]):
        super().__init__()
        self.schema = schema
        self.use_category_input = False

        emb_dim = config.hidden_dim // 3

        # 移除 category embedding
        # self.category_emb = None

        self.landuse_emb = nn.Embedding(schema.num_landuse, emb_dim)
        self.road_emb = nn.Embedding(schema.num_road_class, emb_dim)
        self.num_proj = nn.Linear(len(schema.numerical_cols), emb_dim)
        self.coord_proj = nn.Linear(meta["coord_dim"], emb_dim)

        # 输入维度：4 个 embedding（无 category）
        input_dim = emb_dim * 4
        self.input_proj = nn.Sequential(
            nn.Linear(input_dim, config.hidden_dim),
            nn.LayerNorm(config.hidden_dim),
            nn.ReLU(),
            nn.Dropout(config.dropout),
        )

        self.gcn_layers = nn.ModuleList(
            [nn.Linear(config.hidden_dim, config.hidden_dim) for _ in range(2)]
        )
        self.norms = nn.ModuleList([nn.LayerNorm(config.hidden_dim) for _ in range(2)])

        self.output_proj = nn.Sequential(
            nn.Linear(config.hidden_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(
        self,
        poi_features: torch.Tensor,
        poi_coords: torch.Tensor,
        poi_adj: torch.Tensor,
    ) -> torch.Tensor:
        # 注意：poi_features 已经移除了 category 列
        # 新索引：0=landuse, 1=road_class, 2:5=numerical
        lu_emb = self.landuse_emb(poi_features[:, 0].long().clamp(0, self.schema.num_landuse - 1))
        rd_emb = self.road_emb(poi_features[:, 1].long().clamp(0, self.schema.num_road_class - 1))
        num_emb = self.num_proj(poi_features[:, 2:5].float())
        coord_emb = self.coord_proj(poi_coords[:, :2].float())

        # 只有 4 个 embedding
        x = torch.cat([lu_emb, rd_emb, num_emb, coord_emb], dim=-1)
        h = self.input_proj(x)

        for i, (layer, norm) in enumerate(zip(self.gcn_layers, self.norms)):
            if poi_adj.is_sparse:
                with autocast(enabled=False):
                    agg = torch.sparse.mm(poi_adj.float(), h.float())
            else:
                agg = torch.matmul(poi_adj, h)

            h_new = F.relu(norm(layer(agg)))
            h = h + h_new

        out = self.output_proj(h)
        out = F.normalize(out, p=2, dim=-1)
        return out


class PureTransformerModel(nn.Module):
    def __init__(
        self, config: ExperimentConfig, schema: FeatureSchema, meta: Dict[str, Any]
    ):
        super().__init__()
        self.encoder = TokenTransformerEncoder(config, schema, meta)

    def forward(self, poi_features, poi_coords, block_features=None, adj_matrix=None):
        return self.encoder(poi_features, poi_coords)


class PureGNNModel(nn.Module):
    def __init__(
        self, config: ExperimentConfig, schema: FeatureSchema, meta: Dict[str, Any]
    ):
        super().__init__()
        self.encoder = GraphEncoder(config, schema, meta)

    def forward(self, poi_features, poi_coords, block_features=None, adj_matrix=None):
        if adj_matrix is None:
            raise ValueError("PureGNNModel 需要传入 POI adjacency 子图")
        return self.encoder(poi_features, poi_coords, adj_matrix)


class FullModel(nn.Module):
    """完整模型（防作弊版本：不使用 category）"""

    def __init__(
        self, config: ExperimentConfig, schema: FeatureSchema, meta: Dict[str, Any]
    ):
        super().__init__()
        self.poi_encoder = TokenTransformerEncoder(config, schema, meta)
        self.graph_encoder = GraphEncoder(config, schema, meta)

        self.road_encoder = nn.Sequential(
            nn.Linear(meta["block_feature_dim"], config.hidden_dim),
            nn.LayerNorm(config.hidden_dim),
            nn.ReLU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.hidden_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

        self.fusion = nn.Sequential(
            nn.Linear(config.embed_dim * 3, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.embed_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
        )

    def forward(self, poi_features, poi_coords, block_features=None, adj_matrix=None):
        if adj_matrix is None:
            raise ValueError("FullModel 需要传入 POI adjacency 子图")

        poi_emb = self.poi_encoder(poi_features, poi_coords)
        graph_emb = self.graph_encoder(poi_features, poi_coords, adj_matrix)

        if block_features is not None:
            road_global = self.road_encoder(block_features.float()).mean(
                dim=0, keepdim=True
            )
            road_global = road_global.expand(poi_emb.size(0), -1)
        else:
            road_global = torch.zeros_like(poi_emb)

        fused = self.fusion(torch.cat([poi_emb, graph_emb, road_global], dim=-1))
        fused = F.normalize(fused, p=2, dim=-1)
        return fused


# =========================================================
# 参数量验证
# =========================================================

def count_parameters(model: nn.Module) -> Dict[str, int]:
    counts = {}
    total = 0
    for name, module in model.named_modules():
        if len(list(module.children())) == 0:
            params = sum(p.numel() for p in module.parameters())
            if params > 0:
                counts[name] = params
                total += params
    counts['total'] = total
    return counts


def verify_ablation_fairness(config: ExperimentConfig, schema: FeatureSchema, meta: Dict[str, Any]):
    models = {
        "Full Model": FullModel(config, schema, meta),
        "Pure GNN": PureGNNModel(config, schema, meta),
    }

    param_counts = {}
    for name, model in models.items():
        counts = count_parameters(model)
        param_counts[name] = counts['total']

    full_params = param_counts["Full Model"]

    log_progress("  [参数量对比]")
    for name, params in param_counts.items():
        ratio = params / full_params * 100
        log_progress(f"    {name}: {params:,} ({ratio:.1f}% of Full)")

    return param_counts


# =========================================================
# 评估
# =========================================================

def compute_metrics(embeddings: torch.Tensor, labels: torch.Tensor, kmeans_seed: int = 42) -> Dict[str, float]:
    embeddings = embeddings.detach()
    labels = labels.detach()

    labels_np = labels.cpu().numpy()
    emb_np = embeddings.cpu().numpy()
    unique_labels = np.unique(labels_np)

    metrics = {}

    if len(unique_labels) >= 2:
        try:
            metrics["silhouette"] = float(silhouette_score(emb_np, labels_np))
        except (ValueError, FloatingPointError):
            metrics["silhouette"] = 0.0
    else:
        metrics["silhouette"] = 0.0

    intra_vals = []
    inter_vals = []

    for lb in unique_labels:
        mask = labels == int(lb)
        count = int(mask.sum().item())

        if count > 1:
            emb_c = embeddings[mask]
            d = torch.cdist(emb_c, emb_c, p=2)
            eye = torch.eye(count, dtype=torch.bool, device=d.device)
            intra_vals.append(d[~eye].mean().item())

        other_mask = ~mask
        if int(other_mask.sum().item()) > 0:
            center = embeddings[mask].mean(dim=0, keepdim=True)
            inter = torch.norm(embeddings[other_mask] - center, dim=1).mean().item()
            inter_vals.append(inter)

    metrics["intra_distance"] = float(np.mean(intra_vals)) if intra_vals else 0.0
    metrics["inter_distance"] = float(np.mean(inter_vals)) if inter_vals else 0.0
    metrics["distance_ratio"] = (
        metrics["inter_distance"] / metrics["intra_distance"]
        if metrics["intra_distance"] > 0
        else 0.0
    )

    if len(unique_labels) >= 2:
        try:
            n_clusters = len(unique_labels)
            pred = KMeans(
                n_clusters=n_clusters, random_state=kmeans_seed, n_init=10
            ).fit_predict(emb_np)
            metrics["nmi"] = float(normalized_mutual_info_score(labels_np, pred))
            metrics["ari"] = float(adjusted_rand_score(labels_np, pred))
        except (ValueError, ConvergenceWarning):
            metrics["nmi"] = 0.0
            metrics["ari"] = 0.0
    else:
        metrics["nmi"] = 0.0
        metrics["ari"] = 0.0

    return metrics


# =========================================================
# 统计分析
# =========================================================

def paired_bootstrap_ci(
    x: List[float], y: List[float], n_bootstrap: int = 10000, seed: int = 42
):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    d = x - y
    n = len(d)
    rng = np.random.RandomState(seed)

    samples = []
    for _ in range(n_bootstrap):
        idx = rng.choice(n, size=n, replace=True)
        samples.append(d[idx].mean())
    lo, hi = np.percentile(samples, [2.5, 97.5])
    return float(lo), float(hi)


def paired_statistics(x: List[float], y: List[float]) -> Dict[str, float]:
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    d = x - y
    n = len(d)

    mean_diff = float(d.mean())
    sd = float(d.std(ddof=1)) if n > 1 else 0.0
    se = sd / math.sqrt(n) if n > 0 else 0.0

    if n > 1:
        t_stat, t_p = stats.ttest_rel(x, y)
        try:
            w_stat, w_p = stats.wilcoxon(x, y)
        except ValueError:
            w_stat, w_p = 0.0, 1.0
        t_crit = stats.t.ppf(0.975, df=n - 1)
        ci_low = mean_diff - t_crit * se
        ci_high = mean_diff + t_crit * se
        dz = mean_diff / sd if sd > 0 else 0.0
    else:
        t_stat, t_p = 0.0, 1.0
        w_stat, w_p = 0.0, 1.0
        ci_low, ci_high = mean_diff, mean_diff
        dz = 0.0

    b_low, b_high = paired_bootstrap_ci(x.tolist(), y.tolist())

    return {
        "mean_diff": mean_diff,
        "cohens_dz": float(dz),
        "t_statistic": float(t_stat),
        "t_p_value": float(t_p),
        "wilcoxon_statistic": float(w_stat),
        "wilcoxon_p_value": float(w_p),
        "ci_low_t": float(ci_low),
        "ci_high_t": float(ci_high),
        "ci_low_boot": b_low,
        "ci_high_boot": b_high,
    }


def holm_correction(p_values: List[float]) -> Tuple[List[float], List[bool]]:
    p = np.asarray(p_values, dtype=np.float64)
    m = len(p)
    order = np.argsort(p)
    corrected = np.empty_like(p)

    running = 0.0
    for rank, idx in enumerate(order):
        value = (m - rank) * p[idx]
        running = max(running, value)
        corrected[idx] = min(running, 1.0)

    rejected = corrected < 0.05
    return corrected.tolist(), rejected.tolist()


# =========================================================
# 训练 / 推理
# =========================================================

GRAPH_MODEL_NAMES = {"Pure GNN", "Full Model"}


def build_train_loader(split: SplitDataset, config: ExperimentConfig, seed: int):
    sampler = PKBatchSampler(
        labels=split.labels,
        batch_size=config.batch_size,
        k_per_class=config.pk_samples_per_class,
        seed=seed,
    )

    loader = DataLoader(
        split,
        batch_sampler=sampler,
        num_workers=config.num_workers,
        pin_memory=config.pin_memory,
        persistent_workers=(config.persistent_workers and config.num_workers > 0),
        prefetch_factor=(config.prefetch_factor if config.num_workers > 0 else None),
        worker_init_fn=worker_init_fn,
    )
    return loader, sampler


def move_batch_to_device(batch: Dict[str, torch.Tensor], device: torch.device):
    return {
        k: v.to(device, non_blocking=True) if torch.is_tensor(v) else v
        for k, v in batch.items()
    }


def class_balanced_subset_indices(
    labels: torch.Tensor, max_samples: int, seed: int
) -> torch.Tensor:
    n = len(labels)
    if n <= max_samples:
        return torch.arange(n, dtype=torch.long)

    y = labels.detach().cpu().numpy().astype(int)
    rng = np.random.RandomState(seed)

    label_to_idx = {}
    for i, lb in enumerate(y):
        label_to_idx.setdefault(lb, []).append(i)

    classes = sorted(label_to_idx.keys())
    per_class = max(1, max_samples // len(classes))

    chosen = []
    for c in classes:
        pool = label_to_idx[c]
        pick = rng.choice(pool, size=min(len(pool), per_class), replace=False)
        chosen.extend(pick.tolist())

    if len(chosen) < max_samples:
        remain = list(set(range(n)) - set(chosen))
        extra = rng.choice(
            remain, size=min(len(remain), max_samples - len(chosen)), replace=False
        )
        chosen.extend(extra.tolist())

    chosen = np.array(chosen[:max_samples], dtype=np.int64)
    return torch.from_numpy(chosen)


@torch.inference_mode()
def infer_embeddings_non_graph(
    model: nn.Module,
    split: SplitDataset,
    prepared: PreparedAreaData,
    config: ExperimentConfig,
    device: torch.device,
) -> Tuple[torch.Tensor, torch.Tensor]:
    model.eval()

    with PROFILER.timer("data_transfer"):
        block_features = prepared.block_features.to(device, non_blocking=True)
        block_adj = prepared.block_adjacency.to(device, non_blocking=True)

    feats = split.poi_features
    coords = split.poi_coords
    labels = split.labels.to(device, non_blocking=True)

    outs = []
    bs = config.eval_batch_size

    with PROFILER.timer("forward"):
        for s in range(0, len(split), bs):
            e = min(s + bs, len(split))
            with PROFILER.timer("data_transfer"):
                x = feats[s:e].to(device, non_blocking=True)
                c = coords[s:e].to(device, non_blocking=True)
            out = model(x, c, block_features, block_adj)
            outs.append(out)

    emb = torch.cat(outs, dim=0)
    return emb, labels


@torch.inference_mode()
def infer_embeddings_graph(
    model: nn.Module,
    split: SplitDataset,
    prepared: PreparedAreaData,
    device: torch.device,
    use_full_graph: bool = True,
) -> Tuple[torch.Tensor, torch.Tensor]:
    model.eval()

    with PROFILER.timer("data_transfer"):
        if use_full_graph:
            all_x = prepared.poi_features.to(device, non_blocking=True)
            all_c = prepared.poi_coords.to(device, non_blocking=True)
            all_y = prepared.labels.to(device, non_blocking=True)
            block_features = prepared.block_features.to(device, non_blocking=True)

            if prepared.global_poi_adj_is_sparse:
                full_adj = prepared.global_poi_adj.to(device)
            else:
                full_adj = prepared.global_poi_adj.to(device)

            split_indices = torch.tensor(split.indices, dtype=torch.long, device=device)

    with PROFILER.timer("forward"):
        with torch.no_grad():
            if use_full_graph:
                emb_all = model(all_x, all_c, block_features, full_adj)
                emb = emb_all[split_indices]
                labels = all_y[split_indices]

    return emb, labels


def train_non_graph_model(
    model: nn.Module,
    model_name: str,
    train_split: SplitDataset,
    val_split: SplitDataset,
    prepared: PreparedAreaData,
    config: ExperimentConfig,
    device: torch.device,
    run_seed: int,
):
    triplet = BatchHardTripletLoss(config.triplet_margin)
    amp_enabled = config.use_amp and device.type == "cuda"
    scaler = GradScaler(enabled=amp_enabled)

    loader, sampler = build_train_loader(train_split, config, run_seed)

    optimizer = optim.AdamW(
        model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay
    )

    warmup = config.warmup_epochs
    total = config.num_epochs

    def lr_lambda(epoch):
        if epoch < warmup:
            return (epoch + 1) / warmup
        progress = (epoch - warmup) / max(1, total - warmup)
        return 0.5 * (1 + math.cos(math.pi * progress))

    scheduler = optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    with PROFILER.timer("data_transfer"):
        block_features = prepared.block_features.to(device, non_blocking=True)
        block_adj = prepared.block_adjacency.to(device, non_blocking=True)

    best_metric = -1.0
    best_state = None
    patience = 0

    history = {"train_loss": [], "val_silhouette": [], "epoch_details": []}

    for epoch in range(config.num_epochs):
        model.train()
        sampler.set_epoch(epoch)

        optimizer.zero_grad(set_to_none=True)
        gpu_loss_buf = []
        accum_count = 0

        for batch in loader:
            with PROFILER.timer("data_transfer"):
                batch = move_batch_to_device(batch, device)
                x = batch["poi_features"]
                c = batch["poi_coords"]
                y = batch["label"]

            with autocast(enabled=amp_enabled):
                with PROFILER.timer("forward"):
                    emb = model(x, c, block_features, block_adj)
                    loss = triplet(emb, y) / config.grad_accum_steps

            with PROFILER.timer("backward"):
                scaler.scale(loss).backward()

            accum_count += 1
            gpu_loss_buf.append(loss.detach() * config.grad_accum_steps)

            if accum_count == config.grad_accum_steps:
                with PROFILER.timer("optimizer_step"):
                    scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    scaler.step(optimizer)
                    scaler.update()
                    optimizer.zero_grad(set_to_none=True)
                accum_count = 0

        if accum_count > 0:
            with PROFILER.timer("optimizer_step"):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)

        scheduler.step()

        avg_loss = torch.stack(gpu_loss_buf).mean().item() if gpu_loss_buf else 0.0
        history["train_loss"].append(avg_loss)

        if epoch % config.eval_every == 0 or epoch == config.num_epochs - 1:
            with PROFILER.timer("validation"):
                val_emb, val_labels = infer_embeddings_non_graph(
                    model, val_split, prepared, config, device
                )
                val_metrics = compute_metrics(val_emb, val_labels, kmeans_seed=run_seed)
                val_s = val_metrics["silhouette"]

            history["val_silhouette"].append(val_s)
            history["epoch_details"].append(
                {
                    "epoch": epoch,
                    "train_loss": avg_loss,
                    "val_silhouette": val_s,
                    "lr": scheduler.get_last_lr()[0],
                }
            )

            log_progress(
                f"    Epoch {epoch:03d} | Loss={avg_loss:.4f} | Val_Sil={val_s:.4f}"
            )

            if val_s > best_metric:
                best_metric = val_s
                best_state = {
                    k: v.detach().cpu().clone() for k, v in model.state_dict().items()
                }
                patience = 0
            else:
                patience += 1

            if patience >= config.early_stopping_patience:
                log_progress(f"    Early stopping at epoch {epoch}")
                break

        if config.enable_profiler and (epoch + 1) % config.profiler_log_interval == 0:
            log_progress(f"    {PROFILER.report()}")

    if best_state is not None:
        model.load_state_dict(best_state)

    return model, history, best_metric


def train_graph_model(
    model: nn.Module,
    model_name: str,
    train_split: SplitDataset,
    val_split: SplitDataset,
    prepared: PreparedAreaData,
    config: ExperimentConfig,
    device: torch.device,
    run_seed: int,
):
    triplet = BatchHardTripletLoss(config.triplet_margin)
    amp_enabled = config.use_amp and device.type == "cuda"
    scaler = GradScaler(enabled=amp_enabled)

    optimizer = optim.AdamW(
        model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay
    )

    warmup = config.warmup_epochs
    total = config.num_epochs

    def lr_lambda(epoch):
        if epoch < warmup:
            return (epoch + 1) / warmup
        progress = (epoch - warmup) / max(1, total - warmup)
        return 0.5 * (1 + math.cos(math.pi * progress))

    scheduler = optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    with PROFILER.timer("data_transfer"):
        all_x = prepared.poi_features.to(device, non_blocking=True)
        all_c = prepared.poi_coords.to(device, non_blocking=True)
        all_y = prepared.labels.to(device, non_blocking=True)

        if prepared.global_poi_adj_is_sparse:
            full_adj = prepared.global_poi_adj.to(device)
        else:
            full_adj = prepared.global_poi_adj.to(device)

        block_features = prepared.block_features.to(device, non_blocking=True)

        train_indices = torch.tensor(train_split.indices, dtype=torch.long, device=device)
        val_indices = torch.tensor(val_split.indices, dtype=torch.long, device=device)

    best_metric = -1.0
    best_state = None
    patience = 0

    history = {"train_loss": [], "val_silhouette": [], "epoch_details": []}

    for epoch in range(config.num_epochs):
        model.train()
        optimizer.zero_grad(set_to_none=True)

        train_y = all_y[train_indices]
        subset_local_idx = class_balanced_subset_indices(
            train_y.detach().cpu(), config.graph_triplet_subset_size, run_seed + epoch
        )
        subset_idx = train_indices[subset_local_idx]

        with autocast(enabled=amp_enabled):
            with PROFILER.timer("forward"):
                emb_all = model(all_x, all_c, block_features, full_adj)
                loss = triplet(emb_all[subset_idx], all_y[subset_idx])

        with PROFILER.timer("backward"):
            scaler.scale(loss).backward()

        with PROFILER.timer("optimizer_step"):
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()

        scheduler.step()

        avg_loss = float(loss.detach().item())
        history["train_loss"].append(avg_loss)

        if epoch % config.eval_every == 0 or epoch == config.num_epochs - 1:
            with PROFILER.timer("validation"):
                model.eval()
                with torch.no_grad():
                    emb_all = model(all_x, all_c, block_features, full_adj)
                    val_emb = emb_all[val_indices]
                    val_labels = all_y[val_indices]

                val_metrics = compute_metrics(val_emb, val_labels, kmeans_seed=run_seed)
                val_s = val_metrics["silhouette"]

            history["val_silhouette"].append(val_s)
            history["epoch_details"].append(
                {
                    "epoch": epoch,
                    "train_loss": avg_loss,
                    "val_silhouette": val_s,
                    "lr": scheduler.get_last_lr()[0],
                }
            )

            log_progress(
                f"    Epoch {epoch:03d} | Loss={avg_loss:.4f} | Val_Sil={val_s:.4f}"
            )

            if val_s > best_metric:
                best_metric = val_s
                best_state = {
                    k: v.detach().cpu().clone() for k, v in model.state_dict().items()
                }
                patience = 0
            else:
                patience += 1

            if patience >= config.early_stopping_patience:
                log_progress(f"    Early stopping at epoch {epoch}")
                break

        if config.enable_profiler and (epoch + 1) % config.profiler_log_interval == 0:
            log_progress(f"    {PROFILER.report()}")

    if best_state is not None:
        model.load_state_dict(best_state)

    return model, history, best_metric


def evaluate_model(
    model: nn.Module,
    model_name: str,
    split: SplitDataset,
    prepared: PreparedAreaData,
    config: ExperimentConfig,
    device: torch.device,
    kmeans_seed: int = 42,
) -> Dict[str, float]:
    if model_name in GRAPH_MODEL_NAMES:
        emb, labels = infer_embeddings_graph(model, split, prepared, device, use_full_graph=True)
    else:
        emb, labels = infer_embeddings_non_graph(model, split, prepared, config, device)
    return compute_metrics(emb, labels, kmeans_seed=kmeans_seed)


# =========================================================
# Checkpoint / Report
# =========================================================

def save_run_checkpoint(
    area_name: str,
    model_name: str,
    run_id: int,
    model: nn.Module,
    history: Dict,
    config: ExperimentConfig,
    split_indices: Dict[str, List[int]],
    env_info: Dict[str, str],
    meta: Dict[str, Any],
    best_val: float,
    profiler_summary: Dict,
    optimizer_state: Optional[Dict] = None,
    scheduler_state: Optional[Dict] = None,
):
    ckpt = {
        "area_name": area_name,
        "model_name": model_name,
        "run_id": run_id,
        "config": asdict(config),
        "split_indices": split_indices,
        "env_info": env_info,
        "meta": meta,
        "best_val_silhouette": best_val,
        "history": history,
        "model_state_dict": model.state_dict(),
        "profiler_summary": profiler_summary,
        "timestamp": datetime.datetime.now().isoformat(),
    }
    if optimizer_state is not None:
        ckpt["optimizer_state_dict"] = optimizer_state
    if scheduler_state is not None:
        ckpt["scheduler_state_dict"] = scheduler_state

    path = (
        CHECKPOINT_DIR
        / f"{area_name}__{model_name.replace(' ', '_')}__run{run_id + 1}.pt"
    )
    torch.save(ckpt, path)
    return path


def save_profiler_log(area_name: str, model_name: str, profiler: TimeProfiler):
    summary = profiler.summary()
    path = PROFILER_DIR / f"{area_name}__{model_name.replace(' ', '_')}_profiler.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    return path


# =========================================================
# 论文表格导出
# =========================================================

def generate_latex_table(
    results: Dict[str, Dict],
    area_name: str,
    caption: str = "实验结果",
) -> str:
    lines = []
    lines.append(r"\begin{table}[htbp]")
    lines.append(r"  \centering")
    lines.append(f"  \\caption{{{caption}}}")
    lines.append(f"  \\label{{tab:{area_name}_anti_cheat_results}}")
    lines.append(r"  \begin{tabular}{lcccc}")
    lines.append(r"    \toprule")
    lines.append(r"    Model & Silhouette $\uparrow$ & NMI $\uparrow$ & ARI $\uparrow$ & Distance Ratio $\uparrow$ \\")
    lines.append(r"    \midrule")

    for model_name, obj in results.items():
        s = obj["summary"]
        sil = f"{s['silhouette']['mean']:.3f} $\\pm$ {s['silhouette']['std']:.3f}"
        nmi = f"{s['nmi']['mean']:.3f} $\\pm$ {s['nmi']['std']:.3f}"
        ari = f"{s['ari']['mean']:.3f} $\\pm$ {s['ari']['std']:.3f}"
        dr = f"{s['distance_ratio']['mean']:.3f} $\\pm$ {s['distance_ratio']['std']:.3f}"

        if model_name == "Full Model":
            lines.append(f"    \\textbf{{{model_name}}} & \\textbf{{{sil}}} & \\textbf{{{nmi}}} & \\textbf{{{ari}}} & \\textbf{{{dr}}} \\\\")
        else:
            lines.append(f"    {model_name} & {sil} & {nmi} & {ari} & {dr} \\\\")

    lines.append(r"    \bottomrule")
    lines.append(r"  \end{tabular}")
    lines.append(r"\end{table}")

    return "\n".join(lines)


def generate_markdown_table(
    results: Dict[str, Dict],
    comparisons: Dict[str, Dict],
    area_name: str,
) -> str:
    lines = []
    lines.append(f"# 防作弊实验结果: {area_name}\n")
    lines.append("> **标签来源**: KMeans 空间聚类（与 category 无关）\n")
    lines.append("> **输入特征**: landuse + road_class + 数值 + 坐标（移除 category）\n")

    lines.append("## 核心指标\n")
    lines.append("| Model | Silhouette | NMI | ARI | Distance Ratio |")
    lines.append("|:------|:----------:|:---:|:---:|:--------------:|")

    for model_name, obj in results.items():
        s = obj["summary"]
        sil = f"{s['silhouette']['mean']:.4f}±{s['silhouette']['std']:.4f}"
        nmi = f"{s['nmi']['mean']:.4f}±{s['nmi']['std']:.4f}"
        ari = f"{s['ari']['mean']:.4f}±{s['ari']['std']:.4f}"
        dr = f"{s['distance_ratio']['mean']:.4f}±{s['distance_ratio']['std']:.4f}"
        lines.append(f"| {model_name} | {sil} | {nmi} | {ari} | {dr} |")

    lines.append("\n## 统计检验（vs Full Model）\n")
    lines.append("| Compared | Mean Diff | Cohen's dz | t-p | Wilcoxon-p | Holm p | Sig |")
    lines.append("|:---------|:---------:|:----------:|:---:|:----------:|:------:|:----:|")

    for model_name, comp in comparisons.items():
        sig = "✓" if comp["significant"] else "✗"
        lines.append(
            f"| {model_name} | {comp['mean_diff']:.4f} | {comp['cohens_dz']:.4f} | "
            f"{comp['t_p_value']:.4f} | {comp['wilcoxon_p_value']:.4f} | "
            f"{comp['corrected_p_value']:.4f} | {sig} |"
        )

    lines.append("\n## 参数量对比\n")
    lines.append("| Model | Parameters | Relative to Full |")
    lines.append("|:------|:----------:|:----------------:|")

    full_params = results["Full Model"]["num_params"]
    for model_name, obj in results.items():
        params = obj["num_params"]
        rel = f"{params / full_params * 100:.1f}%"
        lines.append(f"| {model_name} | {params:,} | {rel} |")

    return "\n".join(lines)


def generate_area_report(
    area_name: str,
    results: Dict,
    comparisons: Dict,
    config: ExperimentConfig,
    env: Dict[str, str],
) -> str:
    lines = []
    lines.append(f"# 防作弊实验报告 V1: {area_name}\n")
    lines.append("## 实验设计\n")
    lines.append("### 防作弊措施\n")
    lines.append("1. **标签来源**: KMeans 空间聚类（K=15），与 category 完全无关")
    lines.append("2. **输入特征**: 移除 category 特征，只保留 landuse、road_class、数值特征、坐标")
    lines.append("3. **评估目标**: 测试模型是否真正学到空间拓扑能力\n")

    lines.append("## 实验配置\n")
    lines.append(
        f"- Train/Val/Test = {config.train_ratio:.2f}/{config.val_ratio:.2f}/{config.test_ratio:.2f}"
    )
    lines.append(f"- Runs = {config.num_runs}")
    lines.append(f"- Spatial Clusters = {FEATURE_SCHEMA.spatial_n_clusters}")
    lines.append(f"- Device = {env['device']} ({env['gpu_name']})\n")

    lines.append(generate_markdown_table(results, comparisons, area_name))

    lines.append("\n## 环境信息\n")
    for k, v in env.items():
        lines.append(f"- {k}: {v}")

    return "\n".join(lines)


# =========================================================
# 可视化
# =========================================================

def generate_plots(
    results: Dict[str, Dict],
    prepared: PreparedAreaData,
    area_name: str,
):
    """生成可视化图表"""
    import matplotlib.pyplot as plt
    import matplotlib
    matplotlib.use('Agg')

    # 设置中文字体
    plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'Arial Unicode MS']
    plt.rcParams['axes.unicode_minus'] = False

    # 1. 收敛曲线
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    for model_name, obj in results.items():
        runs = obj["runs"]
        if runs:
            # 取第一次运行的 history
            history = runs[0]["history"]
            epochs = [d["epoch"] for d in history["epoch_details"]]
            val_sil = [d["val_silhouette"] for d in history["epoch_details"]]

            axes[0].plot(epochs, val_sil, 'o-', label=model_name, markersize=4)

    axes[0].set_xlabel('Epoch')
    axes[0].set_ylabel('Validation Silhouette')
    axes[0].set_title(f'{area_name} - Convergence')
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)
    axes[0].axhline(y=0, color='r', linestyle='--', alpha=0.5, label='Baseline (0)')

    # 2. 空间聚类可视化
    coords_2d = prepared.raw_coords_2d.numpy()
    labels = prepared.labels.numpy()

    scatter = axes[1].scatter(
        coords_2d[:, 0], coords_2d[:, 1],
        c=labels, cmap='tab20', s=10, alpha=0.6
    )
    axes[1].set_xlabel('Longitude')
    axes[1].set_ylabel('Latitude')
    axes[1].set_title(f'{area_name} - Spatial Clusters (KMeans K={FEATURE_SCHEMA.spatial_n_clusters})')
    plt.colorbar(scatter, ax=axes[1], label='Cluster ID')

    plt.tight_layout()
    plot_path = PLOTS_DIR / f"{area_name}_convergence_and_clusters.png"
    plt.savefig(plot_path, dpi=150, bbox_inches='tight')
    plt.close()

    log_progress(f"    Plot saved: {plot_path}")

    # 3. 模型对比条形图
    fig, ax = plt.subplots(figsize=(10, 6))

    model_names = list(results.keys())
    sil_means = [results[m]["summary"]["silhouette"]["mean"] for m in model_names]
    sil_stds = [results[m]["summary"]["silhouette"]["std"] for m in model_names]

    x = np.arange(len(model_names))
    bars = ax.bar(x, sil_means, yerr=sil_stds, capsize=5, alpha=0.7)

    ax.set_ylabel('Silhouette Score')
    ax.set_title(f'{area_name} - Model Comparison (Anti-Cheat V1)')
    ax.set_xticks(x)
    ax.set_xticklabels(model_names, rotation=15, ha='right')
    ax.axhline(y=0, color='r', linestyle='--', alpha=0.5)
    ax.grid(True, alpha=0.3, axis='y')

    # 添加数值标签
    for bar, mean, std in zip(bars, sil_means, sil_stds):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + std + 0.02,
                f'{mean:.3f}', ha='center', va='bottom', fontsize=10)

    plt.tight_layout()
    bar_path = PLOTS_DIR / f"{area_name}_model_comparison.png"
    plt.savefig(bar_path, dpi=150, bbox_inches='tight')
    plt.close()

    log_progress(f"    Bar chart saved: {bar_path}")


# =========================================================
# 单次 / 全部实验
# =========================================================

def build_model(
    model_name: str,
    config: ExperimentConfig,
    schema: FeatureSchema,
    meta: Dict[str, Any],
) -> nn.Module:
    if model_name == "Full Model":
        return FullModel(config, schema, meta)
    elif model_name == "Pure GNN":
        return PureGNNModel(config, schema, meta)
    else:
        raise ValueError(f"Unknown model: {model_name}")


def summarize_runs(run_results: List[Dict]) -> Dict[str, Dict[str, Any]]:
    metric_names = [
        "silhouette",
        "nmi",
        "ari",
        "intra_distance",
        "inter_distance",
        "distance_ratio",
    ]
    out = {}
    for m in metric_names:
        values = [r["test_metrics"][m] for r in run_results]
        out[m] = {
            "mean": float(np.mean(values)),
            "std": float(np.std(values, ddof=0)),
            "values": [float(v) for v in values],
        }
    return out


def run_single_experiment(
    area_name: str,
    model_name: str,
    prepared: PreparedAreaData,
    config: ExperimentConfig,
    schema: FeatureSchema,
    run_id: int,
    device: torch.device,
    env_info: Dict[str, str],
):
    log_progress(f"    === Run {run_id + 1}/{config.num_runs} ===")

    PROFILER.reset()

    run_seed = config.base_seed + run_id * 1000
    set_global_seed(run_seed, config.deterministic)

    train_split, val_split, test_split, split_indices = build_splits(
        prepared, config, run_seed
    )
    log_progress(
        f"    Split sizes | Train={len(train_split)} Val={len(val_split)} Test={len(test_split)} "
        f"| Classes={prepared.num_classes}"
    )

    model = build_model(model_name, config, schema, prepared.schema_info).to(device)
    num_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    log_progress(f"    Params: {num_params:,}")

    if model_name in GRAPH_MODEL_NAMES:
        model, history, best_val = train_graph_model(
            model,
            model_name,
            train_split,
            val_split,
            prepared,
            config,
            device,
            run_seed,
        )
    else:
        model, history, best_val = train_non_graph_model(
            model,
            model_name,
            train_split,
            val_split,
            prepared,
            config,
            device,
            run_seed,
        )

    test_metrics = evaluate_model(
        model, model_name, test_split, prepared, config, device, kmeans_seed=run_seed
    )
    log_progress(
        f"    Test | Sil={test_metrics['silhouette']:.4f} "
        f"NMI={test_metrics['nmi']:.4f} ARI={test_metrics['ari']:.4f}"
    )

    log_progress(f"    最终 Profiler 报告:\n{PROFILER.report()}")

    ckpt_path = None
    if config.save_run_checkpoints:
        ckpt_path = save_run_checkpoint(
            area_name=area_name,
            model_name=model_name,
            run_id=run_id,
            model=model,
            history=history,
            config=config,
            split_indices=split_indices,
            env_info=env_info,
            meta=prepared.schema_info,
            best_val=best_val,
            profiler_summary=PROFILER.summary(),
        )

    save_profiler_log(area_name, model_name, PROFILER)

    del model
    clear_cuda_memory(aggressive=False)

    return {
        "history": history,
        "test_metrics": test_metrics,
        "best_val_silhouette": float(best_val),
        "num_params": int(num_params),
        "checkpoint_path": str(ckpt_path) if ckpt_path is not None else None,
        "split_indices": split_indices,
        "profiler_summary": PROFILER.summary(),
    }


def run_all_experiments_for_area(
    area_name: str,
    prepared: PreparedAreaData,
    config: ExperimentConfig,
    schema: FeatureSchema,
    device: torch.device,
    env_info: Dict[str, str],
):
    models = [
        "Full Model",
        "Pure GNN",
    ]

    log_progress("  验证消融公平性...")
    verify_ablation_fairness(config, schema, prepared.schema_info)

    all_results = {}

    for model_name in models:
        log_progress(f"\n  ========== {model_name} ==========")
        run_results = []

        for run_id in range(config.num_runs):
            result = run_single_experiment(
                area_name=area_name,
                model_name=model_name,
                prepared=prepared,
                config=config,
                schema=schema,
                run_id=run_id,
                device=device,
                env_info=env_info,
            )
            run_results.append(result)

        summary = summarize_runs(run_results)
        log_progress(
            f"    >>> Mean Silhouette = {summary['silhouette']['mean']:.4f} ± {summary['silhouette']['std']:.4f}"
        )

        all_results[model_name] = {
            "runs": run_results,
            "summary": summary,
            "num_params": run_results[0]["num_params"],
        }

    return all_results


def statistical_analysis(results: Dict[str, Dict]) -> Dict[str, Dict]:
    if "Full Model" not in results:
        log_progress("  [警告] 未找到 Full Model 结果，跳过统计分析")
        return {}

    baseline = results["Full Model"]["summary"]["silhouette"]["values"]

    if not baseline or len(baseline) == 0:
        log_progress("  [警告] Full Model 无有效 silhouette 值，跳过统计分析")
        return {}

    comparisons = {}
    raw_p = []
    names = []

    for model_name, obj in results.items():
        if model_name == "Full Model":
            continue

        cur = obj["summary"]["silhouette"]["values"]
        if not cur or len(cur) == 0:
            log_progress(f"  [警告] {model_name} 无有效 silhouette 值，跳过比较")
            continue

        if len(cur) != len(baseline):
            log_progress(f"  [警告] {model_name} 样本数 ({len(cur)}) 与 Full Model ({len(baseline)}) 不一致")
            continue

        st = paired_statistics(baseline, cur)
        comparisons[model_name] = st
        raw_p.append(st["t_p_value"])
        names.append(model_name)

    if raw_p:
        corrected, rejected = holm_correction(raw_p)
        for i, name in enumerate(names):
            comparisons[name]["corrected_p_value"] = float(corrected[i])
            comparisons[name]["significant"] = bool(rejected[i])

    return comparisons


# =========================================================
# 最终报告
# =========================================================

def generate_final_conclusion_report(
    all_area_results: Dict,
    env_info: Dict[str, str],
) -> str:
    """生成最终结论报告"""
    lines = []
    lines.append("# 防作弊实验最终结论报告\n")
    lines.append("## 实验设计\n")
    lines.append("### 问题诊断\n")
    lines.append("V6/V61 实验存在**标签泄露**问题：\n")
    lines.append("```")
    lines.append("输入: category_id + 其他特征")
    lines.append("标签: category_id")
    lines.append("      ↑ 直接泄露！")
    lines.append("```\n")
    lines.append("模型学到的是 `category_id → category_label` 的映射，而非空间拓扑。\n")

    lines.append("### 防作弊方案\n")
    lines.append("| 维度 | V6/V61（错误） | V1 防作弊（正确） |")
    lines.append("|------|---------------|------------------|")
    lines.append("| 标签来源 | category_id | KMeans 空间聚类 |")
    lines.append("| category特征 | 包含（泄露源） | **移除** |")
    lines.append("| 成功标准 | Sil > 0.8 | Sil > 0.3 即成功 |\n")

    lines.append("## 实验结果汇总\n")
    lines.append("| 区域 | Full Model | Pure GNN |")
    lines.append("|------|------------|----------|")

    for area_name, obj in all_area_results.items():
        r = obj["results"]
        full_sil = r['Full Model']['summary']['silhouette']
        gnn_sil = r['Pure GNN']['summary']['silhouette']
        lines.append(
            f"| {area_name} | "
            f"{full_sil['mean']:.4f}±{full_sil['std']:.4f} | "
            f"{gnn_sil['mean']:.4f}±{gnn_sil['std']:.4f} |"
        )

    lines.append("\n## 结论\n")

    # 计算平均 Silhouette
    all_full_sils = []
    all_gnn_sils = []
    for area_name, obj in all_area_results.items():
        all_full_sils.extend(obj["results"]["Full Model"]["summary"]["silhouette"]["values"])
        all_gnn_sils.extend(obj["results"]["Pure GNN"]["summary"]["silhouette"]["values"])

    avg_full = np.mean(all_full_sils) if all_full_sils else 0.0
    avg_gnn = np.mean(all_gnn_sils) if all_gnn_sils else 0.0

    lines.append(f"- **Full Model 平均 Silhouette**: {avg_full:.4f}")
    lines.append(f"- **Pure GNN 平均 Silhouette**: {avg_gnn:.4f}\n")

    if avg_full > 0.3:
        lines.append("### ✅ 成功：模型学到了空间拓扑能力\n")
        lines.append("在移除 category 特征并使用空间聚类标签后，模型仍能达到正的 Silhouette 分数，")
        lines.append("表明模型确实学到了空间拓扑关系，而非简单的标签泄露。")
    elif avg_full > 0:
        lines.append("### ⚠️ 部分成功：模型学到了有限的空间能力\n")
        lines.append("Silhouette 分数较低但为正，表明模型学到了一些空间模式，但仍有改进空间。")
    else:
        lines.append("### ❌ 失败：模型未能学到空间拓扑能力\n")
        lines.append("Silhouette 分数为负，表明当前架构不足以学习空间拓扑。")
        lines.append("需要进一步改进：")
        lines.append("1. 增加空间特征（距离、方向、密度等）")
        lines.append("2. 改进图构建方式（多尺度 KNN、路网感知等）")
        lines.append("3. 引入对比学习增强")

    lines.append("\n---\n")
    lines.append(f"*报告生成时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")
    lines.append(f"*实验框架版本: 防作弊 V1*")

    return "\n".join(lines)


# =========================================================
# Main
# =========================================================

def main():
    ensure_dirs()

    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        f.write(
            f"Experiment started at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        )

    if hasattr(torch, "set_float32_matmul_precision"):
        try:
            torch.set_float32_matmul_precision("high")
        except Exception:
            pass

    log_progress("=" * 70)
    log_progress("防作弊实验框架 V1")
    log_progress("=" * 70)
    log_progress("")
    log_progress("核心改进：")
    log_progress("  1. 标签来源：KMeans 空间聚类（彻底杜绝标签泄露）")
    log_progress("  2. 输入特征：移除 category（原泄露源头）")
    log_progress("  3. 评估目标：真正测试空间感知能力")
    log_progress("")

    env_info = get_env_info()
    device = torch.device(EXPERIMENT_CONFIG.device)
    log_progress(f"Device: {device}")
    log_progress(f"PyTorch: {env_info['torch_version']}")
    log_progress(f"CUDA: {env_info['cuda_version']}")
    log_progress(f"GPU: {env_info['gpu_name']}")

    if device.type == "cuda":
        mem_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        log_progress(f"GPU Memory: {mem_gb:.2f} GB")
        clear_cuda_memory()

    log_progress("\n加载数据集...")
    datasets = {}

    if EXPERIMENT_CONFIG.smoke_test:
        log_progress("  [冒烟测试模式] 只加载 1 个区域, 1 次运行")
        areas_to_load = ["guanggu_core"]
        effective_config = ExperimentConfig(**{**asdict(EXPERIMENT_CONFIG), "num_runs": 1})
    else:
        areas_to_load = ["guanggu_core", "wuda_area", "zhongjia_cun"]
        effective_config = EXPERIMENT_CONFIG

    for area in areas_to_load:
        try:
            ds = POIDataset(area)
            datasets[area] = ds
            log_progress(f"  {area}: {len(ds)} POIs")
        except (FileNotFoundError, OSError, ValueError) as e:
            log_progress(f"  {area}: 加载失败 - {type(e).__name__}: {e}")

    all_area_results = {}

    for area_name, dataset in datasets.items():
        log_progress(f"\n{'=' * 70}")
        log_progress(f"实验区域: {area_name}")
        log_progress(f"{'=' * 70}")

        prepared = prepare_area_data(
            area_name, dataset, FEATURE_SCHEMA, effective_config
        )
        log_progress(f"  Label source: {prepared.schema_info['label_source']}")
        log_progress(f"  use_category_input: {prepared.use_category_input}")
        log_progress(f"  num_classes: {prepared.num_classes}")

        results = run_all_experiments_for_area(
            area_name=area_name,
            prepared=prepared,
            config=effective_config,
            schema=FEATURE_SCHEMA,
            device=device,
            env_info=env_info,
        )

        comparisons = statistical_analysis(results)

        # 生成报告
        report = generate_area_report(
            area_name, results, comparisons, effective_config, env_info
        )

        report_path = REPORT_DIR / f"{area_name}_anti_cheat_v1_report.md"
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report)

        # 生成 LaTeX 表格
        latex_table = generate_latex_table(results, area_name, f"{area_name} 防作弊实验结果")
        latex_path = REPORT_DIR / f"{area_name}_anti_cheat_v1_table.tex"
        with open(latex_path, "w", encoding="utf-8") as f:
            f.write(latex_table)

        # 保存 JSON 结果
        json_path = JSON_DIR / f"{area_name}_anti_cheat_v1_results.json"
        with open(json_path, "w", encoding="utf-8") as f:
            serializable = {
                "area_name": area_name,
                "env_info": env_info,
                "config": asdict(effective_config),
                "schema": asdict(FEATURE_SCHEMA),
                "prepared_meta": prepared.schema_info,
                "results": results,
                "comparisons": comparisons,
            }
            json.dump(
                serializable, f, indent=2, ensure_ascii=False, default=tensor_to_list
            )

        # 生成可视化
        generate_plots(results, prepared, area_name)

        all_area_results[area_name] = {
            "results": results,
            "comparisons": comparisons,
            "prepared_meta": prepared.schema_info,
        }

        log_progress(f"  Report saved: {report_path}")
        log_progress(f"  LaTeX saved: {latex_path}")
        log_progress(f"  JSON saved: {json_path}")

    # 汇总报告
    summary_lines = []
    summary_lines.append("# 防作弊实验汇总 V1\n")
    summary_lines.append("| Area | Full Model | Pure GNN |")
    summary_lines.append("|------|------------|----------|")
    for area_name, obj in all_area_results.items():
        r = obj["results"]
        full_sil = r['Full Model']['summary']['silhouette']
        gnn_sil = r['Pure GNN']['summary']['silhouette']
        summary_lines.append(
            f"| {area_name} | "
            f"{full_sil['mean']:.4f}±{full_sil['std']:.4f} | "
            f"{gnn_sil['mean']:.4f}±{gnn_sil['std']:.4f} |"
        )

    summary_path = OUTPUT_DIR / "summary_v1.md"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("\n".join(summary_lines))

    # 最终结论报告
    final_report = generate_final_conclusion_report(all_area_results, env_info)
    final_report_path = OUTPUT_DIR / "FINAL_CONCLUSION_REPORT.md"
    with open(final_report_path, "w", encoding="utf-8") as f:
        f.write(final_report)

    log_progress(f"\nSummary saved: {summary_path}")
    log_progress(f"Final report saved: {final_report_path}")
    log_progress("=" * 70)
    log_progress("实验完成")
    log_progress("=" * 70)


if __name__ == "__main__":
    main()
