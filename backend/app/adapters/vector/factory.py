"""Select the vector store backend from application settings.

Both supported profiles use the same adapter; only ``DATABASE_URL`` differs:
``local`` points at the Docker PostgreSQL+pgvector container, ``huawei`` at an
RDS for PostgreSQL instance with the ``vector`` extension enabled.
"""

from __future__ import annotations

from app.adapters.vector.pgvector_store import PgVectorStore
from app.config import Settings, get_settings
from app.ports import VectorStore


def build_vector_store(settings: Settings | None = None) -> VectorStore:
    cfg = settings or get_settings()
    return PgVectorStore(settings=cfg)
