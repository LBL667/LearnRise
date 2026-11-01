"""Document chunks with pgvector embeddings."""

from __future__ import annotations

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin

EMBEDDING_DIM = 1024


class Chunk(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chunks"
    __table_args__ = (
        UniqueConstraint(
            "source_id",
            "chunk_index",
            "embedding_model",
            "embedding_dim",
            "embedding_version",
            name="uq_chunks_identity",
        ),
        Index("ix_chunks_source_id", "source_id"),
    )

    source_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_sources.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    competition_id: Mapped[str | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="SET NULL"), index=True, nullable=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heading: Mapped[str | None] = mapped_column(String(512), nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    embedding_model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    embedding_dim: Mapped[int] = mapped_column(
        Integer, nullable=False, default=EMBEDDING_DIM, server_default=str(EMBEDDING_DIM)
    )
    embedding_version: Mapped[str] = mapped_column(
        String(32), nullable=False, default="1", server_default="1"
    )
