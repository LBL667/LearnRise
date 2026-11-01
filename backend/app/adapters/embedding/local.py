"""Lazy local BGE-M3 embedding backend.

``FlagEmbedding`` pulls in torch and is optional: it MUST NOT be imported at
module scope, otherwise a cloud-only deployment would fail to boot. The import
happens inside :meth:`LocalFlagEmbedding.embed`; when it is unavailable the
adapter raises :class:`ProviderError` with a stable message.
"""

from __future__ import annotations

from typing import Any

from app.config import Settings, get_settings
from app.ports import EmbeddingResult
from app.ports.errors import DimensionMismatch, ProviderError

_NOT_INSTALLED = "local embedding backend not installed"


class LocalFlagEmbedding:
    """In-process ``bge-m3`` via ``FlagEmbedding.BGEM3FlagModel``."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        model: str | None = None,
        dim: int | None = None,
        batch_size: int | None = None,
        max_length: int = 8192,
        use_fp16: bool = False,
    ) -> None:
        resolved = settings or get_settings()
        self._model = model or resolved.embedding_model
        self._dim = int(dim if dim is not None else resolved.embedding_dim)
        self._batch_size = max(
            1, int(batch_size if batch_size is not None else resolved.embedding_batch_size)
        )
        self._max_length = max_length
        self._use_fp16 = use_fp16
        self._backend: Any = None
        self._backend_model: str = ""

    @property
    def model(self) -> str:
        """Default embedding model id."""
        return self._model

    @property
    def dim(self) -> int:
        """Expected embedding dimension enforced on every vector."""
        return self._dim

    def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        """Embed ``texts`` locally; one 1024-dim vector per input, in order."""
        model_name = model or self._model
        if not texts:
            return EmbeddingResult(vectors=[], model=model_name, dim=self._dim)

        backend = self._load_backend(model_name)
        raw = backend.encode(
            texts,
            batch_size=self._batch_size,
            max_length=self._max_length,
        )
        dense = raw.get("dense_vecs") if isinstance(raw, dict) else raw
        if dense is None:
            raise ProviderError("local embedding backend returned no vectors")

        vectors = [[float(value) for value in vector] for vector in dense]
        for vector in vectors:
            if len(vector) != self._dim:
                raise DimensionMismatch(f"expected dim {self._dim}, got {len(vector)}")
        return EmbeddingResult(vectors=vectors, model=model_name, dim=self._dim)

    def _load_backend(self, model_name: str) -> Any:
        if self._backend is not None and self._backend_model == model_name:
            return self._backend
        try:
            from FlagEmbedding import BGEM3FlagModel
        except ImportError:
            raise ProviderError(_NOT_INSTALLED) from None
        except Exception:
            raise ProviderError("local embedding backend unavailable") from None
        try:
            self._backend = BGEM3FlagModel(model_name, use_fp16=self._use_fp16)
        except Exception:
            raise ProviderError("local embedding backend failed to load") from None
        self._backend_model = model_name
        return self._backend
