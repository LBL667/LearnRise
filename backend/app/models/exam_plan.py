"""Generated exam preparation plans for a competition."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import UUIDPrimaryKeyMixin

PLAN_MODES = ("standard", "sprint")


class ExamPlan(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "exam_plans"
    __table_args__ = (
        CheckConstraint("mode IN ('standard', 'sprint')", name="ck_exam_plans_mode"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competition_id: Mapped[str] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="standard", server_default="standard"
    )
    items: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
