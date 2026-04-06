# -*- coding: utf-8 -*-
"""
LLM 服务模块

支持两种后端：
1. llama-cpp-python（本地推理，优先）
2. HTTP → LM Studio（远程推理，回退）

Author: Sisyphus
Date: 2026-03-21
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Generator, List, Optional

import httpx

# 尝试导入 llama-cpp-python
try:
    from llama_cpp import Llama
    LLAMA_CPP_AVAILABLE = True
except ImportError:
    LLAMA_CPP_AVAILABLE = False
    Llama = None


@dataclass
class LLMConfig:
    """LLM 配置"""
    base_url: str = os.getenv("LLM_BASE_URL", "http://localhost:1234/v1")
    model: str = os.getenv("LLM_MODEL", "qwen3.5-2b")
    embedding_model: str = os.getenv("LLM_EMBEDDING_MODEL", "text-embedding-nomic-embed-text-v1.5")
    temperature: float = 0.3
    max_tokens: int = 1024
    timeout: float = 60.0


class LLMService:
    """LLM 服务"""

    def __init__(self, config: Optional[LLMConfig] = None):
        self.config = config or LLMConfig()
        self._local_llm = None

        # 尝试加载本地模型
        if LLAMA_CPP_AVAILABLE:
            model_path = os.getenv("LLAMA_MODEL_PATH")
            if model_path and os.path.exists(model_path):
                self._local_llm = Llama(
                    model_path=model_path,
                    n_ctx=4096,
                    n_gpu_layers=-1,  # 全部 GPU
                    verbose=False,
                )
                print(f"[LLMService] Local model loaded: {model_path}")

    def is_local_available(self) -> bool:
        """检查本地模型是否可用"""
        return self._local_llm is not None

    def chat(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        聊天补全

        Args:
            prompt: 用户输入
            system_prompt: 系统提示
            temperature: 温度参数
            max_tokens: 最大 token 数

        Returns:
            模型回复
        """
        start_time = time.time()

        # 优先使用本地模型
        if self._local_llm:
            return self._chat_local(prompt, system_prompt, temperature, max_tokens)

        # 回退到 HTTP 调用
        return self._chat_http(prompt, system_prompt, temperature, max_tokens)

    def _chat_local(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        """本地推理"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = self._local_llm.create_chat_completion(
            messages=messages,
            temperature=temperature or self.config.temperature,
            max_tokens=max_tokens or self.config.max_tokens,
        )

        return response["choices"][0]["message"]["content"]

    def _chat_http(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        """HTTP 调用 LM Studio"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.config.model,
            "messages": messages,
            "temperature": temperature or self.config.temperature,
            "max_tokens": max_tokens or self.config.max_tokens,
        }

        with httpx.Client(timeout=self.config.timeout) as client:
            response = client.post(
                f"{self.config.base_url}/chat/completions",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        return data["choices"][0]["message"]["content"]

    def embed(self, text: str) -> List[float]:
        """
        生成 embedding

        Args:
            text: 输入文本

        Returns:
            Embedding 向量
        """
        # 优先使用本地模型
        if self._local_llm:
            embedding = self._local_llm.create_embedding(text)
            return embedding["data"][0]["embedding"]

        # 回退到 HTTP 调用
        payload = {
            "model": self.config.embedding_model,
            "input": text,
        }

        with httpx.Client(timeout=self.config.timeout) as client:
            response = client.post(
                f"{self.config.base_url}/embeddings",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        return data["data"][0]["embedding"]

    def parse_intent(self, query: str) -> Dict[str, Any]:
        """
        解析空间查询意图

        Args:
            query: 用户查询

        Returns:
            意图字典
        """
        system_prompt = """你是一个地理查询解析器，将用户的自然语言问题转换为结构化 JSON。

## 输出格式
{
  "place_name": "地名，如"武汉理工大学"，无则为 null",
  "gate": "门/入口，如"南门"，无则为 null",
  "radius_m": "距离范围（米），如 500，无则默认 500",
  "category": "POI 类别，如"咖啡馆""奶茶店""餐厅"",
  "region_type": "区域类型：居住/商业/工业/教育/公共/自然，无则为 null",
  "is_global_query": "是否为城市级查询（无特定地点），true/false"
}

## 规则
1. "武理工"→"武汉理工大学"，"华科"→"华中科技大学" 等常见别名需展开
2. "附近""周边""旁边" 默认 radius_m: 500
3. "武汉市有哪些景点" 是城市级查询，place_name 为 null，is_global_query: true
4. 只输出 JSON，不要其他解释"""

        try:
            response = self.chat(query, system_prompt=system_prompt)

            # 清理响应
            response = response.strip()
            if response.startswith("```"):
                response = response.split("```")[1]
                if response.startswith("json"):
                    response = response[4:]
            response = response.strip()

            return json.loads(response)
        except Exception as e:
            print(f"[LLMService] Intent parse failed: {e}")
            return {
                "place_name": None,
                "gate": None,
                "radius_m": 500,
                "category": None,
                "region_type": None,
                "is_global_query": False,
                "error": str(e),
            }

    def generate_answer(
        self,
        query: str,
        results: List[Dict[str, Any]],
        intent_desc: Optional[str] = None,
    ) -> str:
        """
        生成回答

        Args:
            query: 用户查询
            results: 检索结果
            intent_desc: 意图描述

        Returns:
            生成的回答
        """
        # 构建结果上下文
        context_lines = []
        for i, r in enumerate(results[:10]):
            name = r.get("name", "未知")
            category = r.get("category", "未分类")
            distance = r.get("distance_m", 0)
            context_lines.append(f"{i+1}. {name} [{category}] 距离{distance:.0f}m")

        context = "\n".join(context_lines)

        prompt = f"""用户问：{query}

根据以下搜索结果回答用户问题。要求：
1. 不要虚构不存在的地点
2. 使用简洁的列表格式展示结果
3. 每项包含：名称、类别、距离、简要推荐理由
4. 最后给出 1-2 句总结推荐

## 检索到的 POI 数据 (共 {len(results)} 条)
{context}

请给出简洁、友好的回答："""

        return self.chat(prompt, max_tokens=512)


# 全局实例
_llm_service: Optional[LLMService] = None


def get_llm_service() -> LLMService:
    """获取 LLM 服务单例"""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
