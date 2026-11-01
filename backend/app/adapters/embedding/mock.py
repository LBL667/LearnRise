"""Deterministic offline embedding backend for the demo profile.

``EMBEDDING_PROVIDER=mock`` returns fixed-dimension vectors built from hashed
character unigrams and bigrams with signed buckets. The result is stable across
runs and processes (same text -> byte-identical vector) and needs no network
access, which lets upload -> chunk -> embed -> retrieve -> quiz run end to end
on a machine without any API key.

It is a demo/CI backend, not a semantic replacement for bge-m3: the production
profile keeps ``EMBEDDING_PROVIDER=openai_compatible`` (or ``local``).
"""

from __future__ import annotations

import hashlib
import math
from collections import Counter

from app.config import Settings, get_settings
from app.ports import EmbeddingResult

MODEL_NAME = "mock-hash"

#: Guards CPU: the demo provider only looks at the head of a chunk.
MAX_CHARS = 2000


def _tokens(text: str) -> list[str]:
    normalized = " ".join(text.lower().split())[:MAX_CHARS]
    characters = [char for char in normalized if not char.isspace()]
    unigrams = characters
    bigrams = [characters[index] + characters[index + 1] for index in range(len(characters) - 1)]
    return unigrams + bigrams


def _bucket(token: str, dim: int) -> tuple[int, float]:
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    value = int.from_bytes(digest, "big")
    index = value % dim
    sign = 1.0 if (value >> 63) & 1 == 0 else -1.0
    return index, sign


def _vector(text: str, dim: int) -> list[float]:
    vector = [0.0] * dim
    for token, count in Counter(_tokens(text)).items():
        index, sign = _bucket(token, dim)
        vector[index] += sign * (1.0 + math.log(count))
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0.0:
        vector[0] = 1.0
        return vector
    return [value / norm for value in vector]


class DeterministicEmbedding:
    """Hash-bucket embedding provider used by ``EMBEDDING_PROVIDER=mock``."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        model: str | None = None,
        dim: int | None = None,
    ) -> None:
        resolved = settings or get_settings()
        self._model = model or MODEL_NAME
        self._dim = int(dim if dim is not None else resolved.embedding_dim)

    @property
    def model(self) -> str:
        """Model id persisted alongside every chunk vector."""
        return self._model

    @property
    def dim(self) -> int:
        """Vector dimension; must match the pgvector column width."""
        return self._dim

    def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        """Return one deterministic unit vector per input text."""
        vectors = [_vector(text or "", self._dim) for text in texts]
        return EmbeddingResult(vectors=vectors, model=self._model, dim=self._dim)
