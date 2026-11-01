"""pgvector adapter for the ``VectorStore`` port."""

from __future__ import annotations

from app.adapters.vector.factory import build_vector_store
from app.adapters.vector.pgvector_store import (
    EMBEDDING_DIM,
    HNSW_INDEX_SQL,
    IVFFLAT_INDEX_SQL,
    PgVectorStore,
)

__all__ = [
    "EMBEDDING_DIM",
    "HNSW_INDEX_SQL",
    "IVFFLAT_INDEX_SQL",
    "PgVectorStore",
    "build_vector_store",
]
