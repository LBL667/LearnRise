"""Shared FastAPI dependencies: DB session, current user, ownership checks.

Data isolation contract
-----------------------
Every resource query must be scoped to ``user.id``. When a resource is already
loaded by id, call :func:`require_owner`: a mismatch raises ``404`` (never
``403``) so the API never confirms whether another user's object exists.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User

# ``auto_error=False`` so a missing header reaches our own dependency and is
# reported with the project's Chinese message instead of FastAPI's default.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# Alias kept for routers that import the scheme directly (e.g. security docs).
security_scheme = oauth2_scheme

DbSession = Annotated[Session, Depends(get_db)]
TokenStr = Annotated[str | None, Depends(oauth2_scheme)]


def _unauthorized() -> HTTPException:
    """Build the single canonical 401 (missing, expired, malformed, unknown)."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未认证",
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate an access token, raising 401 on any problem.

    Signature, expiry and claim shape are all checked; ``typ`` must be
    ``access`` so tokens minted for other purposes cannot authenticate.
    """
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise _unauthorized() from None

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject or payload.get("typ") != "access":
        raise _unauthorized()
    return payload


def _user_from_token(token: str | None, db: Session) -> User | None:
    if not token:
        return None
    payload = decode_access_token(token)
    return db.get(User, payload["sub"])


def get_current_user(token: TokenStr, db: DbSession) -> User:
    """Dependency returning the authenticated user or raising 401."""
    user = _user_from_token(token, db)
    if user is None:
        raise _unauthorized()
    return user


def get_current_user_optional(token: TokenStr, db: DbSession) -> User | None:
    """Like :func:`get_current_user` but returns ``None`` instead of raising."""
    try:
        return _user_from_token(token, db)
    except HTTPException:
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]


def require_owner(resource_user_id: str, user: User) -> None:
    """Enforce that ``resource_user_id`` belongs to ``user``.

    Raises ``404`` on mismatch: answering ``403`` would tell an attacker that
    the resource exists but belongs to somebody else.
    """
    if str(resource_user_id) != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="资源不存在")
