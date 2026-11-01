"""Select an embedding backend from ``EMBEDDING_PROVIDER``."""

from __future__ import annotations

from app.adapters.embedding.local import LocalFlagEmbedding
from app.adapters.embedding.mock import DeterministicEmbedding
from app.adapters.embedding.openai_compatible import OpenAICompatibleEmbedding
from app.config import Settings, get_settings
from app.ports import EmbeddingProvider
from app.ports.errors import ProviderError


def build_embedding(settings: Settings | None = None) -> EmbeddingProvider:
    """Return the embedding adapter configured by ``settings``."""
    resolved = settings or get_settings()
    provider = (resolved.embedding_provider or "").strip().lower()
    if provider == "openai_compatible":
        return OpenAICompatibleEmbedding(resolved)
    if provider == "local":
        return LocalFlagEmbedding(resolved)
    if provider in {"mock", "offline", "hash"}:
        return DeterministicEmbedding(resolved)
    raise ProviderError(f"unsupported embedding provider: {provider}")
