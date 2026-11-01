"""API tests for the adaptive practice loop."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from typing import Any

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
    PracticeItem,
    PracticeSession,
    QuizQuestion,
    User,
)

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

    def _create(display_name: str = "练习用户") -> User:
        user = User(
            email=f"practice-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        created.append(user.id)
        return user

    yield _create

    db_session.commit()
    db_session.expire_all()
    if created:
        session_ids = db_session.scalars(
            select(PracticeSession.id).where(PracticeSession.user_id.in_(created))
        ).all()
        if session_ids:
            db_session.execute(
                delete(PracticeItem).where(PracticeItem.session_id.in_(session_ids))
            )
            db_session.execute(
                delete(PracticeSession).where(PracticeSession.id.in_(session_ids))
            )
        competitions = db_session.scalars(
            select(Competition.id).where(Competition.owner_id.in_(created))
        ).all()
        if competitions:
            db_session.execute(
                delete(CompetitionMember).where(
                    CompetitionMember.competition_id.in_(competitions)
                )
            )
            db_session.execute(
                delete(KnowledgeSource).where(
                    KnowledgeSource.competition_id.in_(competitions)
                )
            )
            db_session.execute(delete(Competition).where(Competition.id.in_(competitions)))
        db_session.execute(
            delete(CompetitionMember).where(CompetitionMember.user_id.in_(created))
        )
        db_session.execute(delete(QuizQuestion).where(QuizQuestion.user_id.in_(created)))
        db_session.execute(delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created)))
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _make_point(
    db_session: Session,
    user: User,
    *,
    title: str = "练习知识点",
    competition_id: str | None = None,
) -> KnowledgePoint:
    source = KnowledgeSource(
        user_id=user.id,
        competition_id=competition_id,
        title=f"{title}资料",
        filename="practice.pdf",
        content_type="application/pdf",
        size_bytes=1,
        storage_key=f"tests/{uuid.uuid4().hex}.pdf",
        status="ready",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    point = KnowledgePoint(
        user_id=user.id,
        source_id=source.id,
        title=title,
        content="",
        level=0,
        sort_order=0,
    )
    db_session.add(point)
    db_session.commit()
    db_session.refresh(point)
    return point


def _make_question(
    db_session: Session,
    user: User,
    point: KnowledgePoint,
    *,
    difficulty: str,
    answer: str = "A",
    qtype: str = "choice",
    stem: str = "题目",
    explanation: str = "解析",
) -> QuizQuestion:
    question = QuizQuestion(
        user_id=user.id,
        knowledge_point_id=point.id,
        type=qtype,
        question=stem,
        options=["A. 甲", "B. 乙", "C. 丙", "D. 丁"] if qtype == "choice" else None,
        answer=answer,
        explanation=explanation,
        difficulty=difficulty,
    )
    db_session.add(question)
    db_session.commit()
    db_session.refresh(question)
    return question


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _start(
    client: TestClient,
    user: User,
    point: KnowledgePoint,
    *,
    difficulty: str = "easy",
) -> dict[str, Any]:
    response = client.post(
        "/api/assistant/practice/sessions",
        json={"knowledge_point_ids": [point.id], "difficulty": difficulty},
        headers=_headers(user),
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _answer(
    client: TestClient, user: User, session_id: str, question_id: str, answer: str
) -> Any:
    return client.post(
        f"/api/assistant/practice/sessions/{session_id}/answer",
        json={"question_id": question_id, "answer": answer},
        headers=_headers(user),
    )


def test_create_session_returns_first_question_without_leaking_answer(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    question = _make_question(
        db_session, user, point, difficulty="easy", answer="B", stem="首题题干"
    )

    body = _start(client, user, point)

    assert body["session_id"]
    assert body["difficulty"] == "easy"
    assert body["status"] == "active"
    assert body["progress"] == {"answered": 0, "correct": 0, "total": 1}
    current = body["current_question"]
    assert current["id"] == question.id
    assert current["no"] == 1
    assert current["type"] == "choice"
    assert current["difficulty"] == "easy"
    assert current["stem"] == "首题题干"
    assert current["options"] == ["A. 甲", "B. 乙", "C. 丙", "D. 丁"]
    assert "answer" not in current
    assert "explanation" not in current


def test_correct_answer_is_graded_and_explained(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    question = _make_question(
        db_session, user, point, difficulty="easy", answer="A", explanation="因为甲"
    )
    body = _start(client, user, point)

    response = _answer(client, user, body["session_id"], question.id, "A")

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["correct"] is True
    assert result["correct_answer"] == "A"
    assert result["explanation"] == "因为甲"
    assert result["progress"] == {"answered": 1, "correct": 1, "total": 1}
    assert result["current_question"] is None
    assert result["finished"] is True


def test_two_correct_answers_move_one_step_harder(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    for stem in ("简单一", "简单二"):
        _make_question(db_session, user, point, difficulty="easy", answer="A", stem=stem)
    _make_question(db_session, user, point, difficulty="medium", answer="A", stem="中档")

    body = _start(client, user, point, difficulty="easy")
    first = body["current_question"]
    assert first["difficulty"] == "easy"

    after_first = _answer(client, user, body["session_id"], first["id"], "A").json()
    assert after_first["difficulty"] == "easy"
    assert after_first["current_question"]["difficulty"] == "easy"

    second = after_first["current_question"]
    after_second = _answer(client, user, body["session_id"], second["id"], "A").json()

    assert after_second["difficulty"] == "medium"
    assert after_second["current_question"]["difficulty"] == "medium"


def test_two_wrong_answers_move_one_step_easier(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    for stem in ("困难一", "困难二"):
        _make_question(db_session, user, point, difficulty="hard", answer="A", stem=stem)
    _make_question(db_session, user, point, difficulty="medium", answer="A", stem="中档")

    body = _start(client, user, point, difficulty="hard")
    first = body["current_question"]
    assert first["difficulty"] == "hard"

    after_first = _answer(client, user, body["session_id"], first["id"], "B").json()
    assert after_first["difficulty"] == "hard"

    second = after_first["current_question"]
    after_second = _answer(client, user, body["session_id"], second["id"], "B").json()

    assert after_second["difficulty"] == "medium"
    assert after_second["current_question"]["difficulty"] == "medium"


def test_question_ids_are_never_repeated_within_a_session(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    for index in range(4):
        _make_question(
            db_session, user, point, difficulty="easy", answer="A", stem=f"题{index}"
        )

    body = _start(client, user, point)
    session_id = body["session_id"]
    seen: list[str] = []
    current = body["current_question"]
    while current is not None:
        seen.append(current["id"])
        response = _answer(client, user, session_id, current["id"], "A")
        assert response.status_code == 200, response.text
        body = response.json()
        current = body["current_question"]

    assert len(seen) == 4
    assert len(set(seen)) == 4
    assert body["finished"] is True

    stored = db_session.scalars(
        select(PracticeItem.question_id).where(PracticeItem.session_id == session_id)
    ).all()
    assert len(stored) == len(set(stored)) == 4


def test_fifty_first_question_is_409_session_limit(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    for index in range(50):
        _make_question(
            db_session, user, point, difficulty="easy", answer="A", stem=f"题{index}"
        )

    body = _start(client, user, point)
    session_id = body["session_id"]
    for _ in range(49):
        current = body["current_question"]
        assert current is not None
        response = _answer(client, user, session_id, current["id"], "A")
        assert response.status_code == 200, response.text
        body = response.json()

    assert body["progress"]["total"] == 50
    current = body["current_question"]
    assert current is not None

    rejected = _answer(client, user, session_id, current["id"], "A")

    assert rejected.status_code == 409
    assert rejected.json()["code"] == "SESSION_LIMIT"


def test_foreign_session_is_404(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    owner = make_user("出题人")
    stranger = make_user("陌生人")
    point = _make_point(db_session, owner)
    question = _make_question(db_session, owner, point, difficulty="easy", answer="A")
    body = _start(client, owner, point)

    read = client.get(
        f"/api/assistant/practice/sessions/{body['session_id']}",
        headers=_headers(stranger),
    )
    answered = _answer(client, stranger, body["session_id"], question.id, "A")
    ended = client.post(
        f"/api/assistant/practice/sessions/{body['session_id']}/end",
        headers=_headers(stranger),
    )
    missing = client.get(
        f"/api/assistant/practice/sessions/{uuid.uuid4()}", headers=_headers(stranger)
    )

    for response in (read, answered, ended, missing):
        assert response.status_code == 404
        assert response.json()["code"] == "NOT_FOUND"


def test_end_summary_and_answers_after_end_are_409(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    for stem in ("一", "二"):
        _make_question(db_session, user, point, difficulty="easy", answer="A", stem=stem)

    body = _start(client, user, point)
    current = body["current_question"]
    first = _answer(client, user, body["session_id"], current["id"], "A").json()
    current = first["current_question"]
    second = _answer(client, user, body["session_id"], current["id"], "B").json()
    assert second["progress"] == {"answered": 2, "correct": 1, "total": 2}

    ended = client.post(
        f"/api/assistant/practice/sessions/{body['session_id']}/end",
        headers=_headers(user),
    )

    assert ended.status_code == 200, ended.text
    summary = ended.json()
    assert summary["answered"] == 2
    assert summary["correct"] == 1
    assert summary["accuracy"] == 0.5
    assert summary["ended_at"]

    detail = client.get(
        f"/api/assistant/practice/sessions/{body['session_id']}",
        headers=_headers(user),
    )
    assert detail.status_code == 200
    assert detail.json()["status"] == "ended"

    after_end = _answer(client, user, body["session_id"], current["id"], "A")
    assert after_end.status_code == 409
    assert after_end.json()["code"] == "SESSION_ENDED"


def test_stale_question_is_409_not_current_question(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    first = _make_question(db_session, user, point, difficulty="easy", answer="A", stem="一")
    _make_question(db_session, user, point, difficulty="easy", answer="A", stem="二")
    body = _start(client, user, point)

    _answer(client, user, body["session_id"], first.id, "A")
    stale = _answer(client, user, body["session_id"], first.id, "A")

    assert stale.status_code == 409
    assert stale.json()["code"] == "NOT_CURRENT_QUESTION"


def test_unseen_item_does_not_leak_answer_in_detail(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_point(db_session, user)
    _make_question(db_session, user, point, difficulty="easy", answer="A", stem="一")
    _make_question(db_session, user, point, difficulty="easy", answer="B", stem="二")
    body = _start(client, user, point)
    current = body["current_question"]
    _answer(client, user, body["session_id"], current["id"], "A")

    detail = client.get(
        f"/api/assistant/practice/sessions/{body['session_id']}",
        headers=_headers(user),
    ).json()

    items = detail["items"]
    assert len(items) == 2
    assert items[0]["answered"] is True
    assert items[0]["correct"] is True
    assert items[0]["correct_answer"] == "A"
    assert items[1]["answered"] is False
    assert items[1]["correct"] is None
    assert items[1]["correct_answer"] is None
    assert items[1]["explanation"] is None
    assert detail["current_question"]["id"] == items[1]["question_id"]
    assert "answer" not in detail["current_question"]


def test_knowledge_point_visibility_is_enforced(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    owner = make_user("资料主")
    stranger = make_user("陌生人")
    private_point = _make_point(db_session, owner, title="私有知识点")
    _make_question(db_session, owner, private_point, difficulty="easy", answer="A")

    denied = client.post(
        "/api/assistant/practice/sessions",
        json={"knowledge_point_ids": [private_point.id]},
        headers=_headers(stranger),
    )

    assert denied.status_code == 404
    assert denied.json()["code"] == "NOT_FOUND"


def test_competition_member_can_practice_shared_point(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    owner = make_user("队长")
    member = make_user("队员")
    competition = Competition(owner_id=owner.id, title="练习竞赛")
    db_session.add(competition)
    db_session.commit()
    db_session.refresh(competition)
    db_session.add(
        CompetitionMember(
            competition_id=competition.id, user_id=member.id, role="member"
        )
    )
    db_session.commit()
    point = _make_point(
        db_session, owner, title="共享知识点", competition_id=competition.id
    )
    _make_question(db_session, owner, point, difficulty="easy", answer="A")

    allowed = client.post(
        "/api/assistant/practice/sessions",
        json={"knowledge_point_ids": [point.id]},
        headers=_headers(member),
    )

    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["current_question"]["difficulty"] == "easy"


def test_empty_knowledge_points_is_422(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = client.post(
        "/api/assistant/practice/sessions",
        json={"knowledge_point_ids": []},
        headers=_headers(user),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
