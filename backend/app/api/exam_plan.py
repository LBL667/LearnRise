"""Exam-preparation plans generated from a competition deadline and weak points.

``POST /api/assistant/exam-plan`` turns the learner's diagnostics (the ranked
weak points from :mod:`app.services.weak_points`) into one study item per day
until ``competitions.end_at``. Long horizons get a ``standard`` plan covering
every day; short horizons (fewer than :data:`SPRINT_THRESHOLD_DAYS`) collapse
into a ``sprint`` plan focused on weak points and the most-missed questions.

Review spacing is delegated to :mod:`app.services.dsr`; this module never
re-implements the interval maths. Generated plans are persisted in
``exam_plans`` so ``regenerate=false`` can replay the last result.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal, cast
from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import CodedHTTPException
from app.deps import CurrentUser, DbSession
from app.models import Competition, CompetitionMember, ExamPlan, QuizAttempt, QuizQuestion
from app.services.dsr import MemoryState
from app.services.dsr import review as dsr_review
from app.services.weak_points import WEAK_POINT_LIMIT, WeakPoint, rank_weak_points

router = APIRouter(tags=["assistant"])

SPRINT_THRESHOLD_DAYS = 7
DEFAULT_QUIZ_PER_DAY = 5
MAX_QUIZ_PER_DAY = 10
MAX_REVIEWS_PER_POINT = 12
STANDARD_RATING = 4

NOT_FOUND_DETAIL = "资源不存在"
MISSING_END_AT_DETAIL = "竞赛未设置结束时间"
EMPTY_GUIDANCE = "先做一轮诊断练习，再生成备考计划"

PlanMode = Literal["standard", "sprint"]


class ExamPlanRequest(BaseModel):
    competition_id: UUID
    regenerate: bool = True


class ExamPlanItemOut(BaseModel):
    date: str
    focus_kp_ids: list[str] = Field(default_factory=list)
    quiz_count: int = 0
    review_count: int = 0
    rationale: str = ""


class ExamPlanOut(BaseModel):
    mode: PlanMode
    competition_id: str
    end_at: datetime
    items: list[ExamPlanItemOut] = Field(default_factory=list)
    guidance: str | None = None
    generated_at: datetime


def _not_found() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
    )


def _missing_end_at() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=422, detail=MISSING_END_AT_DETAIL, code="VALIDATION_ERROR"
    )


def _visible_competition(db: Session, competition_id: str, user_id: str) -> Competition:
    competition = db.get(Competition, competition_id)
    if competition is None:
        raise _not_found()
    member = db.scalar(
        select(CompetitionMember.id).where(
            CompetitionMember.competition_id == competition_id,
            CompetitionMember.user_id == user_id,
        )
    )
    if member is None:
        raise _not_found()
    return competition


def _aware_utc(moment: datetime) -> datetime:
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _remaining_days(now: datetime, end_at: datetime) -> int:
    delta = (end_at - now).total_seconds()
    return max(1, math.ceil(delta / 86400))


def _has_attempts(db: Session, user_id: str) -> bool:
    return (
        db.scalar(select(QuizAttempt.id).where(QuizAttempt.user_id == user_id).limit(1))
        is not None
    )


def _most_wrong_question_kps(
    db: Session, *, user_id: str, competition_id: str
) -> list[str]:
    wrong_count = func.count(QuizAttempt.id).label("wrong_count")
    rows = db.execute(
        select(QuizQuestion.knowledge_point_id, wrong_count)
        .join(QuizAttempt, QuizAttempt.question_id == QuizQuestion.id)
        .where(
            QuizAttempt.user_id == user_id,
            QuizAttempt.correct.is_(False),
            QuizQuestion.competition_id == competition_id,
        )
        .group_by(QuizQuestion.id, QuizQuestion.knowledge_point_id)
        .order_by(wrong_count.desc(), QuizQuestion.id)
    ).all()

    ordered: list[str] = []
    for point_id, _count in rows:
        point = cast(str, point_id)
        if point not in ordered:
            ordered.append(point)
    return ordered


def _review_dates(start: date, end: date) -> list[date]:
    """Review dates produced by the DSR scheduler for one knowledge point."""

    dates: list[date] = []
    state = MemoryState()
    cursor = datetime.combine(start, time.min).replace(tzinfo=UTC)
    for _ in range(MAX_REVIEWS_PER_POINT):
        state = dsr_review(state, STANDARD_RATING, now=cursor)
        due = state.due_date
        if due is None or due > end:
            break
        dates.append(due)
        cursor = datetime.combine(due, time.min).replace(tzinfo=UTC)
    return dates


def _standard_items(
    weak_points: list[WeakPoint],
    *,
    count: int,
    end_date: date,
) -> list[ExamPlanItemOut]:
    start_date = end_date - timedelta(days=count - 1)
    reviews_by_point = {
        point.knowledge_point_id: _review_dates(start_date, end_date)
        for point in weak_points
    }

    items: list[ExamPlanItemOut] = []
    for offset in range(count):
        day = start_date + timedelta(days=offset)
        if weak_points:
            focus = [weak_points[offset % len(weak_points)]]
            focus_ids = [point.knowledge_point_id for point in focus]
            focus_title = focus[0].title
            rationale = f"主攻「{focus_title}」，完成 {DEFAULT_QUIZ_PER_DAY} 道练习"
        else:
            focus_ids = []
            rationale = f"综合巩固，完成 {DEFAULT_QUIZ_PER_DAY} 道练习"
        review_count = sum(
            1 for dates in reviews_by_point.values() if day in dates
        )
        items.append(
            ExamPlanItemOut(
                date=day.isoformat(),
                focus_kp_ids=focus_ids,
                quiz_count=DEFAULT_QUIZ_PER_DAY,
                review_count=review_count,
                rationale=rationale,
            )
        )
    return items


def _sprint_items(
    weak_points: list[WeakPoint],
    *,
    count: int,
    end_date: date,
    most_wrong_kps: list[str],
) -> list[ExamPlanItemOut]:
    start_date = end_date - timedelta(days=count - 1)
    reviews_by_point = {
        point.knowledge_point_id: _review_dates(start_date, end_date)
        for point in weak_points
    }
    focus_ids: list[str] = []
    for point in weak_points:
        if point.knowledge_point_id not in focus_ids:
            focus_ids.append(point.knowledge_point_id)
    for point_id in most_wrong_kps:
        if point_id not in focus_ids:
            focus_ids.append(point_id)

    per_day_quiz = (
        max(1, min(MAX_QUIZ_PER_DAY, math.ceil(len(most_wrong_kps) / count)))
        if most_wrong_kps
        else DEFAULT_QUIZ_PER_DAY
    )

    items: list[ExamPlanItemOut] = []
    for offset in range(count):
        day = start_date + timedelta(days=offset)
        review_count = sum(
            1 for dates in reviews_by_point.values() if day in dates
        )
        items.append(
            ExamPlanItemOut(
                date=day.isoformat(),
                focus_kp_ids=focus_ids,
                quiz_count=per_day_quiz,
                review_count=review_count,
                rationale=f"冲刺复习：主攻薄弱知识点与高频错题，完成 {per_day_quiz} 道练习",
            )
        )
    return items


def _from_stored(stored: ExamPlan, competition: Competition) -> ExamPlanOut:
    items = [ExamPlanItemOut.model_validate(item) for item in stored.items]
    return ExamPlanOut(
        mode=cast(PlanMode, stored.mode),
        competition_id=competition.id,
        end_at=_aware_utc(competition.end_at or datetime.now(UTC)),
        items=items,
        guidance=None if items else EMPTY_GUIDANCE,
        generated_at=_aware_utc(stored.generated_at),
    )


@router.post("/api/assistant/exam-plan", response_model=ExamPlanOut)
def generate_exam_plan(
    payload: ExamPlanRequest,
    db: DbSession,
    user: CurrentUser,
) -> ExamPlanOut:
    user_id = str(user.id)
    competition_id = str(payload.competition_id)
    competition = _visible_competition(db, competition_id, user_id)

    if competition.end_at is None:
        raise _missing_end_at()
    end_at = _aware_utc(competition.end_at)

    stored = db.scalar(
        select(ExamPlan)
        .where(
            ExamPlan.user_id == user_id,
            ExamPlan.competition_id == competition_id,
        )
        .order_by(ExamPlan.generated_at.desc(), ExamPlan.id)
        .limit(1)
    )
    if not payload.regenerate and stored is not None:
        return _from_stored(stored, competition)

    now = datetime.now(UTC)
    remaining = _remaining_days(now, end_at)
    mode: PlanMode = "standard" if remaining >= SPRINT_THRESHOLD_DAYS else "sprint"
    end_date = end_at.date()

    weak_points = rank_weak_points(
        db,
        user_id=user_id,
        competition_id=competition_id,
        limit=WEAK_POINT_LIMIT,
    )
    guidance: str | None = None
    if _has_attempts(db, user_id):
        if mode == "sprint":
            items = _sprint_items(
                weak_points,
                count=remaining,
                end_date=end_date,
                most_wrong_kps=_most_wrong_question_kps(
                    db, user_id=user_id, competition_id=competition_id
                ),
            )
        else:
            items = _standard_items(weak_points, count=remaining, end_date=end_date)
    else:
        items = []
        guidance = EMPTY_GUIDANCE

    if stored is not None:
        stored.mode = mode
        stored.items = [item.model_dump() for item in items]
        stored.generated_at = now
    else:
        stored = ExamPlan(
            user_id=user_id,
            competition_id=competition_id,
            mode=mode,
            items=[item.model_dump() for item in items],
            generated_at=now,
        )
        db.add(stored)
    db.commit()
    db.refresh(stored)

    return ExamPlanOut(
        mode=mode,
        competition_id=competition_id,
        end_at=end_at,
        items=items,
        guidance=guidance,
        generated_at=_aware_utc(stored.generated_at),
    )
