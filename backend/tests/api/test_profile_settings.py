"""API tests for editable profile info and password changes."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.auth import create_access_token
from app.db import SessionLocal
from app.models import User
from app.security.password import hash_password, verify_password

PASSWORD = "demo1234"
NEW_PASSWORD = "newpass5678"


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

    def _create(password: str = PASSWORD, display_name: str = "资料用户") -> User:
        user = User(
            email=f"profile-settings-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password(password),
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


def _put_info(client: TestClient, user: User, body: dict) -> Response:
    return client.put("/api/profile/info", json=body, headers=_headers(user))


def test_update_info_persists_and_get_reflects_it(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user(display_name="初始昵称")

    updated = _put_info(
        client,
        user,
        {"display_name": "新昵称", "school": "实验中学", "grade": "高二"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["name"] == "新昵称"
    assert body["school"] == "实验中学"
    assert body["grade"] == "高二"
    assert body["email"] == user.email

    fetched = client.get("/api/profile/info", headers=_headers(user))
    assert fetched.status_code == 200, fetched.text
    persisted = fetched.json()
    assert persisted == body


def test_update_info_merges_omitted_fields(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user(display_name="保持昵称")

    first = _put_info(client, user, {"school": "第一中学", "grade": "高一"})
    assert first.status_code == 200, first.text
    assert first.json()["name"] == "保持昵称"

    second = _put_info(client, user, {"display_name": "新昵称"})
    assert second.status_code == 200, second.text
    partial = second.json()
    assert partial["name"] == "新昵称"
    assert partial["school"] == "第一中学"
    assert partial["grade"] == "高一"

    cleared = _put_info(client, user, {"school": None})
    assert cleared.status_code == 200, cleared.text
    after_clear = cleared.json()
    assert after_clear["school"] is None
    assert after_clear["grade"] == "高一"
    assert after_clear["name"] == "新昵称"


def test_password_update_allows_login_with_new_password(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = client.put(
        "/api/profile/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=_headers(user),
    )
    assert response.status_code == 204, response.text
    assert response.content == b""

    new_login = client.post(
        "/api/auth/login", json={"email": user.email, "password": NEW_PASSWORD}
    )
    assert new_login.status_code == 200, new_login.text
    old_login = client.post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    assert old_login.status_code == 401, old_login.text

    stored = db_session.scalar(select(User.password_hash).where(User.id == user.id))
    assert stored is not None
    assert stored != NEW_PASSWORD
    assert verify_password(NEW_PASSWORD, stored) is True


def test_password_update_rejects_wrong_current_password(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = client.put(
        "/api/profile/password",
        json={"current_password": "wrong-password", "new_password": NEW_PASSWORD},
        headers=_headers(user),
    )
    assert response.status_code == 400, response.text
    body = response.json()
    assert body["code"] == "INVALID_CURRENT_PASSWORD"
    assert body["detail"]

    stored = db_session.scalar(select(User.password_hash).where(User.id == user.id))
    assert verify_password(PASSWORD, stored) is True


def test_password_update_rejects_short_new_password(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = client.put(
        "/api/profile/password",
        json={"current_password": PASSWORD, "new_password": "short"},
        headers=_headers(user),
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_profile_mutations_require_auth(client: TestClient) -> None:
    info = client.put("/api/profile/info", json={"display_name": "匿名"})
    assert info.status_code == 401, info.text

    password = client.put(
        "/api/profile/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert password.status_code == 401, password.text
