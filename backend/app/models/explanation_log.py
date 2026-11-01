"""Append-only audit log of streamed knowledge-point explanations.

One row is written after every explanation attempt, whether it succeeded or
failed mid-stream. ``content`` holds whatever text reached the client so a
``partial`` row can be replayed/inspected without re-calling the provider.
Error text is always a generic, client-safe message (never an upstream body,
URL or key).
"""

from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin


class ExplanationLog(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "explanation_logs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ok', 'partial', 'failed')",
            name="ck_explanation_logs_status",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    knowledge_point_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    agent_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_configs.id", ondelete="SET NULL"), nullable=True
    )
    task_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="explain"
    )
    style: Mapped[str] = mapped_column(String(16), nullable=False, default="concise")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
