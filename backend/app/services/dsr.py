"""Difficulty–Stability–Retrievability (DSR) memory model.

This module is deliberately free of database, network and wall-clock access: the
current time is always an explicit ``now`` argument so callers can freeze the
clock in tests.  It provides

* :class:`MemoryState` -- the serialisable DSR state of one review card;
* :func:`retrievability` -- predicted recall probability after ``t`` days;
* :func:`next_interval` -- the interval that lands on a target retention;
* :func:`review` -- the deterministic update rule for a 1..5 rating;
* :class:`DSRLiteScheduler` -- the ``Scheduler`` port adapter (dict <-> state);
* :class:`SM2Scheduler` -- an intentionally unimplemented SM-2 stub.

Formulas (``t`` and ``S`` in days)::

    R(t) = (1 + (19 / 81) * (t / S)) ** -0.5
    interval(S, target) = S * ((1 / target ** 2 - 1) * 81 / 19)

With ``target = 0.9`` the interval equals ``S`` exactly and ``R(S) = 0.9``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from app.ports.types import CardSummary

__all__ = [
    "D_MAX",
    "D_MIN",
    "DSRLiteScheduler",
    "GROWTH",
    "INTERVAL_MAX",
    "INTERVAL_MIN",
    "MemoryState",
    "SM2Scheduler",
    "S_MAX",
    "S_MIN",
    "next_interval",
    "retrievability",
    "review",
]

#: Retrievability coefficient from the DSR decay curve.
_R_COEFF = 19.0 / 81.0

S_MIN = 0.5
S_MAX = 365.0
D_MIN = 1.0
D_MAX = 10.0
INTERVAL_MIN = 1
INTERVAL_MAX = 365

#: Stability multiplier per rating; 1..2 count as lapses (review again soon).
GROWTH: dict[int, float] = {1: 0.5, 2: 0.7, 3: 1.2, 4: 1.6, 5: 2.0}

SCHEDULER_NAME = "dsr_lite"


@dataclass(slots=True)
class MemoryState:
    """DSR state of a single review card.

    ``state`` is ``0`` for a new card, ``1`` for relearning after a lapse and
    ``2`` for a card in normal review.
    """

    difficulty: float = 5.0
    stability: float = 1.0
    reps: int = 0
    lapses: int = 0
    state: int = 0
    last_review: datetime | None = None
    due_date: date | None = None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _elapsed_days(last_review: datetime, now: datetime) -> float:
    """Return non-negative days between ``last_review`` and ``now``.

    Naive and aware datetimes are mixed by dropping/normalising the tzinfo on
    the earlier timestamp so the difference never raises ``TypeError``.
    """

    start = last_review
    if start.tzinfo is not None and now.tzinfo is None:
        start = start.replace(tzinfo=None)
    elif start.tzinfo is None and now.tzinfo is not None:
        start = start.replace(tzinfo=now.tzinfo)
    return max(0.0, (now - start).total_seconds() / 86400.0)


def retrievability(state: MemoryState, now: datetime) -> float:
    """Predicted recall probability of ``state`` at ``now``.

    A card that has never been reviewed is fully retrievable.  The result is
    clamped to ``[0.0, 1.0]`` so clock skew or degenerate stability values can
    never produce an out-of-range probability.
    """

    if state.last_review is None:
        return 1.0
    elapsed = _elapsed_days(state.last_review, now)
    if elapsed <= 0.0:
        return 1.0
    stability = max(state.stability, S_MIN)
    value = (1.0 + _R_COEFF * (elapsed / stability)) ** -0.5
    return _clamp(value, 0.0, 1.0)


def next_interval(state: MemoryState, target: float = 0.9) -> int:
    """Return the whole-day interval that lands on ``target`` retention.

    At ``target = 0.9`` the formula collapses to ``S``; the result is clamped to
    ``[INTERVAL_MIN, INTERVAL_MAX]``.
    """

    if target <= 0.0:
        raise ValueError(f"target must be positive, got {target!r}")
    if state.stability <= 0.0:
        return INTERVAL_MIN
    raw = state.stability * ((1.0 / target**2 - 1.0) * 81.0 / 19.0)
    interval = int(round(raw))
    return max(INTERVAL_MIN, min(INTERVAL_MAX, interval))


def _validate_rating(rating: int) -> None:
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        raise ValueError(f"rating must be an int in 1..5, got {rating!r}")


def review(state: MemoryState, rating: int, *, now: datetime) -> MemoryState:
    """Apply ``rating`` (1..5) to ``state`` and return the updated state.

    The update is deterministic and monotonic in ``rating``:

    * stability is multiplied by :data:`GROWTH`, clamped to ``[S_MIN, S_MAX]``;
    * difficulty moves by ``(3 - rating) * 0.6``, clamped to ``[D_MIN, D_MAX]``;
    * ratings 1 and 2 are lapses: reps reset, lapses grow, state becomes 1;
    * a new card (``state == 0``) starts from the ``S = 1.0`` / ``D = 5.0``
      baseline and applies the growth factor exactly once.
    """

    _validate_rating(rating)
    growth = GROWTH[rating]

    if state.state == 0:
        base_stability = 1.0
        base_difficulty = 5.0
        stability = growth
    else:
        base_stability = state.stability
        base_difficulty = state.difficulty
        stability = base_stability * growth

    stability = _clamp(stability, S_MIN, S_MAX)
    difficulty = _clamp(base_difficulty + (3 - rating) * 0.6, D_MIN, D_MAX)

    lapse = rating <= 2
    updated = MemoryState(
        difficulty=difficulty,
        stability=stability,
        reps=0 if lapse else state.reps + 1,
        lapses=state.lapses + 1 if lapse else state.lapses,
        state=1 if lapse else 2,
        last_review=now,
        due_date=None,
    )
    updated.due_date = (now + timedelta(days=next_interval(updated))).date()
    return updated


def _parse_datetime(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    raise TypeError(f"unsupported datetime value: {type(value).__name__}")


def _parse_date(value: object) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise TypeError(f"unsupported date value: {type(value).__name__}")


def _state_from_dict(payload: dict) -> MemoryState:
    """Build a :class:`MemoryState` from DB-shaped columns (missing = defaults)."""

    return MemoryState(
        difficulty=float(payload.get("difficulty", 5.0)),
        stability=float(payload.get("stability", 1.0)),
        reps=int(payload.get("reps", 0)),
        lapses=int(payload.get("lapses", 0)),
        state=int(payload.get("state", 0)),
        last_review=_parse_datetime(payload.get("last_review")),
        due_date=_parse_date(payload.get("due_date")),
    )


def _state_to_dict(state: MemoryState, now: datetime) -> dict[str, Any]:
    """Serialise ``state`` into the ``review_cards`` column shape."""

    return {
        "difficulty": state.difficulty,
        "stability": state.stability,
        "retrievability": retrievability(state, now),
        "state": state.state,
        "reps": state.reps,
        "lapses": state.lapses,
        "due_date": state.due_date.isoformat() if state.due_date is not None else None,
        "last_review": state.last_review.isoformat() if state.last_review is not None else None,
        "scheduler": SCHEDULER_NAME,
    }


class DSRLiteScheduler:
    """``Scheduler`` port adapter around the pure DSR functions.

    Due-card lookup needs the database and is owned by the repository layer
    (Task 22), so :meth:`due_cards` intentionally raises ``NotImplementedError``.
    """

    scheduler_name = SCHEDULER_NAME

    def due_cards(self, *, user_id: str, as_of: date) -> list[CardSummary]:
        raise NotImplementedError(
            "DSRLiteScheduler.due_cards needs a database; the repository layer "
            "owns due-card queries (Task 22)"
        )

    def review(self, *, state: dict, rating: int, now: datetime) -> dict:
        current = _state_from_dict(state)
        updated = review(current, rating, now=now)
        return _state_to_dict(updated, now)

    def next_interval(self, *, state: dict, target: float = 0.9) -> int:
        return next_interval(_state_from_dict(state), target)


class SM2Scheduler:
    """Interface-only placeholder for the classic SM-2 algorithm.

    SM-2 is explicitly out of MVP scope; the class exists so callers can select
    ``scheduler="sm2"`` without a behavioural surprise.
    """

    scheduler_name = "sm2"

    def due_cards(self, *, user_id: str, as_of: date) -> list[CardSummary]:
        raise NotImplementedError("SM-2 not in MVP scope")

    def review(self, *, state: dict, rating: int, now: datetime) -> dict:
        raise NotImplementedError("SM-2 not in MVP scope")

    def next_interval(self, *, state: dict, target: float = 0.9) -> int:
        raise NotImplementedError("SM-2 not in MVP scope")
