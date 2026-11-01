"""API tests for the spaced-repetition loop: due queue, submit, stats.

Every test creates its own users/cards and presets ``due_date`` directly, so the
suite never depends on the wall clock beyond "today in Asia/Shanghai".
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import ReviewCard, ReviewLog, User

TZ = ZoneInfo("Asia/Shanghai")
TODAY = datetime.now(TZ).date()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)


@pytest.fixture
def db_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def make_user(db_session: Session) -> Iterator[Callable[..., User]]:
    created: list[str] = []

    def _create(display_name: str = "复习用户") -> User:
        user = User(
            email=f"task22-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(ReviewLog).where(ReviewLog.user_id.in_(created)))
        db_session.execute(delete(ReviewCard).where(ReviewCard.user_id.in_(created)))
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_card(
    db_session: Session,
    user: User,
    *,
    due_date: date | None,
    question: str = "光合作用的场所是？",
    answer: str = "叶绿体",
    difficulty: float = 5.0,
    stability: float = 1.0,
    retrievability: float = 1.0,
    state: int = 0,
    reps: int = 0,
    lapses: int = 0,
    last_review: datetime | None = None,
) -> ReviewCard:
    card = ReviewCard(
        user_id=user.id,
        knowledge_point_id=None,
        quiz_question_id=None,
        question=question,
        answer=answer,
        card_type="manual",
        difficulty=difficulty,
        stability=stability,
        retrievability=retrievability,
        state=state,
        reps=reps,
        lapses=lapses,
        due_date=due_date,
        last_review=last_review,
        scheduler="dsr_lite",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    return card


def _make_log(
    db_session: Session,
    card: ReviewCard,
    *,
    review_date: date,
    rating: int = 3,
    stability: float = 2.0,
    difficulty: float = 5.0,
    scheduled_days: int = 2,
) -> ReviewLog:
    log = ReviewLog(
        card_id=card.id,
        user_id=card.user_id,
        rating=rating,
        response_time_ms=None,
        reviewed_at=datetime.combine(review_date, datetime.min.time(), tzinfo=TZ),
        review_date=review_date,
        stability=stability,
        difficulty=difficulty,
        scheduled_days=scheduled_days,
    )
    db_session.add(log)
    db_session.commit()
    db_session.refresh(log)
    return log


def _reload(db_session: Session, card: ReviewCard) -> ReviewCard:
    db_session.expire_all()
    fresh = db_session.get(ReviewCard, card.id)
    assert fresh is not None
    return fresh


def _log_count(db_session: Session, card: ReviewCard, day: date = TODAY) -> int:
    return int(
        db_session.scalar(
            select(func.count())
            .select_from(ReviewLog)
            .where(ReviewLog.card_id == card.id, ReviewLog.review_date == day)
        )
        or 0
    )


def test_due_returns_today_and_overdue_only(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    other = make_user("别人")
    overdue = _make_card(db_session, user, due_date=YESTERDAY, question="过期卡")
    due_today = _make_card(db_session, user, due_date=TODAY, question="今日卡")
    _make_card(db_session, user, due_date=TOMORROW, question="明日卡")
    _make_card(db_session, user, due_date=None, question="未排期卡")
    _make_card(db_session, other, due_date=YESTERDAY, question="别人的卡")

    response = client.get("/api/review/due", headers=_headers(user))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 2
    assert [item["question"] for item in body["cards"]] == ["过期卡", "今日卡"]
    assert [item["id"] for item in body["cards"]] == [overdue.id, due_today.id]
    first = body["cards"][0]
    assert set(first) == {
        "id",
        "question",
        "answer",
        "knowledge_point_id",
        "due_date",
        "state",
        "reps",
        "lapses",
        "difficulty",
        "stability",
        "retrievability",
    }
    assert first["due_date"] == YESTERDAY.isoformat()
    assert 0.0 <= first["retrievability"] <= 1.0

    wider = client.get(
        "/api/review/due",
        headers=_headers(user),
        params={"date": TOMORROW.isoformat()},
    )

    assert wider.status_code == 200, wider.text
    assert wider.json()["count"] == 3


def test_submit_moves_due_date(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    card = _make_card(db_session, user, due_date=TODAY)

    response = client.post(
        f"/api/review/{card.id}/submit",
        headers=_headers(user),
        json={"rating": 3, "response_time_ms": 2000},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["card_id"] == card.id
    assert body["idempotent"] is False
    assert date.fromisoformat(body["next_due_date"]) > TODAY
    assert body["interval_days"] >= 1
    assert body["state"] == 2
    assert body["reps"] == 1
    assert body["lapses"] == 0

    fresh = _reload(db_session, card)
    assert fresh.due_date is not None and fresh.due_date > TODAY
    assert fresh.last_review is not None
    assert fresh.state == 2
    assert fresh.reps == 1
    assert _log_count(db_session, card) == 1


def test_submit_rating_1_lapses(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    card = _make_card(
        db_session,
        user,
        due_date=TODAY,
        state=2,
        reps=3,
        lapses=1,
        stability=4.0,
        difficulty=5.0,
        last_review=datetime.now(TZ) - timedelta(days=3),
    )

    response = client.post(
        f"/api/review/{card.id}/submit",
        headers=_headers(user),
        json={"rating": 1},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == 1
    assert body["reps"] == 0
    assert body["lapses"] == 2

    fresh = _reload(db_session, card)
    assert fresh.state == 1
    assert fresh.reps == 0
    assert fresh.lapses == 2
    assert fresh.stability == 2.0


def test_same_day_idempotent(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    card = _make_card(db_session, user, due_date=TODAY)

    first = client.post(
        f"/api/review/{card.id}/submit",
        headers=_headers(user),
        json={"rating": 3},
    )
    assert first.status_code == 200, first.text
    assert first.json()["idempotent"] is False

    second = client.post(
        f"/api/review/{card.id}/submit",
        headers=_headers(user),
        json={"rating": 1},
    )

    assert second.status_code == 200, second.text
    body = second.json()
    assert body["idempotent"] is True
    assert body["next_due_date"] == first.json()["next_due_date"]
    assert body["interval_days"] == first.json()["interval_days"]
    assert body["state"] == first.json()["state"]
    assert body["reps"] == first.json()["reps"]
    assert body["lapses"] == first.json()["lapses"]
    assert _log_count(db_session, card) == 1

    fresh = _reload(db_session, card)
    assert fresh.state == first.json()["state"]
    assert fresh.reps == first.json()["reps"]


def test_rating_out_of_range_400(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    card = _make_card(db_session, user, due_date=TODAY)

    for rating in (0, 6, -1):
        response = client.post(
            f"/api/review/{card.id}/submit",
            headers=_headers(user),
            json={"rating": rating},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "评分需在 1-5 之间"

    fresh = _reload(db_session, card)
    assert fresh.state == 0
    assert fresh.reps == 0
    assert fresh.due_date == TODAY
    assert _log_count(db_session, card) == 0


def test_cross_user_404(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    owner = make_user("所有者")
    intruder = make_user("入侵者")
    card = _make_card(db_session, owner, due_date=TODAY)

    response = client.post(
        f"/api/review/{card.id}/submit",
        headers=_headers(intruder),
        json={"rating": 3},
    )

    assert response.status_code == 404
    assert _log_count(db_session, card) == 0
    assert _reload(db_session, card).state == 0

    unknown = client.post(
        f"/api/review/{uuid.uuid4()}/submit",
        headers=_headers(intruder),
        json={"rating": 3},
    )
    assert unknown.status_code == 404

    malformed = client.post(
        "/api/review/not-a-uuid/submit",
        headers=_headers(intruder),
        json={"rating": 3},
    )
    assert malformed.status_code == 404


def test_stats_counts(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    _make_card(db_session, user, due_date=TODAY, question="今日到期")
    _make_card(db_session, user, due_date=YESTERDAY, question="昨日到期")
    future_today = _make_card(db_session, user, due_date=TODAY + timedelta(days=10))
    future_yesterday = _make_card(
        db_session, user, due_date=TODAY + timedelta(days=10)
    )
    future_gap = _make_card(db_session, user, due_date=TODAY + timedelta(days=10))
    _make_log(db_session, future_today, review_date=TODAY)
    _make_log(db_session, future_yesterday, review_date=YESTERDAY)
    _make_log(db_session, future_gap, review_date=TODAY - timedelta(days=3))

    response = client.get("/api/review/stats", headers=_headers(user))

    assert response.status_code == 200, response.text
    assert response.json() == {
        "due_count": 2,
        "reviewed_today": 1,
        "streak_days": 2,
        "total_cards": 5,
    }

    gap_user = make_user("断档用户")
    gap_card = _make_card(db_session, gap_user, due_date=None)
    gap_other = _make_card(db_session, gap_user, due_date=None)
    _make_log(db_session, gap_card, review_date=TODAY - timedelta(days=3))
    _make_log(db_session, gap_other, review_date=TODAY)

    gap_body = client.get("/api/review/stats", headers=_headers(gap_user)).json()
    assert gap_body["streak_days"] == 1
    assert gap_body["reviewed_today"] == 1
    assert gap_body["due_count"] == 0
    assert gap_body["total_cards"] == 2

    empty_user = make_user("空用户")
    empty_body = client.get("/api/review/stats", headers=_headers(empty_user)).json()
    assert empty_body == {
        "due_count": 0,
        "reviewed_today": 0,
        "streak_days": 0,
        "total_cards": 0,
    }


def test_review_logs_fields(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    card = _make_card(db_session, user, due_date=TODAY)

    response = client.post(
        f"/api/review/{card.id}/submit",
        headers=_headers(user),
        json={"rating": 4, "response_time_ms": 1234},
    )

    assert response.status_code == 200, response.text
    body = response.json()

    db_session.expire_all()
    log = db_session.scalar(select(ReviewLog).where(ReviewLog.card_id == card.id))
    assert log is not None
    assert log.user_id == user.id
    assert log.rating == 4
    assert log.response_time_ms == 1234
    assert log.review_date == TODAY
    assert log.reviewed_at.tzinfo is not None
    assert log.reviewed_at.astimezone(TZ).date() == TODAY
    assert log.scheduled_days == body["interval_days"]
    assert log.stability == pytest.approx(body["stability"])
    assert log.difficulty == pytest.approx(body["difficulty"])
