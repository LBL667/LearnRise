"""Per-user LLM agent configuration."""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class AgentConfig(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "agent_configs"
    __table_args__ = (Index("ix_agent_configs_user_default", "user_id", "is_default"),)

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    provider_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="openai_compatible"
    )
    base_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    monthly_token_budget: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_concurrency: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
