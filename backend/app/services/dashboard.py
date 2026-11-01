"""Dashboard aggregation.

One read-only query set feeds every widget of the learning dashboard:

* ``due_count`` / ``reviewed_today`` / ``streak_days`` -- review activity;
* ``mastery_radar`` -- mean ``knowledge_points.mastery_score`` per source,
  scaled from the stored ``0..1`` fraction to ``0..100``;
* ``difficulty_histogram`` -- fixed 1..5 buckets over ``review_cards.difficulty``;
* ``heatmap`` -- the last 90 calendar days (today inclusive) of review logs;
* ``forgetting_curve`` -- a 30 day forward projection of the *currently due*
  cards' retrievability, computed with the pure
  :func:`app.services.dsr.retrievability` function (no scheduler writes).

Everything is scoped to one user and computed from aggregate SQL; the only
Python pass is the 30 point curve, which needs the pure DSR formula per card.

Caching
-------
Results are cached in-process for :data:`CACHE_TTL_SECONDS` seconds, keyed by
``(user_id, local_date)`` so a cache entry can never leak between users or
across the local midnight. :func:`clear_cache` empties it (tests call it from a
fixture).

Time
----
All calendar days use ``ZoneInfo(settings.timezone)``; ``date.today()`` is never
used because the host may run in UTC.
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import KnowledgePoint, KnowledgeSource, ReviewCard, ReviewLog
from app.services.dsr import MemoryState, retrievability

__all__ = [
    "BUCKETS",
    "CACHE_TTL_SECONDS",
    "HEATMAP_DAYS",
    "CURVE_DAYS",
    "clear_cache",
    "summary",
    "today_local",
]

#: Fixed bucket labels, in display order.
BUCKETS: tuple[str, ...] = ("1-2", "2-3", "3-4", "4-5", "5")

#: Number of heatmap cells (today inclusive).
HEATMAP_DAYS = 90

#: Number of points in the forgetting curve (days 0..29).
CURVE_DAYS = 30

#: In-process cache lifetime.
CACHE_TTL_SECONDS = 60.0

#: Upper bound on distinct days scanned when computing the streak.
_STREAK_LOOKBACK_DAYS = 400

_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def clear_cache() -> None:
    """Drop every cached dashboard payload."""
    with _cache_lock:
        _cache.clear()


def _cache_get(key: tuple[str, str]) -> dict[str, Any] | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at <= time.monotonic():
            _cache.pop(key, None)
            return None
        return payload


def _cache_put(key: tuple[str, str], payload: dict[str, Any]) -> None:
    with _cache_lock:
        _cache[key] = (time.monotonic() + CACHE_TTL_SECONDS, payload)


def now_local() -> datetime:
    """Current time in the configured timezone (aware)."""
    return datetime.now(ZoneInfo(settings.timezone))


def today_local() -> date:
    """Current calendar date in the configured timezone."""
    return now_local().date()


def _to_float(value: object) -> float:
    """Coerce a DB aggregate (Decimal, int or None) to ``float``."""
    if value is None:
        return 0.0
    return float(str(value))


def _as_local(value: datetime | None) -> datetime | None:
    """Normalise a stored ``timestamptz`` into the configured timezone."""
    if value is None:
        return None
    zone = ZoneInfo(settings.timezone)
    if value.tzinfo is None:
        return value.replace(tzinfo=zone)
    return value.astimezone(zone)


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


def _review_counts(db: Session, *, user_id: str, day: date) -> tuple[int, int]:
    """Return ``(reviewed_today, streak_days)`` in two user-scoped queries."""
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
    return reviewed_today, _streak(recent_days, today=day)


def _due_rows(db: Session, *, user_id: str, day: date) -> list[Any]:
    """Every card due on or before ``day`` (columns needed by the curve)."""
    statement = select(
        ReviewCard.difficulty,
        ReviewCard.stability,
        ReviewCard.reps,
        ReviewCard.lapses,
        ReviewCard.state,
        ReviewCard.last_review,
        ReviewCard.due_date,
    ).where(
        ReviewCard.user_id == user_id,
        ReviewCard.due_date.is_not(None),
        ReviewCard.due_date <= day,
    )
    return list(db.execute(statement).all())


def _heatmap(db: Session, *, user_id: str, day: date) -> list[dict[str, Any]]:
    """90 day review-log heatmap, zero-filled and ending at ``day``."""
    start = day - timedelta(days=HEATMAP_DAYS - 1)
    counts: dict[date, int] = dict(
        db.execute(
            select(ReviewLog.review_date, func.count())
            .where(
                ReviewLog.user_id == user_id,
                ReviewLog.review_date >= start,
                ReviewLog.review_date <= day,
            )
            .group_by(ReviewLog.review_date)
        ).all()
    )
    return [
        {
            "date": (start + timedelta(days=offset)).isoformat(),
            "count": int(counts.get(start + timedelta(days=offset), 0)),
        }
        for offset in range(HEATMAP_DAYS)
    ]


def _mastery_radar(db: Session, *, user_id: str) -> list[dict[str, Any]]:
    """Mean mastery per source, scaled to 0..100 (sources without KPs omitted)."""
    rows = db.execute(
        select(
            KnowledgeSource.title,
            func.avg(KnowledgePoint.mastery_score),
        )
        .join(
            KnowledgePoint,
            and_(
                KnowledgePoint.source_id == KnowledgeSource.id,
                KnowledgePoint.user_id == user_id,
            ),
        )
        .where(KnowledgeSource.user_id == user_id)
        .group_by(KnowledgeSource.id, KnowledgeSource.title)
        .order_by(KnowledgeSource.title, KnowledgeSource.id)
    ).all()
    return [
        {
            "name": str(title),
            "value": round(min(100.0, max(0.0, _to_float(avg) * 100.0)), 2),
        }
        for title, avg in rows
    ]


def _difficulty_histogram(db: Session, *, user_id: str) -> list[dict[str, Any]]:
    """Fixed-bucket difficulty distribution; always returns all five buckets."""
    bucket = case(
        (ReviewCard.difficulty < 2, BUCKETS[0]),
        (ReviewCard.difficulty < 3, BUCKETS[1]),
        (ReviewCard.difficulty < 4, BUCKETS[2]),
        (ReviewCard.difficulty < 5, BUCKETS[3]),
        else_=BUCKETS[4],
    ).label("bucket")
    counts: dict[str, int] = dict(
        db.execute(
            select(bucket, func.count())
            .where(ReviewCard.user_id == user_id)
            .group_by(bucket)
        ).all()
    )
    return [{"bucket": name, "count": int(counts.get(name, 0))} for name in BUCKETS]


def _forgetting_curve(
    rows: list[Any], *, moment: datetime
) -> list[dict[str, Any]]:
    """Mean retrievability of the due cards for days 0..29 from ``moment``."""
    if not rows:
        return [
            {"days": offset, "retrievability": 0.0} for offset in range(CURVE_DAYS)
        ]

    states = [
        MemoryState(
            difficulty=float(row.difficulty),
            stability=float(row.stability),
            reps=int(row.reps),
            lapses=int(row.lapses),
            state=int(row.state),
            last_review=_as_local(row.last_review),
            due_date=row.due_date,
        )
        for row in rows
    ]
    curve: list[dict[str, Any]] = []
    for offset in range(CURVE_DAYS):
        projected = moment + timedelta(days=offset)
        total = sum(retrievability(state, projected) for state in states)
        curve.append(
            {"days": offset, "retrievability": round(total / len(states), 6)}
        )
    return curve


def _build(db: Session, *, user_id: str, day: date, moment: datetime) -> dict[str, Any]:
    due = _due_rows(db, user_id=user_id, day=day)
    reviewed_today, streak_days = _review_counts(db, user_id=user_id, day=day)
    return {
        "due_count": len(due),
        "reviewed_today": reviewed_today,
        "streak_days": streak_days,
        "mastery_radar": _mastery_radar(db, user_id=user_id),
        "difficulty_histogram": _difficulty_histogram(db, user_id=user_id),
        "heatmap": _heatmap(db, user_id=user_id, day=day),
        "forgetting_curve": _forgetting_curve(due, moment=moment),
    }


def summary(
    db: Session,
    *,
    user_id: str,
    today: date | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return the dashboard payload for ``user_id``, cached for 60 seconds.

    ``today`` / ``now`` exist so tests can pin the clock; the API route always
    uses the configured local time.
    """
    day = today or today_local()
    moment = now or now_local()
    key = (str(user_id), day.isoformat())

    cached = _cache_get(key)
    if cached is not None:
        return cached

    payload = _build(db, user_id=str(user_id), day=day, moment=moment)
    _cache_put(key, payload)
    return payload
