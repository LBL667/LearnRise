"""Per-user answer attempts against generated quiz questions.

Rows are append-only: every submission stores the raw answer, the graded
verdict and the optional client-measured response time so later analytics
(and Task 20's review cards) can reason about mistakes. ``correct`` is always
computed server-side by :func:`app.services.answer.grade`.
"""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin


class QuizAttempt(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "quiz_attempts"
    __table_args__ = (
        Index("ix_quiz_attempts_user_question", "user_id", "question_id"),
    )

    question_id: Mapped[str] = mapped_column(
        ForeignKey("quiz_questions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
