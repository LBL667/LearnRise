"""Review-card creation from wrong quiz answers.

A wrong answer becomes exactly one ``review_cards`` row per
``(user_id, quiz_question_id)``. The row seeds the DSR state with the baseline
values (``difficulty=5.0``, ``stability=1.0``, ``retrievability=1.0``,
``state=0``, ``reps=0``, ``lapses=0``) and is due the same day in the configured
timezone; the scheduling math itself lives in :mod:`app.services.dsr` and is
owned by the review endpoints (Tasks 21/22).

Repeat wrong answers are idempotent: the existing card is returned untouched so
a learner who already progressed (``reps > 0``) never loses their DSR progress,
and ``last_review`` stays whatever the scheduler last recorded (``None`` for a
never-reviewed card). The insert is race-safe via ``ON CONFLICT DO NOTHING`` on
the ``uq_review_cards_user_question`` constraint.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import QuizAttempt, QuizQuestion, ReviewCard, new_uuid

CARD_TYPE_QUIZ_WRONG = "quiz_wrong"
CARD_TYPE_MANUAL = "manual"
SCHEDULER_NAME = "dsr_lite"

INITIAL_DIFFICULTY = 5.0
INITIAL_STABILITY = 1.0
INITIAL_RETRIEVABILITY = 1.0
INITIAL_STATE = 0

_EXPLANATION_PREFIX = "\n\n解析："


def _today() -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


def _choice_answer(question: QuizQuestion) -> str:
    key = (question.answer or "").strip().upper()
    options = question.options or []
    if len(key) == 1 and "A" <= key <= "D":
        index = ord(key) - ord("A")
        if index < len(options):
            return f"{key}. {options[index]}"
    return (question.answer or "").strip()


def _render_answer(question: QuizQuestion) -> str:
    if question.type == "choice":
        base = _choice_answer(question)
    else:
        base = (question.answer or "").strip()
    explanation = (question.explanation or "").strip()
    if explanation:
        return f"{base}{_EXPLANATION_PREFIX}{explanation}"
    return base


def _initial_values(
    *,
    user_id: str,
    question_text: str,
    answer_text: str,
    card_type: str,
    knowledge_point_id: str | None,
    quiz_question_id: str | None,
) -> dict[str, object]:
    return {
        "id": new_uuid(),
        "user_id": user_id,
        "knowledge_point_id": knowledge_point_id,
        "quiz_question_id": quiz_question_id,
        "question": question_text,
        "answer": answer_text,
        "card_type": card_type,
        "difficulty": INITIAL_DIFFICULTY,
        "stability": INITIAL_STABILITY,
        "retrievability": INITIAL_RETRIEVABILITY,
        "state": INITIAL_STATE,
        "reps": 0,
        "lapses": 0,
        "due_date": _today(),
        "last_review": None,
        "scheduler": SCHEDULER_NAME,
    }


def _find_by_question(
    db: Session, *, user_id: str, quiz_question_id: str
) -> ReviewCard | None:
    return db.scalar(
        select(ReviewCard).where(
            ReviewCard.user_id == user_id,
            ReviewCard.quiz_question_id == quiz_question_id,
        )
    )


def ensure_card_for_wrong_answer(
    db: Session,
    *,
    user_id: str,
    question: QuizQuestion,
    attempt: QuizAttempt | None = None,
) -> ReviewCard | None:
    """Create (or return) the single card backing a wrong answer.

    ``attempt`` is accepted because :mod:`app.services.answer` passes the
    just-graded attempt through its importlib hook; the baseline card does not
    consume it (``last_review`` deliberately starts as ``NULL``).
    """
    del attempt
    existing = _find_by_question(db, user_id=user_id, quiz_question_id=question.id)
    if existing is not None:
        return existing

    values = _initial_values(
        user_id=user_id,
        question_text=question.question,
        answer_text=_render_answer(question),
        card_type=CARD_TYPE_QUIZ_WRONG,
        knowledge_point_id=question.knowledge_point_id,
        quiz_question_id=question.id,
    )
    created_id = db.execute(
        pg_insert(ReviewCard)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=["user_id", "quiz_question_id"],
        )
        .returning(ReviewCard.id)
    ).scalar_one_or_none()
    if created_id is None:
        # Lost the race to a concurrent insert: the other transaction's row wins.
        return _find_by_question(db, user_id=user_id, quiz_question_id=question.id)
    return db.get(ReviewCard, created_id)


def create_manual_card(
    db: Session,
    *,
    user_id: str,
    question: str,
    answer: str,
    knowledge_point_id: str | None = None,
) -> ReviewCard:
    values = _initial_values(
        user_id=user_id,
        question_text=question,
        answer_text=answer,
        card_type=CARD_TYPE_MANUAL,
        knowledge_point_id=knowledge_point_id,
        quiz_question_id=None,
    )
    card = ReviewCard(**values)  # type: ignore[arg-type]
    db.add(card)
    db.flush()
    return card


def list_cards(
    db: Session,
    *,
    user_id: str,
    state: int | None = None,
    limit: int = 50,
) -> list[ReviewCard]:
    capped = max(1, min(limit, 200))
    statement = select(ReviewCard).where(ReviewCard.user_id == user_id)
    if state is not None:
        statement = statement.where(ReviewCard.state == state)
    statement = (
        statement.order_by(
            ReviewCard.due_date.desc().nulls_last(),
            ReviewCard.created_at.desc(),
            ReviewCard.id.desc(),
        )
        .limit(capped)
    )
    return list(db.scalars(statement).all())
