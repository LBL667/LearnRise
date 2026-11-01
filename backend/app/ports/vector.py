"""Vector store port."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.ports.types import ChunkRecord, SearchHit


@runtime_checkable
class VectorStore(Protocol):
    """Chunk persistence and similarity search backend."""

    def upsert(self, chunks: list[ChunkRecord]) -> int:
        """Insert or update chunks, returning the number of rows written."""
        ...

    def search(
        self,
        query_vector: list[float],
        *,
        top_k: int = 5,
        source_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        """Return the ``top_k`` nearest chunks, optionally limited by source."""
        ...

    def delete_by_source(self, source_id: str) -> int:
        """Delete every chunk belonging to ``source_id``; return rows removed."""
        ...
