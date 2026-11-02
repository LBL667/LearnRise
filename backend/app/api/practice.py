"""Adaptive practice loop: question -> grade -> explain -> next question.

A session is created from one or more visible knowledge points and always has
exactly one *current* question (the item with no recorded answer yet). Grading
reuses :func:`app.services.answer.grade`, so the reference answer only leaves
the server after the learner has submitted. The next question is picked from
the knowledge points already seen in the session at the adapted difficulty and
never repeats a question id.

Adaptive rule (the single source of truth is :func:`_adaptive_difficulty`):
**2 consecutive correct answers move one step harder; 2 consecutive wrong
answers move one step easier; the result is clamped to easy/medium/hard.**
The streak is recomputed from the persisted items on every answer; no extra
column is required.

Hard limits: a session never holds more than
:data:`app.models.practice.PRACTICE_MAX_ITEMS` (50) items. A request that would
need a 51st question is rejected with ``409`` ``code=SESSION_LIMIT``. The
``(session_id, question_id)`` unique constraint is the last line of defence
against a repeated question.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import CodedHTTPException
from app.deps import CurrentUser, DbSession
from app.models import (
    KnowledgePoint,
    KnowledgeSource,
    PracticeItem,
    PracticeSession,
    QuizQuestion,
    User,
)
from app.models.practice import PRACTICE_MAX_ITEMS
from app.services.answer import grade
from app.services.scope import authorize_resource, resolve_scope

router = APIRouter(prefix="/api/assistant/practice", tags=["practice"])

NOT_FOUND_DETAIL = "资源不存在"
NO_QUESTIONS_DETAIL = "当前没有可用的题目"
SESSION_ENDED_DETAIL = "练习会话已结束"
NOT_CURRENT_QUESTION_DETAIL = "该题不是当前待作答题目"
SESSION_LIMIT_DETAIL = f"练习会话最多 {PRACTICE_MAX_ITEMS} 题，请结束本次练习"

Difficulty = Literal["easy", "medium", "hard"]

_DIFFICULTY_ORDER: tuple[str, ...] = ("easy", "medium", "hard")
_STEP = {"easy": 0, "medium": 1, "hard": 2}


def _not_found() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
    )


class SessionCreate(BaseModel):
    knowledge_point_ids: list[str] = Field(min_length=1)
    difficulty: Difficulty | None = None
    competition_id: str | None = None
    # Client-side hint kept for contract symmetry; the loop is server-driven and
    # bounded by ``PRACTICE_MAX_ITEMS`` regardless of this value.
    count: int | None = Field(default=None, ge=1, le=PRACTICE_MAX_ITEMS)


class AnswerIn(BaseModel):
    question_id: str
    answer: str


class ProgressOut(BaseModel):
    answered: int
    correct: int
    total: int


class QuestionOut(BaseModel):
    id: str
    no: int
    type: str
    difficulty: str
    stem: str
    options: list[str] | None = None


class SessionStartOut(BaseModel):
    session_id: str
    difficulty: str
    status: str
    progress: ProgressOut
    current_question: QuestionOut | None = None


class AnswerOut(BaseModel):
    correct: bool
    correct_answer: str
    explanation: str
    difficulty: str
    progress: ProgressOut
    current_question: QuestionOut | None = None
    finished: bool


class HistoryItemOut(BaseModel):
    question_id: str
    no: int
    type: str
    difficulty: str
    stem: str
    options: list[str] | None = None
    answered: bool
    answer: str | None = None
    correct: bool | None = None
    correct_answer: str | None = None
    explanation: str | None = None


class SessionDetailOut(BaseModel):
    session_id: str
    difficulty: str
    status: str
    progress: ProgressOut
    current_question: QuestionOut | None = None
    items: list[HistoryItemOut]
    ended_at: datetime | None = None


class SessionEndOut(BaseModel):
    answered: int
    correct: int
    accuracy: float
    ended_at: datetime


def _load_visible_points(
    db: Session, user: User, point_ids: list[str]
) -> list[KnowledgePoint]:
    """Load every point or raise ``404`` if any one is invisible/nonexistent.

    Visibility follows :func:`app.services.scope.authorize_resource`: personal
    points stay owner-only, points attached to a competition additionally open
    to that competition's members. A stranger can never tell "missing" from
    "somebody else's", because both are ``404``.
    """
    points: list[KnowledgePoint] = []
    for raw_id in point_ids:
        try:
            UUID(raw_id)
        except (ValueError, TypeError, AttributeError):
            raise _not_found() from None
        point = db.get(KnowledgePoint, raw_id)
        if point is None:
            raise _not_found()
        source = db.get(KnowledgeSource, point.source_id) if point.source_id else None
        authorize_resource(
            db,
            user,
            resource_user_id=point.user_id,
            competition_id=source.competition_id if source is not None else None,
        )
        points.append(point)
    return points


def _load_session(db: Session, session_id: str, user_id: str) -> PracticeSession:
    try:
        UUID(session_id)
    except (ValueError, TypeError, AttributeError):
        raise _not_found() from None
    session = db.get(PracticeSession, session_id)
    if session is None or str(session.user_id) != str(user_id):
        raise _not_found()
    return session


def _session_items(db: Session, session_id: str) -> list[PracticeItem]:
    rows = db.scalars(
        select(PracticeItem)
        .where(PracticeItem.session_id == session_id)
        .order_by(PracticeItem.position)
    )
    return list(rows.all())


def _current_item(items: list[PracticeItem]) -> PracticeItem | None:
    return next((item for item in items if item.correct is None), None)


def _progress(session: PracticeSession, items: list[PracticeItem]) -> ProgressOut:
    return ProgressOut(
        answered=session.answered_count,
        correct=session.correct_count,
        total=len(items),
    )


def _question_out(question: QuizQuestion, position: int) -> QuestionOut:
    return QuestionOut(
        id=question.id,
        no=position,
        type=question.type,
        difficulty=question.difficulty,
        stem=question.question,
        options=question.options,
    )


def _session_knowledge_point_ids(db: Session, items: list[PracticeItem]) -> list[str]:
    """Knowledge points reachable from the questions already issued.

    ``practice_sessions`` has no column for the requested id list (and this task
    must not add one), so the session's knowledge scope is derived from the
    questions it already contains. Every derived id is a subset of the ids the
    session was started with.
    """
    point_ids: list[str] = []
    seen: set[str] = set()
    for item in items:
        question = db.get(QuizQuestion, item.question_id)
        if question is None or question.knowledge_point_id in seen:
            continue
        seen.add(question.knowledge_point_id)
        point_ids.append(question.knowledge_point_id)
    return point_ids


def _pick_question(
    db: Session,
    *,
    knowledge_point_ids: list[str],
    difficulty: str,
    exclude_ids: list[str],
) -> QuizQuestion | None:
    """Pick the next unseen question, preferring ``difficulty``.

    Falls back to any difficulty when the preferred tier has no candidate. The
    caller guarantees ``knowledge_point_ids`` is non-empty.
    """
    if not knowledge_point_ids:
        return None
    stmt = select(QuizQuestion).where(
        QuizQuestion.knowledge_point_id.in_(knowledge_point_ids)
    )
    if exclude_ids:
        stmt = stmt.where(~QuizQuestion.id.in_(exclude_ids))
    order = (QuizQuestion.created_at, QuizQuestion.id)
    preferred = db.scalars(
        stmt.where(QuizQuestion.difficulty == difficulty).order_by(*order).limit(1)
    ).first()
    if preferred is not None:
        return preferred
    return db.scalars(stmt.order_by(*order).limit(1)).first()


def _adaptive_difficulty(current: str, items: list[PracticeItem]) -> str:
    """Apply the adaptive rule to the current trailing streak.

    Rule: **2 consecutive correct -> one step harder; 2 consecutive wrong ->
    one step easier**, clamped to easy/hard. Only an exact run of two triggers a
    step so a long streak does not keep escalating on every further answer.
    """
    streak = 0
    last: bool | None = None
    for item in items:
        if item.correct is None:
            continue
        if last is None or item.correct == last:
            streak += 1
        else:
            streak = 1
        last = item.correct
    if streak != 2 or last is None:
        return current

    index = _STEP.get(current, 0)
    index = index + 1 if last else index - 1
    index = max(0, min(index, len(_DIFFICULTY_ORDER) - 1))
    return _DIFFICULTY_ORDER[index]


def _append_item(
    db: Session,
    *,
    session: PracticeSession,
    question: QuizQuestion,
    position: int,
) -> PracticeItem:
    item = PracticeItem(
        session_id=session.id,
        question_id=question.id,
        position=position,
        difficulty=question.difficulty,
    )
    db.add(item)
    return item


@router.post(
    "/sessions",
    response_model=SessionStartOut,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    payload: SessionCreate, db: DbSession, user: CurrentUser
) -> SessionStartOut:
    if payload.competition_id is not None:
        resolve_scope(db, user, payload.competition_id)

    prefs = user.learning_prefs or {}
    difficulty = payload.difficulty or prefs.get("default_difficulty") or "easy"
    count = payload.count or prefs.get("default_quiz_num") or 1
    count = max(1, min(int(count), PRACTICE_MAX_ITEMS))

    points = _load_visible_points(db, user, payload.knowledge_point_ids)
    point_ids = [point.id for point in points]

    question = _pick_question(
        db,
        knowledge_point_ids=point_ids,
        difficulty=difficulty,
        exclude_ids=[],
    )
    if question is None:
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=NO_QUESTIONS_DETAIL,
            code="NO_QUESTIONS",
        )

    session = PracticeSession(
        user_id=user.id,
        competition_id=payload.competition_id,
        difficulty=difficulty,
        status="active",
    )
    try:
        db.add(session)
        db.flush()
        item = _append_item(db, session=session, question=question, position=1)
        db.flush()
        db.commit()
    except Exception:
        db.rollback()
        raise

    return SessionStartOut(
        session_id=session.id,
        difficulty=session.difficulty,
        status=session.status,
        progress=_progress(session, [item]),
        current_question=_question_out(question, item.position),
    )


@router.post("/sessions/{session_id}/answer", response_model=AnswerOut)
def answer_question(
    session_id: str, payload: AnswerIn, db: DbSession, user: CurrentUser
) -> AnswerOut:
    session = _load_session(db, session_id, user.id)
    if session.status != "active":
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SESSION_ENDED_DETAIL,
            code="SESSION_ENDED",
        )

    items = _session_items(db, session.id)
    if len(items) >= PRACTICE_MAX_ITEMS:
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SESSION_LIMIT_DETAIL,
            code="SESSION_LIMIT",
        )

    current = _current_item(items)
    if current is None or str(current.question_id) != str(payload.question_id):
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=NOT_CURRENT_QUESTION_DETAIL,
            code="NOT_CURRENT_QUESTION",
        )

    question = db.get(QuizQuestion, current.question_id)
    if question is None:
        raise _not_found()

    correct, correct_answer = grade(question, payload.answer)

    try:
        current.answer = payload.answer
        current.correct = correct
        session.answered_count += 1
        if correct:
            session.correct_count += 1
        session.difficulty = _adaptive_difficulty(session.difficulty, items)

        next_question = _pick_question(
            db,
            knowledge_point_ids=_session_knowledge_point_ids(db, items),
            difficulty=session.difficulty,
            exclude_ids=[item.question_id for item in items],
        )
        next_item = None
        if next_question is not None:
            next_item = _append_item(
                db, session=session, question=next_question, position=len(items) + 1
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    current_question = None
    if next_question is not None and next_item is not None:
        current_question = _question_out(next_question, next_item.position)
    progress_items = items if next_item is None else [*items, next_item]

    return AnswerOut(
        correct=correct,
        correct_answer=correct_answer,
        explanation=question.explanation,
        difficulty=session.difficulty,
        progress=_progress(session, progress_items),
        current_question=current_question,
        finished=next_item is None,
    )


@router.get("/sessions/{session_id}", response_model=SessionDetailOut)
def read_session(
    session_id: str, db: DbSession, user: CurrentUser
) -> SessionDetailOut:
    session = _load_session(db, session_id, user.id)
    items = _session_items(db, session.id)
    current = _current_item(items)

    history: list[HistoryItemOut] = []
    for item in items:
        question = db.get(QuizQuestion, item.question_id)
        answered = item.correct is not None
        reference = ""
        if answered and question is not None:
            _, reference = grade(question, "")
        history.append(
            HistoryItemOut(
                question_id=item.question_id,
                no=item.position,
                type=question.type if question is not None else "",
                difficulty=item.difficulty,
                stem=question.question if question is not None else "",
                options=question.options if question is not None else None,
                answered=answered,
                answer=item.answer,
                correct=item.correct,
                correct_answer=reference if answered else None,
                explanation=(
                    question.explanation if answered and question is not None else None
                ),
            )
        )

    current_question = None
    if current is not None:
        current_row = db.get(QuizQuestion, current.question_id)
        if current_row is not None:
            current_question = _question_out(current_row, current.position)

    return SessionDetailOut(
        session_id=session.id,
        difficulty=session.difficulty,
        status=session.status,
        progress=_progress(session, items),
        current_question=current_question,
        items=history,
        ended_at=session.ended_at,
    )


@router.post("/sessions/{session_id}/end", response_model=SessionEndOut)
def end_session(
    session_id: str, db: DbSession, user: CurrentUser
) -> SessionEndOut:
    session = _load_session(db, session_id, user.id)

    if session.status != "ended":
        session.status = "ended"
        session.ended_at = datetime.now(UTC)
        db.commit()
        db.refresh(session)

    ended_at = session.ended_at or datetime.now(UTC)
    answered = session.answered_count
    correct = session.correct_count
    accuracy = round(correct / answered, 4) if answered else 0.0
    return SessionEndOut(
        answered=answered, correct=correct, accuracy=accuracy, ended_at=ended_at
    )
