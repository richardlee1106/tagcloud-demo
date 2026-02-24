# -*- coding: utf-8 -*-
"""测试 VLM 地图文字提取 - 多种格式尝试"""

import base64
import json
import urllib.request
import urllib.error
import sys

# 读取图片并转为 base64
image_path = "test_map.png"  # 请替换为实际图片路径

try:
    with open(image_path, "rb") as f:
        image_data = f.read()
        print(f"图片大小: {len(image_data)} bytes")

        # 尝试不同的 base64 编码方式
        base64_image = base64.b64encode(image_data).decode("utf-8")
        # 方式1: 不带 data URL 前缀
        # 方式2: 带 data URL 前缀
        data_url_jpeg = f"data:image/jpeg;base64,{base64_image}"
        data_url_png = f"data:image/png;base64,{base64_image}"
except FileNotFoundError:
    print(f"图片文件不存在: {image_path}")
    print("请将图片保存为 test_map.png 然后重新运行")
    exit(1)

# 测试不同的端点和格式
endpoints = [
    "http://localhost:1234/v1/chat/completions",
    "http://localhost:1234/v1/chat/completions",  # 可能需要不同的模型名
]

models = [
    "qwen/qwen3-vl-4b",
    "qwen3-vl-4b",
    "qwen3-vl-4b-instruct",
]

def test_vlm(model, endpoint, image_url):
    prompt_text = """你是一个地图阅读助手。请仔细观察提供的地图截图，
提取地图上标注的**所有重要地名、标志物名称、学院名、建筑物名或机构名**。
必须严格以JSON数组的格式输出，例如：["A学院", "B大楼", "C路"]。
不要输出任何其他解释性文字。"""

    payload = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": 500,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            },
        ],
    }

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8", errors="ignore")
            return True, raw
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="ignore")
        return False, f"HTTP {e.code}: {error_body}"
    except Exception as e:
        return False, f"错误: {e}"

# 测试不同的组合
print("\n=== 测试不同的模型和格式 ===\n")

# 先检查 LM Studio 是否可用
try:
    req = urllib.request.Request("http://localhost:1234/v1/models")
    with urllib.request.urlopen(req, timeout=5) as resp:
        models_list = json.loads(resp.read().decode("utf-8"))
        print("LM Studio 可用的模型:")
        for m in models_list.get("data", []):
            print(f"  - {m.get('id')}")
except Exception as e:
    print(f"无法连接到 LM Studio: {e}")

# 测试不同格式
test_cases = [
    ("qwen/qwen3-vl-4b", data_url_jpeg),
    ("qwen/qwen3-vl-4b", data_url_png),
    ("qwen3-vl-4b", data_url_jpeg),
]

for model, img_url in test_cases:
    print(f"\n测试: model={model}")
    success, result = test_vlm(model, "http://localhost:1234/v1/chat/completions", img_url)
    if success:
        print("成功!")
        print(result)
        break
    else:
        print(f"失败: {result[:200]}...")
