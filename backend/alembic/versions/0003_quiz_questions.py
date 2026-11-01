"""quiz questions

Revision ID: 0003_quiz_questions
Revises: 0002_explanation_logs
Create Date: 2026-10-31 20:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as postgresql
from alembic import op


revision: str = "0003_quiz_questions"
down_revision: str | None = "0002_explanation_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "quiz_questions",
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("knowledge_point_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column(
            "difficulty",
            sa.String(length=16),
            server_default="medium",
            nullable=False,
        ),
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "type IN ('choice', 'judge', 'short_answer')",
            name="ck_quiz_questions_type",
        ),
        sa.CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_quiz_questions_difficulty",
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_point_id"], ["knowledge_points.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_quiz_questions_user_id"),
        "quiz_questions",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_quiz_questions_knowledge_point_id"),
        "quiz_questions",
        ["knowledge_point_id"],
        unique=False,
    )
    op.create_index(
        "ix_quiz_questions_user_kp",
        "quiz_questions",
        ["user_id", "knowledge_point_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_quiz_questions_user_kp", table_name="quiz_questions")
    op.drop_index(
        op.f("ix_quiz_questions_knowledge_point_id"),
        table_name="quiz_questions",
    )
    op.drop_index(op.f("ix_quiz_questions_user_id"), table_name="quiz_questions")
    op.drop_table("quiz_questions")
