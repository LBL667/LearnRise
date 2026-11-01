"""Schema assertions that need no live database."""

from __future__ import annotations

from sqlalchemy import Boolean, Text, UniqueConstraint

import app.models  # noqa: F401
from app.db import Base

EXPECTED_TABLES = {
    "users",
    "knowledge_sources",
    "ingestion_jobs",
    "chunks",
    "knowledge_points",
    "review_cards",
    "review_logs",
    "email_reminders",
    "agent_configs",
    "explanation_logs",
    "quiz_questions",
    "quiz_attempts",
}


def _unique(table_name: str, constraint_name: str) -> UniqueConstraint:
    table = Base.metadata.tables[table_name]
    for constraint in table.constraints:
        if isinstance(constraint, UniqueConstraint) and constraint.name == constraint_name:
            return constraint
    raise AssertionError(f"{constraint_name} missing from {table_name}")


def test_all_expected_tables_registered() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_chunks_embedding_is_vector_1024() -> None:
    chunks = Base.metadata.tables["chunks"]
    assert "vector(1024)" in str(chunks.c.embedding.type).lower()


def test_chunks_embedding_metadata_columns() -> None:
    columns = Base.metadata.tables["chunks"].c
    assert {"embedding_model", "embedding_dim", "embedding_version"} <= set(columns.keys())


def test_chunks_identity_unique_constraint() -> None:
    constraint = _unique("chunks", "uq_chunks_identity")
    assert tuple(column.name for column in constraint.columns) == (
        "source_id",
        "chunk_index",
        "embedding_model",
        "embedding_dim",
        "embedding_version",
    )


def test_review_card_defaults() -> None:
    columns = Base.metadata.tables["review_cards"].c
    expected = {
        "difficulty": 5.0,
        "stability": 1.0,
        "state": 0,
        "reps": 0,
        "lapses": 0,
    }
    for name, value in expected.items():
        assert columns[name].default.arg == value


def test_agent_config_columns() -> None:
    columns = Base.metadata.tables["agent_configs"].c
    assert isinstance(columns["api_key_encrypted"].type, Text)
    assert isinstance(columns["is_default"].type, Boolean)


def test_email_reminder_unique_user_day() -> None:
    constraint = _unique("email_reminders", "uq_email_reminders_user_day")
    assert tuple(column.name for column in constraint.columns) == ("user_id", "send_date")


def test_learning_path_edges_is_out_of_scope() -> None:
    assert "learning_path_edges" not in Base.metadata.tables
