"""Avatar upload and anonymous avatar serving."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.adapters.storage.factory import build_storage
from app.api.auth import create_access_token
from app.config import settings
from app.db import SessionLocal
from app.models import User
from app.security.password import hash_password

PASSWORD = "demo1234"
PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 "


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

    def _create(display_name: str = "头像用户") -> User:
        user = User(
            email=f"avatar-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password(PASSWORD),
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


@pytest.fixture
def stored_keys() -> Iterator[list[str]]:
    keys: list[str] = []
    yield keys
    storage = build_storage()
    for key in keys:
        storage.delete(key)


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _upload(
    client: TestClient,
    *,
    content: bytes,
    content_type: str,
    filename: str = "avatar.png",
    user: User | None = None,
) -> Response:
    headers = _headers(user) if user is not None else {}
    return client.post(
        "/api/profile/avatar",
        files={"file": (filename, content, content_type)},
        headers=headers,
    )


def test_upload_png_returns_url_and_serves_anonymously(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = _upload(client, content=PNG, content_type="image/png", user=user)

    assert response.status_code == 200, response.text
    url = response.json()["avatarUrl"]
    assert url.endswith(f"/files/avatars/{user.id}/avatar.png")

    served = client.get(urlparse(url).path)
    assert served.status_code == 200, served.text
    assert served.headers["content-type"].startswith("image/png")
    assert served.content == PNG

    db_session.expire_all()
    refreshed = db_session.get(User, user.id)
    assert refreshed is not None
    assert refreshed.avatar_key == f"avatars/{user.id}/avatar.png"
    build_storage().delete(refreshed.avatar_key)


def test_upload_rejects_unsupported_type(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = _upload(
        client,
        content=b"hello",
        content_type="text/plain",
        filename="notes.txt",
        user=user,
    )

    assert response.status_code == 415, response.text
    assert response.json()["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_upload_rejects_oversized_payload(
    client: TestClient, make_user: Callable[..., User], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    user = make_user()

    response = _upload(
        client, content=b"x" * (1024 * 1024 + 1), content_type="image/png", user=user
    )

    assert response.status_code == 413, response.text
    assert response.json()["code"] == "PAYLOAD_TOO_LARGE"


def test_upload_rejects_empty_file(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = _upload(client, content=b"", content_type="image/png", user=user)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "EMPTY_FILE"


def test_upload_requires_authentication(client: TestClient) -> None:
    response = _upload(client, content=PNG, content_type="image/png")

    assert response.status_code == 401, response.text


def test_malformed_avatar_keys_are_not_found(
    client: TestClient, stored_keys: list[str]
) -> None:
    key = f"avatars/not-a-uuid/{uuid.uuid4().hex}.png"
    build_storage().put(key, PNG, "image/png")
    stored_keys.append(key)

    malformed = client.get(f"/files/{key}")
    traversal = client.get("/files/avatars/..%2F..%2Fetc/passwd")

    assert malformed.status_code == 404, malformed.text
    assert traversal.status_code == 404, traversal.text


def test_replacing_avatar_deletes_previous_key(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()
    first = _upload(client, content=PNG, content_type="image/png", user=user)
    assert first.status_code == 200, first.text
    old_key = f"avatars/{user.id}/avatar.png"

    second = _upload(client, content=WEBP, content_type="image/webp", user=user)

    assert second.status_code == 200, second.text
    assert second.json()["avatarUrl"].endswith(f"/files/avatars/{user.id}/avatar.webp")
    with pytest.raises(FileNotFoundError):
        build_storage().get(old_key)

    db_session.expire_all()
    refreshed = db_session.get(User, user.id)
    assert refreshed is not None
    assert refreshed.avatar_key == f"avatars/{user.id}/avatar.webp"
    build_storage().delete(refreshed.avatar_key)
