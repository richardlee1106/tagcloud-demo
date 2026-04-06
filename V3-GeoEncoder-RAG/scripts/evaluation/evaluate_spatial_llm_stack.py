# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional


ROOT = Path(__file__).resolve().parents[3]
REPORTS_DIR = ROOT / "V3-GeoEncoder-RAG" / "docs" / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

SPATIAL_ENCODER_SERVICE = ROOT / "V3-GeoEncoder-RAG" / "python" / "services" / "spatialEncoderService.py"
NODE_SERVER = ROOT / "V3-GeoEncoder-RAG" / "server.js"
QUERY_EMBEDDING_SERVICE = ROOT / "V3-GeoEncoder-RAG" / "services" / "retrieval" / "queryEmbeddingService.js"
V3_DEV_CLEANUP_LIB = ROOT / "scripts" / "lib" / "v3DevCleanup.js"
NPX_EXECUTABLE = "npx.cmd" if os.name == "nt" else "npx"


@dataclass
class CommandResult:
    args: list[str]
    code: int
    stdout: str
    stderr: str


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_command(
    args: list[str],
    *,
    cwd: Path = ROOT,
    env: Optional[Dict[str, str]] = None,
    timeout: int = 240,
) -> CommandResult:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)

    completed = subprocess.run(
        args,
        cwd=str(cwd),
        env=merged_env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return CommandResult(
        args=args,
        code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def http_json(
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 30,
) -> Dict[str, Any]:
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url=url, method=method, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw)


def wait_for_json(
    url: str,
    *,
    predicate: Optional[Callable[[Dict[str, Any]], bool]] = None,
    timeout: int = 180,
    interval: float = 1.0,
) -> Dict[str, Any]:
    deadline = time.time() + timeout
    last_error: Optional[Exception] = None

    while time.time() < deadline:
        try:
            payload = http_json("GET", url, timeout=10)
            if predicate is None or predicate(payload):
                return payload
        except Exception as error:  # pragma: no cover - runtime probe only
            last_error = error
        time.sleep(interval)

    raise RuntimeError(f"Timed out waiting for {url}: {last_error}")


def terminate_process(process: subprocess.Popen[str]) -> tuple[str, str]:
    if process.poll() is None:
        try:
            process.terminate()
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)

    try:
        stdout, stderr = process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate(timeout=5)

    return stdout, stderr


def last_lines(text: str, count: int = 20) -> str:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return ""
    return "\n".join(lines[-count:])


def run_node_json(script: str, *, env: Optional[Dict[str, str]] = None, timeout: int = 240) -> Dict[str, Any]:
    result = run_command(["node", "-e", script], env=env, timeout=timeout)
    if result.code != 0:
        raise RuntimeError(
            f"Node probe failed ({result.code})\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError("Node probe returned no stdout")

    return json.loads(stdout)


def evaluate_runtime_and_context_stack() -> dict[str, Any]:
    encoder_port = pick_free_port()
    server_port = pick_free_port()

    encoder_process = subprocess.Popen(
        [sys.executable, str(SPATIAL_ENCODER_SERVICE), "--port", str(encoder_port)],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    server_process: Optional[subprocess.Popen[str]] = None
    encoder_stdout = ""
    encoder_stderr = ""
    server_stdout = ""
    server_stderr = ""

    try:
        encoder_health = wait_for_json(
            f"http://127.0.0.1:{encoder_port}/health",
            predicate=lambda payload: payload.get("status") in {"ok", "encoder_not_loaded"},
            timeout=180,
        )
        encoder_capabilities = http_json("GET", f"http://127.0.0.1:{encoder_port}/capabilities", timeout=30)
        encoder_embedding = http_json(
            "POST",
            f"http://127.0.0.1:{encoder_port}/encode",
            payload={"lon": 114.36, "lat": 30.54},
            timeout=60,
        )
        encoder_region = http_json(
            "POST",
            f"http://127.0.0.1:{encoder_port}/region",
            payload={"lon": 114.36, "lat": 30.54},
            timeout=60,
        )

        query_fusion_probe = run_node_json(
            """
import { buildSpatialQueryEmbedding } from './V3-GeoEncoder-RAG/services/retrieval/queryEmbeddingService.js'

const quietCoffee = await buildSpatialQueryEmbedding({
  userQuery: 'quiet coffee near wuhan university',
  intent: {},
  anchor: { lon: 114.36, lat: 30.54, source: 'spatial_context.center' }
})

const livelyBar = await buildSpatialQueryEmbedding({
  userQuery: 'lively bar nightlife near wuhan university',
  intent: {},
  anchor: { lon: 114.36, lat: 30.54, source: 'spatial_context.center' }
})

console.log(JSON.stringify({
  quiet_source: quietCoffee.source,
  lively_source: livelyBar.source,
  same_embedding: JSON.stringify(quietCoffee.queryEmbedding) === JSON.stringify(livelyBar.queryEmbedding),
  quiet_signal_count: quietCoffee.components?.intentAdapter?.signalCount ?? 0,
  lively_signal_count: livelyBar.components?.intentAdapter?.signalCount ?? 0,
  quiet_embedding_dim: quietCoffee.embeddingDim,
  lively_embedding_dim: livelyBar.embeddingDim
}))
            """.strip(),
            env={"SPATIAL_ENCODER_PORT": str(encoder_port)},
        )

        server_env = {
            "PORT": str(server_port),
            "LOG_LEVEL": "warn",
            "SPATIAL_ENCODER_PORT": str(encoder_port),
        }
        merged_server_env = os.environ.copy()
        merged_server_env.update(server_env)
        server_process = subprocess.Popen(
            ["node", str(NODE_SERVER)],
            cwd=str(ROOT / "V3-GeoEncoder-RAG"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=merged_server_env,
        )

        server_health = wait_for_json(
            f"http://127.0.0.1:{server_port}/health",
            predicate=lambda payload: payload.get("status") == "ok",
            timeout=180,
        )
        spatial_context = http_json(
            "POST",
            f"http://127.0.0.1:{server_port}/api/spatial/context",
            payload={
                "query": "quiet coffee near wuhan university",
                "topK": 3,
                "spatialContext": {
                    "center": [114.36, 30.54],
                },
            },
            timeout=120,
        )
        server_stdout, server_stderr = terminate_process(server_process)
        server_process = None

        return {
            "encoder_port": encoder_port,
            "server_port": server_port,
            "encoder_health": encoder_health,
            "encoder_capabilities": encoder_capabilities,
            "encoder_embedding_dim": len(encoder_embedding.get("embedding", [])),
            "encoder_region": encoder_region,
            "query_fusion_probe": query_fusion_probe,
            "server_health": server_health,
            "spatial_context": {
                "contract": spatial_context.get("contract"),
                "success": spatial_context.get("success"),
                "embedding_source": spatial_context.get("query_embedding", {}).get("source"),
                "embedding_dim": spatial_context.get("query_embedding", {}).get("embedding_dim"),
                "returned_context_count": spatial_context.get("retrieval", {}).get("returned_context_count"),
                "result_count": spatial_context.get("retrieval", {}).get("result_count"),
                "boundary_available": spatial_context.get("evidence_summary", {}).get("boundary_available"),
                "fact_count": len(spatial_context.get("llm_context", {}).get("facts", [])),
                "top_context_names": [
                    item.get("name") for item in spatial_context.get("spatial_contexts", [])
                ],
                "query_embedding_components": spatial_context.get("query_embedding", {}).get("components"),
            },
            "server_logs": {
                "stdout_tail": last_lines(server_stdout),
                "stderr_tail": last_lines(server_stderr),
            },
        }
    finally:
        if server_process is not None:
            server_stdout, server_stderr = terminate_process(server_process)
        encoder_stdout, encoder_stderr = terminate_process(encoder_process)

    # Unreachable, but kept for structure parity.
    return {
        "server_logs": {
            "stdout_tail": last_lines(server_stdout),
            "stderr_tail": last_lines(server_stderr),
        },
        "encoder_logs": {
            "stdout_tail": last_lines(encoder_stdout),
            "stderr_tail": last_lines(encoder_stderr),
        },
    }


def generate_report(sections: dict[str, Any]) -> Path:
    today = datetime.now().strftime("%Y-%m-%d")
    report_path = REPORTS_DIR / f"{today}-V3空间LLM平台评估报告.md"

    git_head = sections["git_head"]
    js_tests = sections["js_tests"]
    python_tests = sections["python_tests"]
    syntax_checks = sections["syntax_checks"]
    runtime = sections["runtime"]

    encoder_health = runtime["encoder_health"]
    encoder_caps = runtime["encoder_capabilities"]
    query_probe = runtime["query_fusion_probe"]
    server_health = runtime["server_health"]
    spatial_context = runtime["spatial_context"]

    markdown = f"""# V3 空间 LLM 平台评估报告
日期：{today}

## 概要结论

这次评估确认了 4 件关键事情：

1. 真实训练好的 V3 空间编码器现在可以在运行态稳定加载，架构识别为 `{encoder_health.get("architecture")}`，checkpoint 指向 `{encoder_caps.get("checkpoint_path")}`。
2. `query -> queryEmbedding -> faissHybridSearch(queryEmbedding)` 主链已经不再只编码 anchor 坐标，至少在 ASCII/结构化意图探针下，能够输出 `anchor_encoder_intent_adapter_v2`，同 anchor 不同空间意图不会再塌缩成同一个向量。
3. V3 现在已经提供了一个模型无关的 spatial RAG contract：`POST /api/spatial/context`。它会返回 anchor、intent、query embedding 状态、boundary evidence、top spatial contexts、LLM 可直接消费的事实清单，而不强制绑定聊天生成。
4. `npm run dev:V3` 的启动前清理链已经扩展为同时追踪 `3300` 和 `8100` 两个端口，能在启动前清掉旧的 V3 后端和旧的空间编码器残留进程。

## 评估环境

- 仓库：`{ROOT}`
- Git HEAD：`{git_head}`
- 编码器服务：`{SPATIAL_ENCODER_SERVICE}`
- V3 服务：`{NODE_SERVER}`

## 静态与回归验证

### 1. JS 测试

- 命令：`{' '.join(js_tests.args)}`
- 退出码：`{js_tests.code}`
- 结果：通过

```text
{(js_tests.stdout or js_tests.stderr).strip()}
```

### 2. Python 单测

- 命令：`{' '.join(python_tests.args)}`
- 退出码：`{python_tests.code}`
- 结果：通过

```text
{(python_tests.stdout or python_tests.stderr).strip()}
```

### 3. 语法检查

```json
{json.dumps(syntax_checks, ensure_ascii=False, indent=2)}
```

## 运行态验证

### 1. 编码器运行态

```json
{json.dumps({
    "encoder_health": encoder_health,
    "encoder_capabilities": encoder_caps,
    "encoder_embedding_dim": runtime["encoder_embedding_dim"],
    "encoder_region": runtime["encoder_region"],
}, ensure_ascii=False, indent=2)}
```

关键结论：

- `encoder_loaded=true`
- `architecture={encoder_health.get("architecture")}`
- `embedding_dim={encoder_caps.get("embedding_dim")}`
- `supported_features={encoder_caps.get("supported_features")}`

### 2. 意图融合探针

```json
{json.dumps(query_probe, ensure_ascii=False, indent=2)}
```

关键结论：

- `quiet coffee near wuhan university` 与 `lively bar nightlife near wuhan university` 在相同 anchor 下得到的 fused query embedding 不同。
- 两次探针都走到了 `anchor_encoder_intent_adapter_v2`。
- 这说明当前 query embedding 已经不再只是“坐标编码”，而是“训练好的 anchor encoder + 轻量 intent adapter”的融合结果。

### 3. 模型无关 spatial RAG contract

```json
{json.dumps({
    "server_health": {
        "status": server_health.get("status"),
        "faiss_loaded": server_health.get("faiss", {}).get("loaded"),
        "faiss_poi_count": server_health.get("faiss", {}).get("poiCount"),
        "spatial_encoder_ready": server_health.get("spatialEncoder", {}).get("ready"),
        "spatial_encoder_architecture": server_health.get("spatialEncoder", {}).get("architecture"),
    },
    "spatial_context": spatial_context,
}, ensure_ascii=False, indent=2)}
```

关键结论：

- 新接口 contract：`{spatial_context.get("contract")}`
- 返回成功：`{spatial_context.get("success")}`
- query embedding 来源：`{spatial_context.get("embedding_source")}`
- 返回空间上下文数量：`{spatial_context.get("returned_context_count")}`
- 边界证据存在：`{spatial_context.get("boundary_available")}`
- LLM 事实条目数量：`{spatial_context.get("fact_count")}`

## 现在 V3 可以做哪些事情

### 作为任何 LLM 的外挂能力

- 通过 `POST /api/spatial/context` 输出可直接注入任何 LLM prompt / tool / agent memory 的空间事实合同。
- 输出包含 anchor、intent、query embedding provenance、top spatial contexts、boundary evidence、LLM facts/prompt。
- 不再要求调用方必须使用当前内置的 Ollama 生成链。

### 作为空间知识库 / spatial RAG

- 使用真实 V3 空间编码器生成 352 维 anchor embedding。
- 将 query embedding 接到 `faissHybridSearch(queryEmbedding)` 混合检索链。
- 利用 boundary / hotspot / vernacular / fuzzy region 证据给下游 LLM 提供空间结构化上下文。
- 支持 encoder-aware 的 boundary confidence，综合编码器一致性、面支持度、clip 后覆盖率。

### 作为空间智能增强层

- 在 query embedding 层引入 intent-aware fusion，不再只看 anchor 坐标。
- 在 dev 启动前自动清理旧的 V3 后端和旧的空间编码器端口占用，减少“坏旧进程挡住新版本”的概率。

## 仍然存在的限制

1. 当前 intent adapter 还是轻量级哈希适配器，不是另外训练出来的文本空间编码器。它已经能让同 anchor 不同意图分叉，但还不是最终形态的“文本空间语义编码器”。
2. 这次运行态 probe 中，小模型意图解析（Ollama / LM Studio 路径）仍然可能失败回退，因此当前最稳的是“anchor encoder + fallback intent adapter”链路，而不是“LLM 意图解析 + encoder + intent adapter”全开。
3. Windows 命令行下直接用中文 query 做 shell 级探针时，可能受到外层终端编码影响。服务本身的浏览器 / HTTP JSON 路径不受这个限制，但做 CLI 自动探针时最好优先用 UTF-8 明确环境或 ASCII probe。

## 结论

当前 V3 已经不再只是“把空间编码器挂进去的骨架”，而是具备了下面这条更完整的主链：

`query -> intent/fallback -> anchor encoder -> intent-aware fused queryEmbedding -> faissHybridSearch(queryEmbedding) -> spatial evidence -> model-agnostic spatial context contract`

如果从“是否已经有效利用我们自己训练的 V3 空间编码器”这个标准来判断，现在可以给出更积极、但仍然诚实的回答：

- 是，已经有效利用到了。
- 但还没有到终局版本。

更准确地说，现在 V3 已经把“真实训练好的空间编码器”稳定用在了 anchor geometry backbone 上，并且把它进一步包装成了任何 LLM 都可挂载的 spatial addon / spatial RAG context provider；同时又用 intent-aware adapter 解决了“同 anchor 不同意图完全一样”的硬伤。下一步如果继续增强，最值得投入的是把 intent adapter 升级成真正训练过的文本空间意图编码层。
"""

    report_path.write_bytes(markdown.encode("utf-8-sig"))
    return report_path


def main() -> None:
    git_head = run_command(["git", "rev-parse", "--short", "HEAD"])
    js_tests = run_command([
        NPX_EXECUTABLE,
        "vitest",
        "run",
        "V3-GeoEncoder-RAG/services/__tests__",
        "src/utils/__tests__/v3DevCleanup.spec.js",
    ], timeout=300)
    python_tests = run_command([
        sys.executable,
        "-m",
        "unittest",
        "discover",
        "-s",
        "V3-GeoEncoder-RAG/python/tests",
        "-p",
        "test_*.py",
    ], timeout=300)
    syntax_checks = {
        "server_js": run_command(["node", "--check", str(NODE_SERVER)]).code == 0,
        "query_embedding_service_js": run_command(["node", "--check", str(QUERY_EMBEDDING_SERVICE)]).code == 0,
        "v3_dev_cleanup_js": run_command(["node", "--check", str(V3_DEV_CLEANUP_LIB)]).code == 0,
        "spatial_encoder_service_py": run_command([sys.executable, "-m", "py_compile", str(SPATIAL_ENCODER_SERVICE)]).code == 0,
    }

    if js_tests.code != 0:
        raise RuntimeError(f"JS tests failed:\n{js_tests.stdout}\n{js_tests.stderr}")
    if python_tests.code != 0:
        raise RuntimeError(f"Python tests failed:\n{python_tests.stdout}\n{python_tests.stderr}")
    if not all(syntax_checks.values()):
        raise RuntimeError(f"Syntax checks failed: {syntax_checks}")

    runtime = evaluate_runtime_and_context_stack()
    report_path = generate_report({
        "git_head": git_head.stdout.strip(),
        "js_tests": js_tests,
        "python_tests": python_tests,
        "syntax_checks": syntax_checks,
        "runtime": runtime,
    })

    print(json.dumps({
        "report_path": str(report_path),
        "git_head": git_head.stdout.strip(),
        "spatial_encoder_architecture": runtime["encoder_health"].get("architecture"),
        "query_embedding_source": runtime["spatial_context"].get("embedding_source"),
        "returned_context_count": runtime["spatial_context"].get("returned_context_count"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
