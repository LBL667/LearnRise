"""LLM adapters: OpenAI-compatible, ModelArts MaaS, mock, and the fallback chain."""

from __future__ import annotations

from app.adapters.llm.factory import build_llm
from app.adapters.llm.fallback import FallbackLLM
from app.adapters.llm.maas import DEFAULT_BASE_URL as MAAS_DEFAULT_BASE_URL
from app.adapters.llm.maas import DEFAULT_MODEL as MAAS_DEFAULT_MODEL
from app.adapters.llm.maas import MaasLLM
from app.adapters.llm.mock import MODEL_NAME as MOCK_MODEL_NAME
from app.adapters.llm.mock import MockLLM
from app.adapters.llm.openai_compatible import OpenAICompatibleLLM

__all__ = [
    "MAAS_DEFAULT_BASE_URL",
    "MAAS_DEFAULT_MODEL",
    "MOCK_MODEL_NAME",
    "FallbackLLM",
    "MaasLLM",
    "MockLLM",
    "OpenAICompatibleLLM",
    "build_llm",
]
