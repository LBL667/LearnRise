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
        competition_id: str | None = None,
        user_id: str | None = None,
    ) -> list[SearchHit]:
        """Return the ``top_k`` nearest chunks, optionally limited by scope.

        ``source_ids`` restricts by source, ``competition_id``/``user_id``
        restrict by the denormalised ownership columns. Every new keyword is
        optional and defaults to ``None`` so existing call sites keep their
        current behaviour.
        """
        ...

    def delete_by_source(self, source_id: str) -> int:
        """Delete every chunk belonging to ``source_id``; return rows removed."""
        ...
