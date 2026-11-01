"""API tests for agent CRUD, key encryption/masking, SSRF and defaults."""

from __future__ import annotations

import ipaddress
import re
import socket
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.agents import get_agent_semaphore
from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import AgentConfig, User
from app.ports import ChatResult
from app.ports.errors import ProviderAuthError
from app.security.crypto import decrypt, encrypt
from app.services.agent_security import validate_base_url

DEFAULT_KEY = "sk-TEST1234567890"
NEW_KEY = "sk-BRANDNEW9999"
PUBLIC_IP = "93.184.216.34"
MASKED_PATTERN = r"sk-\*{4}.{4}"
BAD_URL_DETAIL = "base_url 不合法"


def _fake_getaddrinfo(
    host: str, port: int, *args: Any, **kwargs: Any
) -> list[tuple[Any, ...]]:
    if host.endswith(".invalid"):
        raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
    if host in {"localhost", "localhost.localdomain"}:
        host = "127.0.0.1"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))]
    if ip.version == 6:
        return [
            (socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (host, port, 0, 0))
        ]
    return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (host, port))]


@pytest.fixture
def fake_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.agent_security._system_resolver", _fake_getaddrinfo
    )


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

    def _create(display_name: str = "Agent用户") -> User:
        user = User(
            email=f"task13-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(AgentConfig).where(AgentConfig.user_id.in_(created)))
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _payload(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "name": "默认 Agent",
        "base_url": "https://api.example.com/v1",
        "api_key": DEFAULT_KEY,
        "model": "deepseek-chat",
    }
    data.update(overrides)
    return data


def _create_agent(client: TestClient, user: User, **overrides: Any) -> dict[str, Any]:
    response = client.post("/api/agents", headers=_headers(user), json=_payload(**overrides))
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _cipher(db_session: Session, agent_id: str) -> str:
    db_session.expire_all()
    stored = db_session.get(AgentConfig, agent_id)
    assert stored is not None
    return stored.api_key_encrypted


def _insert_agent(
    db_session: Session,
    user: User,
    *,
    base_url: str = "https://api.example.com/v1",
    api_key: str = DEFAULT_KEY,
    name: str = "直接插入",
    is_default: bool = False,
) -> AgentConfig:
    agent = AgentConfig(
        user_id=user.id,
        name=name,
        provider_type="openai_compatible",
        base_url=base_url,
        api_key_encrypted=encrypt(api_key),
        model="deepseek-chat",
        temperature=0.7,
        is_default=is_default,
    )
    db_session.add(agent)
    db_session.commit()
    db_session.refresh(agent)
    return agent


def test_create_masks_key(
    client: TestClient, db_session: Session, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()

    response = client.post("/api/agents", headers=_headers(user), json=_payload())

    assert response.status_code == 201
    body = response.json()
    assert re.fullmatch(MASKED_PATTERN, body["api_key_masked"])
    assert body["api_key_masked"] == "sk-****7890"
    assert DEFAULT_KEY not in response.text
    assert "api_key_encrypted" not in body
    assert "api_key" not in body

    db_session.expire_all()
    stored = db_session.get(AgentConfig, body["id"])
    assert stored is not None
    assert stored.api_key_encrypted != DEFAULT_KEY
    assert DEFAULT_KEY not in stored.api_key_encrypted
    assert decrypt(stored.api_key_encrypted) == DEFAULT_KEY


def test_list_is_user_scoped_and_masked(
    client: TestClient, make_user: Callable[..., User], fake_dns: None
) -> None:
    alice = make_user()
    bob = make_user()
    _create_agent(client, alice, name="alice-agent")

    bob_list = client.get("/api/agents", headers=_headers(bob))
    alice_list = client.get("/api/agents", headers=_headers(alice))

    assert bob_list.status_code == 200
    assert bob_list.json() == []
    assert alice_list.status_code == 200
    assert len(alice_list.json()) == 1
    assert alice_list.json()[0]["name"] == "alice-agent"
    assert re.fullmatch(MASKED_PATTERN, alice_list.json()[0]["api_key_masked"])
    assert DEFAULT_KEY not in alice_list.text


def test_first_agent_becomes_default(
    client: TestClient, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()

    first = _create_agent(client, user, name="first")
    second = _create_agent(client, user, name="second")

    assert first["is_default"] is True
    assert second["is_default"] is False


def test_update_blank_key_preserves_cipher(
    client: TestClient, db_session: Session, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()
    agent = _create_agent(client, user)
    before = _cipher(db_session, agent["id"])

    omitted = client.put(
        f"/api/agents/{agent['id']}",
        headers=_headers(user),
        json={"name": "改名"},
    )
    after_omitted = _cipher(db_session, agent["id"])

    empty = client.put(
        f"/api/agents/{agent['id']}",
        headers=_headers(user),
        json={"api_key": ""},
    )
    after_empty = _cipher(db_session, agent["id"])

    assert omitted.status_code == 200
    assert omitted.json()["name"] == "改名"
    assert empty.status_code == 200
    assert before == after_omitted == after_empty
    assert decrypt(after_empty) == DEFAULT_KEY


def test_update_masked_key_preserves_cipher(
    client: TestClient, db_session: Session, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()
    agent = _create_agent(client, user)
    before = _cipher(db_session, agent["id"])

    response = client.put(
        f"/api/agents/{agent['id']}",
        headers=_headers(user),
        json={"api_key": agent["api_key_masked"], "model": "deepseek-reasoner"},
    )
    after = _cipher(db_session, agent["id"])

    assert response.status_code == 200
    assert response.json()["model"] == "deepseek-reasoner"
    assert response.json()["api_key_masked"] == agent["api_key_masked"]
    assert before == after
    assert decrypt(after) == DEFAULT_KEY


def test_update_new_key_reencrypts(
    client: TestClient, db_session: Session, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()
    agent = _create_agent(client, user)
    before = _cipher(db_session, agent["id"])

    response = client.put(
        f"/api/agents/{agent['id']}",
        headers=_headers(user),
        json={"api_key": NEW_KEY},
    )
    after = _cipher(db_session, agent["id"])

    assert response.status_code == 200
    assert before != after
    assert decrypt(after) == NEW_KEY
    assert response.json()["api_key_masked"] == "sk-****9999"
    assert NEW_KEY not in response.text


def test_update_validates_base_url(
    client: TestClient, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()
    agent = _create_agent(client, user)

    response = client.put(
        f"/api/agents/{agent['id']}",
        headers=_headers(user),
        json={"base_url": "http://127.0.0.1/v1"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == BAD_URL_DETAIL


@pytest.mark.parametrize(
    "base_url",
    [
        "http://127.0.0.1/v1",
        "http://169.254.169.254/latest",
        "https://10.0.0.5/v1",
        "https://192.168.1.10/v1",
        "https://[::1]/v1",
        "https://localhost/v1",
        "https://nope.invalid/v1",
        "https://user:pass@api.example.com/v1",
        "https://api.example.com:0/v1",
        "file:///etc/passwd",
        "ftp://example.com/v1",
        "gopher://example.com/v1",
    ],
)
def test_ssrf_rejects(
    client: TestClient,
    make_user: Callable[..., User],
    fake_dns: None,
    base_url: str,
) -> None:
    user = make_user()

    response = client.post(
        "/api/agents", headers=_headers(user), json=_payload(base_url=base_url)
    )

    assert response.status_code == 400
    assert response.json()["detail"] == BAD_URL_DETAIL
    assert base_url not in response.text


def test_ssrf_allows_public() -> None:
    calls: list[tuple[str, int]] = []

    def resolver(host: str, port: int, **kwargs: Any) -> list[tuple[Any, ...]]:
        calls.append((host, port))
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))
        ]

    normalized = validate_base_url("https://api.example.com/v1/", _resolve=resolver)

    assert normalized == "https://api.example.com/v1"
    assert calls == [("api.example.com", 443)]


def test_ssrf_rejects_private_resolution_but_accepts_public_record() -> None:
    def resolver(host: str, port: int, **kwargs: Any) -> list[tuple[Any, ...]]:
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port)),
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("10.0.0.5", port)),
        ]

    with pytest.raises(ValueError, match="base_url 不合法"):
        validate_base_url("https://api.example.com/v1", _resolve=resolver)


def test_ssrf_validates_idna_host() -> None:
    seen: list[str] = []

    def resolver(host: str, port: int, **kwargs: Any) -> list[tuple[Any, ...]]:
        seen.append(host)
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))
        ]

    normalized = validate_base_url("https://例子.example/v1", _resolve=resolver)

    assert seen == ["xn--fsqu00a.example"]
    assert normalized == "https://xn--fsqu00a.example/v1"


class _AuthFailLLM:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def chat(self, messages: list[Any], **kwargs: Any) -> ChatResult:
        raise ProviderAuthError("upstream secret body sk-xxx must not leak")


class _OkLLM:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def chat(self, messages: list[Any], **kwargs: Any) -> ChatResult:
        return ChatResult(content="pong")


class _ForbiddenLLM:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise AssertionError("SSRF-blocked base_url must never reach the provider")


def test_test_endpoint_auth_error_is_generic(
    client: TestClient,
    make_user: Callable[..., User],
    fake_dns: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    agent = _create_agent(client, user)
    monkeypatch.setattr("app.api.agents.OpenAICompatibleLLM", _AuthFailLLM)

    response = client.post(f"/api/agents/{agent['id']}/test", headers=_headers(user))

    assert response.status_code == 200
    assert response.json() == {"ok": False, "message": "模型鉴权失败"}
    assert "sk-" not in response.text
    assert "upstream" not in response.text
    assert DEFAULT_KEY not in response.text


def test_test_endpoint_success(
    client: TestClient,
    make_user: Callable[..., User],
    fake_dns: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    agent = _create_agent(client, user)
    monkeypatch.setattr("app.api.agents.OpenAICompatibleLLM", _OkLLM)

    response = client.post(f"/api/agents/{agent['id']}/test", headers=_headers(user))

    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": "连接成功"}


def test_test_endpoint_never_reaches_ssrf_url(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = make_user()
    agent = _insert_agent(db_session, user, base_url="http://127.0.0.1/v1")
    monkeypatch.setattr("app.api.agents.OpenAICompatibleLLM", _ForbiddenLLM)

    response = client.post(f"/api/agents/{agent.id}/test", headers=_headers(user))

    assert response.status_code == 200
    assert response.json() == {"ok": False, "message": BAD_URL_DETAIL}


def test_default_switch_keeps_exactly_one(
    client: TestClient, db_session: Session, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()
    first = _create_agent(client, user, name="first")
    second = _create_agent(client, user, name="second")

    response = client.patch(f"/api/agents/{second['id']}/default", headers=_headers(user))
    db_session.expire_all()
    defaults = db_session.scalars(
        select(AgentConfig).where(
            AgentConfig.user_id == user.id, AgentConfig.is_default.is_(True)
        )
    ).all()
    count = db_session.scalar(
        select(func.count())
        .select_from(AgentConfig)
        .where(AgentConfig.user_id == user.id, AgentConfig.is_default.is_(True))
    )

    assert response.status_code == 200
    assert response.json()["is_default"] is True
    assert count == 1
    assert [agent.id for agent in defaults] == [second["id"]]

    switched = client.put(
        f"/api/agents/{first['id']}", headers=_headers(user), json={"is_default": True}
    )
    db_session.expire_all()
    after_count = db_session.scalar(
        select(func.count())
        .select_from(AgentConfig)
        .where(AgentConfig.user_id == user.id, AgentConfig.is_default.is_(True))
    )

    assert switched.status_code == 200
    assert switched.json()["is_default"] is True
    assert after_count == 1


def test_cross_user_access_is_404(
    client: TestClient, make_user: Callable[..., User], fake_dns: None
) -> None:
    owner = make_user()
    intruder = make_user()
    agent = _create_agent(client, owner)
    path = f"/api/agents/{agent['id']}"

    read = client.get(path, headers=_headers(intruder))
    updated = client.put(path, headers=_headers(intruder), json={"name": "hijack"})
    deleted = client.delete(path, headers=_headers(intruder))
    probed = client.post(f"{path}/test", headers=_headers(intruder))
    defaulted = client.patch(f"{path}/default", headers=_headers(intruder))

    assert read.status_code == 404
    assert updated.status_code == 404
    assert deleted.status_code == 404
    assert probed.status_code == 404
    assert defaulted.status_code == 404
    assert updated.json()["detail"] == "资源不存在"


def test_delete_returns_204_and_removes_row(
    client: TestClient, db_session: Session, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()
    agent = _create_agent(client, user)

    response = client.delete(f"/api/agents/{agent['id']}", headers=_headers(user))
    missing = client.delete(f"/api/agents/{agent['id']}", headers=_headers(user))

    db_session.expire_all()
    assert response.status_code == 204
    assert response.content == b""
    assert db_session.get(AgentConfig, agent["id"]) is None
    assert missing.status_code == 404


def test_delete_default_promotes_survivor(
    client: TestClient, db_session: Session, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()
    first = _create_agent(client, user, name="first")
    second = _create_agent(client, user, name="second")
    assert first["is_default"] is True

    client.delete(f"/api/agents/{first['id']}", headers=_headers(user))
    db_session.expire_all()
    survivor = db_session.get(AgentConfig, second["id"])

    assert survivor is not None
    assert survivor.is_default is True


def test_provider_type_rejected(
    client: TestClient, make_user: Callable[..., User], fake_dns: None
) -> None:
    user = make_user()

    response = client.post(
        "/api/agents", headers=_headers(user), json=_payload(provider_type="anthropic")
    )

    assert response.status_code == 422


def test_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/agents").status_code == 401
    assert client.post("/api/agents", json=_payload()).status_code == 401


def test_semaphore_registry_is_stable() -> None:
    first = get_agent_semaphore("agent-a", 2)
    second = get_agent_semaphore("agent-a", 9)

    assert first is second
    assert get_agent_semaphore("agent-b", 3) is not first
