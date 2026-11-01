"""Trial exams: persisted question sets graded server-side.

Starting an exam freezes the ordered question ids on the ``trial_exams`` row,
so a refresh cannot reshuffle the paper. Answers are only ever compared on the
server with :func:`app.services.answer.grade`; the client never receives the
reference answer before submitting. Re-submitting a submitted exam replays the
stored result without re-scoring or writing duplicate ``trial_answers`` rows.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import CodedHTTPException
from app.deps import CurrentUser, DbSession
from app.models import (
    QuizQuestion,
    TrialAnswer,
    TrialExam,
)
from app.services.answer import grade
from app.services.scope import resolve_scope

router = APIRouter(prefix="/api/trial", tags=["trial"])

NOT_FOUND_DETAIL = "资源不存在"
NO_QUESTIONS_DETAIL = "当前没有可用的题目"
EXAM_EXPIRED_DETAIL = "考试已过期"

DEFAULT_COUNT = 10
MIN_COUNT = 1
MAX_COUNT = 50
EXAM_MINUTES = 30
FULL_SCORE = 100

TYPE_MAP = {"choice": "choice", "judge": "judge", "short_answer": "blank"}
_OPTION_PREFIX_RE = re.compile(r"^\s*([A-Za-z])\s*[.、:：)．]\s*(.*)$", re.DOTALL)


def _not_found() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL, code="NOT_FOUND"
    )


class ExamStartRequest(BaseModel):
    competition_id: str | None = None
    count: int = Field(default=DEFAULT_COUNT, ge=MIN_COUNT, le=MAX_COUNT)


class OptionOut(BaseModel):
    key: str
    text: str


class QuestionOut(BaseModel):
    id: str
    no: int
    type: str
    score: int
    stem: str
    options: list[OptionOut] | None = None
    answered: bool = False


class ExamStartResponse(BaseModel):
    exam_id: str
    expires_at: datetime
    total: int
    questions: list[QuestionOut]


class SubmitRequest(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)


class TrialSourceChunkOut(BaseModel):
    content: str
    page: int | None = None
    heading: str | None = None


class ResultOut(BaseModel):
    question_id: str
    correct: bool
    my_answer: str
    correct_answer: str
    explanation: str
    source_chunk: TrialSourceChunkOut | None = None


class SubmitResponse(BaseModel):
    exam_id: str
    score: int
    total: int
    submitted_at: datetime
    results: list[ResultOut]


class ExamStateResponse(BaseModel):
    exam_id: str
    status: str
    score: int | None = None
    total: int
    expires_at: datetime
    submitted_at: datetime | None = None
    remaining_seconds: int
    questions: list[QuestionOut]
    results: list[ResultOut] | None = None


def _normalize_options(raw: Any) -> list[OptionOut] | None:
    """Normalise persisted options to ``[{key, text}]``.

    Stored rows are usually ``["A. 有机物", ...]`` but historical rows may hold
    objects or bare strings, so every shape is handled without changing text.
    """
    if not isinstance(raw, list) or not raw:
        return None
    options: list[OptionOut] = []
    for index, item in enumerate(raw):
        fallback_key = chr(ord("A") + index) if index < 26 else str(index + 1)
        if isinstance(item, dict):
            key = str(item.get("key") or fallback_key).strip().upper()
            text = str(item.get("text", item.get("content", ""))).strip()
        elif isinstance(item, str):
            match = _OPTION_PREFIX_RE.match(item)
            if match is not None:
                key = match.group(1).upper()
                text = match.group(2).strip()
            else:
                key = fallback_key
                text = item.strip()
        else:
            continue
        options.append(OptionOut(key=key, text=text))
    return options or None


def _score_per_question(total: int) -> int:
    return max(1, FULL_SCORE // total) if total else 0


def _question_out(question: QuizQuestion, no: int, score: int) -> QuestionOut:
    return QuestionOut(
        id=question.id,
        no=no,
        type=TYPE_MAP.get(question.type, question.type),
        score=score,
        stem=question.question,
        options=_normalize_options(question.options),
        answered=False,
    )


def _load_exam(db: Session, exam_id: str, user_id: str) -> TrialExam:
    try:
        UUID(exam_id)
    except (ValueError, TypeError, AttributeError):
        raise _not_found() from None
    exam = db.get(TrialExam, exam_id)
    if exam is None or str(exam.user_id) != str(user_id):
        raise _not_found()
    return exam


def _exam_questions(db: Session, exam: TrialExam) -> list[QuizQuestion]:
    questions: list[QuizQuestion] = []
    for question_id in exam.question_ids or []:
        question = db.get(QuizQuestion, question_id)
        if question is not None:
            questions.append(question)
    return questions


def _visible_questions(
    db: Session, *, user_id: str, competition_id: str | None, count: int
) -> list[QuizQuestion]:
    stmt = select(QuizQuestion)
    if competition_id is None:
        stmt = stmt.where(
            QuizQuestion.competition_id.is_(None),
            QuizQuestion.user_id == user_id,
        )
    else:
        resolve_scope(db, user_id, competition_id).require_read()
        stmt = stmt.where(QuizQuestion.competition_id == competition_id)
    stmt = stmt.order_by(QuizQuestion.created_at, QuizQuestion.id).limit(count)
    return list(db.scalars(stmt).all())


def _build_results(db: Session, exam: TrialExam) -> list[ResultOut]:
    rows = db.scalars(
        select(TrialAnswer).where(TrialAnswer.exam_id == exam.id)
    ).all()
    by_question = {row.question_id: row for row in rows}
    results: list[ResultOut] = []
    for question in _exam_questions(db, exam):
        row = by_question.get(question.id)
        _, correct_answer = grade(question, "")
        results.append(
            ResultOut(
                question_id=question.id,
                correct=bool(row.correct) if row is not None else False,
                my_answer=row.answer if row is not None else "",
                correct_answer=correct_answer,
                explanation=question.explanation,
                source_chunk=None,
            )
        )
    return results


def _submission(db: Session, exam: TrialExam) -> SubmitResponse:
    return SubmitResponse(
        exam_id=exam.id,
        score=int(exam.score or 0),
        total=exam.total,
        submitted_at=exam.submitted_at or datetime.now(UTC),
        results=_build_results(db, exam),
    )


@router.post(
    "/exams", response_model=ExamStartResponse, status_code=status.HTTP_201_CREATED
)
def start_exam(
    payload: ExamStartRequest, db: DbSession, user: CurrentUser
) -> ExamStartResponse:
    questions = _visible_questions(
        db,
        user_id=user.id,
        competition_id=payload.competition_id,
        count=payload.count,
    )
    if not questions:
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=NO_QUESTIONS_DETAIL,
            code="NO_QUESTIONS",
        )

    total = len(questions)
    now = datetime.now(UTC)
    exam = TrialExam(
        user_id=user.id,
        competition_id=payload.competition_id,
        question_ids=[question.id for question in questions],
        status="in_progress",
        total=total,
        started_at=now,
        expires_at=now + timedelta(minutes=EXAM_MINUTES),
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)

    score = _score_per_question(total)
    return ExamStartResponse(
        exam_id=exam.id,
        expires_at=exam.expires_at,
        total=total,
        questions=[
            _question_out(question, index + 1, score)
            for index, question in enumerate(questions)
        ],
    )


@router.post("/exams/{exam_id}/submit", response_model=SubmitResponse)
def submit_exam(
    exam_id: str, payload: SubmitRequest, db: DbSession, user: CurrentUser
) -> SubmitResponse:
    exam = _load_exam(db, exam_id, user.id)

    if exam.status == "submitted":
        return _submission(db, exam)

    now = datetime.now(UTC)
    if exam.status == "expired" or exam.expires_at <= now:
        if exam.status != "expired":
            exam.status = "expired"
            db.commit()
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=EXAM_EXPIRED_DETAIL,
            code="EXAM_EXPIRED",
        )

    questions = _exam_questions(db, exam)
    score = 0
    for question in questions:
        if question.id not in payload.answers:
            continue
        given = payload.answers[question.id]
        correct, _reference = grade(question, given)
        db.add(
            TrialAnswer(
                exam_id=exam.id,
                question_id=question.id,
                answer=given,
                correct=correct,
            )
        )
        if correct:
            score += 1

    exam.score = score
    exam.status = "submitted"
    exam.submitted_at = now
    db.commit()
    db.refresh(exam)
    return _submission(db, exam)


@router.get("/exams/{exam_id}", response_model=ExamStateResponse)
def read_exam(exam_id: str, db: DbSession, user: CurrentUser) -> ExamStateResponse:
    exam = _load_exam(db, exam_id, user.id)
    now = datetime.now(UTC)
    if exam.status == "in_progress" and exam.expires_at <= now:
        exam.status = "expired"
        db.commit()
        db.refresh(exam)

    remaining = max(0, int((exam.expires_at - now).total_seconds()))
    questions = _exam_questions(db, exam)
    score = _score_per_question(exam.total)
    submitted = exam.status == "submitted"
    return ExamStateResponse(
        exam_id=exam.id,
        status=exam.status,
        score=int(exam.score) if submitted and exam.score is not None else None,
        total=exam.total,
        expires_at=exam.expires_at,
        submitted_at=exam.submitted_at,
        remaining_seconds=remaining,
        questions=[
            _question_out(question, index + 1, score)
            for index, question in enumerate(questions)
        ],
        results=_build_results(db, exam) if submitted else None,
    )
