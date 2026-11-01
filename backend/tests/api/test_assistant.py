"""API tests for the learning assistant: conversations, citations and streaming."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.adapters.embedding.factory import build_embedding
from app.adapters.vector.factory import build_vector_store
from app.db import SessionLocal
from app.models import (
    AssistantConversation,
    AssistantMessage,
    Chunk,
    KnowledgeSource,
    User,
)
from app.ports.types import ChunkRecord
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

    def _create() -> User:
        user = User(
            email=f"assistant-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password(PASSWORD),
            display_name="助手用户",
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
        sources = db_session.scalars(
            select(KnowledgeSource.id).where(KnowledgeSource.user_id.in_(created))
        ).all()
        if sources:
            db_session.execute(delete(Chunk).where(Chunk.source_id.in_(sources)))
            db_session.execute(delete(KnowledgeSource).where(KnowledgeSource.id.in_(sources)))
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _login(client: TestClient, user: User) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _seed_indexed_source(db_session: Session, user: User, text: str) -> KnowledgeSource:
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
    store = build_vector_store()
    store.upsert(
        [
            ChunkRecord(
                chunk_id=str(uuid.uuid4()),
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
    return source


def test_conversation_crud_and_pagination(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    headers = _login(client, make_user())

    created = client.post(
        "/api/assistant/conversations", json={"title": "线代答疑"}, headers=headers
    )
    listed = client.get("/api/assistant/conversations?limit=1", headers=headers)
    detail = client.get(f"/api/assistant/conversations/{created.json()['id']}", headers=headers)

    assert created.status_code == 201
    assert listed.status_code == 200
    assert listed.headers["X-Total-Count"] == "1"
    assert len(listed.json()) == 1
    assert detail.status_code == 200
    assert detail.json()["messages"] == []


def test_message_without_context_is_409_no_context(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    headers = _login(client, make_user())
    conversation = client.post("/api/assistant/conversations", json={}, headers=headers).json()

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "什么是特征值？"},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "NO_CONTEXT"


def test_message_returns_citations_with_bounded_snippets(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    _seed_indexed_source(
        db_session,
        user,
        "特征值是线性变换下方向不变的缩放因子，满足 Av = λv。" * 12,
    )
    conversation = client.post("/api/assistant/conversations", json={}, headers=headers).json()

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "特征值是什么"},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["citations"]) >= 1
    citation = body["citations"][0]
    assert citation["page"] == 3
    assert 0 < len(citation["snippet"]) <= 200
    assert body["content"]


def test_second_turn_persists_history(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    _seed_indexed_source(db_session, user, "矩阵的特征值之和等于迹，乘积等于行列式。")
    conversation = client.post("/api/assistant/conversations", json={}, headers=headers).json()

    first = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "特征值之和是什么"},
        headers=headers,
    )
    second = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "那乘积呢"},
        headers=headers,
    )
    detail = client.get(f"/api/assistant/conversations/{conversation['id']}", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    roles = [message["role"] for message in detail.json()["messages"]]
    assert roles == ["user", "assistant", "user", "assistant"]


def test_stream_emits_multiple_token_frames(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    headers = _login(client, user)
    _seed_indexed_source(db_session, user, "特征向量是特征值对应的非零向量。" * 8)
    conversation = client.post("/api/assistant/conversations", json={}, headers=headers).json()

    frames: list[str] = []
    with client.stream(
        "POST",
        f"/api/assistant/conversations/{conversation['id']}/stream",
        json={"content": "什么是特征向量"},
        headers=headers,
    ) as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line.startswith("event:"):
                frames.append(line)

    assert sum(1 for frame in frames if "token" in frame) >= 3
    assert any("done" in frame for frame in frames)


def test_foreign_conversation_is_404(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    owner = make_user()
    intruder = make_user()
    conversation = client.post(
        "/api/assistant/conversations", json={}, headers=_login(client, owner)
    ).json()

    response = client.get(
        f"/api/assistant/conversations/{conversation['id']}", headers=_login(client, intruder)
    )

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
