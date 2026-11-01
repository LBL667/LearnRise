"""API tests for socratic guidance in the assistant and the explainer.

The provider is replaced with a deterministic fake that deliberately leaks the
seeded quiz answer, so the post-validation guard is exercised instead of being
silently satisfied by a well-behaved model.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.adapters.embedding.factory import build_embedding
from app.adapters.vector.factory import build_vector_store
from app.api.auth import create_access_token
from app.db import SessionLocal
from app.main import app
from app.models import (
    AssistantConversation,
    AssistantMessage,
    Chunk,
    KnowledgePoint,
    KnowledgeSource,
    QuizQuestion,
    User,
)
from app.ports import ChatMessage, ChatResult
from app.ports.types import ChunkRecord

PROBE = "特征值之和等于矩阵的迹且特征方向保持不变-探针ZQ7"
EXPLANATION = "因为相似变换不改变特征多项式。"


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

    def _create() -> User:
        user = User(
            email=f"socratic-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name="引导模式用户",
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        conversations = db_session.scalars(
            select(AssistantConversation.id).where(
                AssistantConversation.user_id.in_(created)
            )
        ).all()
        if conversations:
            db_session.execute(
                delete(AssistantMessage).where(
                    AssistantMessage.conversation_id.in_(conversations)
                )
            )
            db_session.execute(
                delete(AssistantConversation).where(
                    AssistantConversation.id.in_(conversations)
                )
            )
        db_session.execute(
            delete(QuizQuestion).where(QuizQuestion.user_id.in_(created))
        )
        db_session.execute(
            delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created))
        )
        sources = db_session.scalars(
            select(KnowledgeSource.id).where(KnowledgeSource.user_id.in_(created))
        ).all()
        if sources:
            db_session.execute(delete(Chunk).where(Chunk.source_id.in_(sources)))
            db_session.execute(
                delete(KnowledgeSource).where(KnowledgeSource.id.in_(sources))
            )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _seed(
    db_session: Session,
    user: User,
    text: str,
) -> tuple[str, QuizQuestion]:
    source = KnowledgeSource(
        user_id=user.id,
        title="特征值讲义",
        filename="eigen.pdf",
        content_type="application/pdf",
        size_bytes=len(text),
        storage_key=f"tests/{uuid.uuid4().hex}.pdf",
        status="ready",
    )
    db_session.add(source)
    db_session.commit()

    embedder = build_embedding()
    vector = embedder.embed([text]).vectors[0]
    chunk_id = str(uuid.uuid4())
    build_vector_store().upsert(
        [
            ChunkRecord(
                chunk_id=chunk_id,
                source_id=source.id,
                content=text,
                page=3,
                heading="特征值与特征向量",
                embedding=vector,
                embedding_model=getattr(embedder, "model", "mock-hash"),
                embedding_dim=len(vector),
                embedding_version="1",
            )
        ]
    )

    point = KnowledgePoint(
        user_id=user.id,
        source_id=source.id,
        chunk_id=chunk_id,
        title="特征值",
        content=text,
        level=0,
        sort_order=0,
    )
    db_session.add(point)
    db_session.commit()
    db_session.refresh(point)

    question = QuizQuestion(
        user_id=user.id,
        knowledge_point_id=point.id,
        type="short_answer",
        question="特征值有什么性质？",
        answer=PROBE,
        explanation=EXPLANATION,
    )
    db_session.add(question)
    db_session.commit()
    db_session.refresh(question)
    return chunk_id, question


def _create_conversation(
    client: TestClient, headers: dict[str, str], mode: str = "concise"
) -> dict[str, Any]:
    response = client.post(
        "/api/assistant/conversations", json={"mode": mode}, headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()


def _ask(
    client: TestClient,
    headers: dict[str, str],
    conversation_id: str,
    content: str = "特征值是什么？",
) -> Any:
    return client.post(
        f"/api/assistant/conversations/{conversation_id}/messages",
        json={"content": content},
        headers=headers,
    )


class LeakyLLM:
    model = "leaky-llm"

    def __init__(self, text: str) -> None:
        self.text = text
        self.messages: list[ChatMessage] = []

    def chat(self, messages: list[ChatMessage], **kwargs: Any) -> ChatResult:
        self.messages = list(messages)
        return ChatResult(content=self.text, model=self.model, usage={})

    def stream(self, messages: list[ChatMessage], **kwargs: Any) -> Iterator[str]:
        self.messages = list(messages)
        yield self.text


class EchoLLM(LeakyLLM):
    model = "echo-llm"

    def _echo(self, messages: list[ChatMessage]) -> str:
        self.messages = list(messages)
        return "\n".join(message.content for message in messages)

    def chat(self, messages: list[ChatMessage], **kwargs: Any) -> ChatResult:
        return ChatResult(content=self._echo(messages), model=self.model, usage={})

    def stream(self, messages: list[ChatMessage], **kwargs: Any) -> Iterator[str]:
        yield self._echo(messages)


def _patch_assistant(
    monkeypatch: pytest.MonkeyPatch, fake: LeakyLLM
) -> None:
    def _factory(
        db: Session, *, user_id: str, agent_id: str | None, task_type: str
    ) -> tuple[Any, Any]:
        return fake, None

    monkeypatch.setattr("app.api.assistant.resolve_agent", _factory)


def _patch_explain(monkeypatch: pytest.MonkeyPatch, fake: LeakyLLM) -> None:
    def _factory(
        db: Session, *, user_id: str, agent_id: str | None, task_type: str
    ) -> tuple[Any, Any]:
        return fake, None

    monkeypatch.setattr("app.api.explain.resolve_agent", _factory)


def test_socratic_message_never_leaks_probe(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    headers = _headers(user)
    _seed(db_session, user, "特征值是线性变换下方向不变的缩放因子。" * 8)
    conversation = _create_conversation(client, headers, "socratic")
    _patch_assistant(monkeypatch, LeakyLLM(f"标准答案是 {PROBE}。"))

    for _ in range(3):
        response = _ask(client, headers, conversation["id"])

        assert response.status_code == 200, response.text
        assert PROBE not in response.text
        body = response.json()
        assert PROBE not in body["content"]
        assert body["content"]


def test_socratic_rewrites_echoed_context(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    headers = _headers(user)
    _seed(db_session, user, f"资料原文：{PROBE}。" * 6)
    conversation = _create_conversation(client, headers, "socratic")
    _patch_assistant(monkeypatch, EchoLLM(""))

    flags = []
    for _ in range(3):
        response = _ask(client, headers, conversation["id"])
        assert response.status_code == 200, response.text
        body = response.json()
        flags.append(body["rewritten"])
        assert PROBE not in body["content"]

    assert any(flags)


def test_reveal_returns_answer_and_conversation_continues(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    headers = _headers(user)
    chunk_id, question = _seed(db_session, user, "特征值讲义正文。" * 8)
    conversation = _create_conversation(client, headers, "concise")

    by_question = client.post(
        f"/api/assistant/conversations/{conversation['id']}/reveal",
        json={"question_id": question.id},
        headers=headers,
    )
    by_chunk = client.post(
        f"/api/assistant/conversations/{conversation['id']}/reveal",
        json={"chunk_id": chunk_id},
        headers=headers,
    )

    assert by_question.status_code == 200, by_question.text
    assert by_question.json() == {"answer": PROBE, "explanation": EXPLANATION}
    assert by_chunk.status_code == 200, by_chunk.text
    assert by_chunk.json()["answer"] == PROBE

    _patch_assistant(monkeypatch, LeakyLLM("继续想一想：为什么？"))
    follow_up = _ask(client, headers, conversation["id"], "那为什么？")
    assert follow_up.status_code == 200, follow_up.text
    assert follow_up.json()["content"] == "继续想一想：为什么？"


def test_concise_mode_is_unchanged(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    headers = _headers(user)
    _seed(db_session, user, "特征值讲义正文。" * 8)
    conversation = _create_conversation(client, headers, "concise")
    answer = f"直接回答：{PROBE}"
    _patch_assistant(monkeypatch, LeakyLLM(answer))

    response = _ask(client, headers, conversation["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content"] == answer
    assert body["rewritten"] is False


def test_explain_accepts_socratic_and_rejects_unknown_style(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    headers = _headers(user)
    point = KnowledgePoint(
        user_id=user.id,
        title="光合作用",
        content="植物利用光能合成有机物并释放氧气。",
    )
    db_session.add(point)
    db_session.commit()
    db_session.refresh(point)
    fake = LeakyLLM("你觉得光能变成了什么？")
    _patch_explain(monkeypatch, fake)

    accepted = client.post(
        f"/api/knowledge-points/{point.id}/explain",
        json={"style": "socratic"},
        headers=headers,
    )
    rejected = client.post(
        f"/api/knowledge-points/{point.id}/explain",
        json={"style": "unknown"},
        headers=headers,
    )

    assert accepted.status_code == 200, accepted.text
    assert "event: done" in accepted.text
    system = next(message for message in fake.messages if message.role == "system")
    assert "苏格拉底" in system.content
    assert rejected.status_code == 422


def test_openapi_explain_style_includes_socratic() -> None:
    style = app.openapi()["components"]["schemas"]["ExplainRequest"]["properties"]["style"]

    assert "socratic" in style["enum"]
