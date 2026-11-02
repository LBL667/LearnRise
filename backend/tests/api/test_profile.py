"""API tests for the personal centre and the competition leaderboard."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import (
    Competition,
    CompetitionMember,
    KnowledgePoint,
    KnowledgeSource,
    QuizAttempt,
    QuizQuestion,
    ReviewCard,
    ReviewLog,
    User,
)

TZ = ZoneInfo("Asia/Shanghai")


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

    def _create(name: str = "个人中心用户") -> User:
        user = User(
            email=f"profile-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=name,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        created.append(user.id)
        return user

    yield _create

    if created:
        competitions = db_session.scalars(
            select(Competition.id).where(Competition.owner_id.in_(created))
        ).all()
        if competitions:
            db_session.execute(
                delete(CompetitionMember).where(
                    CompetitionMember.competition_id.in_(competitions)
                )
            )
            db_session.execute(delete(Competition).where(Competition.id.in_(competitions)))
        db_session.execute(delete(CompetitionMember).where(CompetitionMember.user_id.in_(created)))
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _create_competition(client: TestClient, user: User, title: str) -> dict:
    response = client.post(
        "/api/competitions",
        json={
            "name": title,
            "knowledge_prompt": "图论",
            "question_types": ["choice"],
            "difficulty": "medium",
            "winner_count": 3,
            "rewards": [],
            "start_time": "2026-12-01T09:00:00",
            "end_time": "2026-12-31T18:00:00",
            "source_ids": [],
        },
        headers=_headers(user),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _join(client: TestClient, user: User, invite_code: str) -> None:
    response = client.post(
        "/api/competitions/join",
        json={"invite_code": invite_code},
        headers=_headers(user),
    )
    assert response.status_code == 200, response.text


def _seed_source(db: Session, user: User, competition_id: str | None) -> KnowledgeSource:
    source = KnowledgeSource(
        user_id=user.id,
        competition_id=competition_id,
        title="数据结构讲义",
        filename="ds.pdf",
        content_type="application/pdf",
        size_bytes=1,
        storage_key=f"tests/{uuid.uuid4().hex}.pdf",
        status="ready",
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def _seed_point(
    db: Session, user: User, source: KnowledgeSource, *, mastery: float = 0.5
) -> KnowledgePoint:
    point = KnowledgePoint(
        user_id=user.id,
        source_id=source.id,
        title="最短路径",
        content="Dijkstra",
        level=0,
        sort_order=0,
        mastery_score=mastery,
    )
    db.add(point)
    db.commit()
    db.refresh(point)
    return point


def _seed_question(
    db: Session, user: User, point: KnowledgePoint, competition_id: str
) -> QuizQuestion:
    question = QuizQuestion(
        user_id=user.id,
        competition_id=competition_id,
        knowledge_point_id=point.id,
        type="choice",
        question="Dijkstra 适用于？",
        options=["非负权", "负权", "无向图", "树"],
        answer="A",
        explanation="",
        difficulty="medium",
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def _seed_attempt(db: Session, user: User, question: QuizQuestion, *, correct: bool) -> None:
    db.add(
        QuizAttempt(
            question_id=question.id,
            user_id=user.id,
            answer="A",
            correct=correct,
        )
    )
    db.commit()


def _seed_review(
    db: Session,
    user: User,
    point: KnowledgePoint,
    *,
    review_date: datetime | None = None,
) -> ReviewCard:
    moment = review_date or datetime.now(TZ)
    card = ReviewCard(
        user_id=user.id,
        knowledge_point_id=point.id,
        quiz_question_id=None,
        question="光合作用的场所是？",
        answer="叶绿体",
        card_type="manual",
        difficulty=5.0,
        stability=1.0,
        retrievability=1.0,
        state=1,
        reps=1,
        lapses=0,
        due_date=moment.date(),
        last_review=moment,
        scheduler="dsr_lite",
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    db.add(
        ReviewLog(
            card_id=card.id,
            user_id=user.id,
            rating=3,
            response_time_ms=None,
            reviewed_at=moment,
            review_date=moment.date(),
            stability=1.0,
            difficulty=5.0,
            scheduled_days=1,
        )
    )
    db.commit()
    return card


def test_profile_info_is_derived_and_scoped(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    first = make_user("林同学")
    second = make_user("另一位")
    source = _seed_source(db_session, first, competition_id=None)
    point = _seed_point(db_session, first, source)
    for _ in range(5):
        _seed_review(db_session, first, point)

    own = client.get("/api/profile/info", headers=_headers(first))
    assert own.status_code == 200, own.text
    body = own.json()
    assert body["id"] == first.id
    assert body["name"] == "林同学"
    assert body["email"] == first.email
    assert 0 <= body["avatarHue"] < 360
    assert body["level"] == "启行"
    assert body["joinedAt"]
    assert body["competitionCount"] == 0

    other = client.get("/api/profile/info", headers=_headers(second)).json()
    assert other["id"] == second.id
    assert other["name"] == "另一位"
    assert other["level"] == "初识"


def test_profile_stats_shape_and_values(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user("统计用户")
    competition = _create_competition(client, user, "统计竞赛")
    source = _seed_source(db_session, user, competition["id"])
    low = _seed_point(db_session, user, source, mastery=0.5)
    _seed_point(db_session, user, source, mastery=0.9)
    _seed_review(db_session, user, low)

    response = client.get("/api/profile/stats", headers=_headers(user))
    assert response.status_code == 200, response.text
    stats = response.json()
    assert [item["key"] for item in stats] == [
        "competitions",
        "reviews",
        "mastery",
        "streak",
    ]
    assert [item["label"] for item in stats] == [
        "参赛数",
        "复习次数",
        "平均掌握度",
        "连续学习天数",
    ]
    assert {item["tone"] for item in stats} == {"primary", "success", "warning", "violet"}
    assert stats[0]["value"] == "1"
    assert stats[1]["value"] == "1"
    assert stats[2]["value"] == "70"
    assert stats[3]["value"] == "1"


def test_competition_records_only_list_own_memberships(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    first = make_user("甲")
    second = make_user("乙")
    mine = _create_competition(client, first, "我的竞赛")
    theirs = _create_competition(client, second, "别人的竞赛")

    response = client.get("/api/profile/competition-records", headers=_headers(first))
    assert response.status_code == 200, response.text
    records = response.json()
    ids = [record["id"] for record in records]
    assert mine["id"] in ids
    assert theirs["id"] not in ids
    record = next(item for item in records if item["id"] == mine["id"])
    assert record["title"] == "我的竞赛"
    assert record["role"] == "leader"
    assert record["memberCount"] == 1
    assert record["joinedAt"]
    assert record["status"] in {"即将开始", "进行中", "已结束"}


def test_study_progress_has_percentages(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user("进度用户")
    competition = _create_competition(client, user, "进度竞赛")
    source = _seed_source(db_session, user, competition["id"])
    point = _seed_point(db_session, user, source, mastery=0.9)
    _seed_review(db_session, user, point)

    response = client.get("/api/profile/study-progress", headers=_headers(user))
    assert response.status_code == 200, response.text
    progress = response.json()
    assert progress
    labels = {item["label"] for item in progress}
    assert labels == {"知识点掌握", "复习卡片", "今日复习", "试炼完成"}
    for item in progress:
        assert item["total"] >= item["value"] >= 0
        assert 0 <= item["percent"] <= 100
    mastered = next(item for item in progress if item["label"] == "知识点掌握")
    assert mastered["value"] == 1


def test_settings_endpoint_was_removed(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user("设置用户")
    response = client.get("/api/profile/settings", headers=_headers(user))
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "NOT_FOUND"


def test_leaderboard_orders_by_points_with_contiguous_rank(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    leader = make_user("队长")
    second = make_user("队员乙")
    third = make_user("队员丙")
    competition = _create_competition(client, leader, "积分竞赛")
    _join(client, second, competition["inviteCode"])
    _join(client, third, competition["inviteCode"])

    source = _seed_source(db_session, leader, competition["id"])
    point = _seed_point(db_session, leader, source)
    question = _seed_question(db_session, leader, point, competition["id"])
    for _ in range(3):
        _seed_attempt(db_session, leader, question, correct=True)
    _seed_review(db_session, leader, point)
    _seed_attempt(db_session, second, question, correct=True)
    _seed_attempt(db_session, second, question, correct=False)

    response = client.get(
        f"/api/leaderboard/{competition['id']}", headers=_headers(leader)
    )
    assert response.status_code == 200, response.text
    entries = response.json()

    assert [entry["rank"] for entry in entries] == [1, 2, 3]
    assert [entry["userId"] for entry in entries[:3]] == [leader.id, second.id, third.id]
    points = [entry["points"] for entry in entries]
    assert points == sorted(points, reverse=True)
    assert points[0] == 3 * 10 + 1 * 4
    assert points[1] == 10
    assert points[2] == 0
    assert all(entry["tier"] and entry["division"] for entry in entries)
    assert all(0 <= entry["avatarHue"] < 360 for entry in entries)


def test_leaderboard_hides_from_non_members(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user("参赛者")
    outsider = make_user("旁观者")
    competition = _create_competition(client, owner, "私密竞赛")

    response = client.get(
        f"/api/leaderboard/{competition['id']}", headers=_headers(outsider)
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["code"] == "NOT_FOUND"
    assert body["detail"]

    missing = client.get("/api/leaderboard/does-not-exist", headers=_headers(owner))
    assert missing.status_code == 404
    assert missing.json()["code"] == "NOT_FOUND"


def test_profile_endpoints_require_auth(client: TestClient) -> None:
    for path in (
        "/api/profile/info",
        "/api/profile/stats",
        "/api/profile/competition-records",
        "/api/profile/study-progress",
        "/api/profile/preferences",
    ):
        response = client.get(path)
        assert response.status_code == 401, path

    removed = client.get("/api/profile/settings")
    assert removed.status_code == 404, removed.text


def test_leaderboard_paginates_with_global_rank(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    leader = make_user("队长")
    second = make_user("队员乙")
    third = make_user("队员丙")
    competition = _create_competition(client, leader, "分页竞赛")
    _join(client, second, competition["inviteCode"])
    _join(client, third, competition["inviteCode"])

    first_page = client.get(
        f"/api/leaderboard/{competition['id']}?limit=1&offset=1",
        headers=_headers(leader),
    )
    second_page = client.get(
        f"/api/leaderboard/{competition['id']}?limit=1&offset=2",
        headers=_headers(leader),
    )

    assert first_page.status_code == 200, first_page.text
    assert first_page.headers["X-Total-Count"] == "3"
    assert [entry["rank"] for entry in first_page.json()] == [2]
    assert second_page.status_code == 200, second_page.text
    assert second_page.headers["X-Total-Count"] == "3"
    assert [entry["rank"] for entry in second_page.json()] == [3]
