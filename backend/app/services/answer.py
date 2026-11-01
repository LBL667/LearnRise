"""Answer grading and chunk-level tracing for generated quiz questions.

Grading is deterministic and offline: choice compares normalised option keys,
judge compares normalised booleans and short answers compare whitespace- and
case-normalised text. There is no fuzzy or LLM scoring here.

A wrong answer is traced back to the single source chunk that grounds it: the
question's knowledge point owns ``chunk_id`` in the normal path; when it has
none, the question text is embedded and the top-1 vector hit is used. Only
that chunk (content/page/heading) is returned, never the whole document.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.embedding import build_embedding
from app.adapters.vector import build_vector_store
from app.models import Chunk, KnowledgePoint, QuizAttempt, QuizQuestion

logger = logging.getLogger(__name__)

_OPTION_RE = re.compile(r"^\s*(?:选项\s*)?([A-Da-d])\s*[.、:：)．]?\s*$")
_TRUE_VALUES = {"true", "t", "正确", "对", "是", "√"}
_FALSE_VALUES = {"false", "f", "错误", "错", "否", "×"}
_VECTOR_TOP_K = 1


class QuizQuestionNotFound(Exception):
    """The question is missing, foreign or not a valid UUID (mapped to 404)."""


@dataclass(frozen=True, slots=True)
class SourceChunk:
    content: str
    page: int | None
    heading: str | None


@dataclass(frozen=True, slots=True)
class AnswerResult:
    correct: bool
    correct_answer: str
    explanation: str
    source_chunk: SourceChunk | None
    card_created: bool


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _normalize_choice(value: str) -> str:
    match = _OPTION_RE.match(value)
    if match is not None:
        return match.group(1).upper()
    return value.strip().upper()


def _normalize_judge(value: str) -> str | None:
    token = value.strip().lower()
    if token in _TRUE_VALUES:
        return "true"
    if token in _FALSE_VALUES:
        return "false"
    return None


def _normalize_text(value: str) -> str:
    return _collapse(value).lower()


def grade(question: QuizQuestion, given: str) -> tuple[bool, str]:
    """Grade ``given`` against ``question`` without touching the database.

    Returns ``(correct, normalized_reference_answer)``. The reference answer is
    normalised the same way the comparison is, so callers can show it back to
    the learner as the canonical form.
    """
    reference = question.answer or ""
    if question.type == "choice":
        expected = _normalize_choice(reference)
        return _normalize_choice(given) == expected, expected
    if question.type == "judge":
        expected = _normalize_judge(reference) or reference.strip().lower()
        return _normalize_judge(given) == expected, expected
    expected = _collapse(reference)
    return _normalize_text(given) == _normalize_text(reference), expected


def load_question(db: Session, *, user_id: str, question_id: str) -> QuizQuestion:
    """Load a question owned by ``user_id`` or raise :class:`QuizQuestionNotFound`."""
    try:
        UUID(question_id)
    except (ValueError, TypeError, AttributeError):
        raise QuizQuestionNotFound(question_id) from None
    question = db.get(QuizQuestion, question_id)
    if question is None or str(question.user_id) != str(user_id):
        raise QuizQuestionNotFound(question_id)
    return question


def _chunk_by_id(db: Session, chunk_id: str | None) -> SourceChunk | None:
    if not chunk_id:
        return None
    chunk = db.get(Chunk, chunk_id)
    if chunk is None:
        return None
    return SourceChunk(content=chunk.content, page=chunk.page, heading=chunk.heading)


def _chunk_by_vector(db: Session, question: QuizQuestion) -> SourceChunk | None:
    point = db.get(KnowledgePoint, question.knowledge_point_id)
    source_ids: list[str] | None = None
    if point is not None and point.source_id:
        source_ids = [str(point.source_id)]
    try:
        embedder = build_embedding()
        store = build_vector_store()
        vector = embedder.embed([question.question]).vectors[0]
        hits = store.search(vector, top_k=_VECTOR_TOP_K, source_ids=source_ids)
    except Exception as exc:  # noqa: BLE001 - tracing must never fail a submission
        logger.warning("quiz answer trace: vector fallback failed: %s", type(exc).__name__)
        return None
    for hit in hits:
        chunk = db.get(Chunk, hit.chunk_id)
        if chunk is not None:
            return SourceChunk(content=chunk.content, page=chunk.page, heading=chunk.heading)
        if hit.content:
            return SourceChunk(content=hit.content, page=hit.page, heading=hit.heading)
    return None


def _trace_wrong_answer(db: Session, question: QuizQuestion) -> SourceChunk | None:
    point = db.get(KnowledgePoint, question.knowledge_point_id)
    traced = _chunk_by_id(db, point.chunk_id if point is not None else None)
    if traced is not None:
        return traced
    return _chunk_by_vector(db, question)


def _maybe_create_card(
    db: Session, *, user_id: str, question: QuizQuestion, attempt: QuizAttempt
) -> bool:
    # TODO(Task 20): review-card creation lives in app.services.cards. Until that
    # module exists this is a no-op, so card_created is always false here.
    import importlib

    try:
        cards = importlib.import_module("app.services.cards")
    except ImportError:
        return False
    ensure = getattr(cards, "ensure_card_for_wrong_answer", None)
    if ensure is None:
        return False
    return bool(
        ensure(db, user_id=user_id, question=question, attempt=attempt)
    )


def submit_answer(
    db: Session,
    *,
    user_id: str,
    question_id: str,
    answer: str,
    response_time_ms: int | None = None,
) -> AnswerResult:
    """Grade one answer, persist the attempt and trace a wrong answer's chunk."""
    question = load_question(db, user_id=user_id, question_id=question_id)
    correct, correct_answer = grade(question, answer)

    source_chunk = None if correct else _trace_wrong_answer(db, question)

    attempt = QuizAttempt(
        question_id=question.id,
        user_id=user_id,
        answer=answer,
        correct=correct,
        response_time_ms=response_time_ms,
    )
    try:
        db.add(attempt)
        db.flush()
        card_created = False if correct else _maybe_create_card(
            db, user_id=user_id, question=question, attempt=attempt
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return AnswerResult(
        correct=correct,
        correct_answer=correct_answer,
        explanation=question.explanation,
        source_chunk=source_chunk,
        card_created=card_created,
    )


def list_attempts(
    db: Session, *, user_id: str, question_id: str
) -> list[QuizAttempt]:
    """Return the current user's attempts for a question, newest first."""
    question = load_question(db, user_id=user_id, question_id=question_id)
    rows = db.scalars(
        select(QuizAttempt)
        .where(
            QuizAttempt.question_id == question.id,
            QuizAttempt.user_id == user_id,
        )
        .order_by(QuizAttempt.created_at.desc(), QuizAttempt.id.desc())
    )
    return list(rows.all())
