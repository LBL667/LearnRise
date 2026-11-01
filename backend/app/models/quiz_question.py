"""Generated quiz questions tied to a knowledge point.

Rows are only ever written by :mod:`app.services.quiz` after the LLM payload
has passed strict per-type validation, so ``answer`` is always normalised
(``A``/``B``/``C``/``D`` for choice, ``true``/``false`` for judge).
"""

from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin


class QuizQuestion(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "quiz_questions"
    __table_args__ = (
        CheckConstraint(
            "type IN ('choice', 'judge', 'short_answer')",
            name="ck_quiz_questions_type",
        ),
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_quiz_questions_difficulty",
        ),
        Index(
            "ix_quiz_questions_user_kp",
            "user_id",
            "knowledge_point_id",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competition_id: Mapped[str | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="SET NULL"), index=True, nullable=True
    )
    knowledge_point_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    difficulty: Mapped[str] = mapped_column(
        String(16), nullable=False, default="medium", server_default="medium"
    )
