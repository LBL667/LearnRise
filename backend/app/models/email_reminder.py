"""Daily email reminder bookkeeping."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin


class EmailReminder(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "email_reminders"
    __table_args__ = (
        UniqueConstraint("user_id", "send_date", name="uq_email_reminders_user_day"),
        CheckConstraint(
            "status IN ('pending', 'sent', 'failed')",
            name="ck_email_reminders_status",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    send_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="smtp")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cards_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
