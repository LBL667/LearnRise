"""Text embedding port."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.ports.types import EmbeddingResult


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Batch text embedding backend."""

    def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        """Embed ``texts`` and return one vector per input, in order."""
        ...
