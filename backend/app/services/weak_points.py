"""Weak-point ranking derived from the append-only ``quiz_attempts`` log.

The ranking is shared by the diagnostics API (``GET /api/assistant/weak-points``
and the remediation plan) and by the exam-preparation planner. The score is
``error_rate * 0.7 + (1 - mastery_score) * 0.3``; ties break on the raw error
rate and then the knowledge-point title so the order is deterministic.

This module owns only the aggregation query. It is deliberately independent of
FastAPI so both the diagnostics and the exam-plan routers can reuse it without
importing one another.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import KnowledgePoint, QuizAttempt, QuizQuestion

__all__ = ["WeakPoint", "rank_weak_points"]

WEAK_POINT_LIMIT = 10
ERROR_RATE_WEIGHT = 0.7
MASTERY_WEIGHT = 0.3


@dataclass(frozen=True, slots=True)
class WeakPoint:
    """One knowledge point ranked by how badly the learner struggles with it."""

    knowledge_point_id: str
    title: str
    total_attempts: int
    wrong_attempts: int
    error_rate: float
    mastery_score: float
    score: float


def rank_weak_points(
    db: Session,
    *,
    user_id: str,
    competition_id: str | None,
    limit: int = WEAK_POINT_LIMIT,
) -> list[WeakPoint]:
    """Return up to ``limit`` weak points, worst first.

    ``competition_id`` narrows the attempts to questions tied to that
    competition; ``None`` considers every attempt of the user.
    """

    aggregate = (
        select(
            QuizQuestion.knowledge_point_id.label("knowledge_point_id"),
            func.count(QuizAttempt.id).label("total_attempts"),
            func.count(case((QuizAttempt.correct.is_(False), 1))).label("wrong_attempts"),
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

    ranked: list[WeakPoint] = []
    for point_id, title, mastery, total, wrong in rows:
        total_attempts = int(cast(int, total))
        if total_attempts <= 0:
            continue
        wrong_attempts = int(cast(int, wrong))
        error_rate = wrong_attempts / total_attempts
        mastery_score = float(cast(float, mastery or 0.0))
        score = error_rate * ERROR_RATE_WEIGHT + (1.0 - mastery_score) * MASTERY_WEIGHT
        ranked.append(
            WeakPoint(
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
