"""API tests for generated exam-preparation plans."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    Competition,
    CompetitionMember,
    KnowledgePoint,
    QuizAttempt,
    QuizQuestion,
    User,
)
from app.security.password import hash_password

PASSWORD = "demo1234"


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

    def _create(name: str = "备考用户") -> User:
        user = User(
            email=f"plan-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password(PASSWORD),
            display_name=name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _login(client: TestClient, user: User) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _make_competition(
    db: Session, owner: User, *, end_at: datetime | None
) -> Competition:
    competition = Competition(owner_id=owner.id, title="备考竞赛", end_at=end_at)
    db.add(competition)
    db.commit()
    db.add(
        CompetitionMember(
            competition_id=competition.id, user_id=owner.id, role="leader"
        )
    )
    db.commit()
    return competition


def _make_wrong_attempt(db: Session, user: User, competition: Competition) -> None:
    point = KnowledgePoint(
        user_id=user.id,
        title="薄弱知识点",
        content="",
        level=0,
        sort_order=0,
        mastery_score=0.0,
    )
    db.add(point)
    db.commit()
    question = QuizQuestion(
        user_id=user.id,
        knowledge_point_id=point.id,
        competition_id=competition.id,
        type="choice",
        question="示例题",
        options=["A. 对", "B. 错"],
        answer="A",
        explanation="解析",
    )
    db.add(question)
    db.commit()
    db.add(
        QuizAttempt(
            question_id=question.id,
            user_id=user.id,
            answer="B",
            correct=False,
        )
    )
    db.commit()


def _plan(
    client: TestClient, headers: dict[str, str], competition_id: str, **body
) -> object:
    return client.post(
        "/api/assistant/exam-plan",
        json={"competition_id": competition_id, **body},
        headers=headers,
    )


def test_standard_plan_has_one_contiguous_item_per_remaining_day(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    end_at = datetime.now(UTC) + timedelta(days=30)
    competition = _make_competition(db_session, user, end_at=end_at)
    _make_wrong_attempt(db_session, user, competition)

    response = _plan(client, headers, competition.id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "standard"
    assert body["competition_id"] == competition.id
    assert len(body["items"]) == 30
    days = [date.fromisoformat(item["date"]) for item in body["items"]]
    assert all(
        later - earlier == timedelta(days=1)
        for earlier, later in zip(days, days[1:], strict=False)
    )
    assert days[-1] == end_at.date()
    assert all(day <= end_at.date() for day in days)
    assert body["items"][0]["focus_kp_ids"]
    assert body["guidance"] is None


def test_short_horizon_uses_sprint_mode(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    end_at = datetime.now(UTC) + timedelta(days=5)
    competition = _make_competition(db_session, user, end_at=end_at)
    _make_wrong_attempt(db_session, user, competition)

    response = _plan(client, headers, competition.id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "sprint"
    assert len(body["items"]) == 5
    assert [date.fromisoformat(item["date"]) for item in body["items"]][-1] == end_at.date()
    assert all(item["quiz_count"] >= 1 for item in body["items"])
    assert all(item["focus_kp_ids"] for item in body["items"])


def test_no_attempts_returns_empty_plan_with_guidance(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    competition = _make_competition(
        db_session, user, end_at=datetime.now(UTC) + timedelta(days=30)
    )

    response = _plan(client, headers, competition.id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"] == []
    assert body["guidance"] == "先做一轮诊断练习，再生成备考计划"
    assert body["mode"] == "standard"


def test_non_member_gets_not_found(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    owner = make_user("队长")
    stranger = make_user("路人")
    headers = _login(client, stranger)
    competition = _make_competition(
        db_session, owner, end_at=datetime.now(UTC) + timedelta(days=30)
    )

    response = _plan(client, headers, competition.id)

    assert response.status_code == 404
    assert response.json() == {"detail": "资源不存在", "code": "NOT_FOUND"}


def test_missing_end_at_is_validation_error(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    competition = _make_competition(db_session, user, end_at=None)

    response = _plan(client, headers, competition.id)

    assert response.status_code == 422
    assert response.json() == {
        "detail": "竞赛未设置结束时间",
        "code": "VALIDATION_ERROR",
    }


def test_regenerate_false_replays_the_stored_plan(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    competition = _make_competition(
        db_session, user, end_at=datetime.now(UTC) + timedelta(days=10)
    )
    _make_wrong_attempt(db_session, user, competition)

    first = _plan(client, headers, competition.id)
    second = _plan(client, headers, competition.id, regenerate=False)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["items"] == first.json()["items"]
    assert second.json()["generated_at"] == first.json()["generated_at"]


def test_long_horizon_is_truncated_to_the_plan_cap(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    end_at = datetime.now(UTC) + timedelta(days=400)
    competition = _make_competition(db_session, user, end_at=end_at)
    _make_wrong_attempt(db_session, user, competition)

    response = _plan(client, headers, competition.id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "standard"
    assert body["truncated"] is True
    assert len(body["items"]) == 180
    days = [date.fromisoformat(item["date"]) for item in body["items"]]
    assert days[-1] == end_at.date()
    assert days[0] == end_at.date() - timedelta(days=179)
