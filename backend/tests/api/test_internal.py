"""Tests for the signed internal reminder endpoint and the FunctionGraph handler.

The endpoint tests need no database: ``run_reminders`` is monkeypatched. The
handler tests load ``scripts/functiongraph/handler.py`` from the repository
root; when that path is not mounted into the container (the default backend
bind mount only exposes ``./backend``) they skip instead of failing.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from fastapi.testclient import TestClient

import app.api.internal as internal
from app.api.internal import compute_signature, reset_replay_cache
from app.config import settings

SECRET = "test-cron-secret"
NOW = 1_700_000_000
URL = "/internal/reminders/run"


@pytest.fixture(autouse=True)
def _signed_config(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "cron_signature_secret", SECRET)
    monkeypatch.setattr(time, "time", lambda: float(NOW))
    reset_replay_cache()
    yield
    reset_replay_cache()


@pytest.fixture
def runner_calls(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    calls: list[int] = []

    def _fake_run() -> dict[str, object]:
        calls.append(1)
        return {"status": "ok", "sent": 2, "skipped": 1, "failed": 0}

    monkeypatch.setattr(internal, "run_reminders", _fake_run)
    return calls


def _headers(timestamp: int = NOW, body: bytes = b"") -> dict[str, str]:
    return {
        internal.TIMESTAMP_HEADER: str(timestamp),
        internal.SIGNATURE_HEADER: compute_signature(SECRET, timestamp, body),
    }


def test_no_signature_401(client: TestClient) -> None:
    response = client.post(URL)
    assert response.status_code == 401
    assert response.json() == {"detail": "未认证"}


def test_bad_signature_401(client: TestClient, runner_calls: list[int]) -> None:
    response = client.post(
        URL,
        headers={
            internal.TIMESTAMP_HEADER: str(NOW),
            internal.SIGNATURE_HEADER: "0" * 64,
        },
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "未认证"}
    assert runner_calls == []


def test_expired_401(client: TestClient, runner_calls: list[int]) -> None:
    response = client.post(URL, headers=_headers(NOW - 301))
    assert response.status_code == 401
    assert response.json() == {"detail": "签名已过期"}
    assert runner_calls == []


def test_future_ts_401(client: TestClient, runner_calls: list[int]) -> None:
    response = client.post(URL, headers=_headers(NOW + 301))
    assert response.status_code == 401
    assert response.json() == {"detail": "签名已过期"}
    assert runner_calls == []


def test_valid_triggers_run(client: TestClient, runner_calls: list[int]) -> None:
    response = client.post(URL, headers=_headers())

    assert response.status_code == 200, response.text
    assert response.json() == {
        "ok": True,
        "sent": 2,
        "skipped": 1,
        "failed": 0,
        "replay": False,
    }
    assert len(runner_calls) == 1


def test_signature_covers_raw_body(client: TestClient, runner_calls: list[int]) -> None:
    body = b'{"source":"functiongraph"}'
    response = client.post(URL, content=body, headers=_headers(NOW, body))

    assert response.status_code == 200, response.text
    assert len(runner_calls) == 1

    other = b'{"source":"attacker"}'
    replay = client.post(URL, content=other, headers=_headers(NOW, body))
    assert replay.status_code == 401
    assert len(runner_calls) == 1


def test_replay_idempotent(client: TestClient, runner_calls: list[int]) -> None:
    headers = _headers()

    first = client.post(URL, headers=headers)
    second = client.post(URL, headers=headers)

    assert first.status_code == 200
    assert first.json()["sent"] == 2
    assert second.status_code == 200
    assert second.json()["sent"] == 0
    assert second.json()["replay"] is True
    assert len(runner_calls) == 1


def test_503_on_service_error(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom() -> dict[str, object]:
        raise RuntimeError("smtp secret=super-secret-value down")

    monkeypatch.setattr(internal, "run_reminders", _boom)

    response = client.post(URL, headers=_headers())

    assert response.status_code == 503
    assert response.json() == {"detail": "提醒服务暂不可用"}
    assert "super-secret-value" not in response.text


def test_503_allows_retry_with_same_signature(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[int] = []

    def _flaky() -> dict[str, object]:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("db down")
        return {"sent": 1, "skipped": 0, "failed": 0}

    monkeypatch.setattr(internal, "run_reminders", _flaky)
    headers = _headers()

    assert client.post(URL, headers=headers).status_code == 503
    retry = client.post(URL, headers=headers)

    assert retry.status_code == 200
    assert retry.json()["sent"] == 1
    assert len(calls) == 2


def _repository_roots() -> list[Path]:
    roots: list[Path] = []
    env_root = os.environ.get("REPO_ROOT")
    if env_root:
        roots.append(Path(env_root))
    roots.append(Path("/repo"))
    roots.append(Path.cwd())
    roots.extend(Path(__file__).resolve().parents)
    return roots


def _load_handler() -> ModuleType:
    for root in _repository_roots():
        path = root / "scripts" / "functiongraph" / "handler.py"
        if not path.is_file():
            continue
        spec = importlib.util.spec_from_file_location("_functiongraph_handler", path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules["_functiongraph_handler"] = module
        spec.loader.exec_module(module)
        return module
    pytest.skip("scripts/functiongraph/handler.py is not mounted in this container")


class _FakeResponse:
    def __init__(self, code: int = 200, payload: bytes = b'{"ok": true}') -> None:
        self._code = code
        self._payload = payload

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def getcode(self) -> int:
        return self._code

    def read(self) -> bytes:
        return self._payload


def test_handler_rejects_non_timer() -> None:
    handler_module = _load_handler()

    result = handler_module.handler({"trigger_type": "HTTP"}, None)

    assert result == {"ok": False, "reason": "not a timer trigger"}


@pytest.mark.parametrize(
    "event",
    [
        {"trigger_type": "TIMER"},
        {"event_type": "Timer"},
        {"Type": "Timer"},
    ],
)
def test_handler_accepts_timer_shapes(
    event: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    handler_module = _load_handler()
    monkeypatch.setenv("INTERNAL_REMINDER_URL", "http://backend:8000/internal/reminders/run")
    monkeypatch.setenv("CRON_SIGNATURE_SECRET", SECRET)
    monkeypatch.setattr(
        handler_module.urllib.request, "urlopen", lambda *a, **kw: _FakeResponse()
    )

    assert handler_module.handler(event, None)["ok"] is True


def test_handler_timer_calls_url(monkeypatch: pytest.MonkeyPatch) -> None:
    handler_module = _load_handler()
    monkeypatch.setenv("INTERNAL_REMINDER_URL", "http://backend:8000/internal/reminders/run")
    monkeypatch.setenv("CRON_SIGNATURE_SECRET", SECRET)
    captured: dict[str, Any] = {}

    def _fake_urlopen(request: Any, timeout: float | None = None) -> _FakeResponse:
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        captured["headers"] = {key.lower(): value for key, value in request.headers.items()}
        captured["body"] = request.data
        captured["timeout"] = timeout
        return _FakeResponse(200, b'{"ok": true, "sent": 3}')

    monkeypatch.setattr(handler_module.urllib.request, "urlopen", _fake_urlopen)

    result = handler_module.handler({"trigger_type": "TIMER"}, None)

    assert result == {"ok": True, "status": 200, "body": '{"ok": true, "sent": 3}'}
    assert captured["url"] == "http://backend:8000/internal/reminders/run"
    assert captured["method"] == "POST"
    assert captured["timeout"] == 60
    assert captured["headers"]["content-type"] == "application/json"

    timestamp = int(captured["headers"]["x-cron-timestamp"])
    expected = handler_module.compute_signature(SECRET, timestamp, captured["body"])
    assert captured["headers"]["x-cron-signature"] == expected


def test_handler_timeout_maps_to_ok_false(monkeypatch: pytest.MonkeyPatch) -> None:
    handler_module = _load_handler()
    monkeypatch.setenv("INTERNAL_REMINDER_URL", "http://backend:8000/internal/reminders/run")
    monkeypatch.setenv("CRON_SIGNATURE_SECRET", SECRET)

    def _timeout(*args: object, **kwargs: object) -> _FakeResponse:
        raise TimeoutError("timed out")

    monkeypatch.setattr(handler_module.urllib.request, "urlopen", _timeout)

    result = handler_module.handler({"event_type": "Timer"}, None)

    assert result["ok"] is False
    assert result["reason"] == "TimeoutError"


def test_handler_requires_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    handler_module = _load_handler()
    monkeypatch.delenv("INTERNAL_REMINDER_URL", raising=False)
    monkeypatch.delenv("CRON_SIGNATURE_SECRET", raising=False)

    result = handler_module.handler({"trigger_type": "TIMER"}, None)

    assert result == {"ok": False, "reason": "missing configuration"}
