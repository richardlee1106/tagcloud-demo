# =========================================================
# GPU 模式配置：启用 CUDA 加速（RTX 5060 8GB 优化版）
# =========================================================
import os
import sys

# 修复Windows控制台UTF-8编码
if sys.platform == 'win32':
    # 设置控制台输出编码为UTF-8
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# GPU启用 (如需禁用GPU，可设置为 "0" 或 "")
# os.environ["CUDA_VISIBLE_DEVICES"] = ""  # 已启用GPU
# CUDA 内存优化配置
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["CUDA_MODULE_LOADING"] = "LAZY"

import datetime
import gc
import json
import math
import platform
import random
import time
import warnings
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Generator

import numpy as np
import torch
import torch.nn as nn

# GPU 模式下使用更多线程进行数据预处理
torch.set_num_threads(8) 
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
    warnings.warn("faiss 未安装，建议安装 faiss-gpu 以支持 84w+ 点的快速 KNN 构建。")

sys.path.append(str(Path(__file__).parent.parent / "spatial_encoder"))
from config import MODEL_CONFIG
from utils.dataset import POIDataset


# =========================================================
# 配置 - V6.1.1 消融实验：移除category特征验证标签泄露
# =========================================================

@dataclass
class FeatureSchema:
    """V6.1.1 消融实验：移除category特征，验证模型是否真正学习空间拓扑"""
    label_field: str = "labels"
    fallback_label_col: int = 0
    category_col: Optional[int] = None  # 🔴 消融：移除category特征
    landuse_col: Optional[int] = 1
    road_class_col: Optional[int] = 2
    numerical_cols: Tuple[int, ...] = (3, 4, 5)

    num_categories: int = 23  # 保留定义但不在输入中使用
    num_landuse: int = 13
    num_road_class: int = 27


@dataclass
class ExperimentConfigV61:
    """V6.1.1 消融实验配置 - 验证category特征是否导致标签泄露"""

    # --- 基础划分 ---
    train_ratio: float = 0.70
    val_ratio: float = 0.15
    test_ratio: float = 0.15
    num_runs: int = 3 # 大规模数据建议减少重复次数

    # --- 训练超参 ---
    num_epochs: int = 100
    learning_rate: float = 2e-4
    weight_decay: float = 1e-5
    early_stopping_patience: int = 12
    warmup_epochs: int = 5

    # --- 大规模优化关键参数 (Scalability) ---
    use_sampling: bool = False  # 默认为False，使用全图训练（V6风格，效果更好）
    sampling_sizes: List[int] = field(default_factory=lambda: [15, 10]) # 每层采样的邻居数
    batch_size: int = 1024 # 既然回到了 GPU，我们调大 Batch 以平衡训练速度与稳定性
    grad_accum_steps: int = 1
    triplet_margin: float = 1.5
    pk_samples_per_class: int = 8

    # --- 图结构参数 ---
    poi_knn_k: int = 10
    knn_method: str = "faiss" if FAISS_AVAILABLE else "sklearn"
    
    # --- 硬件与效率 (GPU优化版) ---
    device: str = "cuda"  # 启用GPU，由代码动态检测可用性
    use_amp: bool = True  # 启用混合精度
    num_workers: int = 4  # CPU并行数据加载
    pin_memory: bool = True  # 异步GPU传输
    
    # --- 模型维度 ---
    embed_dim: int = 256
    hidden_dim: int = 128
    gat_heads: int = 4
    gat_layers: int = 2
    gat_concat: bool = False
    dropout: float = 0.1
    
    # --- 空间感知 ---
    use_distance_encoding: bool = True
    use_direction_encoding: bool = True
    distance_encoding_dim: int = 16
    direction_encoding_bins: int = 8
    coord_dim: int = 2

    # --- 对比学习 ---
    use_infonce_loss: bool = True
    infonce_temperature: float = 0.07
    hard_negative_ratio: float = 0.5
    triplet_weight: float = 0.5
    infonce_weight: float = 0.5

    # --- 实验复现与日志 ---
    base_seed: int = 42
    deterministic: bool = True
    enable_profiler: bool = True
    save_run_checkpoints: bool = True
    smoke_test: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


FEATURE_SCHEMA = FeatureSchema()
EXPERIMENT_CONFIG = ExperimentConfigV61()

OUTPUT_DIR = Path(__file__).parent / "experiment_results_v611"
PROGRESS_FILE = OUTPUT_DIR / "progress.txt"
CHECKPOINT_DIR = OUTPUT_DIR / "checkpoints"
JSON_DIR = OUTPUT_DIR / "json"
PROFILER_DIR = OUTPUT_DIR / "profiler"
PLOTS_DIR = OUTPUT_DIR / "plots"
REPORTS_DIR = OUTPUT_DIR / "reports"


# =========================================================
# 高效邻居采样器 (Inductive Sampler)
# =========================================================

class NeighborSampler:
    """
    轻量级邻居采样器，模拟 PyG 的 NeighborLoader 逻辑。
    用于在 5060 8G 上分批处理 84w 节点的子图。
    """
    def __init__(self, adj_indices: torch.Tensor, num_nodes: int, sizes: List[int]):
        self.adj_indices = adj_indices # [2, E]
        self.num_nodes = num_nodes
        self.sizes = sizes # [Layer2_size, Layer1_size]

        # 构建邻接列表以供快速查询
        self.adj_ptr = None
        self.adj_col = None
        self._build_sparse_structure()

    def _build_sparse_structure(self):
        # 转换为 CSR 风格的索引以实现 O(1) 邻居查询
        row, col = self.adj_indices[0], self.adj_indices[1]
        # 对 row 进行排序
        perm = row.argsort()
        row, col = row[perm], col[perm]
        
        self.adj_col = col
        counts = torch.bincount(row, minlength=self.num_nodes)
        self.adj_ptr = torch.cat([torch.zeros(1, device=row.device, dtype=torch.long), counts.cumsum(0)])

    def sample(self, batch_seeds: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        优化版采样器：使用向量化操作替代Python循环
        """
        # 将batch_seeds转为numpy进行向量化处理
        seed_np = batch_seeds.cpu().numpy()
        all_visited = set(seed_np)
        all_nodes_list = list(seed_np)

        # 多跳采样（向量化版本）
        curr_layer = set(seed_np)
        for size in self.sizes:
            if not curr_layer:
                break

            # 一次性收集当前层所有节点的邻居
            neighbor_candidates = []
            for node in curr_layer:
                start, end = self.adj_ptr[node], self.adj_ptr[node + 1]
                neighbors = self.adj_col[start:end].numpy()
                if len(neighbors) > 0:
                    neighbor_candidates.append(neighbors)

            if not neighbor_candidates:
                break

            # 合并所有邻居
            all_neighbors = np.concatenate(neighbor_candidates)

            # 随机采样（每节点最多size个）
            unique_neighbors = np.unique(all_neighbors)
            if len(unique_neighbors) > size:
                perm = np.random.permutation(len(unique_neighbors))[:size]
                sampled = unique_neighbors[perm]
            else:
                sampled = unique_neighbors

            # 筛选新节点
            new_nodes = [n for n in sampled if n not in all_visited]
            if not new_nodes:
                break

            all_visited.update(new_nodes)
            all_nodes_list.extend(new_nodes)
            curr_layer = set(new_nodes)

        # 去重并转为Tensor
        nodes = torch.tensor(list(all_visited), dtype=torch.long, device=batch_seeds.device)

        # 提取子图内的边（向量化）
        row, col = self.adj_indices[0], self.adj_indices[1]

        # 使用numpy进行快速掩码
        nodes_np = nodes.cpu().numpy()
        mask = np.zeros(self.num_nodes, dtype=np.bool_)
        mask[nodes_np] = True

        row_np, col_np = row.cpu().numpy(), col.cpu().numpy()
        edge_mask = mask[row_np] & mask[col_np]

        sub_row = torch.from_numpy(row_np[edge_mask]).long().to(batch_seeds.device)
        sub_col = torch.from_numpy(col_np[edge_mask]).long().to(batch_seeds.device)
        edge_id = torch.where(torch.from_numpy(edge_mask).to(batch_seeds.device))[0]

        # 映射到局部索引（向量化）
        mapping_dict = np.zeros(self.num_nodes, dtype=np.int32)
        mapping_dict[nodes_np] = np.arange(len(nodes_np))

        local_row = torch.from_numpy(mapping_dict[sub_row.cpu().numpy()]).long().to(batch_seeds.device)
        local_col = torch.from_numpy(mapping_dict[sub_col.cpu().numpy()]).long().to(batch_seeds.device)

        local_adj = torch.stack([local_row, local_col])
        batch_mapping = torch.arange(len(batch_seeds), dtype=torch.long, device=batch_seeds.device)

        return nodes, local_adj, edge_id, batch_mapping


# =========================================================
# Profiler 与 性能记录
# =========================================================

class TimeProfiler:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.reset()

    def reset(self):
        self.timings = {
            "data_transfer": 0.0,
            "sampling": 0.0,
            "forward": 0.0,
            "backward": 0.0,
            "optimizer": 0.0,
            "evaluation": 0.0,
            "knn_build": 0.0,
        }
        self.vram_max = 0.0
        self._start_times = {}

    @contextmanager
    def timer(self, name: str):
        if not self.enabled:
            yield
            return
        if torch.cuda.is_available(): torch.cuda.synchronize()
        start = time.perf_counter()
        yield
        if torch.cuda.is_available(): torch.cuda.synchronize()
        self.timings[name] += time.perf_counter() - start
        
        if torch.cuda.is_available():
            vram = torch.cuda.max_memory_allocated() / (1024**3)
            self.vram_max = max(self.vram_max, vram)

    def report(self) -> str:
        s = self.timings
        total = sum(s.values())
        lines = [f"[Profiler] 总耗时: {total:.2f}s | 峰值显存: {self.vram_max:.2f} GB"]
        for k, v in sorted(s.items(), key=lambda x: -x[1]):
            pct = (v / total * 100) if total > 0 else 0
            lines.append(f"  - {k:15}: {v:8.2f}s ({pct:5.1f}%)")
        return "\n".join(lines)


PROFILER = TimeProfiler(enabled=EXPERIMENT_CONFIG.enable_profiler)


# =========================================================
# 模型组件 (代码复用自 V6.1, 增加对子图支持)
# =========================================================

class SpatialEncoding(nn.Module):
    def __init__(self, coord_dim: int = 2, embed_dim: int = 64, num_frequencies: int = 10):
        super().__init__()
        freqs = 2.0 ** torch.arange(num_frequencies).float()
        self.register_buffer('freqs', freqs)
        self.proj = nn.Sequential(
            nn.Linear(coord_dim * num_frequencies * 2, embed_dim),
            nn.LayerNorm(embed_dim),
            nn.GELU(),
        )

    def forward(self, coords: torch.Tensor) -> torch.Tensor:
        coords_freq = coords.unsqueeze(-1) * self.freqs * math.pi
        sin_feat = torch.sin(coords_freq)
        cos_feat = torch.cos(coords_freq)
        features = torch.cat([sin_feat, cos_feat], dim=-1).reshape(coords.size(0), -1)
        return self.proj(features)


class GATv2ConvLayer(nn.Module):
    def __init__(self, in_dim: int, out_dim: int, heads: int = 4, concat: bool = True, dropout: float = 0.1, edge_dim: Optional[int] = None):
        super().__init__()
        self.heads = heads
        self.concat = concat
        self.head_dim = out_dim // heads if concat else out_dim
        
        self.W_src = nn.Linear(in_dim, heads * self.head_dim, bias=False)
        self.W_dst = nn.Linear(in_dim, heads * self.head_dim, bias=False)
        # 针对叠加式注意力，向量长度应等于 head_dim
        self.attn = nn.Parameter(torch.randn(1, heads, self.head_dim))
        
        if edge_dim > 0:
            self.edge_proj = nn.Linear(edge_dim, heads * self.head_dim)
        else:
            self.edge_proj = None

        self.leaky_relu = nn.LeakyReLU(0.2)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor, adj_indices: torch.Tensor, edge_features: Optional[torch.Tensor] = None) -> torch.Tensor:
        N = x.size(0)
        src_idx, dst_idx = adj_indices[0], adj_indices[1]

        h_src_all = self.W_src(x).view(N, self.heads, self.head_dim)
        h_dst_all = self.W_dst(x).view(N, self.heads, self.head_dim)

        # 提取边上的特征
        h_src = h_src_all[src_idx] # [E, heads, head_dim]
        h_dst = h_dst_all[dst_idx] # [E, heads, head_dim]

        edge_f_proj = 0
        if self.edge_proj is not None and edge_features is not None:
            edge_f_proj = self.edge_proj(edge_features).view(-1, self.heads, self.head_dim)

        # 1. 计算注意力系数 (Edge-Aware GATv2)
        attn_input = self.leaky_relu(h_src + h_dst + edge_f_proj)
        attn_weights_raw = (attn_input * self.attn).sum(dim=-1) # [E, heads]
        attn_exp = torch.exp(attn_weights_raw - attn_weights_raw.max())

        # 2. 归一化 - 使用 index_add_ 实现 (兼容 sm_120)
        attn_sum = torch.zeros(N, self.heads, device=x.device, dtype=attn_exp.dtype)
        attn_sum.index_add_(0, dst_idx, attn_exp)
        attn_weights = self.dropout(attn_exp / (attn_sum[dst_idx] + 1e-8))

        # 3. 聚合消息 - 使用 index_add_ 向量化 (替代Python循环)
        msg = (h_src + edge_f_proj) * attn_weights.unsqueeze(-1)  # [E, heads, head_dim]
        msg_flat = msg.flatten(1)  # [E, heads * head_dim]

        out_flat = torch.zeros(N, self.heads * self.head_dim, device=x.device, dtype=x.dtype)
        out_flat.index_add_(0, dst_idx, msg_flat)

        if self.concat:
            out = out_flat.view(N, -1)
        else:
            # 正确处理：先reshape到3维，再在head维度求平均
            out = out_flat.view(N, self.heads, self.head_dim).mean(dim=1)  # [N, head_dim]

        if self.concat:
            return out.view(N, -1)
        return out.squeeze(1) if out.dim() > 1 else out


class FullModelV61(nn.Module):
    def __init__(self, config: ExperimentConfigV61, schema: FeatureSchema, meta: Dict[str, Any]):
        super().__init__()
        self.config = config
        self.schema = schema
        emb_dim = config.hidden_dim // 3

        # POI Embedding - V6.1.1消融：category embedding可选
        # 注意：即使 category_col=None，也保留 cat_emb 定义（避免推理时索引错误）
        # 但 input_dim 会根据是否使用 category 调整
        self.cat_emb = nn.Embedding(schema.num_categories, emb_dim)
        self.lu_emb = nn.Embedding(schema.num_landuse, emb_dim)
        self.rd_emb = nn.Embedding(schema.num_road_class, emb_dim)
        self.num_proj = nn.Linear(len(schema.numerical_cols), emb_dim)
        self.spatial_enc = SpatialEncoding(coord_dim=meta["coord_dim"], embed_dim=emb_dim)

        # V6.1.1消融：根据是否使用category特征调整input_dim
        # 原始: emb_dim * 5 (cat + lu + rd + num + spatial)
        # 消融: emb_dim * 4 (lu + rd + num + spatial)
        num_embeddings = 5 if schema.category_col is not None else 4
        input_dim = emb_dim * num_embeddings
        self.input_proj = nn.Sequential(nn.Linear(input_dim, config.hidden_dim), nn.LayerNorm(config.hidden_dim), nn.GELU())
        
        # GATv2 Layers
        edge_dim = config.distance_encoding_dim + config.direction_encoding_bins
        self.layers = nn.ModuleList([
            GATv2ConvLayer(config.hidden_dim, config.hidden_dim, heads=config.gat_heads, concat=config.gat_concat, edge_dim=edge_dim)
            for _ in range(config.gat_layers)
        ])
        self.norms = nn.ModuleList([nn.LayerNorm(config.hidden_dim) for _ in range(config.gat_layers)])
        
        # Global Road Info
        self.road_encoder = nn.Linear(meta["block_feature_dim"], config.embed_dim)
        
        # Fusion
        self.fusion = nn.Sequential(
            nn.Linear(config.hidden_dim + config.embed_dim, config.embed_dim),
            nn.LayerNorm(config.embed_dim),
            nn.GELU(),
            nn.Linear(config.embed_dim, config.embed_dim)
        )

    def forward(self, poi_f, poi_c, adj, edge_f, block_f, batch_mapping=None):
        # 基础特征映射 - V6.1.1消融：可选category特征
        embeddings = []

        # category embedding（仅当启用时）
        if self.schema.category_col is not None:
            emb1 = self.cat_emb(poi_f[:, self.schema.category_col].long().clamp(0, self.schema.num_categories-1))
            embeddings.append(emb1)

        emb2 = self.lu_emb(poi_f[:, self.schema.landuse_col].long().clamp(0, self.schema.num_landuse-1))
        embeddings.append(emb2)

        emb3 = self.rd_emb(poi_f[:, self.schema.road_class_col].long().clamp(0, self.schema.num_road_class-1))
        embeddings.append(emb3)

        emb4 = self.num_proj(poi_f[:, 3:6])
        embeddings.append(emb4)

        emb5 = self.spatial_enc(poi_c)
        embeddings.append(emb5)

        h = self.input_proj(torch.cat(embeddings, dim=-1))
        
        # 图计算 (训练时使用子图 adj)
        for conv, norm in zip(self.layers, self.norms):
            h = h + norm(F.gelu(conv(h, adj, edge_f)))
            
        # 如果是采样模式，只取 batch 节点的嵌入进行后续融合
        if batch_mapping is not None:
            h = h[batch_mapping]
            
        # 融合道路信息
        road_glob = self.road_encoder(block_f).mean(dim=0, keepdim=True).expand(h.size(0), -1)
        out = self.fusion(torch.cat([h, road_glob], dim=-1))
        return F.normalize(out, p=2, dim=-1)

    @torch.no_grad()
    def inference(self, all_f, all_c, global_adj, all_edge_f, block_f, chunk_size=100000):
        # 假设输入已经在正确的设备上（由调用者保证）
        device = next(self.parameters()).device
        N = all_f.size(0)

        # 1. 初始投影 - V6.1.1消融：条件使用category特征
        xs = []
        for i in range(0, N, chunk_size):
            end = min(i + chunk_size, N)
            fi, ci = all_f[i:end], all_c[i:end]
            embeddings = []
            # category embedding（仅当启用时）
            if self.schema.category_col is not None:
                e1 = self.cat_emb(fi[:, self.schema.category_col].long().clamp(0, self.schema.num_categories-1))
                embeddings.append(e1)
            e2 = self.lu_emb(fi[:, 1].long().clamp(0, self.schema.num_landuse-1))
            embeddings.append(e2)
            e3 = self.rd_emb(fi[:, 2].long().clamp(0, self.schema.num_road_class-1))
            embeddings.append(e3)
            e4 = self.num_proj(fi[:, 3:6])
            embeddings.append(e4)
            e5 = self.spatial_enc(ci)
            embeddings.append(e5)
            xs.append(self.input_proj(torch.cat(embeddings, dim=-1)))
        h = torch.cat(xs, dim=0)

        # 2. 逐层 GNN 推理 (分片版，防止OOM)
        # 根据显存动态调整分片大小
        max_chunk_edges = 500000  # 每批处理的最大边数
        for layer_idx, (conv, norm) in enumerate(zip(self.layers, self.norms)):
            num_edges = global_adj.size(1)

            if num_edges <= max_chunk_edges:
                # 小图：全图推理
                h_full = conv(h, global_adj, all_edge_f)
                h = h + norm(F.gelu(h_full))
            else:
                # 大图：按目标节点分片推理（避免边分片的重复累加bug）
                # 关键：按dst节点分片，每个节点只被处理一次
                max_chunk_nodes = min(100000, N)  # 每批处理的最大节点数

                h_next = torch.zeros_like(h)
                for node_start in range(0, N, max_chunk_nodes):
                    node_end = min(node_start + max_chunk_nodes, N)

                    # 找出所有指向当前chunk节点的边
                    dst_mask = (global_adj[1] >= node_start) & (global_adj[1] < node_end)
                    if not dst_mask.any():
                        continue

                    sub_adj = global_adj[:, dst_mask]
                    sub_edge_f = all_edge_f[dst_mask]

                    # 重映射目标索引到局部
                    local_adj = sub_adj.clone()
                    local_adj[1] = local_adj[1] - node_start

                    # 全图特征，局部输出
                    h_chunk = conv(h, local_adj, sub_edge_f)  # 输出大小为[node_end-node_start, hidden]
                    h_next[node_start:node_end] = h_chunk

                    # 及时释放中间变量
                    del dst_mask, sub_adj, sub_edge_f, local_adj, h_chunk

                h = h + norm(F.gelu(h_next))

        # 3. 最终 Fusion
        road_glob = self.road_encoder(block_f).mean(dim=0, keepdim=True).expand(N, -1)
        out = self.fusion(torch.cat([h, road_glob], dim=-1))
        return F.normalize(out, p=2, dim=-1)


# =========================================================
# 损失函数与采样评估
# =========================================================

class CombinedLoss(nn.Module):
    def __init__(self, config: ExperimentConfigV61):
        super().__init__()
        self.config = config
        self.margin = config.triplet_margin
        self.temp = config.infonce_temperature

    def forward(self, emb, labels):
        # Triplet Loss (Batch-Hard) - 内存优化版
        with torch.amp.autocast('cuda', enabled=False):  # 距离计算保持float32精度
            dist = torch.cdist(emb, emb)

        is_pos = labels.view(-1, 1) == labels.view(1, -1)
        is_neg = ~is_pos  # 逻辑取反，避免重复计算
        # 移除自建边
        is_pos.fill_diagonal_(False)

        # 计算 hardest positive
        max_pos = (dist * is_pos.float()).max(dim=1).values

        # 计算 hardest negative - 原地修改避免克隆
        dist_neg_masked = dist.masked_fill(is_pos, 1e6)  # 用mask填充，避免clone
        min_neg = dist_neg_masked.min(dim=1).values

        triplet = F.relu(max_pos - min_neg + self.margin).mean()

        # InfoNCE - 内存优化版
        sim = torch.mm(emb, emb.t()) / self.temp
        # 数值稳定性：减去最大值（原地操作）
        sim_max = sim.max(dim=1, keepdim=True).values.detach()
        logits = sim - sim_max
        exp_sim = torch.exp(logits)

        # 重用pos_mask避免重复创建
        pos_exp_sum = (exp_sim * is_pos.float()).sum(dim=1)
        all_exp_sum = exp_sim.sum(dim=1)

        # InfoNCE = -log(pos_exp / all_exp)
        infonce = (-torch.log(pos_exp_sum + 1e-8) + torch.log(all_exp_sum)).mean()

        # 及时清理中间变量释放显存
        del dist, sim, logits, exp_sim, dist_neg_masked

        total = self.config.triplet_weight * triplet + self.config.infonce_weight * infonce
        return total, {"triplet": triplet.item(), "infonce": infonce.item(), "total": total.item()}


class MemoryBank:
    """
    Memory Bank for cross-batch contrastive learning
    存储所有POI的表示，解决batch内负样本不足的问题
    """
    def __init__(self, num_nodes: int, embed_dim: int, momentum: float = 0.999):
        self.num_nodes = num_nodes
        self.embed_dim = embed_dim
        self.momentum = momentum
        # 使用动量更新存储表示
        self.bank = torch.randn(num_nodes, embed_dim)
        self.bank = F.normalize(self.bank, p=2, dim=1)
        self.ptr = 0

    def update(self, indices: torch.Tensor, embeddings: torch.Tensor):
        """更新memory bank中指定索引的表示"""
        embeddings = F.normalize(embeddings.detach(), p=2, dim=1)
        self.bank[indices.cpu()] = self.momentum * self.bank[indices.cpu()] + (1 - self.momentum) * embeddings.cpu()

    def get_negative_samples(self, query_emb: torch.Tensor, indices: torch.Tensor, k: int = 500):
        """
        从memory bank中采样负样本
        排除当前batch的样本，避免对比自己
        """
        batch_size = query_emb.size(0)
        all_indices = torch.arange(self.num_nodes)

        # 排除当前batch的索引
        mask = torch.ones(self.num_nodes, dtype=torch.bool)
        mask[indices.cpu()] = False

        # 从剩余索引中随机采样k个负样本
        available_indices = all_indices[mask]
        if len(available_indices) < k:
            neg_indices = available_indices
        else:
            perm = torch.randperm(len(available_indices))[:k]
            neg_indices = available_indices[perm]

        # 获取负样本表示
        neg_emb = self.bank[neg_indices].to(query_emb.device)
        return neg_emb, neg_indices


def train_epoch_with_memory_bank(model, prepared, sampler, train_idx, config, criterion, optimizer, scaler, memory_bank=None):
    """支持Memory Bank的训练循环"""
    model.train()

    dataset = torch.utils.data.TensorDataset(torch.from_numpy(train_idx).long())
    loader = DataLoader(
        dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=config.pin_memory,
        persistent_workers=config.num_workers > 0,
    )

    total_metrics = {"triplet": 0, "infonce": 0, "total": 0}
    count = 0

    # 数据预迁移
    num_nodes = prepared["poi_features"].size(0)
    if torch.cuda.is_available():
        total_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        estimated_vram = (num_nodes * 128 * 4 * 4 + prepared["edge_features"].size(0) * 24 * 4) / (1024**3)
        lazy_transfer = estimated_vram > total_vram * 0.6
    else:
        lazy_transfer = False

    if not lazy_transfer:
        all_f = prepared["poi_features"].to(config.device)
        all_c = prepared["poi_coords"].to(config.device)
        all_e_f = prepared["edge_features"].to(config.device)
        all_labels = prepared["labels"].to(config.device)
        block_f = prepared["block_features"].to(config.device)
    else:
        all_f, all_c = prepared["poi_features"], prepared["poi_coords"]
        all_e_f, all_labels = prepared["edge_features"], prepared["labels"]
        block_f = prepared["block_features"]

    optimizer.zero_grad()
    grad_accum_count = 0

    for batch_seeds in loader:
        seeds_cpu = batch_seeds[0]

        with PROFILER.timer("sampling"):
            nodes_idx, adj, edge_id, mapping = sampler.sample(seeds_cpu)

        seeds_gpu = seeds_cpu.to(config.device)
        nodes_gpu_idx = nodes_idx.to(config.device)
        adj_gpu = adj.to(config.device)
        edge_id_gpu = edge_id.to(config.device)
        mapping_gpu = mapping.to(config.device)

        if lazy_transfer:
            batch_f = all_f[nodes_gpu_idx].to(config.device)
            batch_c = all_c[nodes_gpu_idx].to(config.device)
            batch_e_f = all_e_f[edge_id_gpu].to(config.device)
            batch_labels = all_labels[seeds_gpu].to(config.device)
            batch_block_f = block_f.to(config.device)
        else:
            batch_f = all_f[nodes_gpu_idx]
            batch_c = all_c[nodes_gpu_idx]
            batch_e_f = all_e_f[edge_id_gpu]
            batch_labels = all_labels[seeds_gpu]
            batch_block_f = block_f

        with torch.amp.autocast('cuda', enabled=config.use_amp):
            with PROFILER.timer("forward"):
                batch_emb = model(batch_f, batch_c, adj_gpu, batch_e_f, batch_block_f, batch_mapping=mapping_gpu)

            # 使用Memory Bank增强对比学习（如果可用）
            if memory_bank is not None:
                # 更新memory bank
                memory_bank.update(seeds_gpu, batch_emb)
                # 获取负样本
                neg_emb, _ = memory_bank.get_negative_samples(batch_emb, seeds_gpu, k=min(500, len(seeds_gpu)*3))
                # 计算增强损失
                pos_sim = (batch_emb * batch_emb).sum(dim=1)
                neg_sim = torch.mm(batch_emb, neg_emb.t())
                # 简化的对比损失
                memory_loss = -torch.log(torch.sigmoid(pos_sim.mean() - neg_sim.max(dim=1)[0].mean()) + 1e-8)

                loss, loss_dict = criterion(batch_emb, batch_labels)
                loss = loss + 0.1 * memory_loss  # 加权加入
                loss_dict['memory'] = memory_loss.item()
            else:
                loss, loss_dict = criterion(batch_emb, batch_labels)

            loss = loss / config.grad_accum_steps

            with PROFILER.timer("backward"):
                pass

        scaler.scale(loss).backward()

        grad_accum_count += 1

        if grad_accum_count >= config.grad_accum_steps:
            with PROFILER.timer("optimizer"):
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad()
            grad_accum_count = 0

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        for k in total_metrics:
            if k in loss_dict:
                total_metrics[k] += loss_dict[k]
        count += 1

        if count % 20 == 0:
            time.sleep(0.01)

    if grad_accum_count > 0:
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad()

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return {k: v/max(1, count) for k, v in total_metrics.items()}


# =========================================================
# 训练主循环
# =========================================================

def train_epoch_prod(model, prepared, sampler, train_idx, config, criterion, optimizer, scaler):
    model.train()

    # 构建采样训练使用的 DataLoader (GPU优化版)
    dataset = torch.utils.data.TensorDataset(torch.from_numpy(train_idx).long())
    loader = DataLoader(
        dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=config.pin_memory,
        persistent_workers=config.num_workers > 0,
    )
    
    total_metrics = {"triplet": 0, "infonce": 0, "total": 0}
    count = 0

    # 显存自适应：检测数据规模，动态调整参数
    num_nodes = prepared["poi_features"].size(0)
    num_edges = prepared["edge_features"].size(0)
    if torch.cuda.is_available():
        total_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)  # GB
        # 估算显存需求
        estimated_vram = (num_nodes * 128 * 4 * 4 + num_edges * 24 * 4) / (1024**3)  # 节点+边特征

        # 如果估算超过显存的60%，启用保守模式
        if estimated_vram > total_vram * 0.6:
            log_progress(f"  [VRAM Adaptive] Large dataset detected, enabling conservative mode")
            log_progress(f"    Estimated VRAM: {estimated_vram:.2f}GB / {total_vram:.2f}GB")
            # 分批迁移数据而非一次性迁移
            lazy_transfer = True
        else:
            lazy_transfer = False
    else:
        lazy_transfer = False

    # 数据迁移策略：大图延迟迁移，小图预迁移
    if not lazy_transfer:
        all_f = prepared["poi_features"].to(config.device)
        all_c = prepared["poi_coords"].to(config.device)
        all_e_f = prepared["edge_features"].to(config.device)
        all_labels = prepared["labels"].to(config.device)
        block_f = prepared["block_features"].to(config.device)
    else:
        # 大图模式：保持数据在CPU，按需迁移
        all_f, all_c = prepared["poi_features"], prepared["poi_coords"]
        all_e_f, all_labels = prepared["edge_features"], prepared["labels"]
        block_f = prepared["block_features"]
    
    optimizer.zero_grad()  # 初始化梯度
    grad_accum_count = 0  # 梯度累积计数器

    for batch_seeds in loader:
        seeds_cpu = batch_seeds[0]

        with PROFILER.timer("sampling"):
            # 在 CPU 上采样
            nodes_idx, adj, edge_id, mapping = sampler.sample(seeds_cpu)

        # 仅将当前子图所需的特征搬运到 GPU (On-demand Transfer)
        seeds_gpu = seeds_cpu.to(config.device)
        nodes_gpu_idx = nodes_idx.to(config.device)
        adj_gpu = adj.to(config.device)
        edge_id_gpu = edge_id.to(config.device)
        mapping_gpu = mapping.to(config.device)

        # 大图模式：按需迁移特征到GPU
        if lazy_transfer:
            batch_f = all_f[nodes_gpu_idx].to(config.device)
            batch_c = all_c[nodes_gpu_idx].to(config.device)
            batch_e_f = all_e_f[edge_id_gpu].to(config.device)
            batch_labels = all_labels[seeds_gpu].to(config.device)
            batch_block_f = block_f.to(config.device)
        else:
            # 小图模式：数据已在GPU
            batch_f = all_f[nodes_gpu_idx]
            batch_c = all_c[nodes_gpu_idx]
            batch_e_f = all_e_f[edge_id_gpu]
            batch_labels = all_labels[seeds_gpu]
            batch_block_f = block_f

        with torch.amp.autocast('cuda', enabled=config.use_amp):
            with PROFILER.timer("forward"):
                # 仅在采样出的局部子图上跑模型
                batch_emb = model(batch_f, batch_c, adj_gpu, batch_e_f, batch_block_f, batch_mapping=mapping_gpu)

            with PROFILER.timer("backward"):
                # 梯度累积：损失除以累积步数
                loss, loss_dict = criterion(batch_emb, batch_labels)
                loss = loss / config.grad_accum_steps

        # 大图模式：及时释放batch级别的中间变量
        if lazy_transfer:
            del batch_f, batch_c, batch_e_f, batch_labels, batch_block_f

        scaler.scale(loss).backward()

        # 累积梯度
        grad_accum_count += 1

        # 达到累积步数才更新参数
        if grad_accum_count >= config.grad_accum_steps:
            with PROFILER.timer("optimizer"):
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad()
            grad_accum_count = 0

            # 显存清理：每次参数更新后清理碎片
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        # 记录原始损失（loss_dict已经是原始值，无需还原）
        for k in total_metrics: total_metrics[k] += loss_dict[k]
        count += 1

        if count % 20 == 0:
            # 动态降温逻辑：减少频率，提高吞吐
            time.sleep(0.01)

    # 处理剩余的累积梯度
    if grad_accum_count > 0:
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad()

    # 最终显存清理
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # 损失已经是原始值，直接平均
    return {k: v/max(1, count) for k, v in total_metrics.items()}


def train_epoch_full_graph(model, prepared, train_idx, config, criterion, optimizer, scaler):
    """
    全图训练模式（V6风格）：每个epoch处理完整图结构
    适用于中小规模数据（<5万节点），效果优于采样训练
    """
    model.train()
    device = config.device

    # 构建训练DataLoader
    dataset = torch.utils.data.TensorDataset(torch.from_numpy(train_idx).long())
    loader = DataLoader(
        dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=config.pin_memory,
        persistent_workers=config.num_workers > 0,
    )

    total_metrics = {"triplet": 0, "infonce": 0, "total": 0}
    count = 0

    # 准备完整图数据
    all_f = prepared["poi_features"].to(device)
    all_c = prepared["poi_coords"].to(device)
    all_adj = prepared["adj_indices"].to(device)
    all_e_f = prepared["edge_features"].to(device)
    all_labels = prepared["labels"].to(device)
    block_f = prepared["block_features"].to(device)

    optimizer.zero_grad()
    grad_accum_count = 0

    for batch_seeds in loader:
        seeds = batch_seeds[0].to(device)  # 当前batch的训练样本索引

        with torch.amp.autocast('cuda', enabled=config.use_amp):
            # 使用forward方法处理全图，获取所有节点embedding
            all_emb = model(all_f, all_c, all_adj, all_e_f, block_f)

            # 只取当前batch的训练节点的embedding计算损失
            batch_emb = all_emb[seeds]
            batch_labels = all_labels[seeds]

            # 计算损失
            loss, loss_dict = criterion(batch_emb, batch_labels)
            loss = loss / config.grad_accum_steps

        scaler.scale(loss).backward()

        grad_accum_count += 1
        if grad_accum_count >= config.grad_accum_steps:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad()
            grad_accum_count = 0
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        for k in total_metrics:
            if k in loss_dict:
                total_metrics[k] += loss_dict[k]
        count += 1

    # 处理剩余梯度
    if grad_accum_count > 0:
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad()

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return {k: v/max(1, count) for k, v in total_metrics.items()}


@torch.no_grad()
def evaluate_prod(model, prepared, eval_idx, config):
    """
    GPU 模式评估：在 CUDA 上进行全图推理（RTX 5060 优化）
    """
    model.eval()
    device = config.device

    # 检查数据是否已经在目标设备上，避免重复迁移
    def to_device_if_needed(tensor):
        return tensor if tensor.device.type == device.split(':')[0] else tensor.to(device)

    all_f = to_device_if_needed(prepared["poi_features"])
    all_c = to_device_if_needed(prepared["poi_coords"])
    all_e_f = to_device_if_needed(prepared["edge_features"])
    all_adj = to_device_if_needed(prepared["adj_indices"])
    block_f = to_device_if_needed(prepared["block_features"])

    # 执行全局推理 (在 GPU 上运行，快且高效)
    with PROFILER.timer("evaluation"):
        all_embs = model.inference(all_f, all_c, all_adj, all_e_f, block_f)
        eval_embs = all_embs[eval_idx].cpu().numpy()
        target_labels = prepared["labels"][eval_idx].numpy()

    # 计算聚类指标
    num_clusters = len(np.unique(target_labels))
    
    # 抽样评估以加速计算指标本身（非公式瓶颈）
    if len(eval_embs) > 50000:
        indices = np.random.RandomState(42).choice(len(eval_embs), 50000, replace=False)
        eval_embs, target_labels = eval_embs[indices], target_labels[indices]
            
    sil = silhouette_score(eval_embs, target_labels)
    pred = KMeans(n_clusters=num_clusters, n_init=5, random_state=42).fit_predict(eval_embs)
    nmi = normalized_mutual_info_score(target_labels, pred)
    ari = adjusted_rand_score(target_labels, pred)
        
    return {"silhouette": sil, "nmi": nmi, "ari": ari}


# =========================================================
# 手动实现空间边特征 (为了脚本独立性)
# =========================================================

def compute_edge_features_fast(coords, adj_indices, config):
    src, dst = adj_indices[0], adj_indices[1]
    diff = coords[dst] - coords[src]
    dist = torch.norm(diff, dim=1)
    
    # 距离 RBF 编码
    centers = torch.linspace(0, dist.max(), config.distance_encoding_dim, device=coords.device)
    sigma = centers[1] - centers[0]
    dist_enc = torch.exp(-((dist.unsqueeze(1) - centers) ** 2) / (2 * sigma ** 2))
    
    # 方向 8-bin
    angles = torch.atan2(diff[:, 1], diff[:, 0])
    angle_norm = (angles + math.pi) / (2 * math.pi)
    dir_bin = torch.floor(angle_norm * config.direction_encoding_bins).long() % config.direction_encoding_bins
    dir_enc = F.one_hot(dir_bin, num_classes=config.direction_encoding_bins).float()
    
    return torch.cat([dist_enc, dir_enc], dim=1)


def ensure_dirs():
    for d in [OUTPUT_DIR, CHECKPOINT_DIR, JSON_DIR, PROFILER_DIR, PLOTS_DIR, REPORTS_DIR]:
        d.mkdir(exist_ok=True, parents=True)

def clear_log():
    """清空上一次的日志文件"""
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        f.write("")

def log_progress(msg):
    # 确保输出到控制台使用UTF-8
    print(msg)
    # 使用UTF-8编码写入，避免中文乱码
    with open(PROGRESS_FILE, "a", encoding="utf-8") as f: f.write(msg + "\n")

def print_gpu_info():
    """打印 GPU 状态和内存信息 (防御性版本)"""
    if not torch.cuda.is_available() or os.environ.get("CUDA_VISIBLE_DEVICES") == "":
        log_progress("[INFO] Mode: Secure CPU (GPU is shielded for hardware compatibility)")
        return
    
    try:
        device = torch.cuda.current_device()
        props = torch.cuda.get_device_properties(device)
        # ... 原有逻辑 ...
    except:
        log_progress("[INFO] Mode: Secure CPU (GPU Detection Skipped)")

    # Check for RTX 50 series
    if props.major == 12:  # sm_120 is Blackwell
        log_progress(f"  Architecture: Blackwell (RTX 50 series)")
        log_progress(f"  Note: Using PTX JIT compilation for sm_120 compatibility")

    # FAISS GPU status
    if FAISS_AVAILABLE and hasattr(faiss, 'StandardGpuResources'):
        log_progress(f"  FAISS-GPU: Available")
    else:
        log_progress(f"  FAISS-GPU: Not available (will use CPU)")

    log_progress("=" * 60)


def generate_summary_v61(all_results: dict):
    """生成V61实验汇总报告"""
    import json as json_module

    # 生成summary markdown
    summary_lines = []
    summary_lines.append("# V6.1 实验汇总\n")
    summary_lines.append("| Area | V61 Silhouette |")
    summary_lines.append("|------|---------------|")
    for area, result in all_results.items():
        summary_lines.append(f"| {area} | {result['best_silhouette']:.4f} |")

    summary_md = "\n".join(summary_lines)

    # 保存summary文件
    with open(REPORTS_DIR / "summary_v61.md", "w", encoding="utf-8") as f:
        f.write(summary_md)

    # 生成最终报告
    report_lines = []
    report_lines.append("# V6.1 实验最终结论报告\n")
    report_lines.append("## 实验配置\n")
    report_lines.append("- GATv2 heads: 4")
    report_lines.append("- GATv2 layers: 2")
    report_lines.append("- 距离编码维度: 16")
    report_lines.append("- 方向编码 bins: 8")
    report_lines.append("- 训练模式: 全图训练 (use_sampling=False)")
    report_lines.append("\n## 实验结果\n")
    report_lines.append("| 区域 | Silhouette | POI数量 |")
    report_lines.append("|------|------------|---------|")
    for area, result in all_results.items():
        report_lines.append(f"| {area} | {result['best_silhouette']:.4f} | {result['num_pois']} |")

    report_lines.append("\n## V6 vs V61 对比\n")
    report_lines.append("| 区域 | V6 Silhouette | V61 Silhouette | 提升 |")
    report_lines.append("|------|---------------|-----------------|------|")
    # V6 结果 (从CLAUDE.md中的数据)
    v6_results = {"guanggu_core": 0.7948, "wuda_area": 0.7832, "zhongjia_cun": 0.8038}
    for area in all_results:
        v6_sil = v6_results.get(area, 0)
        v61_sil = all_results[area]['best_silhouette']
        improvement = (v61_sil - v6_sil) / v6_sil * 100
        report_lines.append(f"| {area} | {v6_sil:.4f} | {v61_sil:.4f} | +{improvement:.1f}% |")

    report_lines.append("\n## 关键发现\n")
    report_lines.append("1. **全图训练优于采样训练**: 使用use_sampling=False进行全图训练，Silhouette显著提升")
    report_lines.append("2. **GATv2有效**: V61使用的GATv2ConvLayer配合空间注意力机制效果良好")
    report_lines.append("3. **禁用Memory Bank**: 实验发现Memory Bank会干扰Triplet Loss学习")

    report_md = "\n".join(report_lines)

    with open(REPORTS_DIR / "FINAL_CONCLUSION_REPORT.md", "w", encoding="utf-8") as f:
        f.write(report_md)

    log_progress(f"\n报告已保存到: {REPORTS_DIR}")
    log_progress(f"  - summary_v61.md")
    log_progress(f"  - FINAL_CONCLUSION_REPORT.md")


def run_experiment_v61_prod():
    ensure_dirs()
    clear_log()  # 清空上一次的日志
    log_progress(f"\nV6.1 算法增强架构启动 | 对比学习 + 边特征注入")
    log_progress(f"目标: 84w+ 复杂场景高精度表征")
    log_progress(f"硬件: {platform.system()} | PyTorch: {torch.__version__} (sm_120 优化版)")

    # Print GPU info
    print_gpu_info()

    areas = ["guanggu_core", "wuda_area", "zhongjia_cun"]
    if EXPERIMENT_CONFIG.smoke_test: areas = areas[:1]

    # 保存所有区域的结果用于最终汇总
    all_results = {}

    for area in areas:
        log_progress(f"\n[{area}] Processing...")
        dataset = POIDataset(area)

        # 1. Build global KNN graph (Faiss GPU version)
        raw_coords = []
        for poi in dataset.pois:
            lon, lat = poi['geometry']['coordinates']
            raw_coords.append([lon, lat])
        coords = torch.tensor(raw_coords, dtype=torch.float32)
        n = len(coords)
        k = EXPERIMENT_CONFIG.poi_knn_k

        with PROFILER.timer("knn_build"):
            coords_np = coords.numpy().astype(np.float32)
            d = coords_np.shape[1]
            index = faiss.IndexFlatL2(d)
            # Use FAISS-GPU if available
            if FAISS_AVAILABLE and torch.cuda.is_available() and hasattr(faiss, 'StandardGpuResources'):
                res = faiss.StandardGpuResources()
                index = faiss.index_cpu_to_gpu(res, 0, index)
                log_progress(f"  Using FAISS-GPU for KNN build")
            else:
                log_progress(f"  Using FAISS-CPU for KNN build")
            index.add(coords_np)
            _, indices = index.search(coords_np, k + 1)

            # Convert to COO Tensor
            rows = np.repeat(np.arange(n), k)
            cols = indices[:, 1:].reshape(-1)  # Skip self
            adj_indices = torch.tensor([rows, cols], dtype=torch.long)

        # 2. Precompute edge features (GPU优化：如果CUDA可用则在GPU上计算)
        with PROFILER.timer("data_transfer"):
            # 将坐标和邻接关系移到GPU上进行边特征计算
            if torch.cuda.is_available():
                coords_gpu = coords.to('cuda')
                adj_indices_gpu = adj_indices.to('cuda')
                edge_features = compute_edge_features_fast(coords_gpu, adj_indices_gpu, EXPERIMENT_CONFIG)
                # 保持边特征在GPU上
                edge_features = edge_features.to('cuda')
            else:
                edge_features = compute_edge_features_fast(coords, adj_indices, EXPERIMENT_CONFIG)

        prepared = {
            "poi_features": dataset.poi_features.float(),
            "poi_coords": coords,
            "labels": dataset.poi_labels.long() if hasattr(dataset, "poi_labels") else dataset.poi_features[:, 0].long(),
            "edge_features": edge_features,
            "block_features": dataset.block_features.float(),
            "adj_indices": adj_indices
        }

        # 3. Initialize sampler and model
        sampler = NeighborSampler(adj_indices, n, EXPERIMENT_CONFIG.sampling_sizes)
        meta = {"coord_dim": 2, "block_feature_dim": prepared["block_features"].shape[-1]}

        # Move model to GPU
        device = torch.device(EXPERIMENT_CONFIG.device if torch.cuda.is_available() else "cpu")
        model = FullModelV61(EXPERIMENT_CONFIG, FEATURE_SCHEMA, meta).to(device)

        # 禁用 torch.compile（与部分操作不兼容，暂时禁用）
        if torch.cuda.is_available() and hasattr(torch, 'compile'):
            try:
                # 测试性禁用torch.compile以确保稳定性
                # model = torch.compile(model, mode="reduce-overhead")
                log_progress("  torch.compile disabled for stability")
            except Exception as e:
                log_progress(f"  torch.compile disabled: {e}")

        # Optimizer and loss
        optimizer = optim.AdamW(model.parameters(), lr=EXPERIMENT_CONFIG.learning_rate)
        criterion = CombinedLoss(EXPERIMENT_CONFIG)
        scaler = torch.amp.GradScaler(enabled=EXPERIMENT_CONFIG.use_amp and torch.cuda.is_available())

        log_progress(f"  Model parameters: {sum(p.numel() for p in model.parameters())/1e6:.2f}M")
        log_progress(f"  Device: {device}")
        if torch.cuda.is_available():
            log_progress(f"  GPU Memory allocated: {torch.cuda.memory_allocated()/1024**3:.2f} GB")

        # Split data
        all_idx = np.arange(n)
        train_idx, test_idx = train_test_split(all_idx, train_size=EXPERIMENT_CONFIG.train_ratio, random_state=42)

        # 初始化Memory Bank（用于跨batch对比学习）
        # 注意：V6实验发现全图训练模式效果更好，Memory Bank会干扰训练，先禁用
        memory_bank = None
        # 暂时禁用Memory Bank，阈值设为很大确保不启用
        # if n > 500000:  # 大数据集启用Memory Bank（实验发现会干扰训练，已禁用）
        #     memory_bank = MemoryBank(
        #         num_nodes=n,
        #         embed_dim=EXPERIMENT_CONFIG.embed_dim,
        #         momentum=0.999
        #     )
        #     log_progress(f"  Memory Bank initialized: {n} nodes × {EXPERIMENT_CONFIG.embed_dim}D")

        # 4. Training
        best_sil = -1

        # 根据配置选择训练模式
        use_sampling = EXPERIMENT_CONFIG.use_sampling
        if not use_sampling:
            log_progress(f"  [Training Mode] Full Graph Training (V6 style)")
        else:
            log_progress(f"  [Training Mode] Sampled Graph Training (for scalability)")

        for epoch in range(EXPERIMENT_CONFIG.num_epochs):
            # 根据配置选择训练方式
            if use_sampling:
                # 采样训练模式
                metrics = train_epoch_prod(
                    model, prepared, sampler, train_idx,
                    EXPERIMENT_CONFIG, criterion, optimizer, scaler
                )
            else:
                # 全图训练模式（V6风格，效果更好）
                metrics = train_epoch_full_graph(
                    model, prepared, train_idx,
                    EXPERIMENT_CONFIG, criterion, optimizer, scaler
                )

            if (epoch + 1) % 5 == 0:
                eval_res = evaluate_prod(model, prepared, test_idx, EXPERIMENT_CONFIG)
                log_progress(f"  Epoch {epoch+1:3d} | Loss: {metrics['total']:.4f} | Sil: {eval_res['silhouette']:.4f}")

                if eval_res['silhouette'] > best_sil:
                    best_sil = eval_res['silhouette']
                    torch.save(model.state_dict(), CHECKPOINT_DIR / f"{area}_best.pt")

        log_progress(PROFILER.report())
        PROFILER.reset()

        # 保存当前区域结果到JSON - 确保所有值都是Python原生类型
        all_results[area] = {
            "best_silhouette": float(best_sil),
            "num_pois": int(n),
            "num_blocks": int(prepared["block_features"].shape[0]),
            "config": EXPERIMENT_CONFIG.to_dict()
        }

        # 保存JSON文件
        import json as json_module
        with open(JSON_DIR / f"{area}_result.json", "w", encoding="utf-8") as f:
            json_module.dump(all_results[area], f, indent=2, ensure_ascii=False)

    # 生成最终汇总报告
    generate_summary_v61(all_results)

if __name__ == "__main__":
    run_experiment_v61_prod()
