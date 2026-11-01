"""Large language model port."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol, runtime_checkable

from app.ports.types import ChatMessage, ChatResult


@runtime_checkable
class LLMProvider(Protocol):
    """Chat completion backend (DeepSeek, OpenAI-compatible, Huawei, ...)."""

    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> ChatResult:
        """Return a full completion for ``messages``."""
        ...

    def stream(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> Iterator[str]:
        """Yield text deltas as they are produced."""
        ...
