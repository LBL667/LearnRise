"""platform domain: competitions, assistant, trial, practice, plans

Revision ID: 0005_platform_domain
Revises: 0004_quiz_attempts
Create Date: 2026-11-01 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as postgresql
from alembic import op


revision: str = "0005_platform_domain"
down_revision: str | None = "0004_quiz_attempts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=False)
_JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "competitions",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("owner_id", _UUID, nullable=False),
        sa.Column("title", sa.String(length=256), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("intro", sa.Text(), nullable=False, server_default=""),
        sa.Column("question_types", _JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("difficulty", sa.String(length=16), nullable=False, server_default="medium"),
        sa.Column("winner_count", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("rewards", _JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("knowledge_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reward_image_url", sa.String(length=1024), nullable=True),
        sa.Column("plan_status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("plan_payload", _JSONB, nullable=True),
        sa.Column("plan_generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "plan_status IN ('pending', 'generating', 'ready', 'failed')",
            name="ck_competitions_plan_status",
        ),
        sa.CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_competitions_difficulty",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_competitions_owner_id", "competitions", ["owner_id"], unique=False)

    op.create_table(
        "competition_members",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("competition_id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False, server_default="member"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "role IN ('leader', 'member', 'viewer')",
            name="ck_competition_members_role",
        ),
        sa.ForeignKeyConstraint(["competition_id"], ["competitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("competition_id", "user_id", name="uq_competition_members_pair"),
    )
    op.create_index(
        "ix_competition_members_competition_id",
        "competition_members",
        ["competition_id"],
        unique=False,
    )
    op.create_index(
        "ix_competition_members_user_id", "competition_members", ["user_id"], unique=False
    )

    op.create_table(
        "competition_invites",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("competition_id", _UUID, nullable=False),
        sa.Column("created_by", _UUID, nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["competition_id"], ["competitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_competition_invites_code", "competition_invites", ["code"], unique=True)
    op.create_index(
        "ix_competition_invites_competition_id",
        "competition_invites",
        ["competition_id"],
        unique=False,
    )

    op.create_table(
        "trial_exams",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("competition_id", _UUID, nullable=True),
        sa.Column("question_ids", _JSONB, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="in_progress"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status IN ('in_progress', 'submitted', 'expired')",
            name="ck_trial_exams_status",
        ),
        sa.ForeignKeyConstraint(["competition_id"], ["competitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trial_exams_user_id", "trial_exams", ["user_id"], unique=False)
    op.create_index("ix_trial_exams_competition_id", "trial_exams", ["competition_id"], unique=False)

    op.create_table(
        "trial_answers",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("exam_id", _UUID, nullable=False),
        sa.Column("question_id", _UUID, nullable=False),
        sa.Column("answer", sa.Text(), nullable=False, server_default=""),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["exam_id"], ["trial_exams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["quiz_questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exam_id", "question_id", name="uq_trial_answers_pair"),
    )
    op.create_index("ix_trial_answers_exam_id", "trial_answers", ["exam_id"], unique=False)
    op.create_index("ix_trial_answers_question_id", "trial_answers", ["question_id"], unique=False)

    op.create_table(
        "assistant_conversations",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("competition_id", _UUID, nullable=True),
        sa.Column("title", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="concise"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "mode IN ('concise', 'detailed', 'example', 'socratic')",
            name="ck_assistant_conversations_mode",
        ),
        sa.ForeignKeyConstraint(["competition_id"], ["competitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assistant_conversations_user_id",
        "assistant_conversations",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_assistant_conversations_competition_id",
        "assistant_conversations",
        ["competition_id"],
        unique=False,
    )

    op.create_table(
        "assistant_messages",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("conversation_id", _UUID, nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("citations", _JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("mode", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_assistant_messages_role"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["assistant_conversations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assistant_messages_conversation_id",
        "assistant_messages",
        ["conversation_id"],
        unique=False,
    )

    op.create_table(
        "practice_sessions",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("competition_id", _UUID, nullable=True),
        sa.Column("difficulty", sa.String(length=16), nullable=False, server_default="easy"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("answered_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_practice_sessions_difficulty",
        ),
        sa.CheckConstraint("status IN ('active', 'ended')", name="ck_practice_sessions_status"),
        sa.ForeignKeyConstraint(["competition_id"], ["competitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_practice_sessions_user_id", "practice_sessions", ["user_id"], unique=False)
    op.create_index(
        "ix_practice_sessions_competition_id",
        "practice_sessions",
        ["competition_id"],
        unique=False,
    )

    op.create_table(
        "practice_items",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("session_id", _UUID, nullable=False),
        sa.Column("question_id", _UUID, nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("difficulty", sa.String(length=16), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["quiz_questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["practice_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "question_id", name="uq_practice_items_pair"),
        sa.UniqueConstraint("session_id", "position", name="uq_practice_items_position"),
    )
    op.create_index("ix_practice_items_session_id", "practice_items", ["session_id"], unique=False)
    op.create_index("ix_practice_items_question_id", "practice_items", ["question_id"], unique=False)

    op.create_table(
        "wrong_question_dismissals",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("question_id", _UUID, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["quiz_questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "question_id", name="uq_wrong_question_dismissals_pair"),
    )
    op.create_index(
        "ix_wrong_question_dismissals_user_id",
        "wrong_question_dismissals",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_wrong_question_dismissals_question_id",
        "wrong_question_dismissals",
        ["question_id"],
        unique=False,
    )

    op.create_table(
        "exam_plans",
        sa.Column("id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("competition_id", _UUID, nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="standard"),
        sa.Column("items", _JSONB, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("mode IN ('standard', 'sprint')", name="ck_exam_plans_mode"),
        sa.ForeignKeyConstraint(["competition_id"], ["competitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exam_plans_user_id", "exam_plans", ["user_id"], unique=False)
    op.create_index("ix_exam_plans_competition_id", "exam_plans", ["competition_id"], unique=False)

    op.add_column(
        "knowledge_sources",
        sa.Column("competition_id", _UUID, nullable=True),
    )
    op.create_foreign_key(
        "fk_knowledge_sources_competition_id",
        "knowledge_sources",
        "competitions",
        ["competition_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_knowledge_sources_competition_id",
        "knowledge_sources",
        ["competition_id"],
        unique=False,
    )

    op.add_column(
        "quiz_questions",
        sa.Column("competition_id", _UUID, nullable=True),
    )
    op.create_foreign_key(
        "fk_quiz_questions_competition_id",
        "quiz_questions",
        "competitions",
        ["competition_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_quiz_questions_competition_id",
        "quiz_questions",
        ["competition_id"],
        unique=False,
    )

    op.add_column(
        "chunks",
        sa.Column("competition_id", _UUID, nullable=True),
    )
    op.create_foreign_key(
        "fk_chunks_competition_id",
        "chunks",
        "competitions",
        ["competition_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_chunks_competition_id",
        "chunks",
        ["competition_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_chunks_competition_id", table_name="chunks")
    op.drop_constraint("fk_chunks_competition_id", "chunks", type_="foreignkey")
    op.drop_column("chunks", "competition_id")

    op.drop_index("ix_quiz_questions_competition_id", table_name="quiz_questions")
    op.drop_constraint("fk_quiz_questions_competition_id", "quiz_questions", type_="foreignkey")
    op.drop_column("quiz_questions", "competition_id")

    op.drop_index("ix_knowledge_sources_competition_id", table_name="knowledge_sources")
    op.drop_constraint(
        "fk_knowledge_sources_competition_id", "knowledge_sources", type_="foreignkey"
    )
    op.drop_column("knowledge_sources", "competition_id")

    op.drop_index("ix_exam_plans_competition_id", table_name="exam_plans")
    op.drop_index("ix_exam_plans_user_id", table_name="exam_plans")
    op.drop_table("exam_plans")

    op.drop_index("ix_wrong_question_dismissals_question_id", table_name="wrong_question_dismissals")
    op.drop_index("ix_wrong_question_dismissals_user_id", table_name="wrong_question_dismissals")
    op.drop_table("wrong_question_dismissals")

    op.drop_index("ix_practice_items_question_id", table_name="practice_items")
    op.drop_index("ix_practice_items_session_id", table_name="practice_items")
    op.drop_table("practice_items")

    op.drop_index("ix_practice_sessions_competition_id", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_user_id", table_name="practice_sessions")
    op.drop_table("practice_sessions")

    op.drop_index("ix_assistant_messages_conversation_id", table_name="assistant_messages")
    op.drop_table("assistant_messages")

    op.drop_index(
        "ix_assistant_conversations_competition_id", table_name="assistant_conversations"
    )
    op.drop_index("ix_assistant_conversations_user_id", table_name="assistant_conversations")
    op.drop_table("assistant_conversations")

    op.drop_index("ix_trial_answers_question_id", table_name="trial_answers")
    op.drop_index("ix_trial_answers_exam_id", table_name="trial_answers")
    op.drop_table("trial_answers")

    op.drop_index("ix_trial_exams_competition_id", table_name="trial_exams")
    op.drop_index("ix_trial_exams_user_id", table_name="trial_exams")
    op.drop_table("trial_exams")

    op.drop_index("ix_competition_invites_competition_id", table_name="competition_invites")
    op.drop_index("ix_competition_invites_code", table_name="competition_invites")
    op.drop_table("competition_invites")

    op.drop_index("ix_competition_members_user_id", table_name="competition_members")
    op.drop_index("ix_competition_members_competition_id", table_name="competition_members")
    op.drop_table("competition_members")

    op.drop_index("ix_competitions_owner_id", table_name="competitions")
    op.drop_table("competitions")
