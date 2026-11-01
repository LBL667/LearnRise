"""Socratic-mode guardrails shared by the assistant and the explainer.

Both ``/api/assistant`` and ``/api/knowledge-points/{id}/explain`` can run in
``socratic`` mode. The prompt tells the model to ask guiding questions instead
of stating the conclusion, but prompt instructions alone are not trustworthy:
a provider can still echo the retrieved context verbatim. Every generated
reply is therefore checked against the answers of the quiz questions attached
to the knowledge points that were just retrieved. A leaked answer is replaced
with a guiding question and the caller is told a rewrite happened.

The check is deliberately cheap: the answer list is loaded once per response
and every reply is scanned a single time per candidate answer. Whitespace is
normalised and matching is case-insensitive so a provider cannot dodge the
guard by wrapping the answer across lines.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import QuizQuestion

SOCRATIC_SYSTEM_GUIDANCE = (
    "当前处于苏格拉底引导模式：不要直接给出结论或最终答案，"
    "而是通过逐步提问引导学生自己推导；每次只问一个关键问题，"
    "可以给出必要的提示，但不得复述任何标准答案。"
)

GUIDING_REPLACEMENT = "（先想一想：这一步是怎么推导出来的？）"

_WHITESPACE_RE = re.compile(r"\s+")

#: Answers shorter than this carry no conclusion (e.g. a choice letter) and
#: would only produce false positives when matched inside ordinary prose.
_MIN_ANSWER_CHARS = 2


def normalize(text: str) -> str:
    """Collapse whitespace and lowercase so comparisons ignore formatting."""
    return _WHITESPACE_RE.sub(" ", text).strip().lower()


def load_answers(
    db: Session,
    knowledge_point_ids: Iterable[str | None],
    *,
    user_id: str | None = None,
) -> list[str]:
    """Return the stored quiz answers for the given knowledge points."""
    ids = sorted({str(point_id) for point_id in knowledge_point_ids if point_id})
    if not ids:
        return []
    statement = select(QuizQuestion.answer).where(
        QuizQuestion.knowledge_point_id.in_(ids)
    )
    if user_id is not None:
        statement = statement.where(QuizQuestion.user_id == user_id)
    answers: list[str] = []
    for answer in db.scalars(statement).all():
        if answer and len(normalize(answer)) >= _MIN_ANSWER_CHARS:
            answers.append(answer)
    return answers


def _answer_pattern(answer: str) -> re.Pattern[str] | None:
    tokens = [token for token in answer.split() if token]
    if not tokens:
        return None
    return re.compile(r"\s+".join(re.escape(token) for token in tokens), re.IGNORECASE)


def rewrite_leaks(content: str, answers: Iterable[str]) -> tuple[str, bool]:
    """Replace any leaked quiz answer with a guiding question.

    Returns the (possibly rewritten) content plus a flag telling the caller
    whether a rewrite happened. Non-matching replies are returned untouched so
    non-socratic behaviour stays byte-identical.
    """
    candidates = [
        answer
        for answer in answers
        if len(normalize(answer)) >= _MIN_ANSWER_CHARS
    ]
    if not candidates:
        return content, False

    normalized = normalize(content)
    leaked = [answer for answer in candidates if normalize(answer) in normalized]
    if not leaked:
        return content, False

    result = content
    rewritten = False
    for answer in leaked:
        pattern = _answer_pattern(answer)
        if pattern is None:
            continue
        replaced = pattern.sub(GUIDING_REPLACEMENT, result)
        if replaced != result:
            result = replaced
            rewritten = True

    if rewritten:
        remaining = normalize(result)
        if any(normalize(answer) in remaining for answer in candidates):
            # A provider may split the answer across punctuation the regex
            # cannot bridge; fall back to a pure guiding reply.
            result = GUIDING_REPLACEMENT
    return result, rewritten


def token_chunks(text: str, size: int = 14) -> list[str]:
    """Split buffered text into token-sized frames for SSE streaming."""
    return re.findall(rf".{{1,{size}}}", text)
