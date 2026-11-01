"""Adaptive practice loop: sessions and their per-question items."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin

PRACTICE_DIFFICULTIES = ("easy", "medium", "hard")
PRACTICE_STATUSES = ("active", "ended")
PRACTICE_MAX_ITEMS = 50


class PracticeSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "practice_sessions"
    __table_args__ = (
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_practice_sessions_difficulty",
        ),
        CheckConstraint(
            "status IN ('active', 'ended')",
            name="ck_practice_sessions_status",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competition_id: Mapped[str | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=True
    )
    difficulty: Mapped[str] = mapped_column(
        String(16), nullable=False, default="easy", server_default="easy"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )
    answered_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    correct_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PracticeItem(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "practice_items"
    __table_args__ = (
        UniqueConstraint("session_id", "question_id", name="uq_practice_items_pair"),
        UniqueConstraint("session_id", "position", name="uq_practice_items_position"),
    )

    session_id: Mapped[str] = mapped_column(
        ForeignKey("practice_sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    question_id: Mapped[str] = mapped_column(
        ForeignKey("quiz_questions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(16), nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
