"""quiz attempts

Revision ID: 0004_quiz_attempts
Revises: 0003_quiz_questions
Create Date: 2026-10-31 21:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as postgresql
from alembic import op


revision: str = "0004_quiz_attempts"
down_revision: str | None = "0003_quiz_questions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "quiz_attempts",
        sa.Column("question_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("response_time_ms", sa.Integer(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["question_id"], ["quiz_questions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_quiz_attempts_user_question",
        "quiz_attempts",
        ["user_id", "question_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_quiz_attempts_user_question", table_name="quiz_attempts")
    op.drop_table("quiz_attempts")
