"""Due-queue, review submission and review statistics.

This module is the database-facing half of the spaced-repetition loop; the
scheduling math itself lives in :mod:`app.services.dsr` and is never
re-implemented here. The ORM card is converted to the plain ``dict`` shape the
:class:`~app.services.dsr.DSRLiteScheduler` port expects (``last_review`` /
``due_date`` as real ``datetime`` / ``date`` objects) and the returned dict is
written back onto the row.

Time
----
Every date is computed with ``ZoneInfo(settings.timezone)`` (Asia/Shanghai).
The host may run in UTC, so ``date.today()`` is never used: the "review day"
of a submission is the local calendar day of ``now``.

Idempotency
-----------
``review_logs`` has ``UNIQUE (card_id, review_date)``. A submission first looks
for an existing log for ``(card_id, today)``; if found the card is returned
untouched with ``idempotent=True``. The insert itself uses
``ON CONFLICT (card_id, review_date) DO NOTHING`` so two concurrent submissions
cannot both create a log: the loser sees ``returning() is None`` and reports the
same idempotent response. The card update happens *after* the log insert wins,
so a losing race never mutates DSR state.

Stats
-----
``streak_days`` counts consecutive calendar days with at least one review log,
anchored at today when today already has a review, otherwise at yesterday (so
opening the app in the morning does not reset a running streak). A gap of one
day breaks the streak; no logs at all means ``0``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ReviewCard, ReviewLog
from app.services.dsr import DSRLiteScheduler, MemoryState, retrievability

__all__ = [
    "DUE_LIMIT_DEFAULT",
    "DUE_LIMIT_MAX",
    "DueCardView",
    "ReviewStats",
    "SubmitOutcome",
    "due_cards",
    "review_stats",
    "submit_review",
    "today_local",
    "now_local",
]

#: Due-queue page size; the route clamps user input into ``1..DUE_LIMIT_MAX``.
DUE_LIMIT_DEFAULT = 200
DUE_LIMIT_MAX = 500

#: Upper bound on distinct days scanned when computing the streak.
_STREAK_LOOKBACK_DAYS = 400

_TARGET_RETENTION = 0.9


def now_local() -> datetime:
    """Current time in the configured timezone (aware)."""
    return datetime.now(ZoneInfo(settings.timezone))


def today_local() -> date:
    """Current calendar date in the configured timezone."""
    return now_local().date()


def _as_local(value: datetime | None) -> datetime | None:
    """Render a stored timestamp in the configured timezone.

    ``timestamptz`` columns come back from psycopg in the session timezone
    (usually UTC). Normalising here keeps elapsed-day math in a single zone
    instead of mixing UTC timestamps with Asia/Shanghai "now".
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=ZoneInfo(settings.timezone))
    return value.astimezone(ZoneInfo(settings.timezone))


def _state_dict(card: ReviewCard) -> dict[str, object]:
    """Project the ORM row onto the scheduler port's dict shape."""
    return {
        "difficulty": card.difficulty,
        "stability": card.stability,
        "reps": card.reps,
        "lapses": card.lapses,
        "state": card.state,
        "last_review": _as_local(card.last_review),
        "due_date": card.due_date,
    }


@dataclass(slots=True)
class DueCardView:
    """One card of the due queue with its *current* predicted retrievability."""

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


@dataclass(slots=True)
class SubmitOutcome:
    """Result of a submission; ``idempotent`` marks a same-day replay."""

    card: ReviewCard
    log: ReviewLog
    idempotent: bool


@dataclass(slots=True)
class ReviewStats:
    due_count: int
    reviewed_today: int
    streak_days: int
    total_cards: int


def _clamp_limit(limit: int) -> int:
    return max(1, min(limit, DUE_LIMIT_MAX))


def due_cards(
    db: Session,
    *,
    user_id: str,
    as_of: date,
    limit: int = DUE_LIMIT_DEFAULT,
    now: datetime | None = None,
) -> list[DueCardView]:
    """Return the user's cards due on or before ``as_of``, oldest first."""
    statement = (
        select(ReviewCard)
        .where(
            ReviewCard.user_id == user_id,
            ReviewCard.due_date.is_not(None),
            ReviewCard.due_date <= as_of,
        )
        .order_by(
            ReviewCard.due_date.asc(),
            ReviewCard.created_at.asc(),
            ReviewCard.id.asc(),
        )
        .limit(_clamp_limit(limit))
    )
    rows = list(db.scalars(statement).all())
    moment = now or now_local()
    return [
        DueCardView(
            id=card.id,
            question=card.question,
            answer=card.answer,
            knowledge_point_id=card.knowledge_point_id,
            due_date=card.due_date,
            state=card.state,
            reps=card.reps,
            lapses=card.lapses,
            difficulty=card.difficulty,
            stability=card.stability,
            retrievability=retrievability(
                MemoryState(
                    difficulty=card.difficulty,
                    stability=card.stability,
                    reps=card.reps,
                    lapses=card.lapses,
                    state=card.state,
                    last_review=_as_local(card.last_review),
                    due_date=card.due_date,
                ),
                moment,
            ),
        )
        for card in rows
    ]


def _find_log(db: Session, *, card_id: str, day: date) -> ReviewLog | None:
    return db.scalar(
        select(ReviewLog).where(
            ReviewLog.card_id == card_id,
            ReviewLog.review_date == day,
        )
    )


def submit_review(
    db: Session,
    *,
    card: ReviewCard,
    rating: int,
    response_time_ms: int | None = None,
    now: datetime | None = None,
) -> SubmitOutcome:
    """Apply ``rating`` to ``card`` and persist the DSR update plus one log row.

    The caller owns the transaction: this function flushes but never commits.
    ``rating`` must be 1..5; the API layer rejects out-of-range values with a
    ``400`` before reaching here, and the DSR module raises ``ValueError`` as a
    second line of defence.
    """
    moment = now or now_local()
    day = moment.date()

    existing = _find_log(db, card_id=card.id, day=day)
    if existing is not None:
        return SubmitOutcome(card=card, log=existing, idempotent=True)

    scheduler = DSRLiteScheduler()
    updated = scheduler.review(state=_state_dict(card), rating=rating, now=moment)
    interval_days = scheduler.next_interval(state=updated, target=_TARGET_RETENTION)

    inserted_id = db.execute(
        pg_insert(ReviewLog)
        .values(
            card_id=card.id,
            user_id=card.user_id,
            rating=rating,
            response_time_ms=response_time_ms,
            reviewed_at=moment,
            review_date=day,
            stability=float(updated["stability"]),
            difficulty=float(updated["difficulty"]),
            scheduled_days=interval_days,
        )
        .on_conflict_do_nothing(index_elements=["card_id", "review_date"])
        .returning(ReviewLog.id)
    ).scalar_one_or_none()

    if inserted_id is None:
        # Lost the race to a concurrent same-day submission: the winner's log
        # and card state stand, nothing has been mutated yet.
        winner = _find_log(db, card_id=card.id, day=day)
        if winner is None:  # pragma: no cover - only reachable on a broken constraint
            raise RuntimeError("review log conflict without an existing row")
        return SubmitOutcome(card=card, log=winner, idempotent=True)

    card.difficulty = float(updated["difficulty"])
    card.stability = float(updated["stability"])
    card.retrievability = float(updated["retrievability"])
    card.state = int(updated["state"])
    card.reps = int(updated["reps"])
    card.lapses = int(updated["lapses"])
    card.scheduler = str(updated["scheduler"])
    due_iso = updated["due_date"]
    card.due_date = date.fromisoformat(due_iso) if due_iso else None
    last_iso = updated["last_review"]
    card.last_review = datetime.fromisoformat(last_iso) if last_iso else moment
    db.flush()

    log = db.get(ReviewLog, inserted_id)
    if log is None:  # pragma: no cover - insert just returned this id
        raise RuntimeError("review log vanished after insert")
    return SubmitOutcome(card=card, log=log, idempotent=False)


def _streak(days: list[date], *, today: date) -> int:
    """Count consecutive review days ending today (or yesterday)."""
    if not days:
        return 0
    yesterday = today - timedelta(days=1)
    if days[0] == today:
        expected = today
    elif days[0] == yesterday:
        expected = yesterday
    else:
        return 0

    streak = 0
    for day in days:
        if day != expected:
            break
        streak += 1
        expected -= timedelta(days=1)
    return streak


def review_stats(
    db: Session, *, user_id: str, today: date | None = None
) -> ReviewStats:
    """Aggregate the four review counters in three user-scoped queries."""
    day = today or today_local()

    totals = db.execute(
        select(
            func.count().label("total_cards"),
            func.count().filter(ReviewCard.due_date <= day).label("due_count"),
        ).where(ReviewCard.user_id == user_id)
    ).one()

    reviewed_today = int(
        db.scalar(
            select(func.count())
            .select_from(ReviewLog)
            .where(ReviewLog.user_id == user_id, ReviewLog.review_date == day)
        )
        or 0
    )

    recent_days = list(
        db.scalars(
            select(ReviewLog.review_date)
            .where(ReviewLog.user_id == user_id)
            .distinct()
            .order_by(ReviewLog.review_date.desc())
            .limit(_STREAK_LOOKBACK_DAYS)
        ).all()
    )

    return ReviewStats(
        due_count=int(totals.due_count or 0),
        reviewed_today=reviewed_today,
        streak_days=_streak(recent_days, today=day),
        total_cards=int(totals.total_cards or 0),
    )
