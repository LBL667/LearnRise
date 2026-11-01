"""API tests for the knowledge-point explain SSE endpoint.

No network: the provider factory is monkeypatched to return a fake stream.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import AgentConfig, ExplanationLog, KnowledgePoint, User
from app.ports import ChatMessage
from app.ports.errors import ProviderAuthError, ProviderError

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

    def _create(display_name: str = "讲解用户") -> User:
        user = User(
            email=f"task14-{uuid.uuid4().hex}@example.com",
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
            delete(ExplanationLog).where(ExplanationLog.user_id.in_(created))
        )
        db_session.execute(
            delete(KnowledgePoint).where(KnowledgePoint.user_id.in_(created))
        )
        db_session.execute(delete(AgentConfig).where(AgentConfig.user_id.in_(created)))
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_kp(
    db_session: Session,
    user: User,
    *,
    title: str = "光合作用",
    content: str = "植物利用光能合成有机物并释放氧气。",
) -> KnowledgePoint:
    point = KnowledgePoint(user_id=user.id, title=title, content=content)
    db_session.add(point)
    db_session.commit()
    db_session.refresh(point)
    return point


def _make_agent(db_session: Session, user: User, *, is_default: bool = True) -> AgentConfig:
    agent = AgentConfig(
        user_id=user.id,
        name="测试 Agent",
        provider_type="openai_compatible",
        base_url="https://api.example.com/v1",
        api_key_encrypted="unused",
        model="fake-model",
        temperature=0.5,
        is_default=is_default,
    )
    db_session.add(agent)
    db_session.commit()
    db_session.refresh(agent)
    return agent


class FakeLLM:
    model = "fake-stream-model"

    def __init__(
        self,
        deltas: list[str],
        *,
        fail_after: int | None = None,
        error: Exception | None = None,
    ) -> None:
        self._deltas = deltas
        self._fail_after = fail_after
        self._error = error
        self.messages: list[ChatMessage] = []

    def stream(self, messages: list[ChatMessage], **kwargs: Any) -> Iterator[str]:
        self.messages = list(messages)
        for index, delta in enumerate(self._deltas):
            if self._fail_after is not None and index >= self._fail_after:
                assert self._error is not None
                raise self._error
            yield delta
        if self._fail_after is not None:
            assert self._error is not None
            raise self._error


def _patch_llm(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> None:
    def _factory(
        db: Session, *, user_id: str, agent_id: str | None, task_type: str
    ) -> tuple[Any, Any]:
        return fake, None

    monkeypatch.setattr("app.api.explain.resolve_agent", _factory)


def _patch_llm_boom(monkeypatch: pytest.MonkeyPatch) -> None:
    def _factory(*args: Any, **kwargs: Any) -> tuple[Any, Any]:
        raise AssertionError("resolver must not run")

    monkeypatch.setattr("app.api.explain.resolve_agent", _factory)


def _events(body: str) -> list[tuple[str, dict[str, Any]]]:
    parsed: list[tuple[str, dict[str, Any]]] = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event = ""
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].strip())
        if event:
            payload = json.loads("\n".join(data_lines)) if data_lines else {}
            parsed.append((event, payload))
    return parsed


def _log_rows(db_session: Session, user: User) -> list[ExplanationLog]:
    db_session.expire_all()
    return list(
        db_session.scalars(
            select(ExplanationLog).where(ExplanationLog.user_id == user.id)
        ).all()
    )


def _explain(
    client: TestClient, user: User, point: KnowledgePoint, body: dict[str, Any] | None = None
) -> Any:
    return client.post(
        f"/api/knowledge-points/{point.id}/explain",
        headers=_headers(user),
        json=body if body is not None else {},
    )


def test_stream_ok(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    point = _make_kp(db_session, user)
    fake = FakeLLM(["光", "合", "作", "用", "很", "重要"])
    _patch_llm(monkeypatch, fake)

    response = _explain(client, user, point)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers.get("x-accel-buffering") == "no"
    assert response.headers.get("cache-control") == "no-cache"

    events = _events(response.text)
    token_events = [data for name, data in events if name == "token"]
    data_frames = [line for line in response.text.splitlines() if line.startswith("data:")]
    assert len(data_frames) >= 5
    assert "".join(item["text"] for item in token_events) == "光合作用很重要"
    assert events[-1] == ("done", {"chars": 7})

    rows = _log_rows(db_session, user)
    assert len(rows) == 1
    log = rows[0]
    assert log.status == "ok"
    assert log.content == "光合作用很重要"
    assert log.chars == 7
    assert log.model == "fake-stream-model"
    assert log.task_type == "explain"
    assert log.knowledge_point_id == point.id
    assert log.error_message is None


def test_agent_not_found(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_kp(db_session, user)

    response = _explain(client, user, point, {"agent_id": str(uuid.uuid4())})

    assert response.status_code == 404
    assert response.json()["detail"] == DETAILS


def test_agent_cross_user_404(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    owner = make_user()
    intruder = make_user()
    point = _make_kp(db_session, intruder)
    foreign = _make_agent(db_session, owner)

    response = _explain(client, intruder, point, {"agent_id": foreign.id})

    assert response.status_code == 404
    assert response.json()["detail"] == DETAILS


def test_kp_cross_user_404(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = make_user()
    intruder = make_user()
    point = _make_kp(db_session, owner)
    _patch_llm_boom(monkeypatch)

    response = _explain(client, intruder, point)

    assert response.status_code == 404
    assert response.json()["detail"] == DETAILS
    assert _log_rows(db_session, owner) == []


def test_kp_missing_404(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = client.post(
        f"/api/knowledge-points/{uuid.uuid4()}/explain",
        headers=_headers(user),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == DETAILS


def test_upstream_401_is_generic(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    point = _make_kp(db_session, user)
    fake = FakeLLM(
        [],
        fail_after=0,
        error=ProviderAuthError("upstream body sk-SECRET must not leak"),
    )
    _patch_llm(monkeypatch, fake)

    response = _explain(client, user, point)

    assert response.status_code == 200
    assert "event: error" in response.text
    assert _events(response.text)[-1] == ("error", {"message": "模型鉴权失败"})
    assert "sk-" not in response.text
    assert "SECRET" not in response.text

    rows = _log_rows(db_session, user)
    assert len(rows) == 1
    assert rows[0].status == "failed"
    assert rows[0].content == ""
    assert rows[0].chars == 0
    assert rows[0].error_message == "模型鉴权失败"
    assert "sk-" not in (rows[0].error_message or "")


def test_midstream_failure_persists_partial(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    point = _make_kp(db_session, user)
    fake = FakeLLM(
        ["第一段", "第二段"],
        fail_after=2,
        error=ProviderError("boom sk-SECRET"),
    )
    _patch_llm(monkeypatch, fake)

    response = _explain(client, user, point)

    assert response.status_code == 200
    events = _events(response.text)
    assert [name for name, _ in events] == ["token", "token", "error"]
    assert [data["text"] for name, data in events if name == "token"] == [
        "第一段",
        "第二段",
    ]
    assert events[-1] == ("error", {"message": "讲解失败，请稍后重试"})
    assert "sk-" not in response.text

    rows = _log_rows(db_session, user)
    assert len(rows) == 1
    assert rows[0].status == "partial"
    assert rows[0].content == "第一段第二段"
    assert rows[0].chars == 6
    assert rows[0].error_message == "讲解失败，请稍后重试"


def test_style_accepted(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    point = _make_kp(db_session, user)
    fake = FakeLLM(["好"])
    _patch_llm(monkeypatch, fake)

    response = _explain(client, user, point, {"style": "example"})

    assert response.status_code == 200
    assert response.text.endswith('event: done\ndata: {"chars": 1}\n\n')
    assert fake.messages
    system = next(message for message in fake.messages if message.role == "system")
    user_message = next(message for message in fake.messages if message.role == "user")
    assert "中文" in system.content
    assert "例子" in user_message.content
    assert point.title in user_message.content

    rows = _log_rows(db_session, user)
    assert len(rows) == 1
    assert rows[0].style == "example"


def test_requires_authentication(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    point = _make_kp(db_session, user)

    response = client.post(f"/api/knowledge-points/{point.id}/explain", json={})

    assert response.status_code == 401
