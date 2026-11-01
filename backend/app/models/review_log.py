"""Append-only review log used for scheduling analytics."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin


class ReviewLog(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "review_logs"
    __table_args__ = (
        UniqueConstraint("card_id", "review_date", name="uq_review_logs_card_day"),
    )

    card_id: Mapped[str] = mapped_column(
        ForeignKey("review_cards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    review_date: Mapped[date] = mapped_column(Date, nullable=False)
    stability: Mapped[float] = mapped_column(Float, nullable=False)
    difficulty: Mapped[float] = mapped_column(Float, nullable=False)
    scheduled_days: Mapped[int] = mapped_column(Integer, nullable=False)
