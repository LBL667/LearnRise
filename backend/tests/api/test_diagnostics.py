"""API tests for wrong-question diagnostics derived from quiz attempts."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    Competition,
    KnowledgePoint,
    QuizAttempt,
    QuizQuestion,
    User,
)
from app.security.password import hash_password

PASSWORD = "demo1234"
START = datetime(2026, 1, 1, tzinfo=UTC)


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

    def _create(name: str = "诊断用户") -> User:
        user = User(
            email=f"diag-{uuid.uuid4().hex}@example.com",
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


def _make_competition(db: Session, owner: User, title: str = "诊断竞赛") -> Competition:
    competition = Competition(owner_id=owner.id, title=title)
    db.add(competition)
    db.commit()
    return competition


def _make_kp(
    db: Session, user: User, title: str = "知识点", mastery: float = 0.0
) -> KnowledgePoint:
    point = KnowledgePoint(
        user_id=user.id,
        title=title,
        content="",
        level=0,
        sort_order=0,
        mastery_score=mastery,
    )
    db.add(point)
    db.commit()
    return point


def _make_question(
    db: Session,
    user: User,
    point: KnowledgePoint,
    *,
    qtype: str = "choice",
    stem: str = "示例题目",
    options: list[str] | None = None,
    answer: str = "A",
    explanation: str = "解析",
    competition_id: str | None = None,
) -> QuizQuestion:
    question = QuizQuestion(
        user_id=user.id,
        knowledge_point_id=point.id,
        competition_id=competition_id,
        type=qtype,
        question=stem,
        options=options,
        answer=answer,
        explanation=explanation,
    )
    db.add(question)
    db.commit()
    return question


def _attempt(
    db: Session,
    user: User,
    question: QuizQuestion,
    *,
    answer: str,
    correct: bool,
    offset_minutes: int,
) -> QuizAttempt:
    attempt = QuizAttempt(
        question_id=question.id,
        user_id=user.id,
        answer=answer,
        correct=correct,
        created_at=START + timedelta(minutes=offset_minutes),
    )
    db.add(attempt)
    db.commit()
    return attempt


def test_repeat_severity_at_three_wrong_attempts(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    point = _make_kp(db_session, user, "图论基础")
    question = _make_question(
        db_session,
        user,
        point,
        stem="最短路算法是哪一个？",
        options=["A. Dijkstra", "B. Kruskal"],
        answer="A",
        explanation="Dijkstra 用于单源最短路",
    )
    for index, answer in enumerate(("B", "C", "B")):
        _attempt(
            db_session,
            user,
            question,
            answer=answer,
            correct=False,
            offset_minutes=index,
        )

    response = client.get("/api/wrong-questions", headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert response.headers["X-Total-Count"] == "1"
    assert len(body) == 1
    item = body[0]
    assert item["id"] == question.id
    assert item["wrongCount"] == 3
    assert item["severity"] == "repeat"
    assert item["type"] == "choice"
    assert item["stem"] == "最短路算法是哪一个？"
    assert item["tags"] == ["图论基础"]
    assert item["myMistake"] == "B"
    assert item["options"] == [
        {"key": "A", "text": "Dijkstra"},
        {"key": "B", "text": "Kruskal"},
    ]
    assert item["analysis"]["choiceAnswer"] == "A"
    assert item["analysis"]["answer"] == "A"
    assert item["analysis"]["conclusion"] == "Dijkstra 用于单源最短路"
    verdicts = {note["key"]: note["verdict"] for note in item["analysis"]["optionNotes"]}
    assert verdicts == {"A": "correct", "B": "wrong"}


def test_pagination_reports_total_and_orders_by_wrong_count(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    point = _make_kp(db_session, user, "分页知识点")
    most_wrong = _make_question(db_session, user, point, stem="错得最多")
    _make_question(db_session, user, point, stem="错一次 A")
    _make_question(db_session, user, point, stem="错一次 B")
    for index in range(2):
        _attempt(
            db_session,
            user,
            most_wrong,
            answer="B",
            correct=False,
            offset_minutes=index,
        )
    for question in db_session.query(QuizQuestion).filter(
        QuizQuestion.question.in_(["错一次 A", "错一次 B"])
    ):
        _attempt(
            db_session,
            user,
            question,
            answer="B",
            correct=False,
            offset_minutes=10,
        )

    first = client.get("/api/wrong-questions?limit=1", headers=headers)
    second = client.get("/api/wrong-questions?limit=1&offset=2", headers=headers)

    assert first.status_code == 200
    assert first.headers["X-Total-Count"] == "3"
    assert len(first.json()) == 1
    assert first.json()[0]["id"] == most_wrong.id
    assert second.status_code == 200
    assert second.headers["X-Total-Count"] == "3"
    assert len(second.json()) == 1


def test_type_severity_and_text_filters(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    point = _make_kp(db_session, user, "筛选知识点")
    repeated = _make_question(db_session, user, point, qtype="choice", stem="选择题干")
    judge = _make_question(
        db_session, user, point, qtype="judge", stem="判断题干", options=None, answer="true"
    )
    blank = _make_question(
        db_session,
        user,
        point,
        qtype="short_answer",
        stem="填空题干",
        options=None,
        answer="答案",
    )
    for index in range(3):
        _attempt(
            db_session,
            user,
            repeated,
            answer="B",
            correct=False,
            offset_minutes=index,
        )
    _attempt(db_session, user, judge, answer="false", correct=False, offset_minutes=10)
    _attempt(db_session, user, blank, answer="错误答案", correct=False, offset_minutes=11)

    by_judge = client.get("/api/wrong-questions?type=judge", headers=headers)
    by_blank_alias = client.get("/api/wrong-questions?type=blank", headers=headers)
    by_repeat = client.get("/api/wrong-questions?severity=repeat", headers=headers)
    by_general = client.get("/api/wrong-questions?severity=general", headers=headers)
    by_text = client.get("/api/wrong-questions?q=判断", headers=headers)

    assert [item["id"] for item in by_judge.json()] == [judge.id]
    assert [item["id"] for item in by_blank_alias.json()] == [blank.id]
    assert by_blank_alias.json()[0]["type"] == "blank"
    assert [item["id"] for item in by_repeat.json()] == [repeated.id]
    assert {item["id"] for item in by_general.json()} == {judge.id, blank.id}
    assert [item["id"] for item in by_text.json()] == [judge.id]


def test_dismissal_hides_row_and_is_idempotent(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    point = _make_kp(db_session, user, "隐藏知识点")
    question = _make_question(db_session, user, point)
    never_wrong = _make_question(db_session, user, point, stem="从未答错")
    _attempt(db_session, user, question, answer="B", correct=False, offset_minutes=0)
    _attempt(db_session, user, never_wrong, answer="A", correct=True, offset_minutes=1)

    first = client.delete(f"/api/wrong-questions/{question.id}", headers=headers)
    second = client.delete(f"/api/wrong-questions/{question.id}", headers=headers)
    hidden = client.get("/api/wrong-questions", headers=headers)
    missing = client.delete(
        f"/api/wrong-questions/{uuid.uuid4()}", headers=headers
    )
    malformed = client.delete("/api/wrong-questions/not-a-uuid", headers=headers)
    not_wrong = client.delete(f"/api/wrong-questions/{never_wrong.id}", headers=headers)

    assert first.status_code == 204
    assert second.status_code == 204
    assert hidden.status_code == 200
    assert hidden.json() == []
    assert hidden.headers["X-Total-Count"] == "0"
    assert missing.status_code == 404
    assert missing.json() == {"detail": "资源不存在", "code": "NOT_FOUND"}
    assert malformed.status_code == 404
    assert malformed.json()["code"] == "NOT_FOUND"
    assert not_wrong.status_code == 404
    assert not_wrong.json()["code"] == "NOT_FOUND"


def test_weak_points_rank_by_error_rate(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    weak = _make_kp(db_session, user, "薄弱知识点")
    steadier = _make_kp(db_session, user, "较稳知识点")
    weak_question = _make_question(db_session, user, weak, stem="薄弱题")
    steadier_question = _make_question(db_session, user, steadier, stem="较稳题")
    for index in range(2):
        _attempt(
            db_session,
            user,
            weak_question,
            answer="B",
            correct=False,
            offset_minutes=index,
        )
    _attempt(
        db_session, user, steadier_question, answer="B", correct=False, offset_minutes=5
    )
    for index in range(3):
        _attempt(
            db_session,
            user,
            steadier_question,
            answer="A",
            correct=True,
            offset_minutes=6 + index,
        )

    response = client.get("/api/assistant/weak-points", headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["knowledge_point_id"] for item in body] == [weak.id, steadier.id]
    assert body[0]["total_attempts"] == 2
    assert body[0]["wrong_attempts"] == 2
    assert body[0]["error_rate"] == 1.0
    assert body[0]["mastery_score"] == 0.0
    assert body[0]["score"] == 1.0
    assert body[1]["total_attempts"] == 4
    assert body[1]["wrong_attempts"] == 1
    assert body[1]["error_rate"] == 0.25
    assert body[1]["score"] < body[0]["score"]


def test_remediation_plan_recommends_most_wrong_questions(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    weak = _make_kp(db_session, user, "补强知识点")
    other = _make_kp(db_session, user, "次要知识点")
    first = _make_question(db_session, user, weak, qtype="choice", stem="补强一")
    second = _make_question(
        db_session, user, weak, qtype="short_answer", stem="补强二", options=None
    )
    third = _make_question(db_session, user, other, qtype="judge", stem="次要一", options=None)
    for index in range(2):
        _attempt(
            db_session, user, first, answer="B", correct=False, offset_minutes=index
        )
    _attempt(db_session, user, second, answer="错", correct=False, offset_minutes=3)
    _attempt(db_session, user, third, answer="false", correct=False, offset_minutes=4)
    _attempt(db_session, user, third, answer="true", correct=True, offset_minutes=5)

    response = client.post(
        "/api/assistant/remediation-plan", json={}, headers=headers
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["guidance"] is None
    assert [item["knowledge_point_id"] for item in body["items"]] == [weak.id, other.id]
    recommended = body["items"][0]["recommended_questions"]
    assert [item["id"] for item in recommended] == [first.id, second.id]
    assert [item["wrong_count"] for item in recommended] == [2, 1]
    assert recommended[1]["type"] == "blank"

    limited = client.post(
        "/api/assistant/remediation-plan", json={"limit": 1}, headers=headers
    )
    assert len(limited.json()["items"]) == 1


def test_remediation_plan_is_empty_without_attempts(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    headers = _login(client, make_user())

    response = client.post(
        "/api/assistant/remediation-plan", json={}, headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "guidance": "先做一轮诊断练习，再生成补强清单",
    }


def test_competition_filter_scopes_wrong_questions_and_weak_points(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    competition = _make_competition(db_session, user)
    shared = _make_kp(db_session, user, "竞赛知识点")
    personal = _make_kp(db_session, user, "个人知识点")
    shared_question = _make_question(
        db_session, user, shared, stem="竞赛题", competition_id=competition.id
    )
    personal_question = _make_question(db_session, user, personal, stem="个人题")
    _attempt(
        db_session, user, shared_question, answer="B", correct=False, offset_minutes=0
    )
    _attempt(
        db_session, user, personal_question, answer="B", correct=False, offset_minutes=1
    )

    scoped = client.get(
        f"/api/wrong-questions?competition_id={competition.id}", headers=headers
    )
    personal_only = client.get("/api/wrong-questions", headers=headers)
    weak = client.get(
        f"/api/assistant/weak-points?competition_id={competition.id}", headers=headers
    )

    assert [item["id"] for item in scoped.json()] == [shared_question.id]
    assert scoped.headers["X-Total-Count"] == "1"
    assert {item["id"] for item in personal_only.json()} == {
        shared_question.id,
        personal_question.id,
    }
    assert [item["knowledge_point_id"] for item in weak.json()] == [shared.id]
