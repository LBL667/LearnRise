"""Per-user dismissals of derived wrong questions."""

from __future__ import annotations

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin


class WrongQuestionDismissal(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "wrong_question_dismissals"
    __table_args__ = (
        UniqueConstraint("user_id", "question_id", name="uq_wrong_question_dismissals_pair"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    question_id: Mapped[str] = mapped_column(
        ForeignKey("quiz_questions.id", ondelete="CASCADE"), index=True, nullable=False
    )
