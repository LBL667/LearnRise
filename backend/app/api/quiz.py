"""Quiz generation endpoint.

``POST /api/quiz/generate`` retrieves grounded chunks for each requested
knowledge point, asks the configured agent for questions, validates them
strictly per type and persists only the valid rows. ``num`` outside 1-20 is a
``400``; an unknown or foreign knowledge point id is a ``404``; two invalid
LLM payloads are reported as ``422`` with the truncated raw text.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.deps import CurrentUser, DbSession
from app.services.answer import (
    QuizQuestionNotFound,
    list_attempts,
    submit_answer,
)
from app.services.quiz import (
    FAILURE_MESSAGE,
    MAX_NUM,
    QuizGenerationError,
    QuizKPNotFound,
    generate_questions,
)

router = APIRouter(prefix="/api/quiz", tags=["quiz"])

_NOT_FOUND = "资源不存在"
_EMPTY_KP = "知识点列表不能为空"
_BAD_NUM = f"生成数量需在 1-{MAX_NUM} 之间"

QuizType = Literal["choice", "judge", "short_answer"]
Difficulty = Literal["easy", "medium", "hard"]


class QuizGenerateRequest(BaseModel):
    knowledge_point_ids: list[str] = Field(default_factory=list)
    type: QuizType | None = None
    num: int | None = None
    difficulty: Difficulty | None = None


class QuizItemOut(BaseModel):
    id: str
    type: str
    question: str
    options: list[str] | None
    answer: str
    explanation: str
    difficulty: str


class QuizGenerateResponse(BaseModel):
    created: list[QuizItemOut]
    model: str


@router.post(
    "/generate",
    status_code=status.HTTP_201_CREATED,
    response_model=QuizGenerateResponse,
)
def generate_quiz(
    payload: QuizGenerateRequest,
    db: DbSession,
    user: CurrentUser,
) -> QuizGenerateResponse:
    if not payload.knowledge_point_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_EMPTY_KP
        )

    prefs = user.learning_prefs or {}
    difficulty = payload.difficulty or prefs.get("default_difficulty") or "medium"
    qtype = payload.type or (prefs.get("default_question_types") or ["choice"])[0]
    num = (
        payload.num
        if payload.num is not None
        else (prefs.get("default_quiz_num") or 5)
    )
    if not 1 <= num <= MAX_NUM:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_BAD_NUM
        )

    try:
        rows, model = generate_questions(
            db,
            user_id=user.id,
            kp_ids=payload.knowledge_point_ids,
            qtype=qtype,
            num=num,
            difficulty=difficulty,
        )
    except QuizKPNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND
        ) from None
    except QuizGenerationError as exc:
        raise HTTPException(
            status_code=422,
            detail={"message": FAILURE_MESSAGE, "raw": exc.raw},
        ) from None

    return QuizGenerateResponse(
        created=[
            QuizItemOut(
                id=row.id,
                type=row.type,
                question=row.question,
                options=row.options,
                answer=row.answer,
                explanation=row.explanation,
                difficulty=row.difficulty,
            )
            for row in rows
        ],
        model=model,
    )


class AnswerRequest(BaseModel):
    answer: str
    response_time_ms: int | None = None


class SourceChunkOut(BaseModel):
    content: str
    page: int | None
    heading: str | None


class AnswerResponse(BaseModel):
    correct: bool
    correct_answer: str
    explanation: str
    source_chunk: SourceChunkOut | None
    card_created: bool


class AttemptOut(BaseModel):
    id: str
    answer: str
    correct: bool
    response_time_ms: int | None
    created_at: datetime


@router.post("/{question_id}/answer", response_model=AnswerResponse)
def answer_question(
    question_id: str,
    payload: AnswerRequest,
    db: DbSession,
    user: CurrentUser,
) -> AnswerResponse:
    try:
        result = submit_answer(
            db,
            user_id=user.id,
            question_id=question_id,
            answer=payload.answer,
            response_time_ms=payload.response_time_ms,
        )
    except QuizQuestionNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND
        ) from None

    chunk = result.source_chunk
    return AnswerResponse(
        correct=result.correct,
        correct_answer=result.correct_answer,
        explanation=result.explanation,
        source_chunk=(
            None
            if chunk is None
            else SourceChunkOut(
                content=chunk.content, page=chunk.page, heading=chunk.heading
            )
        ),
        card_created=result.card_created,
    )


@router.get("/{question_id}/attempts", response_model=list[AttemptOut])
def list_question_attempts(
    question_id: str,
    db: DbSession,
    user: CurrentUser,
) -> list[AttemptOut]:
    try:
        rows = list_attempts(db, user_id=user.id, question_id=question_id)
    except QuizQuestionNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND
        ) from None

    return [
        AttemptOut(
            id=row.id,
            answer=row.answer,
            correct=row.correct,
            response_time_ms=row.response_time_ms,
            created_at=row.created_at,
        )
        for row in rows
    ]
