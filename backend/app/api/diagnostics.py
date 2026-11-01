"""Wrong-question diagnostics derived from ``quiz_attempts``.

There is no dedicated wrong-question table: every view here is an aggregate over
the append-only attempt log, joined back to ``quiz_questions`` for the stem,
options and explanation. A per-user ``wrong_question_dismissals`` row hides a
question from the list without touching the attempts.

Endpoints
---------
``GET    /api/wrong-questions``          paginated list, filtered by
                                        competition / type / severity / text.
``DELETE /api/wrong-questions/{id}``     soft hide (idempotent, 204).
``GET    /api/assistant/weak-points``    knowledge points ranked by
                                        ``error_rate * 0.7 + (1 - mastery) * 0.3``.
``POST   /api/assistant/remediation-plan`` weak points plus recommended drills.

The two ``GET`` endpoints never write; the only write is the dismissal insert.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Query, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import CodedHTTPException
from app.deps import CurrentUser, DbSession
from app.models import (
    KnowledgePoint,
    QuizAttempt,
    QuizQuestion,
    WrongQuestionDismissal,
)

router = APIRouter(tags=["diagnostics"])

NOT_FOUND_DETAIL = "资源不存在"
REPEAT_THRESHOLD = 3
WEAK_POINT_LIMIT = 10
REMEDIATION_DEFAULT_LIMIT = 5
RECOMMENDED_PER_POINT = 3
EMPTY_GUIDANCE = "先做一轮诊断练习，再生成补强清单"

Severity = Literal["repeat", "general"]
QueryType = Literal["choice", "multiple", "judge", "short_answer", "blank"]
WrongType = Literal["choice", "multiple", "blank", "judge"]

_BACKEND_TYPE: dict[str, str] = {
    "choice": "choice",
    "multiple": "choice",
    "judge": "judge",
    "short_answer": "short_answer",
    "blank": "short_answer",
}
_FRONTEND_TYPE: dict[str, WrongType] = {
    "choice": "choice",
    "judge": "judge",
    "short_answer": "blank",
}

_OPTION_RE = re.compile(r"^\s*([A-Za-z])\s*[.、:：)．]\s*(.*)$")


class WrongOptionOut(BaseModel):
    key: str
    text: str


class WrongOptionNoteOut(BaseModel):
    key: str
    verdict: Literal["correct", "wrong"]
    text: str


class WrongAnalysisOut(BaseModel):
    answer: str | None = None
    steps: list[str] | None = None
    choiceAnswer: str | None = None
    optionNotes: list[WrongOptionNoteOut] | None = None
    conclusion: str


class WrongQuestionOut(BaseModel):
    id: str
    severity: Severity
    type: WrongType
    stem: str
    options: list[WrongOptionOut] | None = None
    tags: list[str]
    myMistake: str
    wrongCount: int
    analysis: WrongAnalysisOut


class WeakPointOut(BaseModel):
    knowledge_point_id: str
    title: str
    total_attempts: int
    wrong_attempts: int
    error_rate: float
    mastery_score: float
    score: float


class RecommendedQuestionOut(BaseModel):
    id: str
    stem: str
    type: WrongType
    wrong_count: int


class RemediationItemOut(BaseModel):
    knowledge_point_id: str
    title: str
    error_rate: float
    recommended_questions: list[RecommendedQuestionOut]


class RemediationPlanOut(BaseModel):
    items: list[RemediationItemOut]
    guidance: str | None = None


class RemediationRequest(BaseModel):
    competition_id: UUID | None = None
    limit: int = Field(default=REMEDIATION_DEFAULT_LIMIT, ge=1, le=50)


def _coded_error(status_code: int, detail: str, code: str) -> JSONResponse:
    """Emit the ``{detail, code}`` body for paths outside ``NEW_API_PREFIXES``.

    ``/api/wrong-questions`` is a new endpoint but not part of the prefixes the
    global error handler scopes the additive ``code`` field to, so the coded
    body is produced here instead of relying on that handler.
    """
    exc = CodedHTTPException(status_code=status_code, detail=detail, code=code)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code},
    )


def _not_found() -> JSONResponse:
    return _coded_error(status.HTTP_404_NOT_FOUND, NOT_FOUND_DETAIL, "NOT_FOUND")


def _answer_key(value: str) -> str:
    token = (value or "").strip().upper()
    return token[:1] if token else ""


def _option_entries(options: list[str] | None) -> list[WrongOptionOut] | None:
    """Map stored option strings into ``{key, text}`` pairs.

    Stored options are either ``["A. text", ...]`` or bare ``["text", ...]``;
    an explicit ``A.`` / ``A、`` prefix is stripped, otherwise keys are
    synthesised from the list order (``A``, ``B``, ``C`` ...).
    """
    if not options:
        return None
    entries: list[WrongOptionOut] = []
    for index, raw in enumerate(options):
        text = str(raw)
        match = _OPTION_RE.match(text)
        if match is not None:
            key = match.group(1).upper()
            label = match.group(2).strip()
        else:
            key = chr(ord("A") + index) if index < 26 else str(index + 1)
            label = text.strip()
        entries.append(WrongOptionOut(key=key, text=label))
    return entries


def _option_notes(
    question: QuizQuestion,
    entries: list[WrongOptionOut] | None,
    my_mistake: str,
) -> list[WrongOptionNoteOut] | None:
    if question.type != "choice" or not entries:
        return None
    by_key = {entry.key: entry.text for entry in entries}
    notes: list[WrongOptionNoteOut] = []
    correct_key = _answer_key(question.answer)
    mistake_key = _answer_key(my_mistake)
    if correct_key in by_key:
        notes.append(
            WrongOptionNoteOut(
                key=correct_key, verdict="correct", text=by_key[correct_key]
            )
        )
    if mistake_key and mistake_key != correct_key and mistake_key in by_key:
        notes.append(
            WrongOptionNoteOut(
                key=mistake_key, verdict="wrong", text=by_key[mistake_key]
            )
        )
    return notes or None


def _latest_wrong_subquery(user_id: str):
    return (
        select(
            QuizAttempt.question_id.label("question_id"),
            QuizAttempt.answer.label("latest_answer"),
            QuizAttempt.created_at.label("latest_at"),
            func.count()
            .over(partition_by=QuizAttempt.question_id)
            .label("wrong_count"),
            func.row_number()
            .over(
                partition_by=QuizAttempt.question_id,
                order_by=(QuizAttempt.created_at.desc(), QuizAttempt.id.desc()),
            )
            .label("row_number"),
        )
        .where(
            QuizAttempt.user_id == user_id,
            QuizAttempt.correct.is_(False),
        )
        .subquery()
    )


def _wrong_question_statement(
    user_id: str,
    *,
    competition_id: str | None,
    backend_type: str | None,
    severity: Severity | None,
    text: str | None,
):
    latest = _latest_wrong_subquery(user_id)
    dismissed = (
        select(WrongQuestionDismissal.id)
        .where(
            WrongQuestionDismissal.user_id == user_id,
            WrongQuestionDismissal.question_id == QuizQuestion.id,
        )
        .exists()
    )
    statement = (
        select(
            QuizQuestion,
            latest.c.wrong_count,
            latest.c.latest_answer,
            KnowledgePoint.title,
        )
        .join(latest, latest.c.question_id == QuizQuestion.id)
        .outerjoin(KnowledgePoint, KnowledgePoint.id == QuizQuestion.knowledge_point_id)
        .where(latest.c.row_number == 1)
        .where(~dismissed)
    )
    if competition_id:
        statement = statement.where(QuizQuestion.competition_id == competition_id)
    if backend_type:
        statement = statement.where(QuizQuestion.type == backend_type)
    if severity == "repeat":
        statement = statement.where(latest.c.wrong_count >= REPEAT_THRESHOLD)
    elif severity == "general":
        statement = statement.where(latest.c.wrong_count < REPEAT_THRESHOLD)
    if text:
        needle = f"%{text}%"
        statement = statement.where(
            or_(
                QuizQuestion.question.ilike(needle),
                KnowledgePoint.title.ilike(needle),
            )
        )
    return statement, latest


def _to_wrong_question(
    question: QuizQuestion,
    wrong_count: int,
    latest_answer: str,
    knowledge_title: str | None,
) -> WrongQuestionOut:
    entries = _option_entries(question.options)
    return WrongQuestionOut(
        id=question.id,
        severity="repeat" if wrong_count >= REPEAT_THRESHOLD else "general",
        type=_FRONTEND_TYPE.get(question.type, "blank"),
        stem=question.question,
        options=entries,
        tags=[knowledge_title] if knowledge_title else [],
        myMistake=latest_answer,
        wrongCount=int(wrong_count),
        analysis=WrongAnalysisOut(
            answer=question.answer,
            choiceAnswer=question.answer,
            optionNotes=_option_notes(question, entries, latest_answer),
            conclusion=question.explanation,
        ),
    )


@router.get("/api/wrong-questions", response_model=list[WrongQuestionOut])
def list_wrong_questions(
    db: DbSession,
    user: CurrentUser,
    response: Response,
    competition_id: Annotated[UUID | None, Query()] = None,
    type: Annotated[QueryType | None, Query()] = None,
    severity: Annotated[Severity | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[WrongQuestionOut]:
    user_id = str(user.id)
    backend_type = _BACKEND_TYPE[type] if type else None
    statement, latest = _wrong_question_statement(
        user_id,
        competition_id=str(competition_id) if competition_id else None,
        backend_type=backend_type,
        severity=severity,
        text=q,
    )

    total = int(
        db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
        or 0
    )
    response.headers["X-Total-Count"] = str(total)

    rows = db.execute(
        statement.order_by(
            latest.c.wrong_count.desc(),
            latest.c.latest_at.desc(),
            QuizQuestion.id,
        )
        .limit(limit)
        .offset(offset)
    ).all()
    return [
        _to_wrong_question(
            cast(QuizQuestion, question),
            cast(int, wrong_count),
            cast(str, latest_answer),
            cast(str | None, title),
        )
        for question, wrong_count, latest_answer, title in rows
    ]


@router.delete("/api/wrong-questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_wrong_question(
    question_id: str,
    db: DbSession,
    user: CurrentUser,
) -> Response:
    try:
        UUID(question_id)
    except (ValueError, TypeError, AttributeError):
        return _not_found()

    user_id = str(user.id)
    answered_wrong = db.scalar(
        select(QuizAttempt.id)
        .where(
            QuizAttempt.user_id == user_id,
            QuizAttempt.question_id == question_id,
            QuizAttempt.correct.is_(False),
        )
        .limit(1)
    )
    if answered_wrong is None:
        return _not_found()

    existing = db.scalar(
        select(WrongQuestionDismissal.id).where(
            WrongQuestionDismissal.user_id == user_id,
            WrongQuestionDismissal.question_id == question_id,
        )
    )
    if existing is None:
        try:
            db.add(
                WrongQuestionDismissal(user_id=user_id, question_id=question_id)
            )
            db.commit()
        except IntegrityError:
            db.rollback()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _rank_weak_points(
    db: Session,
    *,
    user_id: str,
    competition_id: str | None,
    limit: int,
) -> list[WeakPointOut]:
    aggregate = (
        select(
            QuizQuestion.knowledge_point_id.label("knowledge_point_id"),
            func.count(QuizAttempt.id).label("total_attempts"),
            func.count(
                case((QuizAttempt.correct.is_(False), 1))
            ).label("wrong_attempts"),
        )
        .join(QuizAttempt, QuizAttempt.question_id == QuizQuestion.id)
        .where(QuizAttempt.user_id == user_id)
        .group_by(QuizQuestion.knowledge_point_id)
    )
    if competition_id:
        aggregate = aggregate.where(QuizQuestion.competition_id == competition_id)
    grouped = aggregate.subquery()

    rows = db.execute(
        select(
            KnowledgePoint.id,
            KnowledgePoint.title,
            KnowledgePoint.mastery_score,
            grouped.c.total_attempts,
            grouped.c.wrong_attempts,
        ).join(grouped, grouped.c.knowledge_point_id == KnowledgePoint.id)
    ).all()

    ranked: list[WeakPointOut] = []
    for point_id, title, mastery, total, wrong in rows:
        total_attempts = int(cast(int, total))
        if total_attempts <= 0:
            continue
        wrong_attempts = int(cast(int, wrong))
        error_rate = wrong_attempts / total_attempts
        mastery_score = float(cast(float, mastery or 0.0))
        score = error_rate * 0.7 + (1.0 - mastery_score) * 0.3
        ranked.append(
            WeakPointOut(
                knowledge_point_id=cast(str, point_id),
                title=cast(str, title),
                total_attempts=total_attempts,
                wrong_attempts=wrong_attempts,
                error_rate=error_rate,
                mastery_score=mastery_score,
                score=score,
            )
        )
    ranked.sort(key=lambda item: (-item.score, -item.error_rate, item.title))
    return ranked[:limit]


@router.get("/api/assistant/weak-points", response_model=list[WeakPointOut])
def list_weak_points(
    db: DbSession,
    user: CurrentUser,
    competition_id: Annotated[UUID | None, Query()] = None,
) -> list[WeakPointOut]:
    return _rank_weak_points(
        db,
        user_id=str(user.id),
        competition_id=str(competition_id) if competition_id else None,
        limit=WEAK_POINT_LIMIT,
    )


def _recommended_questions(
    db: Session,
    *,
    user_id: str,
    knowledge_point_id: str,
    competition_id: str | None,
) -> list[RecommendedQuestionOut]:
    wrong_count = func.count(QuizAttempt.id).label("wrong_count")
    statement = (
        select(QuizQuestion, wrong_count)
        .join(
            QuizAttempt,
            QuizAttempt.question_id == QuizQuestion.id,
        )
        .where(
            QuizQuestion.knowledge_point_id == knowledge_point_id,
            QuizAttempt.user_id == user_id,
            QuizAttempt.correct.is_(False),
        )
        .group_by(QuizQuestion.id)
        .order_by(wrong_count.desc(), QuizQuestion.id)
        .limit(RECOMMENDED_PER_POINT)
    )
    if competition_id:
        statement = statement.where(QuizQuestion.competition_id == competition_id)
    rows = db.execute(statement).all()
    return [
        RecommendedQuestionOut(
            id=question.id,
            stem=question.question,
            type=_FRONTEND_TYPE.get(question.type, "blank"),
            wrong_count=int(count),
        )
        for question, count in rows
    ]


@router.post("/api/assistant/remediation-plan", response_model=RemediationPlanOut)
def remediation_plan(
    payload: RemediationRequest,
    db: DbSession,
    user: CurrentUser,
) -> RemediationPlanOut:
    user_id = str(user.id)
    competition_id = (
        str(payload.competition_id) if payload.competition_id else None
    )
    weak_points = _rank_weak_points(
        db,
        user_id=user_id,
        competition_id=competition_id,
        limit=payload.limit,
    )
    if not weak_points:
        return RemediationPlanOut(items=[], guidance=EMPTY_GUIDANCE)

    items = [
        RemediationItemOut(
            knowledge_point_id=point.knowledge_point_id,
            title=point.title,
            error_rate=point.error_rate,
            recommended_questions=_recommended_questions(
                db,
                user_id=user_id,
                knowledge_point_id=point.knowledge_point_id,
                competition_id=competition_id,
            ),
        )
        for point in weak_points
    ]
    return RemediationPlanOut(items=items)
