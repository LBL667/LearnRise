"""explanation logs

Revision ID: 0002_explanation_logs
Revises: 0001_initial_schema
Create Date: 2026-10-31 17:45:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as postgresql
from alembic import op


revision: str = "0002_explanation_logs"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "explanation_logs",
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("knowledge_point_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("agent_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("task_type", sa.String(length=32), nullable=False),
        sa.Column("style", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("chars", sa.Integer(), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('ok', 'partial', 'failed')",
            name="ck_explanation_logs_status",
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_configs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["knowledge_point_id"], ["knowledge_points.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_explanation_logs_user_id"),
        "explanation_logs",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_explanation_logs_knowledge_point_id"),
        "explanation_logs",
        ["knowledge_point_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_explanation_logs_knowledge_point_id"),
        table_name="explanation_logs",
    )
    op.drop_index(op.f("ix_explanation_logs_user_id"), table_name="explanation_logs")
    op.drop_table("explanation_logs")
