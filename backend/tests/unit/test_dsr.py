"""Frozen-clock tests for the pure DSR scheduler."""

from __future__ import annotations

from datetime import datetime, timedelta
from itertools import pairwise

import pytest

from app.services.dsr import (
    D_MAX,
    D_MIN,
    INTERVAL_MAX,
    INTERVAL_MIN,
    S_MAX,
    S_MIN,
    DSRLiteScheduler,
    MemoryState,
    SM2Scheduler,
    next_interval,
    retrievability,
    review,
)

NOW = datetime(2026, 3, 1, 9, 0)


def _days_ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def _reviewed_state(**overrides: object) -> MemoryState:
    values: dict[str, object] = {
        "difficulty": 5.0,
        "stability": 10.0,
        "reps": 3,
        "lapses": 1,
        "state": 2,
        "last_review": _days_ago(10),
    }
    values.update(overrides)
    return MemoryState(**values)  # type: ignore[arg-type]


def test_r_at_s() -> None:
    state = MemoryState(stability=10.0, last_review=_days_ago(10))

    assert 0.899 <= retrievability(state, NOW) <= 0.901


def test_r_new_card_is_one() -> None:
    assert retrievability(MemoryState(), NOW) == 1.0


def test_r_monotonic_decreasing() -> None:
    values = [
        retrievability(MemoryState(stability=10.0, last_review=_days_ago(days)), NOW)
        for days in (0, 5, 10, 30)
    ]

    assert all(earlier > later for earlier, later in pairwise(values))
    assert values[0] == 1.0


def test_r_clamped_to_unit_interval() -> None:
    future = MemoryState(stability=10.0, last_review=NOW + timedelta(days=5))
    ancient = MemoryState(stability=0.5, last_review=_days_ago(3650))

    assert retrievability(future, NOW) == 1.0
    assert 0.0 <= retrievability(ancient, NOW) <= 1.0


def test_interval_formula() -> None:
    assert next_interval(MemoryState(stability=10.0)) == 10
    assert next_interval(MemoryState(stability=0.1)) == INTERVAL_MIN
    assert next_interval(MemoryState(stability=1000.0)) == INTERVAL_MAX


def test_rating_low_lapses() -> None:
    updated = review(_reviewed_state(), 1, now=NOW)

    assert updated.stability < 10.0
    assert updated.lapses == 2
    assert updated.reps == 0
    assert updated.state == 1
    assert updated.difficulty > 5.0


def test_rating_high_grows() -> None:
    updated = review(_reviewed_state(), 5, now=NOW)

    assert updated.stability > 10.0
    assert updated.lapses == 1
    assert updated.reps == 4
    assert updated.state == 2
    assert updated.difficulty < 5.0


def test_rating_monotonic() -> None:
    stabilities = [review(_reviewed_state(), rating, now=NOW).stability for rating in range(1, 6)]

    assert all(lower < higher for lower, higher in pairwise(stabilities))


def test_difficulty_bounds() -> None:
    hard = _reviewed_state()
    easy = _reviewed_state()
    for _ in range(30):
        hard = review(hard, 1, now=NOW)
        easy = review(easy, 5, now=NOW)
        assert D_MIN <= hard.difficulty <= D_MAX
        assert D_MIN <= easy.difficulty <= D_MAX

    assert hard.difficulty == D_MAX
    assert easy.difficulty == D_MIN


def test_stability_floor_and_ceiling() -> None:
    hard = _reviewed_state(stability=1.0)
    easy = _reviewed_state(stability=1.0)
    for _ in range(30):
        hard = review(hard, 1, now=NOW)
        easy = review(easy, 5, now=NOW)
        assert S_MIN <= hard.stability <= S_MAX
        assert S_MIN <= easy.stability <= S_MAX

    assert hard.stability == S_MIN
    assert easy.stability == S_MAX


@pytest.mark.parametrize("rating", [0, 6, -1, 3.0])
def test_invalid_rating(rating: object) -> None:
    with pytest.raises(ValueError):
        review(MemoryState(), rating, now=NOW)  # type: ignore[arg-type]


def test_due_date_uses_offset() -> None:
    updated = review(_reviewed_state(stability=10.0), 4, now=NOW)

    assert updated.stability == pytest.approx(16.0)
    assert next_interval(updated) == 16
    assert updated.due_date == NOW.date() + timedelta(days=16)


def test_dict_roundtrip() -> None:
    payload = {
        "difficulty": 5.0,
        "stability": 10.0,
        "reps": 3,
        "lapses": 1,
        "state": 2,
        "last_review": _days_ago(10).isoformat(),
        "due_date": NOW.date().isoformat(),
    }
    direct = review(_reviewed_state(), 4, now=NOW)

    result = DSRLiteScheduler().review(state=payload, rating=4, now=NOW)

    assert result["difficulty"] == pytest.approx(direct.difficulty)
    assert result["stability"] == pytest.approx(direct.stability)
    assert result["state"] == direct.state
    assert result["reps"] == direct.reps
    assert result["lapses"] == direct.lapses
    assert result["retrievability"] == pytest.approx(1.0)
    assert result["last_review"] == direct.last_review.isoformat() == NOW.isoformat()
    assert result["due_date"] == direct.due_date.isoformat()
    assert result["scheduler"] == "dsr_lite"


def test_sm2_not_implemented() -> None:
    with pytest.raises(NotImplementedError, match="SM-2 not in MVP scope"):
        SM2Scheduler().review(state={}, rating=4, now=NOW)


def test_new_card_applies_growth_once() -> None:
    updated = review(MemoryState(), 4, now=NOW)

    assert updated.stability == pytest.approx(1.6)
    assert updated.state == 2
    assert updated.reps == 1
    assert updated.difficulty == pytest.approx(4.4)


def test_new_card_lapse_from_baseline() -> None:
    updated = review(MemoryState(), 1, now=NOW)

    assert updated.stability == pytest.approx(S_MIN)
    assert updated.state == 1
    assert updated.reps == 0
    assert updated.lapses == 1


def test_dsr_due_cards_owned_by_repository() -> None:
    with pytest.raises(NotImplementedError, match="repository layer"):
        DSRLiteScheduler().due_cards(user_id="user-1", as_of=NOW.date())
