"""API tests for answer submission and chunk-level error tracing.

No network: the vector fallback is monkeypatched with a fake embedder and a
fake store, and every other path is pure database work.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

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
    User,
)
from app.ports import EmbeddingResult, SearchHit

CHUNK_CONTENT = "光合作用在叶绿体中把光能转化为化学能。"


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

    def _create(display_name: str = "答题用户") -> User:
        user = User(
            email=f"task19-{uuid.uuid4().hex}@example.com",
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


def _make_chunk(
    db_session: Session,
    user: User,
    source: KnowledgeSource,
    *,
    content: str = CHUNK_CONTENT,
    page: int = 7,
    heading: str = "光合作用",
) -> Chunk:
    chunk = Chunk(
        source_id=source.id,
        user_id=user.id,
        chunk_index=0,
        content=content,
        page=page,
        heading=heading,
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
    *,
    chunk_id: str | None = None,
) -> KnowledgePoint:
    point = KnowledgePoint(
        user_id=user.id,
        source_id=source.id,
        chunk_id=chunk_id,
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


class FakeEmbedder:
    def __init__(self) -> None:
        self.inputs: list[str] = []

    def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        self.inputs.extend(texts)
        return EmbeddingResult(
            vectors=[[0.1, 0.2, 0.3, 0.4] for _ in texts], model="fake", dim=4
        )


class FakeStore:
    def __init__(self, hits: Sequence[SearchHit]) -> None:
        self.hits = list(hits)
        self.calls: list[dict[str, Any]] = []

    def search(
        self,
        query_vector: list[float],
        *,
        top_k: int = 5,
        source_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        self.calls.append({"top_k": top_k, "source_ids": source_ids})
        return self.hits[:top_k]

    def upsert(self, chunks: list[Any]) -> int:
        return len(chunks)

    def delete_by_source(self, source_id: str) -> int:
        return 0


def _patch_vector(
    monkeypatch: pytest.MonkeyPatch, hits: Sequence[SearchHit]
) -> tuple[FakeEmbedder, FakeStore]:
    embedder = FakeEmbedder()
    store = FakeStore(hits)
    monkeypatch.setattr("app.services.answer.build_embedding", lambda: embedder)
    monkeypatch.setattr("app.services.answer.build_vector_store", lambda: store)
    return embedder, store


def _submit(
    client: TestClient,
    user: User,
    question: QuizQuestion,
    answer: Any,
    *,
    response_time_ms: int | None = None,
) -> Any:
    body: dict[str, Any] = {"answer": answer}
    if response_time_ms is not None:
        body["response_time_ms"] = response_time_ms
    return client.post(
        f"/api/quiz/{question.id}/answer", headers=_headers(user), json=body
    )


def _attempts(client: TestClient, user: User, question: QuizQuestion) -> Any:
    return client.get(
        f"/api/quiz/{question.id}/attempts", headers=_headers(user)
    )


def test_choice_correct(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(db_session, user, point, answer="A")

    response = _submit(client, user, question, "A")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["correct"] is True
    assert body["correct_answer"] == "A"
    assert body["explanation"] == question.explanation
    assert body["source_chunk"] is None
    assert body["card_created"] is False


def test_choice_wrong_lowercase_answer(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(db_session, user, point, answer="A")

    response = _submit(client, user, question, "a")

    assert response.status_code == 200, response.text
    assert response.json()["correct"] is True


@pytest.mark.parametrize("given", ["正确", "true", "对"])
def test_judge_variants(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    given: str,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(
        db_session,
        user,
        point,
        qtype="judge",
        answer="true",
        options=None,
        question="光合作用需要光能。",
    )

    response = _submit(client, user, question, given)

    assert response.status_code == 200, response.text
    assert response.json()["correct"] is True
    assert response.json()["correct_answer"] == "true"


def test_short_answer_text_match_normalized(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(
        db_session,
        user,
        point,
        qtype="short_answer",
        answer="tcp",
        options=None,
        question="传输控制协议缩写？",
    )

    response = _submit(client, user, question, "  TCP  ")

    assert response.status_code == 200, response.text
    assert response.json()["correct"] is True


def test_short_answer_differs_reports_reference(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(
        db_session,
        user,
        point,
        qtype="short_answer",
        answer="在叶绿体中进行",
        options=None,
        question="简述光合作用的场所。",
    )

    response = _submit(client, user, question, "在线粒体中")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["correct"] is False
    assert body["correct_answer"] == "在叶绿体中进行"


def test_wrong_answer_traces_chunk(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    chunk = _make_chunk(db_session, user, source)
    point = _make_kp(db_session, user, source, chunk_id=chunk.id)
    question = _make_question(db_session, user, point, answer="A")

    response = _submit(client, user, question, "B")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["correct"] is False
    assert body["source_chunk"] == {
        "content": chunk.content,
        "page": chunk.page,
        "heading": chunk.heading,
    }
    assert body["source_chunk"]["content"] == CHUNK_CONTENT


def test_wrong_answer_no_chunk_falls_back_to_vector(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    chunk = _make_chunk(db_session, user, source, content="向量命中的片段", page=3, heading="绪论")
    point = _make_kp(db_session, user, source, chunk_id=None)
    question = _make_question(db_session, user, point, answer="A")
    embedder, store = _patch_vector(
        monkeypatch,
        [
            SearchHit(
                chunk_id=chunk.id,
                source_id=source.id,
                content="向量命中的片段",
                score=0.9,
                page=3,
                heading="绪论",
            )
        ],
    )

    response = _submit(client, user, question, "C")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source_chunk"] == {
        "content": chunk.content,
        "page": chunk.page,
        "heading": chunk.heading,
    }
    assert embedder.inputs == [question.question]
    assert store.calls and store.calls[0] == {
        "top_k": 1,
        "source_ids": [source.id],
    }


def test_wrong_answer_no_trace_returns_null(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source, chunk_id=None)
    question = _make_question(db_session, user, point, answer="A")
    _embedder, store = _patch_vector(monkeypatch, [])

    response = _submit(client, user, question, "D")

    assert response.status_code == 200, response.text
    assert response.json()["correct"] is False
    assert response.json()["source_chunk"] is None
    assert store.calls


def test_missing_question_404(
    client: TestClient,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    unknown = str(uuid.uuid4())

    missing = client.post(
        f"/api/quiz/{unknown}/answer",
        headers=_headers(user),
        json={"answer": "A"},
    )
    invalid = client.post(
        "/api/quiz/not-a-uuid/answer",
        headers=_headers(user),
        json={"answer": "A"},
    )
    attempts = client.get(
        f"/api/quiz/{unknown}/attempts", headers=_headers(user)
    )

    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "资源不存在"
    assert invalid.status_code == 404, invalid.text
    assert attempts.status_code == 404, attempts.text


def test_cross_user_404(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    owner = make_user()
    intruder = make_user()
    source = _make_source(db_session, owner)
    point = _make_kp(db_session, owner, source)
    question = _make_question(db_session, owner, point)

    foreign_answer = _submit(client, intruder, question, "A")
    foreign_attempts = _attempts(client, intruder, question)

    assert foreign_answer.status_code == 404, foreign_answer.text
    assert foreign_attempts.status_code == 404, foreign_attempts.text
    assert _count(db_session, owner, question) == 0


def test_missing_answer_422(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(db_session, user, point)

    response = client.post(
        f"/api/quiz/{question.id}/answer", headers=_headers(user), json={}
    )

    assert response.status_code == 422, response.text
    assert _count(db_session, user, question) == 0


def test_attempt_persisted(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(db_session, user, point, answer="A")
    before = _count(db_session, user, question)

    response = _submit(client, user, question, "B", response_time_ms=1500)

    assert response.status_code == 200, response.text
    assert _count(db_session, user, question) == before + 1
    row = db_session.scalars(
        select(QuizAttempt).where(QuizAttempt.question_id == question.id)
    ).one()
    assert row.correct is False
    assert row.answer == "B"
    assert row.response_time_ms == 1500
    assert row.user_id == user.id


def test_attempts_listed_newest_first(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    point = _make_kp(db_session, user, source)
    question = _make_question(db_session, user, point)
    base = datetime(2026, 10, 31, 12, 0, 0, tzinfo=UTC)
    rows = [
        QuizAttempt(
            question_id=question.id,
            user_id=user.id,
            answer=answer,
            correct=index == 0,
            response_time_ms=None,
            created_at=base + timedelta(minutes=index),
        )
        for index, answer in enumerate(["A", "B", "C"])
    ]
    db_session.add_all(rows)
    db_session.commit()

    response = _attempts(client, user, question)

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["answer"] for item in body] == ["C", "B", "A"]
    assert body[0]["correct"] is False
    assert body[-1]["correct"] is True
    assert body[0]["created_at"].startswith("2026-10-31T12:02")


def _count(db_session: Session, user: User, question: QuizQuestion) -> int:
    db_session.expire_all()
    return int(
        db_session.scalar(
            select(func.count())
            .select_from(QuizAttempt)
            .where(
                QuizAttempt.user_id == user.id,
                QuizAttempt.question_id == question.id,
            )
        )
        or 0
    )
