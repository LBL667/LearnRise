"""Assistant conversations and their messages (RAG chat history)."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin

MESSAGE_ROLES = ("user", "assistant")
ASSISTANT_MODES = ("concise", "detailed", "example", "socratic")


class AssistantConversation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "assistant_conversations"
    __table_args__ = (
        CheckConstraint(
            "mode IN ('concise', 'detailed', 'example', 'socratic')",
            name="ck_assistant_conversations_mode",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competition_id: Mapped[str | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(
        String(256), nullable=False, default="", server_default=""
    )
    mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="concise", server_default="concise"
    )


class AssistantMessage(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant')",
            name="ck_assistant_messages_role",
        ),
    )

    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    citations: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default="[]")
    mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
