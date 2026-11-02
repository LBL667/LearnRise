"""user profile and preference columns

Revision ID: 0006_profile_preferences
Revises: 0005_platform_domain
Create Date: 2026-11-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as postgresql
from alembic import op


revision: str = "0006_profile_preferences"
down_revision: str | None = "0005_platform_domain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column("users", sa.Column("school", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("grade", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("avatar_key", sa.String(length=256), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "email_reminders_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "learning_prefs",
            _JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "ui_prefs",
            _JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "privacy_prefs",
            _JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "privacy_prefs")
    op.drop_column("users", "ui_prefs")
    op.drop_column("users", "learning_prefs")
    op.drop_column("users", "email_reminders_enabled")
    op.drop_column("users", "avatar_key")
    op.drop_column("users", "grade")
    op.drop_column("users", "school")
