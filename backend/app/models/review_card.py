"""Spaced-repetition review cards."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class ReviewCard(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "review_cards"
    __table_args__ = (
        UniqueConstraint("user_id", "quiz_question_id", name="uq_review_cards_user_question"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    knowledge_point_id: Mapped[str | None] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True
    )
    # Foreign key to quiz_questions lands in Task 18/19's migration.
    quiz_question_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    card_type: Mapped[str] = mapped_column(String(32), nullable=False, default="quiz_wrong")
    difficulty: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    stability: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    retrievability: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    state: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lapses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    last_review: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduler: Mapped[str] = mapped_column(String(32), nullable=False, default="dsr_lite")
