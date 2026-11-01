"""API tests for JWT login, /me, password hashing and cross-user isolation."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from httpx import Response
from jose import jwt
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.errors import install_error_handlers
from app.config import settings
from app.db import SessionLocal
from app.deps import CurrentUser, get_current_user_optional, require_owner
from app.models import User
from app.security.password import hash_password, verify_password

PASSWORD = "demo1234"
LOGIN_FAILED = "邮箱或密码错误"
UNAUTHENTICATED = "未认证"


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

    def _create(password: str = PASSWORD, display_name: str = "测试用户") -> User:
        user = User(
            email=f"task12-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password(password),
            display_name=display_name,
        )
        db_session.add(user)
        db_session.commit()
        created.append(user.id)
        return user

    yield _create

    if created:
        db_session.execute(delete(User).where(User.id.in_(created)))
        db_session.commit()


def _login(client: TestClient, user: User, password: str = PASSWORD) -> Response:
    return client.post("/api/auth/login", json={"email": user.email, "password": password})


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _token(
    user_id: str,
    *,
    expires_in: timedelta = timedelta(minutes=5),
    secret: str | None = None,
    typ: str = "access",
) -> str:
    issued_at = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "exp": issued_at + expires_in,
        "iat": issued_at,
        "typ": typ,
    }
    return jwt.encode(claims, secret or settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _isolation_app() -> FastAPI:
    isolation = FastAPI()

    @isolation.get("/items/{owner_id}")
    def read_item(owner_id: str, user: CurrentUser) -> dict[str, str]:
        require_owner(owner_id, user)
        return {"id": owner_id}

    return isolation


def test_login_returns_token_and_user(client: TestClient, make_user: Callable[..., User]) -> None:
    user = make_user()

    response = _login(client, user)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"] == {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
    }
    assert "password_hash" not in response.text
    assert PASSWORD not in response.text

    claims = jwt.decode(
        body["access_token"], settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
    assert claims["sub"] == user.id
    assert claims["typ"] == "access"
    assert claims["exp"] > claims["iat"]


def test_login_email_is_case_insensitive(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = client.post(
        "/api/auth/login",
        json={"email": user.email.upper(), "password": PASSWORD},
    )

    assert response.status_code == 200
    assert response.json()["user"]["id"] == user.id


def test_login_wrong_password_is_generic_401(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = _login(client, user, password="definitely-not-it")

    assert response.status_code == 401
    assert response.json()["detail"] == LOGIN_FAILED
    assert response.headers["www-authenticate"] == "Bearer"
    assert "password_hash" not in response.text


def test_login_unknown_email_matches_bad_password(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    make_user()
    unknown = User(
        email=f"task12-missing-{uuid.uuid4().hex}@example.com",
        password_hash=None,
        display_name="",
    )

    missing = _login(client, unknown)
    wrong = _login(client, unknown, password="nope")

    assert missing.status_code == 401
    assert missing.json()["detail"] == LOGIN_FAILED
    assert missing.json() == wrong.json()


def test_me_returns_current_user(client: TestClient, make_user: Callable[..., User]) -> None:
    user = make_user()
    token = _login(client, user).json()["access_token"]

    response = client.get("/api/auth/me", headers=_auth_header(token))

    assert response.status_code == 200
    assert response.json() == {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
    }
    assert "password_hash" not in response.text
    assert PASSWORD not in response.text


def test_me_without_token_is_401(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == UNAUTHENTICATED
    assert response.headers["www-authenticate"] == "Bearer"


def test_me_with_malformed_token_is_401(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    make_user()

    response = client.get("/api/auth/me", headers=_auth_header("not-a-jwt"))

    assert response.status_code == 401
    assert response.json()["detail"] == UNAUTHENTICATED


def test_me_with_expired_token_is_401(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    expired = _token(user.id, expires_in=timedelta(minutes=-5))

    response = client.get("/api/auth/me", headers=_auth_header(expired))

    assert response.status_code == 401
    assert response.json()["detail"] == UNAUTHENTICATED


def test_me_with_foreign_signature_is_401(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    forged = _token(user.id, secret="an-attackers-secret")

    response = client.get("/api/auth/me", headers=_auth_header(forged))

    assert response.status_code == 401


def test_me_with_non_access_token_is_401(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()
    refresh = _token(user.id, typ="refresh")

    response = client.get("/api/auth/me", headers=_auth_header(refresh))

    assert response.status_code == 401


def test_me_with_token_for_missing_user_is_401(client: TestClient) -> None:
    response = client.get("/api/auth/me", headers=_auth_header(_token(str(uuid.uuid4()))))

    assert response.status_code == 401
    assert response.json()["detail"] == UNAUTHENTICATED


def test_password_hash_roundtrip() -> None:
    hashed = hash_password(PASSWORD)

    assert hashed != PASSWORD
    assert hashed.startswith("$2")
    assert hashed.split("$")[2] == "12"
    assert verify_password(PASSWORD, hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_password_hash_is_salted() -> None:
    assert hash_password(PASSWORD) != hash_password(PASSWORD)


def test_verify_rejects_malformed_hash() -> None:
    assert verify_password(PASSWORD, "not-a-bcrypt-hash") is False
    assert verify_password(PASSWORD, "") is False
    assert verify_password(PASSWORD, None) is False


def test_long_password_over_72_bytes_keeps_full_entropy() -> None:
    long_password = "p" * 100
    shared_prefix = "a" * 72

    hashed = hash_password(long_password)
    prefix_hash = hash_password(shared_prefix + "tail-one")

    assert verify_password(long_password, hashed) is True
    assert verify_password(long_password[:-1] + "q", hashed) is False
    assert verify_password(shared_prefix + "tail-one", prefix_hash) is True
    assert verify_password(shared_prefix + "tail-two", prefix_hash) is False


def test_plaintext_password_never_stored(
    client: TestClient, db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()

    stored = db_session.get(User, user.id)

    assert stored is not None
    assert stored.password_hash is not None
    assert stored.password_hash != PASSWORD
    assert PASSWORD not in stored.password_hash
    assert stored.password_hash.startswith("$2")

    response = _login(client, user)
    assert PASSWORD not in response.text
    assert "password_hash" not in response.text


def test_require_owner_allows_matching_user(make_user: Callable[..., User]) -> None:
    user = make_user()

    assert require_owner(user.id, user) is None


def test_require_owner_cross_user_is_404(make_user: Callable[..., User]) -> None:
    owner = make_user()
    intruder = make_user()

    with pytest.raises(HTTPException) as excinfo:
        require_owner(owner.id, intruder)

    assert excinfo.value.status_code == 404
    assert excinfo.value.status_code != 403
    assert excinfo.value.detail == "资源不存在"


def test_get_current_user_optional(
    db_session: Session, make_user: Callable[..., User]
) -> None:
    user = make_user()

    assert get_current_user_optional(token=None, db=db_session) is None
    assert get_current_user_optional(token="garbage", db=db_session) is None

    resolved = get_current_user_optional(token=_token(user.id), db=db_session)
    assert resolved is not None
    assert resolved.id == user.id


def test_cross_user_read_via_real_route_is_404(make_user: Callable[..., User]) -> None:
    owner = make_user()
    intruder = make_user()

    with TestClient(_isolation_app()) as isolation:
        own = isolation.get(f"/items/{owner.id}", headers=_auth_header(_token(owner.id)))
        denied = isolation.get(f"/items/{owner.id}", headers=_auth_header(_token(intruder.id)))
        anonymous = isolation.get(f"/items/{owner.id}")

    assert own.status_code == 200
    assert own.json() == {"id": owner.id}
    assert denied.status_code == 404
    assert denied.json() == {"detail": "资源不存在"}
    assert anonymous.status_code == 401


def test_me_never_returns_another_users_identity(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    alice = make_user()
    bob = make_user()
    bob_token = _login(client, bob).json()["access_token"]

    body = client.get("/api/auth/me", headers=_auth_header(bob_token)).json()

    assert body["id"] == bob.id
    assert body["id"] != alice.id
    assert body["email"] == bob.email
    assert "password_hash" not in body


def _register(client: TestClient, email: str, password: str = "Passw0rd!", name: str = "注册用户"):
    return client.post(
        "/api/auth/register",
        json={"email": email, "display_name": name, "password": password},
    )


@pytest.fixture
def cleanup_emails(db_session: Session) -> Iterator[list[str]]:
    emails: list[str] = []
    try:
        yield emails
    finally:
        if emails:
            db_session.execute(delete(User).where(User.email.in_(emails)))
            db_session.commit()


def test_register_returns_token_and_user(
    client: TestClient, cleanup_emails: list[str]
) -> None:
    email = f"register-{uuid.uuid4().hex}@example.com"
    cleanup_emails.append(email)

    response = _register(client, email)

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == email
    assert body["user"]["display_name"] == "注册用户"
    assert "password_hash" not in response.text

    me = client.get("/api/auth/me", headers=_auth_header(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == email


def test_register_duplicate_email_is_409_with_code(
    client: TestClient, cleanup_emails: list[str]
) -> None:
    email = f"dupe-{uuid.uuid4().hex}@example.com"
    cleanup_emails.append(email)

    first = _register(client, email)
    second = _register(client, email)

    assert first.status_code == 201
    assert second.status_code == 409
    body = second.json()
    assert body["code"] == "EMAIL_TAKEN"
    assert body["detail"] == "邮箱已注册"


def test_register_duplicate_detection_is_case_insensitive(
    client: TestClient, cleanup_emails: list[str]
) -> None:
    email = f"mixed-{uuid.uuid4().hex}@example.com"
    cleanup_emails.append(email)

    assert _register(client, email).status_code == 201
    upper = email.upper()
    response = _register(client, upper)

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_TAKEN"


def test_register_stores_bcrypt_hash(
    client: TestClient, db_session: Session, cleanup_emails: list[str]
) -> None:
    email = f"hash-{uuid.uuid4().hex}@example.com"
    cleanup_emails.append(email)
    password = "Passw0rd!"

    assert _register(client, email, password=password).status_code == 201

    stored = db_session.scalar(select(User).where(User.email == email))
    assert stored is not None
    assert stored.password_hash is not None
    assert stored.password_hash != password
    assert stored.password_hash.startswith("$2")
    assert verify_password(password, stored.password_hash) is True


def test_register_rejects_short_password(client: TestClient, cleanup_emails: list[str]) -> None:
    email = f"short-{uuid.uuid4().hex}@example.com"
    cleanup_emails.append(email)

    response = _register(client, email, password="short")

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_register_rejects_blank_display_name(
    client: TestClient, cleanup_emails: list[str]
) -> None:
    email = f"blank-{uuid.uuid4().hex}@example.com"
    cleanup_emails.append(email)

    response = _register(client, email, name="   ")

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_legacy_login_failure_body_has_no_code(
    client: TestClient, make_user: Callable[..., User]
) -> None:
    user = make_user()

    response = client.post(
        "/api/auth/login", json={"email": user.email, "password": "wrong-password"}
    )

    assert response.status_code == 401
    assert response.json() == {"detail": LOGIN_FAILED}


def _new_api_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/api/competitions/{competition_id}")
    def read_competition(competition_id: str) -> dict[str, str]:
        raise HTTPException(status_code=404, detail="资源不存在")

    @app.get("/legacy/missing")
    def legacy_missing() -> dict[str, str]:
        raise HTTPException(status_code=404, detail="资源不存在")

    return app


def test_new_api_errors_carry_code_while_legacy_bodies_do_not() -> None:
    with TestClient(_new_api_app()) as scoped:
        new_body = scoped.get("/api/competitions/abc").json()
        legacy_body = scoped.get("/legacy/missing").json()

    assert new_body == {"detail": "资源不存在", "code": "NOT_FOUND"}
    assert legacy_body == {"detail": "资源不存在"}
