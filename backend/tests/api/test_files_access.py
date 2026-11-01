"""Access control for ``GET /files/{path}``."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.adapters.storage.factory import build_storage
from app.db import SessionLocal
from app.models import KnowledgeSource, User
from app.security.password import hash_password

PASSWORD = "demo1234"
PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
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

    def _create(name: str = "资料用户") -> User:
        user = User(
            email=f"files-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password(PASSWORD),
            display_name=name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(
            delete(KnowledgeSource).where(KnowledgeSource.user_id.in_(created))
        )
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


@pytest.fixture
def stored_keys() -> Iterator[list[str]]:
    keys: list[str] = []
    yield keys
    storage = build_storage()
    for key in keys:
        storage.delete(key)


def _login(client: TestClient, user: User) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _seed_source(db: Session, user: User, key: str) -> KnowledgeSource:
    source = KnowledgeSource(
        user_id=user.id,
        title="讲义",
        filename="notes.pdf",
        content_type="application/pdf",
        size_bytes=3,
        storage_key=key,
        status="ready",
    )
    db.add(source)
    db.commit()
    return source


def test_public_reward_image_needs_no_auth(
    client: TestClient, stored_keys: list[str]
) -> None:
    key = f"rewards/{uuid.uuid4().hex}/badge.png"
    build_storage().put(key, PNG, "image/png")
    stored_keys.append(key)

    response = client.get(f"/files/{key}")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")


def test_another_users_source_key_is_not_found(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    stored_keys: list[str],
) -> None:
    owner = make_user("资料所有者")
    stranger = make_user("路人")
    key = f"{owner.id}/{uuid.uuid4().hex}/notes.pdf"
    build_storage().put(key, b"pdf", "application/pdf")
    stored_keys.append(key)
    _seed_source(db_session, owner, key)

    response = client.get(f"/files/{key}", headers=_login(client, stranger))

    assert response.status_code == 404
    assert response.json()["detail"] == "文件不存在"


def test_owner_can_read_own_source_key(
    client: TestClient,
    db_session: Session,
    make_user: Callable[..., User],
    stored_keys: list[str],
) -> None:
    owner = make_user("资料所有者")
    key = f"{owner.id}/{uuid.uuid4().hex}/notes.pdf"
    build_storage().put(key, b"pdf", "application/pdf")
    stored_keys.append(key)
    _seed_source(db_session, owner, key)

    anonymous = client.get(f"/files/{key}")
    response = client.get(f"/files/{key}", headers=_login(client, owner))

    assert anonymous.status_code == 401
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.content == b"pdf"
