"""API tests for the dashboard aggregation endpoint.

Every test seeds its own users/cards/logs/sources, so the suite is independent
of pre-existing data. The service cache is cleared around every test.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, event
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal, engine
from app.models import KnowledgePoint, KnowledgeSource, ReviewCard, ReviewLog, User
from app.services.dashboard import BUCKETS, clear_cache

TZ = ZoneInfo("Asia/Shanghai")
TODAY = datetime.now(TZ).date()
YESTERDAY = TODAY - timedelta(days=1)


@pytest.fixture(autouse=True)
def _clear_dashboard_cache() -> Iterator[None]:
    clear_cache()
    yield
    clear_cache()


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

    def _create(display_name: str = "仪表盘用户") -> User:
        user = User(
            email=f"task23-{uuid.uuid4().hex}@example.com",
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
        db_session.execute(
            delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created))
        )
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_card(
    db_session: Session,
    user: User,
    *,
    due_date: date | None = None,
    difficulty: float = 5.0,
    stability: float = 1.0,
    state: int = 0,
    reps: int = 0,
    lapses: int = 0,
    last_review: datetime | None = None,
) -> ReviewCard:
    card = ReviewCard(
        user_id=user.id,
        knowledge_point_id=None,
        quiz_question_id=None,
        question="复习题",
        answer="答案",
        card_type="manual",
        difficulty=difficulty,
        stability=stability,
        retrievability=1.0,
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
    db_session: Session, card: ReviewCard, *, review_date: date
) -> ReviewLog:
    log = ReviewLog(
        card_id=card.id,
        user_id=card.user_id,
        rating=3,
        response_time_ms=None,
        reviewed_at=datetime.combine(review_date, time.min, tzinfo=TZ),
        review_date=review_date,
        stability=2.0,
        difficulty=5.0,
        scheduled_days=2,
    )
    db_session.add(log)
    db_session.commit()
    db_session.refresh(log)
    return log


def _make_source(db_session: Session, user: User, title: str) -> KnowledgeSource:
    source = KnowledgeSource(
        user_id=user.id,
        title=title,
        filename=f"{uuid.uuid4().hex}.pdf",
        content_type="application/pdf",
        size_bytes=1024,
        storage_key=f"tests/{uuid.uuid4().hex}.pdf",
        status="ready",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def _make_point(
    db_session: Session,
    user: User,
    source: KnowledgeSource,
    *,
    title: str,
    mastery_score: float,
) -> KnowledgePoint:
    point = KnowledgePoint(
        user_id=user.id,
        source_id=source.id,
        chunk_id=None,
        parent_id=None,
        title=title,
        content="",
        level=0,
        sort_order=0,
        mastery_score=mastery_score,
    )
    db_session.add(point)
    db_session.commit()
    db_session.refresh(point)
    return point


def _summary(client: TestClient, user: User) -> dict:
    response = client.get("/api/dashboard/summary", headers=_headers(user))
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_user_zeros(client: TestClient, make_user: Callable[..., User]) -> None:
    user = make_user()

    body = _summary(client, user)

    assert set(body) == {
        "due_count",
        "reviewed_today",
        "streak_days",
        "mastery_radar",
        "difficulty_histogram",
        "heatmap",
        "forgetting_curve",
    }
    assert body["due_count"] == 0
    assert body["reviewed_today"] == 0
    assert body["streak_days"] == 0
    assert body["mastery_radar"] == []
    assert body["difficulty_histogram"] == [
        {"bucket": bucket, "count": 0} for bucket in BUCKETS
    ]
    assert len(body["heatmap"]) == 90
    assert all(item["count"] == 0 for item in body["heatmap"])
    assert len(body["forgetting_curve"]) == 30
    assert all(item["retrievability"] == 0.0 for item in body["forgetting_curve"])


def test_streak_gap(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    continuous = make_user("连续")
    _make_log(db_session, _make_card(db_session, continuous), review_date=TODAY)
    _make_log(db_session, _make_card(db_session, continuous), review_date=YESTERDAY)
    assert _summary(client, continuous)["streak_days"] == 2

    gapped = make_user("断档")
    _make_log(
        db_session,
        _make_card(db_session, gapped),
        review_date=TODAY - timedelta(days=3),
    )
    _make_log(db_session, _make_card(db_session, gapped), review_date=TODAY)
    assert _summary(client, gapped)["streak_days"] == 1

    stale = make_user("过期")
    _make_log(
        db_session,
        _make_card(db_session, stale),
        review_date=TODAY - timedelta(days=2),
    )
    assert _summary(client, stale)["streak_days"] == 0


def test_reviewed_today_counts_logs(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    _make_log(db_session, _make_card(db_session, user), review_date=TODAY)
    _make_log(db_session, _make_card(db_session, user), review_date=TODAY)
    _make_log(db_session, _make_card(db_session, user), review_date=YESTERDAY)

    assert _summary(client, user)["reviewed_today"] == 2


def test_due_count_counts_overdue(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    _make_card(db_session, user, due_date=YESTERDAY)
    _make_card(db_session, user, due_date=TODAY)
    _make_card(db_session, user, due_date=TODAY + timedelta(days=1))
    _make_card(db_session, user, due_date=None)

    assert _summary(client, user)["due_count"] == 2


def test_heatmap_90_days(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    _make_log(db_session, _make_card(db_session, user), review_date=TODAY)
    _make_log(db_session, _make_card(db_session, user), review_date=TODAY)
    _make_log(db_session, _make_card(db_session, user), review_date=YESTERDAY)
    _make_log(
        db_session,
        _make_card(db_session, user),
        review_date=TODAY - timedelta(days=89),
    )
    _make_log(
        db_session,
        _make_card(db_session, user),
        review_date=TODAY - timedelta(days=90),
    )

    heatmap = _summary(client, user)["heatmap"]

    assert len(heatmap) == 90
    assert heatmap[-1]["date"] == TODAY.isoformat()
    assert heatmap[0]["date"] == (TODAY - timedelta(days=89)).isoformat()
    counts = {item["date"]: item["count"] for item in heatmap}
    assert counts[TODAY.isoformat()] == 2
    assert counts[YESTERDAY.isoformat()] == 1
    assert counts[(TODAY - timedelta(days=89)).isoformat()] == 1
    assert (TODAY - timedelta(days=90)).isoformat() not in counts
    assert sum(counts.values()) == 4


def test_mastery_radar_per_source(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    first = _make_source(db_session, user, "计算机网络")
    second = _make_source(db_session, user, "操作系统")
    _make_point(db_session, user, first, title="OSI", mastery_score=0.2)
    _make_point(db_session, user, first, title="TCP", mastery_score=0.4)
    _make_point(db_session, user, second, title="调度", mastery_score=0.9)

    radar = _summary(client, user)["mastery_radar"]

    assert len(radar) == 2
    values = {item["name"]: item["value"] for item in radar}
    assert values == {"计算机网络": pytest.approx(30.0), "操作系统": pytest.approx(90.0)}
    assert all(0.0 <= item["value"] <= 100.0 for item in radar)


def test_forgetting_curve_length_30(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    _make_card(
        db_session,
        user,
        due_date=YESTERDAY,
        difficulty=5.0,
        stability=2.0,
        state=2,
        reps=2,
        last_review=datetime.now(TZ) - timedelta(days=2),
    )
    _make_card(
        db_session,
        user,
        due_date=TODAY,
        difficulty=3.0,
        stability=10.0,
        state=2,
        reps=4,
        last_review=datetime.now(TZ) - timedelta(days=1),
    )

    curve = _summary(client, user)["forgetting_curve"]

    assert len(curve) == 30
    assert [item["days"] for item in curve] == list(range(30))
    values = [item["retrievability"] for item in curve]
    assert all(0.0 <= value <= 1.0 for value in values)
    assert all(
        later <= earlier
        for earlier, later in zip(values, values[1:], strict=False)
    )


def test_difficulty_histogram_buckets(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    for difficulty in (1.5, 2.5, 3.5, 4.5, 5.0, 6.0):
        _make_card(db_session, user, difficulty=difficulty)

    histogram = _summary(client, user)["difficulty_histogram"]

    assert histogram == [
        {"bucket": "1-2", "count": 1},
        {"bucket": "2-3", "count": 1},
        {"bucket": "3-4", "count": 1},
        {"bucket": "4-5", "count": 1},
        {"bucket": "5", "count": 2},
    ]


def test_cache_hit(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    assert _summary(client, user)["due_count"] == 0

    _make_card(db_session, user, due_date=TODAY)
    assert _summary(client, user)["due_count"] == 0

    clear_cache()
    assert _summary(client, user)["due_count"] == 1


def test_cache_isolated_per_user(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    owner = make_user("有卡")
    other = make_user("无卡")
    _make_card(db_session, owner, due_date=TODAY)

    assert _summary(client, owner)["due_count"] == 1
    assert _summary(client, other)["due_count"] == 0

    _make_card(db_session, other, due_date=TODAY)
    assert _summary(client, owner)["due_count"] == 1
    assert _summary(client, other)["due_count"] == 0

    clear_cache()
    assert _summary(client, other)["due_count"] == 1


def test_query_count_bounded(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    source = _make_source(db_session, user, "数据库")
    _make_point(db_session, user, source, title="索引", mastery_score=0.5)
    _make_card(db_session, user, due_date=TODAY)
    _make_log(db_session, _make_card(db_session, user), review_date=TODAY)

    statements: list[str] = []

    def _record(conn: object, cursor: object, statement: str, *args: object) -> None:
        if statement.lstrip().upper().startswith("SELECT") and statement.strip() != "SELECT 1":
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        body = _summary(client, user)
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert body["due_count"] == 1
    assert len(statements) <= 8
