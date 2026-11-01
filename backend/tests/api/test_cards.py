"""API tests for review cards generated from wrong answers.

All requests are DB-only: the vector fallback is never reached because the
wrong-answer questions below point at a chunk-owned knowledge point.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import (
    Chunk,
    KnowledgePoint,
    KnowledgeSource,
    QuizAttempt,
    QuizQuestion,
    ReviewCard,
    User,
)
from app.services.cards import ensure_card_for_wrong_answer

TODAY = datetime.now(ZoneInfo("Asia/Shanghai")).date()


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
            email=f"task20-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(
            delete(ReviewCard).where(ReviewCard.user_id.in_(created))
        )
        db_session.execute(
            delete(QuizAttempt).where(QuizAttempt.user_id.in_(created))
        )
        db_session.execute(
            delete(QuizQuestion).where(QuizQuestion.user_id.in_(created))
        )
        db_session.execute(
            delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created))
        )
        db_session.execute(delete(Chunk).where(Chunk.user_id.in_(created)))
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_source(db_session: Session, user: User) -> KnowledgeSource:
    source = KnowledgeSource(
        user_id=user.id,
        title="生物学讲义",
        filename="biology.pdf",
        content_type="application/pdf",
        size_bytes=1024,
        storage_key=f"{user.id}/biology.pdf",
        status="ready",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def _make_chunk(db_session: Session, user: User, source: KnowledgeSource) -> Chunk:
    chunk = Chunk(
        source_id=source.id,
        user_id=user.id,
        chunk_index=0,
        content="光合作用在叶绿体中把光能转化为化学能。",
        page=7,
        heading="光合作用",
        token_count=12,
        embedding=None,
        embedding_model="fake",
        embedding_dim=4,
        embedding_version="1",
    )
    db_session.add(chunk)
    db_session.commit()
    db_session.refresh(chunk)
    return chunk


def _make_kp(
    db_session: Session,
    user: User,
    source: KnowledgeSource,
    chunk: Chunk,
) -> KnowledgePoint:
    point = KnowledgePoint(
        user_id=user.id,
        source_id=source.id,
        chunk_id=chunk.id,
        parent_id=None,
        title="光合作用",
        content="绿色植物利用光能合成有机物。",
        level=0,
        sort_order=0,
        mastery_score=0.0,
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
    qtype: str = "choice",
    answer: str = "A",
    options: list[str] | None = None,
    question: str = "光合作用的场所是？",
    explanation: str = "叶绿体是光合作用的场所。",
) -> QuizQuestion:
    row = QuizQuestion(
        user_id=user.id,
        knowledge_point_id=point.id,
        type=qtype,
        question=question,
        options=options if options is not None else ["叶绿体", "线粒体", "核糖体", "液泡"],
        answer=answer,
        explanation=explanation,
        difficulty="medium",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _make_manual_card(
    db_session: Session,
    user: User,
    *,
    state: int = 0,
    question: str = "手动卡片",
) -> ReviewCard:
    card = ReviewCard(
        user_id=user.id,
        knowledge_point_id=None,
        quiz_question_id=None,
        question=question,
        answer="答案",
        card_type="manual",
        difficulty=5.0,
        stability=1.0,
        retrievability=1.0,
        state=state,
        reps=0,
        lapses=0,
        due_date=TODAY,
        scheduler="dsr_lite",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    return card


def _count_cards(db_session: Session, user: User) -> int:
    return int(
        db_session.scalar(
            select(func.count()).select_from(ReviewCard).where(
                ReviewCard.user_id == user.id
            )
        )
        or 0
    )


def _submit(
    client: TestClient, user: User, question: QuizQuestion, answer: str
) -> None:
    response = client.post(
        f"/api/quiz/{question.id}/answer",
        headers=_headers(user),
        json={"answer": answer},
    )
    assert response.status_code == 200, response.text


def _setup_question(
    db_session: Session, user: User, **kwargs: object
) -> QuizQuestion:
    source = _make_source(db_session, user)
    chunk = _make_chunk(db_session, user, source)
    point = _make_kp(db_session, user, source, chunk)
    return _make_question(db_session, user, point, **kwargs)


def test_wrong_answer_creates_one_card(
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    question = _setup_question(db_session, user)

    card = ensure_card_for_wrong_answer(db_session, user_id=user.id, question=question)
    db_session.commit()

    assert card is not None
    db_session.refresh(card)
    assert card.question == question.question
    assert card.answer == "A. 叶绿体\n\n解析：叶绿体是光合作用的场所。"
    assert card.card_type == "quiz_wrong"
    assert card.knowledge_point_id == question.knowledge_point_id
    assert card.quiz_question_id == question.id
    assert card.difficulty == 5.0
    assert card.stability == 1.0
    assert card.retrievability == 1.0
    assert card.state == 0
    assert card.reps == 0
    assert card.lapses == 0
    assert card.due_date == TODAY
    assert card.last_review is None
    assert card.scheduler == "dsr_lite"
    assert _count_cards(db_session, user) == 1


def test_short_answer_card_uses_answer_text(
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    question = _setup_question(
        db_session,
        user,
        qtype="short_answer",
        answer="在叶绿体中进行",
        options=None,
        question="简述光合作用的场所。",
        explanation="",
    )

    card = ensure_card_for_wrong_answer(db_session, user_id=user.id, question=question)
    db_session.commit()

    assert card is not None
    assert card.answer == "在叶绿体中进行"


def test_second_wrong_answer_keeps_one_card(
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    question = _setup_question(db_session, user)
    first = ensure_card_for_wrong_answer(db_session, user_id=user.id, question=question)
    assert first is not None
    first.reps = 3
    first.stability = 4.0
    first.state = 2
    db_session.commit()

    second = ensure_card_for_wrong_answer(db_session, user_id=user.id, question=question)
    db_session.commit()

    assert second is not None
    db_session.refresh(second)
    assert _count_cards(db_session, user) == 1
    assert second.reps == 3
    assert second.stability == 4.0
    assert second.state == 2


def test_correct_answer_no_card(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    question = _setup_question(db_session, user, answer="A")

    response = client.post(
        f"/api/quiz/{question.id}/answer",
        headers=_headers(user),
        json={"answer": "A"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["card_created"] is False
    assert _count_cards(db_session, user) == 0


def test_manual_card_created(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    chunk = _make_chunk(db_session, user, source)
    point = _make_kp(db_session, user, source, chunk)

    response = client.post(
        "/api/review/cards",
        headers=_headers(user),
        json={
            "knowledge_point_id": point.id,
            "question": "光合作用释放什么气体？",
            "answer": "氧气",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["question"] == "光合作用释放什么气体？"
    assert body["answer"] == "氧气"
    assert body["knowledge_point_id"] == point.id
    assert body["quiz_question_id"] is None
    assert body["card_type"] == "manual"
    assert body["due_date"] == TODAY.isoformat()
    assert body["difficulty"] == 5.0
    assert body["stability"] == 1.0
    assert body["retrievability"] == 1.0
    assert body["state"] == 0
    assert body["reps"] == 0
    assert _count_cards(db_session, user) == 1


def test_manual_card_rejects_foreign_knowledge_point(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    owner = make_user("所有者")
    intruder = make_user("入侵者")
    source = _make_source(db_session, owner)
    chunk = _make_chunk(db_session, owner, source)
    point = _make_kp(db_session, owner, source, chunk)

    response = client.post(
        "/api/review/cards",
        headers=_headers(intruder),
        json={"knowledge_point_id": point.id, "question": "问", "answer": "答"},
    )

    assert response.status_code == 404
    assert _count_cards(db_session, intruder) == 0


def test_list_filters_by_state(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    _make_manual_card(db_session, user, state=0, question="新卡")
    _make_manual_card(db_session, user, state=2, question="复习卡")

    response = client.get(
        "/api/review/cards", headers=_headers(user), params={"state": 2}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["question"] for item in body] == ["复习卡"]
    assert body[0]["state"] == 2


def test_list_limit_capped(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    for index in range(205):
        _make_manual_card(db_session, user, question=f"卡片{index}")

    response = client.get(
        "/api/review/cards", headers=_headers(user), params={"limit": 1000}
    )

    assert response.status_code == 200, response.text
    assert len(response.json()) == 200


def test_list_limit_returns_at_most_requested(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    for index in range(3):
        _make_manual_card(db_session, user, question=f"卡片{index}")

    response = client.get(
        "/api/review/cards", headers=_headers(user), params={"limit": 2}
    )

    assert response.status_code == 200, response.text
    assert len(response.json()) == 2


def test_cross_user_isolation(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user_a = make_user("甲")
    user_b = make_user("乙")
    _make_manual_card(db_session, user_a, question="甲的卡片")
    _make_manual_card(db_session, user_b, question="乙的卡片")

    response = client.get("/api/review/cards", headers=_headers(user_a))

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["question"] for item in body] == ["甲的卡片"]


def test_integration_with_answer_endpoint(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    question = _setup_question(db_session, user, answer="A")

    response = client.post(
        f"/api/quiz/{question.id}/answer",
        headers=_headers(user),
        json={"answer": "B"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["card_created"] is True

    cards = client.get("/api/review/cards", headers=_headers(user)).json()
    assert len(cards) == 1
    assert cards[0]["quiz_question_id"] == question.id
    assert cards[0]["question"] == question.question
