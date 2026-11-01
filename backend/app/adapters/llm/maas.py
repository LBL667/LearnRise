"""Huawei Cloud ModelArts MaaS preset.

MaaS speaks the OpenAI-compatible wire format, so this is a thin preset that
only pins the default endpoint and model id. Everything else (retries, error
mapping, streaming) is inherited unchanged.
"""

from __future__ import annotations

from app.adapters.llm.openai_compatible import OpenAICompatibleLLM

DEFAULT_BASE_URL = "https://api.modelarts-maas.com/openai/v1"
DEFAULT_MODEL = "deepseek-v4.1-flash"


class MaasLLM(OpenAICompatibleLLM):
    """ModelArts MaaS chat backend using ``deepseek-v4.1-flash`` by default."""

    def __init__(
        self,
        api_key: str,
        model: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 60.0,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> None:
        super().__init__(
            base_url or DEFAULT_BASE_URL,
            api_key,
            model or DEFAULT_MODEL,
            timeout=timeout,
            temperature=temperature,
            max_tokens=max_tokens,
        )
