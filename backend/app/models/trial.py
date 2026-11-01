"""Trial exams: a persisted instance with a frozen question set."""

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
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

EXAM_STATUSES = ("in_progress", "submitted", "expired")


class TrialExam(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "trial_exams"
    __table_args__ = (
        CheckConstraint(
            "status IN ('in_progress', 'submitted', 'expired')",
            name="ck_trial_exams_status",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competition_id: Mapped[str | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=True
    )
    question_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="in_progress", server_default="in_progress"
    )
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class TrialAnswer(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "trial_answers"
    __table_args__ = (
        UniqueConstraint("exam_id", "question_id", name="uq_trial_answers_pair"),
    )

    exam_id: Mapped[str] = mapped_column(
        ForeignKey("trial_exams.id", ondelete="CASCADE"), index=True, nullable=False
    )
    question_id: Mapped[str] = mapped_column(
        ForeignKey("quiz_questions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    answer: Mapped[str] = mapped_column(Text, nullable=False, default="")
    correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
