"""Review-card endpoints.

``GET /api/review/cards`` lists the current user's cards (optional ``state``
filter, newest due first). ``POST /api/review/cards`` creates a manual card.
Wrong-answer cards are created by :mod:`app.services.cards` from the quiz answer
endpoint.

The spaced-repetition section at the bottom of the file adds the due queue
(``GET /due``), the DSR-backed, idempotent submission (``POST /{card_id}/submit``)
and the counters (``GET /stats``); see :mod:`app.services.review`.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.deps import CurrentUser, DbSession, require_owner
from app.models import KnowledgePoint, KnowledgeSource, ReviewCard, User
from app.services.cards import create_manual_card, list_cards
from app.services.review import (
    DUE_LIMIT_DEFAULT,
    due_cards,
    review_stats,
    submit_review,
    today_local,
)
from app.services.scope import authorize_resource

router = APIRouter(prefix="/api/review", tags=["review"])

_NOT_FOUND = "资源不存在"
_EMPTY_FIELD = "内容不能为空"
_DEFAULT_LIMIT = 50


class ReviewCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    knowledge_point_id: str | None
    quiz_question_id: str | None
    question: str
    answer: str
    card_type: str
    difficulty: float
    stability: float
    retrievability: float
    state: int
    reps: int
    lapses: int
    due_date: date | None
    last_review: datetime | None
    scheduler: str
    created_at: datetime
    updated_at: datetime


class ReviewCardCreate(BaseModel):
    knowledge_point_id: str | None = None
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)


def _load_point(db: DbSession, point_id: str, user: User) -> KnowledgePoint:
    try:
        UUID(point_id)
    except (ValueError, TypeError, AttributeError):
        raise _not_found() from None
    point = db.get(KnowledgePoint, point_id)
    if point is None:
        raise _not_found()
    source = db.get(KnowledgeSource, point.source_id) if point.source_id else None
    authorize_resource(
        db,
        user,
        resource_user_id=point.user_id,
        competition_id=source.competition_id if source is not None else None,
    )
    return point


@router.get("/cards", response_model=list[ReviewCardOut])
def list_review_cards(
    db: DbSession,
    user: CurrentUser,
    state: int | None = Query(default=None, ge=0),
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1),
) -> list[ReviewCardOut]:
    rows = list_cards(db, user_id=user.id, state=state, limit=limit)
    return [ReviewCardOut.model_validate(row) for row in rows]


@router.post(
    "/cards",
    status_code=status.HTTP_201_CREATED,
    response_model=ReviewCardOut,
)
def create_review_card(
    payload: ReviewCardCreate,
    db: DbSession,
    user: CurrentUser,
) -> ReviewCardOut:
    question = payload.question.strip()
    answer = payload.answer.strip()
    if not question or not answer:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=_EMPTY_FIELD
        )

    point_id: str | None = None
    if payload.knowledge_point_id is not None:
        point_id = _load_point(db, payload.knowledge_point_id, user).id

    card = create_manual_card(
        db,
        user_id=user.id,
        question=question,
        answer=answer,
        knowledge_point_id=point_id,
    )
    db.commit()
    db.refresh(card)
    return ReviewCardOut.model_validate(card)


# --- Spaced repetition (Task 22) -------------------------------------------
# The routes below must stay below the /cards block: FastAPI matches in
# declaration order and ``/due`` / ``/stats`` are static paths.

_RATING_OUT_OF_RANGE = "评分需在 1-5 之间"


class DueCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    question: str
    answer: str
    knowledge_point_id: str | None
    due_date: date | None
    state: int
    reps: int
    lapses: int
    difficulty: float
    stability: float
    retrievability: float


class DueListOut(BaseModel):
    cards: list[DueCardOut]
    count: int


class ReviewSubmitIn(BaseModel):
    rating: int
    response_time_ms: int | None = Field(default=None, ge=0)


class ReviewSubmitOut(BaseModel):
    card_id: str
    next_due_date: date
    interval_days: int
    stability: float
    difficulty: float
    state: int
    reps: int
    lapses: int
    idempotent: bool


class ReviewStatsOut(BaseModel):
    due_count: int
    reviewed_today: int
    streak_days: int
    total_cards: int


def _load_card(db: DbSession, card_id: str, user: User) -> ReviewCard:
    try:
        UUID(card_id)
    except (ValueError, TypeError, AttributeError):
        raise _not_found() from None
    card = db.get(ReviewCard, card_id)
    if card is None:
        raise _not_found()
    require_owner(card.user_id, user)
    return card


@router.get("/due", response_model=DueListOut)
def list_due_cards(
    db: DbSession,
    user: CurrentUser,
    day: Annotated[date | None, Query(alias="date")] = None,
    limit: int = Query(default=DUE_LIMIT_DEFAULT, ge=1),
) -> DueListOut:
    as_of = day if day is not None else today_local()
    views = due_cards(db, user_id=user.id, as_of=as_of, limit=limit)
    cards = [DueCardOut.model_validate(view) for view in views]
    return DueListOut(cards=cards, count=len(cards))


@router.post("/{card_id}/submit", response_model=ReviewSubmitOut)
def submit_card_review(
    card_id: str,
    payload: ReviewSubmitIn,
    db: DbSession,
    user: CurrentUser,
) -> ReviewSubmitOut:
    if not 1 <= payload.rating <= 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_RATING_OUT_OF_RANGE
        )

    card = _load_card(db, card_id, user)
    outcome = submit_review(
        db,
        card=card,
        rating=payload.rating,
        response_time_ms=payload.response_time_ms,
    )
    db.commit()
    db.refresh(outcome.card)

    next_due = outcome.card.due_date
    if next_due is None:  # pragma: no cover - a submitted card always has a due date
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="调度器未返回下次复习日期",
        )
    return ReviewSubmitOut(
        card_id=outcome.card.id,
        next_due_date=next_due,
        interval_days=outcome.log.scheduled_days,
        stability=outcome.card.stability,
        difficulty=outcome.card.difficulty,
        state=outcome.card.state,
        reps=outcome.card.reps,
        lapses=outcome.card.lapses,
        idempotent=outcome.idempotent,
    )


@router.get("/stats", response_model=ReviewStatsOut)
def get_review_stats(db: DbSession, user: CurrentUser) -> ReviewStatsOut:
    stats = review_stats(db, user_id=user.id)
    return ReviewStatsOut(
        due_count=stats.due_count,
        reviewed_today=stats.reviewed_today,
        streak_days=stats.streak_days,
        total_cards=stats.total_cards,
    )
