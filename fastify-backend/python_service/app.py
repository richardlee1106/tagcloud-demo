"""Python 计算侧车服务（HTTP）。

用途：
1) 提供健康检查，方便容器编排探活。
2) 提供极简运行指标，辅助排障。

说明：
- 真正的空间计算通过 gRPC (`grpc_server.py`) 提供。
- 这里保持轻量，避免引入额外业务依赖。
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from flask import Flask, jsonify

STARTED_AT = time.time()
REQUEST_COUNTER = {
    "health": 0,
    "metrics": 0,
}

app = Flask(__name__)


@app.get("/health")
def health() -> tuple[str, int]:
    """健康探针。"""
    REQUEST_COUNTER["health"] += 1
    return jsonify(
        {
            "status": "ok",
            "service": "python-compute",
            "time": datetime.now(timezone.utc).isoformat(),
            "grpc_port": int(os.getenv("SPATIAL_GRPC_PORT", "50051")),
        }
    ), 200


@app.get("/metrics")
def metrics() -> tuple[str, int]:
    """简版运行指标。"""
    REQUEST_COUNTER["metrics"] += 1
    uptime = max(0.0, time.time() - STARTED_AT)
    return jsonify(
        {
            "uptime_seconds": round(uptime, 3),
            "requests": REQUEST_COUNTER,
        }
    ), 200


if __name__ == "__main__":
    host = os.getenv("SPATIAL_HTTP_HOST", "0.0.0.0")
    port = int(os.getenv("SPATIAL_HTTP_PORT", "8081"))
    app.run(host=host, port=port, debug=False)
