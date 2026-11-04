"""API tests for the profile preference endpoints."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import User

DEFAULT_PREFERENCES = {
    "notifications": {"email_reminders_enabled": True},
    "learning": {
        "default_difficulty": "medium",
        "default_question_types": ["choice"],
        "default_quiz_num": 5,
    },
    "privacy": {"leaderboard_anonymous": False, "name_visibility": "public"},
}


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

    def _create(display_name: str = "偏好用户") -> User:
        user = User(
            email=f"preferences-{uuid.uuid4().hex}@example.com",
            password_hash=None,
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _put(client: TestClient, user: User, group: str, body: dict) -> Response:
    return client.put(
        f"/api/profile/preferences/{group}", json=body, headers=_headers(user)
    )


def test_get_preferences_returns_defaults_for_a_fresh_user(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    response = client.get("/api/profile/preferences", headers=_headers(user))
    assert response.status_code == 200, response.text
    assert response.json() == DEFAULT_PREFERENCES


def test_notifications_merge_persists_boolean(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    updated = _put(client, user, "notifications", {"email_reminders_enabled": False})
    assert updated.status_code == 200, updated.text
    assert updated.json() == {
        **DEFAULT_PREFERENCES,
        "notifications": {"email_reminders_enabled": False},
    }

    fetched = client.get("/api/profile/preferences", headers=_headers(user))
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["notifications"] == {"email_reminders_enabled": False}


def test_learning_merge_only_changes_provided_field(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    first = _put(client, user, "learning", {"default_difficulty": "hard"})
    assert first.status_code == 200, first.text
    assert first.json()["learning"] == {
        "default_difficulty": "hard",
        "default_question_types": ["choice"],
        "default_quiz_num": 5,
    }

    second = _put(client, user, "learning", {"default_quiz_num": 8})
    assert second.status_code == 200, second.text
    assert second.json()["learning"] == {
        "default_difficulty": "hard",
        "default_question_types": ["choice"],
        "default_quiz_num": 8,
    }


def test_ui_settings_endpoint_removed(client: TestClient, make_user: Callable[..., User]) -> None:
    user = make_user()
    response = _put(client, user, "ui", {"theme": "dark"})
    assert response.status_code in (404, 405)


def test_privacy_merge_accumulates_changes(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    first = _put(client, user, "privacy", {"name_visibility": "members"})
    assert first.status_code == 200, first.text
    second = _put(client, user, "privacy", {"leaderboard_anonymous": True})
    assert second.status_code == 200, second.text
    assert second.json()["privacy"] == {
        "leaderboard_anonymous": True,
        "name_visibility": "members",
    }


def test_invalid_enums_return_422(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    for group, body in (
        ("learning", {"default_difficulty": "insane"}),
        ("privacy", {"name_visibility": "everyone"}),
    ):
        response = _put(client, user, group, body)
        assert response.status_code == 422, (group, response.text)
        assert response.json()["code"] == "VALIDATION_ERROR"


def test_empty_question_types_returns_422(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    response = _put(client, user, "learning", {"default_question_types": []})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_quiz_num_out_of_range_returns_422(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    for value in (0, 21):
        response = _put(client, user, "learning", {"default_quiz_num": value})
        assert response.status_code == 422, (value, response.text)
        assert response.json()["code"] == "VALIDATION_ERROR"


def test_preferences_require_auth(client: TestClient) -> None:
    assert client.get("/api/profile/preferences").status_code == 401
    for group in ("notifications", "learning", "privacy"):
        response = client.put(f"/api/profile/preferences/{group}", json={})
        assert response.status_code == 401, group
