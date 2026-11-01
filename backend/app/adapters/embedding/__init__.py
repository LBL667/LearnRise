"""Embedding adapters: remote OpenAI-compatible client and optional local BGE."""

from __future__ import annotations

from app.adapters.embedding.factory import build_embedding
from app.adapters.embedding.local import LocalFlagEmbedding
from app.adapters.embedding.mock import MODEL_NAME as MOCK_EMBEDDING_MODEL
from app.adapters.embedding.mock import DeterministicEmbedding
from app.adapters.embedding.openai_compatible import MAX_CHARS, OpenAICompatibleEmbedding

__all__ = [
    "MAX_CHARS",
    "MOCK_EMBEDDING_MODEL",
    "DeterministicEmbedding",
    "LocalFlagEmbedding",
    "OpenAICompatibleEmbedding",
    "build_embedding",
]
