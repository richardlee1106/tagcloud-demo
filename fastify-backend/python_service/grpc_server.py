"""Python gRPC 入口。

职责：
- 加载 proto 并暴露 `ComputeSpatial` 服务。
- 将请求转交给 `SpatialPipeline`，并把阶段事件流式返回给 Node。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from concurrent import futures
from pathlib import Path
from typing import Dict

import grpc

from pipeline.spatial_pipeline import SpatialPipeline

BASE_DIR = Path(__file__).resolve().parent
PROTO_DIR = BASE_DIR.parent / "proto"
PROTO_FILE = PROTO_DIR / "spatial_compute.proto"
GENERATED_DIR = BASE_DIR / "generated"


def ensure_proto_generated() -> None:
    """按需生成 Python gRPC stub，避免手动同步 proto 产物。"""
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    pb2_file = GENERATED_DIR / "spatial_compute_pb2.py"
    pb2_grpc_file = GENERATED_DIR / "spatial_compute_pb2_grpc.py"

    if pb2_file.exists() and pb2_grpc_file.exists():
        # Regenerate when proto changed, so Node/Python keep contract in sync.
        proto_mtime = PROTO_FILE.stat().st_mtime
        generated_mtime = min(pb2_file.stat().st_mtime, pb2_grpc_file.stat().st_mtime)
        if generated_mtime >= proto_mtime:
            return

    cmd = [
        sys.executable,
        "-m",
        "grpc_tools.protoc",
        f"-I{PROTO_DIR}",
        f"--python_out={GENERATED_DIR}",
        f"--grpc_python_out={GENERATED_DIR}",
        str(PROTO_FILE),
    ]
    subprocess.check_call(cmd)


ensure_proto_generated()
sys.path.insert(0, str(GENERATED_DIR))

import spatial_compute_pb2  # type: ignore  # noqa: E402
import spatial_compute_pb2_grpc  # type: ignore  # noqa: E402


EVENT_TYPE_MAP = {
    "STAGE": spatial_compute_pb2.STAGE,
    "PROGRESS": spatial_compute_pb2.PROGRESS,
    "PARTIAL": spatial_compute_pb2.PARTIAL,
    "FINAL": spatial_compute_pb2.FINAL,
    "ERROR": spatial_compute_pb2.ERROR,
}


class SpatialComputeService(spatial_compute_pb2_grpc.SpatialComputeServiceServicer):
    """gRPC 服务实现。"""

    def __init__(self) -> None:
        self.pipeline = SpatialPipeline()

    def ComputeSpatial(self, request, context):  # noqa: N802
        """处理一次流式空间计算请求。"""
        request_payload: Dict[str, object] = {
            "request_id": request.request_id,
            "query_type": request.query_type,
            "spatial_context": request.spatial_context,
            "categories": list(request.categories),
            "hints": request.hints,
            "mode": request.mode,
            "candidates_json": request.candidates_json,
            "execution_profile": request.execution_profile,
            "dry_run": request.dry_run,
        }

        try:
            for event in self.pipeline.run(request_payload):
                event_type = EVENT_TYPE_MAP.get(str(event.get("type", "")).upper(), spatial_compute_pb2.EVENT_TYPE_UNSPECIFIED)
                payload = json.dumps(event.get("payload", {}), ensure_ascii=False)
                yield spatial_compute_pb2.ComputeEvent(
                    type=event_type,
                    payload=payload,
                    ts=int(time.time() * 1000),
                )
        except Exception as exc:  # pragma: no cover - runtime guard
            # 出错时也返回 ERROR 事件，避免 Node 端只能拿到连接异常。
            yield spatial_compute_pb2.ComputeEvent(
                type=spatial_compute_pb2.ERROR,
                payload=json.dumps({"message": str(exc)}),
                ts=int(time.time() * 1000),
            )


def serve() -> None:
    """启动 gRPC 服务。"""
    host = os.getenv("SPATIAL_GRPC_HOST", "0.0.0.0")
    port = int(os.getenv("SPATIAL_GRPC_PORT", "50051"))
    workers = int(os.getenv("SPATIAL_GRPC_WORKERS", "4"))

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=workers))
    spatial_compute_pb2_grpc.add_SpatialComputeServiceServicer_to_server(SpatialComputeService(), server)
    server.add_insecure_port(f"{host}:{port}")
    server.start()

    print(f"[python_service] gRPC server listening on {host}:{port}")
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
