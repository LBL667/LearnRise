"""API tests for structured note generation.

No network: ``app.services.notes.resolve_agent`` is monkeypatched to return a
fake provider whose ``chat`` yields canned responses.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import Chunk, KnowledgePoint, KnowledgeSource, User
from app.ports import ChatMessage, ChatResult

DETAILS = "资源不存在"


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

    def _create(display_name: str = "笔记用户") -> User:
        user = User(
            email=f"task16-{uuid.uuid4().hex}@example.com",
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


def _make_source(
    db_session: Session,
    user: User,
    *,
    chunks: list[str] | None = None,
    title: str = "计算机网络",
) -> KnowledgeSource:
    source = KnowledgeSource(
        user_id=user.id,
        title=title,
        filename="lecture.pdf",
        content_type="application/pdf",
        size_bytes=1024,
        storage_key=f"{user.id}/source.pdf",
        status="ready",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    for index, content in enumerate(chunks or []):
        db_session.add(
            Chunk(
                source_id=source.id,
                user_id=user.id,
                chunk_index=index,
                content=content,
                page=index + 1,
                token_count=len(content),
            )
        )
    db_session.commit()
    return source


class FakeLLM:
    model = "fake-note-model"

    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[list[ChatMessage]] = []

    def chat(self, messages: list[ChatMessage], **kwargs: Any) -> ChatResult:
        self.calls.append(list(messages))
        index = min(len(self.calls) - 1, len(self.responses) - 1)
        return ChatResult(content=self.responses[index], model=self.model)


def _patch_llm(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    def _resolve(
        db: Session, *, user_id: str, agent_id: str | None, task_type: str
    ) -> tuple[Any, Any]:
        return fake, None

    monkeypatch.setattr("app.services.notes.resolve_agent", _resolve)


def _post(
    client: TestClient, user: User, source_id: str, body: dict[str, Any] | None = None
) -> Any:
    return client.post(
        f"/api/sources/{source_id}/notes",
        headers=_headers(user),
        json=body if body is not None else {},
    )


def _kp_rows(db_session: Session, source: KnowledgeSource) -> list[KnowledgePoint]:
    db_session.expire_all()
    return list(
        db_session.scalars(
            select(KnowledgePoint)
            .where(KnowledgePoint.source_id == source.id)
            .order_by(KnowledgePoint.level, KnowledgePoint.sort_order)
        ).all()
    )


def _kp_count(db_session: Session, source: KnowledgeSource) -> int:
    db_session.expire_all()
    return int(
        db_session.scalar(
            select(func.count())
            .select_from(KnowledgePoint)
            .where(KnowledgePoint.source_id == source.id)
        )
        or 0
    )


VALID_TWO_LEVEL = {
    "title": "计算机网络笔记",
    "nodes": [
        {
            "title": "协议与分层",
            "content": "协议定义通信规则。",
            "level": 0,
            "children": [
                {
                    "title": "应用层",
                    "content": "HTTP、DNS 等。",
                    "level": 1,
                    "children": [],
                },
                {
                    "title": "传输层",
                    "content": "TCP、UDP。",
                    "level": 1,
                    "children": [],
                },
            ],
        },
        {
            "title": "网络拓扑",
            "content": "星型、总线、环形。",
            "level": 0,
            "children": [],
        },
    ],
}


def _valid_json() -> str:
    return json.dumps(VALID_TWO_LEVEL, ensure_ascii=False)


def _deep_tree(depth: int) -> dict[str, Any]:
    node: dict[str, Any] = {"title": f"层{depth}", "content": "", "level": depth, "children": []}
    for level in range(depth - 1, -1, -1):
        node = {
            "title": f"层{level}",
            "content": "",
            "level": level,
            "children": [node],
        }
    return {"title": "深层笔记", "nodes": [node]}


def test_notes_persisted(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user, chunks=["第一段内容", "第二段内容"])
    _patch_llm(monkeypatch, FakeLLM([_valid_json()]))

    response = _post(client, user, source.id)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source_id"] == source.id
    assert body["knowledge_points_created"] == 4
    assert body["model"] == "fake-note-model"
    assert len(body["root_ids"]) == 2

    rows = _kp_rows(db_session, source)
    assert len(rows) == 4
    assert any(row.parent_id is not None for row in rows)
    by_title = {row.title: row for row in rows}
    assert by_title["协议与分层"].level == 0
    assert by_title["应用层"].level == 1
    assert by_title["传输层"].level == 1
    assert by_title["应用层"].parent_id == by_title["协议与分层"].id
    assert by_title["网络拓扑"].level == 0
    assert all(row.chunk_id is not None for row in rows)
    assert all(row.mastery_score == 0.0 for row in rows)
    assert by_title["应用层"].sort_order == 0
    assert by_title["传输层"].sort_order == 1


def test_invalid_json_retry_then_422(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user, chunks=["内容"])
    fake = FakeLLM(["这不是 JSON"])
    _patch_llm(monkeypatch, fake)

    response = _post(client, user, source.id)

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["message"] == "笔记生成失败：JSON 校验未通过"
    assert detail["raw"] == "这不是 JSON"
    assert len(fake.calls) == 2
    assert fake.calls[1][-1].content == "只输出合法 JSON，不要任何解释或代码块围栏"
    assert _kp_count(db_session, source) == 0


def test_invalid_then_valid(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user, chunks=["内容"])
    fake = FakeLLM(["垃圾输出", _valid_json()])
    _patch_llm(monkeypatch, fake)

    response = _post(client, user, source.id)

    assert response.status_code == 201, response.text
    assert response.json()["knowledge_points_created"] == 4
    assert len(fake.calls) == 2
    assert _kp_count(db_session, source) == 4


def test_empty_source_400(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user)
    fake = FakeLLM([_valid_json()])
    _patch_llm(monkeypatch, fake)

    response = _post(client, user, source.id)

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "该资料没有可用的文本片段，请先完成解析"
    assert fake.calls == []
    assert _kp_count(db_session, source) == 0


def test_cross_user_404(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = make_user()
    intruder = make_user()
    source = _make_source(db_session, owner, chunks=["内容"])
    fake = FakeLLM([_valid_json()])
    _patch_llm(monkeypatch, fake)

    response = _post(client, intruder, source.id)

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == DETAILS
    assert fake.calls == []
    assert _kp_count(db_session, source) == 0


def test_regenerate_replaces(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user, chunks=["内容"])
    second = {
        "title": "新笔记",
        "nodes": [
            {"title": "唯一节点", "content": "只有这一个。", "level": 0, "children": []}
        ],
    }
    fake = FakeLLM([_valid_json(), json.dumps(second, ensure_ascii=False)])
    _patch_llm(monkeypatch, fake)

    first = _post(client, user, source.id)
    assert first.status_code == 201, first.text
    assert _kp_count(db_session, source) == 4

    second_response = _post(client, user, source.id)
    assert second_response.status_code == 201, second_response.text
    assert second_response.json()["knowledge_points_created"] == 1

    rows = _kp_rows(db_session, source)
    assert len(rows) == 1
    assert rows[0].title == "唯一节点"
    assert rows[0].parent_id is None


def test_fence_stripped(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user, chunks=["内容"])
    fenced = f"```json\n{_valid_json()}\n```"
    _patch_llm(monkeypatch, FakeLLM([fenced]))

    response = _post(client, user, source.id)

    assert response.status_code == 201, response.text
    assert response.json()["knowledge_points_created"] == 4


def test_deep_tree_capped(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    source = _make_source(db_session, user, chunks=["内容"])
    deep = json.dumps(_deep_tree(6), ensure_ascii=False)
    fake = FakeLLM([deep])
    _patch_llm(monkeypatch, fake)

    response = _post(client, user, source.id)

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["message"] == "笔记生成失败：JSON 校验未通过"
    assert len(fake.calls) == 2
    assert _kp_count(db_session, source) == 0


def test_prompt_truncates_long_chunks(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    chunks = ["长" * 2000 for _ in range(15)]
    source = _make_source(db_session, user, chunks=chunks)
    fake = FakeLLM([_valid_json()])
    _patch_llm(monkeypatch, fake)

    response = _post(client, user, source.id)

    assert response.status_code == 201, response.text
    user_prompt = fake.calls[0][1].content
    assert "[page 1]" in user_prompt
    assert user_prompt.count("[page ") == 6
    assert len(user_prompt) <= 12000 + 200
