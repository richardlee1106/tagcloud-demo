"""Python gRPC entrypoint for spatial compute."""

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
from grpc_health.v1 import health_pb2
from grpc_health.v1 import health_pb2_grpc

from pipeline.spatial_pipeline import SpatialPipeline
from services.spatial_search import get_spatial_search_service
from services.llm_service import get_llm_service

BASE_DIR = Path(__file__).resolve().parent
PROTO_DIR = BASE_DIR.parent / "proto"
PROTO_FILE = PROTO_DIR / "spatial_compute.proto"
GENERATED_DIR = BASE_DIR / "generated"


def ensure_proto_generated() -> None:
    """Generate Python gRPC stubs when missing or stale."""
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    pb2_file = GENERATED_DIR / "spatial_compute_pb2.py"
    pb2_grpc_file = GENERATED_DIR / "spatial_compute_pb2_grpc.py"

    if pb2_file.exists() and pb2_grpc_file.exists():
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


def _configure_stdio_utf8() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


_configure_stdio_utf8()


class SpatialComputeService(spatial_compute_pb2_grpc.SpatialComputeServiceServicer):
    """Spatial compute gRPC service implementation."""

    def __init__(self) -> None:
        self.pipeline = SpatialPipeline()

    def ComputeSpatial(self, request, context):  # noqa: N802
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

        print(
            json.dumps(
                {
                    "ts": int(time.time() * 1000),
                    "level": "info",
                    "event": "grpc_compute_start",
                    "trace_id": request.request_id,
                    "query_type": request.query_type,
                    "mode": request.mode,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

        try:
            for event in self.pipeline.run(request_payload):
                event_type = EVENT_TYPE_MAP.get(
                    str(event.get("type", "")).upper(),
                    spatial_compute_pb2.EVENT_TYPE_UNSPECIFIED,
                )
                payload = json.dumps(event.get("payload", {}), ensure_ascii=False)
                yield spatial_compute_pb2.ComputeEvent(
                    type=event_type,
                    payload=payload,
                    ts=int(time.time() * 1000),
                )

            print(
                json.dumps(
                    {
                        "ts": int(time.time() * 1000),
                        "level": "info",
                        "event": "grpc_compute_complete",
                        "trace_id": request.request_id,
                        "query_type": request.query_type,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        except Exception as exc:  # pragma: no cover - runtime guard
            error_message = str(exc)
            error_code = getattr(exc, "code", None) or getattr(exc, "error_code", None)
            if not error_code:
                error_code = error_message if error_message.startswith("model_parallel_failed:") else "pipeline_error"

            diagnostics = getattr(exc, "parallel_error_context", None)
            if not isinstance(diagnostics, dict):
                diagnostics = {}
            if error_code and not diagnostics.get("error_code"):
                diagnostics["error_code"] = str(error_code)

            print(
                json.dumps(
                    {
                        "ts": int(time.time() * 1000),
                        "level": "error",
                        "event": "grpc_compute_error",
                        "trace_id": request.request_id,
                        "query_type": request.query_type,
                        "error": error_message,
                        "code": str(error_code),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )

            payload = {"message": error_message, "code": str(error_code)}
            if diagnostics:
                payload["diagnostics"] = diagnostics
            yield spatial_compute_pb2.ComputeEvent(
                type=spatial_compute_pb2.ERROR,
                payload=json.dumps(payload, ensure_ascii=False),
                ts=int(time.time() * 1000),
            )


class HealthServicer(health_pb2_grpc.HealthServicer):
    """gRPC health servicer."""

    def __init__(self) -> None:
        self._is_serving = True
        self._pipeline = None

    def _check_pipeline_health(self) -> bool:
        try:
            if self._pipeline is None:
                self._pipeline = SpatialPipeline()

            if hasattr(self._pipeline, "repository") and self._pipeline.repository:
                conn = self._pipeline.repository.get_connection()
                if conn and not conn.closed:
                    return True
            return True
        except Exception as exc:
            print(f"[HealthServicer] Pipeline health check failed: {exc}", flush=True)
            return False

    def Check(self, request, context):  # noqa: N802
        if self._is_serving and self._check_pipeline_health():
            return health_pb2.HealthCheckResponse(status=health_pb2.HealthCheckResponse.SERVING)
        return health_pb2.HealthCheckResponse(status=health_pb2.HealthCheckResponse.NOT_SERVING)

    def Watch(self, request, context):  # noqa: N802
        while context.is_active():
            if self._is_serving and self._check_pipeline_health():
                status = health_pb2.HealthCheckResponse.SERVING
            else:
                status = health_pb2.HealthCheckResponse.NOT_SERVING
            yield health_pb2.HealthCheckResponse(status=status)
            time.sleep(1)


class SpatialSearchServicer(spatial_compute_pb2_grpc.SpatialComputeServiceServicer):
    """空间检索 gRPC 服务"""

    def __init__(self) -> None:
        self._service = None

    def _get_service(self):
        """懒加载空间检索服务"""
        if self._service is None:
            self._service = get_spatial_search_service()
        return self._service

    def SpatialSearch(self, request, context):  # noqa: N802
        """处理空间检索请求"""
        import time

        start_time = time.time()
        service = self._get_service()

        try:
            # 解析请求
            anchor = (request.anchor_lon, request.anchor_lat)
            radius = float(request.radius) if request.radius > 0 else 1000.0
            query_embedding = list(request.query_embedding) if request.query_embedding else None
            categories = list(request.categories) if request.categories else None
            target_region = request.target_region if request.target_region >= 0 else None
            region_filter_mode = request.region_filter_mode or "boost"
            top_k = request.top_k if request.top_k > 0 else 20

            # 执行检索
            results = service.search(
                anchor=anchor,
                radius=radius,
                query_embedding=query_embedding,
                categories=categories,
                target_region=target_region,
                region_filter_mode=region_filter_mode,
                top_k=top_k,
                spatial_weight=request.spatial_weight if request.spatial_weight > 0 else 0.6,
                semantic_weight=request.semantic_weight if request.semantic_weight > 0 else 0.4,
                region_weight=request.region_weight if request.region_weight > 0 else 0.15,
            )

            # 构建响应
            duration_ms = int((time.time() - start_time) * 1000)

            response = spatial_compute_pb2.SpatialSearchResponse(
                success=True,
                error="",
                total_count=len(results),
                duration_ms=duration_ms,
            )

            for r in results:
                response.results.append(spatial_compute_pb2.SpatialSearchResult(
                    id=r.id,
                    name=r.name,
                    category=r.category,
                    region_label=r.region_label,
                    lon=r.lon,
                    lat=r.lat,
                    distance_m=r.distance_m,
                    semantic_score=r.semantic_score,
                    fused_score=r.fused_score,
                ))

            print(
                json.dumps({
                    "ts": int(time.time() * 1000),
                    "level": "info",
                    "event": "spatial_search_complete",
                    "anchor": f"{anchor[0]:.4f},{anchor[1]:.4f}",
                    "radius": radius,
                    "categories": categories,
                    "results": len(results),
                    "duration_ms": duration_ms,
                }, ensure_ascii=False),
                flush=True
            )

            return response

        except Exception as exc:
            duration_ms = int((time.time() - start_time) * 1000)
            error_message = str(exc)

            print(
                json.dumps({
                    "ts": int(time.time() * 1000),
                    "level": "error",
                    "event": "spatial_search_error",
                    "error": error_message,
                    "duration_ms": duration_ms,
                }, ensure_ascii=False),
                flush=True
            )

            return spatial_compute_pb2.SpatialSearchResponse(
                success=False,
                error=error_message,
                total_count=0,
                duration_ms=duration_ms,
                results=[],
            )


def serve() -> None:
    host = os.getenv("SPATIAL_GRPC_HOST", "0.0.0.0")
    port = int(os.getenv("SPATIAL_GRPC_PORT", "50051"))
    workers = int(os.getenv("SPATIAL_GRPC_WORKERS", "4"))

    # gRPC 服务端 keepalive 配置
    # 解决 Node 客户端因 excess pings 被拒导致的 RESOURCE_EXHAUSTED 错误
    server_options = [
        # 允许客户端在无活跃 RPC 时发送 keepalive ping
        ("grpc.keepalive_permit_without_calls", 1),
        # 客户端 ping 最小间隔（10秒），低于此间隔的 ping 会被拒绝。必须使用 _ms 后缀。
        ("grpc.http2.min_ping_interval_without_data_ms", 10000),
        # 允许服务端在无数据时接受 ping（0表示无限制）
        ("grpc.http2.max_pings_without_data", 0),
        # 最大接收/发送消息大小（50MB）
        ("grpc.max_receive_message_length", 50 * 1024 * 1024),
        ("grpc.max_send_message_length", 50 * 1024 * 1024),
    ]

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=workers),
        options=server_options,
    )
    spatial_compute_pb2_grpc.add_SpatialComputeServiceServicer_to_server(SpatialComputeService(), server)
    spatial_compute_pb2_grpc.add_SpatialComputeServiceServicer_to_server(SpatialSearchServicer(), server)
    health_pb2_grpc.add_HealthServicer_to_server(HealthServicer(), server)
    server.add_insecure_port(f"{host}:{port}")
    server.start()

    print(f"[python_service] gRPC server listening on {host}:{port}")
    print(f"[python_service] Health check available at {host}:{port}")
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
