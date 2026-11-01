"""Competition domain: competitions, memberships and invite codes."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.common import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin

MEMBER_ROLES = ("leader", "member", "viewer")
PLAN_STATUSES = ("pending", "generating", "ready", "failed")


class Competition(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "competitions"
    __table_args__ = (
        CheckConstraint(
            "plan_status IN ('pending', 'generating', 'ready', 'failed')",
            name="ck_competitions_plan_status",
        ),
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_competitions_difficulty",
        ),
    )

    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    intro: Mapped[str] = mapped_column(Text, nullable=False, default="")
    question_types: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    difficulty: Mapped[str] = mapped_column(
        String(16), nullable=False, default="medium", server_default="medium"
    )
    winner_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=3, server_default="3"
    )
    rewards: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default="[]")
    knowledge_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reward_image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    plan_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    plan_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    plan_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class CompetitionMember(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "competition_members"
    __table_args__ = (
        UniqueConstraint("competition_id", "user_id", name="uq_competition_members_pair"),
        CheckConstraint(
            "role IN ('leader', 'member', 'viewer')",
            name="ck_competition_members_role",
        ),
    )

    competition_id: Mapped[str] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="member", server_default="member"
    )


class CompetitionInvite(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "competition_invites"

    competition_id: Mapped[str] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
